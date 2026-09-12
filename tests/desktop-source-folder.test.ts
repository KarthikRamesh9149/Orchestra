import {afterEach,describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,symlink,rm,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {scanSourceFolder} from '../apps/desktop/src/source-folder.js';
import {Selections} from '../apps/desktop/src/selections.js';
const roots:string[]=[];
async function root(){const value=await mkdtemp('/private/tmp/orchestra-folder-test-');roots.push(value);return value;}
afterEach(async()=>{for(const path of roots.splice(0))await rm(path,{recursive:true,force:true});});
describe('explicit source folder boundary',()=>{
 it('includes repository code only with explicit repository selection and never traverses Git internals',async()=>{
  const path=await root();await mkdir(join(path,'.git'));await mkdir(join(path,'src'));await writeFile(join(path,'src','index.ts'),'export const synthetic = true');await writeFile(join(path,'.git','private.txt'),'excluded');
  expect((await scanSourceFolder(path)).files).toEqual([]);
  expect((await scanSourceFolder(path,true)).files.map(f=>f.name)).toEqual(['src/index.ts']);
  const selections=new Selections();const chosen=await selections.add(join(path,'src','index.ts'),true);
  const selected=await selections.consume(chosen.selectionId);expect(selected.contentType).toBe('text/plain');expect(selected.fileName).toBe('index.ts.txt');expect(selected.sourceKey).toMatch(/^[a-f0-9]{64}$/);
 });
 it('requires a real Git working tree for repository-specific selection',async()=>{
  const path=await root();await expect(scanSourceFolder(path,true)).rejects.toThrow('Git');
 });
 it('honors root and nested gitignore patterns without reading ignored sources',async()=>{
  const path=await root();await mkdir(join(path,'.git'));await mkdir(join(path,'src'));await writeFile(join(path,'.gitignore'),'private.ts\n');await writeFile(join(path,'private.ts'),'excluded');await writeFile(join(path,'src','.gitignore'),'hidden.py\n');await writeFile(join(path,'src','hidden.py'),'excluded');await writeFile(join(path,'src','public.py'),'synthetic');
  expect((await scanSourceFolder(path,true)).files.map(f=>f.name)).toEqual(['src/public.py']);
 });
 it('includes supported documents but not hidden, dependency or symlink content',async()=>{const path=await root();await mkdir(join(path,'docs'));await mkdir(join(path,'node_modules'));await writeFile(join(path,'docs','prd.md'),'synthetic requirement');await writeFile(join(path,'.env'),'synthetic hidden');await writeFile(join(path,'node_modules','readme.md'),'excluded');await symlink(join(path,'docs'),join(path,'shortcut'));const result=await scanSourceFolder(path);expect(result.files.map(f=>f.name)).toEqual(['docs/prd.md']);expect(result.skipped).toBe(3);});
 it('rejects a symlink root',async()=>{const path=await root();await mkdir(join(path,'real'));await symlink(join(path,'real'),join(path,'alias'));await expect(scanSourceFolder(join(path,'alias'))).rejects.toThrow();});
 it('fails atomically instead of silently truncating oversized folders',async()=>{const path=await root();await Promise.all(Array.from({length:101},(_,i)=>writeFile(join(path,`${i}.md`),'x')));await expect(scanSourceFolder(path)).rejects.toThrow('100 documents');});
 it('rejects ancestor replacement after native selection',async()=>{const path=await root();await mkdir(join(path,'docs'));await writeFile(join(path,'docs','prd.md'),'original');const selections=new Selections(),chosen=await selections.add(join(path,'docs','prd.md'));await rename(join(path,'docs'),join(path,'moved'));await symlink(join(path,'moved'),join(path,'docs'));await expect(selections.consume(chosen.selectionId)).rejects.toThrow('path changed');});
});
