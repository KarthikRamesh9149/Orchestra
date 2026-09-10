# Desktop execution and parity contract

Repository: private `KarthikRamesh9149/Orchestra`. Production `orchestrav2` is outside the write/deployment scope.

Execute only the user-authorized numbered step on `codex/desktop-step-N`. Commit and push focused changes; integrate into this repository's main only when that step's gate passes. Report evidence and blockers, explain the next step, and stop. No automatic progression. No public repository, release, spending or third-party client configuration changes without the specified authorization.

## Gates

1. Reviewed, buildable source snapshot; complete action inventory; architecture, threat model, provenance and external dependencies recorded.
2. Fresh plain PostgreSQL/pgvector local engine: upload → parse → index → cited answer → authorized approval → restart preserves state. Worker-kill/retry cannot duplicate accepted effects. No hidden Redis dependency.
3. Internal Mac ARM and Windows x64 packages launch without developer tools; provision, save, quit and reopen safely. Duplicate-launch/process-kill recovery passes.
4. Every assigned parity row passes normal, failure and restart flows in packaged UI, without a terminal. Preserve style and truthful unavailable states.
5. Each advertised provider/model/client combination passes real-account tests on both platforms, with privacy-consistent traffic. Preflight pack ID → authorized MCP retrieval → linked Postflight verified in Codex, Claude and Cursor; VS Code pairing verified.
6. Two machines and different roles observe authoritative shared changes. Isolation, compatibility, fresh self-hosting, export/import, backup/restore and upgrade pass.
7. Both signed packages pass clean install, populated upgrade, recovery and tamper tests. No unresolved Critical/High security, data-loss or core-flow defect. Lesser exceptions require explicit acceptance.
8. Explicit source/publication approval, independent public download/build/install/core journey/update checks on both platforms.

## Product rules

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
