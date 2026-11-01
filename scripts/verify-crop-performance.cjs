const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'cull-performance-')));
const baseline = process.argv.includes('--baseline');
const timeout = setTimeout(() => { console.error('Performance verification timed out'); app.exit(1); }, 30000);
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: true, width: 1440, height: 900, webPreferences: {
    preload: path.join(__dirname, 'fixtures/review-preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false
  } });
  try {
    await window.loadFile(path.join(__dirname, '../src/renderer/index.html'));
    window.show();
    const result = await window.webContents.executeJavaScript(`(async () => {
      const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
      await frame();
      const url = state.images[0].url;
      state.images = Array.from({ length: 1000 }, (_, index) => ({ name: index + '.png', url, crops: {}, status: 'unreviewed' }));
      state.selectedName = state.images[0].name;
      render();
      const imgs = [...elements.filmstrip.querySelectorAll('img')];
      for (const img of imgs) img.src = url;
      await Promise.all(imgs.map(img => img.decode()));
      await frame();
      let thumbnailUpdates = 0;
      let fullSizeCanvasDraws = 0;
      const originalUpdate = updateThumbnailCrop;
      updateThumbnailCrop = (...args) => { thumbnailUpdates += 1; return originalUpdate(...args); };
      const originalDraw = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function(source, ...args) {
        if (source === elements['main-image']) fullSizeCanvasDraws += 1;
        return originalDraw.call(this, source, ...args);
      };
      const timings = {};
      for (const layout of ['original', 'square']) {
        state.layout = layout;
        render();
        await elements['main-image'].decode();
        await frame();
        thumbnailUpdates = 0;
        fullSizeCanvasDraws = 0;
        const samples = [];
        for (let i = 0; i < 10; i += 1) {
          const start = performance.now();
          move(1);
          samples.push(performance.now() - start);
          await elements['main-image'].decode();
          await frame();
        }
        timings[layout] = { meanRenderMs: samples.reduce((a,b)=>a+b,0)/samples.length,
          thumbnailUpdates, fullSizeCanvasDraws };
      }
      let sourceChanges = 0;
      const observer = new MutationObserver(records => { sourceChanges += records.filter(record => record.attributeName === 'src').length; });
      observer.observe(elements['main-image'], { attributes: true });
      state.layout = 'portrait'; render();
      await frame();
      observer.disconnect();
      return { ...timings, layoutSourceChanges: sourceChanges };
    })()`);
    console.log(JSON.stringify(result));
    if (!baseline) {
      assert.equal(result.layoutSourceChanges, 0, 'Changing layout does not reload the photo');
      assert.equal(result.square.fullSizeCanvasDraws, 0, 'Overview never redraws the original full-resolution image');
      assert.ok(result.square.thumbnailUpdates <= 20, 'Navigation updates only selected thumbnails');
    }
    clearTimeout(timeout);
    app.exit(0);
  } catch (error) { console.error(error); clearTimeout(timeout); app.exit(1); }
});
