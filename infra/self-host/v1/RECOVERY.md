# Operator backup and recovery

This is a **self-hosted, operator-only maintenance operation**, not project
export/import. A backup contains all users' server data and private files. Only
the server operator should have access. It never connects to managed Orchestra.

## Before starting

- Use this repository's installed Node dependencies and a local Unix-socket
  Docker context. Remote Docker contexts are rejected.
- Set `SELF_HOST_CONFIG_DIR` and `ORCHESTRA_HTTPS_ORIGIN` as for installation.
  Preserve the original private configuration independently: database passwords,
  encryption keys and `DESKTOP_SHARED_SERVER_ID` must survive a restore.
- Keep a unique 16–1024 character passphrase in a password manager, and supply it
  through a separate regular file with mode `0600`. Do not put it in a command
  argument, environment variable, commit, or the backup directory.
- Use a dedicated private archive directory with mode `0700`. The archive is
  created exclusively with mode `0600`; existing archives are never overwritten.
- Schedule downtime. API, worker, web and TLS are stopped while the snapshot is
  taken and their previously running services are restarted afterward. Do not run
  other maintenance, one-off writers, or manually start services during this window.
- The bounded v1 tool supports at most 128 MiB of decoded database/files/queue
  content combined, 64 MB of private files, 10,000 files and 100,000 queue keys.
  Larger installations need a separately qualified streaming backup tool. A size
  failure is not a successful backup and never permits truncation.

The tool creates `.recovery.lock` in the private configuration directory to reject
overlapping invocations. A forced process kill can leave that lock behind. Check
that the recorded process is gone and inspect service state before removing that
specific stale lock; never remove a live maintenance lock.

## Backup

From the repository root, replacing the paths and Compose project deliberately:

```sh
node --import tsx scripts/desktop/self-host-recovery.ts backup orchestra-shared-v1 /absolute/private-backups/server.orchbk /absolute/separate-private/passphrase
```

This encrypts the PostgreSQL custom dump, private application directory and Redis
queue entries/absolute expiries using AES-256-GCM and scrypt. It does not write a
plaintext dump or copy configuration into the archive. Keep the exact application
image as well as the archive and separate original configuration. A successful
backup still requires a restore drill before it is relied on.

An optional `ORCHESTRA_RECOVERY_COMPOSE_OVERRIDE` points to an operator-owned
Compose override (for example, an immutable application image). It is privileged
operator configuration, never an attachment or untrusted downloaded file.

## Transfer orphan reconciliation

Append `--quarantine-orphans` to the backup command to reconcile immutable
transfer-attempt files while application writers are stopped. Only paths in the
validated transfer namespace that are absent from document and attachment file
references qualify. **The encrypted backup is completed first.** Referenced files
and unrelated files stay untouched. No files are deleted.

Candidates move into the private `transfer-quarantine` directory. Its manifest
records original keys before moves begin, so an interrupted move remains
recoverable. Quarantine does not reclaim disk space. Recover from the preceding
backup into an isolated stack if investigation requires the original files; do
not blindly move quarantined files into a running server.

## Restore into a new isolated project

1. Use the original protected configuration and exact backed-up application image.
   Keep the source stopped during a real cutover; never expose two independent
   copies as the same authoritative team server.
2. Choose a **new** Compose project name. Existing containers or labelled volumes
   cause refusal, including a partially restored target from an earlier failure.
3. Authenticate/decrypt the backup and restore:

```sh
node --import tsx scripts/desktop/self-host-recovery.ts restore orchestra-recovery-new /absolute/private-backups/server.orchbk /absolute/separate-private/passphrase
```

4. The restored database and Redis are left stopped; API and worker have not been
   started. Run the matching Compose configuration with an isolated web port:

```sh
SELF_HOST_WEB_PORT=0 docker compose -f infra/self-host/v1/compose.yaml -p orchestra-recovery-new up -d --wait api worker web
```

   Include the same `-f` image override when one was used. The migration helper
   must match the intended application revision. It reapplies immutable migrations
   and provisions the restricted runtime password. Do not run a newer migration
   merely to restore an older image, or assume database downgrades are safe.
5. Verify health, login, role/private-chat isolation, document bytes, accepted
   truth and pending jobs on the isolated target. Only then arrange a deliberate
   HTTPS cutover and stop the old authoritative server.

Wrong passphrases, invalid payloads, non-empty targets and wrong images fail
closed. A partial failed target is retained for inspection, not erased or reused.
Configuration and container error output are not logged by the tool.

## Recorded qualification

The 13 September single-Mac synthetic drill created an encrypted backup, restored
new volumes, booted API/worker/web, matched document/version/accepted-brain/member
fingerprints, verified two authenticated exact-hash downloads and logout, and
rejected a repeat restore over that populated target. Four unreferenced synthetic
transfer files were backed up and quarantined. See the Step 6 checkpoint for
scope and remaining checks. This does not certify arbitrary-size installations,
two computers, or future schema migrations.
