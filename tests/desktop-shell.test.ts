import {describe,it,expect,afterEach} from 'vitest';
import {mkdtemp,writeFile,mkdir,symlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {commandSchema,isTrustedFrame} from '../apps/desktop/src/contracts.js';
import {assetResponse,CSP} from '../apps/desktop/src/assets.js';
import {Selections} from '../apps/desktop/src/selections.js';
import {verifyNativeBundle} from '../apps/desktop/src/integrity.js';
import {createHash} from 'node:crypto';
const directories:string[]=[];
async function temporary(){const path=await mkdtemp(join(tmpdir(),'orchestra-shell-test-'));directories.push(path);return path;}
afterEach(async()=>{for(const path of directories.splice(0))await rm(path,{recursive:true,force:true});});
describe('desktop bridge authority',()=>{
 it('accepts only owned top-level frames',()=>{
  expect(isTrustedFrame('orchestra://app/chat/test',true)).toBe(true);
  for(const url of ['https://app/','file:///app','orchestra://evil/','orchestra://user@app/'])expect(isTrustedFrame(url,true)).toBe(false);
  expect(isTrustedFrame('orchestra://app/',false)).toBe(false);
 });
 it('rejects generic network/shell operations and extra authority',()=>{
  for(const input of [{operation:'fetch',url:'https://example.com'},{operation:'workspace.list',actorUserId:randomUUID()},{operation:'workspace.create',name:' '},{operation:'evidence.upload',projectId:randomUUID(),selectionId:'/etc/passwd'}])expect(commandSchema.safeParse(input).success).toBe(false);
  expect(commandSchema.safeParse({operation:'workspace.create',name:'Test'}).success).toBe(true);
 });
 it('serves only owned packaged assets and honest API failures',async()=>{
  const root=await temporary();await writeFile(join(root,'index.html'),'<main>existing UI</main>');
  expect(await (await assetResponse(root,'orchestra://app/index.html')).text()).toContain('existing UI');
  expect((await assetResponse(root,'orchestra://app/v1/me')).status).toBe(503);
  expect((await assetResponse(root,'orchestra://app/%2e%2e%2fsecret')).status).toBe(403);
  expect((await assetResponse(root,'https://app/index.html')).status).toBe(403);
  expect((await assetResponse(root,'orchestra://app/index.html','POST')).status).toBe(403);
  const outside=await temporary();await writeFile(join(outside,'secret.js'),'secret');await symlink(join(outside,'secret.js'),join(root,'escape.js'));
  expect((await assetResponse(root,'orchestra://app/escape.js')).status).toBe(403);
  expect(CSP).toContain("connect-src 'self'");expect(CSP).toContain("object-src 'none'");
 });
 it('binds single-use file capabilities and rejects changed files',async()=>{
  const root=await temporary(),path=join(root,'evidence.txt');await writeFile(path,'synthetic evidence');
  const selections=new Selections(),selection=await selections.add(path);
  expect(JSON.stringify(selection)).not.toContain(root);
  expect(Buffer.from((await selections.consume(selection.selectionId)).base64,'base64').toString()).toBe('synthetic evidence');
  await expect(selections.consume(selection.selectionId)).rejects.toThrow();
  const changed=await selections.add(path);await writeFile(path,'changed evidence content');await expect(selections.consume(changed.selectionId)).rejects.toThrow();
  await symlink(path,join(root,'link.txt'));await expect(selections.add(join(root,'link.txt'))).rejects.toThrow();
  await mkdir(join(root,'dir.txt'));await expect(selections.add(join(root,'dir.txt'))).rejects.toThrow();
 });
 it('rejects corrupt and wrong-platform native bundles',async()=>{
  const root=await temporary();
  const paths=['native/pgsql/bin/postgres','native/pgsql/bin/initdb','native/pgsql/bin/psql','native/node/bin/node','native/pgsql/lib/vector.dylib'];
  for(const path of paths){await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),'synthetic binary');}
  const manifest={platform:`${process.platform}-${process.arch}`,files:paths.map(path=>({path,sha256:createHash('sha256').update('synthetic binary').digest('hex')}))};
  await writeFile(join(root,'native-manifest.json'),JSON.stringify(manifest));
  if(process.platform==='darwin'&&process.arch==='arm64')await expect(verifyNativeBundle(root)).resolves.toBeUndefined();
  await writeFile(join(root,paths[0]!),'tampered');await expect(verifyNativeBundle(root)).rejects.toThrow();
  await writeFile(join(root,'native-manifest.json'),JSON.stringify({...manifest,platform:'unknown'}));await expect(verifyNativeBundle(root)).rejects.toThrow();
 });
});
