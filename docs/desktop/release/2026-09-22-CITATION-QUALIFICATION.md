# Citation and source-build qualification

Private Apple Silicon desktop candidate, 22 September 2026. This is bounded
qualification evidence, not public-release approval or a zero-defect claim.

## What changed

- Preserve original E1–E10 evidence identity through generation, response
  projection, streaming, persistence and frontend rendering. Explicitly cited
  sources no longer disappear behind the old six-card display limit.
- Link only an unambiguous citation identity to a trusted source target. Legacy,
  unknown, duplicate or unsafe identities remain plain text. Code and existing
  links are not rewritten.
- Package Orchestra's Apache licence separately from Electron's licence and
  third-party notices, in both internal package locations.
- Correct fresh-source build order and document subprocess-only native SDK
  selection. Stabilise the Memory polling test without removing its visibility
  assertion or changing application behaviour.

## Verification

| Check | Observed result |
| --- | --- |
| Complete backend desktop suite | 2,061 passed; 13 explicitly skipped integration tests |
| Complete frontend suite | 291 passed across 50 files |
| Licence and quality-harness tests | 9 passed |
| Import provenance | 732 unchanged files; 83 reviewed changes |
| Backend compilation | Passed |
| Tracked frontend compilation and production build | Passed; the ordinary workspace typecheck is separately obstructed by a user-owned untracked duplicate test, which was preserved |
| Independent focused code review | No actionable finding in the reviewed citation projection/rendering diff |

The complete suites ran against unchanged working-tree fingerprints based on
`fcd84f537e79a27202646a865bbed1647391f443`. These results cover the changes described
here; later product changes require their own affected checks.

## Packaged application journey

Using the actual packaged interface and the fictional Northstar project:

1. Ask for the CSV columns and PDF-export approval status across two documents.
2. Receive a generated answer naming `item_id`, `title`, `owner` and `status`.
3. Verify that the answer distinguishes the PDF request from recorded approval.
4. Follow E1 to the launch PRD and E2 to the change request.
5. Return to the chat, reload, and verify the same answer and citation mappings.

This journey passed. The original UI styling was preserved. Screen evidence
supports the rendered-state observations; no blanket clean-console claim is made.

## Real-provider large-corpus sample

Eight bounded OpenAI requests against 1,000 varied synthetic documents and 10,000
lexical chunks passed the harness assertions: ancient/middle/distributed facts,
recent controls, multi-document recall, current revisions, topical precision and
foreign-fact abstention. Every displayed evidence marker had an explicit unique
identity; source targets, HTTP tenant denial and restart persistence were checked.

Observed first-text times ranged from 0.78 to 1.60 seconds; completion ranged from
1.36 to 3.15 seconds, using `gpt-5.4-mini`. These are eight individual samples,
not p95 measurements or a general accuracy/latency guarantee. The corpus was
seeded lexically, so this does not certify bulk ingestion, vector indexing or
large-workspace rendered performance. The earlier failing report was retained;
it exposed the now-fixed citation projection defect and an abstention assertion
that did not recognise “None”.

## Fresh build and boundaries

A clean source archive built dependencies, backend, frontend, extension and the
pinned native runtime. The internal package's 1,701 native hashes and 40 required
PostgreSQL files were checked. Both first-party licence copies matched the
approved source while Electron's own notice remained intact.

The fresh package was built from the earlier source snapshot plus the packaging
repair; it is not represented as the later citation candidate. A subsequent
rebuilt citation candidate was used for the UI journey above. All work used one
Mac. No second-machine qualification, public publication, signing, automatic
update certification, paid GitHub Actions or changes to `orchestrav2` occurred.
