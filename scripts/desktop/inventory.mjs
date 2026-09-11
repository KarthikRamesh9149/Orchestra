import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// Structural inventory, not proof of runtime reachability or desktop completion.
const root=process.cwd();
function output(file, value){const content=JSON.stringify(value,null,2)+'\n';if(process.argv.includes('--check')){if(fs.readFileSync(file,'utf8')!==content)throw new Error(`Stale inventory: ${file}`);}else fs.writeFileSync(file,content);}
const files=[];
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(p.endsWith('.tsx')&&!p.includes('.test.'))files.push(p);}}
walk('apps/beta-web/src');
const actions=[];
for(const file of files.sort()){
 const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 function visit(node){
  if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node)){
   const tag=node.tagName.getText(source);
   const attrs=node.attributes.properties.filter(ts.isJsxAttribute);
   const handlers=attrs.filter(a=>/^(on[A-Z]|href|to)$/.test(a.name.getText(source))||/^on[A-Z]/.test(a.name.getText(source)));
   if(handlers.length||['button','input','select','textarea','form','a','Link','NavLink'].includes(tag)){
    const line=source.getLineAndCharacterOfPosition(node.getStart(source)).line+1;
    const sharedOnly=/LoginPage|WorkspacesPage|ClientWorkspacePage/.test(file);
    const ownerStep=/McpAgentSetup|DesktopMcpSetup|DesktopAiSettings|DesktopSources|DesktopSlackSettings/.test(file)?5:sharedOnly?6:4;
    const siblingTest=file.replace(/\.tsx$/,'.test.tsx');
    const label=attrs.find(a=>['aria-label','title','placeholder'].includes(a.name.getText(source)))?.initializer?.getText(source)
      || (ts.isJsxElement(node.parent)?node.parent.children.filter(ts.isJsxText).map(n=>n.text.trim()).filter(Boolean).join(' ').slice(0,160):'')
      || `${tag}: ${handlers.map(a=>a.name.getText(source)).join(', ')||'input control'}`;
    actions.push({id:`UI-${String(actions.length+1).padStart(4,'0')}`,source:file,line,component:tag,label,existingTestFile:fs.existsSync(siblingTest)?siblingTest:null,desktopTestId:`desktop-${path.basename(file,'.tsx')}-${line}`,bindings:handlers.map(a=>({property:a.name.getText(source),expression:a.initializer?.getText(source)||''})),mode:sharedOnly?'shared; local onboarding replacement in Step 4':'local and shared; remote mutations require server authority',owner:`Step ${ownerStep} implementer`,ownerStep,status:'planned-not-desktop-verified',acceptanceTest:`${file}:${line}: exercise ${label} in packaged UI in applicable modes; verify authorized success, validation/denial/network errors, keyboard access and cancellation; persisted effects survive restart. Link named automated test and evidence before completion.`});
   }
  }
  ts.forEachChild(node,visit);
 }
 visit(source);
}
const families=[
 ['shell','Navigation, themes, resizing, keyboard, recovery and local onboarding',4],
 ['identity','Shared sign-in, signup/invitation, password/profile/session and role management',6],
 ['dashboard','Refresh, metrics, subscriptions and source/activity links',4],
 ['chat','Multiple chats, deletion, drafts, first message, history, streaming across navigation, cancellation, feedback',4],
 ['memory','File upload/cancel/retry/remove/download, document/source viewer, provider-neutral search and context',4],
 ['timeline','Filter, manual event and proposal accept/reject with truthful provenance',4],
 ['truth','Inbox assignment, snooze/review, packets, impact map, authorized approval and Product Brain/Live Doc',4],
 ['delivery','Decision trace, receipt, context health, executive brief, advisory release truth, FDE and drift',4],
 ['research','Focus/source/privacy selection, durable progress, cancellation/recovery, save as evidence and download',4],
 ['agents','Preflight, exact pack retrieval, agent runs, Postflight and scoped MCP/VS Code access',5],
 ['settings','Appearance, workspace/account settings, sessions and truthful capabilities',4],
 ['connectors','GitHub, Google Drive, Slack: native authorization/bridge, selection, sync, sleep/offline catch-up, revoke',5],
 ['sources','Explicit local files/folders and Git repository ingestion with bounds/exclusions',5],
 ['ai','BYO external model setup, OS vault, usage limits, embedding identity/reindex, real claim-supported citations',5],
 ['sharing','Self-host install, compatibility, two-machine roles, cache expiry/revocation, export/import and backups',6],
 ['runtime','Bundled local engine, leases, crash recovery, parser/storage bounds and offline lexical retrieval',2],
 ['native','Packaged runtime, narrow IPC, authenticated loopback and single-instance ownership',3],
 ['release','Both platform performance/security/recovery/update/signing and independent public qualification',7]
].map(([id,scope,ownerStep])=>({id,scope,ownerStep,owner:`Step ${ownerStep} implementer`,modes:id==='identity'?['shared']:['local','shared'],status:'planned',acceptance:`Run ${scope} in the applicable clean packaged environment; record normal, failure and restart evidence. External provider/model tests require real authorized accounts; publication requires Step 8 approval.`}));
output('docs/desktop/feature-parity.json',{schemaVersion:1,sourceSha:'8561d41980e97924db33e0c8f748b7cf576aac83',coverage:'All JSX event bindings and native interactive elements in non-test frontend TSX, including currently hidden/legacy components. Source inventory is conservative, not runtime visibility proof. Family gates include backend/native workflows without JSX. Settings and agent controls require additional Step 5/6 gates as applicable.',families,actions});
const dependencies=[];
for(const lock of ['package-lock.json','apps/beta-web/package-lock.json','apps/vscode-extension/package-lock.json','apps/desktop/package-lock.json']){
 const data=JSON.parse(fs.readFileSync(lock,'utf8'));
 for(const [location,pkg] of Object.entries(data.packages||{}))if(location)dependencies.push({lock,location,version:pkg.version,license:pkg.license??'NOT RECORDED: inspect installed package license before distribution',integrity:pkg.integrity??null});
}
output('docs/desktop/dependency-license-inventory.json',{status:'metadata inventory only; not redistribution approval',dependencies});
console.log(JSON.stringify({uiSources:files.length,controls:actions.length,families:families.length,dependencyEntries:dependencies.length}));
