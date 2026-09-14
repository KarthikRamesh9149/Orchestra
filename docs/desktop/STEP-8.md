# Step 8: publication preparation

**Not complete. No public release is authorized or certified.** Work starts from
private main `4ab88630685077bbec23b7d38da7750bda84c30d` on
`codex/desktop-step-8`. No existing hosted product is changed.

## Prepared

- Private release/download information with explicit unavailable status, no false links.
- Source-build recipe derived from current scripts, not certified as independently reproduced.
- Usage, network/privacy, troubleshooting, manual update, uninstall and support guidance.
- Read-only publication metadata audit with tests. It always fails the publication
  gate; no metadata-only result can certify licensing or security.
- README corrected to reference completed internal scope rather than stale Step 4 state.

## Required before publication

1. Owner confirms redistribution rights and license choice, including assets.
   Apache-2.0 remains proposed, not applied.
2. Review complete source/history contents and exact bundled third-party notices.
   Lockfile license metadata and filename checks are only triage.
3. Independently reproduce a fresh source build without private packages or keys.
4. Qualify a signed/notarized public Mac artifact, with provenance and checksums.
   User deferred this for internal beta only. No Gatekeeper bypass.
5. Qualify public enrollment for actual provider registrations, and assign support.
6. Obtain separate explicit repository-public/release-publication approval.
7. Independently download/install/test the actual release and manual update path.

Windows, two-computer checks and automatic updates remain deferred, not silently
reintroduced as claimed successes. No feed is published for an inactive updater.
Steps 1–7 internal results remain in their reports; this documentation-only work
does not require rerunning unchanged runtime suites or repeat paid model calls.

The safe stopping point is a private preparation branch, not a public release.
Do not integrate or declare Step 8 complete until its applicable gate passes.

## Preparation evidence

The lockfile audit counted 1,400 dependency entries and no non-registry resolved
sources. Its two license flags were inspected after a fresh install: png-js has
an MIT LICENSE despite absent lock metadata; JSZip explicitly offers MIT OR GPL.
Neither flag is a confirmed licensing violation. Full bundled notice review is
still required. No tracked binary assets matched the filename inventory, but
the web HTML references Google Fonts; no asset-rights clearance is inferred.

Fresh root and desktop dependency installs succeeded without private registry
credentials supplied by this task. Desktop typecheck/build and three Node audit
tests passed. Fresh Prisma generation, backend compilation and frontend production
build also passed. Seven local documentation links resolve, whitespace checks
and the local security scan pass. This is not independent clean-machine native
installer evidence, full-history secret clearance or a complete bundled-license audit.

## Fresh native reproduction, 14 September 2026

The first native build from the fresh Step 8 checkout failed: OpenSSL's pristine
archive has no generated Makefile, but the recipe ran `make clean` before
configuration. The recipe now cleans only configured trees and propagates actual
clean failures; it also creates its own `.desktop` directory. A regression test
covers fresh/configured trees and failure propagation. All four Step 8 Node tests,
the static security scan, import review and inventory checks pass.

The corrected source recipe built PostgreSQL 17.11, OpenSSL 3.5.8 and pgvector
0.8.6 from checksum-verified upstream archives, assembled the runtime and created
internal package `85fd01be-b40c-4441-be9b-00d31a6328e0` (0.0.5). This used fresh
native build outputs, not the previous worktree's runtime. Native tests passed
with empty PATH: fresh launch, competing-engine rejection, missing/invalid
loopback authority rejection, save/reopen, parent IPC loss and SIGKILL recovery.
PostgreSQL, pgvector and OpenSSL license files are present; this is not a full
transitive notice/legal review.

The fresh packaged UI passed 12 functional checks: onboarding, upload, document
viewer, exact-byte download, cited evidence-only answer, navigation/draft
continuity, route access, restart persistence, rename, subscription persistence,
multiple chats and deletion. No page errors or HTTP failures were recorded.
**The overall UI smoke exited nonzero:** final screenshot capture timed out after
fonts loaded. Visual evidence is not certified by the functional results. This
was same-Mac synthetic verification, not an independent customer/public download
or live AI qualification.

Private evidence (not publication artifacts):

- `/private/tmp/orchestra-step8-native-build.log` — original reproduced failure.
- `/private/tmp/orchestra-step8-native-rebuild.log` — successful native build.
- `/private/tmp/orchestra-step8-prepare-native.log` and `orchestra-step8-package.log` — packaging.
- `/private/tmp/orchestra-step8-native-smoke.log` — passed native lifecycle checks.
- `/private/tmp/orchestra-step4-acceptance-BWtEa1/result.json` — functional checks and screenshot failure.

Public gates above remain open. No main merge, release, visibility change,
production mutation, paid Actions or paid service was performed.
