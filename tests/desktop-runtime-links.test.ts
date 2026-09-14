import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,symlink,readlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {normalizeRuntimeLinks} from '../apps/desktop/scripts/runtime-links.mjs';
it('keeps runtime links relocatable and rejects external dependencies',async()=>{
 const root=await mkdtemp('/private/tmp/orchestra-runtime-links-');
 try{
  await mkdir(join(root,'lib'));await writeFile(join(root,'lib/value'),'synthetic');
  await symlink(join(root,'lib/value'),join(root,'lib/link'));
  await normalizeRuntimeLinks(root);expect(await readlink(join(root,'lib/link'))).toBe('value');
  await symlink('/usr/lib',join(root,'external'));
  await expect(normalizeRuntimeLinks(root)).rejects.toThrow('escapes bundle');
 }finally{await rm(root,{recursive:true,force:true});}
});
it('uses the bundled generated Prisma client rather than a developer checkout',async()=>{
 const root=await mkdtemp('/private/tmp/orchestra-runtime-links-');
 try{
  await mkdir(join(root,'backend/node_modules/@prisma/client'),{recursive:true});
  await mkdir(join(root,'backend/node_modules/.prisma/client'),{recursive:true});
  await writeFile(join(root,'backend/node_modules/.prisma/client/default.js'),'synthetic');
  const link=join(root,'backend/node_modules/@prisma/client/.prisma');await symlink('/missing/developer/.prisma',link);
  await normalizeRuntimeLinks(root);expect(await readlink(link)).toBe('../../.prisma');
 }finally{await rm(root,{recursive:true,force:true});}
});
