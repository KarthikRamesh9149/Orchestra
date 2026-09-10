import {afterEach,it,expect,vi} from 'vitest';
import {mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {downloadDocument} from '../apps/desktop/src/document-download.js';
import type {HostClient} from '../apps/desktop/src/host-client.js';
const roots:string[]=[];
const input=()=>({projectId:randomUUID(),documentId:randomUUID()});
const host={credentials:()=>({port:12345,bearer:'synthetic',token:'synthetic'})} as HostClient;
afterEach(async()=>{vi.unstubAllGlobals();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
it('requires authorized document IDs and rejects renderer-selected paths',async()=>{
 const choose=vi.fn();await expect(downloadDocument({...input(),path:'/tmp/unsafe'},host,choose)).rejects.toThrow();expect(choose).not.toHaveBeenCalled();
});
it('confirms cancellation without saving or pretending success',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('synthetic')));expect(await downloadDocument(input(),host,async()=>undefined)).toEqual({cancelled:true});
});
it('writes exact bytes only to the native-selected destination and refuses symlinks',async()=>{
 const root=await mkdtemp(join(tmpdir(),'orchestra-download-test-'));roots.push(root);const destination=join(root,'original.pdf');
 vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>new Response('synthetic source bytes',{headers:{'content-type':'application/pdf'}})));
 expect(await downloadDocument(input(),host,async()=>destination)).toEqual({cancelled:false,fileName:'original.pdf'});expect(await readFile(destination,'utf8')).toBe('synthetic source bytes');
 const outside=join(root,'preserved');await writeFile(outside,'preserve');const link=join(root,'symlink');await symlink(outside,link);await expect(downloadDocument(input(),host,async()=>link)).rejects.toThrow('regular destination');expect(await readFile(outside,'utf8')).toBe('preserve');
});
it('does not open a save dialog after backend authorization rejection',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('denied',{status:403})));const choose=vi.fn();await expect(downloadDocument(input(),host,choose)).rejects.toThrow('unavailable');expect(choose).not.toHaveBeenCalled();
});
