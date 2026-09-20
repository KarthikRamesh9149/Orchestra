/**
 * Bounded stored-vector migration experiment on a COPY of one stopped synthetic
 * benchmark profile. Built-ins only; no native host, credentials, or providers.
 * Original profile/report and every experiment artifact are retained unchanged.
 * Timings are raw single-user PostgreSQL measurements, never IPC or p95 claims.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, cp, lstat, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ORIGINAL = '/private/tmp/orchestra-native-scale-4XzQOK';
const SOURCE = join(ORIGINAL, 'profile');
const MIGRATION = join(REPO, 'prisma/migrations/20260920120000_document_chunk_search_vector/migration.sql');
const POSTGRES = join(REPO, '.desktop/runtime/native/pgsql/bin/postgres');
const LIMIT_BYTES = 1024 ** 3;
const MAX_MS = 120_000;
const CLONE_MARKER = '.orchestra-scale-vector-clone';
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const round = (value) => Math.round(value * 1000) / 1000;

async function stoppedGuard(profile) {
  for (const path of [profile, join(profile, 'postgres')]) {
    const info = await lstat(path);
    requireThat(info.isDirectory() && !info.isSymbolicLink(), 'Profile/cluster must be real directories.');
    requireThat(await realpath(path) === path, 'Profile/cluster path must be canonical.');
  }
  requireThat(await readFile(join(profile, 'postgres/.orchestra-owned'), 'utf8') === 'orchestra-native-v1\n', 'Missing synthetic ownership marker.');
  requireThat(!await access(join(profile, 'postgres/postmaster.pid')).then(() => true, () => false), 'Profile has a PID file; refusing access.');
}

async function inventory(directory, checkpoint) {
  let bytes = 0;
  const files = [];
  async function visit(path) {
    checkpoint();
    const info = await lstat(path);
    requireThat(!info.isSymbolicLink(), 'Synthetic profile contains a symlink; refusing copy.');
    if (info.isDirectory()) {
      for (const name of (await readdir(path)).sort()) await visit(join(path, name));
    } else {
      requireThat(info.isFile(), 'Synthetic profile contains a non-regular file.');
      bytes += info.size;
      requireThat(bytes < LIMIT_BYTES, 'Synthetic profile is at least 1 GiB; refusing experiment.');
      files.push([relative(directory, path), info.size, sha256(await readFile(path))]);
    }
  }
  await visit(directory);
  return { bytes, fileCount: files.length, contentSha256: sha256(JSON.stringify(files)) };
}

function records(output) {
  return [...output.matchAll(/\bverification = "([^\n]*)"\t\(typeid/g)].map((match) => JSON.parse(match[1]));
}
function plans(output) {
  return [...output.matchAll(/\bQUERY PLAN = "(\[[\s\S]*?\])"\t\(typeid/g)].map((match) => JSON.parse(match[1])[0]);
}
function jsonRecord(kind, fields) {
  return `SELECT json_build_object('kind',${quote(kind)},${fields}) AS verification;`;
}
function storageSql(kind) {
  return jsonRecord(kind, "'heapBytes',pg_relation_size('document_chunks'),'tableWithToastBytes',pg_table_size('document_chunks'),'indexBytes',pg_indexes_size('document_chunks'),'totalBytes',pg_total_relation_size('document_chunks'),'databaseBytes',pg_database_size(current_database())");
}
function indexSql(kind) {
  return jsonRecord(kind, "'indexes',(SELECT json_agg(row_to_json(i) ORDER BY i.indexname) FROM (SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='document_chunks') i)");
}
const fingerprintSql = (kind) => jsonRecord(kind, "'rows',count(*),'content',md5(string_agg(id::text || ':' || lexical_content,E'\\n' ORDER BY id))") .replace(' AS verification;', ' AS verification FROM document_chunks;');
const sampleIds = 'SELECT id FROM document_chunks ORDER BY id LIMIT 100';
const probeUpdate = `UPDATE document_chunks SET lexical_content=lexical_content || ' vectorverificationuniquetoken' WHERE id IN (${sampleIds})`;
function updateProbeSql(afterMigration) {
  const commands = ['BEGIN;', `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${probeUpdate};`];
  if (afterMigration) commands.push(jsonRecord('generated_update', "'rows',count(*),'equivalent',bool_and(lexical_search_vector = to_tsvector('english'::regconfig,lexical_content)),'containsProbe',bool_and(lexical_search_vector @@ plainto_tsquery('english','vectorverificationuniquetoken'))") .replace(' AS verification;', ` AS verification FROM document_chunks WHERE id IN (${sampleIds});`));
  commands.push('ROLLBACK;', fingerprintSql(afterMigration ? 'fingerprint_after_update' : 'fingerprint_before_update'));
  return commands;
}

async function main() {
  requireThat(process.argv.length === 2, 'This one-profile diagnostic accepts no arguments.');
  const started = performance.now();
  let ownedChild = null;
  let timedOut = false;
  const watchdog = setTimeout(() => { timedOut = true; ownedChild?.kill('SIGKILL'); }, MAX_MS);
  const checkpoint = () => requireThat(!timedOut && performance.now() - started < MAX_MS, '120-second experiment budget exhausted.');
  let directory;
  const report = { version: 1, startedAt: new Date().toISOString(), passed: false, originalDirectory: ORIGINAL,
    scope: 'Copied synthetic profile only; raw single-user PostgreSQL query/migration/write timings. No providers, IPC, UI, builds, forced planner settings, added/dropped indexes, production data, or credentials.',
    limits: { profileBytesExclusive: LIMIT_BYTES, runtimeMs: MAX_MS }, providerCalls: 0, children: [], checks: [] };
  const check = (name, passed) => { report.checks.push({ name, passed: Boolean(passed) }); requireThat(passed, `Verification failed: ${name}`); };
  try {
    await stoppedGuard(SOURCE);
    report.originalBefore = await inventory(SOURCE, checkpoint);
    const originalReport = await readFile(join(ORIGINAL, 'report.json'), 'utf8');
    const originalQueries = await readFile(join(ORIGINAL, 'expression-variant-plans.sql'), 'utf8');
    report.originalReportSha256 = sha256(originalReport);
    report.originalQueriesSha256 = sha256(originalQueries);
    const fixture = JSON.parse(originalReport).fixture;
    const originalSql = [...originalQueries.matchAll(/^EXPLAIN \(ANALYZE,BUFFERS,FORMAT JSON\) (SELECT dc\.id,ts_rank_cd\([^\n]+);$/gm)].map((match) => match[1]);
    requireThat(originalSql.length === 3, 'Expected exactly three retained literal-original retrieval queries.');
    const names = ['sparse_ancient', 'multi_document_recall', 'saffronrelay_topical'];
    const sourceExpression = "to_tsvector('english',dc.lexical_content)";
    for (const sql of originalSql) {
      requireThat((sql.match(/to_tsvector\('english',dc\.lexical_content\)/g) ?? []).length === 2, 'Unexpected original vector expression count.');
      requireThat(/dc\.project_id='[a-f0-9-]{36}'::uuid/.test(sql) && sql.includes("dv.status::text IN ('ready','partial')") && sql.includes('d.current_version_id=dv.id') && sql.includes('d.archived_at IS NULL') && sql.includes('dc.parse_revision=dv.parse_revision') && sql.endsWith('ORDER BY rank DESC,dc.created_at DESC LIMIT 48') && !/[;\n]/.test(sql), 'Retained retrieval query lost an expected scope or bound.');
    }
    const migration = await readFile(MIGRATION, 'utf8');
    const normalizedMigration = migration.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
    requireThat(normalizedMigration === 'SET lock_timeout = \'5s\'; SET statement_timeout = \'120s\'; ALTER TABLE "document_chunks" ADD COLUMN "lexical_search_vector" tsvector GENERATED ALWAYS AS (to_tsvector(\'english\'::regconfig, "lexical_content")) STORED; RESET statement_timeout; RESET lock_timeout;', 'Migration differs from the explicitly authorised additive generated-column operation.');
    report.migration = { path: MIGRATION, sha256: sha256(migration) };
    directory = await mkdtemp('/private/tmp/orchestra-scale-search-vector-');
    const profile = join(directory, 'profile');
    report.directory = directory;
    report.profile = profile;
    await writeFile(join(directory, CLONE_MARKER), `${profile}\n`, { flag: 'wx', mode: 0o600 });
    checkpoint();
    await cp(SOURCE, profile, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true });
    await stoppedGuard(SOURCE);
    report.cloneBefore = await inventory(profile, checkpoint);
    check('clone_exact_content_before_start', report.cloneBefore.contentSha256 === report.originalBefore.contentSha256);
    async function cloneGuard() {
      checkpoint();
      requireThat(profile !== SOURCE && profile === join(directory, 'profile') && directory.startsWith('/private/tmp/orchestra-scale-search-vector-'), 'Invalid clone destination.');
      requireThat(await readFile(join(directory, CLONE_MARKER), 'utf8') === `${profile}\n`, 'Missing private clone ownership marker.');
      await stoppedGuard(profile);
      await stoppedGuard(SOURCE);
    }
    async function sqlPhase(name, commands, readOnly) {
      await cloneGuard();
      const input = `SET statement_timeout='15s';\n${commands.join('\n')}\n`;
      await writeFile(join(directory, `${name}.sql`), input, { flag: 'wx', mode: 0o600 });
      const phaseStarted = performance.now();
      const child = spawn(POSTGRES, ['--single', '-D', join(profile, 'postgres'), '-c', `default_transaction_read_only=${readOnly ? 'on' : 'off'}`, 'orchestra'], { env: { PATH: '', LANG: 'C', TMPDIR: directory }, stdio: ['pipe', 'pipe', 'pipe'] });
      ownedChild = child;
      const childRecord = { phase: name, pid: child.pid ?? null, exited: false };
      report.children.push(childRecord);
      let output = '', notices = '', overflow = false;
      const append = (type, data) => {
        if (type === 'stdout') output += String(data); else notices += String(data);
        if (output.length + notices.length > 8 * 1024 * 1024) { overflow = true; child.kill('SIGKILL'); }
      };
      child.stdout.on('data', data => append('stdout', data));
      child.stderr.on('data', data => append('stderr', data));
      child.stdin.on('error', () => {});
      // close follows process exit AND stdio drain; do not parse partial output.
      const completion = new Promise((resolveCompletion, reject) => { child.on('close', (code, signal) => resolveCompletion({ code, signal })); child.on('error', reject); });
      child.stdin.end(input);
      let result;
      try { result = await completion; } finally { ownedChild = null; }
      Object.assign(childRecord, result, { exited: true, elapsedMs: round(performance.now() - phaseStarted) });
      await writeFile(join(directory, `${name}.txt`), output + '\n--- PostgreSQL lifecycle notices ---\n' + notices, { flag: 'wx', mode: 0o600 });
      requireThat(!timedOut && !overflow && result.code === 0 && !/ERROR:|FATAL:|PANIC:/.test(notices), `PostgreSQL phase ${name} failed; retained diagnostic contains details.`);
      await cloneGuard();
      return { output, records: records(output), plans: plans(output) };
    }
    const identitySql = (kind, sql) => jsonRecord(kind, "'rows',count(*),'ids',array_agg(id ORDER BY rank DESC,created_at DESC),'ranks',array_agg(rank ORDER BY rank DESC,created_at DESC)").replace(' AS verification;', ` AS verification FROM (${sql}) result;`);
    const before = await sqlPhase('before', [storageSql('storage_before'), indexSql('indexes_before'), fingerprintSql('fingerprint_initial'), ...originalSql.map((sql, i) => identitySql(`baseline:${names[i]}`, sql)), ...updateProbeSql(false)], false);
    check('one_baseline_write_plan', before.plans.length === 1);
    const getRecord = (items, kind) => { const item = items.find(row => row.kind === kind); requireThat(item, `Missing record: ${kind}`); return item; };
    report.storageBefore = getRecord(before.records, 'storage_before');
    report.writeBeforeMs = before.plans[0]['Execution Time'];
    const fingerprint = getRecord(before.records, 'fingerprint_initial');
    check('baseline_write_rolled_back', getRecord(before.records, 'fingerprint_before_update').content === fingerprint.content);
    const migrated = await sqlPhase('migration', [jsonRecord('migration_start', "'epoch',extract(epoch FROM clock_timestamp())"), normalizedMigration, "SET statement_timeout='15s';", jsonRecord('migration_end', "'epoch',extract(epoch FROM clock_timestamp())"), storageSql('storage_after_migration'), indexSql('indexes_after'), jsonRecord('generated_column', "'generation',a.attgenerated,'type',format_type(a.atttypid,a.atttypmod),'expression',pg_get_expr(d.adbin,d.adrelid)").replace(' AS verification;', " AS verification FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='document_chunks'::regclass AND a.attname='lexical_search_vector';"), jsonRecord('all_row_equivalence', "'rows',count(*),'mismatches',count(*) FILTER (WHERE lexical_search_vector IS DISTINCT FROM to_tsvector('english'::regconfig,lexical_content)),'vectorBytes',sum(pg_column_size(lexical_search_vector))").replace(' AS verification;', ' AS verification FROM document_chunks;'), fingerprintSql('fingerprint_after_migration')], false);
    report.migration.elapsedMs = round((getRecord(migrated.records, 'migration_end').epoch - getRecord(migrated.records, 'migration_start').epoch) * 1000);
    report.storageAfterMigration = getRecord(migrated.records, 'storage_after_migration');
    report.column = getRecord(migrated.records, 'generated_column');
    report.equivalence = getRecord(migrated.records, 'all_row_equivalence');
    check('generated_stored_tsvector', report.column.generation === 's' && report.column.type === 'tsvector' && report.column.expression === "to_tsvector('english'::regconfig, lexical_content)");
    check('every_existing_row_vector_equivalent', report.equivalence.rows === fixture.totalChunks && report.equivalence.mismatches === 0);
    check('no_index_definitions_added_removed_or_changed', JSON.stringify(getRecord(before.records, 'indexes_before').indexes) === JSON.stringify(getRecord(migrated.records, 'indexes_after').indexes));
    report.indexes = getRecord(migrated.records, 'indexes_after').indexes;
    check('no_generated_column_index', report.indexes.every(index => !index.indexdef.includes('lexical_search_vector')));
    check('migration_preserves_all_lexical_rows', getRecord(migrated.records, 'fingerprint_after_migration').content === fingerprint.content);
    const queryCommands = [];
    const variants = [];
    originalSql.forEach((sql, i) => {
      const storedRank = sql.replace(sourceExpression, 'dc.lexical_search_vector');
      for (const [variant, variantSql] of [['original_expression', sql], ['expression_predicate_stored_rank', storedRank], ['stored_predicate_stored_rank', storedRank.replace(sourceExpression, 'dc.lexical_search_vector')]]) {
        const kind = `${names[i]}:${variant}`;
        variants.push({ kind, query: names[i], variant });
        queryCommands.push(jsonRecord('plan_label', `'label',${quote(kind)}`), `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${variantSql};`, identitySql(kind, variantSql));
      }
    });
    const compared = await sqlPhase('query-variants', queryCommands, true);
    check('all_nine_query_plans_captured', compared.plans.length === 9);
    report.queries = variants.map((variant, i) => {
      const row = getRecord(compared.records, variant.kind);
      const baseline = getRecord(before.records, `baseline:${variant.query}`);
      const plan = compared.plans[i];
      const indexes = [];
      const walk = (node) => { if (node['Index Name']) indexes.push(node['Index Name']); for (const child of node.Plans ?? []) walk(child); };
      walk(plan.Plan);
      const orderedIdsEqual = JSON.stringify(row.ids) === JSON.stringify(baseline.ids);
      const orderedRanksEqual = JSON.stringify(row.ranks) === JSON.stringify(baseline.ranks);
      check(`${variant.kind}:ordered_ids_and_ranks_unchanged`, orderedIdsEqual && orderedRanksEqual);
      check(`${variant.kind}:forbidden_scope_decoys_absent`, row.ids.every(id => !fixture.forbiddenChunkIds.includes(id)));
      if (variant.query === 'multi_document_recall') check(`${variant.kind}:all_sparse_fact_chunks_present`, ['ancient', 'middle', 'distributed'].every(key => row.ids.includes(fixture.factChunks[key])));
      return { ...variant, executionMs: plan['Execution Time'], planningMs: plan['Planning Time'], rows: row.rows, orderedIdsEqual, orderedRanksEqual, ids: row.ids, ranks: row.ranks, indexNames: [...new Set(indexes)], copperPosition: row.ids.indexOf(fixture.factChunks.distributed) + 1 || null };
    });
    const after = await sqlPhase('write-maintenance', [...updateProbeSql(true), storageSql('storage_after_rolled_back_probe')], false);
    check('one_generated_write_plan', after.plans.length === 1);
    report.writeAfterMs = after.plans[0]['Execution Time'];
    report.writeProbe = getRecord(after.records, 'generated_update');
    report.writeMeasurement = 'One EXPLAIN ANALYZE UPDATE of the same first 100 chunk IDs, appending one token, rolled back each time. Includes existing expression-GIN maintenance, WAL and row/index work; raw single samples, no production throughput inference.';
    check('generated_update_maintained', report.writeProbe.rows === 100 && report.writeProbe.equivalent === true && report.writeProbe.containsProbe === true);
    check('generated_write_rolled_back', getRecord(after.records, 'fingerprint_after_update').content === fingerprint.content);
    report.storageAfterRolledBackProbe = getRecord(after.records, 'storage_after_rolled_back_probe');
    await stoppedGuard(SOURCE);
    report.originalAfter = await inventory(SOURCE, checkpoint);
    report.cloneAfter = await inventory(profile, checkpoint);
    check('original_profile_unchanged', JSON.stringify(report.originalBefore) === JSON.stringify(report.originalAfter));
    check('original_report_unchanged', sha256(await readFile(join(ORIGINAL, 'report.json'))) === report.originalReportSha256);
    check('original_queries_unchanged', sha256(await readFile(join(ORIGINAL, 'expression-variant-plans.sql'))) === report.originalQueriesSha256);
    check('all_owned_children_exited', report.children.every(child => child.exited && child.code === 0));
    report.passed = true;
  } catch (error) {
    report.error = error instanceof Error ? error.message : 'Unknown diagnostic error.';
    process.exitCode = 1;
  } finally {
    clearTimeout(watchdog);
    report.elapsedMs = round(performance.now() - started);
    report.completedAt = new Date().toISOString();
    if (directory) await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ passed: report.passed, directory, elapsedMs: report.elapsedMs, migrationMs: report.migration?.elapsedMs, writeBeforeMs: report.writeBeforeMs, writeAfterMs: report.writeAfterMs, error: report.error, queries: report.queries?.map(({ query, variant, executionMs, orderedIdsEqual }) => ({ query, variant, executionMs, orderedIdsEqual })) }));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
