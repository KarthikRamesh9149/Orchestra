# Contributing to Orchestra

Orchestra’s source is public. The current desktop target is Apple Silicon Mac;
public installers are not available. Use the [source build](docs/desktop/release/BUILD.md) to contribute.

## Start with the product

Keep evidence, generated interpretation, proposed changes and accepted truth
distinct. Fix the whole user journey, including authorization, failure states,
persistence and recovery. Never turn a suggestion into an approval to simplify a
test. Preserve the current visual language.

Read [AGENTS.md](AGENTS.md), the [desktop contract](docs/desktop/CONTRACT.md), and
the relevant rows in the [feature inventory](docs/desktop/feature-parity.json).
This desktop repository is separate from the managed production app. Do not
change hosted services as part of a desktop contribution.

## Build locally

Follow the complete [Mac source-build recipe](docs/desktop/release/BUILD.md).
It describes native dependencies, unsigned internal packaging and the applicable
checks. Do not copy production environment files or customer profiles into a
development checkout. Use synthetic fixtures and your own scoped test accounts.

## Make a focused change

1. Describe the user problem and expected result in an issue. For suspected
   vulnerabilities or sensitive data, follow [SECURITY.md](SECURITY.md) instead.
2. Reproduce the issue, then add a regression test covering the affected boundary.
3. Implement the change without unrelated refactoring or dependency upgrades.
4. Run targeted tests during development, then the applicable final gates.
5. Record what passed locally, in a package, or against a real provider. Keep
   mocked and real-provider results separate.

Base contributions on `main` and open a pull request from your branch or fork.
Include the tests you ran and note any skipped coverage. Source and dependency
checks run on standard GitHub-hosted runners; they do not publish or deploy.
The upstream hosted-only test exclusions are
[explicitly documented](docs/desktop/upstream-checks.json), not treated as passes.

## Screenshots and demos

Use fictional projects with no customer data, tokens, private conversations or
provider credentials. Capture the real UI. Explain when footage is edited, an
answer is evidence-only, or a provider has not been configured. Do not fabricate
latency, successful integrations, approvals or release-readiness claims.

## Security and licensing

Send sensitive reports privately as described in [SECURITY.md](SECURITY.md).

First-party contributions use [Apache-2.0](LICENSE). Preserve third-party notices
and document any new dependency's provenance. Missing notices are not cleared by
adding a generic license label. See the [current review](docs/desktop/THIRD-PARTY-REVIEW.md).

Maintainer and recovery owner: **Karthik Ramesh**.
