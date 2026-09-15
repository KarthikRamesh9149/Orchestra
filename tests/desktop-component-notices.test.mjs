import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('embedded component notices remain exact and do not clear package blockers', async () => {
  const root = new URL('../', import.meta.url);
  const bundle = await readFile(new URL('docs/desktop/third-party/component-notices.txt', root), 'utf8');
  const sources = [
    ['stackback', '0.0.2', 'formatstack.js', '\n\nfunction'],
    ['brotli', '1.3.3', 'dec/decode.js', '\n\nvar'],
  ];
  for (const [name, version, file, boundary] of sources) {
    const metadata = JSON.parse(await readFile(new URL(`node_modules/${name}/package.json`, root), 'utf8'));
    assert.equal(metadata.version, version, 'Review notices when the dependency changes');
    const source = await readFile(new URL(`node_modules/${name}/${file}`, root), 'utf8');
    const end = source.indexOf(boundary);
    assert(end > 0);
    assert(bundle.includes(source.slice(0, end)), `${name} source notice changed`);
  }
  const report = JSON.parse(await readFile(new URL('docs/desktop/third-party/recovered-notices.json', root), 'utf8'));
  assert.equal(report.complete, false);
  assert(report.unresolved.includes('brotli@1.3.3'));
  assert(report.unresolved.includes('stackback@0.0.2'));
});
