# Desktop readiness follow-up — 20 September 2026

Follow-up: the approval/completeness wording findings recorded below were
addressed in [the 21 September correction](AI-AUTHORITY-COVERAGE-2026-09-21.md),
with repeated real OpenAI checks and rebuilt-app verification. The original
observations below remain historical evidence, not current universal claims.

Scope: private `KarthikRamesh9149/Orchestra`, `main`, starting at
`bdc131596dc9c261c487870cd4566ca91d580e9a`. No changes to `orchestrav2`,
managed production, repository visibility or paid infrastructure are authorised
by this follow-up. This document separates confirmed corrections, measured
qualification and remaining release dependencies.

## Corrections

- Saved research no longer repeats an identical leading Markdown title. Only
  that display duplicate is removed; persisted/exported Markdown, other headings,
  fenced evidence, citations and source links are preserved.
- A saved report is never rendered for a different selected workspace or route.
  Clearing the workspace clears the view, and a late response cannot overwrite
  the current workspace's report. Backend denial remains visible.
- Implicit desktop startup waits for the saved onboarding state instead of
  briefly showing first-run privacy controls to a returning installation.
  Explicit onboarding remains accessible; failed checks offer retry rather than
  assuming a new installation.
- Memory now lists saved generated research through the existing authorised
  context endpoint, using ten-row pages and independent loading/error handling.
  User-editable tags alone do not qualify a note as generated research. Reports
  link to stable saved views and do not inflate original-document counts.
- Research exports expose both PDF and Markdown. Duplicate downloads are guarded;
  a late failure from an older run cannot appear on a different report. The PDF
  renderer preserves long reports and source URLs with bounded page layout, and
  explicitly rejects characters its built-in font cannot render. Markdown
  remains the lossless alternative; arbitrary-script PDF support is not claimed.
- Socrates keeps source identity separate from a question's premise and from
  instructions embedded in evidence. Shared streaming/object prompt rules now
  prohibit relabelling a retrieved vendor note as an absent archived source,
  treating a document's approval claim as accepted Product Brain truth, or
  describing a retrieved subset as the complete corpus. Ordinary factual answers
  should not narrate irrelevant observation/request timestamps. Exact temporal
  metadata and existing elapsed-duration validation remain intact.
- Offline search still exposes potentially useful excerpts but explicitly says
  it cannot confirm they answer the question. This is an uncertainty disclosure,
  not a new entity detector or a claim that keyword matches establish an answer.

The duplicate-title and cleared-workspace regressions failed before correction.
The focused saved-report/startup suites pass 16 tests. The download-selection
suite passes 13 tests. Final package verification is recorded below separately
from component tests.

## Recovery evidence

`scripts/desktop/qualify-isolated-ai-recovery.mjs` exercised the compiled native
engine, fresh PostgreSQL and actual production queue/service implementations in
disposable subprocesses. It passed 24 checks in 137.2 seconds:

- SIGKILL after durable domain and queue claims, with healthy leases left intact.
- Real 30/120-second lease expiry, explicit abandoned-run failure and one
  successful explicit retry; duplicate dispatch produced no second report or
  completion audit in the tested case.
- Stream failure, cancellation and a subsequent clean turn preserved the earlier
  transcript and used honest failure/cancellation states.
- PostgreSQL restart preserved the captured recovery snapshot, accepted truth
  sentinel, proposals and source chunks; no running placeholder remained.

Provider transport in this test was deterministic. It made no external AI
requests and does **not** qualify real vendor outages, exactly-once behaviour for
all workloads, or user-interface recovery. Evidence remains private at
`/private/tmp/orchestra-isolated-ai-recovery-eB6C59/report.json`. That immutable
report has null document-count fields from an old reporting accessor; no
document-count conclusion is drawn from it. Later harness edits clarify labels
and that accessor, not the tested production source or acceptance predicates.

`scripts/desktop/qualify-isolated-storage-faults.mjs` passed 13 separate checks.
An injected disk-full error followed an actual 31-byte partial write; existing
source bytes survived, partial files were removed, and retry succeeded. Synthetic
credential protection/encryption/decryption denial did not publish partial or
plaintext credentials or replace the existing envelope. Fixture permissions
were private. Evidence:
`/private/tmp/orchestra-isolated-storage-faults-ihtyPn/report.json`.

These are injected faults, not actual disk exhaustion or OS Keychain denial.
No host security settings, real credentials or existing user data were changed.

## Large-workspace diagnosis and corrections

The original native baseline seeded 1,000 current documents and 10,000 current
chunks, plus obsolete-version, stale-parse, archive and foreign-project decoys.
It failed: empirical retrieval p95 was 3,907 ms after process restart and
4,708 ms for immediate repeated requests. Its immutable evidence is
`/private/tmp/orchestra-native-scale-4XzQOK/report.json` and
`root-cause-review.md`. This is direct synthetic database seeding, not bulk-upload
or parser qualification. Provider requests were zero; generated answers were
explicitly evidence-only.

The investigation found three concrete problems:

- Matching chunks were repeatedly converted to English search vectors while
  answering. An additive stored generated column now maintains that exact
  expression on ingestion/update. The query retains project, current-version,
  parse-revision and archive constraints. Existing indexes remain unchanged;
  no global planner flags or larger evidence limits were introduced.
- A downstream creation-date tie-break displaced an older relevant source from
  a three-document comparison. Non-temporal document score ties now retain
  upstream relevance order, with other-source slots and temporal requests intact.
- Recent fallback rows could qualify on grammatical scaffolding alone. Their
  admission now requires content terms except for broad overview requests.
  Authoritative English full-text matches remain eligible, including stemming
  such as `policies` matching `policy`; an independent review reproduced and
  closed that intermediate regression.

The populated migration clone passed 37 checks: exact top-48 IDs/ranks for
three queries across three SQL forms; all 10,004 stored vector values;
automatic update maintenance; preserved index definitions; and unchanged
original evidence. Migration took 2.009 seconds. Table/TOAST storage increased
about 1.52 MB; a 100-row update measured 14 ms before and 41 ms after. These are
single observations, not write-throughput benchmarks. Evidence:
`/private/tmp/orchestra-scale-search-vector-XdGxdo/report.json`.

The original Saffron test also imposed an unjustified one-document/multiple-chunk
oracle. The revised harness tests topical relevance, records that oracle change,
and does not rewrite the original failure. No source-count inflation was proved
by those baseline cases.

### Repeated native measurement

The corrected candidate passed 60 repeated requests across 30 process relaunches
with the same content fingerprint and eight bounded retrieval/security cases.
Fresh migration, all 10,004 stored vectors, current-version filtering, cross-tenant
denial and answer persistence passed. Zero external-provider requests occurred.

| Measurement | Original empirical p95 | Corrected empirical p95 |
| --- | ---: | ---: |
| Populated native engine startup | 5,098 ms | 1,365 ms |
| First complete native request | 4,025 ms | 143 ms |
| Immediate warm complete request | 4,791 ms | 103 ms |
| First-request retrieval timer | 3,907 ms | 95 ms |
| Warm-request retrieval timer | 4,708 ms | 82 ms |

Hardware: Apple M5, 10 logical cores, 16 GiB RAM; Node 24.19.0. Each empirical
p95 is the 29th of 30 sorted samples. These are process-cold, not cold disk-cache
measurements. The repeated request targets the same older sparse fact; the other
seven cases have single observations. Native startup changes also include the
changed dependency graph, so are not attributed solely to the search-vector
migration. Maximum observed native RSS was 274 MiB, not a measured allocation
peak. The final synthetic profile occupied about 238 MB.

Evidence: `/private/tmp/orchestra-native-scale-lHpVC1/report.json` and
`substantive-review.md`. The report is immutable. Its eight passing cases prove
specified recall, currentness and isolation assertions, not eight perfect answers:
some offline responses still append loosely related excerpts, and the foreign-only
fact case safely withholds foreign data but does not establish the requested answer.
The fallback must be labelled as unconfirmed excerpts rather than an AI answer.
This benchmark does not measure rendered UI, real embeddings/model synthesis,
bulk upload/parsing, clean machines or arbitrary corpus sizes.

A repeat after the prompt/disclaimer correction also passed all 60 repeated
requests and eight bounded cases:
`/private/tmp/orchestra-native-scale-zYa1vy/report.json`. Empirical p95 was
1,661 ms for startup, 170/121 ms for first/warm complete requests and 119/95 ms
for their retrieval timers. This repeat supports the speed result without
pretending the two runs have identical timings. The final subsequent edit only
clarified generation instructions; no retrieval, schema, ranking or limits changed.

The migration is authored SQL deployed with `prisma migrate deploy`. Prisma 6.6
has generated-column introspection/schema-push limitations; operators must not
replace that path with `db push` or treat schema formatting as a migration.

## Provider qualification

Only OpenAI credentials are available. The previous real-account Socrates,
Deep Research, source opening, PDF download and restart evidence remains in
[the BYOK audit](BYOK-AND-RETRIEVAL-AUDIT-2026-09-20.md). Unchanged backend/model
configuration does not need repeated chargeable calls for display-only changes.

Anthropic, Gemini and custom endpoints remain preview adapters with deterministic
protocol/security tests, **not real-account certification**. The user guide
records this explicitly. No accounts, keys or credits were purchased or invented.

A first repeat of the real OpenAI harness passed all six mechanical checks and
restart persistence using four synthetic uploads, four embedding requests and
six generations. Reading the answers nevertheless found source-identity and
unnecessary timestamp wording defects. That evidence is retained at
`/private/tmp/orchestra-retrieval-chain-J4uam7/report.json`, not relabelled as a
perfect semantic pass. The resulting prompt correction has five red-first
contract tests, 124 passing focused tests and an independent read-only review.
Those contract tests do not substitute for the subsequent real-provider rerun.

Two bounded follow-up runs are retained at
`/private/tmp/orchestra-retrieval-chain-3wXnzf/report.json` and
`/private/tmp/orchestra-retrieval-chain-khorE6/report.json`. Each made exactly ten
provider requests (four embeddings plus six generations); there were no automatic
retries or purchases. The last run on the final application source passed all
mechanical cases, complete streaming, citation/target persistence and offline
restart checks. First answer text arrived in 675–1,029 ms and completion in
1,426–2,290 ms; retrieval was 2–5 ms on the four-document fixture. These are six
individual observations, not p95 or large-corpus model benchmarks.

Substantive review found the required fields, owner, unapproved-change distinction,
missing-date/budget response and injection refusal correct. Internal metadata and
irrelevant timestamp narration disappeared. The absent archived document was no
longer equated with the vendor note in the body. However, one answer still said
"the only other supplied document" although the retrieved set also contained a
vendor note. Some document/section labels also repeat the same title. These are
remaining low-severity generation/presentation issues, not a clean semantic pass.
Prompt instructions reduce this risk but do not prove semantic enforcement; the
mechanical evaluation must not be used to certify zero hallucinations or public
readiness. Further semantic regression/abstention coverage remains open.

## Final verification and release boundary

The final candidate's automated and package evidence is listed below; pending
rendered checks are not passed by these results.

- Backend: 2,047 tests passed, 13 explicitly skipped in the desktop gate. Hosted
  tests excluded by the documented desktop configuration are not labelled passed.
- Frontend: 280 tests passed; production build and desktop/VS Code builds pass.
- Native helper suites: 77 tests passed, including schema canonicalisation,
  final-file notice hashing and tamper rejection. The formatter validates before
  formatting so automatic relation repair cannot disguise a stale generated schema.
- Prisma validation/generation, source import provenance, structural inventory,
  the production-mock guard and the local secret scan passed. Four lockfile audits
  each reported zero known vulnerabilities; that is not proof of vulnerability absence.
- Direct PDF fixture rendering was inspected visually with no clipping; this is
  not the final packaged download workflow.
- Exact internal Mac package `d10b7427-486d-45b1-8a03-41ade013c40f` passed fresh
  bundled-runtime launch with an empty PATH, fresh migrations, competing-engine
  rejection, loopback authentication, workspace authorisation, save/reopen,
  parent-IPC loss and SIGKILL recovery. No plaintext duplicate engine credential
  was created. Evidence: `/tmp/orchestra-readiness-native-exact.log`. This tests
  the packaged runtime, not a clean second computer or the Electron UI.
- Exact artifact aggregation covers 343 backend packages, 373 notice files,
  60 frontend outputs and three desktop outputs. There are zero integrity errors,
  missing-notice gaps or unresolved bundled package notices. The five historical
  unresolved packages are absent, not retroactively relicensed. Twenty-eight
  standard-font metric copies retain attributed transformations; six unused
  duplicate browser bundles are omitted with recorded source hashes. Evidence:
  `/tmp/orchestra-readiness-artifact-exact.json`. App archive SHA-256:
  `981eddf1a91251183a8599c1c36640cdc550af567555a6133a86938667c765b2`.
  Native-manifest SHA-256:
  `322ca80b8674b4f7c95effcc55880122d6b5999c7f2a04beb67add449137ae95`.
  This closes those technical notice gaps for this artifact, not blanket legal
  certification or permission to distribute it publicly.
- The earlier Computer Use attempt reported a locked Mac. That was a temporary
  verification blocker, not a current claim: the subsequent accessible-session
  checks below supersede it. No host-security bypass was used.

### Packaged UI follow-up after access was restored

Computer Use opened the exact `d10b7427-486d-45b1-8a03-41ade013c40f` package,
then the corrected `a2bed12a-fe25-4d55-b8c1-ca3dbc6f6794` package on the existing
local synthetic Northstar profile. A private stopped-profile backup was retained
before the upgrade at `/private/tmp/orchestra-ui-upgrade-backup-SsqX3Y/profile`.

- The existing short saved report displayed one title, preserved its complete
  executive summary and source links, and was discoverable in Memory.
- One new real-OpenAI research run used only the two selected uploaded documents,
  with public web disabled. The app reported nine seconds and two original
  sources, not inflated chunk counts. The CSV fields, empty-project behaviour
  and authorisation requirements matched the opened PRD. These are one-run
  observations, not latency percentiles or semantic certification.
- Both PDF and Markdown were downloaded through native save dialogs. The actual
  two-page PDF was rendered and inspected: no clipping or missing sections was
  observed; citations and source paths remained present. Markdown retained the
  complete heading and report. Files remain in Downloads as
  `Orchestra-Packaged-UI-Research-2026-09-20.pdf` and `.md`, with SHA-256
  `27942d846bfd6a89e1bb7875ab958be895252adfda1d01aa57dd10ac7463f013`
  and `781f58f9fe46675525da8b3ccdd4611f6b786c374ff8226500717b7631e8034f`.
- The longer research focus exposed an additional duplicate-title case: the
  backend caps metadata at 200 characters while Markdown retains the full title.
  A red-first regression reproduced it. The display now promotes the full title
  only for an exact generated-research truncation match. Unrelated headings,
  shorter matching prefixes, manual notes and stored/exported Markdown remain
  unchanged. Four new cases bring the focused suite to 12 and full frontend
  suite to 284 passing tests. Typecheck/build, import provenance and inventory
  checks passed. Existing visual classes and network request behaviour are unchanged.
- In the corrected package, the same persisted long report displayed its full
  title exactly once. It survived normal quit/reopen and appeared once in Memory
  under stable ID `eaa6c8bb-b25f-4b5d-b97b-df050a4da11e`. Saved research did not
  inflate the original-document count, which remained two.
- The three existing chats, original cited transcript, stable selected chat URL
  and unsent draft survived navigation and both package launches. No draft was
  submitted or overwritten. Returning startup showed the runtime-loading state
  and then Memory; no first-run privacy page or error overlay was observed.
- Exact rebuilt-artifact notices have zero integrity errors or notice gaps:
  `/tmp/orchestra-ui-final-artifact-notices.json`. The unchanged app archive and
  native-manifest hashes remain those listed above; the changed frontend outputs
  were independently rehashed by that artifact check. No new backend or provider
  code was introduced by this UI-only correction.

Screenshots and accessibility states were inspected through Computer Use. This
was not a renderer-console audit or a repeatable rendered-startup benchmark.
The original profile still shows a partially processed PRD and a revoked Slack
connection; no reconnection, reindex or external-provider qualification is claimed.
The generated report also uses "approved scope" wording based on document text,
despite that source not itself being accepted Product Brain truth. No approval
was created: the save confirmation correctly labels it generated evidence. This
semantic wording concern joins the existing AI-quality follow-up above rather
than being hidden by successful display/download tests.

The earlier failed artifact with pre-final-Vite chunk hashes and its incomplete
staging directory were disposable outputs created by this run; they were removed
after the corrected package passed, recovering about 1 GB. Their failure reports
remain. No user profile, source, earlier user package or production data was removed.

The repository remains private. Public release requires resolved redistribution
obligations and the remaining independent/new-account qualification. Windows,
signing/notarisation, two-computer testing and automatic updates stay deferred,
not passed. Local tests and a successful OpenAI sample cannot establish universal
accuracy, zero hallucinations or the absence of every possible bug.
