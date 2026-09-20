/**
 * Backend/native-process failure qualification. Synthetic transports, ZERO real
 * AI requests. Uses only a fresh private profile; no existing vault/env is read.
 * Compile with the repository gate before running (this script never compiles):
 * node scripts/desktop/qualify-isolated-ai-recovery.mjs --bundle /absolute/runtime
 * Retains a synthetic profile/report (<500 MB); generated secrets are memory-only.
 */
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { access, chmod, cp, mkdir, mkdtemp, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const delay = ms => new Promise(done => setTimeout(done, ms));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
class HarnessError extends Error {}
const requireThat = (condition, message) => { if (!condition) throw new HarnessError(message); };
export function parseRecoveryArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    requireThat(['--bundle', '--backend-dist'].includes(argv[index]) && argv[index + 1] && isAbsolute(argv[index + 1]) && !values.has(argv[index]), 'Only absolute --bundle and --backend-dist arguments are allowed.');
    values.set(argv[index], argv[index + 1]);
  }
  return { bundle: resolve(values.get('--bundle') ?? join(REPO, '.desktop/runtime')), dist: resolve(values.get('--backend-dist') ?? join(REPO, 'dist')) };
}
export function preservedEarlierMessages(before, after) {
  return before.every(old => after.some(next => digest(next) === digest(old)));
}
async function fixtureBytes(path) {
  let bytes = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const child = join(path, entry.name);
    bytes += entry.isDirectory() ? await fixtureBytes(child) : (await stat(child)).size;
  }
  return bytes;
}
async function buildEvidence(options) {
  const paths = ['desktop/native-host', 'desktop/postgres-watchdog', 'desktop/engine', 'lib/jobs/postgres', 'lib/jobs/postgres-worker', 'modules/deep-research/service', 'modules/socrates/service'];
  const result = [];
  for (const path of paths) {
    const source = join(REPO, 'src', path + '.ts'), compiled = join(options.dist, 'src', path + '.js');
    requireThat((await stat(compiled)).mtimeMs >= (await stat(source)).mtimeMs, 'Relevant compiled backend is stale; parent must compile before qualification.');
    result.push({ path, sourceSha256: createHash('sha256').update(await readFile(source)).digest('hex'), compiledSha256: createHash('sha256').update(await readFile(compiled)).digest('hex') });
  }
  return result;
}
async function stopChild(child, signal = 'SIGTERM') {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((done, fail) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); fail(new HarnessError('Owned process exceeded shutdown deadline.')); }, 30_000);
    child.once('exit', () => { clearTimeout(timer); done(); });
    child.kill(signal);
  });
}

export async function runRecovery(options) {
  requireThat(process.platform === 'darwin', 'Native recovery harness currently qualifies macOS only.');
  const build = await buildEvidence(options);
  await access(join(options.bundle, 'native/pgsql/bin/postgres'));
  const directory = await mkdtemp('/private/tmp/orchestra-isolated-ai-recovery-');
  await chmod(directory, 0o700);
  const profile = join(directory, 'synthetic-profile'), bundle = join(directory, 'runtime');
  await mkdir(profile, { mode: 0o700 });
  await mkdir(join(bundle, 'backend'), { recursive: true, mode: 0o700 });
  await symlink(join(options.bundle, 'native'), join(bundle, 'native'));
  await symlink(options.dist, join(bundle, 'backend/dist'));
  await symlink(join(REPO, 'node_modules'), join(bundle, 'backend/node_modules'));
  await cp(join(REPO, 'prisma'), join(bundle, 'backend/prisma'), { recursive: true });
  const fresh = () => randomBytes(32).toString('hex');
  const vault = { version: 1, admin: fresh(), runtime: fresh(), installation: { version: 1, loopback: fresh(), access: fresh(), refresh: fresh(), connectorEncryption: fresh(), oauthState: fresh(), clientShare: fresh() } };
  const report = { version: 1, startedAt: new Date().toISOString(), qualification: 'synthetic-transport-native-process-recovery', profile, build,
    scope: 'Fresh native PostgreSQL and compiled production services/queue in real Node subprocesses. Provider responses and embeddings are deterministic synthetic fixtures, not real AI. Excludes UI, actual network-provider outages, OS Keychain, release certification and exactly-once generalisation.',
    realProviderConfigured: false, networkEvidence: 'No provider configuration or real provider implementation is supplied. Probe fetch calls are trapped and counted; the offline host uses only its normal offline composition. This is not an OS-level network/egress capture.', checks: [], results: {}, passed: false };
  const check = (name, passed) => { report.checks.push({ name, passed }); requireThat(passed, 'Acceptance check failed: ' + name); };
  const children = new Set();
  let host, postgres, authority, port, projectId, stage = 'bootstrap';
  const pending = new Map();
  const childEnv = { PATH: '', TMPDIR: directory, NODE_ENV: 'production', LANG: 'C' };
  const launch = (file, args, stdio) => {
    const child = spawn(file, args, { cwd: profile, env: childEnv, stdio });
    children.add(child); child.once('exit', () => children.delete(child));
    return child;
  };
  const command = command => new Promise((done, fail) => {
    const id = randomUUID();
    const timer = setTimeout(() => { pending.delete(id); fail(new HarnessError('Native fixture command timeout.')); }, 30_000);
    pending.set(id, result => { clearTimeout(timer); pending.delete(id); result?.ok ? done(result.data) : fail(new HarnessError('Native fixture command failed.')); });
    host.send({ type: 'command', id, command });
  });
  const api = async (path, method = 'GET', body) => {
    requireThat(authority && path.startsWith('/v1/'), 'Only authenticated owned loopback API is allowed.');
    const response = await fetch(`http://127.0.0.1:${authority.port}${path}`, { method, signal: AbortSignal.timeout(30_000), headers: { 'x-orchestra-local-token': authority.token, Authorization: 'Bearer ' + authority.bearer, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    requireThat(response.ok, 'Owned fixture API failed with HTTP ' + response.status);
    const result = await response.json(); requireThat(result.error == null, 'Owned fixture API returned an error.'); return result.data;
  };
  const probe = (mode, extra = {}, onEvent) => {
    const child = launch(process.execPath, [join(REPO, 'scripts/desktop/isolated-ai-recovery-worker.mjs')], ['ignore', 'ignore', 'ignore', 'ipc']);
    const completion = new Promise((done, fail) => {
      let output, finished = false;
      const timer = setTimeout(() => { child.kill('SIGTERM'); fail(new HarnessError('Isolated probe timeout: ' + mode)); }, 90_000);
      child.on('message', event => {
        if (event?.type === 'result') output = event;
        else if (event?.type === 'failure') { finished = true; clearTimeout(timer); fail(new HarnessError(event.stage + ': ' + event.reason)); }
        else onEvent?.(event, child);
      });
      child.once('error', () => { finished = true; clearTimeout(timer); fail(new HarnessError('Could not launch isolated probe.')); });
      child.once('exit', (code, signal) => { clearTimeout(timer); if (finished) return; finished = true;
        if (signal === 'SIGKILL' && ['domain_claim', 'queue_claim'].includes(mode)) done({ killed: true });
        else if (code === 0 && output) done(output); else fail(new HarnessError('Isolated probe exited without evidence: ' + mode));
      });
      child.send({ type: 'probe', config: { backend: join(bundle, 'backend'), profile, databaseUrl: `postgresql://orchestra_desktop_runtime:${vault.runtime}@127.0.0.1:${port}/orchestra?schema=public`, secrets: vault.installation, projectId, mode, ...extra } });
    });
    return completion;
  };
  try {
    host = launch(process.execPath, [join(options.dist, 'src/desktop/native-host.js')], ['ignore', 'ignore', 'ignore', 'ipc']);
    await new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new HarnessError('Native bootstrap timeout.')), 180_000);
      const settle = callback => { clearTimeout(timer); callback(); };
      host.on('message', event => {
        if (event?.type === 'authority') authority = event.value;
        else if (event?.type === 'ready') settle(done);
        else if (event?.type === 'failed') settle(() => fail(new HarnessError('Native bootstrap failed.')));
        else if (event?.type === 'result') pending.get(event.id)?.(event.result);
      });
      host.once('error', () => settle(() => fail(new HarnessError('Native host launch failed.'))));
      host.once('exit', () => settle(() => fail(new HarnessError('Native host exited before readiness.'))));
      host.send({ type: 'initialize', config: { root: profile, bundle, vault } });
    });
    const project = await command({ operation: 'workspace.create', name: 'Synthetic isolated AI recovery fixture' });
    projectId = project.id;
    requireThat(/^[0-9a-f-]{36}$/.test(projectId), 'Fixture workspace ID missing.');
    const document = await api(`/v1/projects/${projectId}/documents/upload`, 'POST', {
      kind: 'reference', title: 'Northstar CSV Recovery Specification', visibility: 'internal', sourceLabel: 'Synthetic recovery fixture', makePrimaryLiveDoc: false,
      pastedText: '# Northstar CSV Recovery Specification\nSynthetic fixture, not a real customer record.\nNorthstar CSV export contains exactly item_id, title, owner, status, in that order. Empty projects download a header row only. PDF export is excluded. A launch date is not yet approved.'
    });
    for (let attempt = 0; attempt < 180; attempt++) {
      const current = await api(`/v1/projects/${projectId}/documents/${document.documentId}`);
      if (['ready', 'partial'].includes(current.parseStatus)) break;
      requireThat(current.parseStatus !== 'failed' && attempt < 179, 'Synthetic document parsing did not complete.');
      await delay(250);
    }
    port = Number((await readFile(join(profile, 'postgres/postmaster.pid'), 'utf8')).split('\n')[3]);
    requireThat(Number.isInteger(port) && port > 1023 && port < 65536, 'Owned PostgreSQL port invalid.');
    // Drain the actual offline ingestion worker before switching supervisors.
    // Otherwise a project/indexing job could be claimed by the research probe.
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((await probe('inspect')).result.pendingJobCount === 0) break;
      requireThat(attempt < 99, 'Offline fixture jobs did not drain.');
      await delay(200);
    }
    // Normal native shutdown first. Only then run the owned PostgreSQL cluster
    // directly so the host's offline worker cannot race our claimed-job probes.
    await new Promise((done, fail) => { const timer = setTimeout(() => fail(new HarnessError('Native fixture shutdown timeout.')), 30_000); host.once('exit', code => { clearTimeout(timer); code === 0 ? done() : fail(new HarnessError('Native fixture did not stop cleanly.')); }); host.send({ type: 'shutdown' }); });
    authority = undefined;
    requireThat((await readFile(join(profile, 'postgres/.orchestra-owned'), 'utf8')).trim() === 'orchestra-native-v1', 'Owned cluster marker missing.');
    const startPostgres = async () => {
      // Reuse production ownership watchdog: a SIGKILL of this qualifier closes
      // its IPC pipe, which shuts down only this fixture's PostgreSQL process.
      postgres = launch(process.execPath, [join(options.dist, 'src/desktop/postgres-watchdog.js')], ['ignore', 'ignore', 'ignore', 'ipc']);
      postgres.send({ executable: join(bundle, 'native/pgsql/bin/postgres'), cluster: join(profile, 'postgres'), port });
      for (let attempt = 0; attempt < 100; attempt++) {
        requireThat(postgres.exitCode === null && postgres.signalCode === null, 'Owned PostgreSQL failed to start.');
        try { const value = await probe('inspect'); if (value.result) return; } catch { /* owned DB still starting */ }
        await delay(100);
      }
      throw new HarnessError('Owned PostgreSQL readiness timeout.');
    };
    stage = 'owned_postgres'; await startPostgres();
    stage = 'fixture_seed'; const seeded = (await probe('seed')).result;
    const baseline = seeded.state; report.results.baseline = baseline;
    check('accepted_baseline_present', baseline.acceptedCount >= 1);
    const queuedJob = baseline.jobs.find(job => job.runId === seeded.queuedRunId);
    requireThat(queuedJob, 'Durable queue fixture missing.');
    stage = 'sigkill_claimed_workers';
    for (const [mode, runId] of [['domain_claim', seeded.domainRunId], ['queue_claim', seeded.queuedRunId]]) {
      let claimed = false;
      await probe(mode, { runId }, (event, child) => { if (event?.type === 'claimed') { claimed = true; child.kill('SIGKILL'); } });
      check(mode + '_sigkill_after_production_claim', claimed);
    }
    const killed = (await probe('inspect')).result; report.results.afterKill = killed;
    check('domain_lease_durable_after_sigkill', killed.runs.find(run => run.id === seeded.domainRunId)?.status === 'running');
    check('queue_claim_durable_handler_effect_rolled_back', killed.jobs.find(job => job.id === queuedJob.id)?.status === 'running' && killed.runs.find(run => run.id === seeded.queuedRunId)?.status === 'queued');
    const stillLive = (await probe('reconcile_queue')).result;
    check('unexpired_queue_lease_not_stolen', stillLive.jobs.find(job => job.id === queuedJob.id)?.status === 'running');
    stage = 'chat_failure_and_cancel';
    const first = await probe('chat_clean');
    const failed = await probe('chat_failure', { sessionId: first.result.sessionId });
    const cancelled = await probe('chat_cancel', { sessionId: first.result.sessionId }, (event, child) => { if (event?.type === 'streaming') child.send({ type: 'cancel' }); });
    const recovered = await probe('chat_clean', { sessionId: first.result.sessionId });
    for (const [name, value] of [['clean', first], ['providerFailure', failed], ['cancelled', cancelled], ['subsequentClean', recovered]]) {
      report.results[name] = value;
      check('mock_stream_invoked_' + name, value.counters.mockStreams === 1 && value.counters.fetchAttempts === 0);
    }
    check('earlier_chat_survives_failure_and_cancel', preservedEarlierMessages(first.result.state.messages, recovered.result.state.messages));
    check('cancelled_turn_explicit', cancelled.result.cancelled);
    check('provider_failure_fallback_explicit', failed.result.degraded === true);
    stage = 'real_queue_expiry';
    const queueExpiry = killed.jobs.find(job => job.id === queuedJob.id).leaseUntil;
    requireThat(Number.isFinite(queueExpiry), 'Durable queue lease time missing.');
    await delay(Math.max(0, queueExpiry - Date.now() + 150));
    const expiredQueue = (await probe('reconcile_queue')).result; report.results.expiredQueue = expiredQueue;
    check('real_queue_lease_expiry_explicit_failure', expiredQueue.jobs.find(job => job.id === queuedJob.id)?.failureCode === 'worker_lease_expired' && expiredQueue.runs.find(run => run.id === seeded.queuedRunId)?.status === 'failed');
    stage = 'explicit_retry_and_duplicate';
    const retry = await probe('retry_queue', { jobId: queuedJob.id }); report.results.retry = retry;
    check('retry_one_report_and_one_completion_audit', retry.result.after.completionAudits - baseline.completionAudits === 1 && retry.result.after.runs.filter(run => run.status === 'completed').length === 1 && retry.counters.mockObjects === 1);
    check('duplicate_queue_and_domain_dispatch_no_second_effect', retry.result.duplicateStable);
    stage = 'real_domain_expiry';
    const domainExpiry = killed.runs.find(run => run.id === seeded.domainRunId).leaseExpiresAt;
    requireThat(Number.isFinite(domainExpiry), 'Durable research domain lease time missing.');
    console.log(JSON.stringify({ stage, waitingRealLeaseMs: Math.max(0, domainExpiry - Date.now()) }));
    await delay(Math.max(0, domainExpiry - Date.now() + 150));
    const expiredDomain = (await probe('expire_domain', { runId: seeded.domainRunId })).result; report.results.expiredDomain = { state: expiredDomain.state };
    check('real_domain_lease_expiry_explicit_failure', expiredDomain.dto.status === 'failed' && expiredDomain.state.runs.find(run => run.id === seeded.domainRunId)?.errorPresent);
    stage = 'restart_and_integrity';
    const beforeRestart = (await probe('inspect')).result;
    await stopChild(postgres, 'SIGINT'); await startPostgres();
    const afterRestart = (await probe('inspect')).result; report.results.afterRestart = afterRestart;
    check('native_database_restart_preserves_captured_recovery_snapshot', digest(beforeRestart) === digest(afterRestart));
    check('accepted_artifacts_and_accepted_proposals_unchanged', baseline.acceptedHash === afterRestart.acceptedHash && baseline.proposalsHash === afterRestart.proposalsHash);
    check('source_document_and_chunks_unchanged', baseline.documentHash === afterRestart.documentHash);
    check('no_running_research_queue_or_chat_placeholder', afterRestart.runs.every(run => run.status !== 'running') && afterRestart.jobs.every(job => job.status !== 'running') && afterRestart.messages.every(message => message.responseStatus !== 'streaming'));
    check('zero_recorded_external_ai_limiter_events', afterRestart.providerRequests === 0);
    check('relevant_source_and_compiled_files_unchanged', digest(build) === digest(await buildEvidence(options)));
    report.passed = true;
  } catch (error) {
    report.failure = { stage, reason: error instanceof HarnessError ? error.message : 'Isolated recovery qualification failed (details withheld).' };
  } finally {
    for (const child of [...children]) {
      try { await stopChild(child, child === postgres ? 'SIGINT' : 'SIGTERM'); } catch { report.passed = false; report.shutdownFailed = true; }
    }
    report.fixtureBytes = await fixtureBytes(directory);
    report.checks.push({ name: 'private_fixture_below_500mb', passed: report.fixtureBytes < 500 * 1024 * 1024 });
    report.passed &&= report.fixtureBytes < 500 * 1024 * 1024;
    report.finishedAt = new Date().toISOString();
    const reportPath = join(directory, 'report.json');
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, reportPath, failure: report.failure ?? null }));
  }
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--help')) console.log('Usage: node scripts/desktop/qualify-isolated-ai-recovery.mjs [--bundle /absolute/runtime] [--backend-dist /absolute/dist]\nFresh private fixture; real SIGKILL and real 30/120-second leases; synthetic transports; zero real AI requests.');
  else try { const report = await runRecovery(parseRecoveryArgs(process.argv.slice(2))); if (!report.passed) process.exitCode = 1; }
  catch (error) { console.error(error instanceof HarnessError ? error.message : 'Recovery harness initialization failed (details withheld).'); process.exitCode = 1; }
}
