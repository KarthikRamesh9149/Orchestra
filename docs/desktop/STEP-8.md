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

1. Completed: owner confirmed ownership of original code/assets and approved
   Apache-2.0 for first-party code. LICENSE is applied. The owner explicitly
   instructed that the repository must not be made public yet.
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

The owner subsequently requested one branch only. Private preparation work is
therefore consolidated into `main` with history preserved. This is repository
housekeeping, not certification of the open gates or authorization to publish.

## Private consolidation, 15 September 2026

- Product-first README added without changing application styling or behavior.
- Actual bundled-notice inventory added with regression coverage. Missing
  standalone notices require inspection; presence does not certify compliance.
- All historical step branch tips were checked for ancestry before removal.
  Their commits remain reachable from main. Existing worktrees and untracked
  local files are retained, not deleted.
- Current open checks: fresh-user connector journeys, browser/shared TLS handoff,
  full third-party notice review and complete multi-user UI evidence. Existing
  single-Mac shared HTTPS/API checks are not a replacement for those journeys.
- Public release, signed distribution, Windows, two-machine tests and automatic
  updates remain deferred. No production repository changes are authorized.

## Current private candidate verification

- Local Settings previously rendered native connector controls alongside hosted
  connector projections. This could imply access remained after native revocation.
  Local mode now uses only its native panels; shared/web hosted controls remain.
  No styles, design tokens or CSS were changed. Imported evidence is preserved.
- Regression and full frontend suite: 239 tests across 49 files passed. Four
  publication/notice inventory tests passed. Frontend build and Mac packaging passed.
- Native candidate `95388b6b-c35c-49dd-b4c6-0442eefe3ac9` reopened the existing
  synthetic workspace. Memory retained the revoked Slack source; Settings showed
  native Slack/GitHub/Drive controls and no duplicate hosted integration panel.
  Native screenshot confirmed a rendered, nonblank Settings screen without a
  framework overlay. Native console logging was not captured; do not infer clean
  logs from the screenshot. This is one desktop viewport, not responsive coverage.
- The first packaging attempt reused the assembled runtime UI. It was not counted
  as verification of the fix. Reassembly and repackaging preceded the actual check.
- The original silent launch explainer is rendered and privately included with its
  source script. AVFoundation confirms 60 seconds, 1920×1080, 30 fps. It is clearly
  labelled illustrative, not live footage or performance evidence.
- All eight old remote/local step branch refs were deleted only after ancestry
  verification. Every commit remains reachable from main; worktrees are retained.

### Open, not passed

The shared browser still rejects the local test certificate. The existing
hostname-scoped macOS trust is not sufficient for the browser, and native shared
connection also reports failure. No security warning was bypassed, certificate
validation disabled, or broad root trust installed. Resolving this safely and
completing fresh-user browser/provider journeys remains required.

The notice scanner finds 451 backend runtime package entries, 19 without standalone
root notices. This is not 19 proven violations: for example, isarray includes its
license in README. Complete transitive notice resolution, frontend/native license
aggregation and public-distribution review remain open. No full compliance claim
is made by a filename inventory. Public publication is still prohibited.

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
