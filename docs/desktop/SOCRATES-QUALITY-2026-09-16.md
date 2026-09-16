# Socrates quality check — 16 September 2026

Scope: private desktop app, existing local Northstar document workspace. No
production change, public release, UI styling change or model upgrade.

## Corrected regression

Character-window excerpts could split a CSV field list. An initial real answer
invented `project` instead of `item_id`. A subsequent answer omitted the
empty-project acceptance criterion. PDF line wrapping and document-title/query
boilerplate affected sentence selection.

The excerpt builder now prefers intact, relevant sentences, handles hyphenated
query terms, excludes the explicitly selected document title from content
ranking, and accounts for omission markers in the character budget. The prompt
requires exact source lists instead of inferring missing members from a count.
The existing 800-character generation excerpt budget remains unchanged.

## Verification

- Full desktop suite: 1,659 passed, 13 skipped (184 files passed, 2 skipped).
- Socrates service suite: 88 passed, including wrapped-text/list regression.
- Typecheck, backend/frontend build, native assembly and Mac packaging passed.
- Import provenance check: 762 unchanged files, 53 reviewed changes.
- Actual PDF extraction retained all four CSV fields and all four acceptance
  criteria within 800 characters.

Packaged candidate: `5383f5b7-fc1c-4335-88d9-99928e5e7b3a`.
The app used the previously configured dedicated OpenAI provider, not an
evidence-only response. Three real UI questions were checked:

1. Exact CSV fields and criteria: `item_id`, `title`, `owner`, `status`;
   selected-project scope, all columns, unauthorized-project isolation and
   empty-project headers without invented rows were all present.
2. Confirmed launch date and approved budget: neither was invented; the answer
   stated the information was not recorded.
3. QA follow-up: retained the requirements and clearly separated additional
   suggested tests from explicit requirements.

The answer's source link opened the original document viewer at its cited
anchor. Existing chat history survived the package restart.

## Limits, not passes

This is a small real-model regression check, not proof of world-class or
best-in-market quality. No statistically meaningful latency measurements were
collected. It does not certify large/multiple-document recall, contradictory
sources, every provider, adversarial robustness, or unseen follow-up questions.
Responses still contain unnecessary source-availability wording. The source
document remains marked partially processed from its earlier ingestion.

Next qualification should use a fixed multi-document case set covering exact
facts, missing facts, conflicts, older evidence, prompt injection and follow-up
resolution; record first-text and completion latency separately. Keep live
model tests separate from deterministic tests and report failures explicitly.
The launch videos are not completed by this verification.
