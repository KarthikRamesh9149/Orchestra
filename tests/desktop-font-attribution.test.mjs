import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,readFile,writeFile,rm,lstat,symlink,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {inflateSync,deflateSync} from 'node:zlib';
import {build} from 'esbuild';
import {normalizeFontAttribution,validateFontAttribution} from '../scripts/desktop/font-attribution.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),sourceModules=join(root,'node_modules');
const specificationPath=join(root,'docs/desktop/third-party/pdf-standard-fonts-transform.json');
const spec=JSON.parse(await readFile(specificationPath)),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const require=createRequire(import.meta.url);
const decode=bytes=>JSON.parse(inflateSync(Buffer.from(JSON.parse(bytes),'base64')));
const encode=value=>Buffer.from(JSON.stringify(deflateSync(Buffer.from(JSON.stringify(value)),{level:9}).toString('base64'))+'\n');
const std='@pdf-lib/standard-fonts';
async function fixture() {
  const temp=await realpath(await mkdtemp(join(tmpdir(),'orch-font-notice-'))),modules=join(temp,'node_modules');
  await mkdir(join(modules,'@pdf-lib'),{recursive:true});
  for(const name of ['pdf-lib','@pdf-lib/standard-fonts','@pdf-lib/upng','pako'])await cp(join(sourceModules,name),join(modules,name),{recursive:true});
  return {temp,modules};
}
async function normalize(modules){return normalizeFontAttribution({sourceModules,stagedModules:modules,specificationPath});}
async function validate(modules,report){return validateFontAttribution({modules,specificationPath,report});}
function sameMetrics(before,after) {
  assert.equal(after.Notice,before.Notice);
  assert.deepEqual(after.CharWidths,before.CharWidths);
  assert.deepEqual(after.KernPairXAmounts,before.KernPairXAmounts);
  assert.equal(after[spec.metadata.key],spec.metadata.value);
}

test('pinned staged transform preserves all metrics, encodings, Node/ESM consumers and actual report PDF rendering',async()=>{
  const {temp,modules}=await fixture();
  try {
    const report=await normalize(modules);
    assert.deepEqual(await validate(modules,report),{verified:true,metricCopies:28,omittedUnusedBundles:6});
    for(const target of spec.targets) {
      const original=await readFile(join(sourceModules,std,target.path)),staged=await readFile(join(modules,std,target.path));
      assert.equal(sha(original),target.sha256,'source installation is unchanged');
      const object=decode(staged);assert.equal(Object.keys(object)[0],spec.metadata.key);
      delete object[spec.metadata.key];assert.deepEqual(object,decode(original));
    }
    for(const omitted of report.omittedFiles) {
      assert.equal(sha(await readFile(join(sourceModules,omitted.package,omitted.path))),omitted.originalSha256);
      await assert.rejects(lstat(join(modules,omitted.package,omitted.path)),{code:'ENOENT'});
    }
    const original=require(std),staged=createRequire(join(temp,'test.cjs'))(std);
    const esm=await build({entryPoints:[join(modules,std,'es/index.js')],bundle:true,platform:'node',format:'cjs',write:false});
    await writeFile(join(temp,'font-esm.cjs'),esm.outputFiles[0].contents);
    const stagedEsm=createRequire(join(temp,'test.cjs'))('./font-esm.cjs');
    for(const font of new Set(spec.targets.map(t=>t.font))) {
      sameMetrics(original.Font.load(font),staged.Font.load(font));
      sameMetrics(original.Font.load(font),stagedEsm.Font.load(font));
    }
    const rendered=await build({entryPoints:[join(root,'src/modules/deep-research/report-render.ts')],bundle:true,platform:'node',format:'cjs',external:['pdf-lib'],write:false});
    await writeFile(join(temp,'renderer.cjs'),rendered.outputFiles[0].contents);
    const {renderReportPdf}=createRequire(join(temp,'test.cjs'))('./renderer.cjs');
    const bytes=await renderReportPdf('Staged notice verification',{
      stats:{totalSources:1,slackMessages:0,commits:0,docs:1,webSources:0,duration:'1s'},
      executiveSummary:'Font metrics remain unchanged after the explicit notice addition.',findings:[],marketContext:[],
      expansionOpportunities:[],recommendedActions:[],sources:[]
    });
    const {PDFParse}=require('pdf-parse'),parser=new PDFParse({data:bytes});
    try {
      const parsed=await parser.getText();
      assert.equal(parsed.total,1);assert.match(parsed.text,/Staged notice verification/);assert.match(parsed.text,/Font metrics remain unchanged/);
    }finally{await parser.destroy();}
    assert(createRequire(join(temp,'test.cjs')).resolve('pdf-lib').startsWith(temp));
  }finally{await rm(temp,{recursive:true,force:true});}
});

test('normalization is deterministic across fresh stages and never targets source node_modules',async()=>{
  const first=await fixture(),second=await fixture();
  try {
    const a=await normalize(first.modules),b=await normalize(second.modules);assert.deepEqual(a,b);
    await assert.rejects(normalizeFontAttribution({sourceModules,stagedModules:sourceModules,specificationPath}),/cannot mutate source/);
    await assert.rejects(normalize(first.modules),/Unreviewed original metric bytes/);
  }finally{await rm(first.temp,{recursive:true,force:true});await rm(second.temp,{recursive:true,force:true});}
});

test('entire original batch is validated before writes and unreviewed entrypoints or symlink directories fail closed',async()=>{
  const {temp,modules}=await fixture();
  try {
    const last=spec.targets.at(-1),first=spec.targets[0],path=join(modules,std,last.path);
    await writeFile(path,'"invalid"');await assert.rejects(normalize(modules),/Unreviewed original/);
    assert.equal(sha(await readFile(join(modules,std,first.path))),first.sha256);
    await cp(join(sourceModules,std,last.path),path);
    const pkgPath=join(modules,'pdf-lib/package.json'),pkg=JSON.parse(await readFile(pkgPath));
    pkg.browser='dist/pdf-lib.js';await writeFile(pkgPath,JSON.stringify(pkg));
    await assert.rejects(normalize(modules),/entrypoint configuration/);
    delete pkg.browser;await writeFile(pkgPath,JSON.stringify(pkg));
    const folder=join(modules,std,'lib');await rm(folder,{recursive:true});await symlink(join(sourceModules,std,'lib'),folder);
    await assert.rejects(normalize(modules),/directory must not be a symlink/);
  }finally{await rm(temp,{recursive:true,force:true});}
});

test('artifact verification rejects data edits even with rewritten report hashes, encoding changes and reintroduced bundles',async()=>{
  const {temp,modules}=await fixture();
  try {
    const report=await normalize(modules),target=spec.targets[0],path=join(modules,std,target.path),original=await readFile(path);
    const object=decode(original);object.CharMetrics[0].WX+=1;
    const changed=encode(object);await writeFile(path,changed);
    const forged=structuredClone(report),record=forged.targets.find(t=>t.path===target.path);
    record.stagedSha256=sha(changed);record.stagedInflatedSha256=sha(inflateSync(Buffer.from(JSON.parse(changed),'base64')));
    await assert.rejects(validate(modules,forged),/Functional font metric data changed/);
    await writeFile(path,original);
    const encoding=join(modules,std,spec.excluded.encodingPaths[0].path),before=await readFile(encoding);
    await writeFile(encoding,'"altered"');await assert.rejects(validate(modules,report),/Encoding integrity mismatch/);await writeFile(encoding,before);
    const omitted=report.omittedFiles.find(o=>o.package==='pdf-lib');
    await cp(join(sourceModules,omitted.package,omitted.path),join(modules,omitted.package,omitted.path));
    await assert.rejects(validate(modules,report),/Unlabelled bundled file/);
  }finally{await rm(temp,{recursive:true,force:true});}
});
