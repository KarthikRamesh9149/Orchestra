import fs from 'node:fs';
import crypto from 'node:crypto';

const manifest=JSON.parse(fs.readFileSync('docs/desktop/import-manifest.json','utf8'));
const adjustments={
 'src/app/build-app.ts':'Step 6 opt-in self-hosted desktop manifest and bearer bootstrap; managed route exposure is unchanged.',
 'src/lib/ai/index.ts':'Step 6 self-hosting without an operator key uses explicit offline providers rather than simulated generation, vectors or transcription.',
 'src/lib/storage/index.ts':'Step 6 self-hosted local storage uses the private bounded driver; hosted storage behavior remains unchanged.',
 'apps/beta-web/src/components/shell/AppShell.tsx':'Step 6 reserves space only in shared desktop windows for the persistent authoritative-server banner; existing styles retained.',
 'tests/document-service.test.ts':'Step 5 regression coverage for native source identity and authoritative desktop Drive indexing completion; inherited document tests retained.',
 'apps/beta-web/src/components/settings/DesktopSources.tsx':'Step 5 adds explicitly selected Git working-tree preview and import through native capabilities; preserves UI styling and existing folder workflow.',
 'src/modules/communications/message-indexing.service.ts':'Step 5 retain honest lexical communication evidence when desktop embedding configuration or request allowance is unavailable; no mock vectors, semantic completion remains explicit.',
 'src/modules/truth-inbox/truth-change-packet.service.ts':'Step 4 packet truth-state boundary reflects persisted accepted/rejected decisions instead of always claiming a pending decision.',
 'apps/beta-web/src/pages/DeliveryPage.tsx':'Steps 4/5 native context-pack save, clipboard and scoped MCP pairing; preserve hosted behavior and existing visual tokens.',
 'apps/beta-web/src/components/delivery/McpAgentSetup.tsx':'Step 5 dispatch desktop pairing through the protected native bridge while retaining the hosted implementation.',
 'apps/beta-web/src/pages/DashboardPage.tsx':'Step 4 maintain readable provider labels during existing hover opacity using the existing text token.',
 'apps/beta-web/src/components/shell/NavRail.tsx':'Step 4 use the existing accessible terracotta text token for selected navigation.',
 'apps/beta-web/src/pages/TimelinePage.tsx':'Step 4 reuse existing accessible teal/red theme tokens for approval and review controls; preserve layout and interaction.',
 'apps/beta-web/src/pages/TruthInboxPage.tsx':'Step 4 explicit filter names for reliable keyboard and assistive-technology operation; no styling changes.',
 'apps/beta-web/src/pages/LiveDocViewerPage.tsx':'Step 4 user-selected native original-document save; web download remains unchanged.',
 'src/modules/deep-research/service.ts':'Steps 4/5 reject unconfigured local generation before quota allocation; configured native AI uses the existing authorized research and durable worker contracts.',
 'src/modules/deep-research/schemas.ts':'Step 5 adds a strict all-fields-required native provider wire schema without changing tolerant hosted/persisted report normalization.',
 'apps/beta-web/src/store/chatStore.ts':'Step 4 bounded local-desktop draft persistence across app restart; hosted session privacy unchanged.',
 'apps/beta-web/src/components/socrates/DeepResearch.tsx':'Step 5 removes the temporary unconditional desktop guard; the authorized backend owns AI readiness validation and returns honest errors without quota allocation.',
 'apps/beta-web/src/components/socrates/DeepResearch.test.tsx':'Step 5 regression verifies configured desktop research reaches the backend while inherited research behavior remains covered.',
 'apps/beta-web/src/lib/types.ts':'Step 4 preserve authoritative partial document processing state.',
 'apps/beta-web/src/lib/api.ts':'Step 4 partial document state must not display as endlessly processing; Step 6 preserves shared login state when server logout is unconfirmed.',
 'apps/beta-web/src/lib/api.auth.test.ts':'Step 6 regression for unconfirmed shared-desktop logout; existing browser cookie contracts retained.',
 'apps/beta-web/src/context/AuthContext.tsx':'Step 6 retains shared authenticated context when remote sign-out is unconfirmed; browser behavior unchanged.',
 'apps/beta-web/src/context/AuthContext.bootstrap.test.tsx':'Step 6 shared logout failure regression alongside stale bootstrap protection.',
 'apps/beta-web/src/pages/ChatPage.tsx':'Step 4 retain first-session selection when acceptance arrives after route unmount; preserve explicit user selection and prevent duplicate pending submissions.',
 'apps/beta-web/src/pages/ChatPage.test.tsx':'Step 4 regression coverage for delayed first-session acceptance across navigation and explicit new-chat selection.',
 'apps/beta-web/src/pages/MemoryPage.tsx':'Step 4 truthful partial-processing status and authorized native clipboard feedback without redesign.',
 'apps/beta-web/src/pages/SettingsPage.tsx':'Steps 4/5 local protected AI and provider controls; Step 6 adds lazy server connection settings, preserving existing shared behavior and styling.',
 'src/modules/integrations/integrations.service.ts':'Step 4 truthful desktop capability readiness; provider qualification stays Step 5.',
 'apps/beta-web/src/lib/api/client.ts':'Step 4 credential-free local bootstrap; Step 6 disables the cross-request read cache only for isolated shared desktop windows, retaining hosted browser behavior.',
 'apps/beta-web/src/pages/WorkspacesPage.tsx':'Step 4 truthful local workspace identity and setup navigation; Step 6 reports unconfirmed sign-out using the existing error surface without restyling.',
 'apps/beta-web/src/pages/WorkspacesPage.test.tsx':'Step 6 failed sign-out regression with existing workspace performance tests retained.',
 'apps/beta-web/src/App.tsx':'Step 4 local first-run routes; Step 6 shows the selected server in isolated shared windows without changing hosted routes or styling.',
 'src/config/env.ts':'Step 2 explicit local validation; Step 6 explicit self-hosted HTTPS, stable identity, persistent private storage, offline AI and server-worker controls. Managed production restrictions remain enforced.',
 'src/setup-context.ts':'Step 2 injected PostgreSQL jobs and AI limiter, with incomplete composition rejected.',
 'src/lib/ai/provider.ts':'Step 2 explicit unavailable embedding capability; no mock vectors in offline mode.',
 'src/modules/documents/service.ts':'Steps 2/4 preserve offline lexical chunks and honest partial status. Step 5 adds private native source-document identity, idempotent version recovery and desktop-only Drive indexing state; public upload schemas and hosted approval semantics remain unchanged.',
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
