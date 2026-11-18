# November desktop audit follow-up

Scope: Mac ARM internal packages and the separate Orchestra source repository.
This change does not publish downloads, change repository visibility, or deploy
the hosted product.

| Audit item | Correction | Acceptance check |
|---|---|---|
| 6 · Slack and GitHub stop on busy sources | Bound each batch, checkpoint the selected provider, resume without marking a partial import complete. Slack reconciles omissions only after the complete window is confirmed; explicit tombstones still apply. | 199/200/201-item fixtures, saved checkpoints, repeated-page rejection, and real PostgreSQL restart/reconciliation. |
| 7 · Generation-only research spends a slot | Refuse before quota allocation and point to AI/indexing settings when embeddings are unavailable. A queued run that no longer has an embedding index also fails without using a slot. | Check unchanged quota and no enqueue at admission; run a real report with working embeddings. |
| 8 · Drive repeats unchanged downloads | Confirm current provider access and compare the durable, authorized document version before requesting bytes. | No media request for an unchanged version; changed, trashed and revoked controls; durable revision lookup under the restricted PostgreSQL role. |
| 9 · Sales advice becomes timestamps | Keep quantities distinct from durations; separate source-recorded approval from acceptance in Orchestra. | Original Helix question with real OpenAI and two supporting source documents; preserve the elapsed-time guard. |
| 10 · Accepted packets look pending | Headline the stored decision, separately from whether someone may act on it. | Open/reopen pending, accepted, rejected and read-only fixtures. |
| 11 · Slow process-cold startup | Overlap renderer load with verified native provisioning. Skip CLI startup only when the authoritative migration ledger matches the bundled names and checksums. | Twenty process-cold launches on one populated Mac, sixty warm navigations, record the first migration launch separately from steady launches. |
| 12 · Report citations open generic pages | Open a precise document revision or authorized stored evidence; show excerpt/limitations instead of a misleading link when no exact target is known. | Source-by-source projection, renderer clicks, and live database access checks for retained and withdrawn messages. |
| 13 · Done toggles disappear | Store completed actions by actor, run and stable action ID. Reopen a report by URL and confirm saved state from the API. | Reload/reopen and run/viewer isolation; real database restart and model-generated recommendation. |
| 17 · Stale migration count | Compare exact reviewed migration names and hashes on fresh apply and replay. | Missing, edited, unknown, unfinished and duplicate ledger entries fail; clean apply and no-op replay pass. |

Run the standard source workflow, `npm run audit:all`, and the packaging
suite. With a disposable local development database, run
`node scripts/desktop/verify-fresh-db.mjs` and
`node scripts/desktop/dev-db.mjs test-engine`. The packaged startup and
opt-in real-OpenAI checks use the synthetic audit workspace:
`scripts/desktop/benchmark-startup.mjs` and
`scripts/desktop/verify-tier2-ai.mjs`. Connector transport in these regression
tests is synthetic; it does not certify fresh provider onboarding or live OAuth.
