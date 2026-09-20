# Desktop BYOK and retrieval audit — 20 September 2026

Scope: private `KarthikRamesh9149/Orchestra`, based on
`db915ae5c26c651276e91d12229977909880e71b`. The production `orchestrav2`
repository, deployments and data are outside this change. Repository publication
is not authorised. This report distinguishes completed checks from open gates;
it is not a claim that every line or possible workflow is defect-free.

## User-facing contract

Local Settings provides **Select provider → Add API key → choose model → Test
connection → Save and restart**. OpenAI Responses, Anthropic Messages, Google
Gemini and explicitly compatible Chat Completions endpoints have adapters.
Providers with other authentication or wire protocols need dedicated adapters.
The supported setup and limitations are in [the user guide](release/USER-GUIDE.md#add-an-api-key).

Secrets remain outside the renderer. Imports are temporary, destination-bound
native drafts; the saved configuration must match a successful, unexpired test.
Custom endpoints require public HTTPS, request-time DNS checks, pinned resolution,
TLS validation, bounded output and no redirects. Generation and embeddings have
separate capabilities and may have separate keys. Original vector identities
cannot be silently relabelled; semantic unavailability is displayed explicitly.
Shared workspaces retain server-owned AI configuration and never inherit local keys.

## Defects addressed

- Desktop generation readiness previously depended on the OpenAI environment key,
  which would misclassify other configured providers.
- ZIP metadata could understate actual decompressed XLSX/DOCX output. Actual
  inflation is now bounded before handing data to the document libraries.
- Sectionless document citations could lose document/version identity.
- Research bibliographies could duplicate one source or discard citation aliases;
  grouping now uses stable identity and retains every reference.
- Multi-document questions could be crowded out by the first document's chunks.
  Coverage is balanced within explicit retrieval limits.
- Socrates readiness fallback could sound positive without supporting evidence;
  unsupported readiness remains unknown.
- Three-digit citation markers could evade validation; out-of-range references
  are now rejected.
- Research summaries and generated market/expansion claims require their own
  citations, not a different cited paragraph elsewhere in the report.
- OpenAI stream deltas must agree with the authoritative completed answer;
  incomplete or contradictory terminal output is rejected.
- Socrates action payloads now use their existing typed schemas on the provider
  wire, followed by original product validation. Optional-value normalisation
  does not remove confirmation, secret or cross-field checks.
- Anthropic structured results use one fixed, validated result-tool channel,
  avoiding strict-grammar union limits. This does not execute tools or fall back
  to unvalidated prose. Unsupported model capabilities fail the connection test.

Existing saved reports are not rewritten. New-generation fixes do not retroactively
certify historical answers. Citation syntax and source identity checks alone do
not prove that every claim is entailed by its source.

## Verification

The scoped candidate checks below are complete. No incomplete runtime or provider
check is counted as passed. Deterministic tests, native-engine IPC benchmarks and
rendered packaged-app checks are separate evidence classes.

- Desktop backend suite after the research correction: 1,958 passed, 13 explicitly skipped.
- Backend incremental compilation, native typecheck/build, frontend production
  build and VS Code build passed.
- Four dependency-tree audits reported no known vulnerabilities; local secret
  scan and production-mock guard passed. These are bounded checks, not proof of
  absence of unknown vulnerabilities.
- Import provenance and action-inventory checks passed.

The initial parallel frontend run hit five timing failures; rerunning all 49
files serially passed all 246 tests without weakening timeouts. The subsequent
provider Settings changes passed 27 affected frontend tests and 19 native tests.

The offline native run parsed and chunked four synthetic documents, excluded an
archived document, and preserved state across two restarts with zero provider
requests. That run intentionally did not qualify embeddings or generated answers.

The first real OpenAI run used four embedding and six generation requests.
Its original report remains failed: the harness compared JSON object key order
for persistence and expected the whole-library count on named-document queries.
Direct read-only checks of the stopped synthetic database confirmed the six
stored answers, citations and user questions were unchanged. The harness now
checks structural equality and explicit scope, with regressions for changed
values, reordered arrays and inflated counts. A separate rerun is required;
the original report is not rewritten into a pass.

The corrected native run passed all six questions with real OpenAI
`gpt-5.4-mini` and no degraded responses. Four synthetic documents were actually
embedded; archived evidence was excluded; complete answers and ordered citation
arrays survived restart. It used 10 requests (4 embeddings, 6 answers), for 20
across the two real runs. Twelve harness regression tests passed.

| Native measurement | Six-question observed range |
| --- | --- |
| First answer text | 690–2,397 ms |
| Completed response including persistence | 1,414–3,492 ms |
| Backend retrieval | 4–520 ms |

These are individual samples on a four-document synthetic corpus, not p95,
large-workspace, browser-input or public-release benchmarks. Independent answer
inspection found the requested facts correct and the tested malicious source
instructions ignored. Unnecessary timestamp caveats and repeated source-heading
labels remain presentation-quality observations. These samples do not establish
universal factual accuracy or zero hallucinations.

Private local evidence directories (not committed customer data):
`/private/tmp/orchestra-retrieval-chain-uv633C` (offline),
`/private/tmp/orchestra-retrieval-chain-2t0ffo` (original run plus oracle diagnosis),
and `/private/tmp/orchestra-retrieval-chain-Wk1S0q` (corrected run and substantive
review). Native binary-overlay tests do not certify the packaged application.

One final, harder run removed the attack fixture's warning labels and used
spoofed `SYSTEM UPDATE` / `Assistant:` instructions. All six questions passed,
including persistence; all four documents were embedded. It used ten requests,
bringing the three real runs to 30, then provider harness calls stopped. Evidence:
`/private/tmp/orchestra-retrieval-chain-ihIfN4` (`report.json` and
`substantive-review.md`). First text was 654–1,766 ms, completion 1,304–2,130 ms,
retrieval 3–24 ms. Those are also six small-corpus samples, not p95.

The `promptInjectionHandled` response flag describes a narrow regex match, not
an assurance that every attack has been detected. The stronger attack did not
match that regex, but did not change the correct answer; the unconditional
source-instruction boundary remained in the model prompt. Thirteen harness
guardrail tests passed, including a check against coaching text in the fixture.

Packaged verification exposed 1,500 missing PostgreSQL distribution files in the
pre-existing local native build cache. The candidate did not start its engine.
Each missing file was restored into this checkout from the complete prior package
with matching manifest SHA-256 and PostgreSQL 17.11/pgvector 0.8.6 identity.
No existing file was overwritten and the old cache/package was unchanged.

Assembly now checks 40 critical distribution files, bootstrap/extension versions,
licences and unsafe links before modification and after staging. Four new
distribution regressions and the two related clean-build/notice tests passed.
The repaired exact package (`f457f06f-c0fd-48f5-a8f7-d118af777bcc`) passed fresh
empty-PATH provisioning/migrations, competing-engine and invalid-authority
rejection, save/reopen, SIGKILL and parent-IPC-loss recovery, and clean shutdown.
Synthetic smoke profile: `/private/tmp/orch-smoke.Wmf83s/native-smoke-1XnnfV`.

Rendered UI verification used that repaired package, not
the older app or a mock browser. The existing workspace and saved key loaded;
Settings accurately reported semantic availability; the real OpenAI structured
connection and embedding test passed. Other vendor accounts were not available
and are not live-certified.

In the rendered app, saving the tested configuration and restarting preserved
the key/model settings. The compatible-provider preview required its own endpoint
and key; no credential was sent to another vendor. A fresh Socrates conversation
correctly returned the PRD's four CSV fields, header-only empty export behaviour
and unapproved PDF scope. Opening its citation displayed the source document;
returning to chat preserved the answer, conversation URL and unsent draft.

That same package exposed a separate Deep Research regression. With only
**Uploaded docs** selected, the natural focus “Assess Northstar CSV export
requirements and the product decisions still needed before launch” produced
three derived sources, zero documents and an incorrect missing-specification
assessment. The report was closed without saving it to Memory. This failed
observation is retained; successful Socrates checks do not supersede it. The
corrected source selection required a fresh packaged repeat before closure.

The exact natural-question regression failed before correction. It now searches
current original document text using the existing lexical index and PostgreSQL
stemming, without requiring every question word or a complete document title.
Generated document provenance is excluded, independently validated semantic
matches remain eligible, and mixed-source requests reserve domain coverage.
Seven new regressions and 81 targeted tests passed. An independent read-only
review found no further actionable issue in those revised regions. The final
global suite and backend compilation passed after provenance was refreshed.

The rebuilt package `47cb37ec-a904-4817-8d21-e2af3b162525` passed that exact
same-question repeat with the saved desktop OpenAI configuration. It retrieved
both original Northstar documents, displayed **2 sources / 2 docs**, and completed
in **7 seconds** (the application's displayed duration, not a p95 benchmark).
The complete summary and findings correctly distinguished CSV scope, tenant and
empty-export criteria, and the pending PDF request requiring approval.

The report was saved as a generated research note, not accepted truth. Its
authoritative saved-entry page opened at context ID
`a1b9dfcb-0075-4b4a-a348-b45dbbfdb1f7`; its PRD link opened the original document.
Native PDF download succeeded. The two-page PDF contained the full summary,
findings, actions, both source names and citation markers. Local artifact:
`/Users/karthikramesh/Downloads/Orchestra-Research-Verification-2026-09-20.pdf`.
The existing chat URL, complete answer and unsent draft also survived the package
restart. Saved-note full-process-restart recovery was not separately repeated.

### Rendered QA scope

Environment: Mac ARM Electron package, `orchestra://app`, approximately
1158 × 768 captured window. Native CUA accessibility and screenshots were used;
no Playwright, browser fallback or injected page scripts.

| Check | Evidence |
| --- | --- |
| Correct application/route | Exact rebuilt package; chat, saved context and original PRD routes verified |
| Nonblank UI / framework overlay | Meaningful content; no visible framework error overlay in tested views |
| Screenshot | Research summary, counts and findings displayed without clipping in captured viewport |
| Interaction | Provider test/save/restart; cited chat and draft; research, save, source opening and PDF download |
| Console logs | Not exposed by native CUA; not claimed clean |

The test tool truncates long accessibility text; screenshot and PDF extraction
confirmed the actual summary was complete. Native save required a second attempt
after a UI-control mismatch; file existence and extracted PDF content, not the
initial click, establish download success. The minimize-while-running attempt
arrived after completion and is not counted as a concurrency check.

The saved-note page still repeats its title, and cold/warm launch latency was not
instrumented in this UI run. Those observations, large-corpus latency, more
real-provider/account combinations and broader failure distributions remain
quality work; this scoped result does not certify a universally instant product.

## Public-release boundaries

This work does not close public distribution. Seven documented third-party
attribution reviews remain open, along with exact-package notice aggregation and
independent public build/onboarding qualification. Provider adapters tested with
synthetic HTTP responses are not real-account certification for those vendors.
An OpenAI runtime sample does not certify Anthropic, Gemini or arbitrary endpoints.

Windows, signing/notarisation, two-computer qualification and automatic updates
remain deferred by the owner, not passed. Public repository/release approval is
still withheld. No paid GitHub Actions, infrastructure upgrade or production
deployment is part of this work.
