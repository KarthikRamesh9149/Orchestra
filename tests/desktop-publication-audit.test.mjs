import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectLock, publicationReport} from '../scripts/desktop/publication-audit.mjs';
import {resolve} from 'node:path';

test('missing and restrictive metadata require review without claiming illegality', () => {
  const rows = inspectLock({packages: {'': {}, 'node_modules/a': {version:'1',license:'MIT'},
    'node_modules/b': {version:'1'}, 'node_modules/c': {version:'1',license:'AGPL-3.0'}}}, 'lock');
  assert.deepEqual(rows.map(row => row.requiresReview), [false,true,true]);
  assert.equal(rows.length,3);
});
test('non-registry sources are separately visible and resolved URLs are not emitted', () => {
  const [row] = inspectLock({packages: {a: {resolved:'https://private.example/pkg?token=fixture'}}}, 'lock');
  assert.equal(row.nonRegistrySource,true);
  assert.equal(JSON.stringify(row).includes('token='),false);
});
test('repository audit cannot certify a public release', () => {
  const report = publicationReport(resolve(import.meta.dirname,'..'));
  assert.equal(report.releaseReady,false);
  assert.ok(report.blockers.length >= 5);
  assert.match(report.firstPartyLicense,/Apache-2.0/);
  assert.ok(report.dependencies > 100);
  assert.match(report.sourceHead,/^[a-f0-9]{40}$/);
});
