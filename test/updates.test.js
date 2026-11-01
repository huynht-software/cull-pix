const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdateController } = require('../src/updates');
const app = { getVersion: () => '1.1.0' };

test('automatically downloads stable updates and only installs a downloaded update', async () => {
  const updater = new EventEmitter();
  const events = [];
  let installed = false;
  updater.checkForUpdates = async () => { updater.emit('checking-for-update'); updater.emit('update-available', { version: '1.2.0' }); };
  updater.quitAndInstall = () => { installed = true; };
  const controller = createUpdateController({ app, updater, available: true, notify: event => events.push(event) });
  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, true);
  assert.equal(updater.allowPrerelease, false);
  assert.equal(controller.install(), false);
  await controller.check();
  assert.equal(controller.getState().status, 'downloading');
  updater.emit('download-progress', { percent: 48.8 });
  assert.match(controller.getState().message, /49%/);
  updater.emit('update-downloaded', { version: '1.2.0' });
  assert.equal(controller.getState().canInstall, true);
  assert.equal(controller.install(), true);
  assert.equal(installed, true);
  assert.ok(events.length >= 4);
});

test('offline checks fail quietly and can succeed on a later retry', async () => {
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => { throw new Error('ENOTFOUND github.com'); };
  const controller = createUpdateController({ app, updater, available: true });
  await controller.check();
  assert.equal(controller.getState().status, 'offline');
  updater.checkForUpdates = async () => updater.emit('update-not-available');
  await controller.check();
  assert.equal(controller.getState().status, 'current');
});

test('development/unsigned builds never contact the update server', async () => {
  const updater = new EventEmitter();
  updater.checkForUpdates = () => { throw new Error('Unexpected network request'); };
  const controller = createUpdateController({ app, updater, available: false });
  controller.start();
  assert.equal((await controller.check()).status, 'unavailable');
  assert.equal(controller.install(), false);
  controller.stop();
});
