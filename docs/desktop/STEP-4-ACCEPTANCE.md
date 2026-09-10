# Step 4 acceptance evidence

**Mac-local Step 4 gate passed.** This report supports integration into private Orchestra/main only. It does not authorize or certify a public release, managed deployment or Step 5.

Scope: Mac Apple Silicon, private Orchestra repository, local workspace without configured external AI. No orchestrav2 changes, hosted deployment, public release, paid Actions, customer data or provider configuration.

## Corrections since the checkpoint

- Deterministic source/accepted-decision projection jobs were incorrectly blocked with model generation jobs. The local worker now permits an explicit deterministic allowlist while real model jobs remain unavailable.
- Local upload projection no longer inherits the hosted beta shortcut. Approval is proved through a real `acceptedBrainVersionId` and persisted Live Doc, without manually seeding a graph or requesting a rebuild first.
- Accepted/rejected packet wording follows the stored decision.
- First-message acceptance after route unmount retains the conversation selection; an explicit subsequent New chat selection is not overridden. Duplicate pending submissions are guarded across remounts.
- Native clipboard operations report real success/failure. Preflight export retrieves the exact authorized persisted pack, not renderer-provided content or paths.
- HTTPS source links require native confirmation and leave the renderer sandbox intact. Unsafe protocols and credential-bearing URLs are rejected.
- Accessible filter/workspace names and existing semantic contrast tokens replace inaccessible labels/hard-coded colours. No layout or design-system replacement.

## Local workflow coverage

| Workflow | Packaged proof | Failure/restart proof |
| --- | --- | --- |
| Onboarding/workspaces | `ui-smoke.mjs`: privacy, local owner, creation/selection | quit/reopen preserves workspace; runtime recovery is explicit |
| Dashboard/settings | rename, subscription record, appearance | reload verifies server state; no purchase/invitation sent |
| Documents/Memory | real PDF, parsed viewer, cited source, original-byte save | stop/reconcile/retry without duplication; removal confirmation/Escape; cancelled save; runtime crash preserves source |
| Socrates | first message, multiple chats, evidence-only answer/citations, feedback | drafts/navigation/restart/deletion; delayed real SSE navigation; cancellation/completion reconciliation |
| Timeline | manual event with manual provenance | reload persistence; proposal authorization exercised via Inbox and API suites |
| Inbox/packet/impact | assignment, snooze, reject, inspect and accept | authoritative reload; real worker updates Product Brain and Live Doc; full restart preserves accepted change |
| Delivery/FDE/context | persisted executive brief; populated Delivery; decision trace; deterministic Postflight linked to exact Preflight | receipt remains disabled without delivery evidence; unknown release readiness is not certification; agent output remains evidence |
| Research | honest unavailable state without configured AI; original lifecycle/selection contracts retained | no fabricated report or model success; model-backed qualification belongs to Step 5 |
| Shell | seven routes; resize/zoom; keyboard focus, Escape, restoration; legacy redirects | real native-host SIGKILL displays recovery error; relaunch restores source/transcript; external sources never load in renderer |

`feature-parity.json` is a conservative structural inventory containing hidden/legacy/shared bindings. It is not rewritten as hundreds of independent runtime passes. Frontend/backend suites additionally cover validation, forbidden reads/mutations, cancellation errors, delivery evidence, FDE and receipt safety; unit fixtures are not real provider certification.

## Reproducible packaged scripts

Build/package using the Step 3 commands. `ui-smoke.mjs` reads `.desktop/latest-package.txt` and prints a fresh synthetic profile. Supply that profile, in sequence, to:

```sh
node scripts/desktop/ui-followup.mjs <synthetic-profile>
node scripts/desktop/ui-truth.mjs <synthetic-profile>
node scripts/desktop/ui-recovery.mjs <synthetic-profile>
node scripts/desktop/ui-runtime-recovery.mjs <synthetic-profile>
node scripts/desktop/ui-stream-navigation.mjs <synthetic-profile>
node scripts/desktop/ui-quality.mjs <synthetic-profile>
```

All launches use packaged runtimes with an empty PATH. Profile provenance is validated. The crash script identifies only the direct native-host child of its own launched app; it never trusts a saved PID or changes another database.

Native Save, clipboard and OS browser-opening interaction sinks are substituted to avoid changing personal clipboard/browser state. Real authorization, IPC, persisted content and atomic file writes execute. This is automated native-boundary evidence, not manual OS-panel usability certification.

The stream-navigation test delays **real backend SSE bytes**, not fabricated model events. Fast offline answers may complete before Stop reaches the backend: that outcome is recorded honestly. Real active-handler cancellation and process-kill rollback are separately covered by the PostgreSQL integration suite.

## Qualification limits and next owners

- Step 5: real BYO AI, model quality/latency/cancellation, embeddings, connectors, folder/repository sources, MCP and VS Code. Local manual agent-run fixtures do not prove execution in Codex/Claude/Cursor.
- Step 6: shared identities, teams, remote authority, self-hosting and migration.
- Step 7: population p95 benchmarks on representative data/hardware, independent accessibility review, exhaustive recovery/update tests and signing. Current local samples are not those benchmarks.
- Step 8: explicit public-source/download approval and independent installation. Public licensing/signing remain unresolved.
- Windows remains deferred, not tested or supported by this milestone.

## Final gate

- General desktop/backend suite: **1,383 passed, zero failures**. Its 13 optional PostgreSQL cases were skipped there and then run separately: **8 engine integration + 5 queue integration passed**. Includes real worker-kill rollback, cancellation and encrypted backup restoration; no simulated database pass.
- Frontend: **199 passed across 40 files**. Backend compilation, desktop typecheck/build, frontend production build and VS Code extension build passed.
- Original-source provenance, feature inventory and 281-route allowlist checks passed. Local security scan passed. Backend and frontend production-dependency audits reported zero vulnerabilities. No GitHub Actions were invoked.
- Exact internal package: `.desktop/packages/cc4479ef-c697-4e4f-b015-177109cb7d64/Orchestra Desktop Internal-darwin-arm64`.
- All seven packaged scripts passed on synthetic profile `/private/tmp/orchestra-step4-acceptance-IA92Ry`: smoke 12 checks, follow-up 5, truth 11, recovery 8, runtime recovery 2, streamed navigation 1, quality 13. **52 recorded checks** total. Captured renderer exceptions were empty; smoke/follow-up captured no HTTP failures. Recovery deliberately injects failures and must not be called a zero-error network run.
- Final quality sample: populated launch **1,716 ms**; ten warm navigation samples **48–76 ms**. Seven major routes had **zero axe WCAG-tag violations**. Resize, zoom, keyboard focus/Escape/restore and confirmed external handoff passed. These samples do not establish population p95 or complete WCAG conformance.
- Final evidence files are `result.json`, `followup.json`, `truth.json`, `recovery.json`, `runtime-recovery.json`, `stream-navigation.json`, `quality.json` and screenshots in the synthetic profile. Raw ephemeral profiles/exports are not published with source; checked-in harnesses reproduce them.
- Intermediate failures were retained in local logs. One final-sequence recovery assertion initially inspected the previous chat before route hydration; it was corrected to await the original chat URL/content and passed on rerun. It is not hidden as an uninterrupted green first run.
- The isolated developer database was returned to its prior stopped state after integration testing. No customer records were used or changed.

No perfect/zero-future-bug or public-release claim is made. Step 5 still requires explicit instruction.
