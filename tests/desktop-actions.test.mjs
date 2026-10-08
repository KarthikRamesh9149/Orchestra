import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const workflow=await readFile(new URL('../.github/workflows/desktop-source-checks.yml',import.meta.url),'utf8');
const steps=workflow.split(/^      - name: /m).slice(1);

test('manual source verification has bounded read-only runners and no publication authority',()=>{
  assert.match(workflow,/^on:\n  workflow_dispatch:\s*\n/m);
  assert.doesNotMatch(workflow,/^  (push|pull_request|schedule|pull_request_target):/m);
  assert.match(workflow,/^permissions:\n  contents: read\s*\n/m);
  assert.match(workflow,/runs-on: ubuntu-24\.04/);
  assert.match(workflow,/timeout-minutes: 20/);
  assert.match(workflow,/persist-credentials: false/);
  for(const [,reference] of workflow.matchAll(/^\s+- uses: (\S+)/gm))assert.match(reference,/@[0-9a-f]{40}$/);
  assert.doesNotMatch(workflow,/secrets\.|contents: write|continue-on-error:|self-hosted|upload-artifact@|actions\/cache@/);
  assert.doesNotMatch(steps.join('\n'),/gh release|gh repo|railway|vercel|npm publish/);
});

test('source verification explicitly compiles every Electron entrypoint',()=>{
  assert.match(workflow,/npm --prefix apps\/desktop run typecheck/);
  assert.match(workflow,/npm --prefix apps\/desktop run build/);
  assert.match(workflow,/npm run test:desktop:packaging/);
  assert.match(workflow,/npx --no-install playwright install --with-deps chromium/);
  assert.match(workflow,/npm --prefix apps\/beta-web run test:styles/);
});

test('database migration and recovery checks use only the isolated development fixture',()=>{
  for(const action of ['up','migrate','provision-runtime','test','test-engine','stop'])assert.match(workflow,new RegExp(`node scripts/desktop/dev-db\\.mjs ${action}(?:\\n|$)`));
  const cleanup=steps.find(step=>step.includes('node scripts/desktop/dev-db.mjs stop'));
  assert.match(cleanup,/if: \$\{\{ always\(\) \}\}/);
  assert.doesNotMatch(workflow,/dev-db\.mjs.*(?:reset|down)|docker.*(?:volume rm|system prune)/);
});

test('all four dependency trees and source security checks run independently without masking failure',()=>{
  for(const command of ['npm audit --audit-level=moderate',...['apps/desktop','apps/beta-web','apps/vscode-extension'].map(path=>`npm --prefix ${path} audit --audit-level=moderate`),'npm run security:scan:local','npm run beta:web:no-prod-mocks']){
    const step=steps.find(step=>step.split('\n').some(line=>line.trim()===`run: ${command}`));
    assert(step,`Missing independently reported gate: ${command}`);
    assert.match(step,/if: \$\{\{ !cancelled\(\) \}\}/,command);
    assert.doesNotMatch(step,/\|\| true|continue-on-error:/,command);
  }
});
