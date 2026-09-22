/** Real OpenAI synthesis over a large, varied synthetic lexical corpus.
 * SQL fixtures are NOT bulk ingestion/vector qualification. No UI, customer
 * profile or inherited secret is used. An explicit private desktop key file is
 * required. A maximum of 24 provider attempts is enforced by the application.
 */
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,symlink,cp,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {NativeHost,dedicatedAi,verifyBuild,assessAuthorityWording,assessPersistence} from './benchmark-retrieval-chain.mjs';
import {buildScaleFixture,fixtureId,fixtureContentHash,seedSql} from './benchmark-scale-native.mjs';
const repo=resolve(import.meta.dirname,'../..');
const must=(value,message)=>{if(!value)throw new Error(message);};
const forbidden=/OBSOLETE_RETENTION_743|STALE_PARSE_RETENTION_918|ARCHIVED_NIMBUS_999|ARCHIVED_OWNER_ZED|TENANT_SEALED_ORCHID|FOREIGN_OWNER_IRON/;
const required={sparse_ancient:[/Asha Vale/i,/47\s*(?:minutes|mins)/i],sparse_middle:[/73/,/Bela Moss/i],sparse_distributed:[/dock[- ]seven/i],recent_control:[/14:35/,/Iris Hale/i],multi_document_recall:[/Asha Vale/i,/Bela Moss/i,/dock[- ]seven/i],current_version_and_parse_revision:[/19\s*days/i],topical_precision:[/Saffronrelay/i]};
export function assessQuality(response,test,fixture,timing){
 const citations=response.citations??[],targets=new Map((response.open_targets??[]).map(t=>[t.id,t]));
 const chunks=new Map(fixture.chunks.map(c=>[c.id,c]));
 const refs=new Set(citations.map(c=>c.refId)),text=response.answer_md??'';
 const expected=test.expected??[],absence=test.name==='foreign_fact_absence';
 const generated=response.modelMetadata?.provider==='openai'&&response.modelMetadata?.degraded===false;
 const markers=[...text.matchAll(/\[E(\d+)\]/g)].map(match=>Number(match[1]));
 const ordinals=citations.map(c=>c.evidenceNumber).filter(number=>number!==undefined);
 const checks={
  actualModelOrHonestAbsence:absence?(/\b(?:none|not|no|cannot|couldn['’]t|unable|insufficient)\b/i.test(text)&&!forbidden.test(text)):generated,
  streamedAnswerMatches:absence&&!generated||timing.deltaCount>0&&timing.streamText.trim()===text.trim(),
  explicitCitationIdentity:ordinals.every(number=>Number.isInteger(number)&&number>=1&&number<=10)&&new Set(ordinals).size===ordinals.length&&markers.every(number=>ordinals.includes(number)),
  expectedFacts:(required[test.name]??[]).every(pattern=>pattern.test(text)),
  eachRequiredSource:expected.every(id=>refs.has(id)),
  citationIntegrity:citations.every(c=>{const chunk=chunks.get(c.refId),t=targets.get(c.openTargetId);return chunk?.allowed&&chunk.projectid===fixture.projectId&&t?.targetRef?.documentId===chunk.documentid&&t?.targetRef?.documentVersionId===chunk.versionid;}),
  noObsoleteOrForeignEvidence:!forbidden.test(JSON.stringify({text,citations,targets:[...targets.values()]}))&&fixture.forbidden.every(id=>!refs.has(id)),
  noSilentApproval:response.safety?.directMutationAllowed===false&&response.safety?.pendingChangesAreTruth===false,
  ...assessAuthorityWording(text),
 };
 return {checks,passed:Object.values(checks).every(Boolean)};
}
async function sql(host,query){
 const port=Number((await readFile(join(host.profile,'postgres/postmaster.pid'),'utf8')).split('\n')[3]);must(Number.isInteger(port)&&port>1023,'Invalid isolated database port');
 return new Promise((done,fail)=>{const p=spawn(join(host.bundle,'native/pgsql/bin/psql'),['-X','-w','-q','-h','127.0.0.1','-p',String(port),'-U','orchestra_admin','-d','orchestra','-v','ON_ERROR_STOP=1','-A','-t'],{env:{PATH:'',LANG:'C',PGPASSWORD:host.vault.admin},stdio:['pipe','pipe','ignore']});let out='';const timer=setTimeout(()=>{p.kill('SIGTERM');fail(new Error('Isolated SQL timed out'));},120000);p.stdout.on('data',b=>{if(out.length<1000000)out+=b;});p.on('error',()=>{clearTimeout(timer);fail(new Error('Isolated SQL failed to launch'));});p.on('exit',code=>{clearTimeout(timer);code===0?done(out):fail(new Error('Isolated fixture SQL rejected'));});p.stdin.on('error',()=>{});p.stdin.end(query);});
}
export async function runQuality(options){
 must(process.platform==='darwin','Mac native runtime required');
 const build=await verifyBuild(options.dist),ai=await dedicatedAi({...options,maxRequests:24,model:'gpt-5.4-mini'});must(ai,'Explicit dedicated desktop key required');
 ai.preferences={...ai.preferences,provider:'openai',embeddingProvider:'none'};
 const directory=await mkdtemp('/private/tmp/orchestra-quality-scale-'),bundle=join(directory,'runtime'),profile=join(directory,'profile');
 await mkdir(join(bundle,'backend'),{recursive:true,mode:0o700});await symlink(join(options.bundle,'native'),join(bundle,'native'));await symlink(options.dist,join(bundle,'backend/dist'));await symlink(join(repo,'node_modules'),join(bundle,'backend/node_modules'));await cp(join(repo,'prisma'),join(bundle,'backend/prisma'),{recursive:true});
 const fresh=()=>randomBytes(32).toString('hex'),vault={version:1,admin:fresh(),runtime:fresh(),installation:{version:1,loopback:fresh(),access:fresh(),refresh:fresh(),connectorEncryption:fresh(),oauthState:fresh(),clientShare:fresh()}};
 const host=new NativeHost(options,profile,bundle,vault),report={build,startedAt:new Date().toISOString(),scope:'Real model and native retrieval/persistence over 1000 synthetic documents / 10000 lexical chunks. Direct SQL fixture; no physical source files, ingestion, embeddings, rendered UI or customer data. Eight cases are regression signals, not universal factuality or p95 evidence.',requestCeiling:24,results:[],passed:false};
 const timer=setTimeout(()=>host.child?.kill('SIGTERM'),600000);
 try{
  report.freshProvisionMs=await host.start(undefined);const boot=await host.command({operation:'local.bootstrap'}),project=await host.command({operation:'workspace.create',name:'Synthetic large project quality'});
  const fixture=buildScaleFixture({documents:1000,chunksPerDocument:10},project.id,boot.user.id,fixtureId('quality-foreign-project'));
  report.fixture={documents:fixture.activeDocuments,chunks:fixture.activeChunks,contentSha256:fixtureContentHash(fixture),sourceBytes:fixture.chunks.reduce((n,c)=>n+Buffer.byteLength(c.text),0)};
  await sql(host,seedSql(fixture,fixtureId('quality-foreign-org')));await host.stop();report.populatedStartMs=await host.start(ai);
  for(const test of fixture.cases){
   const requestId=randomUUID(),timing={started:performance.now(),firstTextMs:null,lastTextMs:null,deltaCount:0,streamText:'',deltas:[]};host.streams.set(requestId,timing);
   try{const response=await host.command({operation:'socrates.ask',projectId:project.id,requestId,question:test.question,selectedSources:['documents']});
    const result={name:test.name,question:test.question,firstTextMs:timing.firstTextMs,completionMs:Math.round(performance.now()-timing.started),answer:response.answer_md,citations:response.citations,openTargets:response.open_targets,sessionId:response.sessionId,messageId:response.messageId,modelMetadata:response.modelMetadata,retrievalSummary:response.retrievalSummary,...assessQuality(response,test,fixture,timing)};
    report.results.push(result);console.log(JSON.stringify({case:test.name,passed:result.passed,firstTextMs:result.firstTextMs,completionMs:result.completionMs,failed:Object.entries(result.checks).filter(([,v])=>!v).map(([k])=>k)}));
   }catch{report.results.push({name:test.name,passed:false,error:'Request failed; provider details withheld'});}finally{host.streams.delete(requestId);}
  }
  report.providerAttempts=(await host.inspect()).providerRequests;must(report.providerAttempts<=24,'Provider ceiling exceeded');
  const auth=host.authority,denied=await fetch(`http://127.0.0.1:${auth.port}/v1/projects/${fixture.foreignProjectId}/documents`,{headers:{'x-orchestra-local-token':auth.token,Authorization:'Bearer '+auth.bearer},signal:AbortSignal.timeout(15000)});
  report.crossTenantHttp=denied.status;must([403,404].includes(denied.status),'Foreign project isolation failed');
  await host.stop();report.offlineRestartMs=await host.start(undefined);
  for(const result of report.results.filter(r=>r.sessionId)){const history=await host.api(`/v1/projects/${project.id}/socrates/sessions/${result.sessionId}/messages`);result.persistence=assessPersistence(history,result);result.passed&&=result.persistence.passed;}
  report.noCallsDuringOfflineRestart=(await host.inspect()).providerRequests===report.providerAttempts;
  report.buildUnchanged=JSON.stringify(await verifyBuild(options.dist))===JSON.stringify(build);
  report.passed=report.results.length===fixture.cases.length&&report.results.every(r=>r.passed)&&report.noCallsDuringOfflineRestart&&report.buildUnchanged;
 }catch(e){report.failure=e.message;}finally{clearTimeout(timer);try{await host.stop();}catch{report.passed=false;report.shutdownFailure=true;}report.completedAt=new Date().toISOString();await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({report:join(directory,'report.json'),passed:report.passed,failure:report.failure}));}
 return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [keyFile,bundle]=process.argv.slice(2);must(keyFile?.startsWith('/')&&bundle?.startsWith('/'),'Usage: node benchmark-quality-scale.mjs /absolute/dedicated-desktop.env /absolute/runtime');
 const result=await runQuality({keyFile,bundle:resolve(bundle),dist:join(repo,'dist')});if(!result.passed)process.exitCode=1;
}
