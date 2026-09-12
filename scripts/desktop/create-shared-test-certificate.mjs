import {lstat,chmod} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=resolve(process.argv[2]??''),info=await lstat(root);
if(!root.includes('/.desktop/')||!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o077)!==0)throw new Error('Use an existing private .desktop qualification directory');
const key=join(root,'tls-key.pem'),cert=join(root,'tls-certificate.pem');
for(const file of [key,cert]){try{await lstat(file);throw new Error('Refusing to replace an existing certificate');}catch(error){if(error.code!=='ENOENT')throw error;}}
execFileSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:3072','-sha256','-nodes','-days','2','-keyout',key,'-out',cert,'-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
await chmod(key,0o600);await chmod(cert,0o600);
console.log('Synthetic localhost certificate generated. Trust it only in the explicit qualification process; OS trust and browser security were not changed. Not a public deployment certificate.');
