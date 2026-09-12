import {mkdir,lstat,readFile,writeFile,chmod} from 'node:fs/promises';
import {resolve,parse,join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
const [directory,origin,...flags]=process.argv.slice(2);
if(!directory||!origin)throw new Error('Usage: node scripts/desktop/init-self-host.mjs PRIVATE_DIRECTORY HTTPS_ORIGIN [--synthetic-account]');
const root=resolve(directory);if(root===parse(root).root||root===process.cwd())throw new Error('Use a dedicated new configuration directory');
const url=new URL(origin);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Use a bare HTTPS server origin');
if(flags.some(flag=>!['--synthetic-account','--complete-web-config'].includes(flag)))throw new Error('Unknown configuration option');
if(flags.includes('--complete-web-config')){
 const info=await lstat(root);if(!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o077)!==0)throw new Error('Private configuration directory required');
 const original=JSON.parse(await readFile(join(root,'application.json'),'utf8'));if(!/^[a-f0-9]{64}$/.test(original.API_PROXY_SHARED_SECRET))throw new Error('Invalid proxy configuration');
 await writeFile(join(root,'web.json'),JSON.stringify({API_PROXY_SHARED_SECRET:original.API_PROXY_SHARED_SECRET}),{flag:'wx',mode:0o600});
 console.log('Scoped web proxy configuration created; existing account, database and application secrets unchanged.');process.exit(0);
}
// Exclusive creation: reruns never rotate working session/database keys.
await mkdir(root,{recursive:false,mode:0o700});const stat=await lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Private directory required');await chmod(root,0o700);
const secret=()=>randomBytes(32).toString('hex');
const config={RUNTIME_PROFILE:'self-hosted',NODE_ENV:'production',DEPLOYMENT_ENV:'production',DESKTOP_SHARED_SERVER_ID:randomUUID(),SELF_HOST_DATA_ROOT:'/var/lib/orchestra',APP_BASE_URL:url.origin,FRONTEND_BASE_URL:url.origin,CORS_ALLOWED_ORIGINS:url.origin,STORAGE_DRIVER:'local',STORAGE_LOCAL_ROOT:'/var/lib/orchestra/files',CONNECTOR_CREDENTIAL_VAULT_MODE:'encrypted_file',SIGNUP_MODE:'disabled',AUTH_COOKIE_SECURE:'true',AUTH_COOKIE_SAME_SITE:'lax',SECURITY_HEADERS_ENABLED:'true',RATE_LIMIT_ENABLED:'true',ORCHESTRA_EMBED_WORKER:'false',QUEUE_PREFIX:'orchestra-shared-v1',ORCHESTRA_PROFILE:'full',MCP_ENABLED:'true',MCP_MODE:'team_internal',MCP_ALLOW_CONTROLLED_WRITES:'true',BETA_DEEP_RESEARCH_ENABLED:'true',PROVIDER_RELEASE_VALIDATED_PROVIDERS:'vscode'};
for(const key of ['JWT_ACCESS_SECRET','JWT_REFRESH_SECRET','CONNECTOR_OAUTH_STATE_SECRET','CONNECTOR_CREDENTIAL_ENCRYPTION_KEY','CLIENT_SHARE_TOKEN_SECRET','API_PROXY_SHARED_SECRET','METRICS_TOKEN','VSCODE_CONNECTOR_TOKEN_SECRET'])config[key]=secret();
const write=(name,value)=>writeFile(join(root,name),value,{flag:'wx',mode:0o600});
await write('application.json',JSON.stringify(config,null,2));await write('migrator-password',secret());await write('runtime-password',secret());
await write('web.json',JSON.stringify({API_PROXY_SHARED_SECRET:config.API_PROXY_SHARED_SECRET}));
const account=flags.includes('--synthetic-account')?{email:'owner@qualification.invalid',displayName:'Synthetic owner',organizationName:'Synthetic shared qualification',password:secret()}:{email:'',displayName:'',organizationName:'',password:''};
await write('bootstrap-account.json',JSON.stringify(account,null,2));
console.log('Private self-hosting configuration generated. No credentials printed. Supply a real bootstrap account securely before setup unless using the explicit synthetic fixture.');
