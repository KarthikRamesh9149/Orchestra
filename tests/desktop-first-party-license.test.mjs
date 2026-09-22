import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {FIRST_PARTY_LICENSE_NAME,readFirstPartyLicense,writeFirstPartyLicense} from '../apps/desktop/scripts/package.mjs';

const sourceLicense=resolve(import.meta.dirname,'../LICENSE');
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'orchestra-first-party-license-'));
 t.after(()=>rm(root,{recursive:true,force:true}));return root;
}

test('packages exact first-party Apache text separately from Electron and third-party notices',async t=>{
 const root=await fixture(t),resources=join(root,'Orchestra Desktop Internal.app/Contents/Resources');
 await mkdir(resources,{recursive:true});
 const electron=Buffer.from('synthetic Electron notice'),thirdParty=Buffer.from('synthetic Chromium notices');
 await writeFile(join(root,'LICENSE'),electron);
 await writeFile(join(root,'LICENSES.chromium.html'),thirdParty);
 const bytes=await readFirstPartyLicense(sourceLicense);
 for(const target of [root,resources])await writeFirstPartyLicense(target,bytes);
 for(const target of [root,resources])assert.deepEqual(await readFile(join(target,FIRST_PARTY_LICENSE_NAME)),await readFile(sourceLicense));
 assert.deepEqual(await readFile(join(root,'LICENSE')),electron);
 assert.deepEqual(await readFile(join(root,'LICENSES.chromium.html')),thirdParty);
});

test('fails closed for missing, changed or linked first-party source licences',async t=>{
 const root=await fixture(t),changed=join(root,'LICENSE'),linked=join(root,'linked-license');
 await assert.rejects(readFirstPartyLicense(changed),{code:'ENOENT'});
 await writeFile(changed,'Apache License\nVersion 2.0\ntruncated or unexpected text');
 await assert.rejects(readFirstPartyLicense(changed),/Unexpected first-party license/);
 await symlink(sourceLicense,linked);
 await assert.rejects(readFirstPartyLicense(linked),/regular file/);
 await assert.rejects(readFirstPartyLicense(root),/regular file/);
});

test('does not overwrite an existing licence or follow output-directory links',async t=>{
 const root=await fixture(t),output=join(root,'output'),linked=join(root,'linked');
 await mkdir(output);await symlink(output,linked);
 const bytes=await readFirstPartyLicense(sourceLicense);
 await assert.rejects(writeFirstPartyLicense(linked,bytes),/regular directory/);
 await assert.rejects(writeFirstPartyLicense(output,Buffer.from('changed')),/Unexpected first-party license/);
 const existing=Buffer.from('retained existing notice');
 await writeFile(join(output,FIRST_PARTY_LICENSE_NAME),existing);
 await assert.rejects(writeFirstPartyLicense(output,bytes),{code:'EEXIST'});
 assert.deepEqual(await readFile(join(output,FIRST_PARTY_LICENSE_NAME)),existing);
});

test('does not follow a pre-existing licence-file link',async t=>{
 const root=await fixture(t),outside=join(root,'outside'),output=join(root,'output');
 await mkdir(output);await writeFile(outside,'retained unrelated file');
 await symlink(outside,join(output,FIRST_PARTY_LICENSE_NAME));
 await assert.rejects(writeFirstPartyLicense(output,await readFirstPartyLicense(sourceLicense)),{code:'EEXIST'});
 assert.equal(await readFile(outside,'utf8'),'retained unrelated file');
});
