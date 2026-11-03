const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'cull-viewer-'));
app.setPath('userData', path.join(fixture, 'profile'));
const photos = path.join(fixture, 'photos');
fs.mkdirSync(photos);
const cold = process.env.CULL_PIX_COLD_VIEWER === '1';
let window;
const read = code => window.webContents.executeJavaScript(code);
const pause = () => new Promise(resolve => setTimeout(resolve, 40));
async function waitFor(code) {
  for (let i = 0; i < 250; i++) { try { if (await read(code)) return; } catch {} await pause(); }
  throw new Error(`Timed out: ${code}`);
}
const timeout = setTimeout(() => app.exit(1), 45000);
(async () => {
  // Unique, detailed 12 MP inputs so this measures actual decoding, not a tiny SVG.
  const pixels = Buffer.alloc(4200 * 2800 * 3);
  let seed = 12345;
  for (let i = 0; i < pixels.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; pixels[i] = seed >>> 24; }
  for (let i = 0; i < 6; i++) {
    pixels[i] ^= 127;
    await sharp(pixels, { raw: { width: 4200, height: 2800, channels: 3 } }).jpeg({ quality: 90 }).toFile(path.join(photos, `${i}.jpg`));
  }
  process.argv.push(path.join(photos, '0.jpg'));
  app.on('browser-window-created', (_event, created) => {
    created.webContents.setBackgroundThrottling(false);
    created.once('ready-to-show', () => created.show());
  });
  require('../src/main');
  await app.whenReady();
  while (!(window = BrowserWindow.getAllWindows()[0])) await pause();
  await waitFor('mainImageReady && state.images.length === 6');
  if (cold) await read('clearTimeout(neighborTimer); neighborGeneration++; scheduleNeighbors = () => {}; decodedNeighbors.clear()');
  const samples = [];
  for (let i = 1; i < 6; i++) {
    if (!cold) await waitFor(`decodedNeighbors.has(state.images[${i}].url) && !neighborWorker`);
    samples.push(await read(`(async () => {
      const start = performance.now();
      move(1);
      await elements['main-image'].decode();
      await new Promise(resolve => requestAnimationFrame(resolve));
      return performance.now() - start;
    })()`));
    await waitFor('mainImageReady');
    if (!cold) assert.ok(await read('[...decodedNeighbors.values()].reduce((sum, entry) => sum + entry.bytes, 0) <= neighborBudget && decodedNeighbors.size <= 2'));
  }
  // Rapid navigation must settle on the requested photo and cancel obsolete warming.
  await read('move(-1); move(-1); move(-1); move(1)');
  await waitFor("mainImageReady && elements['main-image'].src === state.images.find(image => image.name === state.selectedName).url");
  assert.equal(await read('state.selectedName'), '3.jpg');
  console.log(JSON.stringify({ mode: cold ? 'on-demand' : 'predecoded', megapixels: 11.76, samplesMs: samples, meanMs: samples.reduce((a, b) => a + b, 0) / samples.length }));
  clearTimeout(timeout);
  app.exit(0);
})().catch(error => { console.error(error); clearTimeout(timeout); app.exit(1); });
