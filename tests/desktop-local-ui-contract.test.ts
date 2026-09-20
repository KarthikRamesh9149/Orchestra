import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp,rm,readFile,symlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {isLocalRoute,localHttp} from '../apps/desktop/src/local-http.js';
import type {HostClient} from '../apps/desktop/src/host-client.js';
import {readLocalState,saveLocalState} from '../src/desktop/local-state.js';
import {DeepResearchService} from '../src/modules/deep-research/service.js';
import {IntegrationManagementService} from '../src/modules/integrations/integrations.service.js';
const roots:string[]=[];
afterEach(async()=>{vi.unstubAllGlobals();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function temporary(){const root=await mkdtemp(join(tmpdir(),'orchestra-local-ui-test-'));roots.push(root);return root;}
function host(){return {credentials:()=>({port:43119,bearer:'private-bearer',token:'private-installation-token'}),request:vi.fn().mockResolvedValue({ok:true,data:{user:{id:'local'},workspaces:[],onboarded:true}})} as unknown as HostClient;}
describe('native local API authority',()=>{
 it('does not advertise unqualified desktop providers or label absent providers as broken connections',async()=>{
  const service=new IntegrationManagementService({} as never,{RUNTIME_PROFILE:'desktop-local'} as never,{ensureProjectAccess:vi.fn().mockResolvedValue({})} as never,{} as never,{} as never,{} as never);
  for(const method of ['slackStatus','communicationProviderStatus','vscodeStatus','googleCalendarStatus','googleDriveStatus','githubStatus'])Object.defineProperty(service,method,{value:vi.fn().mockResolvedValue({provider:'synthetic',connected:false,configured:true,status:'connectable',degraded:true,needsReauth:true,availableActions:['connect','sync'],limitations:[]})});
  const result=await service.getProjectIntegrationStatus(randomUUID(),{userId:randomUUID(),orgId:randomUUID()});
  for(const provider of result.providers)expect(provider).toMatchObject({status:'not_configured',configured:false,degraded:false,needsReauth:false,availableActions:[],capabilities:{canConnect:false,canSync:false,canDisconnect:false}});
 });
 it.each([undefined,'none'])('rejects unconfigured research (%s) before recording usage or creating a job',async(provider)=>{
  const prisma={$transaction:vi.fn()},projectService={ensureProjectAccess:vi.fn().mockResolvedValue({projectRole:'manager'})},jobs={enqueue:vi.fn()};
  const service=new DeepResearchService(prisma as never,{RUNTIME_PROFILE:'desktop-local',BETA_DEEP_RESEARCH_ENABLED:true,DESKTOP_AI_PROVIDER:provider,OPENAI_API_KEY:'synthetic-stale-key'} as never,{} as never,{} as never,{} as never,projectService as never,{} as never,{} as never,jobs as never);
  await expect(service.startRun(randomUUID(),{userId:randomUUID(),orgId:randomUUID()},{researchFocus:'local evidence',sources:['docs'],outputFormat:'full_report',privacyMode:'internal_only',webSearchEnabled:false} as never)).rejects.toMatchObject({code:'ai_not_configured'});
  expect(projectService.ensureProjectAccess).toHaveBeenCalledOnce();expect(prisma.$transaction).not.toHaveBeenCalled();expect(jobs.enqueue).not.toHaveBeenCalled();
 });
 it.each(['openai','openai-compatible','anthropic','google'])('allows configured desktop %s research to enter the normal authorized quota transaction',async(provider)=>{
  const prisma={$transaction:vi.fn().mockRejectedValue(new Error('quota-transaction-reached'))},projectService={ensureProjectAccess:vi.fn().mockResolvedValue({projectRole:'manager'})};
  const service=new DeepResearchService(prisma as never,{RUNTIME_PROFILE:'desktop-local',BETA_DEEP_RESEARCH_ENABLED:true,DESKTOP_AI_PROVIDER:provider} as never,{} as never,{} as never,{} as never,projectService as never,{} as never,{} as never,{} as never);
  await expect(service.startRun(randomUUID(),{userId:randomUUID(),orgId:randomUUID()},{researchFocus:'local evidence',sources:['docs'],outputFormat:'exec_summary',privacyMode:'internal_only',webSearchEnabled:false})).rejects.toThrow('quota-transaction-reached');
  expect(projectService.ensureProjectAccess).toHaveBeenCalledOnce();expect(prisma.$transaction).toHaveBeenCalledOnce();
 });
 it('permits reviewed local contracts but rejects provider, signup and malformed paths',()=>{
  const project=randomUUID();
  expect(isLocalRoute('GET',`/v1/projects/${project}/subscriptions`)).toBe(true);
  expect(isLocalRoute('GET',`/v1/projects/${project}/github/code-status`)).toBe(true);
  expect(isLocalRoute('POST',`/v1/projects/${project}/github/repositories/link`)).toBe(false);
  expect(isLocalRoute('GET',`/v1/projects/${project}/members`)).toBe(true);
  expect(isLocalRoute('GET',`/v1/projects/${project}/truth-inbox/proposal%3A${randomUUID()}/packet`)).toBe(true);
  expect(isLocalRoute('GET',`/v1/projects/${project}/dashboard/files/src%2Findex.ts/safe-to-touch`)).toBe(true);
  expect(isLocalRoute('GET',`/v1/projects/${project}/dashboard/files/..%2Fsecret/safe-to-touch`)).toBe(false);
  expect(isLocalRoute('GET',`/v1/projects/${project}/truth-inbox/https%3Aevil/packet`)).toBe(false);
  for(const [method,path] of [['POST','/v1/auth/signup'],['POST',`/v1/projects/${project}/join-codes`],['POST',`/v1/projects/${project}/members`],['GET','/v1/projects/not-a-uuid/documents'],['GET',`/v1/projects/${project}/%2e%2e/documents`]])expect(isLocalRoute(method!,path!)).toBe(false);
 });
 it('rejects foreign origins and malformed workspace selection without dispatch',async()=>{
  const engine=host();
  expect((await localHttp(new Request('https://app/v1/auth/me'),engine)).status).toBe(403);
  expect(()=>new Request('orchestra://user@app/v1/auth/me')).toThrow();
  for(const body of ['{',JSON.stringify({projectId:randomUUID(),actorUserId:randomUUID()}),JSON.stringify({projectId:'invalid'})])expect((await localHttp(new Request('orchestra://app/v1/me/workspaces/switch',{method:'POST',body}),engine)).status).toBe(400);
  expect(engine.request).not.toHaveBeenCalled();
 });
 it('never forwards renderer credentials, cookies or an external destination',async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response('saved',{status:200,headers:{'set-cookie':'secret','content-type':'text/plain'}}));vi.stubGlobal('fetch',fetcher);
  const response=await localHttp(new Request(`orchestra://app/v1/projects/${randomUUID()}/documents`,{headers:{authorization:'evil',cookie:'evil','x-orchestra-local-token':'evil'}}),host());
  const [url,options]=fetcher.mock.calls[0]!;expect(url).toMatch(/^http:\/\/127\.0\.0\.1:43119\/v1\/projects\//);expect(options.redirect).toBe('error');
  expect(options.headers.get('authorization')).toBe('Bearer private-bearer');expect(options.headers.get('cookie')).toBeNull();expect(options.headers.get('x-orchestra-local-token')).toBe('private-installation-token');
  expect(response.headers.get('set-cookie')).toBeNull();expect(response.headers.get('cache-control')).toBe('no-store');expect(await response.text()).toBe('saved');
 });
 it('preserves backend rejection and incremental streams without buffering',async()=>{
  let output!:ReadableStreamDefaultController<Uint8Array>;const source=new ReadableStream<Uint8Array>({start(controller){output=controller;}});
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(source,{headers:{'content-type':'text/event-stream'}})));
  const response=await localHttp(new Request(`orchestra://app/v1/projects/${randomUUID()}/documents`),host());
  output.enqueue(new TextEncoder().encode('data: first\n\n'));const reader=response.body!.getReader();expect(new TextDecoder().decode((await reader.read()).value)).toContain('first');output.close();
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({error:{code:'forbidden'}},{status:403})));
  expect((await localHttp(new Request(`orchestra://app/v1/projects/${randomUUID()}/documents`),host())).status).toBe(403);
 });
 it('does not turn runtime unavailability into an empty success',async()=>{
  const engine=host();engine.credentials=()=>undefined;
  const response=await localHttp(new Request(`orchestra://app/v1/projects/${randomUUID()}/documents`),engine);expect(response.status).toBe(503);expect(((await response.json()) as {error:{code:string}}).error.code).toBe('runtime_unavailable');
 });
});
describe('durable native workspace state',()=>{
 it('serializes selection and onboarding and preserves them on a fresh read',async()=>{
  const root=await temporary(),project=randomUUID();expect((await readLocalState(root)).onboarded).toBe(false);
  await Promise.all([saveLocalState(root,project),saveLocalState(root,undefined,true)]);
  expect(await readLocalState(root)).toEqual({version:1,projectId:project,onboarded:true});expect(await readFile(join(root,'workspace-state.json'),'utf8')).not.toContain('password');
 });
 it('rejects symbolic links, corrupt and oversized state without overwriting',async()=>{
  const root=await temporary(),outside=await temporary(),target=join(outside,'state');await writeFile(target,'{}');await symlink(target,join(root,'workspace-state.json'));
  await expect(readLocalState(root)).rejects.toThrow();await expect(saveLocalState(root,null)).rejects.toThrow();expect(await readFile(target,'utf8')).toBe('{}');
  const corrupt=await temporary();await writeFile(join(corrupt,'workspace-state.json'),'x'.repeat(4097));await expect(readLocalState(corrupt)).rejects.toThrow('Invalid workspace state');
 });
});
