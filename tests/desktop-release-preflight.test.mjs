import test from 'node:test';
import assert from 'node:assert/strict';
import { assessSignature, inspectMacSigning } from '../scripts/desktop/release-preflight.mjs';

const expected = { teamId: 'ABCDEFGHIJ', bundleId: 'dev.orchestra.desktop' };
const valid = 'Identifier=dev.orchestra.desktop\nCodeDirectory v=20500 size=100 flags=0x10000(runtime) hashes=10\nAuthority=Developer ID Application: Example (ABCDEFGHIJ)\nTeamIdentifier=ABCDEFGHIJ\nCDHash=0123456789012345678901234567890123456789\n';
test('accepts only the expected Developer ID identity with hardened runtime', () => {
  assert.deepEqual(assessSignature(valid, expected).failures, []);
});
for (const [label, text] of [
  ['ad-hoc', valid.replace('Authority=Developer ID Application: Example (ABCDEFGHIJ)', 'Signature=adhoc')],
  ['development', valid.replace('Developer ID Application:', 'Apple Development:')],
  ['wrong team', valid.replace('TeamIdentifier=ABCDEFGHIJ', 'TeamIdentifier=OTHERTEAM1')],
  ['wrong bundle', valid.replace('Identifier=dev.orchestra.desktop', 'Identifier=dev.orchestra.desktop.internal')],
  ['no runtime', valid.replace('flags=0x10000(runtime)', 'flags=0x0(none)')],
  ['no code hash', valid.replace(/CDHash=.*\n/, '')],
  ['duplicate identity', valid + 'Identifier=another.bundle\n'],
]) test(`rejects ${label}`, () => assert.ok(assessSignature(text, expected).failures.length));

test('reports a failed signature verification even when metadata looks valid', async () => {
  const calls = [];
  const result = await inspectMacSigning('/tmp/Orchestra.app', expected, async (file, args) => {
    calls.push([file, args]);
    if (args.includes('--verify')) throw new Error('seal invalid');
    return { stdout: '', stderr: valid };
  });
  assert.equal(result.signingVerified, false);
  assert.equal(result.checks.signatureSeal.status, 'failed');
  assert.equal(result.releaseReady, false);
  assert.equal(calls.length, 4);
});
test('requires Gatekeeper and stapling, not just codesign', async () => {
  const result = await inspectMacSigning('/tmp/Orchestra.app', expected, async (file) => {
    if (file.endsWith('spctl') || file.endsWith('xcrun')) throw new Error('not notarized');
    return { stdout: '', stderr: valid };
  });
  assert.equal(result.signingVerified, false);
  assert.equal(result.checks.gatekeeper.status, 'failed');
  assert.equal(result.checks.stapledTicket.status, 'failed');
});
test('successful signing alone never certifies the product release', async () => {
  const result = await inspectMacSigning('/tmp/Orchestra.app', expected, async () => ({ stdout: '', stderr: valid }));
  assert.equal(result.signingVerified, true);
  assert.equal(result.releaseReady, false);
});
test('rejects malformed identity configuration before running programs', async () => {
  await assert.rejects(inspectMacSigning('/tmp/Orchestra.app', { ...expected, teamId: '' }, () => assert.fail('must not execute')));
});
