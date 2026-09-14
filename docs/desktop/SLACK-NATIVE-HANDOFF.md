# Slack native callback qualification

Status: real Mac handoff, import, restart and revocation verified. Public
Slack app distribution activated with explicit owner approval; cross-workspace onboarding
remains unqualified. Source and downloads remain private.

The desktop callback is `orchestra-desktop://oauth/slack/callback`. The Mac
package declares that scheme; registration occurs only after the user accepts
the desktop connection prompt. Only an active main-process authorization can
consume a callback. Exact destination, state, duplicate parameters, expiry,
cancellation and single consumption are enforced. PKCE S256 binds the token
exchange; no shared client secret is embedded. Unsolicited launches cannot
authorize an account. Existing encrypted token storage and identity checks remain.

Slack's URL editor rejected this native scheme, but its supported app-manifest
editor accepted and persisted it with `pkce_enabled: true`. After real native
handoff verification, the HTTP loopback callback was retired. Older packages
must be replaced before reconnecting Slack. Unused interactivity and Socket
Mode were disabled; scopes remain only
`channels:read` and `channels:history`.

Evidence: 21 targeted callback/token/source/ingestion tests passed; desktop
typecheck, build and Mac packaging passed. The built Info.plist contains the
native URL scheme. These automated checks are separate from the live evidence below.
The complete desktop suite passed 1,653 tests, with 13 explicitly skipped.
Its stale pre-approval licensing assertion was updated to require the actual
owner-approved Apache license while retaining the private-publication boundary.

Live evidence, 15 September 2026: package `1dcc4ced-2e62-45eb-b53c-f275d01752c4`
built from code `7b69edc` completed Slack consent and native OS dispatch. The app
reported credentials saved for OrchestraOS. Only the explicitly authorized
synthetic channel `orchestra-desktop-qualification` was imported: five messages
saved as evidence. Quit/reopen restored the workspace, source cards and Slack
credentials. Disconnect successfully revoked this test installation's credentials
and returned to the disconnected state. The test connection is left disconnected;
the synthetic workspace/evidence remain for inspection.

The UI-control timeout came from an idle older build holding the single-instance
lock. Closing that old onboarding window allowed the exact new package to launch.
No security warning was bypassed.

After saving the native-only registration and confirming the reviewed no-hardcoded
tokens declaration, Slack enabled its Activate Public Distribution button.
The owner then explicitly approved activation. Slack confirmed "Share Your App
with Any Workspace" and displayed "Deactivate Public Distribution" on 15
September 2026. This is app installability, not Marketplace review approval or
publication of the private source/packages. Users must start authorization from
the desktop app so a live PKCE verifier and state exist; the generic Slack share
button alone does not establish a desktop authorization session.
Browser cancellation/reconnect and
non-owner-workspace installation are not newly certified by this live run;
cancellation/replay/expiry have automated coverage. Public source, packages,
Marketplace submission and production changes remain outside this approval.

Provider reference: https://docs.slack.dev/authentication/using-pkce/
