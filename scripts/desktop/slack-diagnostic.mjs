// Read-only, secret-redacted diagnostic for the explicitly approved synthetic profile.
import {_electron} from '../../apps/beta-web/node_modules/playwright/index.mjs';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=process.argv[2];assert(/^\/private\/tmp\/orchestra-step4-acceptance-[A-Za-z0-9]+$/.test(profile??''));
assert.equal(JSON.parse(await readFile(join(profile,'result.json'),'utf8')).profile,profile);
const root=(await readFile(join(resolve(import.meta.dirname,'../..'),'.desktop/latest-package.txt'),'utf8')).trim();
let app;
try {
 app=await _electron.launch({executablePath:join(root,'Orchestra Desktop Internal.app/Contents/MacOS/Orchestra Desktop Internal'),args:['--user-data-dir='+profile],env:{PATH:'',TMPDIR:process.env.TMPDIR??'',HOME:process.env.HOME},timeout:60000});
 const page=await app.firstWindow();await page.waitForURL('**/memory',{timeout:180000});
 console.log(JSON.stringify(await app.evaluate(async({app,safeStorage})=>{
  const fs=process.getBuiltinModule('fs/promises'),path=process.getBuiltinModule('path');
  const state=JSON.parse(safeStorage.decryptString(await fs.readFile(path.join(app.getPath('userData'),'local-runtime/provider-settings.enc'))));
  if(state.slack?.teamId!=='T0B782DU524')throw new Error('Wrong synthetic workspace');
  const result={expired:state.slack.expiresAt<Date.now(),scopes:state.slack.scopes,checks:[]};
  for(const method of ['auth.test','conversations.list']){
   const response=await fetch('https://slack.com/api/'+method,{method:'POST',headers:{authorization:'Bearer '+state.slack.accessToken,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(method==='auth.test'?{}:{types:'public_channel',limit:'1',exclude_archived:'true'}),redirect:'error',signal:AbortSignal.timeout(15000)});
   const body=await response.json();
   const scopes=response.headers.get('x-oauth-scopes');
   result.checks.push({method,status:response.status,ok:body.ok===true,grantedScopes:scopes&&/^[a-z_:, -]{1,500}$/.test(scopes)?scopes:null,error:['token_expired','token_revoked','invalid_auth','missing_scope','not_allowed_token_type'].includes(body.error)?body.error:body.ok===true?null:'provider_rejected',channelShape:body.channels?.slice(0,1).map(c=>Object.fromEntries(['id','name','is_private','is_archived','is_member'].map(k=>[k,typeof c[k]])))});
  }return result;
 })));
}finally{await app?.close();}
