const { app, BrowserWindow, nativeImage, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { layouts } = require('../src/crop');

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'cull-pix-crops-'));
const photos = path.join(fixture, 'photos');
fs.mkdirSync(photos);
app.setPath('userData', path.join(fixture, 'profile'));
const pixels = Buffer.alloc(1600 * 1000 * 4);
for (let y = 0; y < 1000; y += 1) for (let x = 0; x < 1600; x += 1) {
  const index = (y * 1600 + x) * 4;
  pixels[index] = x < 800 ? 80 : 210;
  pixels[index + 1] = y < 500 ? 180 : 70;
  pixels[index + 2] = x % 200 < 100 ? 220 : 120;
  pixels[index + 3] = 255;
}
const original = nativeImage.createFromBitmap(pixels, { width: 1600, height: 1000 }).toJPEG(90);
const source = path.join(photos, 'a.jpg');
fs.writeFileSync(source, original);
fs.writeFileSync(path.join(photos, 'b.png'), nativeImage.createFromBitmap(Buffer.alloc(600 * 1200 * 4, 150), { width: 600, height: 1200 }).toPNG());
process.argv.push(source);
app.on('browser-window-created', (_event, window) => {
  window.webContents.setBackgroundThrottling(false);
  window.once('ready-to-show', () => { window.show(); window.focus(); });
});
require('../src/main');
let window;
const pause = () => new Promise(resolve => setTimeout(resolve, 80));
const read = expression => window.webContents.executeJavaScript(expression);
async function waitFor(check, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if (await check()) return; } catch { /* Wait for page readiness. */ }
    await pause();
  }
  throw new Error(message);
}
async function selectLayout(layout) {
  await read(`(() => { const select = document.getElementById('crop-layout'); select.value = ${JSON.stringify(layout)}; select.dispatchEvent(new Event('change')); })()`);
  await waitFor(() => read('mainImageReady && !elements["main-image"].hidden'), 'Image did not load after layout change');
}
async function assertFilled(ratio) {
  const bounds = await read(`(() => {
    const frame = elements['photo-viewport'].getBoundingClientRect();
    const image = elements['main-image'].getBoundingClientRect();
    return { ratio: frame.width / frame.height, filled: image.left <= frame.left + 1 && image.top <= frame.top + 1 && image.right >= frame.right - 1 && image.bottom >= frame.bottom - 1 };
  })()`);
  assert.ok(Math.abs(bounds.ratio - ratio) < 0.003, 'Frame keeps selected aspect ratio');
  assert.ok(bounds.filled, 'Photo fills crop without blank edges');
}
const timeout = setTimeout(() => { console.error('Crop integration timed out'); app.exit(1); }, 30000);
app.whenReady().then(async () => {
  try {
    await waitFor(async () => {
      window = BrowserWindow.getAllWindows()[0];
      return window?.webContents.getURL().endsWith('/index.html') && !window.webContents.isLoadingMainFrame()
        && await read('mainImageReady && state.images.length === 2');
    }, 'Production app did not become ready');
    if (process.platform !== 'darwin') assert.equal(Menu.getApplicationMenu(), null, 'Window menu bar is removed');
    for (const [layout, { ratio }] of Object.entries(layouts)) {
      if (!ratio) continue;
      await selectLayout(layout);
      await assertFilled(ratio);
      assert.equal(await read("elements['reset-crop'].disabled"), true, 'Changing only the ratio does not enable reset');
      await read("zoomAt(8, elements.stage.getBoundingClientRect().x + 100, elements.stage.getBoundingClientRect().y + 100); setZoomPosition(1e6, -1e6)");
      await assertFilled(ratio);
      await read("zoomAt(0.1, 0, 0)");
      await assertFilled(ratio);
      assert.equal(await read('zoom.scale'), 1);
    }
    await selectLayout('square');
    await read("elements['zoom-percent'].value = '137.5'; elements['zoom-percent'].dispatchEvent(new Event('input'))");
    assert.ok(Math.abs(await read('zoom.scale') - 1.375) < 1e-8, 'Exact fractional zoom percentage works');
    assert.equal(await read("elements['reset-crop'].disabled"), false, 'Manual zoom enables reset');
    await read("elements['zoom-in'].click()");
    assert.ok(Math.abs(await read('zoom.scale') - 1.385) < 1e-8, 'Plus button adds one percentage point');
    await read("elements['zoom-out'].click()");
    assert.ok(Math.abs(await read('zoom.scale') - 1.375) < 1e-8);
    await read("elements['zoom-slider'].value = '500'; elements['zoom-slider'].dispatchEvent(new Event('input'))");
    assert.ok(Math.abs(await read('zoom.scale') - Math.sqrt(8)) < 1e-8, 'Slider provides continuous logarithmic zoom');
    await assertFilled(1);
    await read('resetZoom()');
    window.focus();
    window.webContents.focus();
    await pause();
    const point = await read("(() => { const r = elements['photo-viewport'].getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()");
    window.webContents.sendInputEvent({ type: 'mouseWheel', ...point, deltaY: 120, deltaX: 0, canScroll: true });
    await pause();
    assert.ok(await read('zoom.scale > 1 && zoom.scale < 1.06'), 'Plain mouse wheel zooms within the crop in fine steps');
    assert.equal(await read("elements['reset-crop'].disabled"), false, 'Wheel zoom enables reset');
    await assertFilled(1);
    window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Input.synthesizePinchGesture', { ...point, scaleFactor: 1.5, gestureSourceType: 'mouse' });
    await pause();
    await assertFilled(1);
    assert.equal(window.webContents.getZoomFactor(), 1, 'Crop zoom does not magnify application UI');
    await read('resetZoom()');
    const drag = async () => {
      window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
      window.webContents.sendInputEvent({ type: 'mouseMove', x: point.x + 70, y: point.y });
      window.webContents.sendInputEvent({ type: 'mouseUp', x: point.x + 70, y: point.y, button: 'left', clickCount: 1 });
      await pause();
    };
    await drag();
    assert.equal(await read('zoom.x'), 0, 'Crop drag requires Space');
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
    await drag();
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
    assert.ok(await read('zoom.x > 0'), 'Space-drag changes the crop at base zoom');
    assert.equal(await read("elements['reset-crop'].disabled"), false, 'Panning at base zoom enables reset');
    await assertFilled(1);
    await read('zoomAt(2, elements.stage.getBoundingClientRect().x + 200, elements.stage.getBoundingClientRect().y + 200); rememberCrop(); flushCropSave()');
    const saved = await read('({...state.images[0].crops.square})');
    await read('move(1)');
    await waitFor(() => read('mainImageReady'), 'Second image did not load');
    await assertFilled(1);
    assert.equal(await read('zoom.scale'), 1, 'New images begin centered and filled');
    await read('move(-1)');
    await waitFor(() => read('mainImageReady'), 'First image did not reload');
    assert.equal(await read('zoom.scale'), saved.scale);
    assert.ok(Math.abs(await read('cropX') - saved.x) < 1e-8, 'Position survives navigation between different image shapes');
    window.setSize(1100, 760);
    await pause();
    await assertFilled(1);
    assert.ok(Math.abs(await read('cropX') - saved.x) < 1e-8, 'Resize keeps normalized crop position');
    await waitFor(async () => {
      const data = JSON.parse(fs.readFileSync(path.join(fixture, 'profile', 'reviews.json'), 'utf8'));
      return data.folders[photos]?.crops?.['a.jpg']?.square?.scale === saved.scale;
    }, 'Crop was not saved to disk');
    await window.webContents.reload();
    window.show();
    window.focus();
    await waitFor(() => read('mainImageReady && state.layout === "square" && zoom.scale === 2'), 'Saved layout and crop did not survive reload');
    await assertFilled(1);
    await waitFor(() => read("[...document.querySelectorAll('.thumb img')].every(img => img.complete && img.naturalWidth > 0)"), 'Thumbnail images did not load');
    await waitFor(() => read("elements['zoom-map-image'].getContext('2d').getImageData(10,10,1,1).data[3] === 255"), 'Overview thumbnail did not load');
    const screenshot = await window.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, '../node_modules/.crop-preview.png'), screenshot.toPNG());
    const centeredCrop = { scale: 1, x: 0, y: 0 };
    const assertReset = async () => {
      assert.equal(await read('state.layout'), 'square', 'Reset keeps the selected ratio');
      assert.equal(await read("elements['reset-crop'].disabled"), true, 'Reset is disabled for a centered crop at minimum zoom');
      assert.deepEqual(await read('({ scale: zoom.scale, x: cropX, y: cropY })'), centeredCrop, 'Reset centers the crop at minimum zoom');
      assert.deepEqual(await read('state.images[0].crops.square'), centeredCrop, 'Reset updates the saved crop and thumbnail source');
      await assertFilled(1);
      await waitFor(async () => {
        const data = JSON.parse(fs.readFileSync(path.join(fixture, 'profile', 'reviews.json'), 'utf8'));
        return JSON.stringify(data.folders[photos]?.crops?.['a.jpg']?.square) === JSON.stringify(centeredCrop);
      }, 'Reset crop was not saved to disk');
    };
    // Reset while an edited crop is still waiting for its debounced save.
    await read("zoomFromControl(3); setZoomPosition(90, -60); rememberCrop(); elements['reset-crop'].click()");
    await assertReset();
    await read('move(1)');
    await waitFor(() => read('mainImageReady'), 'Second image did not load after reset');
    await read('move(-1)');
    await waitFor(() => read('mainImageReady'), 'Reset image did not reload');
    await assertReset();
    await read("zoomFromControl(2); setZoomPosition(70, -40); rememberCrop(); elements['reset-crop'].focus()");
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
    await pause();
    await assertReset();
    await window.webContents.reload();
    await waitFor(() => read('mainImageReady && state.layout === "square"'), 'Reset crop did not reload');
    await assertReset();
    await selectLayout('original');
    assert.equal(await read('zoom.scale'), 1);
    await read("api.appAction('fullscreen')");
    await waitFor(() => window.isFullScreen(), 'Sidebar fullscreen action did not work');
    await read("api.appAction('fullscreen')");
    await waitFor(() => !window.isFullScreen(), 'Sidebar fullscreen action did not restore window');
    assert.deepEqual(fs.readFileSync(source), original, 'Original photo stays unchanged');
    console.log('Crop integration passed: fractional percentage, slider, +/- buttons, fine wheel steps without Ctrl, all ratios, native pinch, Space-drag, saved crops, resize, reload and original mode.');
    clearTimeout(timeout);
    app.exit(0);
  } catch (error) {
    console.error(error);
    if (window && !window.isDestroyed()) console.error(await read("JSON.stringify({root:elements.filmstrip.getBoundingClientRect().toJSON(), scroll:elements.filmstrip.scrollTop, thumbs:[...document.querySelectorAll('.thumb img')].map(img => ({src:img.getAttribute('src'),complete:img.complete,width:img.naturalWidth,rect:img.parentElement.getBoundingClientRect().toJSON()}))})").catch(() => 'Renderer unavailable'));
    clearTimeout(timeout); app.exit(1);
  }
});
