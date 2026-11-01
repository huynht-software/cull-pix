// Exercise the production main process with a temporary library and review history.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'cull-pix-open-'));
const folder = path.join(fixture, 'Photos with spaces');
fs.mkdirSync(folder);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6ioAAAAASUVORK5CYII=', 'base64');
for (const name of ['a.jpg', 'b.png', 'c.jpeg']) fs.writeFileSync(path.join(folder, name), png);
app.setPath('userData', path.join(fixture, 'profile'));
process.argv.push(path.join(folder, 'c.jpeg'));
app.on('browser-window-created', (_event, window) => window.hide());
require('../src/main');
app.emit('open-file', { preventDefault() {} }, path.join(folder, 'c.jpeg')); // Pre-ready Finder launch.

async function waitForImage(name) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const window = BrowserWindow.getAllWindows()[0];
    if (window && !window.webContents.isLoadingMainFrame()) {
      const current = await window.webContents.executeJavaScript("document.getElementById('main-image')?.alt");
      if (current === name) return window;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Image ${name} was not selected`);
}
app.whenReady().then(async () => {
  try {
    let window = await waitForImage('c.jpeg');
    assert.equal(await window.webContents.executeJavaScript("document.querySelectorAll('.thumb').length"), 3);
    await window.webContents.executeJavaScript("document.dispatchEvent(new KeyboardEvent('keydown', {key:'h',bubbles:true,cancelable:true}))");
    assert.equal(await window.webContents.executeJavaScript("document.querySelectorAll('.thumb').length"), 0);
    let prevented = false;
    app.emit('open-file', { preventDefault() { prevented = true; } }, path.join(folder, 'a.jpg'));
    window = await waitForImage('a.jpg');
    assert.equal(prevented, true);
    assert.equal(await window.webContents.executeJavaScript("document.querySelectorAll('.thumb').length"), 3);
    app.emit('second-instance', {}, [process.execPath, __filename, 'b.png'], folder);
    await waitForImage('b.png');
    window.destroy();
    app.emit('open-file', { preventDefault() {} }, path.join(folder, 'c.jpeg'));
    await waitForImage('c.jpeg');
    console.log('Production file opening passed: cold launch, Finder open-file, command-line second instance, paths with spaces, closed window reopening, hidden non-keeper selection.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
app.on('will-quit', () => fs.rmSync(fixture, { recursive: true, force: true }));
