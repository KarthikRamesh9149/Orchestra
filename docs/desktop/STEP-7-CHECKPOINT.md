# Step 7: independent hardening work, not release completion

## Current status, 14 September 2026 (supersedes earlier barriers below)

### Physical sleep/wake completed with the user present

The user closed the Mac lid and reopened/unlocked it. Real native suspend/resume
events recorded **39.024 seconds** between them. The existing runtime was ready,
and the source document, cited transcript and unsent draft survived wake,
navigation and reload, with no renderer errors. Evidence:
`/private/tmp/orchestra-step7-physical-wake-OrLJkH/report.json`.

Two earlier programmatic sleep attempts immediately resumed (701 ms and 548 ms)
and are retained as failed qualification, not counted as successful tests. The
first also exposed a disconnected automation transport while the app itself
remained alive. The harness now persists native power events separately and
reattaches only to its owned synthetic app after waking; it never emits fake
power events or changes global power/security settings.

Physical sleep/wake is no longer pending. Automatic update installation remains
unimplemented/unqualified with signing deferred; the verified manual update
procedure is not an automatic updater. No main merge or public release is made.

### Latest continuation: manual recovery and research process-kill proof

- Controlled **manual** 0.0.4 → 0.0.5 installation on a copied synthetic populated
  profile passed. Actual SIGKILL of the candidate copy preserved the old working
  application. Full-profile restore recovered the pre-update document IDs and
  transcripts, excluding an intentionally added post-update session. A retry and
  data-retaining removal/reinstallation passed. Original profiles and apps were
  untouched. Proof: `/private/tmp/orchestra-step7-manual-upgrade-Kvg9Z8/report.json`.
- Repeated current-candidate runtime SIGKILL, honest recovery UI, upload/cancel/
  reconciliation, persisted removal, native save cancellation, chat terminal-state
  and transient transport failure tests passed. Evidence is in the synthetic
  `orchestra-step4-acceptance-GpIlkq` profile's `runtime-recovery.json` and
  `recovery.json`. Chat completed before cancellation; this is recorded honestly.
- Actual packaged DeepResearchService plus real local PostgreSQL: the disposable
  worker was killed after durable claim, with the embedding dependency deliberately
  paused. The live lease was not reset prematurely. After the actual 120-second
  expiry, getRun reconciled it to failed. No time rewriting or paid model calls.
  This is process-failure proof, not AI output quality certification.
  Proof: `/private/tmp/orchestra-step7-research-crash-0AXeG9/report.json`.
- New harnesses pass syntax checks; local secret scan and inventory/import gates
  pass. App code/dependencies are unchanged from the previously verified 1,649-test
  source candidate, so unrelated suites were not repeated for reassurance.

See INTERNAL-UPDATE-RECOVERY.md for the manual procedure and limitations.
Automatic installation is **not implemented or certified**. Electron's native Mac
autoUpdater requires signing; the user deferred signing, not macOS security.
Do not substitute a custom unsigned installer and silently claim the original
automatic-update gate passed. Physical sleep/wake also remains unverified:
`sudo -n true` requires authentication, so a guaranteed wake could not be scheduled.
No physical sleep was initiated remotely. These remain explicit gaps; main and
production are unchanged, and Step 7 is not marked complete.

Developer ID signing/notarization is explicitly deferred by the user for this
Mac-only **internal** beta. It is not an outstanding request for approval and
does not count as passed public distribution. The other qualification gates
remain in force. Main and production are unchanged.

New verified corrections:

- Concurrent first-run vault creation now converges on one durable encrypted
  identity instead of overwriting it. Oversized encryption output and denied
  credential access fail without publishing partial credentials.
- Private source reads enforce permissions and bounded size, including growth
  or truncation during streaming. Durable replacement preserves the original
  when a write fails.
- Actual ENOSPC on a disposable 32-MiB test volume preserves the original file,
  removes partial writes and permits recovery after freeing synthetic filler.
  Evidence: `/private/tmp/orchestra-step7-disk-full-InjOKm/report.json`.
- Desktop Memory refreshes processing state with bounded, abortable polling.
  Failed processing has a Retry processing action through the existing protected
  backend, without re-uploading or deleting the source. Existing styling stays.
- A real native-host kill after a durable parse claim leads to an explicit failed
  run, not a permanent spinner. The native retry completes with one source.
  Evidence: `/private/tmp/orchestra-step7-worker-crash-7PyNLa/report.json`.
  This is parse recovery, not proof of every research/provider crash path.
- A 150-page synthetic PDF and an 80-message offline conversation survive their
  tested journeys. One long-history usability sample was 156 ms. This is not a
  production AI or enterprise-corpus benchmark.
  Evidence: `/private/tmp/orchestra-step7-corpus-89yrIi/report.json`.
- ZIP extraction rejects traversal, external symlinks, special files, duplicate
  paths, oversize, cancellation and altered bytes. It does not install updates.
- Actual package extraction exposed absolute runtime symlinks back to the build
  checkout. Packaging now preserves relative symlinks, uses the bundled Prisma
  client and rejects links escaping the runtime. The original failed extraction
  proof is retained at `/private/tmp/orchestra-step7-real-extraction-GFjrNe/report.json`.

Current source tests: 1,649 backend/desktop passed, 13 documented skips; frontend
238 passed before the packaging-only change. Desktop build/typecheck, source
inventory/provenance, local secret scan and three npm audits pass. These results
do not close the remaining actual update installation/rollback, physical
sleep/wake and final exact-package qualification work. No automatic updater,
release signing or Step 7 completion is claimed.

### Relocatable 0.0.5 candidate measurements

Candidate package `1e7b4d87-037d-44f7-932e-3063db6a4d5c`, code committed as
`6699131`, was tested on the existing synthetic 0.0.4 transfer profile without
resetting its database. Sixty route samples: p95 67.67 ms; thirty
handler-to-frame samples: p95 12.60 ms; twenty offline retrieval samples: p95
3 ms; observed CLS 0.00000681; no renderer errors. One populated launch was
8.835 seconds while package extraction was running concurrently. These are
single-Mac measurements, not cold-launch p95, INP, external AI or clean-machine
certification. Evidence: `/private/tmp/orchestra-step7-benchmark-RKc8AO/report.json`.

The extraction harness also found AppleDouble metadata sidecars in the default
ditto ZIP. The bundle archive recipe now explicitly omits resource-fork metadata
instead of silently excluding discrepancies from the hash comparison. Every
file, executable flag and symlink must match. Failed runs remain retained;
extraction is not installation or rollback proof.

The corrected full archive subsequently passed: all 20,491 entries match the
bundle's file hashes, executable flags, directories and symlinks. The extracted
application then completed fresh onboarding, source upload/view/download,
cited offline Socrates, multiple chats, draft persistence, deletion and restart
from its relocated directory. Evidence:
`/private/tmp/orchestra-step7-real-extraction-F40Z4o/report.json` and its
`packaged-smoke.log`. This is a real relocated package test on this Mac, not a
second clean computer, signed-public-release test or automatic update install.

An idle rerun after extraction finished recorded: one populated launch 4.039 s,
warm-route p95 69.86 ms, handler-to-frame p95 11.30 ms, local retrieval p95 5 ms,
CLS 0.00000689 and no renderer errors. Same package, profile and sample counts;
both runs are retained. Evidence:
`/private/tmp/orchestra-step7-benchmark-v4FTbk/report.json`.

Initial base: `86e540e`; resumed with completed Step 6 main `2285d06` merged into
`codex/desktop-step-7` on 14 September. Step 6 is complete for the approved
single-Mac scope; it no longer blocks this step. The
second-computer check and Windows remain explicitly deferred. Production is out
of scope. No paid Actions, public release, signing purchase or UI changes.

## Implemented and checked, 13 September 2026

- Read-only Mac signing preflight, with 12 passing acceptance tests. Requires a
  strict nested signature seal, expected Developer ID Application identity/team,
  hardened runtime, Gatekeeper approval and stapled notarization ticket. It
  never labels successful signing alone as a complete release.
- Update-verification primitives, with 17 passing tests. Pinned Ed25519 signer,
  exact signed bytes, bounded metadata, channel/platform, expiry, newer numeric
  application version, separate database compatibility range, trusted HTTPS
  origin and streamed artifact byte count/hash are enforced. Tampering,
  truncation, replay and incompatible schema versions reject.
- These primitives are **not wired to an updater**. There is no production feed,
  pinned release key, download/installation controller or signed update artifact.
  Unit-tested cryptography is not interrupted-update or OS installer proof.
- Real packaged benchmark on the existing internal 0.0.4 build, not a newly
  signed Step 7 candidate: Apple M5, 10 logical cores, 16 GiB RAM, small synthetic
  transfer profile. 60 warm navigations: p95 64.52 ms. 30 input samples:
  input-event-handler to next animation frame p95 14 ms. Observed CLS 0.00000692.
  One populated launch: 3448 ms. No renderer errors observed. This input metric
  is **not INP**, physical input-to-photon latency or a population benchmark.
  Local retrieval, large datasets and external AI were not measured.
- Full desktop/backend suite: 1611 passed, 13 skipped. Frontend: 228 passed.
  Separate signing tests: 12 passed. Backend and desktop typechecks, desktop and
  frontend builds passed. The existing frontend mixed static/dynamic settings
  import warning remains; it is not a build failure.
- npm audits: backend production dependency set, full frontend and full desktop
  dependency sets report zero known vulnerabilities. Not a zero-vulnerability
  guarantee or complete bundled-native dependency audit.
- Source inventory, import provenance, diff checks and the local static secret
  scan passed. Temporary dependency symlinks initially caused the scanner to
  attempt reading a directory; the three worktree-only links were removed and
  the scan rerun successfully. Original installed dependencies were untouched.

The first clean-worktree run lacked the desktop-local `ignore` dependency; two
suites failed to load. After linking the existing unchanged local dependency
directories, the complete suite passed. No test exclusions were added.

## Actual Mac package signing result

Package identifier in its existing code signature was `Electron`, team `not set`.
Strict seal, distribution identity, Gatekeeper and stapled-ticket checks all
failed. This confirms **internal package only**, not a distributable release.
The existing Apple Development identity is not Developer ID Application.
The tool did not alter or sign the app or bypass Gatekeeper.

## Evidence locations (local, synthetic)

- Benchmark: `/private/tmp/orchestra-step7-benchmark-04jsc8/report.json`.
- Baseline package: original checkout `.desktop/packages/33e2d7ca-07fc-4120-966c-5301fb7699c7/Orchestra Desktop Internal-darwin-arm64`.
- Signing can be reproduced with `node scripts/desktop/release-preflight.mjs`
  followed by the full app path, expected Team ID and bundle ID. An internal
  package must fail; do not substitute its observed identity as an approved one.

## Still required for Step 7 completion

1. Step 6 self-hosted credential/provider gate: completed; see STEP-6.md.
2. Review the final packaged IPC/filesystem/parser/auth/credential/prompt-injection
   boundaries and close findings. Passing existing tests is not that full audit.
3. Implement and exercise the actual signed update delivery/install/recovery
   flow, with migration-aware backup and interrupted/tampered artifact tests.
4. Run crash-during-work, physical sleep/wake, disk-full, denied credential
   access, large-data and long-chat qualification against the exact candidate.
5. Benchmark local retrieval and expand cold/warm and data/hardware profiles.
6. Obtain the appropriate signing/notarization credentials without unapproved
   spending; sign all applicable helpers, notarize/staple and qualify installs.
7. Complete exact-candidate clean installation, populated upgrade, recovery and
   data-retaining uninstall checks. Record any explicitly accepted exceptions.

No merge, publication, automatic-update promise or Step 7 completion is justified
by this checkpoint.

## 14 September: verified download staging and recovery

- Added a main-process-only download stage: exact signed manifest, HTTPS origin,
  no redirects/cookies, bounded bytes/time, identity encoding, private exclusive
  files, streamed hash/length verification, fsync and post-download expiry check.
  Nothing is extracted, executed or installed. There is no renderer entry point.
- Startup recovery revalidates the signature, current version/schema policy and
  exact saved artifact bytes. Receipts alone are not trusted. Partial/orphan
  stages are not install candidates; failed retries remove only their own stage.
- Thirteen new tests pass, including actual filesystem writes, a real TLS server
  with a test-only CA, mid-stream cancellation, malicious/truncated data, unsafe
  roots, replay/policy checks through the verifier, preserved earlier downloads,
  and SIGKILL of an owned disposable downloader process after a partial write.
  A fresh retry then succeeds. This is download interruption, **not** interruption
  during application replacement or database migration.
- Full combined desktop/backend gate: **1,627 passed, 13 documented skips**.
  Frontend remains 234/234; its code is unchanged after the Step 6 integration. The twelve
  signing-preflight acceptance tests also pass. Typechecks and import/inventory
  gates pass. No production or main update, paid Actions, or UI restyling.

### Measured internal-package performance

Package: Step 6 internal build `14af2f09-b73d-4a3b-8a73-d3e3fe015c5f`, not a signed
Step 7 release candidate. Same Apple M5/16-GiB Mac, existing synthetic transfer
profile, 60 route samples, 30 handler-to-frame input samples and 20 cited offline
Socrates retrieval samples. No external model calls or AI credits used.

| Measurement | Concurrent-test run | Serial rerun |
| --- | --- | --- |
| Warm route p95 | 150.28 ms | 68.60 ms |
| Input handler-to-frame p95 | 13.10 ms | 11.40 ms |
| Local retrieval p95 | 7 ms | 4 ms |
| Observed CLS | 0 | 0.00000668 |
| Single populated launch | 10.685 s | 4.254 s |

The first run overlapped the full test suite. Both records are retained; neither
establishes a cold-launch p95, large-corpus performance, physical input latency,
or external AI performance. Evidence: `/private/tmp/orchestra-step7-benchmark-JHeCIk/report.json`
and `/private/tmp/orchestra-step7-benchmark-tFvSmQ/report.json`. Offline responses
were required to be explicitly degraded and cited, not represented as live AI.

### Confirmed release barrier and remaining implementation

Read-only signing inventory still contains only Apple Development, not Developer
ID Application. The actual internal package failed strict seal, distribution
identity, Gatekeeper and stapled-ticket verification. Nothing was re-signed with
a substitute identity and no warning was bypassed. No purchase was made.

Remaining: trusted release feed/key provisioning; a real OS-verified installer
controller with application/database backup and replacement recovery; signed
artifact qualification; broad packaged security/fault tests, large-data and
long-chat profiles, physical sleep/wake, and clean installation/update/uninstall
proof. Download staging does not close these requirements. Step 7 remains open
and its branch must not merge to main until its gate passes.
