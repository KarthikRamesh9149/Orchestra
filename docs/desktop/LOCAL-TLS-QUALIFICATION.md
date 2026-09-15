# Local shared TLS handoff

The running synthetic server at https://localhost:4446 is not production.
A fresh Brave reload initially showed a certificate privacy error. After the
owner approved the specific macOS trust prompt, fresh HTTPS and authenticated
browser workspace loading passed on 16 September 2026 (Sydney).

`scripts/desktop/create-shared-test-ca.mjs` now prepares a two-day localhost-only
CA and leaf in an existing private `.desktop` directory. It does not install
trust, change another application, replace existing files or restart services.
The generated key files are mode 0600. The CA has path length zero and critical
name constraints permitting localhost and 127.0.0.1 only.

The regression test proves a localhost leaf verifies, a signed non-local-name
leaf is rejected by OpenSSL name constraints, and repeat generation refuses
overwrites. This is not proof of macOS/Chromium trust-store behavior.

The scoped trust handoff and synthetic proxy leaf replacement are complete.
macOS `security verify-cert` accepts the localhost leaf; curl validates it and
returns 200. Brave loads the real owner workspace, Memory and Settings without
a privacy interstitial. The test CA expires 17 September 2026 00:48:01 UTC.
Its SHA-256 fingerprint is
`A14AE962B59943AB627358A849C94E68D5F2F85EEEB2ACC634F3951BB58EA52F`.
Only the local TLS proxy was restarted; its old leaf/key were backed up.

The packaged desktop still failed with Node fetch after browser trust worked.
Shared handshake, authenticated requests and logout now use an isolated
Electron session's Chromium fetch, retaining HTTPS verification, no cookies,
no response cache, redirect rejection and request cancellation. No custom
certificate accept callback, shipped CA or TLS-disable flag was introduced.
The rebuilt package reached shared sign-in and a disposable developer logged
in successfully, seeing only its synthetic project with Dev access.
The developer loaded the owner's synthetic document and saw disabled role
selectors, no workspace-edit control, and honest manager-only access denial.
After a clean quit, the final rebuilt package restored the protected shared
session, then logout returned to sign-in. No owner password was exposed.

Verification: 1,658 desktop tests passed, 13 intentionally skipped; desktop
typecheck/build, import-provenance check, supplemental-notice tests and local
security scan passed. The final package contains all seven currently reviewed
supplemental notice files with matching hashes. These checks do not close the
12 remaining package attribution reviews in THIRD-PARTY-REVIEW.md.

Twelve real HTTPS shared-transport assertions passed, including protected
grants, role denial, private-chat isolation, upload/download, restart grant
resume, refresh rotation and logout. This is single-machine testing, not a
two-computer pass. Selected-channel Slack sync completed at
2026-09-15T15:20:25Z; selected-root Drive sync completed at 15:20:38Z. These
existing accounts do not qualify new-account provider onboarding.

Do not click through browser warnings or disable TLS verification.
Temporary trust was removed successfully through `security remove-trusted-cert`
after the owner's macOS approval. A fresh `security verify-cert` now returns
`CSSMERR_TP_NOT_TRUSTED`, confirming the temporary grant is no longer effective.
The private test CA/leaf files remain for evidence; no unrelated trust was removed.
Fresh browser connections to this disposable server now require deliberate new
test trust; do not bypass that expected warning. Record exact certificate
fingerprints before changing any trust entry. Never remove unrelated certificates.

The owner has no second GitHub account. Non-owner GitHub enrollment remains
unverified, not passed. Public distribution and production remain untouched.
