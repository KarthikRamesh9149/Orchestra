# Step 3: native shell candidate

Status: **INCOMPLETE. Do not merge into main or represent this as a consumer release.**

Scope: private `KarthikRamesh9149/Orchestra`, branch `codex/desktop-step-3`, based on Step 2 main `69bb0d33c1f06ecddaec39780e391b75c6e38cc8`. No production repository or service changes.

## Implemented

- Electron main/preload with sandboxed, isolated renderer; trusted custom asset protocol; no renderer Node, arbitrary network, filesystem or shell proxy.
- Strict workspace, evidence-selection/upload and streamed ask/cancel contracts. Main-process file capabilities are single-use, expiring, bounded and detect file replacement. Existing backend authorization remains authoritative.
- OS-encrypted installation vault. Mac database bootstrap uses a stdin pipe; injected engine secrets do not produce a plaintext duplicate.
- App-owned PostgreSQL/pgvector and Node, separate migration/runtime roles, complete preserved migrations, authenticated loopback and durable worker.
- Single-instance Electron ownership, parent-disconnect shutdown, bounded subprocess handling, private cluster initialization and preservation of interrupted initialization.
- Pinned Mac native source recipe, dependency relocation, native hash inventory and private internal Electron package recipe. No public signing or notarization claim.

## Reproduce Mac candidate

Prerequisites are **build-machine** dependencies, not consumer dependencies: Node 24/npm, Apple developer toolchain, make, Perl and archive utilities. Native sources download only from the pinned upstream URLs recorded in the recipe. Builds stay under ignored `.desktop/`.

```sh
npm ci --ignore-scripts
npm run prisma:generate
npm --prefix apps/desktop ci --ignore-scripts
node apps/desktop/node_modules/electron/install.js
node scripts/desktop/build-native-mac.mjs
node node_modules/typescript/bin/tsc -p tsconfig.json
npm --prefix apps/beta-web run build
npm --prefix apps/desktop run build
node scripts/desktop/prepare-native.mjs
node scripts/desktop/native-smoke.mjs
npm --prefix apps/desktop run package
```

Run the emitted `.app` locally only. The package recipe creates a fresh output directory per run. Assembly retains previous runtime directories for recovery; it does not delete unrelated files. Those ignored build directories are not public releases.

## Evidence and limits

The Mac native smoke uses a fresh synthetic database and empty PATH. It checks migration/startup, workspace save/reopen, unauthorized selection, parent IPC-loss recovery and absence of plaintext engine-secret duplicates. This is same-host isolation, **not** an independent clean-machine result.

Packaged Electron check: `orchestra://app/workspaces`, title `Orchestra`, renderer `process` undefined, restricted bridge available, runtime ready, workspace create/list successful, no captured page exception. Reopen preserved the workspace; a duplicate launch exited cleanly; force-killing the owned Electron main process then reopening preserved the workspace. Existing UI displays the honest Step 4 adapter-unavailable state; full product workflows are not claimed here. Browser plugin unavailable; Playwright Electron drove the package with isolated user data and empty PATH. Screenshot and detailed harness output were kept outside the repository.

Final applicable regression run: 1,362 backend tests passed; 13 optional database integration tests skipped by that unit-run configuration. The separate native database smoke supplies the new runtime proof, including rejection of missing/incorrect loopback authority; it does not relabel the 13 skips as passes. Existing frontend suite: 191 passed. Five focused shell tests cover schema/frame authorization, safe assets, single-use file selection and native inventory corruption. Backend/desktop typechecks, backend/frontend/extension builds, source-provenance/inventory checks and the local security scan passed. Electron lockfile audit reports zero known vulnerabilities; that is not a complete native-library security certification.

## Mandatory open gates

1. Windows x64 native build/runtime/Prisma/parser inventory and protected credential bootstrap. No Windows package exists or has passed qualification.
2. Independent clean Mac and Windows launch/provision/save/quit/reopen, duplicate-launch and forced-termination tests.
3. Complete fault-injection matrix: hard-killed guardian, interrupted migration, denied keychain access, port collisions and platform-specific child-process recovery. Normal parent IPC loss alone does not close these cases.
4. Exact-final-package rerun after remaining corrections. Evidence for earlier candidates is not automatically transferred.

Step 3 remains open until these pass. Step 4 is onboarding and feature parity, and is not started by this work.
