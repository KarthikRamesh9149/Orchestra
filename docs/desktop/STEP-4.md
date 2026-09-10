# Step 4: local UI implementation and acceptance checkpoint

Status: **In progress. Do not merge Step 4 into main yet.**

Repository: private `KarthikRamesh9149/Orchestra`, branch `codex/desktop-step-4`, based on completed Mac Step 3 `34a4b51`. Windows is deferred by the user. No production repository, hosted service, public release, paid Actions or provider account was changed.

## Implemented

- Local first-run privacy acknowledgement, continue-without-AI path, local owner identity and persistent workspace selection.
- Reviewed method/path native API adapter; main-process credentials, existing server authorization, bounded request bodies and streamed responses. UUIDs, composite Inbox IDs and bounded source-path parameters are distinguished explicitly.
- Existing React pages reuse the local engine, without redesigning their styling.
- Durable local chat/draft continuity across application quit/reopen; hosted browser session-storage behaviour remains unchanged.
- Explicit partial document processing instead of an endless spinner when offline semantic indexing is unavailable.
- Native original-document Save dialog, authorized source fetch, bounded atomic file write, cancellation and error handling. No renderer-selected filesystem destination.
- Local Settings retains rename and appearance. Invitations, hosted passwords, provider actions and research generation are explicitly unavailable where qualification belongs to Steps 5–6. No fabricated provider success or AI output.
- Checked-in local route inventory and original-source change provenance.

## Verified packaged Mac journeys

Run `node scripts/desktop/ui-smoke.mjs` against the current internal package. This creates synthetic data in a fresh temporary profile with an empty PATH; no hosted credentials are used.

Verified in the consolidated run:

1. Privacy acknowledgement, local workspace creation and selection.
2. PDF upload, extracted-text document viewing and original-byte preservation through native save.
3. Socrates retrieves the synthetic pilot date with a document source and explicit evidence-only fallback label.
4. Chat and unsent draft survive feature navigation and application restart.
5. Dashboard, Memory, Timeline, Chat, Truth Inbox, Delivery and Settings load without HTTP access failures or renderer exceptions.
6. Workspace rename and a zero-cost subscription **record** survive reload; no subscription was purchased.
7. Two independent chats and authoritative deletion of one chat survive reload.

`ui-followup.mjs` accepts only a synthetic profile produced by the smoke harness. Follow-up verification confirmed that deletion preserves the other chat and its cited transcript after restart, and that manual Timeline events, appearance preference and evidence-backed executive briefs persist.

Native-save testing supplies a synthetic destination through a test replacement of the OS save-dialog result. It verifies the real authorized download and file-writing implementation, not a manually operated native save panel. UI scripts use Playwright Electron; no Browser plugin was installed because no supported installation action was available.

Automated verification: **1,377 backend tests passed; 195 frontend tests passed**. Backend and desktop typechecks, frontend production build, original-source hash/inventory checks, focused native security tests and the local security scanner passed. Thirteen optional database tests remain skipped in the general suite; they are not relabelled as passes. The final consolidated packaged smoke completed with zero recorded renderer exceptions or HTTP failures.

## Remaining Step 4 acceptance work

The main workflows above are not evidence that every parity row is complete. Keep the gate open for:

- Packaged Truth Inbox/Change Packet/impact-map accept/reject/assign/snooze workflows using controlled populated truth fixtures, including Product Brain and Live Doc persistence.
- Delivery traces/receipts, FDE findings, feedback and all corresponding source-navigation/failure paths with populated evidence.
- Upload cancellation/reconciliation/removal and streamed-request cancellation across navigation and process interruption through the packaged UI, beyond the existing service/unit coverage.
- Complete keyboard/focus, resizing/zoom and failure/restart coverage against the action inventory; repeatable startup and warm-route measurements. No p95 performance certification is claimed.
- Explicit review of AI-dependent UI states. Real external generation and connector/agent-client qualification remain Step 5, and shared workflows remain Step 6; unavailable states are not functional certification of those features.

The generated feature inventory deliberately remains a structural inventory, not a blanket passing runtime ledger. Step 4 must not be marked complete or merged until its remaining acceptance work is evidenced.
