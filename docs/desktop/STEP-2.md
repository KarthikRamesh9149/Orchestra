# Step 2: Portable local engine

All implementation belongs to private KarthikRamesh9149/Orchestra on codex/desktop-step-2. orchestrav2 is unchanged. This is an engine milestone, not an installer or full UI-parity release.

## Implemented

- Explicit local composition using original backend services, without Railway, Supabase, Redis, copied credentials or hosted signup.
- Restricted runtime role, separate migration administrator, installation authority plus ordinary actor/project authorization.
- Durable jobs with idempotency, claims/fencing, heartbeat API, bounded explicit retries, cancellation and domain reconciliation.
- Transaction-fenced database effects and completion; real process-kill/retry proof.
- Persistent PostgreSQL request/concurrency/cost limits. Disposable caches are not authoritative.
- Private atomic storage, authenticated reads, bounded paths/symlinks, ENOSPC and fsync failure tests preserving old bytes.
- Offline lexical indexing and cited evidence-only answers without fabricated vectors or generated truth. Missing embeddings produce honest partial status; unconfigured generative jobs fail.
- Separate installation secrets and encrypted database-plus-file backups, bounded to 128 MiB source data / 10,000 files. Live data still relies on OS disk encryption.
- Prisma mappings and two additive migrations; all 81 original migration files preserved.

## Gate evidence

Verified on macOS with the pinned developer PostgreSQL 17/pgvector container:

- All 83 migrations applied to a fresh database; second deploy idempotent.
- Authenticated HTTP upload → parse → lexical index → cited answer → authorized approval → restart → new login → identical authenticated download.
- Unauthorized read/approval rejected. Repeated approval produced one revision.
- Actual SIGKILL during a pending effect: rollback, explicit failure, retry and one committed effect. Healthy-worker exclusion and active cancellation tested separately.
- Encrypted database/files restored to a separate empty database; accepted decision and source bytes verified. Disposable restore/fresh databases were removed afterwards.
- Default regression tests explicitly skip DB integration tests; those run separately below. Exact totals are reported at completion.

## Reproduce

```sh
node scripts/desktop/dev-db.mjs up
node scripts/desktop/dev-db.mjs migrate
node scripts/desktop/dev-db.mjs provision-runtime
node scripts/desktop/verify-fresh-db.mjs
node scripts/desktop/dev-db.mjs test
node scripts/desktop/dev-db.mjs test-engine
npx vitest run --config vitest.desktop.config.ts --maxWorkers=4
npm run typecheck
node node_modules/typescript/bin/tsc -p tsconfig.json
npm --prefix apps/beta-web test -- --run
npm --prefix apps/beta-web run build
npm --prefix apps/vscode-extension run build
node scripts/desktop/verify-import.mjs --check
node scripts/desktop/inventory.mjs --check
node --import tsx scripts/ops/security-scan-local.ts
```

Developer-only startup after provisioning:

```sh
node --import tsx scripts/desktop/run-engine.mjs
```

The token is not printed. The later privileged desktop shell supplies it; browser secret storage is not the design. Compose is not the consumer installation mechanism. SIGINT/SIGTERM shut down the engine. dev-db.mjs stop retains the isolated volume. Synthetic local test fixtures are not published.

## Next-stage boundaries

Step 3: Electron, OS credential storage and bundled runtimes. Step 4: local-owner onboarding and packaged UI parity. Step 5: real AI/connectors/MCP. Step 6: shared teams/self-hosting/migration. Steps 7/8: signed qualification and publication. None is implicitly completed by this gate.

No styling changes, production deployments, paid GitHub Actions or purchases.
