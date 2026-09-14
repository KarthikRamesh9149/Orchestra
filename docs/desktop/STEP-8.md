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
