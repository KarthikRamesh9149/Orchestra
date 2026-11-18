// Content-free timings from one already populated, isolated Mac profile.
import { _electron } from '../../apps/beta-web/node_modules/playwright/index.mjs';
import { access } from 'node:fs/promises';
import { cpus } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const [packagePath, profile, count = '20'] = process.argv.slice(2);
assert(packagePath?.endsWith('/Orchestra Desktop Internal.app'));
assert(/^\/private\/tmp\/orchestra-packaged-ai-[A-Za-z0-9]+\/profile$/.test(profile ?? ''), 'Use only the synthetic qualification profile.');
assert(/^[1-9]\d?$/.test(count) && +count <= 20);
await assert.rejects(access(join(profile, 'local-runtime/provider-settings.enc')), { code: 'ENOENT' });
const samples = [], routes = [];
const p95 = measurements => [...measurements].sort((a, b) => a - b)[Math.ceil(measurements.length * .95) - 1];
for (let n = 0; n < +count; n++) {
  const start = performance.now();
  const app = await _electron.launch({
    executablePath: join(resolve(packagePath), 'Contents/MacOS/Orchestra Desktop Internal'),
    args: ['--user-data-dir=' + profile, '--disable-renderer-backgrounding'],
    env: { PATH: '', HOME: process.env.HOME, TMPDIR: process.env.TMPDIR ?? '/private/tmp' },
    timeout: 45000
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ app }) => app.hide());
    const firstWindowMs = performance.now() - start;
    const observed = await page.evaluate(async () => {
      const start = performance.now();
      while (performance.now() - start < 30000) {
        const status = await window.orchestra.status();
        if (status.state === 'ready') return { status, rendererMs: performance.now() };
        if (status.state === 'failed') throw Error(status.message);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw Error('Desktop runtime did not become ready');
    });
    await page.waitForURL('**/memory', { timeout: 30000 });
    const row = page.getByRole('button', { name: /^Open actions for / }).first();
    await row.waitFor({ timeout: 10000 });
    const usableMs = performance.now() - start;
    samples.push({ firstWindowMs, usableMs, rendererReadyMs: observed.rendererMs, startup: observed.status.startup });
    if (n === +count - 1) for (let i = 0; i < 30; i++) {
      for (const route of ['Chat', 'Memory']) {
        const begin = performance.now();
        await page.getByRole('button', { name: route, exact: true }).click();
        if (route === 'Memory') await row.waitFor();
        else await page.getByRole('textbox').and(page.getByPlaceholder('Ask Socrates anything about your project…')).waitFor();
        routes.push(performance.now() - begin);
      }
    }
  } finally {
    await app.close();
  }
}
console.log(JSON.stringify({ hardware: cpus()[0]?.model, app: packagePath, profile, samples, routes,
  processColdP95Ms: p95(samples.map(sample => sample.usableMs)), warmRouteP95Ms: p95(routes) }));
