// Explicit test-only allowance adjustment. Never clears usage or reads a hosted
// secret. The caller supplies the bounded ceiling; all calls remain accounted.
import {_electron} from '../../apps/beta-web/node_modules/playwright/index.mjs';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=process.argv[2],limit=Number(process.argv[3]);assert(/^\/private\/tmp\/orchestra-step4-acceptance-[A-Za-z0-9]+$/.test(profile??''));assert([20,24].includes(limit));
assert.equal(JSON.parse(await readFile(join(profile,'result.json'),'utf8')).profile,profile);
const root=(await readFile(join(resolve(import.meta.dirname,'../..'),'.desktop/latest-package.txt'),'utf8')).trim();
let app;
try{
 app=await _electron.launch({executablePath:join(root,'Orchestra Desktop Internal.app/Contents/MacOS/Orchestra Desktop Internal'),args:['--user-data-dir='+profile],env:{PATH:'',TMPDIR:process.env.TMPDIR??'',HOME:process.env.HOME},timeout:60000});
 const page=await app.firstWindow();await page.waitForURL('**/memory',{timeout:180000});
 await app.evaluate(async({app,safeStorage},limit)=>{
  const fs=process.getBuiltinModule('fs/promises'),path=process.getBuiltinModule('path'),file=path.join(app.getPath('userData'),'local-runtime/provider-settings.enc');
  const state=JSON.parse(safeStorage.decryptString(await fs.readFile(file)));if(!state.ai||![20,24].includes(state.ai.preferences.maxRequestsPerDay))throw new Error('Unexpected qualification allowance');
  state.ai.preferences.maxRequestsPerDay=limit;const temporary=file+'.qualification';await fs.writeFile(temporary,safeStorage.encryptString(JSON.stringify(state)),{mode:0o600,flag:'wx'});await fs.rename(temporary,file);
 },limit);
 console.log(JSON.stringify({qualificationCeiling:limit,usageReset:false,modelChanged:false,outputLimitChanged:false}));
}finally{await app?.close();}
