const test = require('node:test');
const assert = require('node:assert/strict');
const { layouts, frameSize, imageGeometry, clamp, validCrop } = require('../src/crop');
const { validRotation, rotatedDimensions, rotateCrop } = require('../src/crop');

test('quarter-turn rotations swap dimensions and preserve crop centers around a full turn', () => {
  assert.deepEqual(rotatedDimensions(4000, 3000, 90), { width: 3000, height: 4000 });
  assert.deepEqual(rotatedDimensions(4000, 3000, 180), { width: 4000, height: 3000 });
  assert.ok(!validRotation(45));
  const crop = { scale: 2, x: 0.1, y: -0.2 };
  assert.deepEqual(rotateCrop(crop, 1), { scale: 2, x: 0.2, y: 0.1 });
  assert.deepEqual(rotateCrop(rotateCrop(crop, 1), 3), crop);
});

test('crop frames keep their aspect ratio across viewport sizes', () => {
  for (const [layout, { ratio }] of Object.entries(layouts)) {
    for (const [width, height] of [[1000, 800], [400, 900], [1800, 250]]) {
      const frame = frameSize(width, height, layout);
      assert.ok(frame.width <= width && frame.height <= height);
      if (ratio) assert.ok(Math.abs(frame.width / frame.height - ratio) < 1e-10);
      else assert.deepEqual(frame, { width, height });
    }
  }
});

test('every crop stays filled at minimum and maximum zoom, including extreme panning', () => {
  for (const [layout, { ratio }] of Object.entries(layouts)) {
    if (!ratio) continue;
    const frame = frameSize(1000, 800, layout);
    for (const [imageWidth, imageHeight] of [[6000, 1000], [1000, 6000], [1000, 1000]]) {
      for (const scale of [1, 2, 8]) {
        const geometry = imageGeometry(frame.width, frame.height, imageWidth, imageHeight, layout, scale);
        assert.ok(geometry.photoWidth >= frame.width - 1e-9);
        assert.ok(geometry.photoHeight >= frame.height - 1e-9);
        for (const offset of [-100000, 100000]) {
          const x = clamp(offset, -geometry.maxX, geometry.maxX);
          const y = clamp(offset, -geometry.maxY, geometry.maxY);
          assert.ok(geometry.photoWidth / 2 - Math.abs(x) >= frame.width / 2 - 1e-9);
          assert.ok(geometry.photoHeight / 2 - Math.abs(y) >= frame.height / 2 - 1e-9);
        }
      }
    }
  }
});

test('original mode fits the whole image, and crop data rejects invalid values', () => {
  assert.equal(imageGeometry(800, 600, 2000, 1000, 'original', 1).fit, 0.4);
  assert.ok(validCrop({ scale: 1, x: 0, y: 0 }));
  for (const crop of [null, {}, { scale: 0.5, x: 0, y: 0 }, { scale: 9, x: 0, y: 0 },
    { scale: 1, x: Infinity, y: 0 }, { scale: 1, x: 0, y: NaN }, { scale: 1, x: 0.6, y: 0 }]) {
    assert.ok(!validCrop(crop));
  }
});
