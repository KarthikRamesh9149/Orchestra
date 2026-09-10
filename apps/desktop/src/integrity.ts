import {readFile,realpath,lstat} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod';
const manifestSchema=z.object({platform:z.enum(['darwin-arm64','win32-x64']),files:z.array(z.object({path:z.string().regex(/^native\/[A-Za-z0-9_./+-]+$/),sha256:z.string().regex(/^[a-f0-9]{64}$/)})).min(5).max(10000)});
export async function verifyNativeBundle(root:string){
 const manifest=manifestSchema.parse(JSON.parse(await readFile(resolve(root,'native-manifest.json'),'utf8')));
 if(manifest.platform!==`${process.platform}-${process.arch}`)throw new Error('Wrong native runtime target');
 const base=await realpath(resolve(root,'native'));
 const seen=new Set<string>();
 for(const entry of manifest.files){
  if(entry.path.split('/').includes('..')||seen.has(entry.path))throw new Error('Invalid native inventory');seen.add(entry.path);
  const file=await realpath(resolve(root,entry.path));if(!file.startsWith(base+sep))throw new Error('Native path escapes bundle');
  const stat=await lstat(file);if(!stat.isFile()||stat.size>256*1024*1024)throw new Error('Invalid native file');
  if(createHash('sha256').update(await readFile(file)).digest('hex')!==entry.sha256)throw new Error('Native runtime integrity mismatch');
 }
 const suffix=process.platform==='win32'?'.exe':'';
 for(const path of [`native/pgsql/bin/postgres${suffix}`,`native/pgsql/bin/initdb${suffix}`,`native/pgsql/bin/psql${suffix}`,`native/node/${process.platform==='win32'?'node.exe':'bin/node'}`])if(!seen.has(path))throw new Error('Missing native executable');
}
