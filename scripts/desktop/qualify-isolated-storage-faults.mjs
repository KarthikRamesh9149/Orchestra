// Synthetic fault qualification against current production source in a native
// subprocess. This does NOT fill a disk, mount a volume or use OS/real credentials.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const scriptPath=fileURLToPath(import.meta.url);
const repositoryRoot=resolve(dirname(scriptPath),'../..');
const maximumFixtureBytes=10*1024*1024;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

async function qualifyInChild() {
  const root=await fs.mkdtemp(join(tmpdir(),'orchestra-isolated-storage-faults-'));
  await fs.chmod(root,0o700);
  const reportPath=join(root,'report.json');
  const proof={
    schemaVersion:1,status:'running',root,reportPath,
    runtime:{kind:'native Node subprocess, current source via tsx',node:process.version,pid:process.pid,parentPid:process.ppid},
    limits:{maximumFixtureBytes,noDiskFill:true,noMounts:true,noKeychain:true,noProviders:true,noRealCredentials:true},
    evidenceLimits:[
      'ENOSPC is injected after a real small partial write, not an actual full device.',
      'Credential denial uses synthetic in-memory AES protection, not OS Keychain or Electron safeStorage.',
      'This is current-source local filesystem qualification, not a packaged UI, power-loss or live-provider test.',
    ],
    sources:[],injectedFaults:[],passed:[],
  };
  const sourcePaths=[
    join(repositoryRoot,'src/lib/storage/private-local.ts'),
    join(repositoryRoot,'apps/desktop/src/vault.ts'),
  ];
  try {
    assert.equal((await fs.stat(root)).mode&0o777,0o700);
    proof.passed.push('fixture root is private (0700)');
    for(const path of sourcePaths)proof.sources.push({path,sha256:hash(await fs.readFile(path))});
    const {PrivateLocalStorageDriver}=await import(pathToFileURL(sourcePaths[0]).href);
    const {loadVault}=await import(pathToFileURL(sourcePaths[1]).href);

    // The original open and all real I/O are preserved. Only one FileHandle in
    // our exact synthetic directory has writeFile faulted, only for this call.
    async function withPartialWriteEnospc(directory,matches,operation) {
      const originalOpen=fs.open;
      let observation;
      fs.open=async function(path,...args) {
        const handle=await originalOpen.call(fs,path,...args);
        if(typeof path==='string'&&dirname(path)===directory&&matches(basename(path))) {
          const originalWrite=handle.writeFile;
          handle.writeFile=async function(data,...writeArgs) {
            assert.equal(observation,undefined,'Fault must be exercised exactly once');
            assert(Buffer.isBuffer(data),'Only bounded buffer writes may be faulted');
            assert(data.length>31&&data.length<maximumFixtureBytes);
            const partial=data.subarray(0,31);
            await originalWrite.call(handle,partial,...writeArgs);
            await handle.sync();
            assert.deepEqual(await fs.readFile(path),partial,'Partial bytes must really reach the owned file');
            observation={code:'ENOSPC',relativePath:path.slice(root.length+1),partialBytes:partial.length,injected:true};
            throw Object.assign(new Error('Injected ENOSPC after synthetic partial write'),{code:'ENOSPC',syscall:'write'});
          };
        }
        return handle;
      };
      syncBuiltinESMExports();
      try {await assert.rejects(operation,{code:'ENOSPC'});}
      finally {fs.open=originalOpen;syncBuiltinESMExports();}
      assert.equal(fs.open,originalOpen,'Filesystem open hook must be restored');
      assert(observation,'The exact temporary-file fault must have been exercised');
      proof.injectedFaults.push(observation);
    }

    const files=join(root,'files');
    const storage=new PrivateLocalStorageDriver(files,128*1024);
    const original=Buffer.alloc(8192,65),replacement=Buffer.alloc(65536,66),retry=Buffer.alloc(16384,67);
    await storage.putObject({key:'synthetic-source',body:original,contentType:'application/octet-stream'});
    assert.deepEqual(await storage.getObject('synthetic-source'),original);
    await withPartialWriteEnospc(files,name=>/^synthetic-source\.[a-f0-9-]{36}\.pending$/.test(name),
      ()=>storage.putObject({key:'synthetic-source',body:replacement,contentType:'application/octet-stream'}));
    assert.deepEqual(await storage.getObject('synthetic-source'),original);
    assert.deepEqual(await fs.readFile(join(files,'synthetic-source')),original);
    proof.passed.push('injected partial-write ENOSPC rejects replacement and preserves exact old source bytes');
    assert.deepEqual(await fs.readdir(files),['synthetic-source']);
    proof.passed.push('failed replacement removes its actual partial pending file');
    await storage.putObject({key:'synthetic-source',body:retry,contentType:'application/octet-stream'});
    assert.deepEqual(await new PrivateLocalStorageDriver(files,128*1024).getObject('synthetic-source'),retry);
    assert.deepEqual(await fs.readdir(files),['synthetic-source']);
    proof.storageHashes={before:hash(original),failedReplacement:hash(original),afterRetry:hash(retry)};
    proof.passed.push('unfaulted storage retry replaces the source and a fresh driver reads exact retry bytes');

    // This key exists only in this process. None of the generated vault values
    // are configured as real credentials, emitted or sent outside the fixture.
    const syntheticKey=randomBytes(32);
    const protection={
      isEncryptionAvailable:()=>true,
      encryptString(value) {
        const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',syntheticKey,iv);
        const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
        return Buffer.concat([iv,cipher.getAuthTag(),encrypted]);
      },
      decryptString(value) {
        const decipher=createDecipheriv('aes-256-gcm',syntheticKey,value.subarray(0,12));
        decipher.setAuthTag(value.subarray(12,28));
        return Buffer.concat([decipher.update(value.subarray(28)),decipher.final()]).toString('utf8');
      },
    };
    const diskVault=join(root,'vault-enospc');
    await fs.mkdir(diskVault,{mode:0o700});
    await withPartialWriteEnospc(diskVault,name=>/^\.vault-[a-f0-9-]{36}$/.test(name),()=>loadVault(diskVault,protection));
    assert.deepEqual(await fs.readdir(diskVault),[]);
    proof.passed.push('injected partial-write ENOSPC leaves no published credential envelope or temporary vault file');
    const diskVaultValue=await loadVault(diskVault,protection);
    assert.deepEqual(await loadVault(diskVault,protection),diskVaultValue);
    assert.deepEqual(await fs.readdir(diskVault),['credentials.enc']);
    proof.passed.push('unfaulted vault creation retry succeeds and reload preserves the same synthetic identity');

    const deniedVault=join(root,'vault-denial');
    await fs.mkdir(deniedVault,{mode:0o700});
    let encryptionCalls=0;
    await assert.rejects(()=>loadVault(deniedVault,{
      ...protection,isEncryptionAvailable:()=>false,
      encryptString:()=>{encryptionCalls++;throw new Error('Must not encrypt when unavailable');},
    }),/plaintext fallback is forbidden/);
    assert.equal(encryptionCalls,0);
    assert.deepEqual(await fs.readdir(deniedVault),[]);
    proof.passed.push('synthetic unavailable credential protection rejects without encryption or plaintext publication');
    await assert.rejects(()=>loadVault(deniedVault,{
      ...protection,encryptString:()=>{throw Object.assign(new Error('Injected synthetic credential encryption denial'),{code:'EACCES'});},
    }),{code:'EACCES'});
    assert.deepEqual(await fs.readdir(deniedVault),[]);
    proof.passed.push('synthetic encryption denial leaves no published identity or partial credential file');
    const recoveredVault=await loadVault(deniedVault,protection);
    assert.deepEqual(await loadVault(deniedVault,protection),recoveredVault);
    assert.deepEqual(await fs.readdir(deniedVault),['credentials.enc']);
    proof.passed.push('credential creation retry succeeds after synthetic availability and encryption denial');
    const envelopePath=join(deniedVault,'credentials.enc');
    const envelope=await fs.readFile(envelopePath);
    assert(!envelope.includes(Buffer.from(recoveredVault.admin)),'Fixture envelope must not contain plaintext synthetic identity');
    await assert.rejects(()=>loadVault(deniedVault,{
      ...protection,decryptString:()=>{throw Object.assign(new Error('Injected synthetic credential decryption denial'),{code:'EACCES'});},
    }),{code:'EACCES'});
    assert.deepEqual(await fs.readFile(envelopePath),envelope);
    assert.deepEqual(await fs.readdir(deniedVault),['credentials.enc']);
    proof.passed.push('synthetic decrypt denial preserves the complete existing credential envelope without replacement');
    assert.deepEqual(await loadVault(deniedVault,protection),recoveredVault);
    assert.deepEqual(await fs.readFile(envelopePath),envelope);
    proof.passed.push('credential decryption retry loads the original synthetic identity and unchanged envelope');
    syntheticKey.fill(0);

    let totalBytes=0;
    async function inspect(directory) {
      for(const entry of await fs.readdir(directory,{withFileTypes:true})) {
        const path=join(directory,entry.name),stat=await fs.lstat(path);
        assert(!stat.isSymbolicLink(),'Synthetic fixture must not contain symlinks');
        assert.equal(stat.mode&0o777,entry.isDirectory()?0o700:0o600);
        if(entry.isDirectory())await inspect(path);
        else {assert(stat.isFile());totalBytes+=stat.size;}
      }
    }
    await inspect(root);
    assert(totalBytes<maximumFixtureBytes);
    proof.fixtureBytesBeforeReport=totalBytes;
    proof.passed.push('all fixture directories/files remain private (0700/0600) and total data is below 10 MiB');
    for(const source of proof.sources)assert.equal(hash(await fs.readFile(source.path)),source.sha256,'Source changed during qualification; rerun the harness');
    proof.passed.push('production source hashes remained unchanged throughout the qualification');
    proof.status='passed';
  } catch(error) {
    proof.status='failed';
    // Assertion details may include generated identities, so never serialize
    // assertion values, arbitrary messages or stacks into the report/stdout.
    proof.failure={name:error instanceof Error?error.name:'UnknownError',code:typeof error?.code==='string'?error.code:null};
    process.exitCode=1;
  }
  const serialized=JSON.stringify(proof,null,2)+'\n';
  assert(Buffer.byteLength(serialized)<128*1024,'Report must stay bounded');
  await fs.writeFile(reportPath,serialized,{flag:'wx',mode:0o600});
  console.log(JSON.stringify(proof));
}

if(process.argv[2]==='--worker') {
  assert.equal(process.argv.length,3,'Worker creates its own root; external filesystem targets are forbidden');
  await qualifyInChild();
} else {
  assert.equal(process.argv.length,2,'No user profiles, filesystem targets or other arguments are accepted');
  // Do not pass tokens, NODE_OPTIONS, app configuration or credential-related
  // environment into the isolated native child. It only imports local source.
  const child=spawnSync(process.execPath,['--import','tsx',scriptPath,'--worker'],{
    cwd:repositoryRoot,env:{PATH:dirname(process.execPath)},encoding:'utf8',timeout:30000,maxBuffer:128*1024,
  });
  if(child.error||child.signal)throw new Error('Isolated storage qualification subprocess did not complete');
  let proof;
  try {proof=JSON.parse(child.stdout.trim());}
  catch {throw new Error('Isolated storage qualification subprocess returned no valid report');}
  assert.notEqual(proof.runtime.pid,process.pid,'Qualification must run in a separate native process');
  assert.equal(proof.runtime.parentPid,process.pid);
  console.log(JSON.stringify(proof,null,2));
  process.exitCode=child.status===0&&proof.status==='passed'?0:1;
}
