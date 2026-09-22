import fs from 'node:fs';
import crypto from 'node:crypto';

const manifest=JSON.parse(fs.readFileSync('docs/desktop/import-manifest.json','utf8'));
const adjustments={
 'package.json':'September 20 readiness follow-up: exact pdf-lib 1.17.1 replaces PDFKit while preserving PDF exports; exact semver 7.7.4 is declared for the dependency-staging build tool.',
 'package-lock.json':'September 20 readiness follow-up: lock the reviewed PDF replacement dependency closure, remove unused PDFKit dependencies and types, and declare the existing semver build-tool version without unrelated upgrades.',
 'apps/beta-web/src/pages/MemoryContextPage.tsx':'September 20 readiness follow-up: remove a repeated display title, including proven 200-character generated-title truncation; preserve the complete title, stored Markdown and citations, and prevent stale workspace/route reports from rendering.',
 'apps/beta-web/src/pages/MemoryContextPage.test.tsx':'Regressions for duplicate and capped generated headings, non-generated/distinct prefix preservation, evidence preservation, workspace clearing, late responses and denied saved-report reads.',
 'apps/beta-web/src/lib/api/research.ts':'September 20 readiness follow-up: expose the existing authorized paginated saved-research read with bounded page size, metadata validation and the shared API transport.',
 'apps/beta-web/vite.config.ts':'September 20 build-only exact-output dependency/notice sidecars; no application runtime or visual styling change.',
 'src/lib/ai-ops/ai-model-strategy.ts':'Provider-neutral desktop generation readiness and honest vendor metadata; hosted configuration remains separate.',
 'src/lib/parsers/file-safety.ts':'Security audit: bound actual ZIP inflation and validate archive interpretations before materialising DOCX/XLSX contents.',
 'src/lib/parsers/docx.ts':'Await bounded ZIP payload verification before handing document contents to Mammoth.',
 'src/lib/parsers/xlsx.ts':'Await bounded ZIP payload verification before handing workbook contents to JSZip.',
 'tests/parser-file-safety.test.ts':'Regression fixtures for forged decompressed sizes and inconsistent ZIP names, headers and payload spans.',
 'src/lib/retrieval/hybrid.ts':'Preserve document and version identity for citation targets without section anchors.',
 'tests/retrieval-hybrid-lexical.test.ts':'Regression coverage for sectionless document citation provenance.',
 'src/modules/deep-research/prompts.ts':'Require claim-local citations; September 20 approval/coverage correction retains server-owned source precedence and per-reference accepted-decision authority, with shared non-exhaustive retrieval wording and no added model calls.',
 'src/modules/deep-research/report-render.ts':'Render all citation aliases for each safely deduplicated research source in Markdown and PDF.',
 'tests/fix22-deep-research.test.ts':'Provider-neutral desktop generation readiness and expanded bibliography capacity regression coverage.',
 'tests/deep-research-citation-contract.test.ts':'Count distinct source documents and deduplicate document source links without collapsing same-title documents or counting derived truth as uploads.',
 'src/modules/deep-research/evidence.ts':'Real OpenAI research regression: retain retrieved source content instead of substituting a contextual summary; preserve evidence budgets and authorization.',
 'tests/deep-research-evidence-coverage.test.ts':'Regression proving a short contextual summary cannot replace complete retrieved source facts.',
 'src/modules/socrates/service.ts':'Owner-authorized real OpenAI verification: preserve complete relevant source sentences within the existing excerpt budget and prohibit invented list members; production unchanged.',
 'tests/socrates-v1-service.test.ts':'Regression for exact source field lists and acceptance sentences within the existing 800-character prompt budget.',
 'apps/beta-web/src/lib/api/memory.ts':'Step 7 exposes existing authorized document read/reprocess contracts for bounded status refresh and explicit failed-work retry.',
 'src/modules/communications/provider-readiness.ts':'Step 6 invitation-only Gmail cannot sync; revoked connectors may start fresh OAuth only when configuration and release gates allow, while sync and webhook remain blocked.',
 'tests/communication-providers.test.ts':'Step 6 regression for revoked connector reconnect, missing credentials and release gates.',
 'apps/beta-web/src/lib/api.integrations.test.ts':'Step 6 regression preserves explicitly allowed reconnect without revoked sync or disconnect.',
 'tests/gmail-invite-sender.test.ts':'Step 6 regression distinguishes self-hosted send-only and mailbox-evidence capabilities.',
 'apps/beta-web/src/lib/api.memory.test.ts':'Step 6 regression preserves authoritative Drive document provenance and partial processing.',
 'src/app/build-app.ts':'Step 6 opt-in self-hosted manifest/bearer bootstrap and native-only core transfer routes for desktop-local or opted-in self-hosted servers; managed route exposure is unchanged.',
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
 'apps/beta-web/src/lib/api.ts':'Steps 4/6 honest partial processing, shared logout and provider provenance; Step 7 uncached per-document processing status with cancellation.',
 'apps/beta-web/src/lib/api.auth.test.ts':'Step 6 regression for unconfirmed shared-desktop logout; existing browser cookie contracts retained.',
 'apps/beta-web/src/context/AuthContext.tsx':'Step 6 retains shared authenticated context when remote sign-out is unconfirmed; browser behavior unchanged.',
 'apps/beta-web/src/context/AuthContext.bootstrap.test.tsx':'Step 6 shared logout failure regression alongside stale bootstrap protection.',
 'apps/beta-web/src/pages/ChatPage.tsx':'Step 4 retain first-session selection when acceptance arrives after route unmount; preserve explicit user selection and prevent duplicate pending submissions.',
 'apps/beta-web/src/pages/ChatPage.test.tsx':'Step 4 regression coverage for delayed first-session acceptance across navigation and explicit new-chat selection.',
 'apps/beta-web/src/pages/MemoryPage.tsx':'Steps 4/6 partial processing, native clipboard, honest downloads and send-only Gmail exclusion; Step 7 bounded pending-document refresh with cancellation. No redesign.',
 'apps/beta-web/src/pages/MemoryPage.test.tsx':'Steps 6/7 regression verifies honest downloads, send-only Gmail exclusion and pending-document refresh, failure and workspace isolation.',
 'apps/beta-web/src/pages/SettingsPage.tsx':'Steps 4/5 local protected AI/provider controls; Step 6 server connection, encrypted transfer and explicit authorized GitHub repository linking; Step 8 local native connector panels replace misleading retained hosted projections without changing shared/web panels or styling.',
 'apps/beta-web/src/pages/SettingsPage.test.tsx':'Step 8 regression verifies local Settings does not fetch hosted integration status or imply retained evidence is a live native connection; existing hosted tests preserved.',
 'src/modules/integrations/integrations.service.ts':'Step 4 truthful desktop capability readiness; provider qualification stays Step 5.',
 'apps/beta-web/src/lib/api/client.ts':'Step 4 credential-free local bootstrap; Step 6 disables the cross-request read cache only for isolated shared desktop windows, retaining hosted browser behavior.',
 'apps/beta-web/src/pages/WorkspacesPage.tsx':'Step 4 truthful local workspace identity and setup navigation; Step 6 reports unconfirmed sign-out using the existing error surface without restyling.',
 'apps/beta-web/src/pages/WorkspacesPage.test.tsx':'Step 6 failed sign-out regression with existing workspace performance tests retained.',
 'apps/beta-web/src/App.tsx':'Step 4 local first-run routes; Step 6 shows the selected server in isolated shared windows without changing hosted routes or styling.',
 'src/config/env.ts':'Step 2 explicit local validation; Step 6 self-hosted HTTPS, stable identity, private storage, offline AI, server-worker controls and bounded operator opt-in cache settings. Managed production restrictions remain enforced.',
 'src/setup-context.ts':'Step 2 injected PostgreSQL jobs and AI limiter, with incomplete composition rejected.',
 'src/lib/ai/provider.ts':'Step 2 explicit unavailable embedding capability; no mock vectors in offline mode.',
 'src/modules/documents/service.ts':'Steps 2/4 preserve offline lexical chunks and honest partial status. Step 5 adds private native source-document identity, idempotent version recovery and desktop-only Drive indexing state; public upload schemas and hosted approval semantics remain unchanged.',
 'prisma/schema.prisma':'Step 2 desktop queue, cancellation and limiter models; original migrations unchanged.',
 'scripts/smoke/beta-browser-smoke.mjs':'Replace hosted production smoke defaults with localhost; application source unchanged.',
 'scripts/smoke/beta-browser-product-walkthrough.mjs':'Replace hosted production smoke defaults with localhost; application source unchanged.',
 'apps/vscode-extension/tsconfig.json':'Explicit Node/VS Code ambient types prevent accidental parent-workspace type loading.',
 'apps/vscode-extension/package-lock.json':'Compatible js-yaml security patch for packaging dependency advisory GHSA-2883-xcg3-v3hh.'
};
// September 20 owner-authorized BYOK and product-correctness audit. Preserve
// the prior rationale while recording this separately reviewed evolution.
for (const file of [
 'src/config/env.ts','apps/beta-web/src/pages/SettingsPage.tsx'
]) adjustments[file]+=' September 20: explicit desktop provider selection and shared-server ownership; no production configuration or UI styling changes.';
for (const file of [
 'src/modules/socrates/service.ts','tests/socrates-v1-service.test.ts',
 'src/modules/deep-research/service.ts','src/modules/deep-research/schemas.ts',
 'tests/deep-research-citation-contract.test.ts','tests/deep-research-evidence-coverage.test.ts',
 'apps/beta-web/src/components/socrates/DeepResearch.tsx',
 'apps/beta-web/src/components/socrates/DeepResearch.test.tsx','apps/beta-web/src/lib/api.ts'
]) adjustments[file]+=' September 20: bounded multi-document coverage, strict citation validation and identity-safe bibliography aliases; provider-aware AI readiness and neutral unsupported readiness fallback. Historical reports remain unchanged.';
adjustments['src/modules/deep-research/service.ts']+=' Packaged natural-question regression: index-backed original-document recall, current-version provenance, source-domain coverage and explicit failure when selected uploaded documents were not retrieved; derived notes cannot establish document absence.';
const changes=[];
adjustments['.gitattributes']='Readiness follow-up: preserve the exact hash-pinned upstream Unicode Zapf Dingbats notice bytes and intentional trailing whitespace; no broad whitespace exemption.';
adjustments['src/modules/socrates/service.ts']+=' Readiness follow-up: preserve upstream document relevance in non-temporal score ties and measure stored-vector document ranking without changing project/current-version filters or evidence caps; clarify source identity, source-claim versus accepted-truth status, relevant temporal caveats and uncertainty of offline excerpt matches.';
adjustments['src/modules/socrates/service.ts']+=' Approval/coverage follow-up: compute accepted reference authority from the final prompt evidence, distinguish documentary approval claims from recorded decisions, and prohibit unsupported source-exclusivity wording.';
adjustments['tests/socrates-v1-service.test.ts']+=' Verify the same approval and coverage contracts for streaming and object generation with unaccepted document evidence.';
adjustments['prisma/schema.prisma']+=' Readiness follow-up: additive database-maintained document search vector; original migration history and hosted deployment state remain untouched.';
adjustments['src/modules/deep-research/report-render.ts']+=' Readiness follow-up: replace the PDFKit dependency with pinned PDF-lib, retain complete report text and existing colours, and fail explicitly on unsupported PDF glyphs with a lossless Markdown alternative.';
adjustments['tests/p2-negative-inputs.test.ts']='Readiness follow-up: generate the existing PDF parser fixture using the replacement PDF library; preserve parser assertions.';
for (const file of ['apps/beta-web/src/components/socrates/DeepResearch.tsx','apps/beta-web/src/components/socrates/DeepResearch.test.tsx']) adjustments[file]+=' Readiness follow-up: expose existing PDF/Markdown export contracts, preserve download failures and guard duplicate submissions.';
for (const file of ['scripts/ops/verify-staging-runtime.ts','scripts/diag-socrates-v1.ts','scripts/smoke/beta-smoke.ts']) adjustments[file]='Readiness follow-up: preserve the existing synthetic PDF fixture contents using the replacement PDF library so retained diagnostic tools remain buildable; no hosted runtime execution or deployment is performed.';
for (const file of ['apps/beta-web/src/lib/api/client.ts','apps/beta-web/src/lib/api/client.test.ts','apps/beta-web/src/lib/api.research.test.ts','apps/beta-web/src/pages/MemoryPage.tsx','apps/beta-web/src/pages/MemoryPage.test.tsx']) {
 adjustments[file]=(adjustments[file] ? adjustments[file]+' ' : '')+'September 20 readiness follow-up: discover saved generated research through the existing authorized context endpoint, retain envelope pagination and shared timeout/auth/error behavior, isolate workspace state and keep original evidence counts separate.';
}
// User-authorized UI copy cleanup during Step 8; no styling or behavior changes.
for (const file of ['ChatPage.tsx','ChatPage.test.tsx','DeliveryPage.tsx','TruthInboxPage.tsx','TruthChangePacketPage.tsx','WatchtowerPage.tsx']) {
 const key=`apps/beta-web/src/pages/${file}`;
 adjustments[key]=(adjustments[key] ? adjustments[key]+' ' : '')+'Step 8 user-requested concise UI copy; preserve evidence warnings, cancellation uncertainty, authorization and visual classes.';
}
// September 22: independently reviewed citation-contract repair. Preserve the
// original prompt identity through projection, streaming completion and history;
// only explicit, unique, safe target mappings become inline links. No UI restyle.
for (const file of ['src/modules/socrates/service.ts','tests/socrates-v1-service.test.ts',
 'apps/beta-web/src/components/ui/SocratesMarkdown.tsx','apps/beta-web/src/components/ui/SocratesMarkdown.test.tsx',
 'apps/beta-web/src/lib/api.ts','apps/beta-web/src/lib/api.socrates.test.ts',
 'apps/beta-web/src/store/chatStore.ts','apps/beta-web/src/pages/ChatPage.tsx','apps/beta-web/src/pages/ChatPage.test.tsx']) {
 adjustments[file]=(adjustments[file] ? adjustments[file]+' ' : '')+'September 22: stable explicit evidence ordinals, complete bounded cited-source projection and safe exact-target links; legacy references are not guessed. Red regressions and independent review recorded.';
}
adjustments['apps/beta-web/src/pages/MemoryPage.test.tsx']+=' September 22 clean-source suite: hold the mocked processing response until the initial visible state is observed, removing an animation/status race without changing the application or weakening visibility assertions.';
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
