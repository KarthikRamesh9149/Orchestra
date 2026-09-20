// Build-time evidence only: never import into renderer or native-host code.
import {readFile, readdir, lstat, realpath, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';

export const NOTICE_MANIFEST = 'third-party-notices.json';
export const NOTICE_TEXT = 'THIRD-PARTY-NOTICES.txt';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (root, file) => {
  const path = relative(root, file);
  return path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path);
};
const ordered = values => [...values].sort((a, b) => a.localeCompare(b, 'en'));

// Resolve only modules that contributed bytes to output, not all installed deps.
// Realpath containment prevents a package link from reading outside this checkout.
export async function collectBuildNotices(inputs, {root, cwd = root, outputs = []}) {
  root = await realpath(root);
  const groups = new Map();
  const supplementRoot = join(root, 'docs/desktop/third-party');
  let supplements = [];
  try {supplements = JSON.parse(await readFile(join(supplementRoot, 'component-supplements.json'), 'utf8'));}
  catch (error) {if (error.code !== 'ENOENT') throw error;}
  for (const input of ordered(new Set(inputs))) {
    if (input.includes('\0') || input.startsWith('<')) continue; // bundler virtual module
    const path = resolve(cwd, input.split('?')[0]);
    if (!path.split(sep).includes('node_modules')) continue; // first-party source
    const file = await realpath(path);
    if (!inside(root, file)) throw new Error('Bundled dependency escapes the source root');
    let folder = dirname(file), metadata;
    while (inside(root, folder)) {
      try {
        const bytes = await readFile(join(folder, 'package.json'));
        const candidate = JSON.parse(bytes.toString('utf8'));
        // Some packages have scope-only package.json files (e.g. type:module).
        if (candidate.name && candidate.version) {metadata = candidate; break;}
      } catch (error) {if (error.code !== 'ENOENT') throw error;}
      folder = dirname(folder);
    }
    if (!metadata) throw new Error('Bundled dependency has no package identity');
    if (!groups.has(folder)) groups.set(folder, {metadata, modules: new Map()});
    const body = await readFile(file);
    groups.get(folder).modules.set(relative(folder, file), sha256(body));
  }
  const packages = [];
  for (const folder of ordered(groups.keys())) {
    const {metadata, modules} = groups.get(folder), notices = [], references = [];
    for (const name of ordered(await readdir(folder))) {
      const notice = /^(licen[sc]e|copying|copyright|notice)([.-]|$)/i.test(name);
      const readme = /^readme([.-]|$)/i.test(name);
      if (!notice && !readme) continue;
      const file = join(folder, name);
      if (!(await lstat(file)).isFile()) continue; // no symlink or directory traversal
      const bytes = await readFile(file), text = bytes.toString('utf8');
      const completeEmbeddedMIT = readme && /copyright/i.test(text)
        && /permission is hereby granted/i.test(text) && /THE SOFTWARE IS PROVIDED/i.test(text);
      (notice || completeEmbeddedMIT ? notices : references).push({file: name, sha256: sha256(bytes), bytes: bytes.length, text});
    }
    const componentNotices = [];
    for (const entry of supplements) {
      if (entry.package !== metadata.name || entry.version !== metadata.version) continue;
      if (entry.modulePrefix && ![...modules.keys()].some(m => m.startsWith(entry.modulePrefix))) continue;
      if (!/^[a-z0-9.-]+$/.test(entry.file)) throw new Error('Invalid component notice filename');
      const file = join(supplementRoot, entry.file);
      if (!(await lstat(file)).isFile()) throw new Error('Component notice must be a regular file');
      const bytes = await readFile(file);
      if (sha256(bytes) !== entry.sha256) throw new Error('Component notice hash mismatch');
      componentNotices.push({...entry, bytes: bytes.length, text: bytes.toString('utf8')});
    }
    packages.push({path: relative(root, folder), name: metadata.name, version: metadata.version,
      license: metadata.license ?? null, modules: Object.fromEntries(modules), notices, references, componentNotices});
  }
  return {formatVersion: 1, complete: false, outputs: [...outputs].sort((a,b) => a.path.localeCompare(b.path, 'en')),
    packages, missingNoticeLocations: packages.filter(p => !p.notices.length).map(p => `${p.name}@${p.version}`),
    componentReviewRequired: packages.filter(p => p.name === 'react-icons' || p.name.startsWith('@dicebear/')
      || !p.license || /SEE |CC-|GPL|MPL|CUSTOM/i.test(p.license)).map(p => `${p.name}@${p.version}`),
    limitations: ['Bundler-contributed modules and package-root notices; presence is not legal clearance',
      'README references retained as provenance, not automatically treated as complete notices',
      'Generated code, icon/design collections and native transitive components can have separate obligations']};
}

export function renderBuildNotices(report) {
  const parts = ['Third-party notices for this exact build',
    'Notice-location evidence only. This file does not certify complete attribution or public-release rights.'];
  for (const pkg of report.packages) {
    parts.push(`\n${pkg.name}@${pkg.version} (${pkg.path})`);
    for (const notice of pkg.notices) parts.push(`--- ${notice.file} [sha256 ${notice.sha256}] ---\n${notice.text}`);
    for (const notice of pkg.componentNotices ?? []) parts.push(`--- Component: ${notice.component} [sha256 ${notice.sha256}] ---\n${notice.text}`);
    for (const ref of pkg.references) parts.push(`--- Upstream README reference, not notice clearance: ${ref.file} ---\n${ref.text}`);
    if (!pkg.notices.length) parts.push('UNRESOLVED: no complete package-root notice located.');
  }
  return parts.join('\n\n') + '\n';
}

export async function writeEsbuildNotices(metafile, {root, cwd, outdir}) {
  const modules = new Set(), outputs = [];
  for (const [name, output] of Object.entries(metafile.outputs)) {
    for (const [input, info] of Object.entries(output.inputs)) if (info.bytesInOutput > 0) modules.add(input);
    const file = resolve(cwd, name);
    if (!inside(resolve(outdir), file)) throw new Error('Build output escapes output directory');
    const bytes = await readFile(file);
    outputs.push({path: relative(outdir, file), bytes: bytes.length, sha256: sha256(bytes)});
  }
  const report = await collectBuildNotices(modules, {root, cwd, outputs});
  await writeFile(join(outdir, NOTICE_MANIFEST), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(outdir, NOTICE_TEXT), renderBuildNotices(report));
  return report;
}

export function createViteNoticePlugin({root}) {
  return {name: 'orchestra-build-notices', apply: 'build', enforce: 'post',
    // Vite's own post-build generateBundle hooks can still rewrite preload
    // markers after user enforce:post plugins. Hash the actual emitted bytes,
    // after earlier parallel write hooks have completed, not an intermediate
    // in-memory chunk. The artifact checker remains responsible for detecting
    // any subsequent modification after this exact-build snapshot.
    writeBundle: {order: 'post', sequential: true, async handler(options, bundle) {
      if (!options.dir) throw new Error('Frontend notice evidence requires a written output directory');
      const outdir = await realpath(resolve(options.dir));
      const modules = new Set(), outputs = [];
      for (const [name, item] of Object.entries(bundle)) {
        if (name === NOTICE_MANIFEST || name === NOTICE_TEXT) throw new Error('Conflicting frontend notice output');
        if (item.type === 'chunk') for (const [id, info] of Object.entries(item.modules)) {
          if (info.renderedLength > 0) modules.add(id);
        }
        if (isAbsolute(name) || name.split(/[\\/]/).some(part => part === '..' || part === '.')) throw new Error('Frontend build output escapes output directory');
        const file = join(outdir, name);
        if (!inside(outdir, await realpath(file)) || !(await lstat(file)).isFile()) throw new Error('Frontend build output is not a confined regular file');
        const bytes = await readFile(file);
        outputs.push({path: name, bytes: bytes.length, sha256: sha256(bytes)});
      }
      const report = await collectBuildNotices(modules, {root, outputs});
      await writeFile(join(outdir, NOTICE_MANIFEST), JSON.stringify(report, null, 2) + '\n');
      await writeFile(join(outdir, NOTICE_TEXT), renderBuildNotices(report));
    }}};
}
