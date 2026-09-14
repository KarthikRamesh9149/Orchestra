# Step 7 complete for the approved internal-beta scope

On 14 September 2026 the user explicitly approved deferring automatic updates
and closing Step 7 as **unsigned, Mac ARM, manual-update-only internal beta**.
Signing/notarization, Windows and two-physical-computer qualification were already
deferred. None of these deferred items is claimed passed. Step 8 is not started;
this is not public-release certification or a zero-bug guarantee.

## Verified candidate and retained checks

- Application code: `6699131`; subsequent Step 7 commits through `f50d7e2` change
  only qualification harnesses and evidence. The application, dependencies and
  schema are unchanged, verified by scoped Git diff before closure.
- Package: `.desktop/packages/1e7b4d87-037d-44f7-932e-3063db6a4d5c/Orchestra Desktop Internal-darwin-arm64`.
- Backend/desktop source suite: 1,649 passed, 13 documented skips. Those skips
  remain skips; packaged tests are separate evidence, not a relabelled suite.
- Frontend: retained 238 passing tests; builds/typechecks, dependency audits,
  source inventory/import provenance and local secret scan passed. Documentation-
  only closure does not rerun unrelated model/provider suites or consume credits.
- No unresolved reproducible Critical/High finding was identified in the tested
  candidate scope. Broader hardware, future dependencies and public distribution
  remain outside this claim.

## Real package and failure evidence

| Check | Verified outcome / local report |
| --- | --- |
| Relocated package | All 20,491 archive entries matched; fresh onboarding, upload/view/download, cited offline chat, chat deletion, drafts and restart passed. `/private/tmp/orchestra-step7-real-extraction-F40Z4o/report.json` |
| Manual update and rollback | 0.0.4 → 0.0.5 preserved the populated fixture; actual interrupted copy left the old app usable; full-profile rollback and upgrade retry passed. Removing/restoring only the bundle retained data. `/private/tmp/orchestra-step7-manual-upgrade-Kvg9Z8/report.json` |
| Physical sleep/wake | User closed lid; 39.024 seconds between real suspend/resume. Runtime, source, cited conversation and draft survived navigation/reload; no renderer errors. `/private/tmp/orchestra-step7-physical-wake-OrLJkH/report.json` |
| Research crash | Actual packaged handler killed after durable claim, with a deliberately paused embedding dependency. Real 120-second expiry became explicit failure, not a spinner. No model calls. `/private/tmp/orchestra-step7-research-crash-0AXeG9/report.json` |
| Parse worker crash | Owned worker killed after claim; native retry completed without duplicate source. `/private/tmp/orchestra-step7-worker-crash-7PyNLa/report.json` |
| Disk full | Real ENOSPC on a bounded disposable volume preserved original data, avoided partial credentials and recovered. `/private/tmp/orchestra-step7-disk-full-InjOKm/report.json` |
| Larger local fixture | 150-page PDF, 40 offline turns/80 messages; persistence, drafts and navigation passed. `/private/tmp/orchestra-step7-corpus-89yrIi/report.json` |

Runtime SIGKILL, upload reconciliation, keyboard cancellation, persisted removal,
native download cancellation, chat cancellation/completion and transient transport
failure were also repeated on this candidate. Earlier failed harness runs remain
in STEP-7-CHECKPOINT.md. Simulated transport failures and paused model dependencies
are labelled as fault injection, never live AI quality.

## Performance and boundaries

Idle rerun on the current candidate, one Apple M5/16-GiB Mac and small synthetic
workspace: 60 warm-route samples p95 **69.86 ms**, 30 input-handler-to-frame
samples p95 **11.30 ms**, 20 offline retrieval samples p95 **5 ms**, observed
CLS **0.00000689**. One populated launch was **4.039 s**. A concurrent-extraction
launch took 8.835 s; both samples are retained. Input measurement is not browser
INP or physical input-to-photon; launches are not population p95. External AI and
enterprise-size datasets are not certified by these numbers.

See INTERNAL-UPDATE-RECOVERY.md for the qualified manual procedure. Restore the
whole earlier profile when rolling back; do not downgrade a newer database in
place. Later changes remain separately retained, not automatically merged.
Automatic update installation remains unavailable and deferred; no warning bypass,
paid service, Actions workflow or public publication was introduced.

## Next step

Step 8 requires the user's separate instruction and publication approval. It
must resolve the applicable public-distribution/licensing/signing and independent
download/testing gates. Do not silently carry this internal-beta exception into
a claim that signed public distribution or automatic updating works.

The private Orchestra repository alone is in scope. `orchestrav2`, production
databases/services and `beta.orchestraos.dev` remain untouched.
