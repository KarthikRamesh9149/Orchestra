# Notice closure: candidate remediation and historical evidence

Checked 20 September 2026 in the private desktop audit checkout.

Seven of the twelve original notice reviews have supporting resolution evidence.
The other five retain unresolved exact-version notices, but the revised candidate
removes their redistribution paths: PDFKit is replaced with pinned pdf-lib standard
fonts, and development-only Stackback is excluded by an explicit runtime graph.
The source graph, staged tests and exact rebuilt artifact now pass the relevant
technical gates: fresh packaged-runtime migration/restart/crash recovery, 373
notice files and zero missing locations or integrity mismatches. See
[the readiness follow-up](READINESS-FOLLOWUP-2026-09-20.md) for the exact artifact
identity and remaining UI/semantic qualification. No historical artifact is
changed or retroactively declared licensed. This is not public-release approval.

## Historical dependency paths before the authorised replacement

| Package requiring clarification | Installed path | Why omission is not a fix |
| --- | --- | --- |
| @swc/helpers 0.3.17 | pdfkit → fontkit | Report generation uses PDFKit |
| brotli 1.3.3 | pdfkit → fontkit | Font handling dependency, including generated encoder code |
| dfa 1.2.0 | pdfkit → fontkit | Font handling dependency |
| fontkit 1.9.0 | pdfkit | Used transitively by report generation |
| stackback 0.0.2 | development test tooling | Absent from `npm ls --omit=dev`, but the current native preparation copies all root node_modules |

At that checkpoint the package graph was checked with `npm ls --omit=dev --all`.
PDFKit was imported by `src/modules/deep-research/report-render.ts`. The native host
executes `backend/node_modules/prisma/build/index.js` for migrations, while Prisma
is currently listed in devDependencies. Blind `npm prune --omit=dev` is unsafe.

## External evidence

Existing public requests were rechecked without posting duplicate requests:

- [fontkit #255](https://github.com/foliojs/fontkit/issues/255): no maintainer resolution for the installed version.
- [dfa #3](https://github.com/foliojs/dfa/issues/3): the visible exact-version request remains unanswered by a maintainer.
- [Brotli #57](https://github.com/foliojs/brotli.js/issues/57): no comments resolving the generated-code provenance.
- [dingbat-to-unicode #1](https://github.com/mwilliamson/dingbat-to-unicode/issues/1#issuecomment-5740760399): now resolved by the owner's express previous-version clarification; exact notice recovered.
- [tr46 author commit](https://github.com/jsdom/tr46/commit/3a6f29721e7063b9ffd421e461a54beae6170001): notice-only child of the published 0.0.3 revision, with implementation identity verified; exact notice and separate Unicode-data attribution recovered.

The remaining package/source findings are in
[THIRD-PARTY-REVIEW.md](THIRD-PARTY-REVIEW.md) and the
[machine-readable register](third-party/recovered-notices.json).

## Genuine closure paths

1. Obtain an applicable upstream copyright/license notice or owner clarification
   for the installed version and bundled components, then preserve it with source
   provenance and regression checks.
2. Independently qualify dependency replacements with complete notices. Preserve
   document parsing, PDF reports, AI requests and error behavior; do not substitute
   a generic license label or silently drop a capability.
3. For development-only installer contents, first implement and qualify an explicit
   runtime dependency set, retaining migrations, generated Prisma client and native
   modules. Rebuild and test a fresh install/upgrade before removing stackback from
   the bundled-runtime blocker list. This does not retroactively license historical
   artifacts.

## Assessed alternatives before selecting the candidate

| Remaining packages | Smallest credible path | Evidence and regression boundary |
| --- | --- | --- |
| @swc/helpers 0.3.17 | Upgrade owning PDFKit/fontkit graph to a supported version using helpers 0.5.x, or replace the PDF renderer | [Latest PDFKit 0.20.2](https://github.com/foliojs/pdfkit/blob/8d72a71c3e2b03f3253c221065e9efcc69ca5b7d/package.json) uses fontkit 2.0.4, which uses helpers ^0.5.12 with an Apache notice. Does not clear fontkit/brotli/dfa; PDF wrapping, font metrics and export tests still required. |
| fontkit 1.9.0, brotli 1.3.3, dfa 1.2.0 | Replace the single PDFKit report adapter with a separately qualified renderer, or obtain upstream notices | Latest fontkit 2.0.4 still has no implementation notice and depends on the same brotli/dfa lines; their latest npm releases are the blocked versions. A routine PDFKit upgrade cannot close these three. |
| stackback 0.0.2 | Stage an explicit production runtime graph plus required Prisma migration CLI/client/engine instead of copying every development dependency | Latest Vitest 5.0.1 still depends on why-is-node-running ^2.3.0. Version 3.2.2 of that diagnostic tool has no stackback but changes to ESM/Node >=20.11, outside Vitest's supported major range. Do not silently force the override. Validate fresh install, migrations, native modules and upgrade/restart after runtime staging. |

The candidate renderer is [pdf-lib 1.17.1](https://github.com/Hopding/pdf-lib/tree/4beebbef7a261ed0be089bb1d63a5b6e28cc488a),
whose standard-font path does not require its optional fontkit adapter. The
authorised replacement changes the sole report adapter, formerly using PDFKit in
`src/modules/deep-research/report-render.ts`. Qualification must preserve pagination, wrapping, all report sections, source
references, long text, Buffer output, Unicode/error behavior and visual quality.
The exact transitive notice packet and generated font-data provenance are now
recorded in `third-party/pdf-notices.json` and `pdf-standard-fonts-transform.json`.
Dropping PDF export
or embedding custom fonts through another unreviewed fontkit fork is not closure.

The final installed/lock plan contains 343 selected runtime packages, 109 excluded
lock entries and none of the five historical blocker packages. It explicitly
retains Prisma 6.6.0 tooling/client/native engines and validates staged resolution.
The separate notice normalizer modifies only 28 pinned staged font objects and
omits six exact unused duplicate browser bundles; original source files remain
unchanged. Ten supplemental PDF component notices and unchanged wrapper licences
are retained. See [the implementation evidence](THIRD-PARTY-REVIEW.md).

Build-only notice sidecars and an exact-artifact aggregate are implemented. The
checker distinguishes historical unresolved packages absent from the new artifact
from unresolved packages still bundled. It verifies the explicit font transform
and required component notices rather than bypassing hash checks. The repository
remains private; public distribution, signing and clean-machine qualification
must not be marked passed from this evidence alone.
