// Populated local acceptance, through real packaged APIs and UI. No SQL seed,
// model mocks, credentials, provider accounts or production data.
import {_electron} from '../../apps/beta-web/node_modules/playwright/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=process.argv[2];
if(!/^\/private\/tmp\/orchestra-step4-acceptance-[A-Za-z0-9]+$/.test(profile??''))throw new Error('Synthetic smoke profile required');
assert.equal(JSON.parse(await readFile(join(profile,'result.json'),'utf8')).profile,profile);
const packageRoot=(await readFile(join(resolve(import.meta.dirname,'../..'),'.desktop/latest-package.txt'),'utf8')).trim();
const launch=()=>_electron.launch({executablePath:join(packageRoot,'Orchestra Desktop Internal.app/Contents/MacOS/Orchestra Desktop Internal'),args:['--user-data-dir='+profile],env:{PATH:'',TMPDIR:process.env.TMPDIR??'',HOME:process.env.HOME},timeout:60000});
let app=await launch(),page=await app.firstWindow();
const results={packageRoot,profile,passed:[],errors:[]};
const record=name=>{results.passed.push(name);console.log('PASS',name);};
const observe=()=>{page.setDefaultTimeout(15000);page.on('pageerror',e=>results.errors.push(e.message));};observe();
const api=(path,method='GET',body)=>page.evaluate(async({path,method,body})=>{const response=await fetch(path,{method,headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,json:await response.json()};},{path,method,body});
const data=async(path,method,body)=>{const result=await api(path,method,body);assert(result.status<400,JSON.stringify(result));return result.json.data;};
const wait=async(fn,description)=>{for(let n=0;n<100;n++){if(await fn())return;await new Promise(r=>setTimeout(r,300));}throw new Error(description);};
try {
 await page.waitForURL('**/memory',{timeout:180000});
 const bootstrap=await page.evaluate(async()=>{const result=await window.orchestra.bootstrap();if(!result.ok)throw new Error(result.error.message);return result.data;});const project=bootstrap.workspaces.find(w=>w.current)?.projectId??bootstrap.workspaces[0].projectId;
 const base=`/v1/projects/${project}`;
 let brain;await wait(async()=>{brain=await data(base+'/brain/current');return !!brain.currentBrain;},'Deterministic Product Brain never materialized');
 const graph=await data(base+'/brain/graph/current');assert(graph.nodes.length>0);assert(graph.sectionLinks.length>0);
 record('offline source projections create real Product Brain and linked graph without a model');
 const node=graph.nodes.find(n=>graph.sectionLinks.some(l=>l.brainNodeId===n.id));const section=graph.sectionLinks.find(l=>l.brainNodeId===node.id);
 const stamp=Date.now();const cases=[
   {title:'Require three reviewers for pilot launch',before:'The pilot checklist names one reviewer.',requested:'Local launch approval requires exactly three reviewers.'},
   {title:'Remove the pilot sign-off',before:'The release checklist requires a sign-off.',requested:'Remove the final sign-off from the pilot checklist.'},
   {title:'Move the handoff to Friday',before:'Engineering hands off the pilot on Thursday.',requested:'Engineering should hand off the pilot on Friday.'}
 ]; const titles=cases.map(c=>c.title);
 const proposals=[];
 for(const change of cases)proposals.push(await data(base+'/change-proposals','POST',{title:change.title,summary:change.requested,proposalType:'requirement_change',oldUnderstanding:{text:change.before},newUnderstanding:{text:change.requested},affectedDocumentSectionIds:[section.documentSectionId],affectedBrainNodeIds:[node.id],communicationMessageIds:[],externalEvidenceRefs:['synthetic-local-acceptance:'+stamp]}));
 await page.goto('orchestra://app/truth-inbox');await page.getByRole('heading',{name:titles[0],exact:true}).waitFor();
 const card=title=>page.locator('article').filter({has:page.getByRole('heading',{name:title,exact:true})});
 const reveal=async title=>{const disclosure=card(title).locator('details.desk-row-more');await disclosure.waitFor();if(await disclosure.getAttribute('open')===null)await disclosure.locator(':scope > summary').click();};
 const filters=async()=>{const toggle=page.getByRole('button',{name:/^Filter/});if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();};
 await page.screenshot({path:join(profile,'truth-inbox.png'),animations:'disabled'});
 await reveal(titles[0]);
 const assigned=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/truth-inbox/')&&r.status()===200);await page.getByLabel('Owner for '+titles[0],{exact:true}).selectOption(bootstrap.user.id);await assigned;await page.reload();await reveal(titles[0]);await page.getByLabel('Owner for '+titles[0],{exact:true}).waitFor();assert.equal(await page.getByLabel('Owner for '+titles[0],{exact:true}).inputValue(),bootstrap.user.id);record('Inbox assignment persists');
 await reveal(titles[2]);await card(titles[2]).getByRole('button',{name:'Snooze',exact:true}).click();await page.getByRole('group',{name:'snooze confirmation'}).getByRole('button',{name:'Confirm',exact:true}).click();await card(titles[2]).waitFor({state:'hidden'});await filters();await page.getByLabel('Status',{exact:true}).selectOption('snoozed');await card(titles[2]).waitFor();await page.reload();await filters();await page.getByLabel('Status',{exact:true}).selectOption('snoozed');await card(titles[2]).waitFor();record('snooze persists and remains discoverable');
 await page.getByLabel('Status',{exact:true}).selectOption('');await reveal(titles[1]);await card(titles[1]).getByRole('button',{name:'Reject change',exact:true}).click();await page.getByRole('group',{name:'reject confirmation'}).getByRole('button',{name:'Confirm',exact:true}).click();await card(titles[1]).waitFor({state:'hidden'});assert.equal((await data(base+'/change-proposals/'+proposals[1].id)).status,'rejected');record('reject is authoritative and does not become accepted truth');
 await card(titles[0]).getByRole('link',{name:'Review change'}).click();await page.waitForURL('**/truth-inbox/*');await page.locator('#packet-heading').waitFor();assert(/impact/i.test(await page.locator('body').innerText()));await page.getByRole('button',{name:'Accept change',exact:true}).click();
 await page.getByRole('button',{name:'Confirm',exact:true}).click();await page.getByRole('group',{name:'Packet status'}).getByText('Accepted',{exact:true}).waitFor();
 await wait(async()=>!!(await data(base+'/change-proposals/'+proposals[0].id)).acceptedBrainVersionId,'Accepted change did not reach Product Brain');
 brain=await data(base+'/brain/current');assert(JSON.stringify(brain).includes(proposals[0].id));assert(JSON.stringify(brain).includes('three reviewers'));const liveDoc=await data(base+'/live-doc/current');assert(JSON.stringify(liveDoc).includes('three reviewers'));
 record('packet acceptance updates Product Brain and Live Doc through the durable offline worker');
 const packetUrl='orchestra://app/truth-inbox/'+encodeURIComponent('proposal:'+proposals[0].id);
 await page.goto(packetUrl);await page.getByRole('heading',{name:titles[0],exact:true}).waitFor();await page.getByText('Decision-to-delivery trace & receipt',{exact:true}).click();assert(await page.getByRole('button',{name:'Issue receipt',exact:true}).isDisabled());record('delivery trace does not certify missing implementation evidence');
 await page.getByText('Decision-to-delivery trace & receipt',{exact:true}).click();
 await page.screenshot({path:join(profile,'truth-packet.png'),animations:'disabled'});
 await page.goto('orchestra://app/memory');await page.getByRole('button',{name:/Require three reviewers for pilot launch/}).click();
 await page.getByText('Accepted change',{exact:true}).waitFor();assert((await page.locator('.branch-wording').innerText()).includes('three reviewers'));
 await page.screenshot({path:join(profile,'memory-branches.png'),animations:'disabled'});
 const search=page.getByRole('textbox',{name:'Find a topic, source or person'});await search.fill('Desktop-Pilot-Requirements');
 const passage=page.getByRole('link',{name:'Open passage'});await passage.waitFor();const href=await passage.getAttribute('href');const target=new URL(href,'orchestra://app');
 assert(target.searchParams.get('versionId'));assert(target.hash.length>1);await passage.focus();await page.keyboard.press('Enter');await page.waitForURL(url=>url.pathname===target.pathname&&url.hash===target.hash);
 await page.getByText('Viewing the cited revision.').waitFor();await page.locator('[id]').filter({hasText:'The pilot launch date is 21 October 2026.'}).first().waitFor();
 record('Memory branches show the saved decision and a keyboard-opened, version-pinned document passage');
 await page.goto('orchestra://app/truth-inbox');await page.getByRole('button',{name:/Resolved/}).click();await card(titles[0]).waitFor();
 assert((await card(titles[0]).innerText()).includes('three reviewers'));
 await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].setContentSize(1000,740);});
 await page.screenshot({path:join(profile,'inbox-compact.png'),animations:'disabled'});
 assert(await page.evaluate(()=> {const pane=document.querySelector('.desk-scroll');return pane && pane.scrollWidth<=pane.clientWidth+1;}));
 await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].setContentSize(1320,860);});
 record('resolved queue stays readable at a compact desktop width');
 await page.getByRole('button',{name:'Theme: DARK',exact:true}).click();
 await page.getByRole('button',{name:'Theme: AUTO',exact:true}).click();
 await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
 await page.reload();await page.getByRole('button',{name:'Theme: LIGHT',exact:true}).waitFor();
 assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
 await page.screenshot({path:join(profile,'inbox-light.png'),animations:'disabled'});
 await page.getByRole('button',{name:'Theme: LIGHT',exact:true}).click();
 await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
 record('explicit light and dark preferences work in the native window and persist on reload');
 await page.goto('orchestra://app/chat');await page.getByRole('link',{name:'When is the desktop pilot launch date?',exact:true}).click();await page.getByRole('button',{name:'Mark answer helpful'}).first().click();await page.getByText('Feedback saved',{exact:false}).first().waitFor();await page.reload();await page.getByRole('button',{name:'Mark answer helpful',pressed:true}).first().waitFor();record('Socrates feedback persists');await page.screenshot({path:join(profile,'socrates-answer.png'),animations:'disabled'});
 await page.goto('orchestra://app/delivery');await page.getByPlaceholder('Describe the exact task the agent should implement…').fill('Review local launch approval and the three reviewer acceptance requirement.');
 const built=page.waitForResponse(r=>r.url().endsWith('/delivery/agent-preflight')&&r.request().method()==='POST');await page.getByRole('button',{name:'Build preflight',exact:true}).click();const preflight=(await (await built).json()).data;assert(preflight.contextPack.id);await page.getByText('Pack ID: '+preflight.contextPack.id,{exact:true}).waitFor();
 await app.evaluate(({clipboard})=>{clipboard.writeText=text=>{globalThis.__syntheticClipboard=text;};});await page.getByRole('button',{name:'Copy for Codex',exact:true}).click();await page.getByText('Exact Codex context pack copied.',{exact:true}).waitFor();assert((await app.evaluate(()=>globalThis.__syntheticClipboard)).includes(preflight.contextPack.id));record('Preflight copy reaches the native clipboard sink with the exact pack ID (sink substituted to preserve user clipboard)');
 const packPath=join(profile,'preflight.md');await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},packPath);await page.getByRole('button',{name:'Download Markdown',exact:true}).click();await wait(async()=>{try{return (await readFile(packPath,'utf8')).includes(preflight.contextPack.id);}catch{return false;}},'Native pack save missing');const stored=await data(base+'/agent-context-packs/'+preflight.contextPack.id);assert((await readFile(packPath,'utf8')).includes(stored.bodyMarkdown));record('native Preflight export matches the authoritative persisted pack');
 const run=await data(base+'/agent-runs','POST',{contextPackId:preflight.contextPack.id,taskTitle:'Synthetic local manual review '+stamp,taskType:'review',status:'completed',outputSummary:'Synthetic acceptance fixture only. No external agent executed.',filesChanged:['docs/synthetic.md'],testsRun:[],testStatus:'not_run',limitations:['Synthetic local fixture; no actual implementation or deployment.']});
 await page.reload();await page.getByRole('button',{name:'Refresh',exact:true}).click();const runCard=page.locator('article').filter({has:page.getByText('Synthetic local manual review '+stamp,{exact:true})});await runCard.getByRole('button',{name:'Run postflight',exact:true}).click();await runCard.getByRole('button',{name:'Refresh review',exact:true}).waitFor();await page.reload();await runCard.getByRole('button',{name:'Refresh review',exact:true}).waitFor();assert.equal((await data(base+'/agent-runs/'+run.id)).contextPackId,preflight.contextPack.id);record('deterministic Postflight persists and retains exact context-pack lineage without accepting agent output as truth');
 await app.close();app=await launch();page=await app.firstWindow();observe();await page.waitForURL('**/memory',{timeout:180000});
 await page.goto(packetUrl);await page.getByRole('heading',{name:titles[0],exact:true}).waitFor();const accepted=await data(base+'/change-proposals/'+proposals[0].id);assert.equal(accepted.status,'accepted');assert(accepted.acceptedBrainVersionId);assert(JSON.stringify(await data(base+'/live-doc/current')).includes('three reviewers'));record('accepted truth and Live Doc survive full application restart');
 assert.deepEqual(results.errors,[]);
} catch(error){results.failure=String(error);console.log('FAIL',String(error),await page.locator('body').innerText());await page.screenshot({path:join(profile,'truth-failure.png')});throw error;}
finally {await writeFile(join(profile,'truth.json'),JSON.stringify(results,null,2));await app.close();}
