import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import JSZip from 'jszip';

const root=resolve(import.meta.dirname,'..');
const extension=join(root,'apps/vscode-extension');

test('maintained VS Code packager does not retain the vulnerable glob dependency chain',async()=>{
  const pkg=JSON.parse(await readFile(join(extension,'package.json'),'utf8'));
  const lock=JSON.parse(await readFile(join(extension,'package-lock.json'),'utf8'));
  assert.equal(pkg.devDependencies['@vscode/vsce'],'4.0.0');
  assert.equal(lock.packages['node_modules/@vscode/vsce'].version,'4.0.0');
  for(const location of Object.keys(lock.packages))assert.doesNotMatch(location,/(?:^|\/)node_modules\/(?:braces|micromatch|fast-glob|secretlint)$/);
});

test('actual locked packager produces a complete unsigned VSIX without disabling secret detection',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'orchestra-vsix-check-'));
  const run=args=>{
    const result=spawnSync(process.execPath,args,{cwd:extension,encoding:'utf8',timeout:60000});
    assert.equal(result.status,0,result.stderr+'\n'+result.stdout);
  };
  try{
    run(['node_modules/typescript/bin/tsc','-p','tsconfig.json']);
    const output=join(directory,'orchestra.vsix');
    run(['node_modules/@vscode/vsce/vsce','package','--no-dependencies','--out',output]);
    const zip=await JSZip.loadAsync(await readFile(output));
    const get=async path=>{assert(zip.file(path),`Missing VSIX entry ${path}`);return zip.file(path).async('nodebuffer');};
    assert.deepEqual(await get('extension/dist/extension.js'),await readFile(join(extension,'dist/extension.js')));
    assert.deepEqual(await get('extension/media/icon.png'),await readFile(join(extension,'media/icon.png')));
    // VSCE adds .txt to an extensionless licence; compare the exact bytes.
    assert.deepEqual(await get('extension/LICENSE.txt'),await readFile(join(root,'LICENSE')));
    assert((await get('extension/readme.md')).toString().includes('scoped MCP'));
    const manifest=JSON.parse((await get('extension/package.json')).toString());
    const source=JSON.parse(await readFile(join(extension,'package.json'),'utf8'));
    assert.equal(manifest.engines.vscode,source.engines.vscode);
    assert.deepEqual(manifest.contributes,source.contributes);
    assert.deepEqual(manifest.activationEvents,source.activationEvents);
    assert.match((await get('extension.vsixmanifest')).toString(),/<License>extension\/LICENSE\.txt<\/License>/);
    for(const name of Object.keys(zip.files))assert.doesNotMatch(name,/(?:^|\/)(?:node_modules|src|\.vscode)\/|package-lock\.json$|\.env(?:\.|$)/);
  }finally{await rm(directory,{recursive:true,force:true});}
});
