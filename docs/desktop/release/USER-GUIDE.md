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

## Add an API key

In a local workspace, open **Settings → Desktop AI**:

1. **Select provider**: OpenAI, Anthropic, Google Gemini or an OpenAI-compatible API.
2. Copy the provider's key and choose **Add API key**. Confirm the native prompt; the key is not entered in the web renderer.
3. Enter the exact generation model ID supported by your account. For a compatible API, enter its public HTTPS API base URL first.
4. Optionally configure embeddings, then set request and output limits.
5. Choose **Test connection**, then **Save and restart**. A change to the tested settings requires a new test.

Keys are held temporarily in native memory and encrypted using macOS protection
when saved. Pending imports and successful tests expire after 15 minutes. Saved
keys are never reused for a different provider or API endpoint. **Remove AI
access** removes the saved configuration, not the provider account or its key.

Provider support is protocol-specific, not a promise that every API key works.
Compatible generation requires Chat Completions, SSE streaming and strict
JSON-schema output; compatible embeddings must return exactly 1536 dimensions.
Custom destinations must use public HTTPS on port 443; local HTTP endpoints,
custom authentication headers and providers with other protocols are not supported
by this adapter. A connection test checks a small synthetic structured request and
optional embedding request, not every model capability or workflow. It can incur
up to two small provider charges, separately from the saved request allowance.

Qualification as of 20 September 2026: OpenAI has passed real-account Socrates,
Deep Research, streaming and restart checks on the tested Mac configuration.
Anthropic, Gemini and custom endpoints have adapter/security tests but have **not
been qualified with real accounts**. They remain preview integrations. Only an
OpenAI key is currently available for release testing; a successful small
connection test is not full product qualification for another provider or model.

Generation and embeddings can use different providers. With embeddings disabled,
Socrates can still generate answers using lexical evidence retrieval. Changing an
existing index's provider, endpoint or model does not relabel old vectors; semantic
search remains unavailable until safe reindexing is completed. Original files and
lexical search remain available. The request allowance is not a dollar spending cap.

Shared-workspace AI remains configured by the selected server's administrator.
Local keys neither configure that server nor get uploaded to it. Open the local
Orchestra window to configure AI for local workspaces.

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
Geist is copyright 2023 Vercel, in collaboration with basement.studio, under
[SIL Open Font License 1.1](https://github.com/vercel/geist-font/blob/main/LICENSE.txt).
The font files are externally referenced, not included in the source snapshot;
do not describe this candidate as making no network requests. Any future bundled
font delivery must include its corresponding copyright and full license notice.

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
must be confirmed before a public beta. For the current private beta, the owner
is Karthik Ramesh and the contact is hello@orchestraos.dev, as designated in this
task. This is not a 24/7 service or a response-time guarantee. Fresh email-delivery
testing remains separate from identifying the contact.
