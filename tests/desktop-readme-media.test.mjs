import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, access} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const root = new URL('../', import.meta.url);
const currentEdition = new URL('docs/desktop/media/narrated-2026-11-19/', root);
const readCurrentManifest = async () => JSON.parse(await readFile(new URL('media-manifest.json', currentEdition), 'utf8'));

test('README links resolve locally and distinguish public source from internal packages', async () => {
  const text = await readFile(new URL('README.md', root), 'utf8');
  const links = [...text.matchAll(/(?:href|src)="([^"]+)"|\]\(([^)]+)\)/g)].map(match => match[1] ?? match[2]);
  for (const target of links) {
    if (/^(?:https?:|mailto:|#)/.test(target)) continue;
    assert(!target.startsWith('/'), 'README assets need repository-relative paths');
    await access(new URL(target.split('#')[0], root));
  }
  assert.match(text, /Product Brain for High Speed Teams/);
  assert.match(text, /Public source preview for Apple Silicon Macs/);
  assert.match(text, /No public installer is available\./);
  assert.match(text, /\[Release status\]\(docs\/desktop\/release\/README\.md\)|href="docs\/desktop\/release\/README\.md">Release status/);
  assert.match(text, /\[Transcripts and recording details\]\(docs\/desktop\/media\/PRODUCT-FILM\.md\)/);
  assert.doesNotMatch(text, /still being recorded and reviewed/);
  const recordingDetails = await readFile(new URL('docs/desktop/media/PRODUCT-FILM.md', root), 'utf8');
  assert.match(recordingDetails, /evidence-only/);
  assert.match(recordingDetails, /fictional/);
  assert.match(recordingDetails, /not a continuous screen recording or a latency benchmark/);
  assert.match(recordingDetails, /AI-generated/);
  assert.match(recordingDetails, /saved, real OpenAI output/);
  const embeddedVideos = [...text.matchAll(/^https:\/\/github.com\/user-attachments\/assets\/[a-f0-9-]+$/gm)].map(match => match[0]);
  const {films} = await readCurrentManifest();
  assert.deepEqual(films.map(film => film.name), ['launch', 'walkthrough']);
  assert.deepEqual(embeddedVideos, films.map(film => film.attachment));
  assert.equal(new Set(embeddedVideos).size, 2);
  assert(!text.includes('producthunt.com/widgets'), 'No unearned award badges');
});

test('README offers a demo or a fresh Mac build before the first-project instructions', async () => {
  const readme = await readFile(new URL('README.md', root), 'utf8');
  const intro = readme.split('## Watch Orchestra')[0];
  assert.match(intro, /href="#orchestra-in-60-seconds"/);
  assert.match(readme, /^### Orchestra in 60 seconds$/m);
  assert.match(intro, /href="docs\/desktop\/release\/BUILD\.md"/);
  const buildGuide = await readFile(new URL('docs/desktop/release/BUILD.md', root), 'utf8');
  assert.match(buildGuide, /git clone https:\/\/github\.com\/KarthikRamesh9149\/Orchestra\.git\ncd Orchestra/);
  assert.match(buildGuide, /\(\.\.\/\.\.\/\.\.\/README\.md#start-with-one-project\)/);
  assert.match(readme, /^## Start with one project$/m);
});

test('the change-review section shows the original pending Cedar packet capture', async () => {
  const readme = await readFile(new URL('README.md', root), 'utf8');
  const section = readme.split('## Review a change before it becomes the plan')[1]?.split('\n## ')[0] ?? '';
  const screenshot = 'docs/desktop/media/narrated-2026-11-19/cedar-change-packet.png';
  assert(section.includes(`src="${screenshot}"`));
  const bytes = await readFile(new URL(screenshot, root));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),
    'de0fc9e249a2746d7b684460c92265c6a29a899ff4711bf2a570a8889a8bc04e');
});

test('current walkthrough and launch embeds have matching MP4s, captions and transcripts', async () => {
  const {films} = await readCurrentManifest();
  const details = await readFile(new URL('../PRODUCT-FILM.md', currentEdition), 'utf8');
  const time = value => {
    const [hours, minutes, seconds, millis] = value.split(/[:,]/).map(Number);
    return 3600 * hours + 60 * minutes + seconds + millis / 1000;
  };
  for (const film of films) {
    const basename = `Orchestra-${film.name}`;
    for (const suffix of ['mp4', 'en.srt', 'transcript.txt']) {
      assert(details.includes(`](narrated-2026-11-19/${basename}.${suffix})`), `Missing link: ${basename}.${suffix}`);
    }
    const bytes = await readFile(new URL(`${basename}.mp4`, currentEdition));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), film.sha256);
    assert.equal(bytes.length, film.bytes);
    assert(bytes.length < 10_000_000);
    assert.equal(bytes.subarray(4, 8).toString(), 'ftyp');
    assert(bytes.indexOf('moov') > 0 && bytes.indexOf('moov') < bytes.indexOf('mdat'), 'MP4 should support fast-start playback');
    const captions = await readFile(new URL(`${basename}.en.srt`, currentEdition), 'utf8');
    const transcript = await readFile(new URL(`${basename}.transcript.txt`, currentEdition), 'utf8');
    const blocks = captions.trim().split(/\r?\n\s*\r?\n/);
    assert.equal(blocks.length, film.captionCues);
    let lastEnd = 0;
    const spoken = blocks.map((block, i) => {
      const [sequence, interval, ...words] = block.split(/\r?\n/);
      assert.equal(Number(sequence), i + 1);
      const [start, end] = interval.split(' --> ').map(time);
      assert(start >= lastEnd && end > start && end <= film.seconds, `Invalid cue ${sequence}`);
      lastEnd = end;
      return words.join(' ');
    });
    const normalize = value => value.trim().replace(/\s+/g, ' ');
    assert.equal(normalize(spoken.join(' ')), normalize(transcript));
  }
});

test('archived September films still match their own renders and transcripts', async () => {
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
  const film = await readFile(new URL('Orchestra-product-film.mp4', base));
  assert.equal(film.subarray(4, 8).toString(), 'ftyp');
  assert(film.length > 1_000_000 && film.length < 10_000_000);
  const preflight = await readFile(new URL('orchestra-preflight-walkthrough.gif', base));
  assert.match(preflight.subarray(0, 6).toString(), /^GIF8[79]a$/);
  assert(preflight.length > 100_000 && preflight.length < 5_000_000);
});
