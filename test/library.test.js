const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isImageName, needsNativePreview, countStatuses, visibleImages, nextVisibleName
} = require('../src/library');

test('recognizes supported image formats without accepting other files', () => {
  assert.equal(isImageName('holiday.JPG'), true);
  assert.equal(isImageName('portrait.heic'), true);
  assert.equal(isImageName('notes.txt'), false);
  assert.equal(needsNativePreview('portrait.HEIC'), true);
  assert.equal(needsNativePreview('portrait.jpg'), false);
});

test('keeper-only view excludes every unmarked photo and old rejection decisions', () => {
  const images = [
    { name: '1.jpg', status: 'keep' },
    { name: '2.jpg', status: 'reject' }, // Existing review files may contain this old status.
    { name: '3.jpg', status: 'unreviewed' },
    { name: '4.jpg', status: 'keep' }
  ];
  assert.deepEqual(countStatuses(images), { keep: 2, unreviewed: 2 });
  assert.deepEqual(visibleImages(images, false).map(image => image.name), ['1.jpg', '4.jpg']);
  assert.equal(visibleImages(images, true).length, 4);
  assert.equal(nextVisibleName(images, '1.jpg', false), '4.jpg');
  assert.equal(nextVisibleName(images, '1.jpg', false, -1), '1.jpg');
  assert.equal(nextVisibleName(images, '1.jpg', false, -1, true), '4.jpg');
  assert.equal(nextVisibleName(images, '4.jpg', false), '4.jpg');
  assert.equal(nextVisibleName(images, '4.jpg', false, 1, true), '1.jpg');
  assert.equal(nextVisibleName([], '1.jpg', false), null);
  assert.equal(nextVisibleName([{ name: '1.jpg', status: 'unreviewed' }], '1.jpg', false), null);
});
