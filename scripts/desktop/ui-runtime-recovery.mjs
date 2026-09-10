// Kill only the verified direct runtime child of our synthetic packaged app.
import {_electron} from '../../apps/beta-web/node_modules/playwright/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=process.argv[2];
if(!/^\/private\/tmp\/orchestra-step4-acceptance-[A-Za-z0-9]+$/.test(profile??''))throw new Error('Synthetic profile required');
assert.equal(JSON.parse(await readFile(join(profile,'result.json'),'utf8')).profile,profile);
const packageRoot=(await readFile(join(resolve(import.meta.dirname,'../..'),'.desktop/latest-package.txt'),'utf8')).trim();
const launch=()=>_electron.launch({executablePath:join(packageRoot,'Orchestra Desktop Internal.app/Contents/MacOS/Orchestra Desktop Internal'),args:['--user-data-dir='+profile],env:{PATH:'',HOME:process.env.HOME,TMPDIR:process.env.TMPDIR??''},timeout:60000});
let app=await launch(),page=await app.firstWindow();
const result={packageRoot,profile,passed:[]};
try{
 await page.waitForURL('**/memory',{timeout:180000});
 await page.getByRole('button',{name:'Open actions for Desktop-Pilot-Requirements',exact:true}).waitFor();
 const rows=execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).split('\n').map(row=>row.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/)).filter(Boolean);
 const targets=rows.filter(row=>Number(row[2])===app.process().pid&&row[3].includes(packageRoot)&&row[3].endsWith('/backend/dist/src/desktop/native-host.js'));
 assert.equal(targets.length,1,'Exactly one owned native runtime must be identified');
 process.kill(Number(targets[0][1]),'SIGKILL');
 await page.waitForFunction(async()=>(await window.orchestra.status()).state==='failed');
 await page.reload();await page.getByText(/Local runtime stopped/).waitFor({timeout:30000});
 result.passed.push('actual runtime SIGKILL becomes an explicit recovery error, not an endless loading screen');
 await app.close();app=await launch();page=await app.firstWindow();await page.waitForURL('**/memory',{timeout:180000});
 await page.getByRole('button',{name:'Open actions for Desktop-Pilot-Requirements',exact:true}).waitFor();
 await page.goto('orchestra://app/chat');const originalChat=page.getByRole('link',{name:'When is the desktop pilot launch date?',exact:true});const href=await originalChat.getAttribute('href');await originalChat.click();await page.waitForURL(url=>url.pathname===href);await page.getByText(/21 October 2026/).first().waitFor();
 result.passed.push('relaunch recovers the owned runtime and preserves original source and cited transcript');
}catch(error){result.failure=String(error);throw error;}
finally{await writeFile(join(profile,'runtime-recovery.json'),JSON.stringify(result,null,2));await app.close();console.log(JSON.stringify(result));}
