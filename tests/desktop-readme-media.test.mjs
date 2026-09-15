import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, access, stat} from 'node:fs/promises';

const root = new URL('../', import.meta.url);
test('README links resolve locally and preserve private-beta scope', async () => {
  const text = await readFile(new URL('README.md', root), 'utf8');
  const links = [...text.matchAll(/(?:href|src)="([^"]+)"|\]\(([^)]+)\)/g)].map(match => match[1] ?? match[2]);
  for (const target of links) {
    if (/^(?:https?:|mailto:|#)/.test(target)) continue;
    assert(!target.startsWith('/'), 'README assets need repository-relative paths');
    await access(new URL(target.split('#')[0], root));
  }
  assert.match(text, /Product Brain for High Speed Teams/);
  assert.match(text, /private by explicit owner instruction/);
  assert.match(text, /evidence-only mode, not AI synthesis/);
  assert.match(text, /^https:\/\/github.com\/user-attachments\/assets\/[a-f0-9-]+$/m);
  assert(!text.includes('producthunt.com/widgets'), 'No unearned award badges');
});

test('README walkthrough assets have real media signatures and bounded sizes', async () => {
  const base = new URL('docs/desktop/media/', root);
  const gif = await readFile(new URL('orchestra-evidence-walkthrough.gif', base));
  assert.match(gif.subarray(0, 6).toString(), /^GIF8[79]a$/);
  assert(gif.length > 100_000 && gif.length < 2_000_000);
  const video = await readFile(new URL('orchestra-evidence-walkthrough.mp4', base));
  assert.equal(video.subarray(4, 8).toString(), 'ftyp');
  assert(video.length > 100_000 && video.length < 10_000_000);
  assert((await stat(new URL('orchestra-source-view.png', base))).size > 10_000);
});
