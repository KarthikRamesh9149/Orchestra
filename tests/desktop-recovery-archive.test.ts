import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {validateRecoveryArchive,unreferencedTransferFiles} from '../src/desktop/recovery-archive.js';
const body=Buffer.from('synthetic');
const fixture=()=>({version:1,serverId:'11111111-1111-4111-8111-111111111111',configurationHash:'c'.repeat(64),image:'sha256:'+'a'.repeat(64),createdAt:new Date().toISOString(),dump:body.toString('base64'),dumpHash:createHash('sha256').update(body).digest('hex'),files:[{key:'files/synthetic.txt',body:body.toString('base64'),hash:createHash('sha256').update(body).digest('hex')}],keys:[]});
it('accepts a bounded authenticated recovery payload',()=>{expect(validateRecoveryArchive(fixture()).files).toHaveLength(1);});
it.each(['../secret','/absolute','files/../secret','files\\secret','files//secret'])('rejects unsafe archive path %s',key=>{const data=fixture();data.files[0]!.key=key;expect(()=>validateRecoveryArchive(data)).toThrow();});
it('rejects duplicate paths, corrupt bytes and unexpected fields',()=>{
 const duplicate=fixture();duplicate.files.push(duplicate.files[0]!);expect(()=>validateRecoveryArchive(duplicate)).toThrow();
 const corrupt=fixture();corrupt.files[0]!.body='YQ==';expect(()=>validateRecoveryArchive(corrupt)).toThrow();
 expect(()=>validateRecoveryArchive({...fixture(),command:'anything'})).toThrow();
});
it('rejects noncanonical encoding and invalid queue expiry',()=>{
 const data=fixture();data.dump+='\n';expect(()=>validateRecoveryArchive(data)).toThrow();
 expect(()=>validateRecoveryArchive({...fixture(),keys:[{key:'job',dump:'YQ==',expires:-1}]})).toThrow();
});
it('reconciles only unreferenced immutable transfer files, preserving committed and unrelated data',()=>{
 const prefix='files/transfers/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/';
 const committed=prefix+'a'.repeat(64),orphan=prefix+'b'.repeat(64);
 expect(unreferencedTransferFiles([committed,orphan,'files/customer.pdf',prefix+'../secret'],[committed.slice(6)])).toEqual([orphan]);
});
