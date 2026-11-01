const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');
const { exportImage } = require('../src/export-image');
const { layouts, defaultBorder, borderFrame, exportGeometry } = require('../src/crop');

test('bordered frames and exports preserve each selected format without enlarging source pixels', () => {
  for (const [layout, { ratio }] of Object.entries(layouts)) {
    for (const width of [0, 3, 10, 20]) {
      const border = { enabled: true, width, color: '#ffffff' };
      for (const scale of [1, 2, 8]) {
        const frame = borderFrame(1000, 800, 4200, 3000, layout, border);
        const output = exportGeometry(4200, 3000, layout, { scale, x: 0.2, y: -0.2 }, border);
        assert.ok(output.width <= 4200 && output.height <= 3000);
        assert.ok(output.left >= 0 && output.left + output.width <= 4200);
        assert.ok(output.top >= 0 && output.top + output.height <= 3000);
        assert.ok(frame.width > 0 && frame.height > 0);
        if (ratio) {
          assert.ok(Math.abs(frame.outerWidth / frame.outerHeight - ratio) < 1e-9);
          assert.ok(Math.abs(output.outputWidth - output.outputHeight * ratio) <= 1);
          assert.ok(Math.abs(frame.width / frame.height - output.width / output.height) < 0.01);
        }
      }
    }
  }
});

test('exports the original pixels at full resolution with the correct border color', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'cull-export-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const source = path.join(folder, 'source.png');
  await sharp({ create: { width: 4200, height: 3000, channels: 3, background: '#de320a' } }).png().toFile(source);
  const before = await fs.readFile(source);
  const destination = path.join(folder, 'bordered.png');
  const settings = { layout: 'square', crop: { scale: 1, x: 0, y: 0 }, border: { enabled: true, width: 3, color: '#ffffff' } };
  const result = await exportImage(source, destination, settings);
  const expected = exportGeometry(4200, 3000, settings.layout, settings.crop, settings.border);
  assert.ok(expected.width > 2600, 'Export uses the original rather than the 2600px preview');
  const metadata = await sharp(destination).metadata();
  assert.equal(metadata.width, expected.outputWidth);
  assert.equal(metadata.height, expected.outputHeight);
  assert.equal(result.width, expected.outputWidth);
  const pixel = async (left, top) => [...await sharp(destination).extract({ left, top, width: 1, height: 1 }).removeAlpha().raw().toBuffer()];
  assert.deepEqual(await pixel(0, 0), [255, 255, 255]);
  assert.deepEqual(await pixel(expected.padding + 10, expected.padding + 10), [222, 50, 10]);
  assert.deepEqual(await fs.readFile(source), before);
  await assert.rejects(exportImage(source, source, settings), /never overwrites/);
});

test('export follows crop position and correctly applies EXIF orientation', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'cull-export-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const source = path.join(folder, 'source.jpg');
  const blue = await sharp({ create: { width: 400, height: 600, channels: 3, background: '#0000ff' } }).png().toBuffer();
  await sharp({ create: { width: 800, height: 600, channels: 3, background: '#ff0000' } })
    .composite([{ input: blue, left: 400, top: 0 }]).jpeg({ quality: 100 }).toFile(source);
  for (const [x, channel] of [[0.25, 0], [-0.25, 2]]) {
    const destination = path.join(folder, `${channel}.png`);
    await exportImage(source, destination, { layout: 'square', crop: { scale: 2, x, y: 0 }, border: defaultBorder() });
    const color = [...await sharp(destination).extract({ left: 150, top: 150, width: 1, height: 1 }).raw().toBuffer()];
    assert.ok(color[channel] > 250, 'Crop selects the expected side of the original');
  }
  const rotated = path.join(folder, 'rotated.jpg');
  await sharp(source).withMetadata({ orientation: 6 }).toFile(rotated);
  const output = path.join(folder, 'rotated-export.jpg');
  const result = await exportImage(rotated, output, { layout: 'original', crop: { scale: 1, x: 0, y: 0 }, border: defaultBorder() });
  assert.equal(result.width, 600);
  assert.equal(result.height, 800);
  assert.equal((await sharp(output).metadata()).orientation, 1);
  const manuallyRotated = path.join(folder, 'manual-rotation.png');
  const turned = await exportImage(source, manuallyRotated, { layout: 'original', crop: { scale: 1, x: 0, y: 0 }, border: defaultBorder(), rotation: 90 });
  assert.equal(turned.width, 600);
  assert.equal(turned.height, 800);
  const topPixel = [...await sharp(manuallyRotated).extract({ left: 300, top: 100, width: 1, height: 1 }).removeAlpha().raw().toBuffer()];
  assert.ok(topPixel[0] > 250 && topPixel[2] < 5, 'User rotation is applied to the exported pixels');
});
