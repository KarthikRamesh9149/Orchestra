import fs from 'node:fs';
import crypto from 'node:crypto';

const manifest=JSON.parse(fs.readFileSync('docs/desktop/import-manifest.json','utf8'));
const adjustments={
 'src/modules/communications/message-indexing.service.ts':'Step 5 retain honest lexical communication evidence when desktop embedding configuration or request allowance is unavailable; no mock vectors, semantic completion remains explicit.',
 'src/modules/truth-inbox/truth-change-packet.service.ts':'Step 4 packet truth-state boundary reflects persisted accepted/rejected decisions instead of always claiming a pending decision.',
 'apps/beta-web/src/pages/DeliveryPage.tsx':'Steps 4/5 native context-pack save, clipboard and scoped MCP pairing; preserve hosted behavior and existing visual tokens.',
 'apps/beta-web/src/components/delivery/McpAgentSetup.tsx':'Step 5 dispatch desktop pairing through the protected native bridge while retaining the hosted implementation.',
 'apps/beta-web/src/pages/DashboardPage.tsx':'Step 4 maintain readable provider labels during existing hover opacity using the existing text token.',
 'apps/beta-web/src/components/shell/NavRail.tsx':'Step 4 use the existing accessible terracotta text token for selected navigation.',
 'apps/beta-web/src/pages/TimelinePage.tsx':'Step 4 reuse existing accessible teal/red theme tokens for approval and review controls; preserve layout and interaction.',
 'apps/beta-web/src/pages/TruthInboxPage.tsx':'Step 4 explicit filter names for reliable keyboard and assistive-technology operation; no styling changes.',
 'apps/beta-web/src/pages/LiveDocViewerPage.tsx':'Step 4 user-selected native original-document save; web download remains unchanged.',
 'src/modules/deep-research/service.ts':'Step 4 reject unconfigured local generation before job creation or quota allocation.',
 'apps/beta-web/src/store/chatStore.ts':'Step 4 bounded local-desktop draft persistence across app restart; hosted session privacy unchanged.',
 'apps/beta-web/src/components/socrates/DeepResearch.tsx':'Step 4 explicitly prevent unconfigured desktop research generation; qualification remains Step 5.',
 'apps/beta-web/src/lib/types.ts':'Step 4 preserve authoritative partial document processing state.',
 'apps/beta-web/src/lib/api.ts':'Step 4 partial document state must not display as endlessly processing.',
 'apps/beta-web/src/pages/ChatPage.tsx':'Step 4 retain first-session selection when acceptance arrives after route unmount; preserve explicit user selection and prevent duplicate pending submissions.',
 'apps/beta-web/src/pages/ChatPage.test.tsx':'Step 4 regression coverage for delayed first-session acceptance across navigation and explicit new-chat selection.',
 'apps/beta-web/src/pages/MemoryPage.tsx':'Step 4 truthful partial-processing status and authorized native clipboard feedback without redesign.',
 'apps/beta-web/src/pages/SettingsPage.tsx':'Steps 4/5 unavailable local invitations plus lazy desktop-only protected AI, explicit folder sources and native Slack controls; preserve shared workflow and styling.',
 'src/modules/integrations/integrations.service.ts':'Step 4 truthful desktop capability readiness; provider qualification stays Step 5.',
 'apps/beta-web/src/lib/api/client.ts':'Step 4 local bootstrap uses the credential-free desktop bridge; hosted browser sessions unchanged.',
 'apps/beta-web/src/pages/WorkspacesPage.tsx':'Step 4 truthful local workspace identity and setup navigation, retaining original style.',
 'apps/beta-web/src/App.tsx':'Step 4 local first-run routes; preserve hosted routes and styling.',
 'src/config/env.ts':'Step 2 explicit local runtime validation; retain managed production controls.',
 'src/setup-context.ts':'Step 2 injected PostgreSQL jobs and AI limiter, with incomplete composition rejected.',
 'src/lib/ai/provider.ts':'Step 2 explicit unavailable embedding capability; no mock vectors in offline mode.',
 'src/modules/documents/service.ts':'Steps 2/4 preserve offline lexical chunks and honest partial status; enqueue deterministic source projections after desktop uploads without changing the hosted beta shortcut.',
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
