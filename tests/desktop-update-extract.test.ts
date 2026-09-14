import {it,expect} from 'vitest';
import {mkdtemp,writeFile,readFile,readdir,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {crc32} from 'node:zlib';
import {extractVerifiedUpdate} from '../apps/desktop/src/update-extract.js';
type Item={name:string;body?:string;mode?:number;size?:number};
function archive(items:Item[]){
 const locals:Buffer[]=[],central:Buffer[]=[];let offset=0;
 for(const item of items){
  const name=Buffer.from(item.name),body=Buffer.from(item.body??''),local=Buffer.alloc(30),record=Buffer.alloc(46);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt32LE(crc32(body),14);local.writeUInt32LE(body.length,18);local.writeUInt32LE(item.size??body.length,22);local.writeUInt16LE(name.length,26);
  record.writeUInt32LE(0x02014b50);record.writeUInt16LE(0x0314,4);record.writeUInt16LE(20,6);record.writeUInt32LE(crc32(body),16);record.writeUInt32LE(body.length,20);record.writeUInt32LE(item.size??body.length,24);record.writeUInt16LE(name.length,28);record.writeUInt32LE(((item.mode??0o100600)*65536)>>>0,38);record.writeUInt32LE(offset,42);
  locals.push(local,name,body);central.push(record,name);offset+=local.length+name.length+body.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(items.length,8);end.writeUInt16LE(items.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...locals,directory,end]);
}
const prefix='Orchestra Desktop Internal.app/';
async function fixture(items:Item[],run:(input:Parameters<typeof extractVerifiedUpdate>[0])=>Promise<void>){
 const root=await realpath(await mkdtemp(join(tmpdir(),'orchestra-extract-test-')));
 try{const bytes=archive(items),artifactPath=join(root,'update.zip');await writeFile(artifactPath,bytes,{mode:0o600});await run({artifactPath,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),root:join(root,'stages')});}
 finally{await rm(root,{recursive:true,force:true});}
}
it('extracts authenticated bytes and internal symlinks without executing or installing',()=>fixture([{name:prefix+'Contents/value',body:'synthetic'},{name:prefix+'Contents/link',body:'value',mode:0o120777}],async input=>{
 const result=await extractVerifiedUpdate(input);expect(result.installed).toBe(false);
 expect(await readFile(join(result.appPath,'Contents/link'),'utf8')).toBe('synthetic');expect(result.entries).toBe(2);
}));
for(const [name,items] of Object.entries({
 traversal:[{name:prefix+'../escape',body:'bad'}],
 absolute:[{name:'/tmp/escape',body:'bad'}],
 wrongRoot:[{name:'Other.app/file',body:'bad'}],
 duplicate:[{name:prefix+'file'},{name:prefix+'FILE'}],
 symlinkEscape:[{name:prefix+'link',body:'../../escape',mode:0o120777}],
 symlinkWrite:[{name:prefix+'link',body:'contents',mode:0o120777},{name:prefix+'link/file',body:'bad'}],
 specialFile:[{name:prefix+'device',mode:0o020600}],
 oversized:[{name:prefix+'file',size:3*1024**3}],
 empty:[],
})){it('rejects '+name+' and removes only the failed extraction',()=>fixture(items,async input=>{
 await expect(extractVerifiedUpdate(input)).rejects.toThrow();expect(await readdir(input.root)).toEqual([]);
}));}
it('rejects an archive hash mismatch before extracting',()=>fixture([{name:prefix+'file',body:'synthetic'}],async input=>{
 await expect(extractVerifiedUpdate({...input,sha256:'0'.repeat(64)})).rejects.toThrow('tampered');expect(await readdir(input.root)).toEqual([]);
}));
it('does not start an already cancelled extraction',()=>fixture([{name:prefix+'file'}],async input=>{
 await expect(extractVerifiedUpdate({...input,signal:AbortSignal.abort()})).rejects.toThrow();
}));
