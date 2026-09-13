import {describe,it,expect} from 'vitest';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {verifyUpdateManifest,verifyUpdateBytes} from '../apps/desktop/src/update-verification.js';

const keys=generateKeyPairSync('ed25519');
const now=Date.parse('2026-09-13T00:00:00Z');
const payload=Buffer.from('synthetic update, never executable');
const base={formatVersion:1,channel:'beta',version:'0.0.5',platform:'darwin-arm64',issuedAt:now-1000,expiresAt:now+60_000,schema:{min:83,max:84},artifact:{url:'https://downloads.example.test/orchestra-0.0.5.zip',bytes:payload.length,sha256:createHash('sha256').update(payload).digest('hex')}};
const policy={publicKey:keys.publicKey,origin:'https://downloads.example.test',channel:'beta',currentVersion:'0.0.4',schemaVersion:83,now};
function signed(value=base){const bytes=Buffer.from(JSON.stringify(value));return {bytes,signature:sign(null,bytes,keys.privateKey).toString('base64')};}
function verify(value=base){const {bytes,signature}=signed(value);return verifyUpdateManifest(bytes,signature,policy);}
describe('signed update verification, not update installation',()=>{
 it('accepts a compatible signed newer Mac artifact',()=>{expect(verify().version).toBe('0.0.5');});
 it('rejects altered metadata and a different signer',()=>{
  const {bytes,signature}=signed();expect(()=>verifyUpdateManifest(Buffer.concat([bytes,Buffer.from(' ')]),signature,policy)).toThrow();
  expect(()=>verifyUpdateManifest(bytes,signature,{...policy,publicKey:generateKeyPairSync('ed25519').publicKey})).toThrow();
 });
 for(const [name,patch] of Object.entries({downgrade:{version:'0.0.3'},replay:{version:'0.0.4'},expired:{expiresAt:now-1},future:{issuedAt:now+600_000},wrongChannel:{channel:'stable'},wrongPlatform:{platform:'win32-x64'},incompatible:{schema:{min:84,max:85}},unknownField:{execute:'anything'},wrongOrigin:{artifact:{...base.artifact,url:'https://evil.example.test/a.zip'}},credentials:{artifact:{...base.artifact,url:'https://user:password@downloads.example.test/a.zip'}},query:{artifact:{...base.artifact,url:'https://downloads.example.test/a.zip?token=x'}},http:{artifact:{...base.artifact,url:'http://downloads.example.test/a.zip'}}})){
  it(`rejects ${name}`,()=>{expect(()=>verify({...base,...patch} as typeof base)).toThrow();});
 }
 it('rejects missing signature and oversized metadata before parsing',()=>{expect(()=>verifyUpdateManifest(Buffer.alloc(65537),'',policy)).toThrow();expect(()=>verifyUpdateManifest(signed().bytes,'',policy)).toThrow();});
 it('verifies exact streamed bytes without executing or writing an installer',async()=>{
  async function* chunks(){yield payload.subarray(0,4);yield payload.subarray(4);}
  await expect(verifyUpdateBytes(chunks(),verify().artifact)).resolves.toBeUndefined();
 });
 it('rejects truncation, alteration and extra bytes',async()=>{
  for(const bytes of [payload.subarray(0,4),Buffer.alloc(payload.length),Buffer.concat([payload,Buffer.from('extra')])]){
   async function* chunks(){yield bytes;}
   await expect(verifyUpdateBytes(chunks(),base.artifact)).rejects.toThrow();
  }
 });
});
