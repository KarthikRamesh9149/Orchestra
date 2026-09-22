import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

for (const path of ['docs/desktop/release/BUILD.md', 'README.md']) {
  test(`${path} installs desktop dependencies before the cross-package root build`, async () => {
    const source = await readFile(new URL('../' + path, import.meta.url), 'utf8');
    const recipe = [...source.matchAll(/```sh\n([\s\S]*?)```/g)]
      .map(match => match[1]).find(block => block.includes('npm run build'));
    assert.ok(recipe, 'A complete source-build recipe must remain documented');
    const install = recipe.indexOf('npm --prefix apps/desktop ci');
    assert.ok(install >= 0 && install < recipe.indexOf('npm run build'),
      'Root TypeScript tests import desktop modules; a warm node_modules must not hide this dependency');
    assert.doesNotMatch(recipe, /ts-ignore|skipLibCheck|\|\|\s*true/);
    assert.match(recipe, /export DEVELOPER_DIR=\/Library\/Developer\/CommandLineTools/);
    const sdk = recipe.indexOf('export SDKROOT="$(xcrun --sdk macosx --show-sdk-path)"');
    assert.ok(sdk >= 0 && sdk < recipe.indexOf('node scripts/desktop/build-native-mac.mjs'),
      'Direct native compiler calls need the installed SDK headers on a clean Mac');
  });
}
