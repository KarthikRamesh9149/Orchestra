# Contributing to Orchestra

Orchestra is currently a private Mac desktop beta. Repository access is required;
this guide does not announce a public release.

## Start with the product

Keep evidence, generated interpretation, proposed changes and accepted truth
distinct. Fix the whole user journey, including authorization, failure states,
persistence and recovery. Never turn a suggestion into an approval to simplify a
test. Preserve the current visual language.

Read [AGENTS.md](AGENTS.md), the [desktop contract](docs/desktop/CONTRACT.md), and
the relevant rows in the [feature inventory](docs/desktop/feature-parity.json).
The private desktop repository is separate from `orchestrav2`; do not change the
managed production app as part of desktop work.

## Build locally

Follow the complete [Mac source-build recipe](docs/desktop/release/BUILD.md).
It describes native dependencies, unsigned internal packaging and the applicable
checks. Do not copy production environment files or customer profiles into a
development checkout. Use synthetic fixtures and your own scoped test accounts.

## Make a focused change

1. Describe the user problem and the expected result in a private issue.
2. Reproduce the issue, then add a regression test covering the affected boundary.
3. Implement the change without unrelated refactoring or dependency upgrades.
4. Run targeted tests during development, then the applicable final gates.
5. Record what passed locally, in a package, or against a real provider. Keep
   mocked and real-provider results separate.

The owner currently maintains one branch, `main`. Coordinate changes with the
maintainer before pushing; do not introduce an automatic deployment workflow.
No paid GitHub Actions are enabled. The upstream hosted-only test exclusions are
[explicitly documented](docs/desktop/upstream-checks.json), not treated as passes.

## Screenshots and demos

Use fictional projects with no customer data, tokens, private conversations or
provider credentials. Capture the real UI. Explain when footage is edited, an
answer is evidence-only, or a provider has not been configured. Do not fabricate
latency, successful integrations, approvals or release-readiness claims.

## Security and licensing

Send sensitive reports privately to **hello@orchestraos.dev**. Include a minimal
reproduction, affected version and impact; omit live credentials and customer
records. This contact is not a response-time guarantee.

First-party contributions use [Apache-2.0](LICENSE). Preserve third-party notices
and document any new dependency's provenance. Missing notices are not cleared by
adding a generic license label. See the [current review](docs/desktop/THIRD-PARTY-REVIEW.md).

Maintainer and recovery owner: **Karthik Ramesh**.
