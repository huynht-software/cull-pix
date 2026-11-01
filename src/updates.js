function createUpdateController({ app, updater, available, unavailableReason, notify = () => {} }) {
  let checking;
  let timer;
  let startup;
  let state = { version: app.getVersion(), status: available ? 'idle' : 'unavailable', canInstall: false,
    message: available ? 'Updates are checked automatically.' : unavailableReason || 'Automatic updates require the installed release build.' };
  function publish(status, message, extra = {}) {
    state = { ...state, status, message, ...extra };
    notify({ ...state });
  }
  if (available) {
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.allowPrerelease = false;
    updater.on('checking-for-update', () => publish('checking', 'Checking GitHub for updates…'));
    updater.on('update-available', info => publish('downloading', `Downloading version ${info.version}…`));
    updater.on('download-progress', progress => publish('downloading', `Downloading update… ${Math.round(progress.percent)}%`));
    updater.on('update-not-available', () => publish('current', 'Cull Pix is up to date.'));
    updater.on('update-downloaded', info => publish('downloaded', `Version ${info.version} is ready. Restart to install.`, { canInstall: true }));
    updater.on('error', error => {
      if (state.canInstall) return;
      const offline = /ENOTFOUND|ENETUNREACH|ETIMEDOUT|ECONNRESET|ENETDOWN|ERR_INTERNET_DISCONNECTED/i.test(String(error));
      publish(offline ? 'offline' : 'error', offline ? 'Offline. Updates will be checked again automatically.' : 'Update check failed. It will retry automatically.');
    });
  }
  function check() {
    if (!available || state.canInstall) return Promise.resolve({ ...state });
    if (checking) return checking;
    checking = Promise.resolve().then(() => updater.checkForUpdates()).catch(error => {
      updater.emit('error', error);
    }).finally(() => { checking = null; });
    return checking.then(() => ({ ...state }));
  }
  function start() {
    if (!available || timer) return;
    startup = setTimeout(check, 10000);
    timer = setInterval(check, 60 * 60 * 1000);
    startup.unref?.();
    timer.unref?.();
  }
  function stop() { clearTimeout(startup); clearInterval(timer); timer = null; }
  function install() {
    if (!available || !state.canInstall) return false;
    updater.quitAndInstall(false, true);
    return true;
  }
  return { check, start, stop, install, getState: () => ({ ...state }) };
}
module.exports = { createUpdateController };
