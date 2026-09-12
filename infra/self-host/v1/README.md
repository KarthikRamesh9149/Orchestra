# Orchestra self-hosting v1 (internal Step 6 candidate)

This package is not a qualified public release. It runs the existing API, web
frontend and BullMQ worker with operator-owned PostgreSQL/pgvector, Redis and
private file storage. It does not use or modify Orchestra's managed production.
The selected team server is authoritative; local desktop data is never published
by connecting to it.

## Fresh installation

Prerequisites: Docker with Compose, an operator-owned HTTPS origin, a certificate
trusted by the desktop client, and a protected configuration directory outside
source control. The consumer local desktop app does not require Docker; these
instructions are for the shared server operator.

The current source build exceeded a 2 GiB container VM during strict TypeScript
compilation. Allocate at least 4 GiB to the build VM; this is a build prerequisite,
not a measured production runtime sizing recommendation. Do not disable type
checking to work around an undersized builder.

From this repository root, generate **new** installation-specific configuration:

```sh
node scripts/desktop/init-self-host.mjs /absolute/private/orchestra-config https://orchestra.example.org
```

The example domain must be replaced with the operator's real origin. The command
refuses to overwrite a directory. Keep its files private: they contain session,
database, vault and proxy secrets. Do not paste them in issue reports or commit
them. Preserve `DESKTOP_SHARED_SERVER_ID` across updates and restores; a changed
identity is intentionally rejected by saved desktop connections.

Securely edit `bootstrap-account.json` with the owner's email, display name,
organization name and a unique password of at least 12 characters. This one-shot
bootstrap works only when the database has no users. It neither opens public
signup nor marks an email verified.

Set `SELF_HOST_CONFIG_DIR` to that absolute directory and
`ORCHESTRA_HTTPS_ORIGIN` to the same exact HTTPS origin. Both are needed when
Compose parses this file, including commands that do not start the TLS profile.

```sh
docker compose -f infra/self-host/v1/compose.yaml build api migrate
docker compose -f infra/self-host/v1/compose.yaml up -d postgres redis api worker web
docker compose -f infra/self-host/v1/compose.yaml --profile setup run --rm bootstrap
```

Fresh migrations are executed by a separate migrator role. API and worker use a
non-owner, non-superuser, non-BYPASSRLS database account. PostgreSQL and Redis have
no host-published ports. Backend-only RLS policies are not a substitute for the
API's organization, project, role and private-chat authorization.

## HTTPS

Either terminate trusted HTTPS in an operator-maintained reverse proxy forwarding
to the loopback web port (4186 by default), or put the certificate chain and key
in `tls-certificate.pem` and `tls-key.pem` inside the private config directory:

```sh
docker compose -f infra/self-host/v1/compose.yaml --profile tls up -d tls
```

The supplied TLS proxy binds `127.0.0.1:4446` by default. For a real team server,
explicitly choose the bind address/port with `SELF_HOST_BIND_HOST` and
`SELF_HOST_TLS_PORT`, configure the firewall, and make the origin match exactly.
Only expose HTTPS to clients. Certificate issuance, renewal and expiry alerts are
operator responsibilities; restart the TLS service after replacing a certificate.
The included proxy does not implement automated certificate renewal.

`create-shared-test-certificate.mjs` is exclusively a disposable localhost
qualification helper. It is not trusted by ordinary clients, and it does not
install trust or disable certificate verification. Never distribute it as a
production certificate.

## AI, invitations and providers

With no OpenAI key, the server offers honest offline/evidence-only behaviour,
not simulated model output. Configure the operator's own key and generation,
embedding and transcription models in protected `application.json`. Set all
applicable `SOCRATES_MODEL_*_COST_PER_1M` and embedding/reranking cost fields from
the operator's actual provider pricing; startup rejects missing positive cost
configuration when generation is enabled. No key or paid account is supplied.

Invited users can redeem email-bound join codes and choose their own passwords.
Code creation is not proof that an email was delivered. This candidate does not
configure an email sender automatically; automated sender setup and its operator
instructions remain a Step 6 gap. Never reuse the founder's hosted sender or
desktop user's local provider grants.

Register separate server-owned provider applications and exact server callbacks.
Configuration is validated in `src/config/env.ts`: Slack uses `SLACK_CLIENT_ID`,
`SLACK_CLIENT_SECRET` and `SLACK_REDIRECT_URI`; Google uses `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URI`; GitHub uses its `GITHUB_APP_*`
configuration. Required webhook secrets must be supplied when webhooks are
enabled. The release allowlist defaults to VS Code. Add a provider to
`PROVIDER_RELEASE_VALIDATED_PROVIDERS` only after its real server-specific
connect, sync, evidence and revoke tests pass. Step 5's desktop connector tests
do not certify these separate server registrations.

## Desktop connection and data boundaries

Use Shared servers in local desktop onboarding or Settings. Confirm the exact
HTTPS origin in the native prompt. The app validates protocol compatibility and
server identity before sending account credentials. Each connection uses an
isolated in-memory browser partition; grants are encrypted by macOS-protected
storage outside the renderer. Neither another server's credentials nor the local
owner token is forwarded.

Shared offline caching is disabled by default. The optional administrator-enabled
document-metadata cache is described below. Server removal attempts
confirmed remote sign-out first; an outage is reported, not silently treated as
successful revocation.

## Optional shared read-only cache

Caching is disabled by default. An operator may set these string values in the
protected `application.json`, then recreate the API service:

```json
{
  "DESKTOP_SHARED_CACHE_ENABLED": "true",
  "DESKTOP_SHARED_CACHE_TTL_SECONDS": "300",
  "DESKTOP_SHARED_CACHE_MAX_BYTES": "5242880"
}
```

TTL must be 60–86400 seconds; the total budget must be 1 KiB–50 MiB. The desktop
also limits individual JSON responses to 1 MiB and entries to 128. Only previously
authorised document lists and document metadata are eligible. File downloads,
viewer content, private chats, auth/bootstrap and approval/readiness results are
not cached. This is a narrow document-metadata convenience, not a fully offline
shared workspace. Opening a new shared window still requires the server.

Snapshots stay in that window's memory, never on disk. Offline responses are
labelled **Cached evidence · read-only**; mutations are rejected, not queued.
Expiry, a session/policy change, detected authorization rejection, or Mac wake
purges snapshots. If a cached response was displayed, the renderer reloads to
remove stale content. Reconnection validates the server and live authorization
before loading authoritative data. An undetectable remote revocation while
offline cannot be known immediately; the configured TTL bounds that exposure.
Keep caching disabled when even that temporary exposure is unacceptable.

## Recovery and update evidence

The three named volumes hold PostgreSQL, private application files and Redis
queue state. Configuration and vault encryption keys must be protected and
recoverable separately. Do not delete volumes or use `down -v` for an update.
An application-image rollback does not imply a safe database downgrade.

The repository's `verify-shared-recovery.ts` is a **synthetic-only test**, not a
customer backup utility. It pauses only the disposable test stack, encrypts its
database/file snapshot, restores to a new database and private directory, compares
every public table and file hash, and rejects tampering/wrong passphrases. Its
test passphrase is co-located with its disposable archive for inspection; real
backups must store the passphrase separately.

`verify-shared-stack-recovery.ts` additionally restores a dedicated Redis snapshot,
boots a **new isolated** API and worker, completes an actual pending document job,
and verifies sign-in and downloaded source bytes. It reapplies immutable migrations
on the populated restore. It refuses accounts outside the synthetic qualification
domain and stops its restored stack afterward. Its temporary ownership capability
is granted only to the one-off restore helper; API and worker remain restricted.

Operator-facing complete backup tooling remains unqualified. A populated native
0.0.3-to-0.0.4 application upgrade and scoped encrypted core transfer with explicit
identity mapping passed on one Mac; see `docs/desktop/STEP-6-CHECKPOINT.md` for the
exact evidence and exclusions. This is not proof of a schema-changing upgrade or
two-computer operation. Reapplying migrations is not an actual version upgrade.
Do not use a whole database restore as a substitute for authorized project transfer.

No full recovery, two-computer or release-readiness claim is made by this package.
