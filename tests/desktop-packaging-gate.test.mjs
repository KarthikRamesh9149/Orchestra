import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,relative,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {collectPackagingTests} from '../scripts/desktop/test-packaging.mjs';

const root=resolve(import.meta.dirname,'..');
async function fixture(run){
  const directory=await mkdtemp(join(tmpdir(),'orchestra-packaging-gate-'));
  try{await mkdir(join(directory,'tests'));await run(directory);}finally{await rm(directory,{recursive:true,force:true});}
}

test('the documented npm gate selects every repository Node test, without Git or a hand-maintained list',async()=>{
  const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  assert.equal(pkg.scripts['test:desktop:packaging'],'node scripts/desktop/test-packaging.mjs');
  const expected=(await readdir(join(root,'tests'),{recursive:true})).filter(file=>file.endsWith('.test.mjs')).map(file=>'tests/'+file.split('\\').join('/')).sort();
  assert(expected.length>=21);
  const selected=(await collectPackagingTests(join(root,'tests'))).map(file=>relative(root,file).split('\\').join('/'));
  assert.deepEqual(selected,expected);
  const listed=spawnSync(process.execPath,['scripts/desktop/test-packaging.mjs','--list'],{cwd:root,encoding:'utf8'});
  assert.equal(listed.status,0,listed.stderr);
  assert.deepEqual(JSON.parse(listed.stdout),selected);
  assert.match(await readFile(join(root,'docs/desktop/release/BUILD.md'),'utf8'),/npm run test:desktop:packaging/);
});

test('future and nested Node tests are selected; TS tests and helper modules are not',async()=>fixture(async directory=>{
  await mkdir(join(directory,'tests','future'));
  for(const file of ['one.test.mjs','helper.mjs','vitest.test.ts','future/two.test.mjs'])await writeFile(join(directory,'tests',file),'');
  assert.deepEqual((await collectPackagingTests(join(directory,'tests'))).map(file=>relative(directory,file).split('\\').join('/')),['tests/future/two.test.mjs','tests/one.test.mjs']);
}));

test('the local gate runs Node tests and propagates a future test failure',async()=>fixture(async directory=>{
  // Exercise the actual CLI outside this test worker's internal child protocol.
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const runner=new URL('../scripts/desktop/test-packaging.mjs',import.meta.url).href;
  const run=()=>spawnSync(process.execPath,['--input-type=module','-e',`import {runPackagingTests} from ${JSON.stringify(runner)};process.exitCode=await runPackagingTests({root:${JSON.stringify(directory)}});`],{encoding:'utf8',env});
  await writeFile(join(directory,'tests','future.test.mjs'),"import {test} from 'node:test';test('future failure',()=>{throw Error('fixture failure');});\n");
  const failed=run();assert.equal(failed.status,1,failed.stderr);assert.match(failed.stdout,/fixture failure/);
  await writeFile(join(directory,'tests','future.test.mjs'),"import {test} from 'node:test';test('future pass',()=>{});\n");
  assert.equal(run().status,0);
}));

test('an empty or symlinked selection fails closed',async()=>fixture(async directory=>{
  await assert.rejects(collectPackagingTests(join(directory,'tests')),/No .*test/);
  await writeFile(join(directory,'outside.test.mjs'),'');
  await symlink(join(directory,'outside.test.mjs'),join(directory,'tests','linked.test.mjs'));
  await assert.rejects(collectPackagingTests(join(directory,'tests')),/symlink/i);
}));
