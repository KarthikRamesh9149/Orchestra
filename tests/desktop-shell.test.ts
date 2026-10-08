import {describe,it,expect,afterEach} from 'vitest';
import {mkdtemp,writeFile,readFile,mkdir,symlink,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {commandSchema,isTrustedFrame} from '../apps/desktop/src/contracts.js';
import {assetResponse,packagedHtml,CSP} from '../apps/desktop/src/assets.js';
import {Selections} from '../apps/desktop/src/selections.js';
import {verifyNativeBundle} from '../apps/desktop/src/integrity.js';
import {createHash} from 'node:crypto';
import {loadVault} from '../apps/desktop/src/vault.js';
import {runInNewContext} from 'node:vm';
import {EventEmitter} from 'node:events';
import ts from 'typescript';
const directories:string[]=[];
async function temporary(){const path=await realpath(await mkdtemp(join(tmpdir(),'orchestra-shell-test-')));directories.push(path);return path;}
afterEach(async()=>{for(const path of directories.splice(0))await rm(path,{recursive:true,force:true});});
describe('desktop bridge authority',()=>{
 for(const alreadyClosed of [false,true])it(`waits for engine shutdown across repeated quits with ${alreadyClosed?'closed':'open'} renderer`,async()=>{
  const source=await readFile(new URL('../apps/desktop/src/main.ts',import.meta.url),'utf8');
  const handlers=source.slice(source.indexOf("app.on('before-quit'"),source.indexOf("void app.whenReady()"));
  const callbacks=new Map<string,(event?:unknown)=>void>();
  const events:string[]=[];let complete!:()=>void;let closes=0;let quits=0;
  const stopped=new Promise<void>(resolve=>{complete=resolve;});
  const renderer=Object.assign(new EventEmitter(),{
   isDestroyed:()=>alreadyClosed,
   close:()=>{events.push('renderer normal close');renderer.emit('closed');callbacks.get('window-all-closed')?.();},
   destroy:()=>{throw new Error('Destroy bypasses draft flush');},
  });
  const context={closing:false,shutdownComplete:false,window:renderer,
   slackAuthorization:undefined,githubAuthorization:undefined,driveAuthorization:undefined,
   host:{close:()=>{closes++;events.push('engine close');return stopped;}},
   app:{on:(name:string,callback:(event?:unknown)=>void)=>callbacks.set(name,callback),quit:()=>{quits++;}},
  };
  runInNewContext(ts.transpileModule(handlers,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  const before=callbacks.get('before-quit')!;
  let prevented=0;before({preventDefault:()=>prevented++});
  await new Promise(resolve=>setImmediate(resolve));
  expect(events).toEqual(alreadyClosed?['engine close']:['renderer normal close','engine close']);
  before({preventDefault:()=>prevented++});callbacks.get('window-all-closed')?.();
  expect(prevented).toBe(2);expect(closes).toBe(1);expect(quits).toBe(0);
  complete();await new Promise(resolve=>setImmediate(resolve));
  expect(quits).toBe(1);expect(context.shutdownComplete).toBe(true);
  before({preventDefault:()=>prevented++});expect(prevented).toBe(2);expect(closes).toBe(1);
 });
 it('refuses unavailable credential protection before writing secrets',async()=>{
  const root=await temporary();await expect(loadVault(root,{isEncryptionAvailable:()=>false,encryptString:()=>{throw new Error('must not run');},decryptString:()=>{throw new Error('must not run');}})).rejects.toThrow('plaintext fallback is forbidden');
 });
 it('refuses corrupt protected credentials rather than replacing the identity',async()=>{
  const root=await temporary();await writeFile(join(root,'credentials.enc'),'corrupt',{mode:0o600});
  await expect(loadVault(root,{isEncryptionAvailable:()=>true,encryptString:()=>{throw new Error('must not run');},decryptString:()=>{throw new Error('OS decryption rejected');}})).rejects.toThrow('OS decryption rejected');
 });
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
  expect(await (await assetResponse(root,'orchestra://app/')).text()).toContain('existing UI');
  expect((await assetResponse(root,'orchestra://app/v1/me')).status).toBe(503);
  expect((await assetResponse(root,'orchestra://app/%2e%2e%2fsecret')).status).toBe(403);
  expect((await assetResponse(root,'https://app/index.html')).status).toBe(403);
  expect((await assetResponse(root,'orchestra://app/index.html','POST')).status).toBe(403);
  const outside=await temporary();await writeFile(join(outside,'secret.js'),'secret');await symlink(join(outside,'secret.js'),join(root,'escape.js'));
  expect((await assetResponse(root,'orchestra://app/escape.js')).status).toBe(403);
  expect(CSP).toContain("connect-src 'self'");expect(CSP).toContain("object-src 'none'");
 });
 it('omits blocked legacy startup resources without changing UI markup or weakening CSP',async()=>{
  const original=await readFile(new URL('../apps/beta-web/index.html',import.meta.url),'utf8');
  const root=await temporary();await writeFile(join(root,'index.html'),original);
  const response=await assetResponse(root,'orchestra://app/chat');const html=await response.text();
  expect(original).toContain('fonts.googleapis.com');expect(original).toContain('<script>');
  expect(html).not.toMatch(/fonts\.(?:googleapis|gstatic)\.com/);expect(html).not.toContain('<script>');
  expect(html).toContain('<div id="root"></div>');expect(html).toContain('src="/src/main.tsx"');
  expect(response.headers.get('content-security-policy')).toBe(CSP);
  expect(CSP).toContain("script-src 'self';");expect(CSP).toContain("font-src 'self';");
  const main=await readFile(new URL('../apps/beta-web/src/main.tsx',import.meta.url),'utf8');
  expect(main).toContain('initializeTheme();');expect(main).toContain('ReactDOM.createRoot');
  expect(main.indexOf('initializeTheme();')).toBeLessThan(main.indexOf('ReactDOM.createRoot'));
  expect(await (await assetResponse(root,'orchestra://app/','HEAD')).text()).toBe('');
 });
 it('preserves unrelated scripts and styles instead of treating HTML rewriting as a sanitizer',()=>{
  const html='<link rel="stylesheet" href="/assets/app.css"><script type="module" src="/assets/app.js"></script><script>untrusted()</script>';
  expect(packagedHtml(html)).toBe(html);
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
