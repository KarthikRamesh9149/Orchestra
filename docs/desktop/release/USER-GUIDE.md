# Internal beta usage, privacy and recovery

## First run

Choose local or shared explicitly. Local mode stores application-managed data on
this Mac and needs no hosted signup. Add a selected file/folder or repository,
wait for processing, then ask Socrates and inspect its source citation. Without
an AI key, evidence-only reading/search is available; this is not offline model
generation. Configure your own AI key in protected Settings for real generation.
External API use can incur the provider's charges; no credit or subscription is
included. Test the connection and choose usage bounds before asking questions.

For shared mode, enter your operator's trusted HTTPS server and sign in to the
correct workspace. That server owns authorization and accepted changes. Connecting
does not publish local data. Shared offline caching defaults off; enabled caches
are bounded metadata-only, read-only and expire. Reconnect to make shared changes.

## Network and credentials

Local does not mean every operation is offline. AI operations send required
request/context material to the configured provider. Connectors contact the
selected provider and fetch authorized resources. Shared mode sends operations
to the selected server. Source provenance and human approval remain distinct
from generated suggestions. Do not upload secrets you do not want processed.

Credentials use OS-protected storage outside renderer persistence. Database and
source files are not promised application-level encryption at rest; use OS disk
encryption and a protected Mac account. Credential access can require an OS
prompt. Revoking a connector does not prove previously imported files were erased.
Review retained project evidence separately. Export only the intended scope;
core project transfer is not a full-workspace backup and excludes credentials.

No new analytics or automatic diagnostic upload is introduced by Step 8. No
public diagnostics service is configured here. Do not attach raw profiles,
tokens, provider responses, source text or private screenshots to public issues.

The current web HTML also references Google Fonts (Geist and Geist Mono).
Actual packaged font/network behavior and redistribution notices require final
publication review; do not describe this candidate as making no network requests.

## Update, backup and uninstall

Use the [manual update and recovery procedure](../INTERNAL-UPDATE-RECOVERY.md).
Quit the app before a cold profile backup. Preserve the entire profile privately;
its credential envelopes may depend on this Mac's OS account. Do not promise
cross-machine credential restoration. Shared operators must follow the separate
[server recovery guide](../../../infra/self-host/v1/RECOVERY.md).

Never run old code against a new schema. Rollback restores the corresponding full
checkpoint and can exclude work since that checkpoint. Removing only the app
retains data. Profile deletion is a separate irreversible choice, not part of a
normal uninstall. No automatic updater is active.

## Troubleshooting and support preparation

- Failed processing: inspect the displayed error, then retry; do not invent a successful import.
- Missing source: check selection, permissions, sync state and source relevance.
- Revoked provider: reconnect with fresh authorization and reselect resources.
- Runtime failure: preserve data and restart; never delete PostgreSQL lock files.
- OS security warning: stop; do not bypass it to install an unsigned public build.
- Shared errors: verify server/workspace identity, TLS validity and operator status.

For a private support report, provide app version, macOS/architecture, local/shared
mode, reproduction steps and redacted error code. Source content and credentials
are not required by default. A named support/recovery owner and response channel
must be confirmed before a public beta; none is advertised as staffed here.
