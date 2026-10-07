// Stage exact installed runtime packages, never install/prune the working tree.
import {readFile, readdir, lstat, realpath, mkdir, copyFile, chmod, symlink, mkdtemp, writeFile, rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {tmpdir} from 'node:os';
import {basename, dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {isDeepStrictEqual, promisify} from 'node:util';
import semver from 'semver';

export const PRISMA_RUNTIME_VERSION = '6.6.0';
// A reviewed CLI-only security upgrade, not a general npm override resolver.
// Pin the owner identity and original declaration as well as the replacement.
const REVIEWED_OVERRIDE = {mammoth: {argparse: '2.0.1'}};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const ordered = values => [...values].sort();
const execute = promisify(execFile);
const contained = (root, path) => {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
};
function packageName(name) {
  if (!/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(name) || name.split('/').some(p => p === '..' || p === '.')) throw new Error('Unsafe dependency name');
  return name;
}
async function regular(path) {
  if (!(await lstat(path)).isFile()) throw new Error('Expected regular runtime file: ' + basename(path));
  return readFile(path);
}
async function directory(path) {
  if (!(await lstat(path)).isDirectory()) throw new Error('Expected real runtime directory: ' + basename(path));
}
async function physicalDestination(path) {
  try {return await realpath(path);}
  catch (error) {if (error.code !== 'ENOENT') throw error; return join(await physicalDestination(dirname(path)), basename(path));}
}
function edges(metadata) {
  const result = new Map();
  for (const [name, range] of Object.entries(metadata.dependencies ?? {})) result.set(name, {name, range, optional: false, kind: 'dependency'});
  for (const [name, range] of Object.entries(metadata.optionalDependencies ?? {})) result.set(name, {name, range, optional: true, kind: 'optional'});
  for (const [name, range] of Object.entries(metadata.peerDependencies ?? {})) if (!result.has(name)) {
    result.set(name, {name, range, optional: metadata.peerDependenciesMeta?.[name]?.optional === true, kind: 'peer'});
  }
  return [...result.values()].sort((a,b) => a.name.localeCompare(b.name, 'en'));
}

// Node's ancestor node_modules lookup, explicitly bounded to this source/stage.
// A missing staged package must not resolve through the checkout's dev tree.
async function resolvePackage(base, from, name) {
  packageName(name);
  let current = join(base, from);
  while (contained(base, current)) {
    if (basename(current) !== 'node_modules') {
      const folder = join(current, 'node_modules', name);
      try {
        await directory(folder);
        const canonical = await realpath(folder);
        if (!contained(join(base, 'node_modules'), canonical)) throw new Error('Dependency escapes node_modules');
        const bytes = await regular(join(folder, 'package.json'));
        return {path: relative(base, folder), metadata: JSON.parse(bytes.toString('utf8')), packageJsonSha256: digest(bytes)};
      } catch (error) {if (error.code !== 'ENOENT') throw error;}
    }
    if (current === base) break;
    current = dirname(current);
  }
  return null;
}
function matchesRange(version, range) {
  // This recipe intentionally rejects aliases, file/git and workspace packages;
  // they need a separately reviewed identity rule rather than silent resolution.
  return typeof range === 'string' && semver.validRange(range) && semver.satisfies(version, range, {includePrerelease: true});
}

export async function planRuntimeDependencies(sourceRoot) {
  const root = await realpath(sourceRoot);
  await directory(join(root, 'node_modules'));
  const manifestBytes = await regular(join(root, 'package.json')), lockBytes = await regular(join(root, 'package-lock.json'));
  const metadata = JSON.parse(manifestBytes), lock = JSON.parse(lockBytes);
  if (lock.lockfileVersion !== 3 || !lock.packages?.['']) throw new Error('Expected npm lockfile version 3');
  for (const field of ['dependencies', 'optionalDependencies', 'devDependencies']) {
    if (!isDeepStrictEqual(metadata[field] ?? {}, lock.packages[''][field] ?? {})) throw new Error('Root dependency manifest/lock drift: ' + field);
  }
  if (metadata.dependencies?.['@prisma/client'] !== PRISMA_RUNTIME_VERSION || metadata.devDependencies?.prisma !== PRISMA_RUNTIME_VERSION) throw new Error('Review the exact Prisma runtime/tooling pins');
  if (metadata.overrides !== undefined && !isDeepStrictEqual(metadata.overrides, {})
    && !isDeepStrictEqual(metadata.overrides, REVIEWED_OVERRIDE)) throw new Error('Unreviewed runtime override');
  const hasReviewedOverride = isDeepStrictEqual(metadata.overrides, REVIEWED_OVERRIDE);
  let overrideApplied = false;
  const roots = edges({dependencies: {...metadata.dependencies, prisma: PRISMA_RUNTIME_VERSION}, optionalDependencies: metadata.optionalDependencies});
  const selected = new Map(), queue = [{path: '', metadata, edges: roots}], graph = [], absentOptional = [];
  for (let i = 0; i < queue.length; i++) {
    const owner = queue[i];
    for (const edge of owner.edges) {
      const found = await resolvePackage(root, owner.path, edge.name);
      if (!found) {
        if (edge.optional) {absentOptional.push({from: owner.path, ...edge}); continue;}
        throw new Error(`Missing required dependency ${edge.name} from ${owner.path || 'root'}`);
      }
      const locked = lock.packages[found.path];
      if (!locked || locked.link || locked.version !== found.metadata.version || found.metadata.name !== edge.name) throw new Error('Installed/lock identity mismatch: ' + found.path);
      let override;
      if (hasReviewedOverride && owner.path && owner.metadata.name === 'mammoth' && edge.name === 'argparse') {
        if (owner.metadata.version !== '1.13.0' || edge.range !== '~1.0.3'
          || edge.kind !== 'dependency' || found.metadata.version !== '2.0.1') throw new Error('Reviewed override identity mismatch: ' + found.path);
        override = {parent: 'mammoth', parentVersion: owner.metadata.version, version: '2.0.1'};
        overrideApplied = true;
      }
      if (!matchesRange(found.metadata.version, override?.version ?? edge.range)) throw new Error('Dependency range mismatch: ' + found.path);
      for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta']) {
        if (!isDeepStrictEqual(found.metadata[field] ?? {}, locked[field] ?? {})) throw new Error('Installed dependency graph differs from lock: ' + found.path + ':' + field);
      }
      graph.push({from: owner.path, ...edge, ...(override ? {override} : {}), to: found.path});
      if (!selected.has(found.path)) {
        selected.set(found.path, {...found, integrity: locked.integrity ?? null, resolved: locked.resolved ?? null});
        queue.push({path: found.path, metadata: found.metadata, edges: edges(found.metadata)});
      }
    }
  }
  if (hasReviewedOverride && !overrideApplied) throw new Error('Reviewed runtime override was not applied');
  return {formatVersion: 1, sourceRoot: root, packageJsonSha256: digest(manifestBytes), lockSha256: digest(lockBytes),
    roots, packages: [...selected.values()].sort((a,b) => a.path.localeCompare(b.path, 'en')), edges: graph, absentOptional,
    excludedLockPackages: ordered(Object.keys(lock.packages).filter(path => path && !selected.has(path))),
    limitations: ['Exact installed versions and metadata graph, not re-verification of archive contents',
      'Optional packages/peers already installed for this host are retained; absent optional edges are recorded',
      'Only the exact reviewed Mammoth 1.13.0 direct argparse 2.0.1 override is supported; other npm override semantics fail closed',
      'Generated Prisma client is retained separately and must match the pinned client and project schema']};
}

export async function assertPrismaSchemaMatches(modules, sourceBytes, generatedBytes) {
  if (sourceBytes.equals(generatedBytes)) return;
  const metadata = JSON.parse(await regular(join(modules, 'prisma/package.json')));
  if (metadata.name !== 'prisma' || metadata.version !== PRISMA_RUNTIME_VERSION) throw new Error('Prisma formatter version mismatch');
  const cliPath = join(modules, 'prisma/build/index.js');
  await regular(cliPath);
  const cli = await realpath(cliPath);
  if (!contained(await realpath(modules), cli)) throw new Error('Prisma formatter escapes dependency tree');
  const temp = await mkdtemp(join(tmpdir(), 'orchestra-prisma-schema-'));
  try {
    const canonical = [];
    for (const [name, bytes] of [['source', sourceBytes], ['generated', generatedBytes]]) {
      const path = join(temp, `${name}.prisma`);
      await writeFile(path, bytes);
      // Prisma generate canonicalizes spacing/alignment. Use that exact pinned
      // formatter, not whitespace deletion (which would alter string defaults).
      // A private cwd and minimal environment avoid project config/.env discovery;
      // format uses Prisma's already-bundled schema WASM, not an external service.
      for (const command of ['validate', 'format']) await execute(process.execPath, [cli, command, '--schema', path], {
          cwd: temp, timeout: 30_000, maxBuffer: 1024 * 1024,
          // validate checks syntax/model consistency, never connects to this URL.
          // It must run first: format can otherwise auto-add a missing relation.
          env: {PATH: process.env.PATH ?? '', CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1', NO_COLOR: '1',
            DATABASE_URL: 'postgresql://schema_check:schema_check@127.0.0.1:1/schema_check'},
        });
      canonical.push(await regular(path));
    }
    if (!canonical[0].equals(canonical[1])) throw new Error('Generated Prisma schema is stale');
  } catch (error) {
    if (error.message === 'Generated Prisma schema is stale') throw error;
    throw new Error('Generated Prisma schema is stale or could not be canonically validated');
  } finally {
    await rm(temp, {recursive: true, force: true});
  }
}

export async function validatePrismaRuntime(modules, schemaPath, target = 'darwin-arm64') {
  if (target !== 'darwin-arm64') throw new Error('Only the qualified Mac ARM runtime recipe is supported');
  const required = ['prisma/build/index.js', '@prisma/client/default.js', '@prisma/client/runtime/library.js',
    '@prisma/engines/schema-engine-darwin-arm64', '@prisma/engines/libquery_engine-darwin-arm64.dylib.node',
    '.prisma/client/default.js', '.prisma/client/index.js', '.prisma/client/index.d.ts', '.prisma/client/schema.prisma',
    '.prisma/client/libquery_engine-darwin-arm64.dylib.node'];
  for (const folder of ['prisma', '@prisma/client', '@prisma/engines', '.prisma/client']) {
    const metadata = JSON.parse(await regular(join(modules, folder, 'package.json')));
    if (metadata.version !== PRISMA_RUNTIME_VERSION) throw new Error('Prisma package/generated version mismatch: ' + folder);
  }
  await assertPrismaSchemaMatches(modules, await regular(schemaPath), await regular(join(modules, '.prisma/client/schema.prisma')));
  if (await realpath(join(modules, '@prisma/client/.prisma')) !== await realpath(join(modules, '.prisma'))) throw new Error('Prisma generated client link has the wrong target');
  const files = [];
  for (const path of required) {
    const bytes = await regular(join(modules, path));
    files.push({path, bytes: bytes.length, sha256: digest(bytes)});
  }
  const engine = await lstat(join(modules, '@prisma/engines/schema-engine-darwin-arm64'));
  if (!(engine.mode & 0o111)) throw new Error('Prisma schema engine is not executable');
  return files;
}

export async function validateStagedRuntime(plan, destination, schemaPath) {
  destination = await realpath(destination);
  const stageBase = dirname(destination);
  for (const pkg of plan.packages) {
    const path = join(stageBase, pkg.path), bytes = await regular(join(path, 'package.json'));
    if (digest(bytes) !== pkg.packageJsonSha256) throw new Error('Staged package metadata differs: ' + pkg.path);
  }
  for (const edge of plan.edges) {
    const resolved = await resolvePackage(stageBase, edge.from, edge.name);
    if (!resolved || resolved.path !== edge.to) throw new Error(`Staged dependency resolution differs: ${edge.from} -> ${edge.name}`);
  }
  for (const edge of plan.absentOptional) {
    if (await resolvePackage(stageBase, edge.from, edge.name)) throw new Error('Absent optional dependency appeared in staged graph');
  }
  async function links(folder) {
    for (const name of await readdir(folder)) {
      const file = join(folder, name), stat = await lstat(file);
      if (stat.isSymbolicLink()) {
        if (!contained(destination, await realpath(file))) throw new Error('Staged runtime link escapes dependency tree');
      } else if (stat.isDirectory()) await links(file);
    }
  }
  await links(destination);
  return validatePrismaRuntime(destination, schemaPath);
}

export async function stageRuntimeDependencies({sourceRoot, destination}) {
  const plan = await planRuntimeDependencies(sourceRoot), source = join(plan.sourceRoot, 'node_modules');
  destination = await physicalDestination(resolve(destination));
  if (basename(destination) !== 'node_modules' || contained(source, destination) || contained(destination, source)) throw new Error('Runtime staging must be a fresh separate node_modules tree');
  await mkdir(dirname(destination), {recursive: true});
  await mkdir(destination); // fail if it exists; never overwrite a previous stage
  const schemaPath = join(plan.sourceRoot, 'prisma/schema.prisma');
  const originalPrisma = await validatePrismaRuntime(source, schemaPath);
  let copiedFiles = 0, copiedBytes = 0;
  async function copyTree(from, to) {
    const stat = await lstat(from);
    if (stat.isSymbolicLink()) {
      const target = await realpath(from);
      if (!contained(source, target)) throw new Error('Source package link escapes node_modules');
      const stagedTarget = join(destination, relative(source, target));
      await symlink(relative(dirname(to), stagedTarget), to);
    } else if (stat.isDirectory()) {
      await mkdir(to, {recursive: true});
      for (const name of await readdir(from)) if (name !== 'node_modules') await copyTree(join(from, name), join(to, name));
    } else if (stat.isFile()) {
      await copyFile(from, to); await chmod(to, stat.mode & 0o777);
      copiedFiles++; copiedBytes += stat.size;
    } else throw new Error('Unsupported file in runtime package');
  }
  for (const pkg of plan.packages) {
    const suffix = relative('node_modules', pkg.path);
    await mkdir(dirname(join(destination, suffix)), {recursive: true});
    await copyTree(join(source, suffix), join(destination, suffix));
  }
  await mkdir(join(destination, '.prisma'), {recursive: true});
  await copyTree(join(source, '.prisma/client'), join(destination, '.prisma/client'));
  // Preserve only existing npm CLI links whose targets were actually retained.
  // Native host calls prisma/build/index.js directly, but selected tool bins remain usable.
  const binDirectories = new Set(['.bin', ...plan.packages.map(p => relative('node_modules', join(p.path, 'node_modules/.bin')))]);
  const binLinks = [];
  for (const dir of ordered(binDirectories)) {
    let entries;
    try {await directory(join(source, dir)); entries = await readdir(join(source, dir));}
    catch (error) {if (error.code === 'ENOENT') continue; throw error;}
    for (const name of entries) {
      const from = join(source, dir, name);
      if (!(await lstat(from)).isSymbolicLink()) throw new Error('Unexpected non-symlink npm CLI shim');
      const target = await realpath(from);
      if (!contained(source, target)) throw new Error('npm CLI link escapes node_modules');
      const stagedTarget = join(destination, relative(source, target));
      try {await lstat(stagedTarget);} catch (error) {if (error.code === 'ENOENT') continue; throw error;}
      const to = join(destination, dir, name); await mkdir(dirname(to), {recursive: true});
      await symlink(relative(dirname(to), stagedTarget), to); binLinks.push(relative(destination, to));
    }
  }
  const stagedPrisma = await validateStagedRuntime(plan, destination, schemaPath);
  if (!isDeepStrictEqual(originalPrisma, stagedPrisma)) throw new Error('Prisma artifacts changed during staging');
  if (digest(await regular(join(plan.sourceRoot, 'package.json'))) !== plan.packageJsonSha256
    || digest(await regular(join(plan.sourceRoot, 'package-lock.json'))) !== plan.lockSha256) throw new Error('Dependency manifests changed during staging');
  const {sourceRoot: _privatePath, packages, ...report} = plan;
  return {...report, packages: packages.map(({metadata, ...pkg}) => ({...pkg, name: metadata.name, version: metadata.version})),
    copiedFiles, copiedBytes, binLinks, prismaArtifacts: stagedPrisma, stagedResolutionVerified: true};
}
