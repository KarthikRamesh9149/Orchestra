# Step 7: independent hardening work, not release completion

Base: `86e540e` on `codex/desktop-step-6`. Working branch: `codex/desktop-step-7`.
The user authorised parallel sequencing while the Step 6 credential save/real
self-hosted provider tests wait. Step 6 is not merged or called complete. The
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

1. Complete the Step 6 self-hosted credential/provider gate.
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
