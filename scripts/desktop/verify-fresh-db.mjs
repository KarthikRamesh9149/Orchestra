import {readFileSync,lstatSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {migrationLedgerSql,readMigrationManifest,verifyAppliedMigrations} from '../../src/desktop/migration-manifest.ts';

export {readMigrationManifest,verifyAppliedMigrations};

function verifyFreshDatabase() {
 const root=resolve(import.meta.dirname,'../..');
 const approved=readMigrationManifest(resolve(root,'prisma/migrations'));
 const file=resolve(root,'.desktop/development-db.json'),stat=lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0)throw new Error('Private development credentials required');
 const {password}=JSON.parse(readFileSync(file,'utf8'));
 if(!/^[a-f0-9]{64}$/.test(password))throw new Error('Invalid fixture credentials');
 const name='orchestra_desktop_fresh_'+randomUUID().replaceAll('-','');
 function docker(args){const result=spawnSync('docker',['exec','orchestra-desktop-dev-postgres-1',...args],{encoding:'utf8'});if(result.status!==0)throw new Error('Isolated fresh database command failed');return result.stdout;}
 docker(['createdb','-U','orchestra_migrator',name]);
 try{
  docker(['psql','-U','orchestra_migrator','-d',name,'-v','ON_ERROR_STOP=1','-c',`CREATE SCHEMA extensions; ALTER DATABASE ${name} SET search_path=public,extensions;`]);
  const env={...process.env,DATABASE_URL:`postgresql://orchestra_migrator:${password}@127.0.0.1:55439/${name}?schema=public`};
  let applied;
  for(let attempt=0;attempt<2;attempt++){
   const result=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{cwd:root,env,encoding:'utf8'});
   if(result.status!==0)throw new Error('Fresh migration/replay failed');
   if(attempt===1&&!result.stdout.includes('No pending migrations to apply.'))throw new Error('Second migrate deploy was not a no-op');
   applied=verifyAppliedMigrations(approved,JSON.parse(docker(['psql','-U','orchestra_migrator','-d',name,'-Atc',migrationLedgerSql])));
  }
  console.log(`Fresh plain PostgreSQL: ${applied} migration names and checksums match source; second deploy was a no-op.`);
 }finally{docker(['dropdb','-U','orchestra_migrator',name]);}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) verifyFreshDatabase();
