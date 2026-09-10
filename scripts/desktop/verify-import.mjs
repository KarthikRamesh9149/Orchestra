import fs from 'node:fs';
import crypto from 'node:crypto';

const manifest=JSON.parse(fs.readFileSync('docs/desktop/import-manifest.json','utf8'));
const adjustments={
 'src/config/env.ts':'Step 2 explicit local runtime validation; retain managed production controls.',
 'src/setup-context.ts':'Step 2 injected PostgreSQL jobs and AI limiter, with incomplete composition rejected.',
 'src/lib/ai/provider.ts':'Step 2 explicit unavailable embedding capability; no mock vectors in offline mode.',
 'src/modules/documents/service.ts':'Step 2 preserve lexical chunks when embeddings are unavailable; mark partial honestly.',
 'prisma/schema.prisma':'Step 2 desktop queue, cancellation and limiter models; original migrations unchanged.',
 'scripts/smoke/beta-browser-smoke.mjs':'Replace hosted production smoke defaults with localhost; application source unchanged.',
 'scripts/smoke/beta-browser-product-walkthrough.mjs':'Replace hosted production smoke defaults with localhost; application source unchanged.',
 'apps/vscode-extension/tsconfig.json':'Explicit Node/VS Code ambient types prevent accidental parent-workspace type loading.',
 'apps/vscode-extension/package-lock.json':'Compatible js-yaml security patch for packaging dependency advisory GHSA-2883-xcg3-v3hh.'
};
const changes=[];
for(const entry of manifest.files){
 if(entry.disposition!=='included')continue;
 if(!fs.existsSync(entry.path))throw new Error(`Missing imported source: ${entry.path}`);
 const sha=crypto.createHash('sha256').update(fs.readFileSync(entry.path)).digest('hex');
 if(sha!==entry.sourceSha256){
  if(!adjustments[entry.path])throw new Error(`Unreviewed source alteration: ${entry.path}`);
  changes.push({path:entry.path,sourceSha256:entry.sourceSha256,importedSha256:sha,reason:adjustments[entry.path]});
 }
}
const report={sourceSha:manifest.sourceSha,unchangedImportedFiles:manifest.files.filter(e=>e.disposition==='included').length-changes.length,changes};
const serialized=JSON.stringify(report,null,2)+'\n';
if(process.argv.includes('--check')){
 if(fs.readFileSync('docs/desktop/import-adjustments.json','utf8')!==serialized)throw new Error('Import review hash drift');
}else fs.writeFileSync('docs/desktop/import-adjustments.json',serialized);
console.log(JSON.stringify({unchanged:report.unchangedImportedFiles,reviewedChanges:changes.length}));
