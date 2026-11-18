import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { resolveConfig } from 'vite';
import { isDynamicPattern } from 'tinyglobby';

const require = createRequire(import.meta.url);
const match = require('picomatch');

test('no build dependency resolves to the unpatched Picomatch registry package', () => {
  for (const manifest of [
    '../package-lock.json',
    '../apps/beta-web/package-lock.json',
    '../apps/vscode-extension/package-lock.json',
  ]) {
    const { packages } = require(manifest);
    const matcher = packages['node_modules/picomatch'];
    assert.equal(matcher?.name, '@orchestra/build-glob', manifest);
    assert.match(matcher.resolved, /^file:(?:\.\.\/\.\.\/)?scripts\/desktop\/tooling-glob$/, manifest);
    assert.ok(!Object.entries(packages).some(([path, pkg]) =>
      (path.endsWith('/picomatch') && pkg.name !== '@orchestra/build-glob')
      || pkg.resolved?.startsWith('https://registry.npmjs.org/picomatch/')), manifest);
  }
});

test('runner include globs include ordinary and nested TS files but not hidden or unrelated files', () => {
  const accepts = match(['tests/**/*.test.ts', 'src/**/*.{ts,tsx}']);
  assert.deepEqual([
    'tests/app.test.ts', 'tests/local/host.test.ts', 'src/App.tsx',
    'tests/.cache/app.test.ts', 'tests/app.test.js', 'scripts/App.tsx',
  ].filter(accepts), ['tests/app.test.ts', 'tests/local/host.test.ts', 'src/App.tsx']);
  assert.equal(match.isMatch('src/App.tsx', []), false);
});

test('scan locates the stable root without splitting slash-containing expansions', () => {
  const result = match.scan('./src/{ui/screens,lib}/**/*.tsx', { parts: true });
  assert.equal(result.base, 'src');
  assert.deepEqual(result.parts, ['src', '{ui/screens,lib}', '**', '*.tsx']);
  assert.equal(isDynamicPattern('src/literal\\[label\\].tsx'), false);
  assert.equal(isDynamicPattern('src/**/*.{ts,tsx}'), true);
});

test('Vite denies environment files, keys and git internals while still serving ordinary fixture assets', async () => {
  const config = await resolveConfig({ configFile: false }, 'serve');
  const paths = [
    '/workspace/.env', '/workspace/.ENV.Local', '/workspace/keys/demo.pem',
    '/workspace/keys/nested/demo.crt', '/workspace/.git/config',
    '/workspace/src/App.tsx', '/workspace/static/readme.txt',
  ];
  assert.deepEqual(paths.filter(config.fsDenyGlob), paths.slice(0, 5));
});
