// Smoke the exact internal package with a fresh, offline synthetic profile.
// The research transport is replayed; its statistics and exports are generated
// by the candidate's actual bundled backend. No model or connector credentials.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {_electron} from '../../apps/beta-web/node_modules/playwright/index.mjs';
import {PDFParse} from 'pdf-parse';
import {createDesktopSmokePdf} from './pdf-fixtures.mjs';

const [candidate, commit, tree] = process.argv.slice(2);
assert(candidate?.endsWith('/Orchestra Desktop Internal.app'), 'Pass the exact just-built app path');
assert(/^[a-f0-9]{40}$/.test(commit ?? '') && /^[a-f0-9]{40}$/.test(tree ?? ''), 'Pass the source commit and tree from the clean build');
const appPath = resolve(candidate);
const resources = join(appPath, 'Contents/Resources');
const backend = join(resources, 'runtime/backend/dist/src/modules/deep-research');
const imported = name => import(pathToFileURL(join(backend, name)).href);
const [{computeStats, buildDeepResearchSources}, {presentResearchReport}, {renderReportMarkdown, renderReportPdf}] = await Promise.all([
  imported('service.js'), imported('report-copy.js'), imported('report-render.js'),
]);
const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const profile = await mkdtemp('/private/tmp/orch-tier3-');
const source = resolve(import.meta.dirname, '../..');
const lockfiles = ['package-lock.json', ...['desktop', 'beta-web', 'vscode-extension'].map(name => `apps/${name}/package-lock.json`)];
const proof = {
  commit, tree, appPath, profile, checkedAt: new Date().toISOString(),
  scope: 'One Mac; real offline chat and local document; synthetic report transport; actual candidate report renderers; Chromium AX tree, not human VoiceOver qualification.',
  appAsar: await hash(join(resources, 'app.asar')),
  nativeManifest: await hash(join(resources, 'runtime/native-manifest.json')),
  reportRenderer: await hash(join(backend, 'report-render.js')),
  uiEntry: await hash(join(resources, 'runtime/ui/index.html')),
  nativeBuildProvenance: await hash(join(source, '.desktop/native/darwin-arm64/build-provenance.json')),
  npmLockfileSha256: Object.fromEntries(await Promise.all(lockfiles.map(async file => [file, await hash(join(source, file))]))),
  checks: [],
};
const pass = name => { proof.checks.push(name); console.log('PASS', name); };
const app = await _electron.launch({
  executablePath: join(appPath, 'Contents/MacOS/Orchestra Desktop Internal'),
  args: ['--user-data-dir=' + profile],
  env: {PATH: '', TMPDIR: '/private/tmp', HOME: process.env.HOME},
  timeout: 60_000,
});
let phase = 'startup';
try {
  await app.evaluate(({app: electron}) => electron.hide());
  const page = await app.firstWindow();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.name));
  page.setDefaultTimeout(20_000);
  await page.getByRole('checkbox').check({timeout: 60_000});
  await page.getByRole('button', {name: 'Continue locally', exact: true}).click();
  await page.getByLabel('New workspace name').fill('Synthetic Tier 3 qualification');
  await page.getByRole('button', {name: 'Create workspace', exact: true}).click();
  await page.waitForURL('**/memory', {timeout: 60_000});
  const projectId = await page.evaluate(async () => {
    const boot = await window.orchestra.bootstrap();
    if (!boot.ok || boot.data.aiConfigured || boot.data.workspaces.length !== 1) throw Error('Expected a new offline fixture');
    return boot.data.workspaces[0].projectId;
  });
  assert(projectId);

  phase = 'chat';
  const name = 'Desktop-Pilot-Requirements';
  await page.locator('input[type=file]').first().setInputFiles({name: name + '.pdf', mimeType: 'application/pdf', buffer: await createDesktopSmokePdf()});
  await page.getByRole('button', {name: 'Upload', exact: true}).click();
  await page.getByRole('button', {name: 'Open actions for ' + name, exact: true}).waitFor({timeout: 60_000});
  await page.goto('orchestra://app/chat');
  await page.getByRole('button', {name: 'Docs', exact: true}).click();
  const composer = page.getByPlaceholder('Ask Socrates anything about your project…');
  await composer.fill('According to Desktop-Pilot-Requirements, when is the pilot launch? Cite the document.');
  await composer.press('Enter');
  await page.waitForURL(/\/chat\/[a-f0-9-]{36}/, {timeout: 60_000});
  const chat = page.url();
  await page.getByRole('status', {name: 'Answer limitations'}).waitFor({timeout: 60_000});
  await page.reload();
  const link = page.getByRole('link', {name: /Open document:/});
  const warning = page.getByRole('status', {name: 'Answer limitations'});
  await link.waitFor();
  assert.equal(await page.locator('a[href^="/memory/docs/"]').count(), 1);
  assert.match(await warning.innerText(), /Evidence-only fallback/i);
  assert.equal(await page.getByText('Evidence-only fallback', {exact: true}).count(), 1);
  assert.match(await warning.innerText(), /AI synthesis provider is unavailable/i);
  assert.match(await page.locator('.socrates-markdown').last().innerText(), /21 October 2026/);
  const session = await app.context().newCDPSession(page);
  const {nodes} = await session.send('Accessibility.getFullAXTree');
  const sources = nodes.filter(node => !node.ignored && node.role?.value === 'link' && /Open document:/.test(node.name?.value ?? ''));
  assert.equal(sources.length, 1);
  assert.match(sources[0].name.value, /Pilot Requirements|Pilot-Requirements/);
  assert(nodes.some(node => !node.ignored && node.role?.value === 'status' && node.name?.value === 'Answer limitations'));
  await session.detach();
  await link.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  assert(await link.evaluate(el => el === document.activeElement), 'Keyboard traversal must return to the named source');
  await page.keyboard.press('Enter');
  await page.waitForURL(url => url.pathname.startsWith('/memory/docs/') && url.pathname.endsWith('/view'));
  pass('Saved answer has one named source in Chromium AX; keyboard opens the original and fallback stays visible');
  await page.goto(chat);
  await link.waitFor();
  await page.screenshot({path: join(profile, 'socrates.png'), animations: 'disabled', timeout: 15_000});

  phase = 'research';
  const card = (id, kind, title) => ({
    sourceType: kind, evidenceId: id, title, excerpt: title,
    openTarget: {targetType: 'github_evidence', targetRef: {evidenceId: id}},
    citationRef: {type: kind, id},
  });
  const pr = card(randomUUID(), 'github_evidence', 'PR #12: export checks');
  const commitEvidence = card(randomUUID(), 'github_commit', 'Implement export check');
  const cards = [pr, commitEvidence, {...commitEvidence, evidenceId: randomUUID()}, pr];
  const rawReport = {
    executiveSummary: 'PR #12 and one commit identify the export check [E1] [E2]. No acceptedDecisionReferences were supplied.',
    findings: [], marketContext: [], expansionOpportunities: [], recommendedActions: [],
    stats: computeStats(cards, [], Date.now()), sources: buildDeepResearchSources(cards, []),
  };
  assert.equal(rawReport.stats.commits, 2);
  assert.equal(rawReport.stats.slackMessages, 0);
  assert.deepEqual(rawReport.sources.map(source => source.refs), [['E1','E4'], ['E2','E3']]);
  const focus = 'Synthetic delivery evidence';
  const id = randomUUID();
  const run = {
    id, projectId, status: 'completed', researchFocus: focus, sources: ['github'],
    outputFormat: 'full_report', privacyMode: 'internal_only', webSearchRequested: false, webSearchUsed: false,
    progress: {percent: 100, stage: 'completed'}, results: presentResearchReport(rawReport), error: null,
    createdAt: new Date().toISOString(), completedAt: new Date().toISOString(),
  };
  // Open the saved-report route directly. Replay only its GET inside the
  // synthetic renderer; the app remains offline and no run is started.
  await page.addInitScript(({run, path}) => {
    const realFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input, location.href);
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      if (url.protocol === 'orchestra:' && url.host === 'app' && url.pathname === path && method === 'GET') {
        return Promise.resolve(Response.json({data: run}));
      }
      return realFetch(input, init);
    };
  }, {run, path: `/v1/projects/${projectId}/deep-research/${id}`});
  await page.goto(`${chat}?researchRun=${id}`);
  const dialog = page.getByRole('dialog');
  await dialog.getByText(/2 GitHub records/).waitFor();
  const research = await dialog.innerText();
  assert(!/2 commits|acceptedDecisionReferences/.test(research));
  assert.match(research, /No recorded decision references were supplied/i);
  const markdown = renderReportMarkdown(focus, rawReport);
  const pdf = new PDFParse({data: await renderReportPdf(focus, rawReport)});
  try {
    for (const text of [markdown, (await pdf.getText()).text]) {
      assert.match(text, /2 GitHub records/);
      assert(!/2 commits|acceptedDecisionReferences/.test(text));
    }
  } finally { await pdf.destroy(); }
  await page.screenshot({path: join(profile, 'research.png'), animations: 'disabled', timeout: 15_000});
  assert.deepEqual(pageErrors, []);
  pass('One PR plus one commit with duplicate references shows two GitHub records in the packaged report, Markdown and PDF');
} catch (error) {
  proof.failure = {phase, message: String(error.message).slice(0, 400)};
  throw error;
} finally {
  await writeFile(join(profile, 'verification.json'), JSON.stringify(proof, null, 2) + '\n', {mode: 0o600});
  console.log('Evidence:', join(profile, 'verification.json'));
  await app.close();
}
