const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { createThumbnailCache, CACHE_DIRECTORY } = require('../src/thumbnail-cache');

async function fixture(t) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'cull-thumbnail-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  await fs.writeFile(path.join(folder, 'photo.jpg'), 'original');
  return folder;
}

test('reuses disk thumbnails across sessions and refreshes changed photos', async t => {
  const folder = await fixture(t);
  let generated = 0;
  const generate = async () => { generated += 1; return Buffer.from('thumbnail'); };
  const first = createThumbnailCache(generate);
  const [url, duplicate] = await Promise.all([first.thumbnail(folder, 'photo.jpg'), first.thumbnail(folder, 'photo.jpg')]);
  assert.equal(url, duplicate);
  assert.equal(generated, 1);
  assert.equal(path.dirname(fileURLToPath(url)), path.join(folder, CACHE_DIRECTORY));
  assert.equal(await fs.readFile(fileURLToPath(url), 'utf8'), 'thumbnail');
  const second = createThumbnailCache(generate);
  assert.equal(await second.thumbnail(folder, 'photo.jpg'), url);
  assert.equal(generated, 1);
  await fs.writeFile(path.join(folder, 'photo.jpg'), 'changed original');
  assert.notEqual(await second.thumbnail(folder, 'photo.jpg'), url);
  assert.equal(generated, 2);
  assert.equal(await fs.readFile(path.join(folder, 'photo.jpg'), 'utf8'), 'changed original');
});

test('bounds concurrent generation for a burst of scroll requests', async t => {
  const folder = await fixture(t);
  let active = 0;
  let maximum = 0;
  const cache = createThumbnailCache(async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active -= 1;
    return Buffer.from('thumbnail');
  });
  const names = Array.from({ length: 12 }, (_, i) => `${i}.jpg`);
  await Promise.all(names.map(name => fs.writeFile(path.join(folder, name), 'original')));
  await Promise.all(names.map(name => cache.thumbnail(folder, name)));
  assert.equal(maximum, 2);
});

test('shows thumbnails if cache cannot be written and retries failed generation', async t => {
  const folder = await fixture(t);
  await fs.writeFile(path.join(folder, CACHE_DIRECTORY), 'blocks cache directory');
  let attempts = 0;
  const cache = createThumbnailCache(async () => {
    if (++attempts === 1) throw new Error('temporary failure');
    return Buffer.from('thumbnail');
  });
  await assert.rejects(cache.thumbnail(folder, 'photo.jpg'), /temporary failure/);
  assert.equal(await cache.thumbnail(folder, 'photo.jpg'), 'data:image/jpeg;base64,dGh1bWJuYWls');
  await assert.rejects(cache.thumbnail(folder, '../other.jpg'), /Invalid image name/);
});

test('rebuilds empty cache entries and separates folders with identical filenames', async t => {
  const folder = await fixture(t);
  const other = await fs.mkdtemp(path.join(os.tmpdir(), 'cull-thumbnail-other-'));
  t.after(() => fs.rm(other, { recursive: true, force: true }));
  await fs.writeFile(path.join(other, 'photo.jpg'), 'another original');
  let generated = 0;
  const cache = createThumbnailCache(async () => { generated += 1; return Buffer.from('thumbnail'); });
  const url = await cache.thumbnail(folder, 'photo.jpg');
  await fs.writeFile(fileURLToPath(url), '');
  await cache.thumbnail(folder, 'photo.jpg');
  const otherUrl = await cache.thumbnail(other, 'photo.jpg');
  assert.notEqual(url, otherUrl);
  assert.equal(generated, 3);
});

test('warms the whole folder, skips failed previews, and reuses existing cache entries', async t => {
  const folder = await fixture(t);
  const names = ['photo.jpg', 'other.jpg', 'unsupported.heic'];
  for (const name of names.slice(1)) await fs.writeFile(path.join(folder, name), 'original');
  const generated = [];
  const cache = createThumbnailCache(async source => {
    generated.push(path.basename(source));
    if (source.endsWith('.heic')) throw new Error('Unsupported codec');
    return Buffer.from('thumbnail');
  });
  await cache.thumbnail(folder, 'photo.jpg');
  await cache.warmFolder(folder, names).done;
  assert.deepEqual(generated, names);
  assert.equal((await fs.readdir(path.join(folder, CACHE_DIRECTORY))).length, 2);
});

test('a new background pass cancels the old one and leaves capacity for visible photos', async t => {
  const folder = await fixture(t);
  for (const name of ['skip.jpg', 'next.jpg', 'visible.jpg']) await fs.writeFile(path.join(folder, name), 'original');
  let releaseFirst;
  const blocked = new Promise(resolve => { releaseFirst = resolve; });
  let firstStarted;
  const started = new Promise(resolve => { firstStarted = resolve; });
  const generated = [];
  const cache = createThumbnailCache(async source => {
    const name = path.basename(source);
    generated.push(name);
    if (name === 'photo.jpg') { firstStarted(); await blocked; }
    return Buffer.from('thumbnail');
  });
  const oldPass = cache.warmFolder(folder, ['photo.jpg', 'skip.jpg']);
  await started;
  await cache.thumbnail(folder, 'visible.jpg');
  const newPass = cache.warmFolder(folder, ['next.jpg']);
  await newPass.done;
  releaseFirst();
  await oldPass.done;
  assert.deepEqual(generated, ['photo.jpg', 'visible.jpg', 'next.jpg']);
});

test('visible thumbnails jump ahead of queued background requests', async t => {
  const folder = await fixture(t);
  for (const name of ['background.jpg', 'visible.jpg']) await fs.writeFile(path.join(folder, name), 'original');
  let releaseFirst;
  const blocked = new Promise(resolve => { releaseFirst = resolve; });
  let firstStarted;
  const started = new Promise(resolve => { firstStarted = resolve; });
  const generated = [];
  const cache = createThumbnailCache(async source => {
    const name = path.basename(source);
    generated.push(name);
    if (name === 'photo.jpg') { firstStarted(); await blocked; }
    return Buffer.from('thumbnail');
  }, 1);
  const first = cache.thumbnail(folder, 'photo.jpg');
  await started;
  const background = cache.thumbnail(folder, 'background.jpg', { background: true });
  const visible = cache.thumbnail(folder, 'visible.jpg');
  await new Promise(resolve => setTimeout(resolve, 25));
  releaseFirst();
  await Promise.all([first, background, visible]);
  assert.deepEqual(generated, ['photo.jpg', 'visible.jpg', 'background.jpg']);
});
