# Notice closure: remaining external information

Checked 16 September 2026 after README/media commit `f829e8e`.

Five of the twelve original notice reviews have supporting resolution evidence.
Seven remain unresolved. This is an attribution review boundary, not proof that
these packages are malicious or that the application has seven runtime bugs.

## Verified dependency paths

| Package requiring clarification | Installed path | Why omission is not a fix |
| --- | --- | --- |
| @swc/helpers 0.3.17 | pdfkit → fontkit | Report generation uses PDFKit |
| brotli 1.3.3 | pdfkit → fontkit | Font handling dependency, including generated encoder code |
| dfa 1.2.0 | pdfkit → fontkit | Font handling dependency |
| fontkit 1.9.0 | pdfkit | Used transitively by report generation |
| dingbat-to-unicode 1.0.1 | mammoth | Document parsing dependency, including mapping data |
| tr46 0.0.3 | openai → node-fetch → whatwg-url | Installed SDK dependency; current native-fetch selection alone is not a qualified removal |
| stackback 0.0.2 | development test tooling | Absent from `npm ls --omit=dev`, but the current native preparation copies all root node_modules |

The package graph was checked with `npm ls --omit=dev --all`. PDFKit is imported
by `src/modules/deep-research/report-render.ts`. The packaging script also needs
careful separation of build dependencies from runtime tools: the native host
executes `backend/node_modules/prisma/build/index.js` for migrations, while Prisma
is currently listed in devDependencies. Blind `npm prune --omit=dev` is unsafe.

## External evidence

Existing public requests were rechecked without posting duplicate requests:

- [fontkit #255](https://github.com/foliojs/fontkit/issues/255): no maintainer resolution for the installed version.
- [dfa #3](https://github.com/foliojs/dfa/issues/3): the visible exact-version request remains unanswered by a maintainer.
- [Brotli #57](https://github.com/foliojs/brotli.js/issues/57): no comments resolving the generated-code provenance.
- [dingbat-to-unicode #1](https://github.com/mwilliamson/dingbat-to-unicode/issues/1): third-party requests and inferences, not an owner-confirmed notice.

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

No such replacement or packaging change is claimed implemented in this pass.
The repository remains private. Public distribution and full attribution closure
must not be marked passed while the required evidence is missing.
