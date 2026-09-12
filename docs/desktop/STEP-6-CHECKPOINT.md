# Step 6 checkpoint: implementation in progress

Branch: `codex/desktop-step-6`, based on verified Step 5 commit `243cd1b80c4262c0fc9c2f6e50804a7f744d2394` in private Orchestra/main. Production orchestrav2 remains outside scope.

## Implemented foundation and current evidence

- ADR-005 defines separate local/remote identity, encrypted grants, exact-origin transport, packaged UI and cache boundaries.
- Added strict HTTPS connection descriptors that reject credentials and ambiguous API URLs.
- Added protocol-range and persistent server-ID compatibility validation, to be wired before credentials are sent.
- Added disabled-by-default bounded read-only cache policy contract. No shared cache or remote capability is enabled by this foundation alone.
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

1. Packaged shared-window qualification and remaining session revocation/offline
   state-purge checks, including native download/cancel behaviour.
2. Optional administrator-enabled bounded read-only caching; currently always off.
3. Operator email/provider configuration and real self-hosted provider qualification.
4. Authorized export/import with source hashes, provenance, accepted decisions and explicit identity mapping; exclude credentials and unauthorized private chats.
5. Remaining packaged normal/failure/offline journeys, cross-tenant isolation,
   broader crash/recovery scenarios, complete operator backup tooling and
   actual populated version upgrades. Synthetic queue/application restore now
   passes; existing private-chat proof is one-server/two-account evidence.
6. Actual two-computer role/authority qualification.

The user confirmed on 12 September that only one Mac is available. Two isolated profiles/processes on that Mac can supply development evidence, but do not satisfy item 6. This hardware limitation does not block the remaining implementation and is not permission to weaken the gate. Step 6 is not complete and must not be merged into private main yet.
