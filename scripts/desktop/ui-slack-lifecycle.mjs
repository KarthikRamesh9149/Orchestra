// Dedicated synthetic-profile qualification. Never emits credential material.
import {_electron} from '../../apps/beta-web/node_modules/playwright/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=process.argv[2];assert(/^\/private\/tmp\/orchestra-step4-acceptance-[A-Za-z0-9]+$/.test(profile??''));
assert.equal(JSON.parse(await readFile(join(profile,'result.json'),'utf8')).profile,profile);
const packageRoot=(await readFile(join(resolve(import.meta.dirname,'../..'),'.desktop/latest-package.txt'),'utf8')).trim();
let app;const proof={packageRoot,passed:[]};
try{
 app=await _electron.launch({executablePath:join(packageRoot,'Orchestra Desktop Internal.app/Contents/MacOS/Orchestra Desktop Internal'),args:['--user-data-dir='+profile],env:{PATH:'',TMPDIR:process.env.TMPDIR??'',HOME:process.env.HOME},timeout:60000});
 const page=await app.firstWindow();await page.waitForURL('**/memory',{timeout:180000});
 assert.equal((await page.evaluate(()=>window.orchestra.slack.inspect())).data.teamId,'T0B782DU524');
 await app.evaluate(()=>{
  const original=globalThis.fetch;globalThis.__qualificationRefreshSummary=null;
  globalThis.fetch=async(input,options)=>{
   const response=await original(input,options);
   if(String(input)==='https://slack.com/api/oauth.v2.access'){
    const payload=await response.clone().json();
    const allowed=['ok','access_token','refresh_token','expires_in','scope','token_type','authed_user','team','error'];
    globalThis.__qualificationRefreshSummary={httpStatus:response.status,keys:allowed.filter(key=>key in payload),userKeys:allowed.filter(key=>payload.authed_user&&key in payload.authed_user),tokenType:['user','bot','bearer'].includes(payload.token_type)?payload.token_type:'other',scopeSeparator:typeof payload.scope==='string'?(payload.scope.includes(',')?'comma':payload.scope.includes(' ')?'space':'neither'):'not_string',scopeCount:typeof payload.scope==='string'?payload.scope.split(/[, ]+/).length:null,expiresType:typeof payload.expires_in,expiresValid:Number.isInteger(payload.expires_in)&&payload.expires_in>0&&payload.expires_in<=86400,error:['invalid_refresh_token','invalid_client_id','invalid_client_secret','invalid_grant','bad_client_secret','not_allowed_token_type'].includes(payload.error)?payload.error:payload.ok===false?'provider_rejected':null};
   }return response;
  };
 });
 // Advance only the dedicated profile's refresh scheduling timestamp, not the
 // system clock or remote token. The native handler must perform real rotation.
 await app.evaluate(async({app,safeStorage})=>{
  const fs=process.getBuiltinModule('fs/promises'),path=process.getBuiltinModule('path');
  const file=path.join(app.getPath('userData'),'local-runtime/provider-settings.enc');
  const state=JSON.parse(safeStorage.decryptString(await fs.readFile(file)));
  if(state.slack?.teamId!=='T0B782DU524')throw new Error('Wrong test workspace');
  globalThis.__qualificationPreviousSlackToken=state.slack.accessToken;
  state.slack.expiresAt=Date.now()-1000;
  const temporary=file+'.qualification';await fs.writeFile(temporary,safeStorage.encryptString(JSON.stringify(state)),{mode:0o600,flag:'wx'});await fs.rename(temporary,file);
 });
 const channels=await page.evaluate(()=>window.orchestra.slack.channels());proof.refreshSummary=await app.evaluate(()=>globalThis.__qualificationRefreshSummary);assert(channels.ok,JSON.stringify(proof.refreshSummary));assert(channels.data.some(value=>value.id==='C0C1344HCLV'));
 const rotated=await app.evaluate(async({app,safeStorage})=>{
  const fs=process.getBuiltinModule('fs/promises'),path=process.getBuiltinModule('path');
  const state=JSON.parse(safeStorage.decryptString(await fs.readFile(path.join(app.getPath('userData'),'local-runtime/provider-settings.enc'))));
  const changed=state.slack.accessToken!==globalThis.__qualificationPreviousSlackToken&&state.slack.expiresAt>Date.now();delete globalThis.__qualificationPreviousSlackToken;return changed;
 });assert(rotated);proof.passed.push('real Slack refresh rotates and durably saves the credential without renderer exposure');
 // Controlled native network failure, then restore the actual transport.
 await app.evaluate(()=>{globalThis.__qualificationFetch=globalThis.fetch;globalThis.fetch=(input,options)=>String(input).startsWith('https://slack.com/')?Promise.reject(new Error('Synthetic offline condition')):globalThis.__qualificationFetch(input,options);});
 const offline=await page.evaluate(()=>window.orchestra.slack.channels());assert.equal(offline.ok,false);proof.passed.push('offline channel lookup reports failure rather than empty success');
 await app.evaluate(()=>{globalThis.fetch=globalThis.__qualificationFetch;delete globalThis.__qualificationFetch;});
 assert((await page.evaluate(()=>window.orchestra.slack.channels())).ok);proof.passed.push('lookup recovers after restored connectivity');
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});});
 const revoked=await page.evaluate(()=>window.orchestra.slack.revoke());assert(revoked.ok);assert.equal((await page.evaluate(()=>window.orchestra.slack.inspect())).data.connected,false);
 assert.equal((await page.evaluate(()=>window.orchestra.slack.channels())).ok,false);proof.passed.push('dedicated desktop Slack authorization revoked; further imports denied');
 console.log(JSON.stringify(proof));
}catch(error){proof.failure=error.message;throw error;}
finally{await app?.close();await writeFile(join(profile,'step5-slack-lifecycle.json'),JSON.stringify(proof,null,2));}
