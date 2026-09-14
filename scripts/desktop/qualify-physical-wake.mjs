// Requires a person at the Mac to wake it. Never synthesizes power events.
import {_electron,chromium} from '../../apps/beta-web/node_modules/playwright/index.mjs';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import assert from 'node:assert/strict';
assert(process.argv.includes('--person-ready'),'Explicit person-ready flag required');
const profile='/private/tmp/orchestra-step4-acceptance-UcXW1v';
assert.equal(JSON.parse(await readFile(join(profile,'result.json'),'utf8')).profile,profile);
const packageRoot=(await readFile('.desktop/latest-package.txt','utf8')).trim();
const root=await mkdtemp('/private/tmp/orchestra-step7-physical-wake-');
const proof={root,profile,packageRoot,passed:[],errors:[]};
const launch=()=>_electron.launch({executablePath:join(packageRoot,'Orchestra Desktop Internal.app/Contents/MacOS/Orchestra Desktop Internal'),args:['--user-data-dir='+profile],env:{PATH:'',HOME:process.env.HOME,TMPDIR:process.env.TMPDIR??''},timeout:60000});
let app=await launch(),reconnected;
try{
 let page=await app.firstWindow();page.on('pageerror',e=>proof.errors.push(e.message));
 await page.waitForURL('**/memory',{timeout:180000});
 await page.getByRole('button',{name:'Open actions for Desktop-Pilot-Requirements',exact:true}).waitFor();
 const boot=await page.evaluate(()=>window.orchestra.bootstrap());assert(boot.ok&&!boot.data.aiConfigured);
 await page.goto('orchestra://app/chat');
 const chat=page.getByRole('link',{name:'When is the desktop pilot launch date?',exact:true});await chat.click();
 await page.getByText(/21 October 2026/).first().waitFor();const chatUrl=page.url();
 let composer=page.getByPlaceholder('Ask Socrates anything about your project…');
 await composer.fill('Synthetic physical wake draft');
 const eventLog=join(root,'power-events.jsonl');
 await app.evaluate(({powerMonitor},file)=>{const fs=process.getBuiltinModule('fs');for(const event of ['suspend','resume'])powerMonitor.on(event,()=>fs.appendFileSync(file,JSON.stringify({event,at:Date.now()})+'\n',{mode:0o600}));},eventLog);
 proof.requestedAt=Date.now();await writeFile(join(root,'started.json'),JSON.stringify(proof),{mode:0o600});
 if(process.argv.includes('--manual'))console.log('Physical test armed: close the lid for 20 seconds, then open and unlock. No sleep command or power-setting change will be made.');
 else{
  console.log('Physical test armed. Mac sleeps in 8 seconds; wake and unlock it after about 20 seconds.');
  await new Promise(r=>setTimeout(r,8000));
  execFileSync('/usr/bin/pmset',['sleepnow'],{stdio:'pipe',timeout:10000});
 }
 const deadline=Date.now()+300000;let events=[];
 while(Date.now()<deadline){events=(await readFile(eventLog,'utf8').catch(()=>'' )).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));if(events.some(e=>e.event==='resume'))break;await new Promise(r=>setTimeout(r,1000));}
 proof.events=events;
 const suspended=events.find(e=>e.event==='suspend'),resumed=events.find(e=>e.event==='resume');
 assert(suspended&&resumed&&resumed.at>suspended.at,'Real suspend and resume must be observed');
 proof.sleepIntervalMs=resumed.at-suspended.at;
 assert(proof.sleepIntervalMs>=10000,'Sleep was too brief; do not count an immediate wake as qualification');
 // Physical sleep can disconnect the test transport without closing the app.
 // Reattach only to this owned synthetic application's existing debug port.
 const port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];
 reconnected=await chromium.connectOverCDP('http://127.0.0.1:'+port);
 page=reconnected.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('orchestra://app/'));
 assert(page,'The app window must survive sleep');
 composer=page.getByPlaceholder('Ask Socrates anything about your project…');
 assert.equal(await composer.inputValue(),'Synthetic physical wake draft');
 const status=await page.evaluate(()=>window.orchestra.status());assert.equal(status.state,'ready');
 await page.getByRole('button',{name:'Memory',exact:true}).click();await page.getByRole('button',{name:'Open actions for Desktop-Pilot-Requirements',exact:true}).waitFor();
 await page.goto(chatUrl);await page.getByText(/21 October 2026/).first().waitFor();
 await page.reload();await page.getByText(/21 October 2026/).first().waitFor();
 assert.equal(await composer.inputValue(),'Synthetic physical wake draft');
 assert.deepEqual(proof.errors,[]);
 proof.passed.push('Actual macOS suspend/resume observed without synthetic events');
 proof.passed.push('Owned runtime ready; source, cited transcript and draft survive wake, navigation and reload');
}catch(error){proof.failure=String(error).slice(0,1000);process.exitCode=1;}
finally{
 if(!reconnected){const port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];reconnected=await chromium.connectOverCDP('http://127.0.0.1:'+port).catch(()=>null);}
 const window=reconnected?.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('orchestra://app/'));if(window)await window.evaluate(()=>globalThis.close()).catch(()=>{});
 await reconnected?.close();await Promise.race([app.close().catch(()=>{}),new Promise(r=>setTimeout(r,3000))]);
 await writeFile(join(root,'report.json'),JSON.stringify(proof,null,2),{mode:0o600});console.log(JSON.stringify(proof));
}
