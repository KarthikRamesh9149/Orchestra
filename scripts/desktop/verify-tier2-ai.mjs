// Opt-in real-model check on synthetic PDFs and the exact packaged engine.
// The existing credential is decrypted only in Electron main and transferred
// in memory to one disposable native worker. Never write it to its profile.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { lstat, mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function verifyNative(bundle, fixtures, ai) {
  const root = await mkdtemp('/private/tmp/orch-t2-ai-');
  const secret = () => randomBytes(32).toString('hex');
  const vault = { version: 1, admin: secret(), runtime: secret(), installation: {
    version: 1, loopback: secret(), access: secret(), refresh: secret(), connectorEncryption: secret(), oauthState: secret(), clientShare: secret(),
  } };
  const native = fork(join(bundle, 'backend/dist/src/desktop/native-host.js'), [], {
    execPath: join(bundle, 'native/node/bin/node'), cwd: root, execArgv: [],
    env: { PATH: '', TMPDIR: '/private/tmp', NODE_ENV: 'production', LANG: 'C' },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const ready = Promise.withResolvers(), exit = new Promise(resolve => native.once('exit', resolve)), calls = new Map();
  let authority;
  native.on('message', message => {
    if (message.type === 'authority') authority = message.value;
    else if (message.type === 'ready') ready.resolve();
    else if (message.type === 'failed') ready.reject(Error('Packaged native startup failed'));
    else if (message.type === 'result') calls.get(message.id)?.(message.result);
  });
  const request = (command, selection) => new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => { calls.delete(id); reject(Error(command.operation + ' timed out')); }, 30000);
    calls.set(id, response => {
      calls.delete(id); clearTimeout(timer);
      if (response.ok) resolve(response.data);
      else reject(Error(command.operation + ' failed: ' + response.error.code));
    });
    native.send({ type: 'command', id, command, selection });
  });
  try {
    native.send({ type: 'initialize', config: { root, bundle, vault, ai } });
    await Promise.race([ready.promise, new Promise((_, reject) => {
      setTimeout(() => reject(Error('Native readiness timed out')), 30000).unref();
    })]);
    assert(authority);
    const workspace = await request({ operation: 'workspace.create', name: 'Synthetic Helix release qualification' });
    const api = async (path, { method = 'GET', body } = {}) => {
      const response = await fetch(`http://127.0.0.1:${authority.port}/v1/projects/${workspace.id}${path}`, {
        method, signal: AbortSignal.timeout(30000),
        headers: { authorization: 'Bearer ' + authority.bearer, 'x-orchestra-local-token': authority.token, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const payload = await response.json();
      assert(response.ok, `Request ${path.split('/').at(1)} failed: ${response.status} ${payload.error?.code ?? ''}`);
      return payload.data;
    };
    const documents = ['Helix Rollout Decision', 'Helix Customer Request', 'Helix Engineering Note', 'Juniper Exit Runbook', 'Vireo Pilot Readout'];
    for (const title of documents) {
      const fileName = title + '.pdf';
      await request({ operation: 'evidence.upload', projectId: workspace.id, selectionId: randomUUID() }, {
        fileName, contentType: 'application/pdf', base64: (await readFile(join(fixtures, fileName))).toString('base64'),
      });
    }
    let indexed = false;
    for (let n = 0; n < 100; n++) {
      const rows = await api('/documents');
      if (rows.length === documents.length && rows.every(row => (row.currentVersion?.status ?? row.versions?.[0]?.status ?? row.status) === 'ready')) {
        indexed = true; break;
      }
      await pause(350);
    }
    assert(indexed, 'Synthetic documents did not become searchable');
    async function ask(question, selectedSources) {
      const start = performance.now();
      // Use the same versioned stream as Chat.
      const streamed = await fetch(`http://127.0.0.1:${authority.port}/v1/projects/${workspace.id}/socrates/messages/stream/v1`, {
        method: 'POST', headers: { authorization: 'Bearer ' + authority.bearer,
          'x-orchestra-local-token': authority.token, 'content-type': 'application/json' },
        signal: AbortSignal.timeout(60000),
        body: JSON.stringify({ selectedSources, mode: 'ask', question }),
      });
      assert(streamed.ok && streamed.body, 'Socrates streaming request failed: ' + streamed.status);
      const decoder = new TextDecoder();
      let pending = '', answer, firstTextMs;
      for await (const bytes of streamed.body) {
        pending += decoder.decode(bytes, { stream: true });
        let end;
        while ((end = pending.indexOf('\n\n')) >= 0) {
          const frame = pending.slice(0, end); pending = pending.slice(end + 2);
          const event = /^event:\s*(.+)$/m.exec(frame)?.[1], payload = /^data:\s*(.+)$/m.exec(frame)?.[1];
          if (!payload) continue;
          const message = JSON.parse(payload);
          if (event === 'delta' && message.text?.trim()) firstTextMs ??= Math.round(performance.now() - start);
          if (event === 'done') answer = message.data ?? message;
          if (event === 'error') throw Error('Socrates stream reported an error');
        }
      }
      assert(answer?.answer_md && Number.isFinite(firstTextMs), 'Missing streamed answer');
      const answerMs = Math.round(performance.now() - start);
      assert.equal(answer.modelMetadata.provider, 'openai');
      assert.equal(answer.modelMetadata.degraded, false);
      return { answer: answer.answer_md, citations: answer.citations.map(citation => citation.label),
        sourceTypes: answer.citations.map(citation => citation.sourceType),
        firstTextMs, answerMs, retrievalMs: answer.retrievalSummary?.performance?.retrievalMs };
    }
    const retentionQuestion = 'A subscriber leaves. How long do we keep their material and who takes care of getting rid of it?';
    const retention = [];
    for (const scope of ['all', 'documents']) {
      const result = await ask(retentionQuestion, [scope]);
      assert.match(result.answer, /47[\s*]+days/i);
      assert.match(result.answer, /Iona Flint/i);
      assert(result.citations.some(label => label.includes('Juniper Exit Runbook')));
      retention.push({ scope, ...result });
    }
    const sales = await ask('A teammate says Helix has approval for 480 production seats. What should I tell sales today?', ['all']);
    assert.match(sales.answer, /180/);
    assert.match(sales.answer, /480/);
    assert.match(sales.answer, /pending|not approved|not yet approved|request/i);
    assert.doesNotMatch(sales.answer, /Latest timestamped evidence|No elapsed duration is inferred/i);
    assert(sales.citations.some(label => label.includes('Helix Rollout Decision')));
    assert(sales.citations.some(label => label.includes('Helix Customer Request')));
    const timestamp = Math.floor(Date.now() / 1000 - 60) + '.000001';
    await request({ operation: 'desktop.slack.ingest', projectId: workspace.id, teamId: 'TPILOT', teamName: 'Synthetic pilot',
      channel: { id: 'CPILOT', name: 'helix-operations' }, messages: [{ ts: timestamp, threadTs: timestamp,
        user: 'Reviewer', text: 'Helix escalation window is 83 minutes. No change to approved pilot capacity.' }], deletedTimestamps: [],
      snapshot: { oldestMs: Date.now() - 30 * 86400_000, latestMs: Date.now(), complete: true },
    });
    const combined = await ask('Use the Helix Rollout Decision PDF and Slack helix-operations: what is the pilot seat limit and escalation window?', ['all']);
    assert.match(combined.answer, /180/);
    assert.match(combined.answer, /83[\s*]+minutes/i);
    assert(combined.citations.some(label => label.includes('Helix Rollout Decision')));
    assert(combined.sourceTypes.some(type => /slack|communication/i.test(type)), 'Both documents and messages must support the answer');
    const researchStart = performance.now();
    const run = await api('/deep-research', { method: 'POST', body: {
      researchFocus: 'Compare Helix Rollout Decision and Helix Customer Request. Contrast the 180-seat pilot approval with the pending 480-seat request. State whether any actual Orchestra record establishes approval and what sales should confirm before promising production.',
      sources: ['docs'], outputFormat: 'exec_summary', privacyMode: 'internal_only', webSearchEnabled: false,
    } });
    const runPath = '/deep-research/' + run.id;
    let report;
    for (let n = 0; n < 140; n++) {
      report = await api(runPath);
      if (['failed', 'completed'].includes(report.status)) break;
      await pause(450);
    }
    assert.equal(report.status, 'completed', report.error ?? 'Research did not complete');
    assert.match(report.results.executiveSummary, /180/);
    assert.match(report.results.executiveSummary, /480/);
    assert.match(report.results.executiveSummary, /(?:no |not |cannot |can’t |unverified)[^.!?]{0,90}(?:record|approv|authoriz)/i);
    assert(report.results.sources.some(source => source.href?.includes('versionId=')));
    const checked = report.results.recommendedActions[0];
    assert(checked?.id, 'No durable recommended action in the report');
    await api(runPath + '/actions/' + checked.id, { method: 'PUT', body: { completed: true } });
    assert.equal((await api(runPath)).results.recommendedActions[0].completed, true);
    const researchMs = Math.round(performance.now() - researchStart);
    const title = 'Orion evaluation capacity';
    const statement = 'The authorized evaluation cap is 37 test seats. No production rollout is approved.';
    const proposal = await api('/change-proposals', { method: 'POST', body: {
      title, summary: statement, proposalType: 'decision_change', newUnderstanding: { text: statement },
      externalEvidenceRefs: ['synthetic-human-release-review'],
    } });
    const accepted = await api('/change-proposals/' + proposal.id + '/accept', { method: 'POST', body: {} });
    assert.equal(accepted.status, 'accepted');
    assert(accepted.decisionRecordId, 'Acceptance must produce a persisted decision record');
    const actual = await api('/deep-research', { method: 'POST', body: {
      researchFocus: 'What capacity is recorded by the Orion evaluation capacity decision? Cite the accepted record and do not infer production approval.',
      sources: ['decisions'], outputFormat: 'exec_summary', privacyMode: 'internal_only', webSearchEnabled: false,
    } });
    const actualPath = '/deep-research/' + actual.id;
    let completed;
    for (let n = 0; n < 140; n++) {
      completed = await api(actualPath);
      if (['failed', 'completed'].includes(completed.status)) break;
      await pause(450);
    }
    assert.equal(completed.status, 'completed', completed.error ?? 'Decision-scope research did not complete');
    assert.match(completed.results.executiveSummary, /37/);
    const source = completed.results.sources.find(item => item.target?.kind === 'decision_record' && item.target.id === accepted.decisionRecordId);
    assert(source?.ref && completed.results.executiveSummary.includes('[' + source.ref + ']'), 'Summary must cite the accepted decision');
    assert.equal((await api(actualPath + '/sources/' + source.ref)).text, statement);
    return { passed: true, indexedDocuments: documents.length, provider: 'openai', retention, sales, combined, researchMs,
      negativeApproval: report.results.executiveSummary, recordedApproval: completed.results.executiveSummary, recommendationSaved: true };
  } finally {
    if (native.connected) native.send({ type: 'shutdown' });
    await exit;
  }
}

if (process.argv[2] === '--native-worker') {
  assert(process.send);
  const settings = Promise.withResolvers();
  process.once('message', settings.resolve);
  process.send({ readyForSettings: true });
  try {
    process.send?.(await verifyNative(process.argv[3], process.argv[4], await settings.promise));
  } catch (error) {
    process.send?.({ passed: false, error: error.message });
    process.exitCode = 1;
  } finally {
    process.disconnect();
  }
} else {
  const [appPath, fixtures, sourceSettings] = process.argv.slice(2);
  assert(appPath?.endsWith('/Orchestra Desktop Internal.app'));
  assert(fixtures && sourceSettings);
  const info = await lstat(sourceSettings);
  assert(info.isFile() && !info.isSymbolicLink() && !(info.mode & 0o077) && info.size < 32768);
  const { _electron } = await import('../../apps/beta-web/node_modules/playwright/index.mjs');
  const profile = await mkdtemp('/private/tmp/orch-t2-shell-');
  const app = await _electron.launch({
    executablePath: join(appPath, 'Contents/MacOS/Orchestra Desktop Internal'),
    args: ['--user-data-dir=' + profile], timeout: 45000,
  });
  try {
    const result = await app.evaluate(async ({ app, safeStorage }, args) => {
      app.hide();
      const fs = process.getBuiltinModule('fs/promises'), { fork } = process.getBuiltinModule('child_process');
      if (!safeStorage.isEncryptionAvailable() || app.getPath('userData') !== args.profile) throw Error('Qualification profile is not isolated');
      const settings = JSON.parse(safeStorage.decryptString(await fs.readFile(args.sourceSettings)));
      if (!settings.ai?.apiKey || ![undefined, 'openai'].includes(settings.ai.preferences.provider)) throw Error('Existing OpenAI qualification credential unavailable');
      return new Promise((resolve, reject) => {
        const worker = fork(args.entry, ['--native-worker', args.bundle, args.fixtures], {
          execPath: args.node, execArgv: [], cwd: args.profile, env: { PATH: '', TMPDIR: '/private/tmp' },
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        });
        let result;
        const timer = setTimeout(() => { worker.kill('SIGTERM'); reject(Error('AI qualification timed out')); }, 150000);
        worker.on('message', message => {
          if (message.readyForSettings !== true) { result = message; return; }
          worker.send({ apiKey: settings.ai.apiKey, preferences: { provider: 'openai', generationModel: settings.ai.preferences.generationModel,
            embeddingProvider: 'openai', embeddingModel: 'text-embedding-3-small', embeddingDimensions: 1536,
            maxRequestsPerDay: 24, maxOutputTokens: 1536 } });
        });
        worker.once('error', error => { clearTimeout(timer); reject(error); });
        worker.once('exit', () => { clearTimeout(timer); resolve(result ?? { passed: false, error: 'Missing worker result' }); });
      });
    }, { profile, sourceSettings, entry: fileURLToPath(import.meta.url), node: process.execPath, fixtures,
      bundle: join(appPath, 'Contents/Resources/runtime') });
    console.log(JSON.stringify(result));
    if (!result.passed) process.exitCode = 1;
  } finally {
    await app.close();
  }
}
