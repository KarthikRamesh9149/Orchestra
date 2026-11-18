# Desktop release verification and recovery handoff

Verify the exact clean source revision and rebuilt artifact. This procedure
covers an **internal Mac ARM candidate**, not public installer qualification.

## Run the gates

1. Record the candidate Git SHA and tree (`git rev-parse HEAD 'HEAD^{tree}'`).
   Open a pull request to `main`, or dispatch **Desktop source checks** on that
   branch. Both `source` and `dependency-audit` must pass. Record the run link
   and confirm its tested tree matches the package's source. A skipped job
   is not a pass.
2. Build and package on Apple Silicon using [BUILD.md](BUILD.md). Record the
   new package path from the packager. Record SHA-256 for
   `Contents/Resources/app.asar` and
   `Contents/Resources/runtime/native-manifest.json` in that app, and for
   `.desktop/native/darwin-arm64/build-provenance.json`. Record the Mac and OS
   used and the source revision alongside those digests. Rebuild and recheck
   when source, lockfiles or native inputs change.
3. Verify private chat projections from the checkout:
   `npx --no-install vitest run --config vitest.desktop.config.ts tests/dashboard-service.test.ts tests/beta-timeline-service.test.ts tests/suggestions-service.test.ts`.
   In an isolated shared fixture with two signed-in actors, confirm the second
   actor cannot see the first actor's private chat previews in Dashboard,
   Timeline or suggestions. Verify the package opens the cited document from
   a saved Socrates answer using the keyboard. Capture results by identity and
   route, without chat content. Do not use real customer chats as fixtures.
4. Run the workflow's **Durable database job recovery** and **Restricted
   engine, approvals and backup restoration** gates. Restore the synthetic
   backup to an empty target, confirm evidence bytes and decision history, and
   check that the original workspace is intact. Follow the package upgrade/
   rollback procedure in [Step 7](../STEP-7.md) before promoting a populated
   install. Never test rollback by downgrading a migrated live database.
5. Exercise the changed UI and failure states. The Tier 3 check creates a
   fresh offline profile, checks the saved answer's keyboard route and
   Chromium accessibility tree, and runs the packaged report renderers:
   `node scripts/desktop/verify-tier3-presentation.mjs "/absolute/path/to/Orchestra Desktop Internal.app" "$(git rev-parse HEAD)" "$(git rev-parse 'HEAD^{tree}')"`.
   Link the evidence to the package digests. Separate simulated transport, real
   provider calls, rendered UI and automated accessibility checks; none
   substitutes for another. Keep check outputs local or in approved private
   storage. Share only the revision, checksums, pass/fail and non-sensitive
   run links on the source pull request.

## Advisory cadence

The workflow runs its small audit job daily at 02:23 UTC and on the source
checks above. It audits all four locked npm graphs including development
tools (root, Desktop including Electron, frontend, VS Code) with no severity
suppression. It installs no packages for the scheduled check. This workflow
is restricted to the public repository's standard runners and does not
publish, deploy, or use paid storage. GitHub may delay scheduled jobs; check
the most recent result in **Actions** and run a manual recheck if it is stale.

The maintainer watches failed Actions runs and triages critical runtime
findings before promoting any candidate. Fix the locked version and rerun both
the exact-head audit and affected package tests. npm advisories do not cover
the bundled standalone PostgreSQL, OpenSSL or Node binaries: check their
upstream security notices against the native source pins at candidate review.

## Ownership and recovery

The current reviewer and recovery owner is **@KarthikRamesh9149**. The
`CODEOWNERS` file routes sensitive changes to that account. There is currently
**no verified second maintainer**. The owner must designate a real backup,
confirm repository access and have them execute the gates above on a
synthetic profile. Record who ran the checks and the artifact digests. A
self-review or green workflow is not evidence of independent coverage.

For an internal rollback, preserve the affected profile and diagnostic logs
without secrets. Restore a verified **complete** backup to an isolated target
and test it with the matching prior application before reselecting it. See the
[user recovery guide](USER-GUIDE.md) for the supported recovery flows.
