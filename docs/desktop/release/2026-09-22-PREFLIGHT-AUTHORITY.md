# Preflight authority correction

Scope: private Orchestra desktop repository only. No production repository,
hosted deployment, schema migration, provider configuration or UI styling change.

## Defect and correction

The packaged Northstar project contained uploaded requirements and generated
research but no recorded accepted change or decision. Generated graph/artifact
lifecycle status nevertheless populated Preflight's accepted-truth section and
Context Health's accepted-node count.

Preflight now obtains accepted truth from project-scoped accepted proposals and
decision records. Generated Product Brain, graph, Live Doc and coding material
remains contextual evidence. A whitelist of source type and evidence status
prevents generated candidates from silently restoring acceptance.

Previously saved unsafe packs require refresh before content retrieval or export,
including the shared MCP retrieval path. Archival remains available and returns
metadata only; it no longer leaks rejected legacy content through a mutation
response. Context Health separates recorded approval counts from source inventory
and does not claim measured evidence coverage from those counts.

## Verification

- Red regressions reproduced the false ready state, false Context Health approval
  count and legacy archive-content bypass.
- 76 targeted tests passed. Independent read-only review reproduced the archive
  issue, then confirmed metadata-only archival of both unsafe and safe packs and
  the unchanged refresh requirement for unsafe GETs. No remaining actionable
  findings were reported in that bounded review.
- Complete desktop backend suite: 2,073 passed, 13 integration tests skipped;
  backend typecheck passed. Source/test/schema fingerprint remained
  `91ce65cdf00dbdfcfc6c6283fb7167d8e21bc9239bc16b193e19902c26b7326d`
  throughout both checks.
- All 158 frontend files matched the prior 291-passing-test candidate. No frontend
  code changed in this correction; that evidence was reused, not rerun or relabelled.
- Backend compilation and final native runtime/package assembly passed. Local
  security scan and reviewed import hashes passed: 726 unchanged imported files,
  89 explicitly reviewed adjustments.
- Structural inventory was regenerated and checked from tracked frontend files:
  47 source files, 393 controls, 18 feature families and 1,339 dependency entries.
  The change corrects citation-related line references; it does not certify those
  controls. The ordinary working-directory inventory still encounters the two
  preserved, unrelated untracked Settings copies.

## Packaged observations

In the rebuilt native app, the same CSV implementation task produced a blocked
pack with ten evidence records and zero accepted-truth items. The generated
Markdown retained source context and explicitly said no accepted current truth
was found. The exact project/pack ID and MCP handoff controls remained available.

In the final rebuilt package, Context Health displayed zero accepted decisions,
zero accepted changes, two source documents and ten active graph nodes. Its
state was Attention and its copy explicitly separated source inventory from
approval and unverified coverage. This replaced the incorrect nine-accepted-node
claim observed before the correction.

These checks close the reproduced authority defects. They do not certify all
Preflight relevance, every agent workflow, the whole product or public release.
