import {afterEach,it,expect,vi} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {copyPlainText} from '../apps/desktop/src/clipboard.js';
import {externalHttpsUrl,openConfirmedExternal} from '../apps/desktop/src/external-link.js';
import {downloadPreflight} from '../apps/desktop/src/document-download.js';
import type {HostClient} from '../apps/desktop/src/host-client.js';
afterEach(()=>vi.unstubAllGlobals());
it('opens only validated HTTPS sources after native confirmation',async()=>{
 const confirm=vi.fn().mockResolvedValue(true),open=vi.fn().mockResolvedValue(undefined);
 for(const value of ['file:///etc/passwd','javascript:alert(1)','https://user:secret@example.com','ms-settings:privacy','https://example.com/\nsecret'])expect(externalHttpsUrl(value)).toBeNull();
 await openConfirmedExternal('file:///etc/passwd',confirm,open);expect(confirm).not.toHaveBeenCalled();expect(open).not.toHaveBeenCalled();
 confirm.mockResolvedValue(false);await openConfirmedExternal('https://example.com/source',confirm,open);expect(open).not.toHaveBeenCalled();
 confirm.mockResolvedValue(true);await openConfirmedExternal('https://example.com/source',confirm,open);expect(open).toHaveBeenCalledWith('https://example.com/source');
});
it('copies only bounded plain text and propagates native write failures',()=>{
 const write=vi.fn();expect(copyPlainText('synthetic text',write)).toEqual({copied:true});expect(write).toHaveBeenCalledWith('synthetic text');
 for(const input of [{text:'value'},'x'.repeat(256*1024+1),null])expect(()=>copyPlainText(input,write)).toThrow();
 expect(()=>copyPlainText('value',()=>{throw new Error('clipboard denied');})).toThrow('clipboard denied');
});
it('saves the exact authorized persisted pack rather than renderer content',async()=>{
 const root=await mkdtemp(join(tmpdir(),'orchestra-pack-save-'));const input={projectId:randomUUID(),packId:randomUUID()};const host={credentials:()=>({port:12345,bearer:'synthetic',token:'synthetic'})} as HostClient;
 try{
  const fetcher=vi.fn().mockImplementation(()=>Promise.resolve(Response.json({data:{id:input.packId,bodyMarkdown:'# Human reviewed synthetic context'}})));vi.stubGlobal('fetch',fetcher);
  await expect(downloadPreflight({...input,path:'/tmp/injected',bodyMarkdown:'forged'},host,vi.fn())).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
  await downloadPreflight(input,host,async()=>join(root,'pack.md'));expect(await readFile(join(root,'pack.md'),'utf8')).toContain(input.packId);expect(await readFile(join(root,'pack.md'),'utf8')).toContain('Human reviewed synthetic context');
  fetcher.mockResolvedValue(Response.json({error:{code:'forbidden'}},{status:403}));const choose=vi.fn();await expect(downloadPreflight(input,host,choose)).rejects.toThrow('unavailable');expect(choose).not.toHaveBeenCalled();
 }finally{await rm(root,{recursive:true,force:true});}
});
