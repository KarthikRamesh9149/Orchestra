import {constants} from 'node:fs';
import {lstat,mkdir,mkdtemp,open,realpath,rename,rmdir,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {basename,dirname,join,resolve} from 'node:path';

async function realDirectory(path,{create=false,optional=false}={}){
  let stat;
  try{stat=await lstat(path);}catch(error){
    if(error.code!=='ENOENT')throw error;
    if(create){
      try{await mkdir(path);}catch(error){if(error.code!=='EEXIST')throw error;}
      stat=await lstat(path);
    }else if(optional){return false;}else{throw error;}
  }
  if(!stat.isDirectory()||stat.isSymbolicLink())throw Error(`Refusing non-directory or symlink: ${path}`);
  return true;
}

async function directories(desktop){
  // Canonicalise the checkout's parent path (macOS /tmp is itself an alias),
  // but never resolve away symlinks in the mutable build/cache/output paths.
  const path=join(await realpath(dirname(resolve(desktop))),basename(desktop));
  await realDirectory(path,{create:true});
  const cache=join(path,'native-build');await realDirectory(cache,{create:true});
  return {desktop:path,cache};
}

async function readArchive(path){
  // O_NONBLOCK lets us reject FIFOs/devices rather than hanging before fstat.
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    if(!(await handle.stat()).isFile())throw Error(`Archive must be a regular file: ${path}`);
    return await handle.readFile();
  }finally{await handle.close();}
}

function verify(bytes,source){
  if(createHash('sha256').update(bytes).digest('hex')!==source.sha256)throw Error(`Checksum mismatch: ${source.name}`);
}

async function download(source){
  const response=await fetch(source.url);
  if(!response.ok)throw Error(`Download failed: ${source.name}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function withNativeBuildLock(desktop,build){
  const {cache}=await directories(desktop),lock=join(cache,'.build-lock');
  try{await mkdir(lock);}catch(error){
    if(error.code==='EEXIST')throw Error(`Native build lock exists: ${lock}. Confirm no native build is running before removing a stale lock.`);
    throw error;
  }
  try{return await build();}finally{await rmdir(lock);}
}

export async function createNativeBuildWorkspace(desktop,{sources,run,fetchSource=download}){
  if(!Array.isArray(sources)||!sources.length||new Set(sources.map(source=>source.name)).size!==sources.length)throw Error('Unique pinned sources are required');
  for(const source of sources){
    if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(source.name)||source.name==='.'||source.name==='..'||!/^[a-f0-9]{64}$/.test(source.sha256))throw Error('Invalid source name or SHA256 pin');
  }
  const paths=await directories(desktop);
  const directory=await mkdtemp(join(paths.cache,'run-'));
  const archives=join(directory,'archives');await mkdir(archives);
  await mkdir(join(directory,'output'));
  for(const source of sources){
    const cache=join(paths.cache,source.name+'.archive');
    let bytes;
    try{bytes=await readArchive(cache);}catch(error){
      if(error.code!=='ENOENT')throw error;
      bytes=await fetchSource(source);verify(bytes,source);
      // Do not follow an archive symlink or clobber a concurrent cache writer.
      try{await writeFile(cache,bytes,{flag:'wx',mode:0o600});}catch(error){
        if(error.code!=='EEXIST')throw error;
        bytes=await readArchive(cache);
      }
    }
    verify(bytes,source);
    // Extract these exact verified bytes, never the mutable shared cache path.
    await writeFile(join(archives,source.name+'.archive'),bytes,{flag:'wx',mode:0o600});
  }
  for(const source of sources){
    await run('/usr/bin/tar',['-xf',join(archives,source.name+'.archive'),'-C',directory],directory);
    await realDirectory(join(directory,source.name));
  }
  return {directory,sources:sources.map(source=>({...source}))};
}

export async function publishNativeBuild(desktop,directory,{renamePath=rename}={}){
  const paths=await directories(desktop);
  if(dirname(resolve(directory))!==paths.cache||!basename(directory).startsWith('run-'))throw Error('Native stage must belong to this build cache');
  await realDirectory(directory);
  const output=join(directory,'output');await realDirectory(output);
  const native=join(paths.desktop,'native');await realDirectory(native,{create:true});
  const destination=join(native,'darwin-arm64');
  const exists=await realDirectory(destination,{optional:true});
  await realDirectory(join(output,'pgsql'));
  if(!(await readArchive(join(output,'build-provenance.json'))).length)throw Error('Native stage provenance must not be empty');
  const previous=exists?join(native,'darwin-arm64-previous-'+randomUUID()):null;
  if(previous)await renamePath(destination,previous);
  try{await renamePath(output,destination);}catch(error){
    if(previous)await renamePath(previous,destination);
    throw error;
  }
  return {destination,previous};
}
