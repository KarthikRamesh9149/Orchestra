# Step 2 progress and gate

**Incomplete. Do not merge this step into main or start Step 3.**

All work is confined to the private Orchestra repository on `codex/desktop-step-2`. No orchestrav2 source, configuration, database or deployment changes.

## Verified foundation

- Pinned existing PostgreSQL/pgvector image in development-only Compose. Password is generated locally, untracked, and not printed. Database is exposed on loopback port 55439 only.
- Fresh database successfully applied all 81 preserved migrations plus the new desktop queue migration (82 total). Compatibility role names are NOLOGIN. This proves migration portability with documented prerequisites, not least-privilege runtime qualification.
- PostgreSQL queue: payload-bound idempotency, concurrent claim exclusion, ownership/fencing checks, heartbeat, explicit failed recovery, cancellation acknowledgement and bounded retry operation.
- An actual disposable claimant process was killed after its durable claim. Subsequent reconciliation reported `failed / worker_lease_expired`, not permanently running. Queue cancellation invalidated stale completion and heartbeat.
- Private file driver: restart persistence, atomic replace, size/traversal/symlink checks, private POSIX directories, authenticated-route requirement instead of filesystem URL exposure.
- Bounded encrypted archive envelope: round trip, randomization, wrong-passphrase and tamper rejection.
- Explicit profile validation and atomic installation-secret creation with separate random secrets. Concurrent creators converge on the same published identity.
- Verification: 1,355 applicable baseline tests passed; five database-only tests skipped in that default run and all five passed separately against the real local database. Typecheck and secret scan passed. The original Step 1 import-hash gate still passes; no imported application source was changed by this foundation commit.

## Run the isolated database checks

```sh
node scripts/desktop/dev-db.mjs up
node scripts/desktop/dev-db.mjs migrate
node scripts/desktop/dev-db.mjs test
npx vitest run tests/desktop-engine-primitives.test.ts tests/desktop-runtime-profile.test.ts
```

Compose is a developer tool, not the consumer installation method. These commands require the existing local Docker engine; they do not contact hosted application services. The helper does not provide destructive reset/down-volume commands. It uses only synthetic test jobs and refuses database tests outside the exact local fixture target.

## Remaining gate work

See ADR-002. The new primitives are deliberately not selected by the existing application bootstrap yet. In particular:

- existing buildContext/server worker still need portable composition and lifecycle wiring;
- SQL queue needs Prisma mapping and a restricted runtime database role;
- AI budgets/limits and offline providers must be integrated without Redis or fabricated responses;
- queue completion fencing does not fence arbitrary legacy handler side effects;
- domain-level document/research progress must be reconciled after failure/cancellation;
- full encrypted backup/restore and authenticated private storage integration remain;
- disk-full/flush failure and end-to-end upload/approval/restart are not yet proven.

No desktop-local readiness, complete parity, consumer packaging or complete Step 2 claim is made by the foundation tests.
