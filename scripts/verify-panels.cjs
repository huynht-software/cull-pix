const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
app.disableHardwareAcceleration();
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'cull-pix-panels-')));
const pause = () => new Promise(resolve => setTimeout(resolve, 100));
const timeout = setTimeout(() => { console.error('Panel verification timed out'); app.exit(1); }, 20000);
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: true, width: 1440, height: 900, webPreferences: {
    preload: path.join(__dirname, 'fixtures/review-preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false
  } });
  const read = code => window.webContents.executeJavaScript(code);
  const width = id => read(`document.getElementById(${JSON.stringify(id)}).getBoundingClientRect().width`);
  async function drag(id, delta) {
    const point = await read(`(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 100) }; })()`);
    window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
    window.webContents.sendInputEvent({ type: 'mouseMove', x: point.x + delta, y: point.y });
    window.webContents.sendInputEvent({ type: 'mouseUp', x: point.x + delta, y: point.y, button: 'left', clickCount: 1 });
    await pause();
    assert.equal(await read("document.querySelectorAll('#sidebar details[data-section]').length"), 6, 'All sidebar groups are collapsible');
  }
  try {
    await window.loadFile(path.join(__dirname, '../src/renderer/index.html'));
    window.show();
    window.focus();
    window.webContents.focus();
    await pause();
    assert.equal(await read("document.getElementById('preview-options').open"), false, 'Options are collapsed by default');
    await read("document.querySelector('#preview-options summary').click()");
    assert.equal(await read("document.getElementById('preview-options').open"), true);
    const leftBefore = await width('sidebar');
    await drag('sidebar-resizer', 70);
    const leftAfter = await width('sidebar');
    assert.ok(leftAfter > leftBefore + 60, 'Dragging grows the left sidebar');
    const rightBefore = await width('filmstrip-panel');
    await drag('filmstrip-resizer', -220);
    const rightAfter = await width('filmstrip-panel');
    assert.ok(rightAfter > rightBefore + 200, 'Dragging grows the right sidebar');
    await drag('filmstrip-resizer', 60);
    assert.ok(await width('filmstrip-panel') < rightAfter - 50, 'Dragging shrinks the right sidebar');
    for (const columns of [1, 2, 3, 4]) {
      await read(`(() => { const select = document.getElementById('filmstrip-columns'); select.value = '${columns}'; select.dispatchEvent(new Event('change')); })()`);
      await pause();
      const grid = await read("(() => { const filmstrip = document.getElementById('filmstrip'); const r = [...filmstrip.children].map(item => item.getBoundingClientRect()); return { columns: getComputedStyle(filmstrip).gridTemplateColumns.split(' ').length, sameRow: r[0].top === r[1].top, differentColumn: r[0].left !== r[1].left }; })()");
      assert.equal(grid.columns, columns);
      assert.equal(grid.sameRow, columns > 1);
      assert.equal(grid.differentColumn, columns > 1);
    }
    await read("elements['show-filenames'].click()");
    assert.equal(await read("getComputedStyle(document.querySelector('.thumb-filename')).display"), 'block');
    await read("elements['photo-sort'].value = 'taken-asc'; elements['photo-sort'].dispatchEvent(new Event('change'))");
    await pause();
    assert.deepEqual(await read("state.images.map(image => image.name)"), ['b.png', 'a.png', 'c.png']);
    assert.equal(await read('state.selectedName'), 'b.png', 'Sorting preserves selected photo');
    await read("elements['photo-sort'].value = 'name-desc'; elements['photo-sort'].dispatchEvent(new Event('change'))");
    assert.deepEqual(await read("state.images.map(image => image.name)"), ['c.png', 'b.png', 'a.png']);
    const preferences = await read("JSON.parse(localStorage.getItem('panel-layout'))");
    await read("document.querySelector('[data-section=view]').open = false; document.querySelector('[data-section=shortcuts]').open = false");
    await pause();
    await window.webContents.reload();
    await pause();
    assert.equal(await read("document.querySelector('[data-section=view]').open"), false, 'Collapsed section survives reload');
    assert.equal(await read("document.querySelector('[data-section=shortcuts]').open"), false);
    assert.equal(await read('state.filmstripColumns'), 4);
    assert.equal(await read('state.showFilenames'), true);
    assert.equal(await read('state.photoSort'), 'name-desc');
    assert.equal(await read("document.getElementById('preview-options').open"), false);
    assert.equal(await width('sidebar'), preferences.sidebarWidth);
    assert.equal(await width('filmstrip-panel'), preferences.filmstripWidth);
    await read("elements['crop-layout'].value = 'square'; elements['crop-layout'].dispatchEvent(new Event('change'))");
    await pause();
    await read("document.querySelector('#preview-options summary').click()");
    await drag('filmstrip-resizer', -80);
    const crop = await read("(() => { const frame = elements['photo-viewport'].getBoundingClientRect(); const image = elements['main-image'].getBoundingClientRect(); return { ratio: frame.width / frame.height, filled: image.left <= frame.left + 1 && image.right >= frame.right - 1 && image.top <= frame.top + 1 && image.bottom >= frame.bottom - 1 }; })()");
    assert.ok(Math.abs(crop.ratio - 1) < 0.003 && crop.filled, 'Crop adapts to panel resizing');
    const screenshot = await window.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, '../node_modules/.panels-preview.png'), screenshot.toPNG());
    window.setSize(820, 650);
    for (let attempt = 0; attempt < 30 && await width('stage') < 270; attempt += 1) await pause();
    assert.ok(await width('stage') >= 270, 'Narrow windows preserve usable viewer space');
    await read("elements['toggle-sidebar'].click(); elements['toggle-filmstrip'].click()");
    assert.equal(await read("getComputedStyle(elements['sidebar-resizer']).display"), 'none');
    assert.equal(await read("getComputedStyle(elements['filmstrip-resizer']).display"), 'none');
    console.log('Panel checks passed: dragging both edges, 1–4 columns, inline collapsed options, filenames, EXIF sorting, selection preservation, saved preferences, crop framing and narrow windows.');
    clearTimeout(timeout);
    app.exit(0);
  } catch (error) { console.error(error); clearTimeout(timeout); app.exit(1); }
});
