# Local shared TLS handoff

The running synthetic server at https://localhost:4446 is not production.
A fresh Brave reload on 15 September still showed a certificate privacy error.
An initially cached page also reported a stale dynamically imported module;
that cached response is not evidence that TLS now works.

`scripts/desktop/create-shared-test-ca.mjs` now prepares a two-day localhost-only
CA and leaf in an existing private `.desktop` directory. It does not install
trust, change another application, replace existing files or restart services.
The generated key files are mode 0600. The CA has path length zero and critical
name constraints permitting localhost and 127.0.0.1 only.

The regression test proves a localhost leaf verifies, a signed non-local-name
leaf is rejected by OpenSSL name constraints, and repeat generation refuses
overwrites. This is not proof of macOS/Chromium trust-store behavior.

Completion still requires the scoped OS trust handoff, configuring only the
synthetic TLS service to use the generated leaf, and successful fresh browser
and desktop connections. Do not click through browser warnings or disable TLS
verification. Remove test trust after qualification; record exact certificate
fingerprints before changing any trust entry. Never remove unrelated certificates.

GitHub enrollment separately requires verification of the signed-in owner
account. Owner enrollment is not a non-owner onboarding test. Complete the
authorized distinct-account journeys before closing that gate.
