# Step 1: isolated source and desktop contract

## Scope

Private `KarthikRamesh9149/Orchestra`, branch `codex/desktop-step-1`. Snapshot source: `orchestrav2/mvp-beta-beta` at `8561d41980e97924db33e0c8f748b7cf576aac83`, reconfirmed before import. No source history, production changes, deployment, paid infrastructure or GitHub Actions.

Step 2 has not started. This is not a packaged desktop product or release certification.

## Imported and reviewed

- 815 source files selected; 211 excluded source paths individually recorded in `import-manifest.json` with SHA-256 provenance.
- Exclusions cover hosted env/deployment configuration, historical operational reports/internal design documents, generated eval outputs, prebuilt VSIX and binary snapshots/assets. Recreate synthetic visual snapshots or clear rights before packaging assets.
- Application service/UI and migration source is preserved byte-for-byte. Four narrow import adjustments are hash-recorded separately: two smoke URL defaults now use localhost, explicit extension ambient types, and a compatible extension packaging security patch.
- Existing production origin references in the citation-origin parser and VS Code configuration remain **inert source compatibility defaults**, not tested local-mode contracts. Steps 3/5 must replace them with explicit workspace/server configuration before desktop execution or client pairing. No extension was installed or connected here.
- Static secret scanning found no non-allowlisted credential matches. Test/fixture matches are synthetic placeholders or redaction patterns. This is not proof against all possible secret encodings; public distribution still requires a final scan of source/history/bundles.
- Golden eval fixtures are structurally synthetic examples (project_alpha and named sample apps), not imported production database exports. No live database/customer export was accessed.
- No source root LICENSE or NOTICE exists. Proposed Apache-2.0 remains unapplied; source access does not establish ownership. Dependency/license metadata inventory contains 1,316 lockfile entries before the compatible security patch; regenerate alongside locks.

## Inventory and architecture

`feature-parity.json` enumerates 328 interactive JSX controls/bindings across 34 non-test frontend sources, plus 18 workflow families including native/backend-only work. Each row has a source location, local/shared treatment, owning step and acceptance test ID/requirement. It deliberately includes hidden/legacy components so they are not silently dropped. Structural enumeration is not proof that every component is reachable at runtime; packaged runtime journeys remain Steps 4–7 gates.

ADR-001 records the approved architecture and alternatives. CONTRACT.md freezes execution, parity and performance targets. THREAT-MODEL.md records data flows, trust boundaries, controls and required future tests. RELEASE-DEPENDENCIES.md names accountable roles and unconfirmed external prerequisites. These are honest design contracts, not claims that future controls are implemented.

## Verification

- Clean dependency installations performed for backend, frontend and VS Code from lockfiles, lifecycle scripts disabled.
- Prisma client generated; backend typecheck and emitted build passed.
- React production build passed; one existing mixed static/dynamic import warning remains for the settings module, assigned to Step 4 performance qualification.
- Frontend: 37 files, 191 tests passed. Existing MSW diagnostic warnings are not live product verification; tighten handlers during Step 4.
- Applicable desktop baseline: 1,348 tests passed, zero failures, including five new isolation/provenance/contract tests.
- Original upstream selection was run separately: 1,361 passed, 28 failed, two suites could not load their excluded release-matrix files. Fifteen hosted release/config/document suites remain in source and are explicitly outside the desktop-baseline gate; none is recorded as passed. Their later owners and replacement responsibilities are in upstream-checks.json.
- Initial sandbox-denied loopback/Prisma-cache failures were separated from code defects and rerun with scoped access.
- Static secret scan and production mock guard passed. Core application source remains unchanged.
- All three dependency audits report zero vulnerabilities after updating the VS Code packaging dependency `js-yaml` to the compatible patched version. The extension build then passed with explicitly scoped ambient types.
- Initial-import whitespace checking reports existing extra EOF blank lines in `prisma/migrations/0001_init/migration.sql` and `src/modules/project-ops/authz.ts`. Both remain byte-identical to the source; the scoped diff check excludes these two inherited whitespace-only notices, not functional failures.

The intentionally retained `npm test` upstream reference suite is not green without its original hosted-release documents. Use the documented desktop-baseline command for this repository's applicable Step 1 checks; do not represent it as the original full release suite.

## External gates and next step

License approval, independent Mac/Windows test owners, signing credentials, provider registrations, real external AI/client tests and public publication approval remain unconfirmed and explicitly recorded. They do not certify a desktop release and cannot be bypassed by these baseline results.

Next, only when authorized: Step 2, portable local engine with explicit runtime profiles, plain PostgreSQL/pgvector migration proof, durable database jobs, Redis-independent local operation and private storage/recovery.
