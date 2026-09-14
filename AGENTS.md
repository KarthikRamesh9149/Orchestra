# Orchestra desktop work boundaries

- This private repository is `KarthikRamesh9149/Orchestra`. Never push, merge, deploy or change visibility of `orchestrav2` as part of desktop work.
- The owner requested one branch only on 15 September 2026: use `main` for this private repository. Historical step commits remain in its ancestry. This consolidation does not waive verification gates or authorize public release or production changes.
- Read docs/desktop/CONTRACT.md and the owning parity rows before changing functionality. Preserve UI styling and evidence/approval semantics.
- No paid GitHub Actions, purchases, infrastructure upgrades or public publication. No copied production credentials or data. Ask before modifying other applications' configuration.
- Model selection follows the current user choice. Astra stays responsible when selected; no automatic Sol/Terra/Luna handoffs. Independent review, when required, inherits the selected model unless explicitly overridden.
- Use targeted checks during development and the owning step's complete gate before declaring completion. Reuse still-valid evidence; do not rerun unrelated suites for every status update. Step 1 baseline checks: `node scripts/desktop/inventory.mjs --check`, `node scripts/desktop/verify-import.mjs --check`, `npx vitest run --config vitest.desktop.config.ts`, backend typecheck/build, frontend tests/build, extension build and dependency audits.
- `npm test` retains upstream hosted-document tests; docs/desktop/upstream-checks.json explains why these are not desktop gates. Do not label them passed. New desktop changes need real runtime evidence in their owning step.
- The import-hash gate deliberately freezes Step 1. Later authorized steps must add reviewed change provenance and update that gate explicitly; never silently remove it just to make a test green.
- The owner confirmed ownership of original code/assets and approved Apache-2.0 for first-party code. Third-party licenses remain separate. The owner explicitly requires the repository to stay private. Do not publish, claim release readiness, or distribute unsigned packages as public releases without the required approvals/gates.
