// Read-only preparation report. Never uploads files or grants publication approval.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export function inspectLock(lock, name) {
  return Object.entries(lock.packages ?? {}).filter(([path]) => path).map(([path, item]) => ({
    lock: name, path, version: item.version ?? null, license: item.license ?? null,
    requiresReview: !item.license || /GPL|AGPL|LGPL|UNKNOWN|UNLICENSED/i.test(item.license),
    nonRegistrySource: !!item.resolved && !item.resolved.startsWith('https://registry.npmjs.org/'),
  }));
}

export function publicationReport(root) {
  const git = args => execFileSync('git', args, {cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
  const files = git(['ls-files', '-z']).split('\0').filter(Boolean);
  const dependencies = ['package-lock.json', 'apps/beta-web/package-lock.json',
    'apps/desktop/package-lock.json', 'apps/vscode-extension/package-lock.json']
    .flatMap(name => inspectLock(JSON.parse(readFileSync(resolve(root, name), 'utf8')), name));
  return {
    formatVersion: 1, sourceHead: git(['rev-parse', 'HEAD']).trim(),
    workingTreeDirty: !!git(['status', '--porcelain']).trim(),
    trackedFiles: files.length, historyCommits: Number(git(['rev-list', '--count', 'HEAD']).trim()),
    dependencies: dependencies.length,
    licenseReview: dependencies.filter(item => item.requiresReview),
    nonRegistrySources: dependencies.filter(item => item.nonRegistrySource),
    sensitiveFilenameReview: files.filter(path => /(^|\/)(\.env($|\.)|.*\.(pem|p12|pfx|key|sqlite|dump|zip)$)/i.test(path)),
    assetReview: files.filter(path => /\.(png|jpe?g|svg|webp|woff2?|ttf|otf|mp4)$/i.test(path)),
    releaseReady: false,
    blockers: ['Owner source and asset rights approval', 'Actual bundled notices review',
      'Explicit repository visibility and release publication approval',
      'Public Mac signing and notarization', 'Independent clean source build and public download qualification',
      'Public provider enrollment and named support owner'],
    limitations: ['Filename and lock metadata only; not content or full history secret scanning',
      'No artifact signature or bundled dependency verification',
      'Internal gate exceptions do not authorize public release'],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(publicationReport(resolve(import.meta.dirname, '../..')), null, 2));
  process.exitCode = 1; // This preparation tool cannot certify publication.
}
