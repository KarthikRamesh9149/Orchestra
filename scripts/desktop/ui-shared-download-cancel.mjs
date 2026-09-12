// Synthetic native cancellation; no system clipboard or production account used.
import {_electron} from '../../apps/beta-web/node_modules/playwright/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
const repo=resolve(import.meta.dirname,'../..'),profile=process.argv[2];
assert(profile?.startsWith('/private/tmp/orchestra-transfer-ui-'));
const packaged=(await readFile(join(repo,'.desktop/latest-package.txt'),'utf8')).trim();
const account=JSON.parse(await readFile(join(repo,'.desktop/self-host-v1-qualification/bootstrap-account.json'),'utf8'));assert.equal(account.email,'owner@qualification.invalid');
const app=await _electron.launch({executablePath:join(packaged,'Orchestra Desktop Internal.app/Contents/MacOS/Orchestra Desktop Internal'),args:['--user-data-dir='+profile],env:{HOME:process.env.HOME,PATH:'',TMPDIR:process.env.TMPDIR,NODE_EXTRA_CA_CERTS:join(repo,'.desktop/self-host-v1-qualification/tls-certificate.pem')},timeout:60000});
let page=await app.firstWindow();
try{
 await page.waitForURL('**/memory',{timeout:180000});await page.goto('orchestra://app/settings');
 const next=app.waitForEvent('window');await page.getByRole('button',{name:'Open Transfer qualification',exact:true}).click();page=await next;
 await page.getByLabel('Email',{exact:true}).fill(account.email);await page.getByLabel('Password',{exact:true}).fill(account.password);await page.getByRole('button',{name:'Open beta',exact:true}).click();
 await page.getByRole('heading',{name:'Choose a workspace'}).waitFor();
 await page.evaluate(async()=>{const workspaces=(await(await fetch('/v1/me/workspaces')).json()).data;const selected=workspaces.find(w=>w.name==='Synthetic transferred destination'||w.projectName==='Synthetic transferred destination');if(!selected)throw Error('Synthetic workspace absent');const r=await fetch('/v1/me/workspaces/switch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:selected.projectId})});if(!r.ok)throw Error('Switch failed');});
 await page.goto('orchestra://app/memory');await page.getByRole('button',{name:'Open actions for Transfer-Requirement',exact:true}).waitFor();
 await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/memory')&&w.getTitle());if(!window)throw Error('Shared window absent');globalThis.cancelledSharedDownload=false;window.webContents.session.once('will-download',(_event,item)=>{globalThis.cancelledSharedDownload=true;item.cancel();});});
 await page.getByRole('button',{name:'Open actions for Transfer-Requirement',exact:true}).click();await page.getByRole('button',{name:'Download original',exact:true}).click();
 await page.getByText('Download requested. Complete the save dialog to keep the file.').waitFor();
 for(let i=0;i<40&&!await app.evaluate(()=>globalThis.cancelledSharedDownload);i++)await new Promise(r=>setTimeout(r,100));
 assert(await app.evaluate(()=>globalThis.cancelledSharedDownload));assert.equal(await page.getByText('Original document downloaded.',{exact:true}).count(),0);
 await writeFile(join(profile,'download-cancel-evidence.json'),JSON.stringify({package:packaged,passed:['real authorized shared download reached native download handler','cancelled native download does not claim a saved file'],simulated:['native download cancellation'],productionTouched:false},null,2));
 console.log('PASS shared native download cancellation and truthful save status');
}catch(error){await page.screenshot({path:join(profile,'download-cancel-failure.png')}).catch(()=>{});throw error;}finally{await app.close();}
