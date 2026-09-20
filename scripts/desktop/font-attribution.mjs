// Explicit, narrowly pinned post-copy transformation. Never modifies installed sources.
import {readFile,writeFile,lstat,realpath,readdir,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {inflateSync,deflateSync} from 'node:zlib';
import {join,relative,isAbsolute,sep} from 'node:path';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const PACKAGE = '@pdf-lib/standard-fonts';
const KEY = '_orchestraAttribution';
const FONTS = ['Courier','Courier-Bold','Courier-BoldOblique','Courier-Oblique','Helvetica','Helvetica-Bold',
  'Helvetica-BoldOblique','Helvetica-Oblique','Symbol','Times-Bold','Times-BoldItalic','Times-Italic','Times-Roman','ZapfDingbats'];
const UMD = ['dist/standard-fonts.js','dist/standard-fonts.min.js'];
const PDF_BUNDLES = ['dist/pdf-lib.esm.js','dist/pdf-lib.esm.min.js','dist/pdf-lib.js','dist/pdf-lib.min.js'];
const ENCODINGS = ['es/all-encodings.compressed.json','lib/all-encodings.compressed.json'];
async function file(path) {
  if (!(await lstat(path)).isFile()) throw new Error('Font attribution requires regular files');
  return readFile(path);
}
async function specification(path) {
  const bytes=await file(path), spec=JSON.parse(bytes);
  if(spec.formatVersion!==1||spec.package!==PACKAGE||spec.version!=='1.0.0'||spec.metadata.key!==KEY
    ||typeof spec.metadata.value!=='string'||!/^[\x20-\x7e]+$/.test(spec.metadata.value))throw new Error('Unreviewed font attribution specification');
  const expected=['es','lib'].flatMap(dir=>FONTS.map(font=>`${dir}/${font}.compressed.json`)).sort();
  if(JSON.stringify(spec.targets.map(t=>t.path).sort())!==JSON.stringify(expected))throw new Error('Expected exactly 28 reviewed metric copies');
  const omissions=spec.excluded.umdPaths;
  if(JSON.stringify(omissions.map(o=>o.path).sort())!==JSON.stringify(UMD))throw new Error('Only the two reviewed UMD files may be omitted');
  if(spec.excluded.pdfLibBundles.package!=='pdf-lib'||spec.excluded.pdfLibBundles.version!=='1.17.1'
    ||JSON.stringify(spec.excluded.pdfLibBundles.paths.map(o=>o.path).sort())!==JSON.stringify(PDF_BUNDLES))throw new Error('Only the four reviewed pdf-lib bundles may be omitted');
  if(JSON.stringify(spec.excluded.encodingPaths.map(o=>o.path).sort())!==JSON.stringify(ENCODINGS))throw new Error('Expected exact unchanged encoding anchors');
  for(const entry of [...spec.targets,...omissions,...spec.excluded.pdfLibBundles.paths,...spec.excluded.encodingPaths]) {
    if(!/^[a-f0-9]{64}$/.test(entry.sha256))throw new Error('Invalid original font data hash');
  }
  return {spec,sha256:sha(bytes)};
}
async function packageFolder(modules,name,dirs) {
  let folder=modules;
  for(const part of name.split('/')) {
    folder=join(folder,part);
    if(!(await lstat(folder)).isDirectory())throw new Error('Font attribution package must not be a symlink');
  }
  for(const dir of dirs)if(!(await lstat(join(folder,dir))).isDirectory())throw new Error('Font attribution directory must not be a symlink');
  return folder;
}
function decode(bytes) {
  const base64=JSON.parse(bytes.toString('utf8'));
  if(typeof base64!=='string'||base64.length>1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw new Error('Invalid compressed font metrics');
  const inflated=inflateSync(Buffer.from(base64,'base64'),{maxOutputLength:1024*1024}),value=JSON.parse(inflated);
  if(!value||Array.isArray(value)||typeof value.Notice!=='string')throw new Error('Font metric copyright notice missing');
  return {inflated,value};
}
function stripAndCheck(bytes,target,spec) {
  const {inflated,value}=decode(bytes);
  if(value[KEY]!==spec.metadata.value)throw new Error('Font modification notice missing or changed');
  delete value[KEY];
  if(sha(Buffer.from(JSON.stringify(value)))!==target.inflatedSha256)throw new Error('Functional font metric data changed');
  return sha(inflated);
}
async function checkEntrypoints(folder,pdfFolder) {
  const pkg=JSON.parse(await file(join(folder,'package.json')));
  if(pkg.name!==PACKAGE||pkg.version!=='1.0.0'||pkg.main!=='lib/index.js'||pkg.module!=='es/index.js'
    ||pkg.browser!==undefined||pkg.exports!==undefined)throw new Error('Unreviewed standard-fonts entrypoint configuration');
  for(const dir of ['es','lib'])for(const name of await readdir(join(folder,dir)))if(name.endsWith('.js')) {
    if(/standard-fonts(?:\.min)?\.js|\.\.\/dist\//.test((await file(join(folder,dir,name))).toString('utf8')))throw new Error('Retained module references an omitted UMD file');
  }
  const pdf=JSON.parse(await file(join(pdfFolder,'package.json')));
  if(pdf.name!=='pdf-lib'||pdf.version!=='1.17.1'||pdf.main!=='cjs/index.js'||pdf.module!=='es/index.js'
    ||pdf.browser!==undefined||pdf.exports!==undefined)throw new Error('Unreviewed pdf-lib entrypoint configuration');
  async function checkReferences(dir) {
    for(const entry of await readdir(dir,{withFileTypes:true})) {
      const path=join(dir,entry.name);
      if(entry.isSymbolicLink())throw new Error('Retained PDF module must not be a symlink');
      if(entry.isDirectory())await checkReferences(path);
      else if(entry.name.endsWith('.js')) {
        const source=(await file(path)).toString('utf8');
        for(const match of source.matchAll(/\b(?:require\s*\(\s*|import\s*\(\s*|from\s+|import\s+)(['"])([^'"]+)\1/g)) {
          if(/pdf-lib(?:\.esm)?(?:\.min)?\.js|(?:\.\.\/)+dist\//.test(match[2]))throw new Error('Retained module references an omitted PDF bundle');
        }
      }
    }
  }
  for(const dir of ['cjs','es'])await checkReferences(join(pdfFolder,dir));
}

export async function normalizeFontAttribution({sourceModules,stagedModules,specificationPath}) {
  sourceModules=await realpath(sourceModules);stagedModules=await realpath(stagedModules);
  const rel=relative(sourceModules,stagedModules);
  if(!rel||(!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel)))throw new Error('Font notice normalizer cannot mutate source node_modules');
  const {spec,sha256:specificationSha256}=await specification(specificationPath);
  const folder=await packageFolder(stagedModules,PACKAGE,['es','lib','dist']);
  const pdfFolder=await packageFolder(stagedModules,'pdf-lib',['es','cjs','dist']);
  await packageFolder(sourceModules,PACKAGE,['es','lib','dist']);
  await packageFolder(sourceModules,'pdf-lib',['es','cjs','dist']);
  await checkEntrypoints(folder,pdfFolder);
  const writes=[],omissions=[];
  // Validate the entire input batch before any staged mutation.
  for(const target of spec.targets) {
    const original=await file(join(sourceModules,PACKAGE,target.path)),staged=await file(join(folder,target.path));
    if(sha(original)!==target.sha256||!staged.equals(original))throw new Error('Unreviewed original metric bytes: '+target.path);
    const {inflated,value}=decode(original);
    if(sha(inflated)!==target.inflatedSha256||Object.hasOwn(value,KEY))throw new Error('Unreviewed original metric object');
    // First key makes the representation-change disclosure prominent on decode.
    const nextInflated=Buffer.from(JSON.stringify({[KEY]:spec.metadata.value,...value}));
    const output=Buffer.from(JSON.stringify(deflateSync(nextInflated,{level:9}).toString('base64'))+'\n');
    stripAndCheck(output,target,spec);
    writes.push({path:target.path,output,originalSha256:target.sha256,originalInflatedSha256:target.inflatedSha256,
      stagedSha256:sha(output),stagedInflatedSha256:sha(nextInflated)});
  }
  for(const [name,entries] of [[PACKAGE,spec.excluded.umdPaths],['pdf-lib',spec.excluded.pdfLibBundles.paths]])for(const omitted of entries) {
    if(sha(await file(join(sourceModules,name,omitted.path)))!==omitted.sha256
      ||sha(await file(join(stagedModules,name,omitted.path)))!==omitted.sha256)throw new Error('Unreviewed bundled bytes: '+omitted.path);
    omissions.push({package:name,path:omitted.path,originalSha256:omitted.sha256,reason:'Unused browser distribution contains duplicate metric data; native Node/CJS and ESM entrypoints are retained.'});
  }
  const encodings=[];
  for(const {path,sha256} of spec.excluded.encodingPaths) {
    const source=await file(join(sourceModules,PACKAGE,path)),staged=await file(join(folder,path));
    if(sha(source)!==sha256||!staged.equals(source))throw new Error('Encoding data changed');
    encodings.push({path,sha256:sha(source)});
  }
  for(const item of writes)await writeFile(join(folder,item.path),item.output);
  for(const item of omissions)await unlink(join(stagedModules,item.package,item.path));
  const report={formatVersion:1,kind:'standard-fonts-attribution-only',package:PACKAGE,version:'1.0.0',specificationSha256,
    metadata:spec.metadata,compression:{format:'zlib',level:9,node:process.versions.node,zlib:process.versions.zlib},
    targets:writes.map(({output,...item})=>item),omittedFiles:omissions,unchangedEncodings:encodings,
    limitations:['Explicitly transformed staged package, not an unchanged npm archive','Notice attachment and equality evidence, not blanket legal certification']};
  await validateFontAttribution({modules:stagedModules,specificationPath,report});
  return report;
}

export async function validateFontAttribution({modules,specificationPath,report}) {
  modules=await realpath(modules);
  const {spec,sha256:specificationSha256}=await specification(specificationPath);
  const folder=await packageFolder(modules,PACKAGE,['es','lib','dist']);
  const pdfFolder=await packageFolder(modules,'pdf-lib',['es','cjs','dist']);
  if(report.formatVersion!==1||report.kind!=='standard-fonts-attribution-only'||report.specificationSha256!==specificationSha256
    ||report.package!==PACKAGE||report.version!=='1.0.0'||JSON.stringify(report.metadata)!==JSON.stringify(spec.metadata)
    ||report.targets.length!==28)throw new Error('Invalid font attribution transform report');
  await checkEntrypoints(folder,pdfFolder);
  for(const target of spec.targets) {
    const matches=report.targets.filter(t=>t.path===target.path);
    if(matches.length!==1)throw new Error('Missing/duplicate metric transform record');
    const record=matches[0],bytes=await file(join(folder,target.path));
    if(record.originalSha256!==target.sha256||record.originalInflatedSha256!==target.inflatedSha256
      ||record.stagedSha256!==sha(bytes)||record.stagedInflatedSha256!==stripAndCheck(bytes,target,spec))throw new Error('Metric transform integrity mismatch');
  }
  if(report.omittedFiles.length!==6)throw new Error('Invalid bundle omission record');
  for(const [name,entries] of [[PACKAGE,spec.excluded.umdPaths],['pdf-lib',spec.excluded.pdfLibBundles.paths]])for(const omitted of entries) {
    if(report.omittedFiles.filter(o=>o.package===name&&o.path===omitted.path&&o.originalSha256===omitted.sha256).length!==1)throw new Error('Bundle omission identity mismatch');
    try {await lstat(join(modules,name,omitted.path));throw new Error('Unlabelled bundled file remains in artifact');}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  if(report.unchangedEncodings.length!==2)throw new Error('Invalid encoding evidence');
  for(const {path,sha256} of spec.excluded.encodingPaths) {
    const records=report.unchangedEncodings.filter(x=>x.path===path);
    if(records.length!==1||records[0].sha256!==sha256||sha(await file(join(folder,path)))!==sha256)throw new Error('Encoding integrity mismatch');
  }
  return {verified:true,metricCopies:28,omittedUnusedBundles:6};
}
