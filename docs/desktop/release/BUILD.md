# Source build: Mac ARM internal candidate

This is a maintainer/contributor recipe, not consumer installation. Repository
access is currently required. No hosted Orchestra credentials or maintainer
signing identity should be needed to build an **unsigned internal** package.
An independent clean-source reproduction of this recipe remains required before
public release; previous packaged runtime checks are not that reproduction.

Prerequisites: macOS Apple Silicon, Node.js 24/npm, Xcode command-line developer
tools (clang, make, SDK), system Perl/tar and network access to npm, Electron,
Node, PostgreSQL, OpenSSL and pgvector source distributions. No database needs
to be installed system-wide. Do not change any existing PostgreSQL installation.

Run from a fresh checkout, not a directory containing customer data or copied
production environment files:

```sh
npm ci --ignore-scripts
npm run prisma:generate
npm run build
npm --prefix apps/desktop ci
npm --prefix apps/desktop run typecheck
npm --prefix apps/desktop run build
mkdir -p .desktop
node scripts/desktop/build-native-mac.mjs
node scripts/desktop/prepare-native.mjs
npm --prefix apps/desktop run package
```

The native recipe pins source hashes and builds private PostgreSQL/pgvector and
OpenSSL. Preparation verifies the pinned Node download and assembles `.desktop`.
The package path is written to `.desktop/latest-package.txt`. Native build
provenance is `.desktop/native/darwin-arm64/build-provenance.json`; the runtime
contains `native-manifest.json`. Hashes prove byte identity, not authorship or
public signing. Never disable Gatekeeper or strip quarantine as a release step.

Applicable source tests:

```sh
npx vitest run --config vitest.desktop.config.ts
npm --prefix apps/beta-web test
node --test tests/desktop-publication-audit.test.mjs
node scripts/desktop/publication-audit.mjs
```

The publication audit intentionally returns nonzero while publication is blocked.
It reports metadata and pending review, not a security certificate. The full
upstream test selection has [documented exclusions](../upstream-checks.json).

For a shared server, use the versioned
[self-hosting recipe](../../../infra/self-host/v1/README.md), including its Docker
build memory prerequisites. Desktop-local consumer operation does not use Docker.
