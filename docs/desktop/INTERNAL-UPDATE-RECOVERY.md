# Internal Mac beta: controlled update and recovery

This is a maintainer-operated **manual** update procedure. Orchestra does not
currently expose an automatic update installer. Developer ID/notarization is
deferred by the user; that does not permit suppressing macOS security warnings.
Electron's [native macOS automatic updater requires a signed application](https://www.electronjs.org/docs/latest/api/auto-updater).
Do not describe the download/extraction helpers as a working automatic updater.

## Procedure and limits

1. Use the reviewed private-repository candidate. Verify its artifact against
   independently trusted release metadata, not a hash obtained from the same
   untrusted download. The current internal test packages are not public releases.
2. Quit Orchestra and confirm its owned PostgreSQL process has stopped. Never
   remove a live database's lock/PID files to force an update.
3. Preserve the old application and a complete, private, cold copy of the user
   profile. This includes database, source files, preferences and encrypted
   credential envelopes. It is not a shareable workspace export. Retain filesystem
   privacy and disk-encryption protections; do not publish the backup.
4. Copy the candidate to a separate location. An interrupted copy must never
   replace the working application. Only launch after copying and verification
   finish. Do not weaken Gatekeeper, change global trust or use quarantine removal.
5. Check the populated workspace, source IDs and bytes, conversation history and
   restart behaviour. The current qualification is 0.0.4 to 0.0.5 on unchanged
   schema. It does not certify an arbitrary future migration or database downgrade.
6. For rollback, stop the candidate, retain its profile separately, restore the
   **entire earlier profile**, then launch the earlier application. This restores
   the checkpoint: later edits are not automatically merged. Never run old code
   against a newer schema and assume safety.
7. Removing only the app bundle must retain user data. Data erasure is a separate,
   explicit operation; the test uses a recoverable move, not destructive removal.

## Reproducible qualification

`scripts/desktop/qualify-manual-upgrade.mjs` takes an old package directory, a new
package directory under this checkout's `.desktop/packages`, and a previously
verified synthetic `orchestra-step4-acceptance-*` profile. It works only on a new
private copy; originals remain untouched. It terminates its own in-progress copy
process, verifies the old app still works, installs the new app, makes a real
synthetic session, restores the full checkpoint and retries the upgrade. It also
removes/restores only the copied bundle and verifies retained data.

Latest passing proof: `/private/tmp/orchestra-step7-manual-upgrade-Kvg9Z8/report.json`.
This is not unattended update delivery, a power-loss test, a second computer or
public distribution certification. Those distinctions must remain in release notes.
