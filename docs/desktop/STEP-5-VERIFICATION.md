# Step 5: Mac AI, sources and agent qualification

Scope: private `KarthikRamesh9149/Orchestra`, branch `codex/desktop-step-5`. No production, orchestrav2, public release, paid Actions or tier changes. Windows, Claude and Cursor are explicitly deferred by the user. This supersedes earlier incremental checkpoints, including resolved failures.

**Mac-local Step 5 qualification gate passed for the explicitly bounded combinations below.** This is internal qualification, not a claim of public-release readiness or unlimited connector coverage.

## Verified workflows

| Area | Evidence and qualification |
| --- | --- |
| AI configuration | Dedicated authorized key imported in Electron main, real model access checked, OS-encrypted save/restart, no renderer key or shipped credential. `step5-ai.json` |
| Actual model | OpenAI `gpt-5.4-mini`; `text-embedding-3-small`, 1536 dimensions. Real structured output, streaming and cited named-document answers, not mock certification. `step5-ai-evidence.json`, `step5-drive-answer.json`, `step5-slack-answer.json` |
| AI safety | Durable request allowance, output/context/concurrency bounds, cancellation, revocation and embedding identity checks. No allowance resets or mock vectors. Other configurable models are not certified by these samples. |
| GitHub | Separate desktop App, only desktop repository selected. Real sign-in, ingestion, repeat idempotency, refresh, offline/recovery, provider-side revocation denying the old grant, fresh sign-in and restart. `step5-github-auth.json`, `step5-github-lifecycle.json` |
| Drive | Separate testing registration, actual Picker selected one synthetic file. Real refresh/revoke/reconnect, original ingestion, exact retrieval roots, canonical links, idempotency and restart. `step5-drive-auth.json`, `step5-drive-lifecycle.json` |
| Drive revisions | Real source edit retained document identity and both versions. Reprocessing with exhausted AI allowance retained lexical search, current original download and partial status after restart. `step5-drive-update.json` |
| Slack | Separate desktop App; owner explicitly authorized public-channel history. Application imported only synthetic qualification channel and replies. Real rotation/revocation/reconnection, offline/recovery, repeat idempotency and restart. `step5-slack-auth.json`, `step5-slack-import.json`, `step5-slack-lifecycle.json` |
| Refresh | Saved exact selections default off. Explicit opt-in, bounded background refresh, wake-triggered catch-up, error/last-success state, cancellation, pause/remove and restart. `step5-sync.json` and provider lifecycle reports |
| Local sources | Explicit folder/Git working-tree selection, bounded traversal, ignored/hidden/symlink exclusion, safe UTF-8 code snapshots and Memory/reload persistence. `step5-folder.json`, `step5-repository.json` |
| MCP | Exact Preflight pack, deny another pack, linked read-only Postflight, revocation in running relay. Actual Codex and VS Code 1.134.0 clients verified; disposable scoped settings, normal settings preserved. `step5-mcp.json`, `step5-codex.json`, `step5-vscode.json` |
| Deep Research | Removed obsolete Step 4 guard only after real AI configuration. Strict local output schema. Actual report, correct synthetic facts/citations, saved generated context, reload and download. `step5-research-ai.json`, `step5-research-export.json` |

Evidence remains in the local synthetic qualification profile, outside tracked publication material. Each report records its package. Earlier live evidence is reused only for unchanged implementation/configuration, not mislabelled as every test running on one package.

Some native selection/consent dialogs were stubbed in packaged harnesses; external authorization, provider reads, protected storage, backend writes and restart were real. The research PDF test replays only the start response to open an already generated real run, avoiding duplicate generation. Polling, rendered report, PDF endpoint and download are real; separate real-start generation evidence exists.

## Corrections found during qualification

- Google required the user's Desktop registration JSON. Native import validates client type, bounds and fixed provider endpoints, with protected storage. No installer secret or browser-security bypass.
- GitHub evidence needed explicit native route/source projection wiring.
- VS Code inherited Node/Electron flags prevented the helper starting; scoped configuration removes these without changing normal client settings.
- Deep Research had obsolete guards and optional schema fields unsuitable for strict output; both corrected with regression and real-model proof.
- Exhausted AI allowance failed optional embeddings inside the local effect transaction. Native indexing now commits lexical evidence as partial without fabricated semantic success. Original downloads retain authorization without requiring optional semantic completion.
- Repeat Drive refresh preserves partial-index failure messaging rather than leaving it pending forever. Native API responses explicitly prohibit HTTP caching.
- The initial revision harness used ambiguous asynchronous browser polling and did not check HTTP status. Corrected explicit polling awaits the exact committed revision before/after restart; error bodies cannot count as source bytes.

## Measurements and gates

- One named Drive sample: first text 1,818 ms; completion 2,367 ms; retrieval 18 ms; generation 2,272 ms. Real OpenAI, non-degraded, correct cited synthetic facts.
- One real Deep Research sample: 4,072 ms.
- These small-dataset samples are not p95, universal latency or Step 7 certification.
- Final backend/desktop suite: **1,500 passed, 13 optional integration tests skipped**. Those skipped tests are not claimed passed. Final targeted set: 54 passed.
- Frontend: 218 passed. Backend compile, native typecheck/build, frontend production build and VS Code extension build passed.
- Four dependency audits: zero vulnerabilities (backend production dependencies, complete native/frontend/extension trees). Local secret scan passed.
- Import provenance: 782 untouched imported files, 33 explicitly reviewed changes. Inventory: 42 UI sources, 365 controls, 18 families, 1,398 dependency entries. Inventory is structural ownership, not runtime proof; this report supplies Step 5 mapping.
- Final Mac package: `d90df1ad-5e0e-485f-a934-78350454650d`. The exact candidate passed revised Drive source download, lexical search, explicit retry, partial-index state, full restart and repeat-import checks. Review-hash/inventory checks and `git diff --check` passed before staging.

## Boundaries

- Internal Mac package, not signed public distribution. Google remains testing-mode. General public provider enrollment, signing, rights and independent-machine checks remain release gates.
- GitHub: up to 200 PRs and 200 commits, redacted excerpts up to 4,000 characters. Slack: selected public channel, 30-day window, up to 200 messages/20 pages; oversized selections fail explicitly. Drive: explicitly selected supported files, at most 10 MB each. Refresh is not exhaustive provider history, deletion reconciliation or write-back.
- User-owned Google Desktop registration is required; no confidential installer secret. Qualified flow needs no external callback bridge.
- Request ceilings are not dollar spending guarantees. Test allowance temporarily changed from 20 to 24 without resetting usage and was restored to 20. No credits or tiers purchased.
- Local working-tree snapshots are not Git object/history ingestion. Revocation stops future provider access; imported local evidence remains until explicitly deleted.
- Step 6 is authorized after this gate; shared identities, compatibility, transfer, backup/recovery and two-computer proof are not claimed here.
