// Inventory actual files, not just license labels. No uploads or legal clearance.
import {readdir,readFile,lstat,realpath} from 'node:fs/promises';
import {join,relative,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export async function inventoryNotices(input) {
  const root=await realpath(input),packages=[];
  async function walk(directory) {
    for(const entry of await readdir(directory,{withFileTypes:true})) {
      if(!entry.isDirectory()||entry.isSymbolicLink())continue;
      const folder=join(directory,entry.name);
      if(entry.name==='node_modules'||entry.name.startsWith('@')) {await walk(folder);continue;}
      let metadata;
      try {if(!(await lstat(join(folder,'package.json'))).isFile())continue;metadata=JSON.parse(await readFile(join(folder,'package.json'),'utf8'));}
      catch(error) {if(error.code==='ENOENT')continue;throw error;}
      const notices=[],embeddedNotices=[];
      for(const file of await readdir(folder)) {
        if(/^readme([.-]|$)/i.test(file)&&(await lstat(join(folder,file))).isFile()) {
          const bytes=await readFile(join(folder,file)),body=bytes.toString('utf8');
          if(/copyright/i.test(body)&&/permission is hereby granted/i.test(body)&&/THE SOFTWARE IS PROVIDED/i.test(body))
            embeddedNotices.push({path:relative(root,join(folder,file)),sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
        }
        if(!/^(licen[sc]e|copying|copyright|notice)([.-]|$)/i.test(file))continue;
        if(!(await lstat(join(folder,file))).isFile())continue;
        const bytes=await readFile(join(folder,file));
        notices.push({path:relative(root,join(folder,file)),sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
      }
      packages.push({path:relative(root,folder),name:metadata.name,version:metadata.version,license:metadata.license??null,notices,embeddedNotices});
      try {if((await lstat(join(folder,'node_modules'))).isDirectory())await walk(join(folder,'node_modules'));}
      catch(error) {if(error.code!=='ENOENT')throw error;}
    }
  }
  await walk(root);
  return {formatVersion:1,packages,standaloneNoticeMissing:packages.filter(p=>!p.notices.length).map(p=>({path:p.path,name:p.name,version:p.version})),
    unresolvedNoticeLocations:packages.filter(p=>!p.notices.length&&!p.embeddedNotices.length).map(p=>({path:p.path,name:p.name,version:p.version})),
    complete:false,limitations:['Standalone package-root notices only; README/source notices need review','Bundled frontend, Electron and native dependencies need separate review','File presence does not certify compliance or redistribution rights']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  if(process.argv.length!==3)throw new Error('Usage: node scripts/desktop/bundled-notices.mjs NODE_MODULES');
  console.log(JSON.stringify(await inventoryNotices(process.argv[2]),null,2));
}
