// Read-only, count/status-only diagnostics for the named synthetic profile.
import {_electron} from '../../apps/beta-web/node_modules/playwright/index.mjs';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=process.argv[2];assert(/^\/private\/tmp\/orchestra-step4-acceptance-[A-Za-z0-9]+$/.test(profile??''));
assert.equal(JSON.parse(await readFile(join(profile,'result.json'),'utf8')).profile,profile);
const packageRoot=(await readFile(join(resolve(import.meta.dirname,'../..'),'.desktop/latest-package.txt'),'utf8')).trim();let app;
try{
 app=await _electron.launch({executablePath:join(packageRoot,'Orchestra Desktop Internal.app/Contents/MacOS/Orchestra Desktop Internal'),args:['--user-data-dir='+profile],env:{PATH:'',TMPDIR:process.env.TMPDIR??'',HOME:process.env.HOME},timeout:60000});
 const page=await app.firstWindow();await page.waitForURL('**/memory',{timeout:180000});
 console.log(await app.evaluate(async({app,safeStorage})=>{
  const fs=process.getBuiltinModule('fs/promises'),path=process.getBuiltinModule('path'),cp=process.getBuiltinModule('child_process');
  const root=path.join(app.getPath('userData'),'local-runtime');
  const vault=JSON.parse(safeStorage.decryptString(await fs.readFile(path.join(root,'credentials.enc'))));
  const port=(await fs.readFile(path.join(root,'postgres','postmaster.pid'),'utf8')).split('\n')[3];
  const query="SELECT name,status,failure_code,attempts,max_attempts,count(*) FROM desktop_jobs WHERE name='index_communication_message' GROUP BY 1,2,3,4,5; SELECT count(*) AS slack_chunks FROM communication_message_chunks WHERE provider='slack'";
  return await new Promise((resolve,reject)=>{const child=cp.spawn(path.join(process.resourcesPath,'runtime/native/pgsql/bin/psql'),['-X','-w','-h','127.0.0.1','-p',port,'-U','orchestra_desktop_runtime','-d','orchestra','-A','-t','-c',query],{env:{PATH:'',PGPASSWORD:vault.runtime},stdio:['ignore','pipe','ignore']});let output='';child.stdout.on('data',chunk=>{output+=chunk;if(output.length>4096)child.kill();});child.on('error',()=>reject(new Error('Diagnostic failed')));child.on('exit',code=>code===0?resolve(output):reject(new Error('Diagnostic failed')));});
 }));
}finally{await app?.close();}
