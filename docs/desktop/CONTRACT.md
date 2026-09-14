# Desktop execution and parity contract

Repository: private `KarthikRamesh9149/Orchestra`. Production `orchestrav2` is outside the write/deployment scope.

Execute only the user-authorized numbered step on `codex/desktop-step-N`. Commit and push focused changes; integrate into this repository's main only when that step's gate passes. Report evidence and blockers, explain the next step, and stop. No automatic progression. No public repository, release, spending or third-party client configuration changes without the specified authorization.

## Gates

1. Reviewed, buildable source snapshot; complete action inventory; architecture, threat model, provenance and external dependencies recorded.
2. Fresh plain PostgreSQL/pgvector local engine: upload → parse → index → cited answer → authorized approval → restart preserves state. Worker-kill/retry cannot duplicate accepted effects. No hidden Redis dependency.
3. Internal Mac ARM package launches without developer tools; provision, save, quit and reopen safely. Duplicate-launch/process-kill recovery passes. Windows x64 is deferred by explicit user instruction until a Windows test machine is available; it is not claimed supported or tested.
4. Every assigned parity row passes normal, failure and restart flows in packaged UI, without a terminal. Preserve style and truthful unavailable states.
5. Each advertised provider/model/client combination passes real-account tests on the currently authorized platform, with privacy-consistent traffic. Preflight pack ID → authorized MCP retrieval → linked Postflight verified in Codex; VS Code pairing verified. User scope revision on 11 September 2026: qualify Codex and VS Code only. Claude and Cursor are deferred, not certified or advertised as tested. Windows remains deferred under the earlier Mac-only revision.
6. Different roles observe authoritative shared changes. Isolation, compatibility, fresh self-hosting, export/import, backup/restore and upgrade pass. On 13 September the user explicitly deferred the second-physical-computer check and authorized completion of the remaining Step 6 gate, followed by Step 7. Two-computer behaviour remains unqualified, not passed.
7. The currently authorised Mac package must pass clean install, populated upgrade, recovery and tamper tests. On 14 September the user explicitly deferred Developer ID signing and notarization: this gate now targets an unsigned Mac-only internal beta, not a signed public release. Do not disable Gatekeeper or security warnings. Windows remains deferred, not certified. No unresolved Critical/High security, data-loss or core-flow defect. Lesser exceptions require explicit acceptance. No main merge or publication follows from partial checks.
8. Explicit source/publication approval, independent public download/build/install/core journey/update checks on both platforms.

## Product rules

- Scope revision: the user authorized Mac-only development until Windows hardware is available, and explicitly authorized finishing Step 3 followed by Step 4 in the same request. The user subsequently authorized completing Step 5, with Codex and VS Code qualification only, then completing Step 6 after Step 5 passes. On 13 September they authorized finishing all remaining single-Mac Step 6 work and then Step 7, explicitly deferring two-computer qualification. On 14 September they deferred Developer ID signing/notarization for the internal beta. This does not authorize publication or any production change. Windows, two-computer and signing rows remain deferred, not passed. Other Step 7 gates are unchanged.

- Existing visible product functionality is assigned in the feature inventory, not silently removed. Local-only presentation controls remain local; shared mutations require live server authorization.
- Local mode needs no hosted signup and does not claim fake email verification. Shared identity remains server-owned.
- Multiple chats, deletion, drafts, first-message delivery, cancellation and streamed navigation must survive the defined restart/session journeys.
- AI output, research, agent artifacts and raw communications are evidence, not automatically accepted Product Brain truth.
- Shared offline caching is disabled by default. An administrator may enable bounded read-only caching with expiry, reconnect validation and purge after expiry or detected revocation.
- External generation is user-configured and usage-bounded. Offline reading/search works without fabricated answers. Embedding model/dimension changes require safe reindexing.
- Native source selection is explicit; traversal is bounded and symlinks cannot escape the selected roots. No automatic home-directory indexing.
- Export/import excludes credentials and unauthorized private chats; preserves bytes/hashes/provenance/accepted decisions with explicit identity mapping.

## Performance and acceptance

Proposed Step 7 p95 gates: input feedback ≤100 ms, warm-route usability ≤300 ms, local retrieval ≤1 s; layout shift ≤0.1. Establish repeatable datasets/hardware on both platforms. Record cold/warm launch and external model latency separately. These are targets, not measurements or claims about the imported baseline.

Do not weaken authorization, persistence, provenance or evidence checks to improve timing. Inherited browser startup/history latency and layout shift remain explicit Step 4/7 work. Unit tests and mock evals are not live AI, real-provider or clean-machine certification.
