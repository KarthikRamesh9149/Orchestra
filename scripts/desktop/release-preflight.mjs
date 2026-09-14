// Read-only signing preflight. This does not sign, upload, install or certify a release.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const execute = promisify(execFile);
function validateExpected(expected) {
  if (!/^[A-Z0-9]{10}$/.test(expected.teamId ?? '') ||
      !/^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z0-9-]+)+$/.test(expected.bundleId ?? '')) {
    throw new Error('Explicit valid expected Team ID and bundle ID are required');
  }
}

export function assessSignature(text, expected) {
  validateExpected(expected);
  const failures = [];
  const one = key => {
    const rows = text.split('\n').filter(line => line.startsWith(`${key}=`));
    if (rows.length !== 1) failures.push(`Missing or ambiguous ${key}`);
    return rows.length === 1 ? rows[0].slice(key.length + 1).trim() : null;
  };
  const bundleId = one('Identifier');
  const teamId = one('TeamIdentifier');
  const cdHash = one('CDHash');
  if (bundleId !== expected.bundleId) failures.push('Unexpected bundle identity');
  if (teamId !== expected.teamId) failures.push('Unexpected signing team');
  if (!/^[a-f0-9]{40,64}$/i.test(cdHash ?? '')) failures.push('Missing valid code-directory hash');
  const authorities = text.split('\n').filter(line => line.startsWith('Authority='));
  if (!authorities[0]?.startsWith('Authority=Developer ID Application:') ||
      !authorities[0]?.endsWith(`(${expected.teamId})`)) failures.push('Developer ID Application distribution signature required');
  if (!/^CodeDirectory .*flags=0x[0-9a-f]+\([^\n)]*\bruntime\b[^\n)]*\)/im.test(text)) failures.push('Hardened runtime required');
  return { bundleId, teamId, cdHash, failures };
}

export async function inspectMacSigning(app, expected, run = execute) {
  validateExpected(expected);
  const checks = {};
  let identity = null;
  const check = async (name, command, args, inspect) => {
    try {
      const output = await run(command, args, { timeout: 60_000, maxBuffer: 1024 * 1024, encoding: 'utf8' });
      if (inspect) {
        identity = assessSignature(`${output.stdout ?? ''}\n${output.stderr ?? ''}`, expected);
        if (identity.failures.length) {
          checks[name] = { status: 'failed', reasons: identity.failures };
          return;
        }
      }
      checks[name] = { status: 'passed' };
    } catch {
      // Do not copy arbitrary tool output, filesystem contents or environment values into release evidence.
      checks[name] = { status: 'failed', reasons: ['Verification command failed or timed out'] };
    }
  };
  await check('signatureSeal', '/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  await check('distributionIdentity', '/usr/bin/codesign', ['--display', '--verbose=4', app], true);
  await check('gatekeeper', '/usr/sbin/spctl', ['--assess', '--type', 'execute', app]);
  await check('stapledTicket', '/usr/bin/xcrun', ['stapler', 'validate', app]);
  return {
    formatVersion: 1, checkedAt: new Date().toISOString(), app,
    scope: 'macOS application signing only; not installer, update or product qualification',
    expected, identity, checks,
    signingVerified: Object.values(checks).every(check => check.status === 'passed'),
    releaseReady: false,
    remaining: ['Exact installer/update artifact qualification', 'Packaged security, recovery and performance gates', 'Publication approval'],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.platform !== 'darwin') throw new Error('Run signing preflight on macOS');
    const [input, teamId, bundleId, ...extra] = process.argv.slice(2);
    if (!input || extra.length) throw new Error('Usage: node scripts/desktop/release-preflight.mjs APP TEAM_ID BUNDLE_ID');
    validateExpected({ teamId, bundleId });
    const app = await realpath(input);
    if (!app.endsWith('.app') || !(await lstat(app)).isDirectory()) throw new Error('An existing .app bundle is required');
    const report = await inspectMacSigning(app, { teamId, bundleId });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.signingVerified ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Signing preflight failed');
    process.exitCode = 1;
  }
}
