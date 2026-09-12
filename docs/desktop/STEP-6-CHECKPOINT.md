# Step 6 checkpoint: implementation in progress

Branch: `codex/desktop-step-6`, based on verified Step 5 commit `243cd1b80c4262c0fc9c2f6e50804a7f744d2394` in private Orchestra/main. Production orchestrav2 remains outside scope.

## Implemented foundation and current evidence

- ADR-005 defines separate local/remote identity, encrypted grants, exact-origin transport, packaged UI and cache boundaries.
- Added strict HTTPS connection descriptors that reject credentials and ambiguous API URLs.
- Added protocol-range and persistent server-ID compatibility validation, to be wired before credentials are sent.
- Added disabled-by-default bounded read-only cache policy; the follow-up below
  implements its narrow document-metadata path.
- Main-process shared transport now validates the server, owns encrypted grants,
  forces bearer sessions, strips tokens/cookies from renderer responses and
  supports streaming without a generic network proxy.
- Shared server settings and isolated native windows retain packaged UI, native
  origin confirmation, a visible server banner and separate memory-only storage.
- Versioned self-hosting includes API/web/worker, persistent PostgreSQL/pgvector,
  Redis, private files, TLS proxy, fresh migrations and closed-signup owner setup.
- A real HTTPS localhost fixture passed 12 checks: login without renderer tokens,
  workspace switch/bootstrap, manager rename persistence, source upload/exact-byte
  download, email-bound invitation redemption, developer restrictions, owner-only
  private-chat history, protected grant restart, expired-session refresh,
  revoke-other-sessions continuity, logout, and expired-access logout.
- Reproduced and corrected desktop grant clearing after revoking other sessions,
  failed logout after access expiry, and frontend sign-out state clearing when
  the server could not confirm logout. Focused regression tests pass.
- Internal Mac package `4a5d4b18-a104-451b-8f7e-65d1929e7a20` passed seven
  rendered checks at the default 1280x850 native window size: shared login,
  workspace creation/server banner, reload, PDF multipart upload/viewer,
  byte-identical native download, failed-logout error with retained authentication,
  and return to unchanged local onboarding. Evidence is in
  `/private/tmp/orchestra-step6-shared-ui-lDftk3/evidence.json` (local, not published).
  Used Playwright Electron because Browser skill was unavailable and the workflow
  needs native windows. Trusted localhost TLS used a process-scoped test CA;
  OS/browser TLS protection was not disabled. Only logout-failure injection and
  native confirmation/save selection were simulated. Login, storage and download
  used the real isolated server. No page errors or framework overlay appeared.
  Other viewports, full application restart, and two-computer flows remain untested.
- Encrypted synthetic backup/restore preserved all rows in 105 public tables and
  exact hashes for 3 source files in a **new** target database/private directory.
  Wrong passphrase and tampering were rejected. Redis restoration and booting the
  restored application were initially pending; the follow-up proof below now
  covers both for the synthetic fixture.
- Full-stack recovery follow-up: `verify-shared-stack-recovery.ts` restored 105
  tables, seven files and the Redis snapshot into a new isolated Docker Compose
  project, booted its real API/worker, completed a real document job deliberately
  left pending at backup, signed in and downloaded the exact original bytes.
  Immutable migrations were reapplied successfully to the populated restore.
  This is **not** an old-version-to-new-version upgrade test. Evidence is local
  at `.desktop/step6-stack-recovery-Zf1lwR/evidence.json`. The restored stack was
  stopped and the original synthetic stack restarted. Private volumes/archive
  remain available for inspection; no working database was overwritten.
- Current working-tree checks (12 September 2026): 1,550 backend tests passed,
  13 skipped; 224 frontend tests passed. Backend and native TypeScript checks,
  frontend production build, native bundle build, import provenance, action
  inventory and the local static security scan passed. These are development
  checks, not full Step 6 certification. Packaged proof covers only the explicit
  seven workflows above, not the entire product.

## Remaining implementation

### Read-only cache follow-up, 12 September 2026

- Implemented opt-in, per-window RAM-only caching for authorised document list
  and metadata GETs. Defaults off; bounded TTL/UTF-8 bytes/entry count, no cached
  grants, private chats, viewer files or accepted-truth decisions.
- Offline snapshots carry a native read-only notice. Writes are rejected, not
  queued. Policy/session changes, detected 401/403, expiry and native wake purge
  entries; displayed snapshots trigger renderer reload. Reconnect uses a fresh
  compatibility handshake and live authorization. Default-disabled traffic and
  streaming are not buffered by the cache.
- Packaged testing caught a missing server banner/return-to-local action on the
  unavailable bootstrap screen. Added that existing component to the error
  screen without restyling the app, with a failing-then-passing regression.
- Checks: 1,562 backend tests passed, 13 skipped; 226 frontend tests passed.
  Backend/native typechecks, frontend build/native package, reviewed import hash,
  action inventory and local security scan passed. The initial full-suite failure
  was an outdated reviewed import hash, not an application assertion; the final
  suite passed after the explicit provenance update.
- Mac ARM internal package `95e81595-cd24-433e-b211-a8b43edd2af2` passed six
  cache journeys at 1280x850: real shared login/document list, exact offline
  response with notice, blocked write, expiry, reconnect, and native wake purge.
  The server at `https://localhost:4446` was the isolated synthetic fixture.
  Manifest opt-in, network outage, native confirmation and the wake event were
  simulated; login, authorization and document data came from the real server.
  The final populated run uploaded `Cache-Evidence.pdf` before the outage and
  verified its cached metadata byte-for-byte. Local evidence:
  `/private/tmp/orchestra-step6-cache-ui-c3anEO/evidence.json` and
  `/private/tmp/orchestra-step6-cache-ui-c3anEO/offline-read-only.png`.
  Server policy output/bounds also have Fastify/config tests. A deployed server
  operator-policy change and actual physical sleep/wake are not yet qualified.
- QA: page identity, nonblank content, no framework overlay, no page exceptions,
  screenshot and interaction checks passed. React guidance kept the notice on one
  native subscription without polling. Playwright Electron was used because this
  is a native-window/transport test; existing CUA browser controls are available
  and no browser plugin installation was necessary.
- Cache scope remains document metadata only, not a complete offline shared
  workspace. Cold offline launch, two-computer testing, other viewports and the
  remaining shared workflows are not certified by these checks.

### Outstanding work

### Scoped transfer engine follow-up, 12 September 2026

- Added an internal, versioned encrypted transfer format and database/storage
  service. A reviewed field allowlist covers documents, exact source files,
  parsed sections/chunks, Product Brain versions/nodes/links, accepted decisions,
  proposals and Live Doc history. Unknown record families/fields are rejected.
- Credentials, permission grants, private chats, connector configuration and
  non-core workflows are excluded. This is not a full workspace export. External
  references in user-authored JSON remain historical references, not imported
  connector authority. Embeddings are not transferred; model-aware reindexing
  and complete source-reference presentation still require integration.
- Requires a live project manager, an exact reviewed archive digest, explicit
  one-to-one identity mapping to active destination members and acknowledgement
  of imported historical truth. Source identity mapping and original import
  lineage are retained in the audit record and subsequent exports.
- Imports use an empty core destination, immutable private file keys, a locked
  serializable database transaction and create-only records. Late ID collisions
  roll back all database changes. Known successful retries do not stage new
  files. Interrupted or failed first attempts can leave private unreferenced
  files; safe orphan reconciliation is not yet implemented.
- Twelve targeted tests and the full backend suite passed: 1,574 passed,
  13 skipped. TypeScript build, import-provenance and action-inventory gates
  passed. The initial sandbox run could not bind test loopback sockets; the
  complete authorized rerun passed without changing assertions.
- `scripts/desktop/verify-project-transfer.mjs` passed seven real synthetic
  restricted-role PostgreSQL/storage checks: denied authority/mapping/consent,
  byte/decision preservation, idempotency, export with lineage, late-collision
  rollback, manager revocation and persistence over a fresh connection.
  It creates labelled synthetic projects only in the isolated qualification
  stack. A fresh connection is not an application crash or version upgrade.
- **Not exposed in the UI or an HTTP route yet.** Native archive selection,
  passphrase handling, mapping preview/confirmation, local-to-shared integration
  and packaged normal/failure/restart journeys remain. No new visible feature is
  claimed complete by this service-level proof.

### Remaining gate

### Native transfer and populated upgrade, 13 September 2026

- Added native export, archive selection, explicit identity mapping and final
  import confirmation to the existing Settings surface in local/shared windows.
  The page receives an opaque five-minute preview ID, not archive bytes, paths
  or passphrases. Passphrase creation/import requires native clipboard consent;
  clipboard contents are cleared after use. New export files are private and
  existing files are not overwritten. Native errors do not expose filesystem paths.
- The native UI limit is 16 MiB per encrypted archive. Core-only exclusions remain
  explicit. The underlying format is not advertised as a full-workspace backup.
  Managed servers do not mount the new routes. Ordinary renderer fetch cannot
  invoke them; native transport still requires live backend manager authority.
- Package versions now follow package.json; the internal candidate is 0.0.4.
  `ui-project-transfer.mjs` populated the preserved 0.0.3 package, then launched
  0.0.4 on the same private profile and verified the document remained usable.
  This is an actual application-version upgrade with unchanged schema, not proof
  of a schema-changing upgrade, signed updater or interrupted update recovery.
- Final package `d60a0cd2-3fb3-4d45-91ea-4e9c8fd89ae8` passed seven checks:
  local upload/viewer; populated version upgrade; encrypted native export;
  identity-mapped local-to-shared import; viewer reload; real shared proposal
  approval and durable Live Doc update; whole-app restart preserving the protected
  shared session, source and accepted decision. Evidence is local:
  `/private/tmp/orchestra-transfer-ui-Dsvjg4/evidence.json`.
  Native dialogs and clipboard were substituted for synthetic automation, while
  renderer, file IO, encryption, authorization, database and worker were real.
  Expected unauthenticated bootstrap 401 did not prevent subsequent login.
- This journey reproduced a shared transport bug: encoded typed Inbox IDs were
  rejected for packet and delivery-trace routes. Added failing-then-passing tests
  and allowed only encoded colons in the existing reviewed typed-ID route set.
  Encoded separators, double encoding and credential-management paths stay denied.
- Checks: 1,580 backend tests pass (13 skipped), 228 frontend tests pass;
  backend/native TypeScript, frontend/native builds, import provenance, inventory
  and static security scan pass. No hosted runtime or styling redesign changed.
- The Docker image rebuild **did not pass** in the current 2 GiB Docker VM.
  The compiler exhausted memory even after stopping the synthetic app services;
  a smaller heap also failed and was reverted. The successful shared test used
  the previously built runtime image plus read-only locally compiled backend JS
  via ignored `.desktop/transfer-qualification.yaml`. This verifies integration,
  not clean-image reproducibility. The synthetic stack was restarted and is healthy.

### Outstanding gate after this follow-up

1. Packaged shared-window qualification and remaining session revocation/offline
   state-purge checks, including native download/cancel behaviour.
2. Further offline/shared workflow qualification. Optional document-metadata
   caching is implemented; full offline shared workspaces are not supported.
3. Operator email/provider configuration and real self-hosted provider qualification.
4. Further transfer failure/cancellation/expiry and orphan-file reconciliation
   qualification. The native core transfer, identity mapping and accepted-truth
   journey above now passes; broader workspace export is not implemented.
5. Remaining packaged normal/failure/offline journeys, cross-tenant isolation,
   broader crash/recovery scenarios, complete operator backup tooling and
   schema-changing/interrupted upgrades and the clean container-image build.
   A populated 0.0.3-to-0.0.4 application upgrade now passes. Synthetic queue/
   application restore passes; private-chat proof is one-server/two-account evidence.
6. Actual two-computer role/authority qualification.

The user confirmed on 12 September that only one Mac is available. Two isolated profiles/processes on that Mac can supply development evidence, but do not satisfy item 6. This hardware limitation does not block the remaining implementation and is not permission to weaken the gate. Step 6 is not complete and must not be merged into private main yet.
