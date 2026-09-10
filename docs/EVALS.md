# Orchestra Evaluation Harness

## Part 4 AI Quality Gates

Part 4 upgrades the eval harness from a small regression suite into a release gate. The harness now uses strict Zod-validated case schemas, five golden synthetic customer-project fixtures, materialized committed case files, deterministic fixture hydration, richer scoring, category minimums, detailed reports, and CI enforcement.

The eval platform is intentionally offline and deterministic:

- no live provider OAuth
- no real customer data
- no runtime dependency on external LLM vendors for scoring
- no snapshot-only pass criteria

The authoritative commands remain:

```powershell
npm run eval:socrates
npm run eval:messages
npm run eval:github-integration
npm run eval:engineering-evidence
npm run eval:fde-readiness
npm run eval:all
```

All three commands write reports under `evals/outputs/` and exit non-zero when gate conditions fail.

## Scope

The eval harness measures two production AI systems:

1. `Socrates`
2. `communication/message intelligence`

It validates more than answer text. The gate scores:

- answer behavior and factual expectations
- citation correctness
- open-target correctness
- source precedence
- client-safe leakage
- low/no-evidence honesty
- token-budget behavior
- message false-positive resistance
- truth-gating and invalid-ref handling

Fireflies.ai coverage is part of the communication and Socrates eval surface. Meeting transcript cases validate false-positive resistance, explicit requirement-change language, explicit approval/decision language, blocker/risk/action-item classification, ambiguous discussion handling, invalid-ref suppression, duplicate/edited transcript behavior, timestamped segment citations, current-truth precedence over raw transcripts, provenance citation to the original meeting segment, and client-safe transcript leakage denial.

Part 10 adds MVP Socrates eval categories for generated PRD/SRS quality, manual context retrieval, image-caption retrieval, coding requirements extraction, Mermaid diagram safety, responsibility/task Q&A, Socrates action suggestion behavior, Fireflies transcript retrieval, MVP provider gating, and low-evidence honesty. These cases run in `npm run eval:socrates` and `npm run eval:all`; dry-run/mock smoke never replaces eval gates and cannot claim live AI launch proof.

Feature 13 Part 5 adds a production hardening release gate around the GitHub-powered FDE Readiness Dashboard. The Feature 13 eval/smoke set must cover GitHub evidence normalization, Mock vs Real accuracy, Integration Seam accuracy, Conflict Radar, Safe-to-Touch scoring, Duplicate Work, Live Working Map evidence, Branch & Deploy Truth honesty, TODO/FIXME aggregation, dashboard prioritization, Context Snapshot quality, Socrates readiness Q&A, Product Brain Agent Files readiness projection honesty, and MVP disabled-provider leakage. Rationale Trace evals are mandatory: weak semantic distractors must be labeled low confidence or abstained, not confirmed.

Run the static release gate after evals:

```powershell
npm run feature13:release-gate:dry-run
```

The release gate is not a replacement for evals. It verifies that evals/smoke/docs are wired, that Feature 13 migrations are additive, that the dashboard route remains readiness-first, and that read-only/truth-model guardrails remain present. Non-dry-run release still requires live Supabase schema verification and real HTTP smoke before launch proof can be claimed.

The MVP Socrates eval release floor is at least 85 synthetic cases, enforced by `SOCRATES_TARGETS` and `tests/mvp-eval-coverage.test.ts`. Current materialized MVP Socrates cases: 85. Release floor: 85.

| Category | Minimum | What it protects |
| --- | ---: | --- |
| `mvp_generated_prd_srs_quality` | 8 | Basic MVP-scoped PRD/SRS answers, evidence citations, no invented integrations or deployment specifics. |
| `mvp_manual_context_retrieval` | 8 | Manual notes/transcripts/chat exports, deleted and wrong-project exclusion, project-context open targets. |
| `mvp_image_caption_retrieval` | 8 | Caption-only image/chart/screenshot retrieval, no hallucinated OCR, no storage metadata leakage. |
| `mvp_coding_requirements_extraction` | 10 | Modules, dependencies, build order, unknowns, flowchart evidence, no invented stack/vendor. |
| `mvp_mermaid_diagram_safety` | 10 | Safe diagram retrieval/open targets and rejection of script, HTML, JavaScript URL, and init-directive claims. |
| `mvp_responsibility_task_qa` | 8 | Owner/task Q&A, blocked/done state, assignee-name and member-linked responsibilities, unknown-owner honesty. |
| `mvp_socrates_action_suggestions` | 10 | Suggested action types, confirmation requirement, no auto-apply, invalid/ambiguous action suppression. |
| `mvp_fireflies_transcript_retrieval` | 8 | Fireflies transcript provenance, explicit approval vs chatter, client-safe transcript leakage denial. |
| `mvp_provider_gating` | 5 | Manual import, Fireflies, Slack, ClickUp, Granola, and Microsoft Teams enabled in MVP; Gmail, Outlook, and WhatsApp Business direct providers not suggested by default. |
| `mvp_low_evidence_honesty` | 10 | Honest low-evidence answers for missing PRD/context/owners/APIs/vendors/image/Fireflies/finance evidence. |

Run one MVP category with:

```powershell
npm run eval:socrates -- --category=mvp_low_evidence_honesty
```

MVP eval cases are deterministic synthetic data, not customer data. A failing MVP eval, duplicate case id, missing runner wiring, total MVP case count below 85, or category below its minimum blocks MVP backend release.

MVP Part 3 generated PRD/SRS coverage is tested in backend unit/route suites and the MVP eval category `mvp_generated_prd_srs_quality`. Generated markdown is persisted as a normal document version, then becomes Socrates/Product Brain evidence through the existing parse/chunk/embed and rebuild paths.

MVP Part 4/5 manual and image context coverage is tested in backend service/route/retrieval/validation suites and materialized MVP eval cases. Manual/image context retrieval uses `manual_context` intent and `project_context` citations/open targets where the retriever selects context evidence, including optional `attachmentId` for image evidence.

## Fixture model

Golden project fixtures live under `docs/fixtures/evals/golden_projects/`:

- `marketplace_mvp`
- `saas_admin_dashboard`
- `logistics_dispatch_app`
- `ai_chatbot_product`
- `fintech_onboarding_app`

Each fixture is synthetic and cross-linked. Every fixture directory includes `supporting_docs.json`, `communications.json`, accepted/rejected proposal files, decisions, Product Brain, Brain Graph, viewer sections, a dashboard snapshot, and materialized expected Socrates/message case files. The loader rejects incomplete fixture directories before eval execution.

The fixture world hydrates a deterministic Orchestra project with:

- organization and users
- memberships and actor roles
- documents, sections, chunks, and visibility
- accepted Product Brain and Brain Graph state
- dashboard snapshots
- connectors, threads, messages, and message chunks
- accepted and rejected proposals
- decision records

## Case schemas

Eval case files are schema-validated with Zod before execution. Unknown fields fail fast.

### Socrates case fields

- `id`
- `materialityKey`
- `title`
- `category`
- `projectFixtureId`
- `actorRole`
- `pageContext`
- `selectedRef`
- `viewerState`
- `query`
- `expectedBehavior`
- `expectedAnswerFacts`
- `forbiddenAnswerClaims`
- `expectedCitationTypes`
- `requiredCitationRefs`
- `forbiddenCitationTypes`
- `forbiddenCitationRefs`
- `expectedOpenTargetTypes`
- `requiredOpenTargets`
- `forbiddenOpenTargets`
- `expectedSourcePrecedence`
- `expectedConfidence`
- `lowEvidenceExpected`
- `clientSafeExpected`
- `tokenBudgetExpectation`
- `tags`
- `notes`

### Message-intelligence case fields

- `id`
- `materialityKey`
- `title`
- `category`
- `projectFixtureId`
- `provider`
- `threadId`
- `messageId`
- `inputMessageBody`
- `inputThreadMessages`
- `expectedInsightType`
- `expectedProposalCreation`
- `expectedDecisionCreation`
- `expectedAffectedDocumentSectionRefs`
- `expectedAffectedBrainNodeRefs`
- `forbiddenAffectedRefs`
- `expectedUncertainty`
- `expectedSupersessionBehavior`
- `expectedDuplicateBehavior`
- `expectedInvalidRefHandling`
- `expectedConfidenceRange`
- `tags`
- `notes`

Fireflies.ai cases use `provider: "fireflies_ai"` and include transcript-style speaker/timestamp context in message chunks. The expected behavior must treat Fireflies summaries and action items as evidence metadata only, not as accepted truth.

Granola eval coverage now includes provider foundation plus deterministic sync-path checks for folder listing, List Notes/Get Note with `include=transcript`, page-size capping, summary/transcript normalization, unavailable-note handling, credential redaction, and provider-neutral evidence output. Granola is meeting evidence and is not accepted Product Brain truth; Socrates/proposal behavior must keep Granola-derived claims pending/evidence-only until existing review gates accept a change.

Fireflies connector smoke is separate from evals:

```powershell
npm run smoke:connectors:fireflies:dry-run
npm run smoke:connectors:fireflies:mock
```

These commands are diagnostic provider checks. Live Fireflies provider proof requires `npm run smoke:connectors:fireflies:http` with real infrastructure and credentials.

## Coverage targets

### Socrates

Minimum category counts enforced by the gate:

- `current_truth`: 50
- `provenance`: 40
- `communication_origin`: 30
- `doc_viewer_selected_section`: 20
- `brain_graph_selected_node`: 20
- `dashboard_status`: 20
- `client_safe_leakage`: 20
- `bad_ambiguous_no_evidence`: 20

Current materialized Part 4 Socrates count: 220 cases across the target categories, plus legacy JSONL regressions for a total of 274 cases.

Legacy categories remain loaded when present:

- `citation_correctness`
- `role_safety`

### Message intelligence

Minimum category counts enforced by the gate:

- `false_positive`: 50
- `real_requirement_change`: 40
- `decision_approval`: 30
- `blocker_risk_action`: 30
- `ambiguous_chat`: 30
- `duplicate_supersession`: 20
- `invalid_ref`: 20

Current materialized Part 4 message-intelligence count: 220 cases across the target categories, plus legacy JSONL regressions for a total of 262 cases.

Legacy categories remain loaded when present:

- `classification`
- `false_positive_guard`
- `proposal_generation`
- `decision_candidate`

## Scoring

### Socrates scoring dimensions

Every Socrates case is scored across:

- `answer_correctness`
- `citation_correctness`
- `open_target_correctness`
- `source_precedence_correctness`
- `client_safety_correctness`
- `token_budget_behavior`
- `low_evidence_honesty`
- `debug_metadata_present`

Blocking failures include:

- missing required facts
- forbidden claims
- missing required citations or open targets
- forbidden citation or open-target types/refs
- wrong source precedence for current-truth, provenance, dashboard, or selected-object cases
- duplicate or missing `materialityKey` values in target-count cases
- client leakage
- client-safe Socrates dashboard snapshot/filter leakage
- low-evidence dishonesty
- budget violations beyond case thresholds

### Message-intelligence scoring dimensions

Every message-intelligence case is scored across:

- `insight_type_correctness`
- `proposal_creation_correctness`
- `decision_creation_correctness`
- `false_positive_resistance`
- `affected_ref_correctness`
- `invalid_ref_handling`
- `uncertainty_preservation`
- `duplicate_supersession_behavior`
- `truth_gating_correctness`

False positives, unsafe proposal creation, invalid affected refs, and truth-gating failures are blocking.

## Reports

Generated artifacts:

- `evals/outputs/socrates-report.json`
- `evals/outputs/socrates-report.md`
- `evals/outputs/message-intelligence-report.json`
- `evals/outputs/message-intelligence-report.md`
- `evals/outputs/eval-summary.json`
- `evals/outputs/eval-summary.md`

Reports are generated artifacts and are not committed. Keep `.gitkeep` only.

Per-case report fields include:

- pass/fail
- category
- fixture/project
- role or provider
- query or message input
- expected behavior summary
- observed answer or intelligence output
- citations and open targets
- dropped citations and dropped open targets
- token estimates
- latency
- retrieval domains
- final evidence count
- confidence and limitations
- failure reasons
- scorer dimension breakdown

Aggregate fields include:

- total/pass/fail counts
- pass rate
- category pass rates
- fixture pass rates
- average and p95 latency
- average estimated tokens
- budget-truncated count
- dropped citation count
- dropped open-target count
- client-safety failures
- false-positive failures
- invalid-ref failures
- top failure reasons

## CLI filters

The runners support targeted execution:

```powershell
npm run eval:socrates -- --category=current_truth
npm run eval:socrates -- --fixture=marketplace_mvp
npm run eval:socrates -- --case=p4_current_truth_001
npm run eval:messages -- --category=false_positive
npm run eval:all -- --json
```

Supported flags:

- `--category`
- `--fixture`
- `--case`
- `--json`
- `--ci`
- `--report-only`

## Gate behavior

The gate fails non-zero when:

- any mandatory case fails
- a required category is below minimum count
- report generation fails
- client-safety leakage is detected
- citation/open-target mandatory checks fail
- source precedence fails on a blocking case
- materialized Part 4 category counts are below minimum
- duplicate materiality keys are found
- false-positive or invalid-ref blocking cases fail

`npm run eval:all` fails if either the Socrates suite or the message-intelligence suite fails.

## CI and release usage

The CI workflow runs:

```powershell
npm ci
npm run prisma:generate
npx prisma validate
npm run typecheck
npm run build
npm audit --audit-level=moderate
npm test
npm run eval:all
npm run smoke:backend:dry-run
npm run smoke:backend:mock
npm run smoke:connectors:fireflies:dry-run
npm run smoke:connectors:fireflies:mock
npm run ops:readiness:dry-run
npm run ops:retention:dry-run
npm run ops:metrics:dry-run
npm run ops:db:static-audit
npm run ops:worker:dry-run
npm run ops:staging-seed:dry-run
npm run ops:release-rehearsal:dry-run
npm run ops:load:dry-run
npm run security:scan:local
git diff --check
```

The P2 ops checks validate ADRs, surface threat models, SLOs, load-test coverage, staging seed contracts, and release rehearsal docs without contacting live DB/API/provider services. They give eval results an operational release context but do not replace HTTP smoke or live load proof.

Recommended local release loop:

```powershell
npm run typecheck
npm run build
npm test
npm run eval:socrates
npm run eval:messages
npm run eval:all
```

If available in the environment, run smoke after evals:

```powershell
npm run smoke:backend:dry-run
npm run smoke:backend:mock
```

These two smoke commands are diagnostics only. Dry-run reports use `proofLevel=diagnostic`; mock reports use `proofLevel=mock`; both must have `launchLoopProven=false` and `canBeUsedForLaunchProof=false`. Backend launch-loop proof requires `npm run smoke:backend:http` against real API/DB/worker/storage/AI infrastructure and a `backend-launch-loop-http-report.*` artifact with `mode=http`, `status=passed`, non-zero executed HTTP requests, created IDs, Product Brain version increment, Socrates citations/open targets, dashboard proof, and client leak-denial proof.

## Debugging failures

When a case fails:

1. Open the JSON report to inspect scorer dimension failures.
2. Check the Markdown summary for category and fixture clustering.
3. Re-run the failing category, fixture, or case with CLI filters.
4. Use the retrieval/debug metadata in the report to verify source precedence, evidence count, and token-budget behavior.
5. Fix the product bug or the eval expectation if the expectation is stale and the implementation is correct.

Do not weaken deterministic safety or precedence cases to force the suite green.

## Part 6 Diagram Eval Coverage

Part 6 adds deterministic tests/evals for:

- `diagram_lookup` intent classification for diagram, Mermaid, flowchart, sequence, coding-flow, architecture-diagram, and module-dependency questions.
- `project_diagram` retrieval as internal visual artifact evidence.
- `project_diagram` citations and open targets, including embedded Live Doc section open targets.
- Deleted/wrong-project/client-safe exclusion through backend validation paths.
- Mermaid safety validation for empty, oversized, HTML/script, unsafe URL, init/config directive, and type/source mismatch cases.

Diagrams remain evidence/artifacts and are not accepted Product Brain truth unless a later reviewed path explicitly applies product changes.

## Part 7 Coding Requirements Eval Coverage

Part 7 adds deterministic tests/eval expectations for:

- `coding_requirements` intent classification for “what needs to be coded,” build-order, module dependency, implementation-flow, and main coding-flow questions.
- structured coding requirements payload validation, including modules, APIs/data models, dependencies, risks, assumptions, unknowns, build order, citations/openTargets, and evidence summary.
- no-hallucinated-plan behavior: low-evidence projects must include explicit unknowns/limitations and must not invent a tech stack.
- Mermaid flowchart validation for `flowchart TD|LR` and unsafe content rejection.
- `coding_requirements` retrieval, citation, and open-target validation.
- client-safe exclusion of internal coding requirements evidence.

These tests do not prove live model quality. They prove backend grounding, schema validation, persistence, and navigation safety.
# Part 5 AI Ops Report Fields

Socrates eval reports now gate on AI ops metadata in addition to answer/citation/open-target scoring. Each Socrates case records model tier, model name, model provider, estimated input/output tokens, estimated cost, cache status, degraded mode, degradation reason, schema repair attempts, low/no-evidence flags, no-citation flag, dropped validation counts, retrieval domains, final evidence count, budget truncation, and embedding/retrieval/rerank/generation/validation latency breakdowns. `eval:all` fails if these mandatory AI ops fields are absent.

Message-intelligence eval reports now gate on classifier model, model tier, token and cost estimates, latency, schema repair attempts, invalid affected-ref drop counts, truth-policy backend decisions, classifier fallback status, proposal/decision creation, and duplicate/supersession outcomes.

`npm run eval:all` remains blocking and fails if either suite is missing mandatory AI ops fields, citation/open-target checks regress, client-safe leakage is detected, false-positive cases create proposals, or invalid refs are accepted.

Message-intelligence fallbacks are intentionally conservative: fallback classifiers may identify an insight type, but they must not blindly auto-hydrate affected document sections or Product Brain nodes from resolver candidates. Fallback-nominated refs require lexical grounding against the message/thread text, ignore generic product/action terms such as client/user/settings/update/change, and without backend-validated affected refs the truth policy blocks proposal/decision creation and records the blocked reason in telemetry.

Slack and ClickUp communication-intelligence coverage is enforced by deterministic service tests and message-intelligence evals. Current runnable checks cover provider-aware timeline filters, connector/source-subtype/insight/proposal-status filters, deleted/unavailable provider evidence handling, safe provider open targets, Slack and ClickUp chunk provenance metadata, dashboard provider pressure, secret redaction, ClickUp task acceptance as reviewable proposal evidence, ClickUp status updates as evidence-only, and ClickUp blockers as insight-only delivery evidence. Required future eval cases are provider-aware Socrates answer correctness, Slack/ClickUp pending proposal not truth, Live Doc pending-vs-accepted provider markers, hidden-provider leakage denial, prompt-injection isolation, and duplicate proposal suppression.

## Part 8 Socrates Action Eval Coverage

Part 8 adds deterministic tests/eval expectations for:

- Socrates action suggestions that remain proposals until explicit Apply.
- no-auto-apply behavior for assignment, Live Doc embed, diagram, generated document, coding requirements, context, responsibility, and calendar actions.
- strict action payload validation, including unsafe Mermaid/HTML/script rejection and secret-like key rejection.
- project-scoped reference validation and client-safe exclusion of `suggested_actions`.
- action audit/status behavior: `proposed`, transient `applying`, `applied`, `rejected`, and `failed`.

These evals prove action safety and contract behavior. They do not prove that a live model will always infer the best action label or payload.

## Agent Context Pack Step 1

Feature 11 Step 1 adds project-scoped Agent Context Packs. Packs are derived, citation-backed, token-estimated artifacts available through `/v1/projects/:projectId/agent-context-packs`; they can be created, listed, viewed, refreshed, archived, and soft-deleted. Feature 11 Step 2 exports existing packs as copy-friendly Markdown, Claude, Codex, Cursor, AGENTS.md, JSON, GitHub issue brief, and GitHub PR brief content. Exports do not execute agents, create MCP tools, store agent runs, call GitHub APIs, mutate Product Brain or Live Doc truth, accept/reject proposals, or rewrite original PRD/SRS bytes. In `mvp-v0`, communication evidence defaults to manual import, Fireflies, Slack, ClickUp, Granola, and Microsoft Teams; disabled providers are filtered again at export time. See `docs/AGENT_CONTEXT_LAYER.md`.
## Feature 11 Step 4 MVP MCP Eval Notes

Step 4 MCP behavior is covered locally by deterministic service tests and MVP/backend smoke route-plan checks. The current Socrates eval harness does not execute MCP protocol calls directly, so MCP-specific semantic evals remain a follow-up for the eval harness owner. Required future cases: scoped project-context search, Product Brain truth precedence, pending changes not treated as truth, context pack citation/open-target preservation, agent run evidence labeling, prompt-injection evidence isolation, disabled-provider exclusion in MVP, and mutation-denial checks for Product Brain/Live Doc/proposals.
## Agent Quality and Drift Evals

`evals/socrates/agent_quality_drift.jsonl` checks that Socrates can retrieve Step 5 review evidence, cite `agent_quality_review`, preserve openTargets, report follow-up/test/docs gaps, and avoid claiming Product Brain truth changed.

## Communication-Led Live Doc Review Flow

Communication-derived product changes are reviewable Live Doc markers, not automatic truth. When an MVP-enabled communication path (`manual_import` or `fireflies_ai`) produces a strong requirement or decision change, the backend creates or updates a `spec_change_proposal` linked to the exact PRD/SRS-backed `document_section`, affected brain nodes, and source message/thread/transcript evidence. `GET /v1/projects/:projectId/live-doc/current` exposes pending internal markers on the mapped `doc:<documentSectionId>` Live Doc section without changing `originalText`, `currentText`, or `effectiveText`.

Managers, or active project members explicitly delegated truth-approval authority by a manager through `/v1/projects/:projectId/truth-approvers`, can accept or reject these review items. MVP equal project access still does not make every member an authority for Product Brain truth acceptance. Live Doc review routes delegate to the existing change proposal pipeline: `GET /v1/projects/:projectId/live-doc/review-items`, `GET /v1/projects/:projectId/live-doc/sections/:sectionKey/review-items`, `POST /v1/projects/:projectId/live-doc/review-items/:proposalId/accept`, and `POST /v1/projects/:projectId/live-doc/review-items/:proposalId/reject`.

Accepted proposals update Product Brain/current truth through the accepted-change pipeline and appear as accepted Live Doc overlay markers. Pending proposals remain internal review markers and rejected/superseded proposals do not affect current truth. The original uploaded/generated PRD/SRS bytes and parsed source text remain immutable provenance; Socrates must distinguish current-truth answers from provenance/origin answers and cite backend-provided proposals, document sections, messages, threads, and brain nodes. Slack, ClickUp, Granola, and Microsoft Teams are read-first MVP evidence providers; Gmail/Outlook/WhatsApp integrations remain hidden/disabled in MVP unless future flags explicitly enable them.

Feature 12 Step 1 adds `npm run eval:agent-files`, included in `npm run eval:all`. The deterministic MVP suite checks the exact seven-file default contract, template version, Product Brain/Live Doc/source-domain coverage, MVP provider gating, truth guardrails, no-repo-write guardrails, route registration, and secret-like content redaction. These evals are local deterministic checks; they do not prove deployed API, database, worker, GitHub, or HTTP launch readiness.

Feature 12 Step 1 adds `npm run eval:agent-files`, included in `npm run eval:all`. Step 2 extends it with deterministic MVP-safe checks for refresh/staleness/diff/download/manifest/latest/conflict/sync-run routes, generated/manual zone markers, no repo-write behavior, MCP read-only agent-file access, and server-side disabled-provider gating. These evals are local deterministic checks; they do not prove deployed API, database, worker, GitHub, or HTTP launch readiness.

Feature 12 Step 1 adds `npm run eval:agent-files`, included in `npm run eval:all`. Step 3 extends it with deterministic MVP-safe checks for refresh/staleness/diff/download/manifest/latest/conflict/sync-run routes, generated/manual zone markers, quality scoring, generated-file drift detection, release gates, GitHub PR readiness gating, Markdown-only sync, MCP quality/drift/readiness tools, dashboard/Socrates status integration, and server-side disabled-provider gating. These evals are local deterministic checks; they do not prove deployed API, database, worker, GitHub, or HTTP launch readiness.

Feature 13 Part 1 adds `npm run eval:github-integration`, included in `npm run eval:all`. The deterministic suite checks read-first truth boundaries, webhook normalization/provenance, explicit actor mapping, no write-action contract, no Product Brain/Live Doc/proposal mutation, MVP read-only behavior, and secret/token redaction. These evals are local deterministic checks; they do not prove live GitHub App installation, deployed webhooks, production database, worker, or HTTP launch readiness.

Feature 13 Part 2 adds `npm run eval:engineering-evidence`, included in `npm run eval:all`. The deterministic suite checks provider-neutral evidence schema/provenance, additive migration shape, GitHub/Agent Run/route/manual normalization, Mock vs Real/Integration Seam/Branch Deploy/TODO foundation views, no truth mutation, no GitHub writes, route contract coverage, secret redaction, safe content-scan defaults, and docs scope. These evals are source-level readiness checks and do not claim full FDE dashboard intelligence or HTTP launch proof.

Feature 13 Part 3 adds `npm run eval:fde-readiness`, included in `npm run eval:all`. The deterministic suite checks additive readiness models, Conflict Radar/Safe-to-Touch/Duplicate Work/Live Working Map/Rationale Trace/decision-link behavior, confidence honesty, no GitHub writes, no auto-merge, no Product Brain/Live Doc/proposal mutation, hidden-provider exclusion in MVP, route contract coverage, docs scope, and secret redaction. These evals are source-level readiness checks and do not claim final dashboard replacement, true IDE presence, deployed HTTP proof, or production migration proof.

Feature 13 Part 4 extends `npm run eval:fde-readiness` with source-level checks for the canonical readiness-first project dashboard, `dashboardKind=fde_readiness`, `readinessSummary` before `operationalSummary`, focused dashboard subroutes, Context Snapshot through Agent Context Packs, read-only MCP readiness tools, Product Brain Agent Files Engineering Readiness projection text, MVP provider gating, and no truth/GitHub/deploy mutation. These evals remain deterministic source checks; they do not prove frontend UI implementation, deployed HTTP launch readiness, production migration application, true IDE presence, or external agent execution.
# Beta Evals

The `mvp-beta-beta` branch adds beta eval expectations for:

- uploaded document retrieval relevance
- citation/openTarget correctness
- no-evidence fallback
- no communication evidence leakage
- no truth mutation from Socrates
- VS Code and web using the same project memory path

Existing eval scripts remain diagnostic unless run against deployed beta infrastructure with real storage, database, and AI configuration.
