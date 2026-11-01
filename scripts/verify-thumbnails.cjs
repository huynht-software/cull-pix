// Exercise real Windows/macOS thumbnail generation and the production preload/IPC.
const { app, BrowserWindow, nativeImage, Menu } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const assert = require('node:assert/strict');
const { createThumbnailCache, CACHE_DIRECTORY } = require('../src/thumbnail-cache');
const { withCaptureDate } = require('./fixtures/exif-photo.cjs');

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'cull-pix-thumbnails-'));
const photos = path.join(fixture, 'Photos with spaces');
fs.mkdirSync(photos);
app.setPath('userData', path.join(fixture, 'profile'));
const original = nativeImage.createFromBitmap(Buffer.alloc(2000 * 1000 * 4, 160), { width: 2000, height: 1000 }).toJPEG(90);
const source = path.join(photos, 'test photo.jpg');
fs.writeFileSync(source, original);
for (let index = 0; index < 200; index += 1) {
  const jpeg = index < 2 ? withCaptureDate(original, index === 0 ? '2024:01:02 10:00:00' : '2025:02:03 11:00:00') : original;
  fs.writeFileSync(path.join(photos, `${String(index).padStart(3, '0')}.jpg`), jpeg);
}
process.argv.push(source);
app.on('browser-window-created', (_event, window) => {
  window.webContents.setBackgroundThrottling(false);
  window.once('ready-to-show', () => { window.show(); window.focus(); });
  window.webContents.on('console-message', (_event, details) => {
    if (details.level === 'error') console.error('Renderer:', details.message);
  });
});
require('../src/main');

const timeout = setTimeout(() => { console.error('Thumbnail integration timed out'); app.exit(1); }, 20000);
app.whenReady().then(async () => {
  try {
    let window;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      window = BrowserWindow.getAllWindows()[0];
      if (window?.webContents.getURL().endsWith('/index.html') && !window.webContents.isLoadingMainFrame()) {
        const ready = await window.webContents.executeJavaScript("Boolean(window.cullPix && document.querySelector('.thumb img')?.getAttribute('src'))");
        if (ready) break;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(window, 'Production window was created');
    if (process.platform !== 'darwin') assert.equal(Menu.getApplicationMenu(), null, 'No Windows menu bar');
    const url = await window.webContents.executeJavaScript(`window.cullPix.getThumbnail(${JSON.stringify(photos)}, 'test photo.jpg')`);
    const cachedFile = fileURLToPath(url);
    assert.equal(path.dirname(cachedFile), path.join(photos, CACHE_DIRECTORY));
    const size = nativeImage.createFromPath(cachedFile).getSize();
    assert.ok(size.width > 0 && size.width <= 320 && size.height > 0 && size.height <= 320);
    const freshSession = createThumbnailCache(() => { throw new Error('Cache hit should not decode the original'); });
    assert.equal(await freshSession.thumbnail(photos, 'test photo.jpg'), url);
    assert.equal(await window.webContents.executeJavaScript("document.getElementById('filmstrip').scrollTop"), 0,
      'Opening an image does not auto-center its thumbnail');
    for (let attempt = 0; attempt < 300; attempt += 1) {
      if (fs.readdirSync(path.join(photos, CACHE_DIRECTORY)).filter(name => name.endsWith('.jpg')).length === 201) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(fs.readdirSync(path.join(photos, CACHE_DIRECTORY)).filter(name => name.endsWith('.jpg')).length, 201,
      'The entire folder is cached without scrolling to unseen photos');
    await window.webContents.executeJavaScript("document.getElementById('filmstrip').scrollTop = 0");
    let firstThumbnail;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      firstThumbnail = await window.webContents.executeJavaScript("document.querySelector('.thumb img').getAttribute('src')");
      if (firstThumbnail) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(path.dirname(fileURLToPath(firstThumbnail)), path.join(photos, CACHE_DIRECTORY));
    assert.deepEqual(fs.readFileSync(source), original);
    const dates = await window.webContents.executeJavaScript(`window.cullPix.getCaptureDates(${JSON.stringify(photos)})`);
    assert.equal(dates['000.jpg'], Date.UTC(2024, 0, 2, 10));
    assert.equal(dates['001.jpg'], Date.UTC(2025, 1, 3, 11));
    assert.equal(dates['test photo.jpg'], null);
    await window.webContents.executeJavaScript("elements['photo-sort'].value = 'taken-desc'; elements['photo-sort'].dispatchEvent(new Event('change'))");
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await window.webContents.executeJavaScript('datesLoaded')) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.deepEqual(await window.webContents.executeJavaScript('state.images.slice(0,2).map(image => image.name)'), ['001.jpg', '000.jpg']);
    assert.equal(await window.webContents.executeJavaScript('state.selectedName'), 'test photo.jpg');
    const scrollPosition = await window.webContents.executeJavaScript("elements.filmstrip.scrollTop = 1000; elements.filmstrip.scrollTop");
    await window.webContents.executeJavaScript("elements.filmstrip.firstElementChild.click(); move(1)");
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await window.webContents.executeJavaScript('elements.filmstrip.scrollTop'), scrollPosition,
      'Changing selection and keyboard navigation preserve preview-panel scroll position');
    await window.webContents.executeJavaScript("document.getElementById('app-fullscreen').click()");
    for (let attempt = 0; attempt < 30 && !window.isFullScreen(); attempt += 1) await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(window.isFullScreen(), 'Sidebar fullscreen action works');
    if (process.platform !== 'darwin') {
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F11' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F11' });
    } else await window.webContents.executeJavaScript("window.cullPix.appAction('fullscreen')");
    for (let attempt = 0; attempt < 30 && window.isFullScreen(); attempt += 1) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(window.isFullScreen(), false, 'Fullscreen shortcut restores the window');
    await assert.rejects(window.webContents.executeJavaScript(`window.cullPix.getThumbnail(${JSON.stringify(photos)}, '../outside.jpg')`));
    console.log(`Thumbnail integration passed: stable selection scroll position, no menu bar, sidebar fullscreen, F11 shortcut, production IPC, ${size.width}×${size.height} JPEG, 201 photos cached without scrolling, actual EXIF date sorting, disk reuse, original preservation, invalid-name rejection.`);
    clearTimeout(timeout);
    app.exit(0);
  } catch (error) {
    console.error(error);
    clearTimeout(timeout);
    app.exit(1);
  }
});
