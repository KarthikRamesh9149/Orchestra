import {_electron} from '../../apps/beta-web/node_modules/playwright/index.mjs';
import {readFile,writeFile,mkdtemp,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=process.argv[2];assert(/^\/private\/tmp\/orchestra-step4-acceptance-[A-Za-z0-9]+$/.test(profile??''));
assert.equal(JSON.parse(await readFile(join(profile,'result.json'),'utf8')).profile,profile);
const repo=resolve(import.meta.dirname,'../..'),root=(await readFile(join(repo,'.desktop/latest-package.txt'),'utf8')).trim();
assert(root.startsWith(join(repo,'.desktop/packages/')));
const executable=join(root,'Orchestra Desktop Internal.app/Contents/MacOS/Orchestra Desktop Internal');
let app,page,pairing,client;const proof={packageRoot:root};
try{
 app=await _electron.launch({executablePath:executable,args:['--user-data-dir='+profile],env:{PATH:'',TMPDIR:process.env.TMPDIR??'',HOME:process.env.HOME},timeout:60000});
 page=await app.firstWindow();await page.waitForURL('**/memory',{timeout:180000});
 const boot=await page.evaluate(()=>window.orchestra.bootstrap());assert(boot.ok);
 const projectId=(boot.data.workspaces.find(w=>w.current)??boot.data.workspaces[0]).projectId;
 const pack=await page.evaluate(async projectId=>{const r=await fetch(`/v1/projects/${projectId}/delivery/agent-preflight`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({taskPrompt:'Read-only synthetic desktop MCP qualification. Do not implement or approve changes.',targetAgent:'codex',budgetPreset:'compact'})});if(!r.ok)throw new Error('Preflight rejected');return (await r.json()).data.contextPack;},projectId);
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});});
 const paired=await page.evaluate(input=>window.orchestra.mcp.pair(input),{projectId,packId:pack.id,client:'vscode'});assert(paired.ok);pairing=paired.data;
 const folder=await mkdtemp(join(profile,'vscode-qualification-'));await mkdir(join(folder,'.vscode'));
 await writeFile(join(folder,'.vscode','mcp.json'),pairing.setup,{mode:0o600});
 await writeFile(join(folder,'qualification.json'),JSON.stringify({projectId,packId:pack.id}),{mode:0o600});
 const userData=await mkdtemp(join(profile,'vscode-profile-'));
 const fixture=join(repo,'scripts/desktop/vscode-qualification');
 client=await _electron.launch({executablePath:'/Applications/Visual Studio Code.app/Contents/MacOS/Code',args:['--user-data-dir='+userData,'--extensions-dir='+join(userData,'extensions'),'--extensionDevelopmentPath='+fixture,'--extensionTestsPath='+join(fixture,'run.cjs'),'--skip-welcome','--skip-release-notes',folder],timeout:60000});
 console.log('VS Code qualification opened. Start only the scoped Orchestra MCP server in this disposable workspace.');
 proof.workspace=folder;
 const codePage=await client.firstWindow();
 // Scope UI interaction to this newly launched disposable client, never the
 // user's ordinary VS Code window. Normal MCP trust remains enabled.
 await codePage.waitForLoadState('domcontentloaded');
 await codePage.waitForFunction(()=>document.body.innerText.length>40,{},{timeout:30000});
 if((await codePage.locator('body').innerText()).includes('Restricted Mode is intended'))await codePage.getByRole('button',{name:'Manage',exact:true}).click();
 proof.initialUi=(await codePage.locator('body').innerText()).slice(-6000);
 await writeFile(join(folder,'ui-state.json'),JSON.stringify({text:proof.initialUi}),{mode:0o600});
 const deadline=Date.now()+170000;
 while(Date.now()<deadline&&client.process().exitCode===null){
  if((await codePage.locator('body').innerText().catch(()=>'')).includes('Restricted Mode is intended')){
   const manage=codePage.getByRole('button',{name:'Manage',exact:true});if(await manage.count()===1)await manage.click();
  }
  await writeFile(join(folder,'ui-state.json'),JSON.stringify({text:(await codePage.locator('body').innerText().catch(()=>'')).slice(-9000)}),{mode:0o600});
  for(const label of ['Yes, I trust the authors','Trust']){
   const button=codePage.getByRole('button',{name:label,exact:true});
   if(await button.count().catch(()=>0)===1&&await button.isVisible().catch(()=>false))await button.click().catch(()=>{});
  }
  try{proof.result=JSON.parse(await readFile(join(folder,'result.json'),'utf8'));break;}catch{}
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 const code=client.process().exitCode??(proof.result&&!proof.result.failure?0:1);
 proof.result=JSON.parse(await readFile(join(folder,'result.json'),'utf8'));assert.equal(code,0);assert(!proof.result.failure);console.log(JSON.stringify(proof));
}catch(error){proof.failure=String(error.message).slice(0,300);process.exitCode=1;console.error(proof.failure);}
finally{await client?.close().catch(()=>{});if(pairing&&page)await page.evaluate(id=>window.orchestra.mcp.revoke(id),pairing.id).catch(()=>{});await app?.close();delete proof.initialUi;await writeFile(join(profile,'step5-vscode.json'),JSON.stringify(proof,null,2),{mode:0o600});}
