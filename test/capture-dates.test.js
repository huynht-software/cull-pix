const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { captureTimestamp, createCaptureDateReader } = require('../src/capture-dates');
const { comparePhotos } = require('../src/photo-order');
const { withCaptureDate } = require('../scripts/fixtures/exif-photo.cjs');

test('EXIF capture timestamps validate dates and respect timezone and subseconds', () => {
  assert.equal(captureTimestamp('2025:06:01 12:30:45', '+02:00', '12'), Date.UTC(2025, 5, 1, 10, 30, 45, 120));
  assert.equal(captureTimestamp('2025:06:01 12:30:45'), Date.UTC(2025, 5, 1, 12, 30, 45));
  assert.equal(captureTimestamp('2025:02:30 12:00:00'), null);
  assert.equal(captureTimestamp('0000:00:00 00:00:00'), null);
  assert.equal(captureTimestamp(undefined), null);
});

test('sorts names naturally and puts undated photos last in both date directions', () => {
  const images = [{ name: '10.jpg', dateTaken: 100 }, { name: '2.jpg', dateTaken: 200 },
    { name: 'missing.jpg', dateTaken: null }, { name: 'no-exif.jpg' }];
  const order = mode => [...images].sort((a, b) => comparePhotos(a, b, mode)).map(image => image.name);
  assert.deepEqual(order('name-asc'), ['2.jpg', '10.jpg', 'missing.jpg', 'no-exif.jpg']);
  assert.deepEqual(order('name-desc'), ['no-exif.jpg', 'missing.jpg', '10.jpg', '2.jpg']);
  assert.deepEqual(order('taken-asc'), ['10.jpg', '2.jpg', 'missing.jpg', 'no-exif.jpg']);
  assert.deepEqual(order('taken-desc'), ['2.jpg', '10.jpg', 'missing.jpg', 'no-exif.jpg']);
});

test('reads actual JPEG EXIF, reuses disk metadata, and refreshes changed sources', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'cull-exif-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const source = path.join(folder, 'photo.jpg');
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  await fs.writeFile(source, withCaptureDate(jpeg, '2024:03:02 10:00:00'));
  await fs.writeFile(path.join(folder, 'missing.jpg'), jpeg);
  const reader = createCaptureDateReader();
  const first = await reader.readFolder(folder, ['photo.jpg', 'missing.jpg']);
  assert.equal(first['photo.jpg'], Date.UTC(2024, 2, 2, 10));
  assert.equal(first['missing.jpg'], null);
  let parsed = 0;
  const nextSession = createCaptureDateReader(async () => { parsed += 1; return { DateTimeOriginal: '2026:01:01 00:00:00' }; });
  assert.deepEqual(await nextSession.readFolder(folder, ['photo.jpg', 'missing.jpg']), first);
  assert.equal(parsed, 0);
  await fs.writeFile(source, Buffer.concat([withCaptureDate(jpeg, '2026:01:01 00:00:00'), Buffer.from('changed')]));
  assert.equal((await nextSession.readFolder(folder, ['photo.jpg']))['photo.jpg'], Date.UTC(2026, 0, 1));
  assert.equal(parsed, 1);
});

test('limits metadata reads and stops cancelled folder scans', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'cull-exif-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const names = Array.from({ length: 12 }, (_, i) => `${i}.jpg`);
  await Promise.all(names.map(name => fs.writeFile(path.join(folder, name), 'photo')));
  let active = 0;
  let maximum = 0;
  const reader = createCaptureDateReader(async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active -= 1;
    return undefined;
  });
  assert.deepEqual(await reader.readFolder(folder, names, () => false), {});
  assert.equal(maximum, 0);
  await reader.readFolder(folder, names);
  assert.equal(maximum, 4);
});
