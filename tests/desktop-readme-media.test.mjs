import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, access, stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';

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
  assert.match(text, /Real OpenAI answers in a sample project; edited timing/);
  assert.match(text, /\[Recording details\]\(docs\/desktop\/media\/PRODUCT-FILM\.md\)/);
  assert.doesNotMatch(text, /still being recorded and reviewed/);
  const recordingDetails = await readFile(new URL('docs/desktop/media/PRODUCT-FILM.md', root), 'utf8');
  assert.match(recordingDetails, /evidence-only/);
  assert.match(recordingDetails, /fictional/);
  assert.match(recordingDetails, /not a continuous screen recording or a latency benchmark/);
  assert.match(recordingDetails, /AI-generated/);
  const embeddedVideos = [...text.matchAll(/^https:\/\/github.com\/user-attachments\/assets\/[a-f0-9-]+$/gm)].map(match => match[0]);
  assert.deepEqual(embeddedVideos, [
    'https://github.com/user-attachments/assets/ec16c0f7-5fae-4b9b-ba15-6ce23fe48e7d',
    'https://github.com/user-attachments/assets/51f3404e-a8e9-4263-9f8a-2cc03149f166',
  ]);
  assert(!text.includes('producthunt.com/widgets'), 'No unearned award badges');
});

test('final narrated films match the reviewed renders and complete transcripts', async () => {
  const base = new URL('docs/desktop/media/', root);
  const packet = new URL('narrated-2026-09-22/', base);
  const manifest = JSON.parse(await readFile(new URL('media-manifest.json', packet), 'utf8'));
  const recording = JSON.parse(await readFile(new URL('recording-record.json', packet), 'utf8'));
  const renderer = await readFile(new URL(manifest.renderer.file, root));
  assert.equal(createHash('sha256').update(renderer).digest('hex'), manifest.renderer.sha256);
  for (const film of manifest.films) {
    const bytes = await readFile(new URL(`Orchestra-${film.name}-narrated.mp4`, base));
    assert.equal(bytes.subarray(4, 8).toString(), 'ftyp');
    assert.equal(bytes.length, film.web.bytes);
    assert(bytes.length > 1_000_000 && bytes.length < 9_500_000);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), film.web.sha256);
    assert.equal(film.duration, film.name === 'launch' ? 60 : 180);
    const transcript = await readFile(new URL(`${film.name}-transcript.txt`, packet));
    assert.equal(createHash('sha256').update(transcript).digest('hex'), recording[film.name].transcriptSha256);
    const timeline = await readFile(new URL(film.portableTimeline.file, packet));
    assert.equal(createHash('sha256').update(timeline).digest('hex'), film.portableTimeline.sha256);
    const narrationText = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cues = JSON.parse(timeline).captions;
    assert.equal(narrationText(cues.map(cue => cue.text).join(' ')), narrationText(transcript.toString()));
    assert(!timeline.toString().includes('/private/tmp/'), 'Portable recipe must not depend on a temporary directory');
    assert(!timeline.toString().includes('/Users/'), 'Portable recipe must not expose a local user directory');
    const captions = await readFile(new URL(`${film.name}.srt`, packet), 'utf8');
    assert.equal([...captions.matchAll(/ --> /g)].length, film.captionCount);
  }
  assert.equal(recording.capture.realOpenAiAnswersAndResearch, true);
  assert.equal(recording.capture.completedHumanApprovalShown, false);
  assert.equal(recording.narration.synthetic, true);
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
  const film = await readFile(new URL('Orchestra-product-film.mp4', base));
  assert.equal(film.subarray(4, 8).toString(), 'ftyp');
  assert(film.length > 1_000_000 && film.length < 10_000_000);
  const preflight = await readFile(new URL('orchestra-preflight-walkthrough.gif', base));
  assert.match(preflight.subarray(0, 6).toString(), /^GIF8[79]a$/);
  assert(preflight.length > 100_000 && preflight.length < 5_000_000);
});
