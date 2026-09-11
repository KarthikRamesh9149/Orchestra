// Real Slack authorization. No tokens or OAuth callback URLs are logged.
import {_electron} from '../../apps/beta-web/node_modules/playwright/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const repo=resolve(import.meta.dirname,'../..');const profile=process.argv[2];
if(!/^\/private\/tmp\/orchestra-step4-acceptance-[A-Za-z0-9]+$/.test(profile??''))throw new Error('Synthetic profile required');
assert.equal(JSON.parse(await readFile(join(profile,'result.json'),'utf8')).profile,profile);
const packageRoot=(await readFile(join(repo,'.desktop/latest-package.txt'),'utf8')).trim();
const results={packageRoot,passed:[],errors:[]};
const launch=()=>_electron.launch({executablePath:join(packageRoot,'Orchestra Desktop Internal.app/Contents/MacOS/Orchestra Desktop Internal'),args:['--user-data-dir='+profile],env:{PATH:'',TMPDIR:process.env.TMPDIR??'',HOME:process.env.HOME},timeout:60000});
let app;
try{
 app=await launch();let page=await app.firstWindow();page.on('pageerror',()=>results.errors.push('Renderer error'));
 await page.waitForURL('**/memory',{timeout:180000});await page.goto('orchestra://app/settings');
 await page.getByRole('heading',{name:'Desktop Slack',exact:true}).waitFor({timeout:30000});
 // Native consent only. Real browser authorization and token exchange remain intact.
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});});
 const initial=await page.evaluate(()=>window.orchestra.slack.inspect());assert(initial.ok);
 if(!initial.data.connected){await page.getByRole('button',{name:'Connect desktop Slack',exact:true}).click();console.log('Waiting for real Slack consent in browser.');}
 await page.getByRole('button',{name:'Disconnect desktop Slack',exact:true}).waitFor({timeout:210000});
 const state=await page.evaluate(()=>window.orchestra.slack.inspect());assert.equal(state.data.teamId,'T0B782DU524');
 assert(!JSON.stringify(state).match(/accessToken|refreshToken|xoxe-|xoxp-/));results.passed.push('real Slack authorization; only public identity returned to renderer');
 await app.close();app=undefined;app=await launch();page=await app.firstWindow();await page.waitForURL('**/memory',{timeout:180000});
 const restored=await page.evaluate(()=>window.orchestra.slack.inspect());assert.equal(restored.data.teamId,'T0B782DU524');assert.equal(restored.data.connected,true);results.passed.push('OS-protected Slack credentials survive restart');
 assert.deepEqual(results.errors,[]);console.log('PASS real Slack authorization and restart; ingestion not yet tested');
}catch(error){results.failure='Slack qualification failed or timed out';throw new Error(results.failure);}
finally{if(app)await app.close().catch(()=>{});await writeFile(join(profile,'step5-slack-auth.json'),JSON.stringify(results,null,2));}
