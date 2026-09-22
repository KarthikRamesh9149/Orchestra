/**
 * Source-level, synthetic PostgreSQL regression proof. Run with:
 *   node --import tsx scripts/desktop/verify-audit-fixes.mjs
 * Owns one new private cluster; never reads an existing profile or credential.
 * No shared dist build, UI/package certification, or external provider calls.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { SocratesService } from '../../src/modules/socrates/service.ts';
import { ProjectTransferService } from '../../src/desktop/project-transfer-service.ts';
import { openProjectTransfer, sealProjectTransfer, transferModels } from '../../src/desktop/project-transfer.ts';
import { PrivateLocalStorageDriver } from '../../src/lib/storage/private-local.ts';
import { encryptBackup } from '../../src/lib/storage/encrypted-backup.ts';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const bin = join(repo, '.desktop/native/darwin-arm64/pgsql/bin');
const sha = value => createHash('sha256').update(value).digest('hex');
const round = value => Math.round(value * 1000) / 1000;
const distribution = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = fraction => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
  return { samples: sorted.length, minMs: round(sorted[0]), medianMs: round(at(.5)), p95Ms: round(at(.95)), maxMs: round(sorted.at(-1)), samplesMs: values.map(round) };
};
async function freePort() {
  const server = createServer();
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  const port = server.address().port;
  await new Promise((ok, fail) => server.close(error => error ? fail(error) : ok()));
  return port;
}
async function main() {
  assert.equal(process.platform, 'darwin', 'This bundled native verifier is Mac-only');
  assert.equal(process.arch, 'arm64');
  assert.equal(process.argv.length, 2, 'No profile or credential arguments are accepted');
  const directory = await mkdtemp('/private/tmp/orchestra-audit-fixes-');
  const cluster = join(directory, 'postgres');
  const env = { PATH: '', LANG: 'C', TMPDIR: directory };
  const adminPassword = randomBytes(32).toString('hex');
  const runtimePassword = randomBytes(32).toString('hex');
  const report = { version: 1, directory, startedAt: new Date().toISOString(), passed: false,
    scope: 'Actual source-imported Socrates retrieval and project-transfer services, real local PostgreSQL and restricted runtime role; synthetic data only. Not packaged UI, production, provider, concurrency, or global app-speed evidence.',
    providerCalls: 0, checks: [], sourceHashes: {}, measurements: {} };
  let postgres, postgresExit, admin, runtime, writer, postgresLog = '', timedOut = false;
  const watchdog = setTimeout(() => { timedOut = true; postgres?.kill('SIGINT'); }, 180_000);
  const record = name => { report.checks.push(name); console.log('PASS', name); };
  const run = async (command, args, extraEnv = {}, input = '', timeout = 60_000) => {
    const child = spawn(command, args, { cwd: directory, env: { ...env, ...extraEnv }, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', error = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { error += data; });
    child.stdin.on('error', () => {});
    const result = new Promise((ok, fail) => { child.once('error', fail); child.once('close', code => ok(code)); });
    child.stdin.end(input);
    try { assert.equal(await result, 0, `${command.split('/').at(-1)} failed: ${error.replaceAll(adminPassword, '[redacted]').replaceAll(runtimePassword, '[redacted]')}`); }
    finally { clearTimeout(timer); }
    return output.trim();
  };
  try {
    for (const file of ['src/modules/socrates/service.ts', 'src/desktop/project-transfer.ts', 'src/desktop/project-transfer-service.ts']) {
      report.sourceHashes[file] = sha(await readFile(join(repo, file)));
    }
    await run(join(bin, 'initdb'), ['-D', cluster, '-U', 'orchestra_audit_admin', '--pwfile', '/dev/stdin', '--auth-host=scram-sha-256', '--auth-local=scram-sha-256', '--encoding=UTF8', '--no-locale'], {}, adminPassword + '\n');
    const port = await freePort();
    postgres = spawn(join(bin, 'postgres'), ['-D', cluster, '-h', '127.0.0.1', '-p', String(port), '-k', directory], { env, stdio: ['ignore', 'ignore', 'pipe'] });
    postgres.stderr.on('data', data => { postgresLog += data; });
    postgresExit = new Promise((ok, fail) => { postgres.once('error', fail); postgres.once('close', (code, signal) => ok({ code, signal })); });
    const sql = (query, database = 'postgres') => run(join(bin, 'psql'), ['-X', '-w', '-h', '127.0.0.1', '-p', String(port), '-U', 'orchestra_audit_admin', '-d', database, '-v', 'ON_ERROR_STOP=1', '-A', '-t'], { PGPASSWORD: adminPassword }, query);
    let ready = false;
    for (let attempt = 0; attempt < 100 && !timedOut; attempt++) {
      try { await sql('SELECT 1;'); ready = true; break; }
      catch { if (postgres.exitCode !== null) throw new Error('Owned PostgreSQL exited before readiness'); await new Promise(ok => setTimeout(ok, 50)); }
    }
    assert(ready, 'Owned PostgreSQL did not become ready');
    assert.equal(await sql('SHOW data_directory;'), cluster);
    await sql('CREATE DATABASE orchestra_audit;');
    await sql('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN; CREATE SCHEMA extensions; ALTER DATABASE orchestra_audit SET search_path=public,extensions;', 'orchestra_audit');
    // Prisma reads only this copied schema directory, not the checkout .env.
    await cp(join(repo, 'prisma'), join(directory, 'prisma'), { recursive: true });
    const adminUrl = `postgresql://orchestra_audit_admin:${adminPassword}@127.0.0.1:${port}/orchestra_audit?schema=public`;
    const migrationLog = await run(process.execPath, [join(repo, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', join(directory, 'prisma/schema.prisma')], { DATABASE_URL: adminUrl });
    await writeFile(join(directory, 'migrations.log'), migrationLog.replaceAll(adminPassword, '[redacted]'), { mode: 0o600 });
    await sql(`CREATE ROLE orchestra_audit_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD '${runtimePassword}';
      GRANT USAGE ON SCHEMA public,extensions TO orchestra_audit_runtime;
      GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO orchestra_audit_runtime;
      DO $$ DECLARE t record; BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' LOOP
      EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.%I TO orchestra_audit_runtime',t.tablename);
      EXECUTE format('CREATE POLICY audit_runtime_access ON public.%I TO orchestra_audit_runtime USING (true) WITH CHECK (true)',t.tablename);
      END LOOP; END $$;`, 'orchestra_audit');
    admin = new PrismaClient({ datasourceUrl: adminUrl });
    const runtimeUrl = `postgresql://orchestra_audit_runtime:${runtimePassword}@127.0.0.1:${port}/orchestra_audit?schema=public`;
    runtime = new PrismaClient({ datasourceUrl: runtimeUrl });
    writer = new PrismaClient({ datasourceUrl: runtimeUrl });
    report.migrations = Number((await admin.$queryRaw`SELECT count(*) AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`)[0].count);
    await assert.rejects(runtime.$executeRawUnsafe('CREATE TABLE forbidden_audit_ddl(id int)'));
    record('fresh migrated cluster and non-owner runtime role');

    const org = await runtime.organization.create({ data: { name: 'Synthetic audit fixture', slug: randomUUID() } });
    const user = await runtime.user.create({ data: { orgId: org.id, email: 'audit@fixture.invalid', normalizedEmail: 'audit@fixture.invalid', displayName: 'Synthetic audit owner', globalRole: 'owner', workspaceRoleDefault: 'manager' } });
    await runtime.organizationMembership.upsert({ where: { organizationId_userId: { organizationId: org.id, userId: user.id } }, create: { organizationId: org.id, userId: user.id, globalRole: 'owner', workspaceRoleDefault: 'manager' }, update: {} });
    const newProject = name => runtime.project.create({ data: { orgId: org.id, name, slug: randomUUID(), status: 'active', createdBy: user.id, members: { create: { userId: user.id, projectRole: 'manager' } } } });
    const project = await newProject('Synthetic cached evidence');
    const fixtures = Array.from({ length: 120 }, (_, index) => ({ documentId: randomUUID(), versionId: randomUUID(), chunkId: randomUUID(), index, createdAt: new Date(Date.UTC(2026, 0, 1) - index * 1000) }));
    await runtime.document.createMany({ data: fixtures.map(row => ({ id: row.documentId, projectId: project.id, kind: 'prd', title: `Synthetic operating note ${row.index}`, currentVersionId: row.versionId, uploadedBy: user.id, visibility: 'internal', createdAt: row.createdAt })) });
    await runtime.documentVersion.createMany({ data: fixtures.map(row => ({ id: row.versionId, documentId: row.documentId, projectId: project.id, fileKey: `fixture/${row.index}`, checksumSha256: sha(`source-${row.index}`), mimeType: 'text/plain', fileSize: 30n, status: 'ready', parseRevision: 1, uploadedBy: user.id, createdAt: row.createdAt })) });
    await runtime.documentChunk.createMany({ data: fixtures.map(row => ({ id: row.chunkId, documentVersionId: row.versionId, projectId: project.id, parseRevision: 1, chunkIndex: 0, content: `Synthetic acceptance marker ${row.index}. Evidence is reviewed.`, lexicalContent: `Synthetic acceptance marker ${row.index}. Evidence is reviewed.`, tokenCount: 10, createdAt: row.createdAt })) });
    const metrics = { contentLoads: 0, metadata: [], titleScope: [] };
    const observed = runtime.$extends({ query: {
      documentChunk: { async findMany({ args, query }) {
        const start = performance.now();
        const result = await query(args);
        if (args.take === 120 && args.include) metrics.contentLoads++;
        if (args.select?.id && args.select?.documentVersion) {
          assert(!args.select.content && !args.select.lexicalContent && !args.select.section);
          metrics.metadata.push({ ms: performance.now() - start, ids: args.where.id.in.length, returned: result.length });
        }
        return result;
      } },
      document: { async findMany({ args, query }) {
        const start = performance.now(); const result = await query(args);
        if (args.select?.id && args.select?.title) metrics.titleScope.push(performance.now() - start);
        return result;
      } }
    } });
    const forbiddenProvider = new Proxy({}, { get() { report.providerCalls++; throw new Error('Provider use forbidden'); } });
    const socrates = new SocratesService(observed, { OPENAI_EMBEDDING_MODEL: 'mock' }, forbiddenProvider, forbiddenProvider, undefined, undefined);
    const retrieve = () => socrates.findSocratesV1DocumentEvidence(project.id, 'What is this project?', false);
    const warm = await retrieve();
    for (const row of fixtures.slice(0, 5)) assert(warm.some(item => item.id === row.chunkId));
    const cached = socrates.v1EvidenceCache.get(`${project.id}:documents`);
    assert.equal(cached.value.length, 120);
    assert.equal(metrics.contentLoads, 1);
    const unchanged = fixtures[4];
    assert((await retrieve()).some(row => row.id === unchanged.chunkId));
    assert.strictEqual(socrates.v1EvidenceCache.get(`${project.id}:documents`), cached);
    assert.equal(metrics.contentLoads, 1);
    record('warm retrieval includes synthetic sources and reuses unchanged cached content');

    const assertNextExcludes = async (fixture, name) => {
      const result = await retrieve();
      assert(!result.some(row => row.id === fixture.chunkId), name);
      assert(result.some(row => row.id === unchanged.chunkId), 'Unchanged evidence disappeared');
      assert.strictEqual(socrates.v1EvidenceCache.get(`${project.id}:documents`), cached);
      assert.equal(metrics.contentLoads, 1, 'Immutable content was reread');
      record(name);
    };
    await writer.document.update({ where: { id: fixtures[0].documentId }, data: { archivedAt: new Date() } });
    await assertNextExcludes(fixtures[0], 'separate-connection archive is excluded on the next warm retrieval');
    const replacementId = randomUUID();
    await writer.documentVersion.create({ data: { id: replacementId, documentId: fixtures[1].documentId, projectId: project.id, fileKey: 'fixture/replacement', checksumSha256: sha('replacement'), mimeType: 'text/plain', fileSize: 20n, status: 'ready', parseRevision: 1, uploadedBy: user.id } });
    await writer.document.update({ where: { id: fixtures[1].documentId }, data: { currentVersionId: replacementId } });
    await assertNextExcludes(fixtures[1], 'separate-connection current-version supersession excludes the cached old version');
    await writer.documentVersion.update({ where: { id: fixtures[2].versionId }, data: { parseRevision: 2 } });
    await assertNextExcludes(fixtures[2], 'separate-connection parse supersession excludes cached old-parse chunks');
    await writer.documentVersion.update({ where: { id: fixtures[3].versionId }, data: { status: 'failed' } });
    await assertNextExcludes(fixtures[3], 'separate-connection failed parse status excludes cached evidence');

    // Warm-up samples are excluded from the following bounded distribution.
    metrics.metadata.length = 0; metrics.titleScope.length = 0;
    const retrievalSamples = [];
    for (let sample = 0; sample < 40; sample++) {
      const start = performance.now(); await retrieve(); retrievalSamples.push(performance.now() - start);
    }
    assert.equal(metrics.metadata.length, 40);
    assert(metrics.metadata.every(row => row.ids === 120));
    assert.equal(metrics.contentLoads, 1);
    report.measurements = { method: '40 sequential warm source-method calls in one fresh local cluster after functional warm-up; metadata elapsed time includes actual Prisma and PostgreSQL round trips. No before/after or global speed claim.', corpus: { documents: 120, chunks: 120, cachedChunks: 120, returnedEvidenceCap: 8 }, metadataRevalidation: distribution(metrics.metadata.map(row => row.ms)), liveTitleScope: distribution(metrics.titleScope), completeDocumentRetrieval: distribution(retrievalSamples), immutableContentReads: metrics.contentLoads };
    record('40 warm samples perform one bounded metadata lookup each without rereading cached content');

    const destination = await newProject('Synthetic transfer destination');
    const actor = { userId: user.id, orgId: org.id };
    const sourceProject = randomUUID(), sourceOrg = randomUUID(), sourceAuthor = randomUUID();
    const date = new Date().toISOString(), bytes = Buffer.from('Synthetic transfer source bytes.'), digest = sha(bytes);
    const sourceDocuments = [randomUUID(), randomUUID()], sourceVersions = [randomUUID(), randomUUID()];
    const payload = { format: 'orchestra-project-transfer', version: 1, source: { projectId: sourceProject, orgId: sourceOrg, installationId: randomUUID(), name: 'Synthetic import source', exportedAt: date }, actors: [{ id: sourceAuthor, displayName: 'Synthetic original author' }], records: {
      Document: sourceDocuments.map((id, index) => ({ id, projectId: sourceProject, kind: 'prd', title: `Synthetic source ${index}`, currentVersionId: sourceVersions[index], uploadedBy: sourceAuthor, visibility: 'internal', archivedAt: null, createdAt: date, updatedAt: date })),
      DocumentVersion: sourceVersions.map((id, index) => ({ id, documentId: sourceDocuments[index], projectId: sourceProject, fileKey: `sha256/${digest}`, checksumSha256: digest, mimeType: 'text/plain', fileSize: String(bytes.length), status: 'ready', parseRevision: 1, parseConfidence: null, sourceLabel: 'manual', parseWarningJson: null, uploadedBy: sourceAuthor, createdAt: date, processedAt: date })),
      ProjectLiveDocSource: [{ id: randomUUID(), orgId: sourceOrg, projectId: sourceProject, documentId: sourceDocuments[0], documentVersionId: sourceVersions[0], sourceKind: 'uploaded_prd', setByUserId: sourceAuthor, createdAt: date, updatedAt: date }]
    }, files: [{ sha256: digest, base64: bytes.toString('base64') }] };
    const storage = new PrivateLocalStorageDriver(join(directory, 'files'));
    let writes = 0;
    const observedStorage = new Proxy(storage, { get(target, key) {
      if (key === 'putObject') return async input => { writes++; return target.putObject(input); };
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
    const transfer = new ProjectTransferService(runtime, observedStorage, randomUUID());
    const passphrase = 'synthetic-transfer-' + randomUUID();
    const archive = sealProjectTransfer(payload, passphrase);
    const preview = await transfer.previewImport(archive, passphrase, destination.id, actor);
    const input = { archive, passphrase, targetProjectId: destination.id, actor, digest: preview.digest, identityMap: { [sourceAuthor]: user.id }, acknowledgeHistoricalTruth: true };
    const malformed = structuredClone(payload);
    malformed.records.ProjectLiveDocSource[0].documentVersionId = sourceVersions[1];
    // Simulate a foreign writer: encryption is valid; semantic seal validation is deliberately bypassed.
    const malformedArchive = encryptBackup(Buffer.from(JSON.stringify(malformed)), passphrase);
    await assert.rejects(transfer.previewImport(malformedArchive, passphrase, destination.id, actor), /version belongs to another document/);
    await assert.rejects(transfer.importProject({ ...input, archive: malformedArchive }), /version belongs to another document/);
    assert.equal(writes, 0);
    for (const name of transferModels) assert.equal(await runtime[name[0].toLowerCase() + name.slice(1)].count({ where: { projectId: destination.id } }), 0);
    assert.equal(await runtime.auditEvent.count({ where: { projectId: destination.id } }), 0);
    record('malformed source-A/version-B encrypted transfer is rejected before file or database persistence');
    assert.equal((await transfer.importProject(input)).replayed, false);
    assert.equal((await transfer.importProject(input)).replayed, true);
    assert.equal(await runtime.document.count({ where: { projectId: destination.id } }), 2);
    const stored = await runtime.documentVersion.findUniqueOrThrow({ where: { id: sourceVersions[0] } });
    assert.deepEqual(await storage.getObject(stored.fileKey), bytes);
    const roundtrip = openProjectTransfer(await transfer.exportProject(destination.id, actor, passphrase), passphrase).transfer;
    assert.equal(roundtrip.records.ProjectLiveDocSource[0].documentId, sourceDocuments[0]);
    assert.equal(roundtrip.records.ProjectLiveDocSource[0].documentVersionId, sourceVersions[0]);
    assert.equal(roundtrip.files[0].base64, bytes.toString('base64'));
    assert.equal(roundtrip.history[0].source.projectId, sourceProject);
    record('legitimate transfer persists exact bytes/source linkage, replays once and exports original lineage');
    assert.equal(report.providerCalls, 0);
    report.passed = true;
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
  } finally {
    clearTimeout(watchdog);
    await Promise.all([admin, runtime, writer].filter(Boolean).map(db => db.$disconnect().catch(() => {})));
    if (postgres) {
      // Signal the child handle created above, never a PID read from another profile.
      if (postgres.exitCode === null && postgres.signalCode === null) postgres.kill('SIGINT');
      const timer = setTimeout(() => postgres.kill('SIGKILL'), 10_000);
      try { report.postgresExit = await postgresExit; } finally { clearTimeout(timer); }
      if (report.postgresExit.code !== 0 || timedOut) { report.passed = false; process.exitCode = 1; }
    }
    report.completedAt = new Date().toISOString();
    await writeFile(join(directory, 'postgres.log'), postgresLog, { mode: 0o600 });
    await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify({ passed: report.passed, directory, checks: report.checks.length, migrations: report.migrations, metadataRevalidation: report.measurements.metadataRevalidation, error: report.error, postgresExit: report.postgresExit }));
  }
}
await main();
