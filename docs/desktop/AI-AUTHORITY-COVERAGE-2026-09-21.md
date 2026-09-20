# AI approval and answer-coverage correction

Scope: private `KarthikRamesh9149/Orchestra`, starting at
`b5e6769d2c2ff825900f82e80d4aceff87c4780e`. This addresses the approval/completeness
wording follow-up, not public-release certification. No hosted production,
repository visibility, UI styling, model subscription or infrastructure changes.

## Defects and changes

Deep Research discarded the retrieval cards' server-owned acceptance precedence
when building its model prompt. Chat retained `truthStatus`, but its previous
instructions still allowed unsupported source-exclusivity wording. Earlier real
answers called a document the "only other supplied document" despite a third
source, or used unqualified approved-scope language for ordinary source documents.

- Both paths now receive an explicit, per-reference grounding summary built from
  the evidence actually passed to the model. Ordinary document/web prose cannot
  populate the accepted-decision reference list.
- Research requires matching server-owned source type and acceptance precedence;
  tests cover accepted Product Brain, change proposals and decisions, as well as
  mismatched or unknown metadata. Chat uses its existing accepted truth status.
- Shared instructions distinguish a source's approval claim from a recorded
  decision. Missing approval evidence means unknown, not rejected. An accepted
  decision does not approve the whole release or unrelated requirements.
- Retrieved excerpts are explicitly non-exhaustive. Missing facts are described
  as unsupported by those excerpts, not nonexistent in the project.
- Research must cover each requested part or name its evidence gap. Unanswered
  parts belong in the executive summary rather than uncited findings that the
  existing citation validator would discard. Headings must respect attribution,
  too. No generated answer is rewritten to force a test pass.

No retrieval queries, authorization checks, evidence caps, persistence ordering,
or per-answer model-call counts changed. The extra input is bounded metadata and
instructions, not a second model assessment. Existing reports remain historical
records; this does not silently rewrite previously saved answers.

## Verification and intermediate failures

The original regression run failed five assertions before the correction. A
subsequent requested-part coverage assertion also failed before its correction.
The final full desktop backend suite passed **2,051 tests**, with 13 existing
skips; the separately invoked harness suite passed **16 tests**. Backend build,
reviewed import-hash gate, whitespace check and local static security scan passed.
After the final research instruction adjustment, all 23 affected prompt,
citation and provenance tests and the full 2,051-test suite were rerun. The same
final candidate received the real research and packaged-app checks below.

Three bounded native runs used the dedicated desktop OpenAI configuration and
`gpt-5.4-mini`, fresh synthetic documents, real ingestion, real generation and
offline restart verification. They made 20, 14 and 8 provider requests respectively
(42 total, including embeddings), not unlimited repeated evaluation:

- `/private/tmp/orchestra-retrieval-chain-WWCcAa/report.json`: 12 chat answers and
  two research reports. Mechanical checks passed, but reading the prose exposed
  an omitted authorisation question. That original green result is **not** used
  as proof that requested-part coverage was complete.
- `/private/tmp/orchestra-retrieval-chain-d8HckO/report.json`: six chat cases
  passed, including exact fields, missing facts, archived-source exclusion,
  injection resistance and multi-document attribution. Both research cases
  failed the strengthened gate. Those failures are retained. The research focus
  was then made unambiguous about CSV download access, separate from approval of
  the proposed PDF change.
- `/private/tmp/orchestra-retrieval-chain-OLKd4B/report.json`: research-only rerun
  on the final application source. Both reports answered all six requested parts,
  including that download access was not established by the synthetic excerpts.
  Both survived restart with exact saved result equality. One narrow regex
  initially flagged the explicitly attributed phrase "approved scope described
  in E1". The test now distinguishes that phrase from an unqualified approval;
  the raw report was not altered and no additional model call was made.
  Reassessment: `/tmp/orchestra-ai-authority-research-review.json`.

The final research report's SHA-256 is
`5e6a4030b1a0c91450408249f8c7a7c0239c1be3846f0735500c76da6bf7050a`.
Final source fingerprint:
`da542c071c771f0f91121c4f1ae8a02b05f8f21ce30f20981576accda4aef85b`.
Final compiled fingerprint:
`3667b8de623246603dcf476bed5edf1a4e8959afc03a1c884f8b004db6cfe554`.
The chat implementation and shared rules did not change between the six-case
chat run and the final research-only run. No unnecessary chat calls were repeated.

The regex checks are narrow regression signals, not a general factuality judge.
The actual answers were also read. In the last six chat samples, first text was
0.65–2.18 seconds and completion 1.60–3.21 seconds. The final two research samples
completed in 5.61 and 6.15 seconds. These are individual synthetic-fixture samples,
not p95, browser feedback timing, or a guarantee for every workspace/provider.

## Packaged app verification

The current Mac internal package is under
`.desktop/packages/9add225c-dad9-49a9-bc55-4e1e369f768a/`.
All 943 compiled backend files in it match the current build byte-for-byte.
The UI archive and native manifest retain the previous qualified hashes:

- App archive: `981eddf1a91251183a8599c1c36640cdc550af567555a6133a86938667c765b2`.
- Native manifest: `322ca80b8674b4f7c95effcc55880122d6b5999c7f2a04beb67add449137ae95`.

Native re-preparation stalled reading an unrelated duplicate dependency README.
That process was stopped before replacing the prior runtime. Its incomplete
staging directory was left recoverable. The previously qualified, unchanged
native/dependency/UI runtime was reused and only the generated backend output
was refreshed before packaging. The unrelated duplicate Settings source files
were preserved and are not part of this commit or the previously built UI.

Exact-artifact notice inspection reports zero integrity errors and zero missing
notice files. Its `complete` flag remains false for existing redistribution
review items: it is **not** a public-distribution approval.

Computer Use verified the actual rebuilt app, not a browser mock:

1. Normal startup and the existing unsent draft were preserved. The draft was
   neither submitted nor overwritten.
2. A separate real OpenAI chat attributed CSV scope to `Northstar-Launch-PRD`,
   said the PDF request does not establish recorded approval, and said launch
   date/budget are not established by the supplied excerpts. Both citations
   linked to the right named documents.
3. A real uploaded-documents-only Deep Research report covered CSV columns,
   header-only empty exports, cross-project access restrictions, PDF approval,
   launch date and budget. The UI reported seven seconds. Its actual summary,
   findings and actions were read, and the rendered report was inspected.
4. Add to Memory succeeded with the explicit generated-evidence/not-accepted-truth
   confirmation. Opening the saved report preserved the wording and source
   links; opening the PRD citation navigated to the correct document.

Verification chat: `f11948b8-e49b-484e-ab05-431d8793114b`.
Saved report: `51274f19-0951-47f7-9caa-c973302dbd43`.
These are synthetic records in the existing local qualification workspace, not
customer or production records. Earlier saved reports were not changed.

## What this closes

The reproduced approval/source-exclusivity wording gaps and the observed omitted
research question are corrected and verified in the bounded cases above. This
does not prove universal completeness, zero hallucinations, every provider,
all approvals, or public readiness. Existing release prerequisites and deferred
platform/signing/update checks are unchanged. `orchestrav2` and its live product
remain untouched.
