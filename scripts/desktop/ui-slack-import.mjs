import {_electron} from '../../apps/beta-web/node_modules/playwright/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const repo=resolve(import.meta.dirname,'../..'),profile=process.argv[2];
assert(/^\/private\/tmp\/orchestra-step4-acceptance-[A-Za-z0-9]+$/.test(profile??''));
assert.equal(JSON.parse(await readFile(join(profile,'result.json'),'utf8')).profile,profile);
const packageRoot=(await readFile(join(repo,'.desktop/latest-package.txt'),'utf8')).trim();
const evidence={packageRoot,passed:[]};let app;
try{
 app=await _electron.launch({executablePath:join(packageRoot,'Orchestra Desktop Internal.app/Contents/MacOS/Orchestra Desktop Internal'),args:['--user-data-dir='+profile],env:{PATH:'',TMPDIR:process.env.TMPDIR??'',HOME:process.env.HOME},timeout:60000});
 const page=await app.firstWindow();await page.waitForURL('**/memory',{timeout:180000});
 const boot=await page.evaluate(()=>window.orchestra.bootstrap());assert(boot.ok);const projectId=(boot.data.workspaces.find(w=>w.current)??boot.data.workspaces[0]).projectId;
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});});
 await page.goto('orchestra://app/settings');await page.getByRole('button',{name:'List public channels',exact:true}).click();
 await page.getByRole('option',{name:'#orchestra-desktop-qualification',exact:true}).waitFor({state:'attached',timeout:30000});
 await page.getByLabel('Channel to import').selectOption('C0C1344HCLV');
 await page.getByRole('button',{name:'Import selected Slack channel',exact:true}).click();
 await Promise.race([page.getByText(/Slack messages saved as evidence/).waitFor({timeout:90000}),page.getByRole('alert').filter({hasText:/Slack import/}).waitFor({timeout:90000}).then(()=>{throw new Error('Native Slack import rejected');})]);evidence.passed.push('explicit channel UI imports real synthetic Slack messages and replies');
 const repeated=await page.evaluate(input=>window.orchestra.slack.importChannel(input),{projectId,channelId:'C0C1344HCLV'});assert(repeated.ok,JSON.stringify(repeated));
 evidence.reimport=repeated.data;
 assert.equal(repeated.data.result.createdMessageCount,0);assert.equal(repeated.data.result.updatedRevisionCount,0);
 await page.reload();
 const threads=await page.evaluate(async id=>{const response=await fetch(`/v1/projects/${id}/threads?provider=slack`);if(!response.ok)throw new Error('Thread read failed');return response.json();},projectId);
 const serialized=JSON.stringify(threads);assert(serialized.includes('slack'));assert(serialized.includes('C0C1344HCLV'));
 evidence.passed.push('Slack provenance remains readable from the authorized backend after reload');
 console.log(JSON.stringify(evidence));
}catch(error){evidence.failure=error.message;throw error;}finally{await app?.close();await writeFile(join(profile,'step5-slack-import.json'),JSON.stringify(evidence,null,2));}
