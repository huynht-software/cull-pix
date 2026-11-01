// Run a hidden, isolated Electron window against fixture data; no personal review data is used.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cull-pix-check-'));
app.setPath('userData', profile);
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: {
    preload: path.join(__dirname, 'fixtures/review-preload.cjs'), contextIsolation: true, sandbox: false
  } });
  try {
    await window.loadFile(path.join(__dirname, '../src/renderer/index.html'));
    const result = await window.webContents.executeJavaScript(`(async () => {
      const check = (condition, message) => { if (!condition) throw new Error(message); };
      const key = (key, options = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }));
      const tick = () => new Promise(resolve => setTimeout(resolve, 0));
      const selected = () => document.querySelector('.thumb.selected')?.dataset.name;
      const modal = () => document.getElementById('unmark-dialog').open;
      await tick();
      check(selected() === 'b.png', 'Start on the first unmarked photo');
      check(document.getElementById('toggle-loop').getAttribute('aria-pressed') === 'false', 'Looping defaults off');
      key('ArrowUp'); key('ArrowUp'); check(selected() === 'a.png', 'Previous stops at first photo');
      check(document.getElementById('previous').disabled, 'Previous button disabled at start');
      key('ArrowDown'); key('ArrowDown'); key('ArrowDown'); check(selected() === 'c.png', 'Next stops at last photo');
      check(document.getElementById('next').disabled, 'Next button disabled at end');
      document.getElementById('toggle-loop').click();
      key('j'); check(selected() === 'a.png', 'Loop allows last to first');
      key('k'); check(selected() === 'c.png', 'Loop allows first to last');
      document.getElementById('toggle-loop').click();
      key('k'); check(selected() === 'b.png', 'Loop can be turned off');
      const thumbnail = document.querySelector('.thumb');
      key('ArrowDown'); check(selected() === 'c.png', 'Down moves down');
      key('k'); check(selected() === 'b.png', 'K moves up');
      key('j'); check(selected() === 'c.png', 'J moves down');
      key('ArrowUp'); check(selected() === 'b.png', 'Up moves up');
      check(thumbnail === document.querySelector('.thumb'), 'Navigation preserves thumbnail nodes');
      key('x'); key('2'); await tick();
      check(window.cullPix.testWrites().length === 0, 'Removed rejection keys do nothing');
      key('h'); check(document.querySelectorAll('.thumb').length === 2, 'Hide excludes all unmarked photos');
      check(selected() === 'c.png', 'Hiding an unmarked selection selects a keeper');
      for (const cancelKey of ['ArrowDown', ' ', 'Escape', 'Tab', 'Shift', 'l']) {
        key('l'); check(modal(), 'L on a keeper opens confirmation');
        key(cancelKey); await tick();
        check(!modal() && selected() === 'c.png', 'Other keys cancel without navigation');
        check(window.cullPix.testWrites().length === 0, 'Cancellation never writes a decision');
      }
      document.getElementById('keep').click(); check(modal(), 'Unmark button opens confirmation');
      key('Enter'); await tick();
      check(!modal() && selected() === 'a.png', 'Confirm selects remaining keeper');
      check(document.querySelectorAll('.thumb').length === 1, 'Confirmed unmark disappears from keeper-only view');
      key('l'); key('Enter'); await tick();
      check(document.querySelectorAll('.thumb').length === 0, 'Last keeper can be unmarked');
      check(!document.getElementById('empty-state').hidden, 'Empty state shown after last keeper');
      key('h'); check(document.querySelectorAll('.thumb').length === 3, 'Show restores all photos');
      key('l'); await tick();
      check(window.cullPix.testWrites().at(-1).status === 'keep', 'L on an unmarked photo marks a keeper');
      key('ArrowUp'); key('l'); check(modal(), 'Keeper can be unmarked again');
      window.cullPix.testChangeFolder(); await tick();
      check(!modal(), 'Folder changes cancel stale confirmations');
      key('Enter'); await tick();
      check(window.cullPix.testWrites().length === 3, 'Stale confirmation cannot change new folder');
      key('ArrowDown'); check(selected() === 'c.png', 'Select final keeper');
      key('l'); key('Enter'); await tick();
      check(selected() === 'c.png', 'Unmark at end stays there in full view');
      key('l'); await tick();
      check(selected() === 'c.png', 'Marking at end does not loop by default');
      document.getElementById('toggle-loop').click();
      key('l'); key('Enter'); await tick();
      check(selected() === 'a.png', 'Decisions loop when enabled');
      return window.cullPix.testWrites();
    })()`);
    assert.deepEqual(result.map(write => write.status), ['unreviewed', 'unreviewed', 'keep', 'unreviewed', 'keep', 'unreviewed']);
    console.log('Renderer checks passed: vertical navigation, stable thumbnails, keeper-only filter, modal cancellation/confirmation, empty view, folder changes.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    window.destroy();
    app.quit();
  }
}).finally(() => { fs.rmSync(profile, { recursive: true, force: true }); });
