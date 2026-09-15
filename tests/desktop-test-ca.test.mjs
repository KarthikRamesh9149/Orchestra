import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('disposable CA verifies localhost, rejects non-local names, and refuses overwrite',{skip:process.platform!=='darwin'},async()=>{
 const root=await mkdtemp(join(tmpdir(),'orchestra-test-ca-'));
 const directory=join(root,'.desktop','qualification');
 try {
  await mkdir(directory,{recursive:true,mode:0o700});
  const script=fileURLToPath(new URL('../scripts/desktop/create-shared-test-ca.mjs',import.meta.url));
  execFileSync(process.execPath,[script,directory],{stdio:'pipe'});
  assert.notEqual(spawnSync(process.execPath,[script,directory]).status,0);
  assert.equal((await stat(join(directory,'ca-key.pem'))).mode&0o077,0);
  const ssl=args=>spawnSync('/usr/bin/openssl',args,{cwd:directory,encoding:'utf8'});
  assert.equal(ssl(['verify','-CAfile','ca-certificate.pem','-purpose','sslserver','tls-certificate.pem']).status,0);
  await writeFile(join(directory,'negative.cnf'),'basicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:outside.example\n');
  assert.equal(ssl(['x509','-req','-in','tls-request.pem','-CA','ca-certificate.pem','-CAkey','ca-key.pem','-set_serial','2','-days','1','-extfile','negative.cnf','-out','negative.pem']).status,0);
  const rejected=ssl(['verify','-CAfile','ca-certificate.pem','-purpose','sslserver','negative.pem']);
  assert.notEqual(rejected.status,0);
  assert.match(rejected.stdout+rejected.stderr,/permitted subtree|name constraint/i);
 } finally {await rm(root,{recursive:true,force:true});}
});
