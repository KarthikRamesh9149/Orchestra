// Real ENOSPC on a bounded disposable 32-MiB image, never the Mac's main disk.
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,open,unlink,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {PrivateLocalStorageDriver} from '../../src/lib/storage/private-local.js';
import {loadVault} from '../../apps/desktop/src/vault.js';
if(process.platform!=='darwin')throw new Error('Mac-only qualification');
const root=await mkdtemp('/private/tmp/orchestra-step7-disk-full-');
const image=join(root,'synthetic.dmg'),mount=join(root,'volume');
await mkdir(mount,{mode:0o700});
const proof:{root:string;passed:string[];failure?:string}={root,passed:[]};let mounted=false;
try{
 execFileSync('/usr/bin/hdiutil',['create','-size','32m','-fs','HFS+','-volname','OrchestraSynthetic','-ov',image],{stdio:'pipe'});
 execFileSync('/usr/bin/hdiutil',['attach','-nobrowse','-mountpoint',mount,image],{stdio:'pipe'});mounted=true;
 const storage=new PrivateLocalStorageDriver(join(mount,'files'),32*1024*1024);
 const original=Buffer.from('Synthetic source must survive a failed replacement.');
 await storage.putObject({key:'source',body:original,contentType:'text/plain'});
 const vaultRoot=join(mount,'vault');await mkdir(vaultRoot,{mode:0o700});
 const fillerPath=join(mount,'filler'),filler=await open(fillerPath,'wx',0o600);
 let full=false;
 try{
  for(let n=0;n<64;n++){
   try{await filler.writeFile(Buffer.alloc(1024*1024,1));await filler.sync();}
   catch(error){assert.equal((error as NodeJS.ErrnoException).code,'ENOSPC');full=true;break;}
  }
 }finally{await filler.close();}
 assert(full,'The bounded test volume did not fill');
 await assert.rejects(storage.putObject({key:'source',body:Buffer.alloc(16*1024*1024,2),contentType:'text/plain'}),{code:'ENOSPC'});
 assert.deepEqual(await storage.getObject('source'),original);
 assert.deepEqual(await readdir(join(mount,'files')),['source']);
 proof.passed.push('real disk-full replacement preserves original source and removes partial file');
 // A rejected large write can leave a few free allocation blocks. Fill those
 // too before asserting failure for the much smaller credential envelope.
 const remainder=await open(fillerPath,'a');
 try{for(let n=0;n<8192;n++){try{await remainder.writeFile(Buffer.alloc(4096,1));await remainder.sync();}catch(error){assert.equal((error as NodeJS.ErrnoException).code,'ENOSPC');break;}}}finally{await remainder.close();}
 // Test protection only: no real credentials or keychain changes on this image.
 const protection={isEncryptionAvailable:()=>true,encryptString:()=>Buffer.alloc(16384,3),decryptString:()=>{throw new Error('not called');}};
 await assert.rejects(loadVault(vaultRoot,protection),{code:'ENOSPC'});
 assert.deepEqual(await readdir(vaultRoot),[]);
 proof.passed.push('real disk-full credential creation fails without publishing partial identity');
 await unlink(fillerPath);
 await storage.putObject({key:'source',body:Buffer.from('Recovered synthetic source'),contentType:'text/plain'});
 assert.equal((await storage.getObject('source')).toString(),'Recovered synthetic source');
 proof.passed.push('freeing only synthetic filler permits a successful durable retry');
}catch(error){proof.failure=String(error);process.exitCode=1;}
finally{
 if(mounted)execFileSync('/usr/bin/hdiutil',['detach',mount],{stdio:'pipe'});
 await writeFile(join(root,'report.json'),JSON.stringify(proof,null,2),{mode:0o600});
 console.log(JSON.stringify(proof));
}
