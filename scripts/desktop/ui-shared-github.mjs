// Real dedicated server and packaged native transport; synthetic fixture only.
import {_electron} from '../../apps/beta-web/node_modules/playwright/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
const repo=resolve(import.meta.dirname,'../..'),profile=process.argv[2];
assert(profile?.startsWith('/private/tmp/orchestra-transfer-ui-'));
const packaged=(await readFile(join(repo,'.desktop/latest-package.txt'),'utf8')).trim();
const account=JSON.parse(await readFile(join(repo,'.desktop/self-host-v1-qualification/bootstrap-account.json'),'utf8'));
assert.equal(account.email,'owner@qualification.invalid');
const proof={package:packaged,passed:[],errors:[],simulated:[],productionTouched:false};
const app=await _electron.launch({executablePath:join(packaged,'Orchestra Desktop Internal.app/Contents/MacOS/Orchestra Desktop Internal'),args:['--user-data-dir='+profile],env:{HOME:process.env.HOME,PATH:'',TMPDIR:process.env.TMPDIR,NODE_EXTRA_CA_CERTS:join(repo,'.desktop/self-host-v1-qualification/tls-certificate.pem')},timeout:60000});
let page=await app.firstWindow();
try{
 await page.waitForURL('**/memory',{timeout:180000});await page.goto('orchestra://app/settings');
 const next=app.waitForEvent('window');await page.getByRole('button',{name:'Open Transfer qualification',exact:true}).click();page=await next;
 page.on('pageerror',e=>proof.errors.push(e.message));
 const chooser=page.getByRole('heading',{name:'Choose a workspace'}),email=page.getByLabel('Email',{exact:true});
 await Promise.race([chooser.waitFor(),email.waitFor()]);
 if(!await chooser.isVisible()){
  await email.fill(account.email);await page.getByLabel('Password',{exact:true}).fill(account.password);
  if(!await chooser.isVisible())await page.getByLabel('Password',{exact:true}).press('Enter');
 }
 await chooser.waitFor();
 await page.getByRole('button',{name:/Synthetic server Google qualification/}).click();await page.waitForURL('**/memory');
 proof.passed.push('packaged shared login and explicit workspace selection');
 await page.goto('orchestra://app/settings');
 await page.getByRole('button',{name:'Choose GitHub repository',exact:true}).click();
 const select=page.getByLabel('Authorized GitHub repository');await select.waitFor();
 const options=await select.locator('option').allTextContents();assert.deepEqual(options,['Select a repository','KarthikRamesh9149/Orchestra']);
 await select.selectOption({label:'KarthikRamesh9149/Orchestra'});await page.getByRole('button',{name:'Link selected repository',exact:true}).click();
 await page.getByRole('status').filter({hasText:'KarthikRamesh9149/Orchestra linked.'}).waitFor();
 await page.reload();await page.getByRole('button',{name:'Sync GitHub',exact:true}).waitFor();
 proof.passed.push('explicit authorized repository link and authoritative reload through native transport');
 await page.goto('orchestra://app/memory');await page.getByRole('button',{name:'Open actions for Orchestra Desktop Synthetic Drive Qualification',exact:true}).click();await page.getByRole('button',{name:'Open',exact:true}).click();
 await page.getByRole('article').filter({hasText:'exactly seven reviewers'}).waitFor();
 proof.passed.push('real imported Drive content opens through packaged shared viewer');
 assert.deepEqual(proof.errors,[]);await page.screenshot({path:join(profile,'shared-github-final.png')});
 await writeFile(join(profile,'shared-github-final.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
}catch(error){await page.screenshot({path:join(profile,'shared-github-failure.png')}).catch(()=>{});throw error;}finally{await app.close();}
