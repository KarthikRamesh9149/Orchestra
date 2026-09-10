import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
process.chdir(root);
const directory=path.join(root,'.desktop');
fs.mkdirSync(directory,{recursive:true,mode:0o700});
const directoryInfo=fs.lstatSync(directory);
if(!directoryInfo.isDirectory()||directoryInfo.isSymbolicLink()||(process.platform!=='win32'&&(directoryInfo.mode&0o077)!==0))throw new Error('Unsafe secret directory');
const secret=path.join(directory,'development-db.json');
try { const fd=fs.openSync(secret,'wx',0o600);fs.writeFileSync(fd,JSON.stringify({password:randomBytes(32).toString('hex')}));fs.closeSync(fd); }
catch(error){if(error.code!=='EEXIST')throw error;}
const secretInfo=fs.lstatSync(secret);
if(!secretInfo.isFile()||secretInfo.isSymbolicLink()||(process.platform!=='win32'&&(secretInfo.mode&0o077)!==0))throw new Error('Unsafe secret file');
const {password}=JSON.parse(fs.readFileSync(secret,'utf8'));
if(!/^[0-9a-f]{64}$/.test(password))throw new Error('Invalid generated database secret');
const env={...process.env,DESKTOP_DB_PASSWORD:password,DATABASE_URL:`postgresql://orchestra_migrator:${password}@127.0.0.1:55439/orchestra_desktop?schema=public`};
const action=process.argv[2];
let command,args;
if(action==='up'){command='docker';args=['compose','-f','infra/desktop/compose.yaml','up','-d','--wait'];}
else if(action==='stop'){command='docker';args=['compose','-f','infra/desktop/compose.yaml','stop'];}
else if(action==='migrate'){command=process.execPath;args=['node_modules/prisma/build/index.js','migrate','deploy'];}
else if(action==='test'){command=process.execPath;args=['node_modules/vitest/vitest.mjs','run','tests/desktop-postgres.integration.test.ts'];env.DESKTOP_DB_TEST='1';}
else throw new Error('Use up, stop, migrate or test; no destructive reset is provided');
const result=spawnSync(command,args,{env,stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;
