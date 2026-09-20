import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,unlink,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {assertNativePostgresDistribution,requiredPostgresDistributionFiles} from '../scripts/desktop/native-distribution.mjs';

async function fixture(run){
  const root=await mkdtemp(join(tmpdir(),'orchestra-native-distribution-test-'));
  try{
    for(const path of requiredPostgresDistributionFiles){await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),'synthetic');}
    await writeFile(join(root,'share/postgres.bki'),'# PostgreSQL 17\nsynthetic');
    await writeFile(join(root,'share/extension/vector.control'),"default_version = '0.8.6'\n");
    await run(root);
  }finally{await rm(root,{recursive:true,force:true});}
}

test('complete pinned distribution passes without executing native tools',async()=>fixture(async root=>{
  assert.equal((await assertNativePostgresDistribution(root)).files,requiredPostgresDistributionFiles.length);
}));

test('executable-only cache cannot be repackaged as a complete distribution',async()=>fixture(async root=>{
  for(const path of ['share/postgres.bki','share/extension/vector.control','PGVECTOR-LICENSE'])await unlink(join(root,path));
  await assert.rejects(assertNativePostgresDistribution(root),error=>['share/postgres.bki','share/extension/vector.control','PGVECTOR-LICENSE'].every(path=>error.message.includes(path)));
}));

test('rejects empty files, symlinked dependencies, and wrong-version data',async()=>fixture(async root=>{
  const path=join(root,'share/postgres.bki');
  await writeFile(path,'');await assert.rejects(assertNativePostgresDistribution(root),/postgres.bki/);
  await unlink(path);await symlink(join(root,'share/system_views.sql'),path);await assert.rejects(assertNativePostgresDistribution(root),/postgres.bki/);
  await unlink(path);await writeFile(path,'# PostgreSQL 16\n');await assert.rejects(assertNativePostgresDistribution(root),/version/);
}));

test('assembly checks source before downloads and checks staged copy before publication',async()=>{
  const source=await readFile(new URL('../scripts/desktop/prepare-native.mjs',import.meta.url),'utf8');
  const first=source.indexOf("await assertNativePostgresDistribution(join(native,'pgsql'))");
  assert(first>0&&first<source.indexOf('await writeFile(archive,bytes)'));
  const staged=source.indexOf("await assertNativePostgresDistribution(join(runtime,'native/pgsql'))");
  assert(staged>first&&staged<source.indexOf("await writeFile(join(runtime,'native-manifest.json')"));
});
