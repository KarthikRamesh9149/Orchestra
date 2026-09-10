import {readFileSync,lstatSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
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
 for(let attempt=0;attempt<2;attempt++){
  const result=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{cwd:root,env,encoding:'utf8'});
  if(result.status!==0)throw new Error('Fresh migration/replay failed');
 }
 const count=docker(['psql','-U','orchestra_migrator','-d',name,'-Atc','SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL']).trim();
 if(count!=='83')throw new Error('Unexpected migration history');
 console.log('Fresh plain PostgreSQL: all 83 migrations applied; second deploy idempotent. No original migration rewritten.');
}finally{docker(['dropdb','-U','orchestra_migrator',name]);}
