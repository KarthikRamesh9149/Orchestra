import { timingSafeEqual,createHmac } from 'node:crypto';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { parseEnv } from '../config/env.js';
import { parseRuntimeProfile } from '../config/runtime-profile.js';
import { loadInstallationSecrets, installationSecretsSchema, type InstallationSecrets } from '../config/installation-secrets.js';
import { buildContext } from '../setup-context.js';
import { buildApp } from '../app/build-app.js';
import { createLogger } from '../lib/logging/logger.js';
import { TelemetryService } from '../lib/observability/telemetry.js';
import { PrivateLocalStorageDriver } from '../lib/storage/private-local.js';
import { OfflineGenerationProvider, OfflineEmbeddingProvider, OfflineTranscriptionProvider } from '../lib/ai/offline.js';
import { PostgresJobDispatcher } from '../lib/jobs/postgres.js';
import { PostgresWorker } from '../lib/jobs/postgres-worker.js';
import { PostgresAiLimiter } from '../lib/ai-ops/postgres-limits.js';
import { createJobHandlers } from '../lib/jobs/handlers.js';
import { acquireDatabaseOwnership } from './database-ownership.js';
import { requiresExternalGeneration } from './offline-jobs.js';
import {DesktopAiProvider,desktopAiSchema,desktopAiEnvironment,resolveDesktopEmbeddingIdentity,type DesktopAi} from './ai-provider.js';
import {ensureDesktopEmbeddingIdentity} from './embedding-identity.js';
import {AppError} from '../app/errors.js';

/** Engine composition only. Native ownership, onboarding and packaging belong
 * to subsequent steps. No environment credentials are implicitly inherited. */
export async function createLocalEngine(input:{databaseUrl:string; installationRoot:string; port?:number; secrets?:InstallationSecrets;ai?:DesktopAi}) {
  const ai=input.ai?desktopAiSchema.parse(input.ai):undefined;
  const root=resolve(input.installationRoot);
  const profile=parseRuntimeProfile({profile:'desktop-local',databaseUrl:input.databaseUrl,host:'127.0.0.1',queue:'postgres',storageRoot:join(root,'data','files')});
  // Native hosts supply OS-vault material; never publish a plaintext duplicate.
  const secrets=input.secrets?installationSecretsSchema.parse(input.secrets):await loadInstallationSecrets(join(root,'credentials'));
  const port=input.port??43119;
  const env=parseEnv({
    RUNTIME_PROFILE:profile.profile,NODE_ENV:'production',DEPLOYMENT_ENV:'production',
    HOST:profile.host,PORT:port,APP_BASE_URL:`http://127.0.0.1:${port}`,CORS_ALLOWED_ORIGINS:`http://127.0.0.1:${port}`,
    DATABASE_URL:profile.databaseUrl,REDIS_URL:'',QUEUE_MODE:'postgres',
    STORAGE_DRIVER:'local',STORAGE_LOCAL_ROOT:profile.storageRoot,
    JWT_ACCESS_SECRET:secrets.access,JWT_REFRESH_SECRET:secrets.refresh,
    CLIENT_SHARE_TOKEN_SECRET:secrets.clientShare,CONNECTOR_OAUTH_STATE_SECRET:secrets.oauthState,
    CONNECTOR_CREDENTIAL_ENCRYPTION_KEY:secrets.connectorEncryption,
    VSCODE_CONNECTOR_TOKEN_SECRET:createHmac('sha256',secrets.oauthState).update('desktop-vscode-token-v1').digest('hex'),
    SIGNUP_MODE:'disabled',LOG_LEVEL:'error',MCP_ENABLED:'true',MCP_MODE:'local_dev',MCP_ALLOW_CONTROLLED_WRITES:'true',BETA_DEEP_RESEARCH_ENABLED:'true',
    ...(ai?desktopAiEnvironment(ai):{})
  });
  const prisma=new PrismaClient({datasources:{db:{url:profile.databaseUrl}}});
  let limiter:PostgresAiLimiter|undefined;
  let releaseOwnership:(()=>Promise<void>)|undefined;
  try {
    const roles=await prisma.$queryRaw<Array<{unsafe:boolean}>>`SELECT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole
      OR EXISTS(SELECT 1 FROM pg_class WHERE relname='desktop_jobs' AND relowner=pg_roles.oid)) AS unsafe
      FROM pg_roles WHERE rolname=current_user`;
    if(roles.length!==1||roles[0]!.unsafe)throw new Error('Desktop runtime requires a non-owner, non-superuser database role');
    releaseOwnership=await acquireDatabaseOwnership(profile.databaseUrl);
    limiter=new PostgresAiLimiter(prisma);
    const embeddingIdentity=ai?resolveDesktopEmbeddingIdentity(ai):null;
    let semanticReady=!!embeddingIdentity;
    let semanticSearchReason:'not_configured'|'embedding_reindex_required'|null=embeddingIdentity?null:'not_configured';
    if(embeddingIdentity)try{await ensureDesktopEmbeddingIdentity(prisma,embeddingIdentity);}catch(error){
      if(error instanceof AppError&&error.code==='embedding_reindex_required'){semanticReady=false;semanticSearchReason='embedding_reindex_required';}
      else throw error;
    }
    const externalAi=ai?new DesktopAiProvider(ai,limiter):undefined;
    const shared={env,logger:createLogger(env.LOG_LEVEL),storage:new PrivateLocalStorageDriver(profile.storageRoot!),
      generationProvider:externalAi??new OfflineGenerationProvider(),embeddingProvider:semanticReady?externalAi!:new OfflineEmbeddingProvider(),
      transcriptionProvider:new OfflineTranscriptionProvider(),telemetry:new TelemetryService(),aiLimiter:limiter};
    const context=buildContext({...shared,prisma,jobs:new PostgresJobDispatcher(prisma)});
    const app=await buildApp(context);
    // Additional installation authority, never a substitute for actor/project
    // authorization. The desktop main process will hold this token, not UI code.
    app.addHook('onRequest',async(request,reply)=>{
      const supplied=request.headers['x-orchestra-local-token'];
      const expected=Buffer.from(secrets.loopback);
      const actual=Buffer.from(typeof supplied==='string'?supplied:'');
      if(actual.length!==expected.length||!timingSafeEqual(actual,expected))
        return reply.code(401).send({error:'local_authority_required'});
    });
    const worker=new PostgresWorker(prisma,tx=>{
      const handlers=createJobHandlers(buildContext({...shared,prisma:tx,jobs:new PostgresJobDispatcher(tx)}));
      // Keep actual model work unavailable, but do not block deterministic
      // source/accepted-decision projections merely because of legacy names.
      for(const name of Object.keys(handlers) as Array<keyof typeof handlers>)
        if(requiresExternalGeneration(name)&&!externalAi)
          handlers[name]=async()=>{throw new Error('ai_not_configured');};
      return handlers;
    });
    let closed=false;
    return {app,context,worker,semanticSearchAvailable:semanticReady,semanticSearchReason,
      /** Privileged harness/supervisor only; never serialize this object. */
      localToken:secrets.loopback,
      async start(){if(closed)throw new Error('Engine is closed');await app.listen({host:profile.host,port});worker.start();},
      async close(){if(closed)return;closed=true;try{await app.close();await worker.close();externalAi?.revoke();await limiter!.close();await prisma.$disconnect();}finally{externalAi?.revoke();await releaseOwnership!();}}
    };
  }catch(error){await limiter?.close();await prisma.$disconnect();await releaseOwnership?.();throw error;}
}
