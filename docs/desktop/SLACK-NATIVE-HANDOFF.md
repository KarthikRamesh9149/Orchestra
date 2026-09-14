# Slack native callback qualification

Status: implemented, not release-qualified. Source and downloads remain private.

The desktop callback is `orchestra-desktop://oauth/slack/callback`. The Mac
package declares that scheme; registration occurs only after the user accepts
the desktop connection prompt. Only an active main-process authorization can
consume a callback. Exact destination, state, duplicate parameters, expiry,
cancellation and single consumption are enforced. PKCE S256 binds the token
exchange; no shared client secret is embedded. Unsolicited launches cannot
authorize an account. Existing encrypted token storage and identity checks remain.

Slack's URL editor rejected this native scheme, but its supported app-manifest
editor accepted and persisted it with `pkce_enabled: true`. The existing HTTP
loopback callback is retained during qualification so older packages can still
connect. Unused interactivity and Socket Mode were disabled; scopes remain only
`channels:read` and `channels:history`.

Evidence: 21 targeted callback/token/source/ingestion tests passed; desktop
typecheck, build and Mac packaging passed. The built Info.plist contains the
native URL scheme. These are not a real Slack OAuth or OS-dispatch pass.
The complete desktop suite passed 1,653 tests, with 13 explicitly skipped.
Its stale pre-approval licensing assertion was updated to require the actual
owner-approved Apache license while retaining the private-publication boundary.

Remaining gate: launch the exact new package, authorize Slack, verify secure
credential persistence and selected synthetic-channel ingestion, cancellation,
reconnect and revocation. Native UI automation currently times out selecting
the exact package, and bundle-ID selection is ambiguous across old packages.
Do not remove the legacy redirect until this real handoff passes. Then recheck
Slack distribution eligibility and obtain explicit activation approval. Do not
claim cross-workspace onboarding from owner-workspace evidence alone.

Provider reference: https://docs.slack.dev/authentication/using-pkce/
