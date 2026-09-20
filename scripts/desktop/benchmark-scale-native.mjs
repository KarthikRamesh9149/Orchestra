/**
 * Real, offline native-engine scale benchmark. Never reads an env/key file.
 * Current source must already be compiled by the coordinating owner.
 * Default: 1,000 active documents / 10,000 current lexical chunks, 30 relaunches.
 * SQL-created synthetic retrieval fixtures are NOT upload/parse qualification.
 * Cold means new native/PostgreSQL processes; no OS caches are deleted/flushed.
 */
import {spawn} from 'node:child_process';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {access,cp,mkdir,mkdtemp,readFile,readdir,stat,symlink,writeFile} from 'node:fs/promises';
import {dirname,join,relative,resolve} from 'node:path';
import {cpus,totalmem,freemem,tmpdir,release} from 'node:os';
import {fileURLToPath} from 'node:url';

const REPO=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const GIB=1024**3;
const UUID=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const round=n=>Math.round(n*10)/10;
class BenchmarkError extends Error {}
const requireThat=(condition,message)=>{if(!condition)throw new BenchmarkError(message);};
const hash=value=>createHash('sha256').update(value).digest('hex');
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
export function fixtureId(label){const value=hash(label);return `${value.slice(0,8)}-${value.slice(8,12)}-4${value.slice(13,16)}-8${value.slice(17,20)}-${value.slice(20,32)}`;}
export function fixtureContentHash(fixture){return hash(JSON.stringify(fixture.chunks.map(({id,documentid,versionid,idx,revision,text,at,allowed})=>({id,documentid,versionid,idx,revision,text,at,allowed}))));}

export function summarize(values){
  requireThat(values.every(value=>Number.isFinite(value)&&value>=0),'Invalid timing sample.');
  const sorted=[...values].sort((a,b)=>a-b);
  const percentile=p=>sorted[Math.ceil(sorted.length*p)-1];
  return {samples:sorted.length,minMs:sorted.length?round(sorted[0]):null,maxMs:sorted.length?round(sorted.at(-1)):null,p50Ms:sorted.length?round(percentile(.5)):null,p95Ms:sorted.length>=20?round(percentile(.95)):null,meanMs:sorted.length?round(sorted.reduce((sum,n)=>sum+n,0)/sorted.length):null,method:'empirical nearest-rank; p95 withheld below 20 samples'};
}

export function parseScaleArgs(argv){
  const values=new Map(),allowed=new Set(['--bundle','--backend-dist','--documents','--chunks-per-document','--cycles','--max-runtime-ms']);
  for(let i=0;i<argv.length;i+=2){requireThat(allowed.has(argv[i])&&argv[i+1]&&!argv[i+1].startsWith('--')&&!values.has(argv[i]),'Unknown, repeated or missing argument; use --help.');values.set(argv[i],argv[i+1]);}
  const documents=Number(values.get('--documents')??1000),chunksPerDocument=Number(values.get('--chunks-per-document')??10),cycles=Number(values.get('--cycles')??30),maxRuntimeMs=Number(values.get('--max-runtime-ms')??900000);
  requireThat(Number.isInteger(documents)&&documents>=100&&documents<=2000,'Document count must be 100..2000.');
  requireThat(Number.isInteger(chunksPerDocument)&&chunksPerDocument>=4&&chunksPerDocument<=20,'Chunks per document must be 4..20.');
  requireThat(Number.isInteger(cycles)&&cycles>=2&&cycles<=50,'Cycles must be 2..50.');
  requireThat(Number.isInteger(maxRuntimeMs)&&maxRuntimeMs>=60000&&maxRuntimeMs<=1200000,'Runtime limit must be 60000..1200000 ms.');
  return {documents,chunksPerDocument,cycles,maxRuntimeMs,bundle:resolve(values.get('--bundle')??join(REPO,'.desktop/runtime')),dist:resolve(values.get('--backend-dist')??join(REPO,'dist'))};
}

const TOPICS=['freight routing','invoice reconciliation','accessibility testing','warehouse replenishment','partner onboarding','capacity planning','audit retention','incident dispatch','regional fulfilment','account entitlement','payment settlement','device enrollment','supplier quality','service recovery','catalogue synchronisation','contract renewal'];
const TEAMS=['Harbour','Cedar','Atlas','Marble','Delta','Finch','Orion','Juniper','Wattle','Coral','Summit','Willow'];
const ACTIONS=['reviews incoming exceptions','reconciles the daily ledger','checks accessibility acceptance criteria','assigns follow-up tickets','validates the staging checklist','compares delivery receipts','confirms the accountable reviewer','tests recovery procedures','records supplier acknowledgements','checks access expiry dates','tracks regional cut-off windows','compares settlement references'];
function variedContent(document,index){
  const topic=TOPICS[document%TOPICS.length],team=TEAMS[(document+index)%TEAMS.length];
  return `${team} team operating detail ${index+1} for ${topic}. `+Array.from({length:5},(_,part)=>{
    const action=ACTIONS[(document*3+index*7+part)%ACTIONS.length];
    return `For batch ${document*11+index*3+part+1}, ${TEAMS[(document+part*3)%TEAMS.length]} ${action}; the control window is ${15+(document+index+part)%85} minutes and the review sample contains ${20+(document*7+index+part)%180} entries. Exceptions require a dated owner acknowledgement and a reason code before the next handover.`;
  }).join(' ');
}

export function buildScaleFixture(options,projectId,ownerId,foreignProjectId){
  const count=options.documents,per=options.chunksPerDocument;
  const positions={ancient:3,middle:Math.floor(count*.21),distributed:Math.floor(count*.49),versioned:Math.floor(count*.62),sameDocument:Math.floor(count*.77),recent:count-1};
  const facts={
    ancient:{document:positions.ancient,index:per-2,text:'Nimbuscopper acceptance desk: escalation owner is Asha Vale; recovery window is 47 minutes. Nimbuscopper acceptance desk handover code is NIMBUS_CURRENT_47.'},
    middle:{document:positions.middle,index:1,text:'Pinequartz rollout threshold: rollout requires 73 verified receipts; coordinator is Bela Moss. Pinequartz rollout approval code is PINE_CURRENT_73.'},
    distributed:{document:positions.distributed,index:per-1,text:'Copperharbor dispatch path: ledger route is dock-seven; escalation owner is Omar Keene. Copperharbor dispatch reference is COPPER_CURRENT_SEVEN.'},
    versioned:{document:positions.versioned,index:2,text:'Silvermeadow review records: retention period is 19 days and disposal requires the records steward. Silvermeadow retention rule is RETENTION_CURRENT_19.'},
    recent:{document:positions.recent,index:per-1,text:'Frostlark billing cutoff: invoice cut-off is 14:35 UTC; handler is Iris Hale. Frostlark invoice reference is FROST_CURRENT_1435.'}
  };
  const documents=[],versions=[],chunks=[],factChunks={};
  const at=(number,index=0)=>new Date(Date.UTC(2020,0,1)+number*86400000+index*1000).toISOString();
  function addDocument(label,number,scope=projectId,archived=false){
    const id=fixtureId(`doc:${label}`),versionId=fixtureId(`version:${label}:current`);
    documents.push({id,projectid:scope,title:`Operations memo ${String(number).padStart(4,'0')}: ${TOPICS[number%TOPICS.length]}`,versionid:versionId,archived,at:at(number)});
    versions.push({id:versionId,documentid:id,projectid:scope,revision:2,at:at(number),checksum:hash(`current:${label}`)});
    return {id,versionId};
  }
  function addChunk(documentId,versionId,scope,index,revision,text,label,createdAt,allowed){
    const id=fixtureId(`chunk:${label}`),sectionId=fixtureId(`section:${label}`);
    chunks.push({id,sectionid:sectionId,documentid:documentId,versionid:versionId,projectid:scope,idx:index,revision,text,at:createdAt,allowed,anchor:`section-${revision}-${index}`});
    return id;
  }
  for(let n=0;n<count;n++){
    const document=addDocument(`main:${n}`,n);
    for(let index=0;index<per;index++){
      let text=variedContent(n,index),key=Object.keys(facts).find(key=>facts[key].document===n&&facts[key].index===index);
      if(key)text=facts[key].text+'\n'+text;
      if(n===positions.sameDocument)text=`Saffronrelay operating segment ${index+1}: reconciliation checkpoint ${100+index}; reviewer team ${TEAMS[index%TEAMS.length]}.\n`+text;
      const id=addChunk(document.id,document.versionId,projectId,index,2,text,`main:${n}:${index}`,at(n,index),true);
      if(key)factChunks[key]=id;
    }
  }
  const versioned=documents[positions.versioned];
  const oldVersionId=fixtureId('version:obsolete');
  versions.push({id:oldVersionId,documentid:versioned.id,projectid:projectId,revision:1,at:at(count+1),checksum:hash('obsolete')});
  const forbidden=[];
  forbidden.push(addChunk(versioned.id,oldVersionId,projectId,0,1,'Silvermeadow review records retention period is 743 days. OBSOLETE_RETENTION_743. '+facts.versioned.text.repeat(3),'obsolete-version',at(count+1),false));
  forbidden.push(addChunk(versioned.id,versioned.versionid,projectId,0,1,'Silvermeadow review records retention period is 918 days. STALE_PARSE_RETENTION_918. '+facts.versioned.text.repeat(3),'stale-parse',at(count+2),false));
  const archived=addDocument('archived',count+3,projectId,true);
  forbidden.push(addChunk(archived.id,archived.versionId,projectId,0,2,'Nimbuscopper acceptance desk owner is ARCHIVED_OWNER_ZED; recovery window is 999 minutes. ARCHIVED_NIMBUS_999. '+facts.ancient.text.repeat(3),'archive-decoy',at(count+3),false));
  const foreign=addDocument('foreign',count+4,foreignProjectId);
  forbidden.push(addChunk(foreign.id,foreign.versionId,foreignProjectId,0,2,'Nightorchid sealed routing code is TENANT_SEALED_ORCHID. Nimbuscopper acceptance desk owner is FOREIGN_OWNER_IRON; recovery window is 888 minutes. '+facts.ancient.text.repeat(3),'tenant-decoy',at(count+4),false));
  const cases=[
    {name:'sparse_ancient',question:'For this project, state the Nimbuscopper acceptance desk escalation owner and recovery window.',expected:[factChunks.ancient],tokens:['NIMBUS_CURRENT_47']},
    {name:'sparse_middle',question:'What does this project record for the Pinequartz rollout threshold and coordinator?',expected:[factChunks.middle],tokens:['PINE_CURRENT_73']},
    {name:'sparse_distributed',question:'Find this project’s Copperharbor dispatch path and ledger route.',expected:[factChunks.distributed],tokens:['COPPER_CURRENT_SEVEN']},
    {name:'recent_control',question:'What is this project’s Frostlark billing cutoff and handler?',expected:[factChunks.recent],tokens:['FROST_CURRENT_1435']},
    {name:'multi_document_recall',question:'Compare project records for Nimbuscopper acceptance desk, Pinequartz rollout threshold and Copperharbor dispatch path. Cite each source.',expected:[factChunks.ancient,factChunks.middle,factChunks.distributed],tokens:['NIMBUS_CURRENT_47','PINE_CURRENT_73','COPPER_CURRENT_SEVEN']},
    {name:'current_version_and_parse_revision',question:'What retention period does this project record for Silvermeadow review records?',expected:[factChunks.versioned],tokens:['RETENTION_CURRENT_19']},
    {name:'topical_precision',question:'Find Saffronrelay in the project documents.',expected:[],tokens:['Saffronrelay'],expectedDocumentIds:[documents[positions.sameDocument].id],minimumCitedChunksPerExpectedDocument:1,topicToken:'Saffronrelay'},
    {name:'foreign_fact_absence',question:'Which project document records the Nightorchid sealed routing code?',expected:[],tokens:[]}
  ];
  return {ownerId,projectId,foreignProjectId,documents,versions,chunks,facts,factChunks,forbidden,cases,activeDocuments:count,activeChunks:count*per,positions};
}

export function assessRetrieval(response,test,fixture){
  const citations=response.citations??[],targets=response.open_targets??[],byTarget=new Map(targets.map(target=>[target.id,target]));
  const byChunk=new Map(fixture.chunks.map(chunk=>[chunk.id,chunk]));
  const refs=new Set(citations.map(citation=>citation.refId));
  const actualDocumentIds=[...new Set(targets.map(target=>target.targetRef?.documentId).filter(Boolean))];
  const text=[response.answer_md,...citations.map(citation=>citation.excerpt),JSON.stringify(targets)].join('\n');
  const found=test.expected.filter(id=>refs.has(id));
  const checks=[
    {name:'offline_zero_model_calls',passed:response.modelMetadata?.provider==='deterministic'&&response.costEstimate?.modelCalls===0&&response.costEstimate?.estimatedUsd===0},
    {name:'retrieval_instrumentation_present',passed:Number.isFinite(response.retrievalSummary?.performance?.retrievalMs)},
    {name:'persisted_response_identity_present',passed:UUID.test(response.sessionId??'')&&UUID.test(response.messageId??'')},
    {name:'all_sparse_target_chunks_cited',passed:found.length===test.expected.length},
    {name:'exact_fact_tokens_in_evidence',passed:test.tokens.every(token=>text.includes(token))},
    {name:'all_citations_current_same_project',passed:citations.every(citation=>{const chunk=byChunk.get(citation.refId),target=byTarget.get(citation.openTargetId);return chunk?.allowed===true&&chunk.projectid===fixture.projectId&&target?.targetRef?.documentId===chunk.documentid&&target?.targetRef?.documentVersionId===chunk.versionid;})},
    {name:'all_open_targets_current_same_project',passed:targets.every(target=>fixture.chunks.some(chunk=>chunk.allowed&&chunk.projectid===fixture.projectId&&target.targetRef?.documentId===chunk.documentid&&target.targetRef?.documentVersionId===chunk.versionid))},
    {name:'obsolete_archive_tenant_ids_absent',passed:fixture.forbidden.every(id=>!refs.has(id))},
    {name:'obsolete_archive_tenant_sentinels_absent',passed:!/(?:OBSOLETE_RETENTION_743|STALE_PARSE_RETENTION_918|ARCHIVED_NIMBUS_999|ARCHIVED_OWNER_ZED|TENANT_SEALED_ORCHID|FOREIGN_OWNER_IRON)/.test(text)},
    ...(test.expectedDocumentIds===undefined?[]:[{name:'known_matching_document_retrieved',passed:test.expectedDocumentIds.every(id=>actualDocumentIds.includes(id)&&[...refs].filter(ref=>byChunk.get(ref)?.documentid===id).length>=test.minimumCitedChunksPerExpectedDocument)}]),
    ...(test.topicToken===undefined?[]:[{name:'cited_passages_match_requested_topic',passed:citations.every(citation=>byChunk.get(citation.refId)?.text.toLowerCase().includes(test.topicToken.toLowerCase()))}])
  ];
  return {passed:checks.every(check=>check.passed),checks,expectedTargetCount:test.expected.length,retrievedTargetCount:found.length,targetRecall:test.expected.length?found.length/test.expected.length:null,actualDocumentIds,reportedDocumentCount:response.retrievalSummary?.sourceCounts?.documents??null,citedChunkIds:[...refs]};
}

async function walk(path){const entries=await readdir(path,{withFileTypes:true});return (await Promise.all(entries.sort((a,b)=>a.name.localeCompare(b.name)).map(entry=>entry.isDirectory()?walk(join(path,entry.name)):[join(path,entry.name)]))).flat();}
async function buildIdentity(dist){
  const sources=(await walk(join(REPO,'src'))).filter(file=>file.endsWith('.ts')&&!file.endsWith('.d.ts'));
  const sourceHash=createHash('sha256'),compiledHash=createHash('sha256'),schemaHash=createHash('sha256');
  for(const source of sources){const compiled=join(dist,relative(REPO,source).replace(/\.ts$/,'.js'));const info=await stat(compiled).catch(()=>null);requireThat(info&&info.mtimeMs>=(await stat(source)).mtimeMs,'Current compiled backend is missing/stale; ask the coordinating owner to compile.');sourceHash.update(relative(REPO,source)).update(await readFile(source));compiledHash.update(relative(dist,compiled)).update(await readFile(compiled));}
  for(const file of await walk(join(REPO,'prisma')))schemaHash.update(relative(REPO,file)).update(await readFile(file));
  const head=await readFile(join(REPO,'.git/HEAD'),'utf8');requireThat(head.trim()==='ref: refs/heads/main','Private desktop main checkout required.');
  return {sourceSha256:sourceHash.digest('hex'),compiledSha256:compiledHash.digest('hex'),schemaSha256:schemaHash.digest('hex'),packageLockSha256:hash(await readFile(join(REPO,'package-lock.json'))),harnessSha256:hash(await readFile(fileURLToPath(import.meta.url))),head:(await readFile(join(REPO,'.git/refs/heads/main'),'utf8')).trim()};
}

async function processOutput(file,args,{env={},input='',timeoutMs=30000,maxBytes=8*1024*1024}={}){
  return new Promise((done,fail)=>{const child=spawn(file,args,{env:{PATH:'',LANG:'C',TMPDIR:tmpdir(),...env},stdio:['pipe','pipe','ignore']});let output='',tooLarge=false;const timer=setTimeout(()=>{child.kill('SIGTERM');fail(new BenchmarkError('Bounded helper timed out.'));},timeoutMs);child.stdout.on('data',data=>{output+=data;if(Buffer.byteLength(output)>maxBytes){tooLarge=true;child.kill('SIGTERM');}});child.on('error',()=>{clearTimeout(timer);fail(new BenchmarkError('Bounded helper could not start.'));});child.on('exit',code=>{clearTimeout(timer);code===0&&!tooLarge?done(output):fail(new BenchmarkError('Bounded helper failed (raw details withheld).'));});child.stdin.on('error',()=>{});child.stdin.end(input);});
}

class ScaleHost {
  constructor(options,profile,bundle,vault){this.options=options;this.profile=profile;this.bundle=bundle;this.vault=vault;this.pending=new Map();this.child=null;this.authority=null;}
  async start(){
    requireThat(!this.child,'Native host is already running.');const begin=performance.now();
    const child=spawn(process.execPath,[join(this.options.dist,'src/desktop/native-host.js')],{cwd:REPO,env:{PATH:'',LANG:'C',TMPDIR:tmpdir(),NODE_ENV:'production'},stdio:['ignore','ignore','ignore','ipc']});this.child=child;
    await new Promise((done,fail)=>{const timer=setTimeout(()=>fail(new BenchmarkError('Native startup timed out.')),180000);child.on('error',()=>{clearTimeout(timer);fail(new BenchmarkError('Native host could not start.'));});child.on('exit',()=>{clearTimeout(timer);for(const value of this.pending.values())value.fail(new BenchmarkError('Native host exited during request.'));this.pending.clear();fail(new BenchmarkError('Native host exited before ready.'));});child.on('message',event=>{if(event?.type==='authority')this.authority=event.value;if(event?.type==='ready'){clearTimeout(timer);this.authority?done():fail(new BenchmarkError('Native local authority missing.'));}if(event?.type==='failed'){clearTimeout(timer);fail(new BenchmarkError('Native startup failed at '+String(event.stage??'unknown').replace(/[^a-z ]/gi,'').slice(0,60)));}if(event?.type==='result')this.pending.get(event.id)?.done(event.result);});child.send({type:'initialize',config:{root:this.profile,bundle:this.bundle,vault:this.vault}});});
    return round(performance.now()-begin);
  }
  async command(command){const id=randomUUID();return new Promise((done,fail)=>{const clean=callback=>value=>{clearTimeout(timer);this.pending.delete(id);callback(value);};const timer=setTimeout(()=>clean(fail)(new BenchmarkError('Native command timed out.')),30000);this.pending.set(id,{done:clean(result=>result?.ok?done(result.data):fail(new BenchmarkError('Native operation failed: '+command.operation))),fail:clean(fail)});this.child.send({type:'command',id,command});});}
  async api(path){requireThat(this.authority&&path.startsWith('/v1/'),'Invalid local request.');const response=await fetch(`http://127.0.0.1:${this.authority.port}${path}`,{signal:AbortSignal.timeout(30000),headers:{'x-orchestra-local-token':this.authority.token,Authorization:'Bearer '+this.authority.bearer}});return {status:response.status,body:await response.json()};}
  async sql(query,timeoutMs=120000){const pid=(await readFile(join(this.profile,'postgres/postmaster.pid'),'utf8')).split('\n'),port=Number(pid[3]);requireThat(Number.isInteger(port)&&port>1023&&port<65536,'Invalid synthetic PostgreSQL port.');return processOutput(join(this.bundle,'native/pgsql/bin/psql'),['-X','-w','-q','-h','127.0.0.1','-p',String(port),'-U','orchestra_admin','-d','orchestra','-v','ON_ERROR_STOP=1','-A','-t'],{env:{PGPASSWORD:this.vault.admin},input:query,timeoutMs});}
  async memory(){
    const raw=await processOutput('/bin/ps',['-axo','pid=,ppid=,rss=,comm=']);
    const rows=raw.trim().split('\n').map(line=>{const match=line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);return match?{pid:Number(match[1]),parent:Number(match[2]),rssKiB:Number(match[3]),name:match[4].split('/').at(-1)}:null;}).filter(Boolean);
    const pids=new Set([this.child.pid]);for(let changed=true;changed;){changed=false;for(const row of rows)if(pids.has(row.parent)&&!pids.has(row.pid)){pids.add(row.pid);changed=true;}}
    const owned=rows.filter(row=>pids.has(row.pid));return {nativeRssMiB:round((owned.find(row=>row.pid===this.child.pid)?.rssKiB??0)/1024),subtreeSummedRssMiB:round(owned.reduce((sum,row)=>sum+row.rssKiB,0)/1024),processCount:owned.length,systemFreeMiB:round(freemem()/1024**2),note:'Observed per-process RSS; subtree sum double-counts shared pages, not unique physical memory.'};
  }
  async stop(){
    const child=this.child;if(!child)return;let forced=false;
    if(child.exitCode===null&&child.signalCode===null)await new Promise((done,fail)=>{
      const deadline=setTimeout(()=>fail(new BenchmarkError('Owned native process failed to exit after hard shutdown.')),35000);
      const escalation=setTimeout(()=>{forced=true;child.kill('SIGKILL');},30000);
      child.once('exit',()=>{clearTimeout(deadline);clearTimeout(escalation);done();});
      child.connected?child.send({type:'shutdown'}):child.kill('SIGTERM');
    });
    this.child=null;this.authority=null;
    // The owned native watchdog shuts PostgreSQL down when its IPC parent exits.
    // Never signal a PID read from disk; require its normal ownership marker to clear.
    const until=performance.now()+20000;
    while(await access(join(this.profile,'postgres/postmaster.pid')).then(()=>true,()=>false)){
      requireThat(performance.now()<until,'Owned PostgreSQL shutdown did not clear its pid file.');await new Promise(done=>setTimeout(done,100));
    }
    requireThat(!forced,'Native shutdown required hard termination; timing qualification failed.');
  }
}

function seedSql(fixture,foreignOrgId){
  const {ownerId,foreignProjectId}=fixture;
  const sql=`BEGIN;
INSERT INTO organizations(id,name,slug,updated_at) VALUES (${quote(foreignOrgId)}::uuid,'Synthetic separate tenant','scale-foreign-tenant',now());
INSERT INTO projects(id,org_id,name,slug,status,created_by,updated_at) VALUES (${quote(foreignProjectId)}::uuid,${quote(foreignOrgId)}::uuid,'Synthetic private tenant corpus','scale-private-tenant','active',${quote(ownerId)}::uuid,now());
CREATE TEMP TABLE scale_documents ON COMMIT DROP AS SELECT * FROM jsonb_to_recordset(${quote(JSON.stringify(fixture.documents))}::jsonb) AS x(id uuid,projectid uuid,title text,versionid uuid,archived boolean,at timestamptz);
CREATE TEMP TABLE scale_versions ON COMMIT DROP AS SELECT * FROM jsonb_to_recordset(${quote(JSON.stringify(fixture.versions))}::jsonb) AS x(id uuid,documentid uuid,projectid uuid,revision int,at timestamptz,checksum text);
CREATE TEMP TABLE scale_chunks ON COMMIT DROP AS SELECT * FROM jsonb_to_recordset(${quote(JSON.stringify(fixture.chunks))}::jsonb) AS x(id uuid,sectionid uuid,documentid uuid,versionid uuid,projectid uuid,idx int,revision int,text text,at timestamptz,anchor text);
INSERT INTO documents(id,project_id,kind,title,current_version_id,uploaded_by,visibility,archived_at,created_at,updated_at) SELECT id,projectid,'reference',title,versionid,${quote(ownerId)}::uuid,'internal',CASE WHEN archived THEN at ELSE NULL END,at,at FROM scale_documents;
INSERT INTO document_versions(id,document_id,project_id,file_key,checksum_sha256,mime_type,file_size,status,parse_revision,parse_confidence,source_label,uploaded_by,created_at,processed_at) SELECT v.id,v.documentid,v.projectid,'synthetic-scale/'||v.id||'.txt',v.checksum,'text/plain',COALESCE((SELECT sum(octet_length(c.text)) FROM scale_chunks c WHERE c.versionid=v.id),0),'partial',v.revision,0.97,'Direct synthetic retrieval fixture',${quote(ownerId)}::uuid,v.at,v.at FROM scale_versions v;
INSERT INTO document_sections(id,document_version_id,project_id,parse_revision,section_key,heading_path,anchor_id,normalized_text,order_index,created_at) SELECT sectionid,versionid,projectid,revision,anchor,ARRAY['Operating detail '||(idx+1)],anchor,text,idx,at FROM scale_chunks;
INSERT INTO document_chunks(id,document_version_id,project_id,section_id,parse_revision,chunk_index,content,lexical_content,token_count,created_at) SELECT id,versionid,projectid,sectionid,revision,idx,text,text,CEIL(length(text)::numeric/4)::int,at FROM scale_chunks;
COMMIT;
ANALYZE documents; ANALYZE document_versions; ANALYZE document_sections; ANALYZE document_chunks;
`;
  requireThat(Buffer.byteLength(sql)<150*1024**2,'Synthetic fixture exceeds 150 MiB input bound.');return sql;
}

async function databaseState(host,projectId){return JSON.parse(await host.sql(`SELECT json_build_object('documents',(SELECT count(*) FROM documents WHERE project_id=${quote(projectId)}::uuid AND archived_at IS NULL),'currentChunks',(SELECT count(*) FROM document_chunks c JOIN document_versions v ON v.id=c.document_version_id JOIN documents d ON d.id=v.document_id WHERE c.project_id=${quote(projectId)}::uuid AND d.current_version_id=v.id AND c.parse_revision=v.parse_revision AND d.archived_at IS NULL),'totalChunks',(SELECT count(*) FROM document_chunks),'vectors',(SELECT count(*) FROM document_chunks WHERE embedding IS NOT NULL),'searchVectors',(SELECT json_build_object('present',count(lexical_search_vector),'equivalent',count(*) FILTER(WHERE lexical_search_vector=to_tsvector('english'::regconfig,lexical_content))) FROM document_chunks),'providerRequests',COALESCE((SELECT jsonb_array_length(data->'timestamps') FROM desktop_limit_state WHERE key='request:desktop:external-ai'),0),'databaseBytes',pg_database_size(current_database()),'pendingJobs',(SELECT count(*) FROM desktop_jobs WHERE status IN ('queued','running')));`));}
async function diskBytes(profile){return Number((await processOutput('/usr/bin/du',['-sk',profile])).trim().split(/\s+/)[0])*1024;}

async function ask(host,fixture,test){
  const started=performance.now();
  try{const response=await host.command({operation:'socrates.ask',projectId:fixture.projectId,requestId:randomUUID(),question:test.question,selectedSources:['documents']});const elapsed=performance.now()-started;return {name:test.name,question:test.question,totalMs:round(elapsed),instrumentedRetrievalMs:response.retrievalSummary?.performance?.retrievalMs??null,generationMs:response.retrievalSummary?.performance?.generationMs??null,answer:response.answer_md,citations:response.citations,openTargets:response.open_targets,sessionId:response.sessionId,messageId:response.messageId,modelMetadata:response.modelMetadata,retrievalSummary:response.retrievalSummary,...assessRetrieval(response,test,fixture)};}
  catch(error){return {name:test.name,question:test.question,totalMs:round(performance.now()-started),passed:false,error:error instanceof BenchmarkError?error.message:'Retrieval request failed; raw details withheld.'};}
}

export async function runScale(options){
  requireThat(process.platform==='darwin','Native scale qualification currently targets macOS only.');
  const identity=await buildIdentity(options.dist);await access(join(options.bundle,'native/pgsql/bin/initdb'));
  const directory=await mkdtemp('/private/tmp/orchestra-native-scale-'),profile=join(directory,'profile'),bundle=join(directory,'runtime');
  await mkdir(join(bundle,'backend/prisma'),{recursive:true,mode:0o700});await symlink(join(options.bundle,'native'),join(bundle,'native'));await symlink(options.dist,join(bundle,'backend/dist'));await symlink(join(REPO,'node_modules'),join(bundle,'backend/node_modules'));await cp(join(REPO,'prisma/schema.prisma'),join(bundle,'backend/prisma/schema.prisma'));await cp(join(REPO,'prisma/migrations'),join(bundle,'backend/prisma/migrations'),{recursive:true});
  const fresh=()=>randomBytes(32).toString('hex'),vault={version:1,admin:fresh(),runtime:fresh(),installation:{version:1,loopback:fresh(),access:fresh(),refresh:fresh(),connectorEncryption:fresh(),oauthState:fresh(),clientShare:fresh()}};
  const host=new ScaleHost(options,profile,bundle,vault),begin=performance.now();let timedOut=false;
  const report={version:2,dataset:'varied-operations-lexical-v1',oracleRevision:'v2-topical-precision-not-strict-document-count',startedAt:new Date().toISOString(),identity,options:{documents:options.documents,chunksPerDocument:options.chunksPerDocument,cycles:options.cycles,maxRuntimeMs:options.maxRuntimeMs},profile,hardware:{cpu:cpus()[0]?.model,logicalCores:cpus().length,ramBytes:totalmem(),os:release(),node:process.version},scope:'Actual offline native-host IPC, PostgreSQL FTS retrieval, auth and persistence against SQL-created synthetic document/section/chunk rows. Not upload/parse, embeddings, model quality, browser UI, true disk-cache cold or packaged release qualification.',definitions:{startup:'New native host and PostgreSQL processes to authority+ready; existing populated profile, OS caches untouched.',processCold:'First Socrates request immediately after each native relaunch, always the same ancient sparse-fact query.',warm:'Immediate repeated identical query in the same native process.',retrievalInstrumentation:'Product retrievalSummary.performance.retrievalMs; speculative retrieval begins earlier, so this is NOT total retrieval wall time.',requestTotal:'Before native IPC send through returned, persisted deterministic answer.',percentiles:'Nearest-rank empirical p50/p95; same machine, finite samples, no population/clean-machine claim.',memory:'Process RSS snapshots after cold/warm queries; observed maxima only, not peak allocation or unique shared-memory accounting.',sourceCounts:'Product sourceCounts.documents counts selected evidence items, not necessarily distinct documents. Returned citations are separately capped. Topical precision asserts actual relevant passages, not a strict one-document scope or mandatory multiple chunks.'},limits:{fixtureBytes:GIB,nativeStartupP95Ms:null,requestTotalP95Ms:null,instrumentedLocalRetrievalTargetMs:1000},checks:[],quality:[],samples:[],passed:false,releaseReady:false};
  const timer=setTimeout(()=>{timedOut=true;host.child?.kill('SIGKILL');},options.maxRuntimeMs);
  const checkpoint=()=>requireThat(!timedOut&&performance.now()-begin<options.maxRuntimeMs,'Overall benchmark runtime bound exceeded.');
  const check=(name,passed)=>report.checks.push({name,passed});
  let stage='fresh_native_provision';
  try{
    report.freshProvisionMs=await host.start();const bootstrap=await host.command({operation:'local.bootstrap'});requireThat(bootstrap.aiConfigured===false,'Offline native bootstrap unexpectedly has AI configured.');
    const project=await host.command({operation:'workspace.create',name:'Synthetic scale operations corpus'});requireThat(UUID.test(project.id)&&UUID.test(bootstrap.user.id),'Native fixture identities unavailable.');
    const fixture=buildScaleFixture(options,project.id,bootstrap.user.id,fixtureId('foreign-project')),foreignOrgId=fixtureId('foreign-organization');
    report.fixture={projectId:fixture.projectId,activeDocuments:fixture.activeDocuments,activeChunks:fixture.activeChunks,totalDocuments:fixture.documents.length,totalChunks:fixture.chunks.length,positions:fixture.positions,factChunks:fixture.factChunks,forbiddenChunkIds:fixture.forbidden,foreignProjectId:fixture.foreignProjectId,cases:fixture.cases,contentSha256:fixtureContentHash(fixture),profileRowsSha256:hash(JSON.stringify(fixture.chunks)),sourceBytes:fixture.chunks.reduce((sum,chunk)=>sum+Buffer.byteLength(chunk.text),0),setup:'Direct SQL fixture rows; physical source files are not created and parsing/download are not measured. Content hash excludes fresh project identity for cross-run comparability; profile row hash includes it.'};
    stage='seed_synthetic_corpus';checkpoint();const seedStarted=performance.now();await host.sql(seedSql(fixture,foreignOrgId));report.seedMs=round(performance.now()-seedStarted);
    report.afterSeed=await databaseState(host,project.id);report.profileBytes=await diskBytes(profile);requireThat(report.profileBytes<GIB,'Synthetic profile exceeded 1 GiB disk bound.');
    check('exact_active_corpus_counts',report.afterSeed.documents===fixture.activeDocuments&&report.afterSeed.currentChunks===fixture.activeChunks);check('zero_embeddings_and_provider_calls',report.afterSeed.vectors===0&&report.afterSeed.providerRequests===0);
    check('fresh_generated_vectors_equivalent',report.afterSeed.searchVectors.present===fixture.chunks.length&&report.afterSeed.searchVectors.equivalent===fixture.chunks.length);
    stage='quality_and_tenant_checks';
    for(const test of fixture.cases){checkpoint();const result=await ask(host,fixture,test);report.quality.push(result);console.log(JSON.stringify({phase:'quality',case:test.name,passed:result.passed,totalMs:result.totalMs,targetRecall:result.targetRecall,reportedDocuments:result.reportedDocumentCount,distinctCitedDocuments:result.actualDocumentIds?.length}));}
    const denied=await host.api(`/v1/projects/${fixture.foreignProjectId}/documents`);report.tenantApi={status:denied.status,code:denied.body?.error?.code??denied.body?.code??null};check('foreign_tenant_api_denied',denied.status===403&&report.tenantApi.code==='project_access_denied');
    let nativeDenied=false;try{await host.command({operation:'socrates.ask',projectId:fixture.foreignProjectId,requestId:randomUUID(),question:'What is the Nightorchid sealed routing code?',selectedSources:['documents']});}catch(error){nativeDenied=error instanceof BenchmarkError&&error.message==='Native operation failed: socrates.ask';}check('foreign_tenant_native_retrieval_denied',nativeDenied);
    stage='repeated_native_startup_and_retrieval';
    const primary=fixture.cases[0];await host.stop();
    for(let cycle=1;cycle<=options.cycles;cycle++){
      checkpoint();const startupMs=await host.start();const cold=await ask(host,fixture,primary);const warm=await ask(host,fixture,primary);const memory=await host.memory();
      report.samples.push({cycle,startupMs,cold,warm,memory});await host.stop();
      if(cycle%5===0||cycle===options.cycles)console.log(JSON.stringify({phase:'cycle',cycle,cycles:options.cycles,startupMs,coldMs:cold.totalMs,warmMs:warm.totalMs,passed:cold.passed&&warm.passed,nativeRssMiB:memory.nativeRssMiB}));
    }
    stage='final_persistence';await host.start();
    const last=report.samples.at(-1)?.warm;requireThat(UUID.test(last?.sessionId??'')&&UUID.test(last?.messageId??''),'Final answer persistence identity missing.');const history=await host.api(`/v1/projects/${fixture.projectId}/socrates/sessions/${last.sessionId}/messages`);check('last_answer_survives_another_restart',history.status===200&&history.body.data.some(message=>message.id===last.messageId&&message.content===last.answer&&message.responseStatus==='completed'));
    report.finalState=await databaseState(host,project.id);report.finalProfileBytes=await diskBytes(profile);check('disk_bound',report.finalProfileBytes<GIB);check('provider_requests_remain_zero',report.finalState.providerRequests===0);check('corpus_counts_preserved',report.finalState.currentChunks===fixture.activeChunks&&report.finalState.documents===fixture.activeDocuments);
    check('generated_vectors_remain_equivalent',report.finalState.searchVectors.present===fixture.chunks.length&&report.finalState.searchVectors.equivalent===fixture.chunks.length);
    const endingIdentity=await buildIdentity(options.dist);check('source_build_schema_unchanged',JSON.stringify(identity)===JSON.stringify(endingIdentity));
    report.summary={startup:summarize(report.samples.map(sample=>sample.startupMs)),coldRequestTotal:summarize(report.samples.map(sample=>sample.cold.totalMs)),warmRequestTotal:summarize(report.samples.map(sample=>sample.warm.totalMs)),coldInstrumentedRetrieval:summarize(report.samples.map(sample=>sample.cold.instrumentedRetrievalMs).filter(Number.isFinite)),warmInstrumentedRetrieval:summarize(report.samples.map(sample=>sample.warm.instrumentedRetrievalMs).filter(Number.isFinite)),observedMaxNativeRssMiB:Math.max(...report.samples.map(sample=>sample.memory.nativeRssMiB)),observedMaxSubtreeSummedRssMiB:Math.max(...report.samples.map(sample=>sample.memory.subtreeSummedRssMiB)),qualityPassed:report.quality.filter(result=>result.passed).length,qualityTotal:report.quality.length};
    check('cold_instrumented_retrieval_p95_target',report.summary.coldInstrumentedRetrieval.p95Ms!==null&&report.summary.coldInstrumentedRetrieval.p95Ms<=report.limits.instrumentedLocalRetrievalTargetMs);
    check('warm_instrumented_retrieval_p95_target',report.summary.warmInstrumentedRetrieval.p95Ms!==null&&report.summary.warmInstrumentedRetrieval.p95Ms<=report.limits.instrumentedLocalRetrievalTargetMs);
    report.passed=report.checks.every(check=>check.passed)&&report.quality.every(result=>result.passed)&&report.samples.length===options.cycles&&report.samples.every(sample=>sample.cold.passed&&sample.warm.passed);
  }catch(error){report.failure={stage,message:error instanceof BenchmarkError?error.message:'Scale benchmark failed; raw process/authority details withheld.'};}
  finally{clearTimeout(timer);try{await host.stop();}catch{report.passed=false;report.shutdownFailure=true;}report.elapsedMs=round(performance.now()-begin);report.completedAt=new Date().toISOString();await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({passed:report.passed,reportPath:join(directory,'report.json'),failure:report.failure??null,summary:report.summary??null}));}
  return report;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.includes('--help'))console.log('node scripts/desktop/benchmark-scale-native.mjs [--bundle /absolute/runtime] [--backend-dist /absolute/dist] [--documents 1000] [--chunks-per-document 10] [--cycles 30] [--max-runtime-ms 900000]. Always offline, fresh private profile, no credential file option. SQL retrieval fixtures, no OS cache deletion. Empirical p95 requires at least20cycles.');
  else try{const result=await runScale(parseScaleArgs(process.argv.slice(2)));if(!result.passed)process.exitCode=1;}catch(error){console.error(error instanceof BenchmarkError?error.message:'Scale benchmark preflight failed; raw details withheld.');process.exitCode=1;}
}
