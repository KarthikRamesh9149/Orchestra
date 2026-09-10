# Orchestra desktop work boundaries

- This private repository is `KarthikRamesh9149/Orchestra`. Never push, merge, deploy or change visibility of `orchestrav2` as part of desktop work.
- Execute only the explicitly authorized numbered step on `codex/desktop-step-N`. Stop after its report. Do not advance automatically.
- Read docs/desktop/CONTRACT.md and the owning parity rows before changing functionality. Preserve UI styling and evidence/approval semantics.
- No paid GitHub Actions, purchases, infrastructure upgrades or public publication. No copied production credentials or data. Ask before modifying other applications' configuration.
- Step 1 baseline checks: `node scripts/desktop/inventory.mjs --check`, `node scripts/desktop/verify-import.mjs --check`, `npx vitest run --config vitest.desktop.config.ts`, backend typecheck/build, frontend tests/build, extension build and dependency audits.
- `npm test` retains upstream hosted-document tests; docs/desktop/upstream-checks.json explains why these are not desktop gates. Do not label them passed. New desktop changes need real runtime evidence in their owning step.
- The import-hash gate deliberately freezes Step 1. Later authorized steps must add reviewed change provenance and update that gate explicitly; never silently remove it just to make a test green.
- Public licensing is unresolved. Do not apply Apache-2.0, claim release readiness, or distribute unsigned packages as public releases without the required approvals/gates.
