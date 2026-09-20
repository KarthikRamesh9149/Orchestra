import {lstat,readFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';

// The pinned Mac recipe needs data files as well as executable binaries. A new
// manifest generated from a truncated cache cannot prove these files existed.
export const requiredPostgresDistributionFiles=Object.freeze([
  'bin/postgres','bin/initdb','bin/psql','bin/pg_dump','bin/pg_restore',
  'lib/libpq.5.dylib','lib/libcrypto.3.dylib','lib/libssl.3.dylib',
  'lib/plpgsql.dylib','lib/dict_snowball.dylib','lib/vector.dylib','lib/pgcrypto.dylib','lib/pg_trgm.dylib',
  'share/postgres.bki','share/postgresql.conf.sample','share/pg_hba.conf.sample','share/pg_ident.conf.sample',
  'share/information_schema.sql','share/system_constraints.sql','share/system_functions.sql','share/system_views.sql',
  'share/snowball_create.sql','share/sql_features.txt','share/timezonesets/Default','share/timezone/Etc/UTC',
  'share/tsearch_data/english.stop',
  'share/extension/plpgsql.control','share/extension/plpgsql--1.0.sql',
  'share/extension/vector.control','share/extension/vector--0.8.6.sql',
  'share/extension/pgcrypto.control','share/extension/pgcrypto--1.3.sql',
  'share/extension/pg_trgm.control','share/extension/pg_trgm--1.3.sql',
  'share/extension/pg_trgm--1.3--1.4.sql','share/extension/pg_trgm--1.4--1.5.sql','share/extension/pg_trgm--1.5--1.6.sql',
  'POSTGRESQL-LICENSE','PGVECTOR-LICENSE','OPENSSL-LICENSE'
]);

/** Fail closed without downloading, repairing, or consulting a build-host prefix. */
export async function assertNativePostgresDistribution(input){
  const root=await realpath(input),invalid=[];
  for(const path of requiredPostgresDistributionFiles){
    try{
      const file=join(root,path),stat=await lstat(file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size===0||await realpath(file)!==file)invalid.push(path);
    }catch(error){if(error.code!=='ENOENT'&&error.code!=='ENOTDIR')throw error;invalid.push(path);}
  }
  if(invalid.length)throw new Error(`Incomplete PostgreSQL runtime: missing or unsafe distribution files: ${invalid.join(', ')}. Restore a verified complete distribution or rebuild from the pinned sources before packaging.`);
  const bootstrap=await readFile(join(root,'share/postgres.bki'),'utf8');
  const vector=await readFile(join(root,'share/extension/vector.control'),'utf8');
  if(!/^# PostgreSQL 17(?:\r?\n|$)/.test(bootstrap)||!/^default_version\s*=\s*'0\.8\.6'\s*$/m.test(vector)){
    throw new Error('Unexpected PostgreSQL or pgvector distribution version; the pinned runtime requires PostgreSQL 17 and pgvector 0.8.6.');
  }
  return {files:requiredPostgresDistributionFiles.length,postgresMajor:17,pgvector:'0.8.6'};
}
