import {_electron} from '../../apps/beta-web/node_modules/playwright/index.mjs';
import {readFile,writeFile,mkdtemp,mkdir,symlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=process.argv[2];assert(/^\/private\/tmp\/orchestra-step4-acceptance-[A-Za-z0-9]+$/.test(profile??''));assert.equal(JSON.parse(await readFile(join(profile,'result.json'),'utf8')).profile,profile);
const packageRoot=(await readFile(join(resolve(import.meta.dirname,'../..'),'.desktop/latest-package.txt'),'utf8')).trim();
const fixture=await mkdtemp('/private/tmp/orchestra-folder-ui-');await mkdir(join(fixture,'docs'));await writeFile(join(fixture,'docs','folder-acceptance.md'),'# Synthetic folder acceptance\nOnly the explicitly selected public document should appear in Memory. Owner: synthetic local tester.');await writeFile(join(fixture,'.env'),'SYNTHETIC_FIXTURE_ONLY=excluded');
const repository=process.argv.includes('--repository');
if(repository){await mkdir(join(fixture,'.git'));await mkdir(join(fixture,'src'));await writeFile(join(fixture,'src','acceptance.ts'),'// Synthetic repository fixture only\nexport const acceptedReviewers = 7;');await writeFile(join(fixture,'.gitignore'),'ignored.ts\n');await writeFile(join(fixture,'ignored.ts'),'// excluded synthetic source');await symlink(join(fixture,'src'),join(fixture,'linked-source'));}
let app;const proof={packageRoot,passed:[],errors:[]};
try{
 app=await _electron.launch({executablePath:join(packageRoot,'Orchestra Desktop Internal.app/Contents/MacOS/Orchestra Desktop Internal'),args:['--user-data-dir='+profile],env:{PATH:'',TMPDIR:process.env.TMPDIR??'',HOME:process.env.HOME},timeout:60000});
 const page=await app.firstWindow();page.on('pageerror',error=>proof.errors.push(error.message));await page.waitForURL('**/memory',{timeout:180000});await page.goto('orchestra://app/settings');
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},fixture);
 await page.getByRole('button',{name:repository?'Choose Git repository':'Choose document folder',exact:true}).click();await page.getByRole('list',{name:'Selected documents'}).waitFor();assert.equal(await page.getByRole('listitem').filter({hasText:'docs/folder-acceptance.md'}).count(),1);const preview=await page.getByRole('list',{name:'Selected documents'}).innerText();assert(!/\.env|ignored.ts|linked-source/.test(preview));if(repository)assert(preview.includes('src/acceptance.ts'));
 const count=repository?2:1;await page.getByRole('button',{name:`Import ${count} documents`,exact:true}).click();await page.getByText(`${count} documents saved to Memory`,{exact:false}).waitFor({timeout:60000});
 await page.goto('orchestra://app/memory');await page.getByText('folder-acceptance.md',{exact:false}).first().waitFor();await page.reload();await page.getByText('folder-acceptance.md',{exact:false}).first().waitFor();
 if(repository)await page.getByText('acceptance.ts.txt',{exact:false}).first().waitFor();
 assert.deepEqual(proof.errors,[]);proof.passed.push(repository?'native Git working-tree preview includes selected code, excludes ignored/hidden/symlink content; documents and code persist after reload':'native folder preview excludes hidden files; explicit import appears in Memory after reload');await page.screenshot({path:join(profile,repository?'step5-repository.png':'step5-folder.png')});console.log(JSON.stringify(proof));
}catch(error){proof.failure=error.message;throw error;}finally{await app?.close();await writeFile(join(profile,repository?'step5-repository.json':'step5-folder.json'),JSON.stringify(proof,null,2));}
