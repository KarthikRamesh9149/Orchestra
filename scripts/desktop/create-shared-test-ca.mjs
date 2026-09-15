// Generates a short-lived, localhost-constrained test CA and leaf, without
// installing trust, replacing existing files, or touching a running service.
import {lstat,writeFile,chmod} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
const directory=resolve(process.argv[2]??'');
const stat=await lstat(directory);
if(!directory.includes('/.desktop/')||!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)!==0)throw Error('Use an existing private .desktop directory');
const names=['ca-key.pem','ca-certificate.pem','tls-key.pem','tls-request.pem','tls-certificate.pem','leaf-extensions.cnf'];
for(const name of names){try{await lstat(join(directory,name));throw Error('Refusing to replace existing certificate material');}catch(error){if(error.code!=='ENOENT')throw error;}}
const run=args=>execFileSync('/usr/bin/openssl',args,{cwd:directory,stdio:'ignore'});
run(['req','-x509','-newkey','rsa:3072','-sha256','-nodes','-days','2','-keyout','ca-key.pem','-out','ca-certificate.pem','-subj','/CN=Orchestra disposable localhost qualification CA',
 '-addext','basicConstraints=critical,CA:TRUE,pathlen:0','-addext','keyUsage=critical,keyCertSign,cRLSign',
 '-addext','nameConstraints=critical,permitted;DNS:localhost,permitted;IP:127.0.0.1/255.255.255.255']);
run(['req','-new','-newkey','rsa:3072','-sha256','-nodes','-keyout','tls-key.pem','-out','tls-request.pem','-subj','/CN=localhost']);
await writeFile(join(directory,'leaf-extensions.cnf'),'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n',{mode:0o600});
run(['x509','-req','-in','tls-request.pem','-CA','ca-certificate.pem','-CAkey','ca-key.pem','-set_serial','1','-days','2','-sha256','-extfile','leaf-extensions.cnf','-out','tls-certificate.pem']);
for(const name of names)await chmod(join(directory,name),0o600);
run(['verify','-CAfile','ca-certificate.pem','-purpose','sslserver','tls-certificate.pem']);
console.log('Generated 2-day localhost-constrained CA and server certificate. No trust or running service changed.');
