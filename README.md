# Orchestra

### One Source of Truth and Product Brain for high-speed teams.

Your requirements live in documents. Decisions happen in chat. Implementation happens in GitHub. Orchestra connects the evidence, the decisions and the context your team builds from.

**Know what changed. Decide what matters. Build from the same truth.**

[How it works](#from-scattered-context-to-a-shared-decision) · [Start locally](docs/desktop/release/BUILD.md) · [Privacy](docs/desktop/release/USER-GUIDE.md)

## Stop rebuilding the context before you can do the work

“Was that approved?” “Which document is current?” “Why did we change this?”

Bring selected files, conversations and engineering evidence into project memory. Ask Socrates a question, inspect the sources, and keep proposed changes separate from decisions a person has actually approved.

## From scattered context to a shared decision

1. **Bring in the evidence.** Select files, folders, repositories and supported connector resources. Keep their provenance attached.
2. **Ask a useful question.** Socrates answers from project context with citations you can inspect. Separate conversations and drafts persist.
3. **Review what changed.** Truth Inbox and Change Packets bring proposed changes, evidence and affected areas into one review workflow.
4. **Approve deliberately.** A generated suggestion is not accepted truth. Authorized human decisions shape the Product Brain and Live Doc.
5. **Give agents the right context.** Preflight prepares a scoped context pack. Codex or VS Code retrieves the exact pack through MCP; Postflight records implementation evidence against it.

| When you need to know… | Use Orchestra to… |
| --- | --- |
| What did we agree to build? | Find accepted requirements and supporting evidence. |
| Did this conversation change the scope? | Review a proposed change before treating it as a decision. |
| What could this decision affect? | Inspect linked product and engineering context. |
| What should I give my coding agent? | Prepare scoped context and unresolved questions in Preflight. |
| Was the approved change delivered? | Inspect delivery evidence and remaining gaps. |

Memory keeps the original evidence close to the answer. Timeline makes decisions easier to revisit. Delivery and Release Truth show implementation evidence and unresolved gaps; they do not certify that a release is safe. AI output remains generated context until the appropriate human review accepts a change.

## Your workspace, your choice

**Local:** application-managed PostgreSQL and files on your Mac, with no hosted signup. Read and search saved evidence without an AI key. Generation requires your configured external AI provider; fully offline model generation is not included.

**Shared:** connect to an explicit, trusted server. That server owns membership, authorization and accepted decisions. Local data is not silently published to a team. [Self-hosting →](infra/self-host/v1/README.md)

Credentials use OS-protected storage outside browser persistence. AI requests send relevant context to your chosen provider. Source files rely on your Mac account and disk encryption, not promised application-level encryption. Provider use can incur charges; no credits are included. [Network and recovery details →](docs/desktop/release/USER-GUIDE.md)

## Connections

The desktop scope is **GitHub, Google Drive and Slack**, selected local sources, **Codex and VS Code**. Recorded real-account internal checks do not establish onboarding for every new account or workspace. Provider approval and fresh-user qualification remain separate gates; an installable app registration is not a passed customer journey.

## Try the private internal beta

Private desktop-development repository. **Not a public desktop release yet.** Steps 1–7 have recorded scoped internal Mac qualification, including real desktop AI/connectors and Codex/VS Code, shared-server checks and manual update/recovery. Windows, two-computer qualification, signing/notarization and automatic updates are deferred, not passed. Do not run it against existing production infrastructure.

Start with the [release status and download information](docs/desktop/release/README.md), [source-build recipe](docs/desktop/release/BUILD.md), and [privacy and support guide](docs/desktop/release/USER-GUIDE.md). Step 8 publication remains gated separately from internal qualification.

## Build and inspect

Node.js 24 and npm are used for this baseline. Install dependencies with `npm ci --ignore-scripts`, then `npm run prisma:generate`. Build with `npm run build`; run the applicable baseline with `npx vitest run --config vitest.desktop.config.ts` and `npm --prefix apps/beta-web test`. These do not qualify packaged desktop operation.

`npm test` retains the unmodified upstream selection, including hosted-release evidence checks which fail without deliberately excluded production documents. [Their explicit scope and later owners](docs/desktop/upstream-checks.json) are recorded; they are not counted as passed by the desktop-baseline suite.

See [desktop contract](docs/desktop/CONTRACT.md), [architecture](docs/desktop/ADR-001.md), [threat model](docs/desktop/THREAT-MODEL.md), [feature inventory](docs/desktop/feature-parity.json), and [Step 1 evidence](docs/desktop/STEP-1.md).

For the portable engine, see [Step 2 setup and evidence](docs/desktop/STEP-2.md) and [its runtime decisions](docs/desktop/ADR-002.md). It uses local PostgreSQL, private files, durable jobs and offline evidence search without hosted signup or Redis. Real AI provider and public-distribution qualification are not claimed complete.

For the internal Mac shell and deferred release qualification, see [Step 3](docs/desktop/STEP-3.md) and [native runtime decisions](docs/desktop/ADR-003.md). This is not a public release.

For local onboarding, chat continuity, source ingestion, approval/Live Doc and native recovery evidence, see [Step 4 acceptance](docs/desktop/STEP-4-ACCEPTANCE.md). The packaged tests use synthetic local data; they do not certify real AI models, external providers or shared teams.

The source was imported as a snapshot, without upstream Git history. Its immutable revision and per-file hashes are recorded in [import manifest](docs/desktop/import-manifest.json). Excluded historical release evidence is not a claim that those upstream checks were unnecessary or passed here.

No GitHub Actions or deployment configuration is enabled. No production integration is configured. Desktop development cannot modify the existing managed product.

## Licensing

First-party Orchestra code is licensed under [Apache-2.0](LICENSE), approved by the owner after confirming ownership of the original code/assets. Third-party components retain their respective licenses. This repository remains **private by explicit owner instruction**; applying the license does not authorize publication. Bundled third-party notice review remains pending. See [rights and external dependencies](docs/desktop/RELEASE-DEPENDENCIES.md).
