// Read one exact packaged Mac artifact. No source-tree notices are substituted.
import {readFile, readdir, lstat, realpath} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {basename, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inventoryNotices} from './bundled-notices.mjs';
import {NOTICE_MANIFEST, NOTICE_TEXT, renderBuildNotices, sha256} from './build-notices.mjs';
import {validateFontAttribution} from './font-attribution.mjs';

function safePath(path) {
  if (!path || isAbsolute(path) || path.split(/[\\/]/).some(p => p === '..' || p === '.')) throw new Error('Unsafe notice path');
  return path;
}
async function confinedFile(root, path) {
  const file = join(root, safePath(path)), actual = await realpath(file), rel = relative(root, actual);
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('Notice path escapes artifact');
  if (!(await lstat(file)).isFile()) throw new Error('Notice must be a regular file');
  return readFile(file);
}

export async function aggregateArtifactNotices(input, {includeText = false} = {}) {
  const root = await realpath(input), apps = (await readdir(root)).filter(n => n.endsWith('.app'));
  if (apps.length !== 1) throw new Error('Expected one packaged Mac .app; other targets remain unqualified');
  const resources = `${apps[0]}/Contents/Resources`, runtime = `${resources}/runtime`;
  const read = path => confinedFile(root, path);
  const notices = new Map(), integrityErrors = [], gaps = [];
  async function evidence(path, {notice = false, expected} = {}) {
    const body = await read(path), item = {path, sha256: sha256(body), bytes: body.length};
    if (expected && expected !== item.sha256) integrityErrors.push(`Hash mismatch: ${path}`);
    if (notice) notices.set(path, {...item, ...(includeText ? {text: body.toString('utf8')} : {})});
    return item;
  }
  const asarPath = `${resources}/app.asar`;
  const identity = {name: basename(root), appAsar: await evidence(asarPath),
    nativeManifest: await evidence(`${runtime}/native-manifest.json`)};
  const electron = [];
  for (const path of ['LICENSE', 'LICENSES.chromium.html']) {
    try {electron.push(await evidence(path, {notice: true}));}
    catch (e) {if (e.code !== 'ENOENT') throw e; gaps.push(`Missing Electron notice: ${path}`);}
  }
  const nativeManifest = JSON.parse((await read(`${runtime}/native-manifest.json`)).toString('utf8'));
  const native = {platform: nativeManifest.platform, node: nativeManifest.node,
    postgres: nativeManifest.postgres, pgvector: nativeManifest.pgvector, notices: []};
  for (const path of ['native/node/LICENSE', 'native/pgsql/POSTGRESQL-LICENSE',
    'native/pgsql/PGVECTOR-LICENSE', 'native/pgsql/OPENSSL-LICENSE']) {
    const entry = nativeManifest.files.find(item => item.path === path);
    if (!entry) gaps.push(`Native notice missing from native manifest: ${path}`);
    try {native.notices.push(await evidence(`${runtime}/${path}`, {notice: true, expected: entry?.sha256}));}
    catch (e) {if (e.code !== 'ENOENT') throw e; gaps.push(`Missing native notice: ${path}`);}
  }
  const modules = `${runtime}/backend/node_modules`;
  const backend = await inventoryNotices(join(root, modules));
  const presentPackages = new Set(backend.packages.map(p => `${p.name}@${p.version}`));
  for (const pkg of backend.packages) for (const item of [...pkg.notices, ...pkg.embeddedNotices]) {
    await evidence(`${modules}/${item.path}`, {notice: true, expected: item.sha256});
  }
  const supplementRoot = `${runtime}/third-party-notices`;
  const manifest = JSON.parse((await read(`${supplementRoot}/manifest.json`)).toString('utf8'));
  const recovered = JSON.parse((await read(`${supplementRoot}/recovered-notices.json`)).toString('utf8'));
  const supplements = [];
  for (const entry of [...manifest, ...recovered.notices]) {
    const actual = await evidence(`${supplementRoot}/${safePath(entry.file)}`, {notice: true, expected: entry.sha256});
    supplements.push({...entry, actualSha256: actual.sha256, hashMatches: actual.sha256 === entry.sha256});
  }
  // Retain component notices too, without treating them as wrapper-license closure.
  for (const name of await readdir(join(root, supplementRoot))) if (name.endsWith('.txt')) {
    await evidence(`${supplementRoot}/${safePath(name)}`, {notice: true});
  }
  const located = new Set(supplements.filter(s => s.hashMatches).map(s => `${s.package}@${s.version}`));
  const unresolvedBackend = backend.unresolvedNoticeLocations.filter(p => !located.has(`${p.name}@${p.version}`));
  let componentSupplements = [];
  try {componentSupplements = JSON.parse((await read(`${supplementRoot}/component-supplements.json`)).toString('utf8'));}
  catch (e) {if (e.code !== 'ENOENT') throw e;}
  for (const entry of componentSupplements) await evidence(`${supplementRoot}/${safePath(entry.file)}`, {notice: true, expected: entry.sha256});
  try {
    const unicode = JSON.parse((await read(`${supplementRoot}/unicode-tr46.json`)).toString('utf8'));
    await evidence(`${supplementRoot}/${safePath(unicode.notice)}`, {notice: true, expected: unicode.noticeSha256});
  } catch (e) {if (e.code !== 'ENOENT') throw e;}

  // Exact, declared font-data transformation, not a generic checksum exception.
  // All evidence comes from this artifact; original npm installations are never read.
  let fontAttribution = null;
  const pdfComponentNotices = [];
  if (presentPackages.has('@pdf-lib/standard-fonts@1.0.0')) {
    try {
      const path = `${runtime}/font-attribution-transform.json`;
      const report = JSON.parse((await read(path)).toString('utf8'));
      const specificationPath = `${supplementRoot}/pdf-standard-fonts-transform.json`;
      await evidence(specificationPath);
      const verified = await validateFontAttribution({modules: join(root, modules),
        specificationPath: join(root, specificationPath), report});
      fontAttribution = {...await evidence(path), ...verified, report};
      const packet = JSON.parse((await read(`${supplementRoot}/pdf-notices.json`)).toString('utf8'));
      if (packet.formatVersion !== 1 || !Array.isArray(packet.notices) || packet.notices.length !== 10) throw new Error('Invalid PDF component notice packet');
      for (const entry of packet.notices) {
        if (!presentPackages.has(`${entry.package}@${entry.version}`)) throw new Error('PDF notice package identity mismatch');
        const actual = await evidence(`${supplementRoot}/${safePath(entry.file)}`, {notice: true, expected: entry.sha256});
        pdfComponentNotices.push({...entry, actualSha256: actual.sha256, hashMatches: actual.sha256 === entry.sha256});
      }
    } catch (error) {
      integrityErrors.push(`Font attribution validation failed: ${error.message}`);
    }
  }

  const require = createRequire(new URL('../../apps/desktop/package.json', import.meta.url));
  const asar = await import(pathToFileURL(require.resolve('@electron/asar')).href);
  function readAsar(path) {
    safePath(path);
    const stat = asar.statFile(join(root, asarPath), path, false);
    if (stat.link || stat.unpacked || stat.files) throw new Error('Notice evidence must be stored inside app.asar');
    return asar.extractFile(join(root, asarPath), path);
  }
  const builds = [];
  for (const target of ['desktop', 'frontend']) {
    const prefix = target === 'desktop' ? 'dist' : `${runtime}/ui`;
    const reader = target === 'desktop' ? async path => readAsar(path) : read;
    let body;
    try {body = await reader(`${prefix}/${NOTICE_MANIFEST}`);}
    catch (e) {
      // asar reports missing files with a generic error, not ENOENT.
      if (e.code !== 'ENOENT' && !/not found|Cannot read properties of undefined/i.test(e.message)) throw e;
      gaps.push(`Missing ${target} build notice manifest; flattened dependencies are unaccounted`); continue;
    }
    const report = JSON.parse(body.toString('utf8'));
    if (report.formatVersion !== 1 || !Array.isArray(report.outputs) || !Array.isArray(report.packages)) throw new Error('Invalid build notice manifest');
    const outputEvidence = [];
    for (const output of report.outputs) {
      const path = `${prefix}/${safePath(output.path)}`, bytes = await reader(path);
      const hash = sha256(bytes);
      if (hash !== output.sha256) integrityErrors.push(`Stale ${target} build manifest: ${output.path}`);
      outputEvidence.push({path: output.path, sha256: hash, bytes: bytes.length});
    }
    const text = await reader(`${prefix}/${NOTICE_TEXT}`);
    if (text.toString('utf8') !== renderBuildNotices(report)) integrityErrors.push(`Stale ${target} aggregated notice text`);
    const textPath = target === 'desktop' ? `app.asar!/${prefix}/${NOTICE_TEXT}` : `${prefix}/${NOTICE_TEXT}`;
    notices.set(textPath, {path: textPath, sha256: sha256(text), bytes: text.length, ...(includeText ? {text: text.toString('utf8')} : {})});
    builds.push({target, manifestSha256: sha256(body), outputs: outputEvidence,
      packages: report.packages.map(({notices, references, componentNotices = [], ...p}) => ({...p,
        notices: notices.map(({text, ...n}) => n), references: references.map(({text, ...n}) => n),
        componentNotices: componentNotices.map(({text, ...n}) => n)})),
      missingNoticeLocations: report.missingNoticeLocations, componentReviewRequired: report.componentReviewRequired});
  }
  return {formatVersion: 1, complete: false, identity, electron, native,
    backend: {...backend, unresolvedAfterSupplementalNotices: unresolvedBackend},
    supplementalNotices: supplements, componentSupplements, pdfComponentNotices, fontAttribution,
    declaredUnresolved: recovered.unresolved.filter(name => presentPackages.has(name)),
    historicalUnresolvedNotBundled: recovered.unresolved.filter(name => !presentPackages.has(name)), builds,
    notices: [...notices.values()].sort((a,b) => a.path.localeCompare(b.path, 'en')), integrityErrors, gaps,
    limitations: ['An exact-artifact aggregation, not public-distribution approval',
      'Package-root notices do not settle generated-code, native-transitive, icon, design or trademark obligations',
      'Native binary hashes/signing and backend source identity are covered by separate release gates',
      'Old artifacts are never backfilled with newer source-tree notices by this checker']};
}

export function renderArtifactNotices(report) {
  return ['Exact artifact third-party notice aggregate', JSON.stringify({identity: report.identity,
    complete: false, gaps: report.gaps, integrityErrors: report.integrityErrors}),
    ...report.notices.map(item => `\n--- ${item.path} [sha256 ${item.sha256}] ---\n${item.text ?? '[text not requested]'}`)].join('\n\n') + '\n';
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, mode] = process.argv.slice(2);
  if (!input || (mode && mode !== '--text')) throw new Error('Usage: node scripts/desktop/artifact-notices.mjs PACKAGER_OUTPUT [--text]');
  const report = await aggregateArtifactNotices(input, {includeText: mode === '--text'});
  console.log(mode === '--text' ? renderArtifactNotices(report) : JSON.stringify(report, null, 2));
  if (report.integrityErrors.length) process.exitCode = 1;
}
