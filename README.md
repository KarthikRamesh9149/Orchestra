# Orchestra

One Source of Truth and Product Brain for high-speed teams.

Private desktop-development repository. **Not a public desktop release yet.** Steps 1–7 have recorded scoped internal Mac qualification, including real desktop AI/connectors and Codex/VS Code, shared-server checks and manual update/recovery. Windows, two-computer qualification, signing/notarization and automatic updates are deferred, not passed. Do not run it against existing production infrastructure.

Start with the [release status and download information](docs/desktop/release/README.md), [source-build recipe](docs/desktop/release/BUILD.md), and [privacy and support guide](docs/desktop/release/USER-GUIDE.md). Step 8 publication remains gated separately from internal qualification.

## Development baseline

Node.js 24 and npm are used for this baseline. Install dependencies with `npm ci --ignore-scripts`, then `npm run prisma:generate`. Build with `npm run build`; run the applicable baseline with `npx vitest run --config vitest.desktop.config.ts` and `npm --prefix apps/beta-web test`. These do not qualify packaged desktop operation.

`npm test` retains the unmodified upstream selection, including hosted-release evidence checks which fail without deliberately excluded production documents. [Their explicit scope and later owners](docs/desktop/upstream-checks.json) are recorded; they are not counted as passed by the desktop-baseline suite.

See [desktop contract](docs/desktop/CONTRACT.md), [architecture](docs/desktop/ADR-001.md), [threat model](docs/desktop/THREAT-MODEL.md), [feature inventory](docs/desktop/feature-parity.json), and [Step 1 evidence](docs/desktop/STEP-1.md).

For the portable engine, see [Step 2 setup and evidence](docs/desktop/STEP-2.md) and [its runtime decisions](docs/desktop/ADR-002.md). It uses local PostgreSQL, private files, durable jobs and offline evidence search without hosted signup or Redis. Real AI provider and public-distribution qualification are not claimed complete.

For the internal Mac shell and deferred release qualification, see [Step 3](docs/desktop/STEP-3.md) and [native runtime decisions](docs/desktop/ADR-003.md). This is not a public release.

For local onboarding, chat continuity, source ingestion, approval/Live Doc and native recovery evidence, see [Step 4 acceptance](docs/desktop/STEP-4-ACCEPTANCE.md). The packaged tests use synthetic local data; they do not certify real AI models, external providers or shared teams.

The source was imported as a snapshot, without upstream Git history. Its immutable revision and per-file hashes are recorded in [import manifest](docs/desktop/import-manifest.json). Excluded historical release evidence is not a claim that those upstream checks were unnecessary or passed here.

No GitHub Actions or deployment configuration is enabled. No production integration is configured. Desktop development cannot modify the existing managed product.

## Licensing

Apache-2.0 is **proposed, not granted or applied**. This repository remains private pending ownership and dependency-rights review. See [rights and external dependencies](docs/desktop/RELEASE-DEPENDENCIES.md). Do not publish or distribute builds based on the proposed license.
