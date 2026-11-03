const { app, BrowserWindow, Menu, dialog, ipcMain, clipboard, ClipboardItem, nativeImage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { isImageName, needsNativePreview } = require('./library');
const { createThumbnailCache } = require('./thumbnail-cache');
const { layouts, validCrop, validBorder, defaultBorder, validRotation, rotateCrop } = require('./crop');
const { exportImage } = require('./export-image');
const { createUpdateController } = require('./updates');
let updates;
if (app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), 'cull-pix'));
const { createCaptureDateReader } = require('./capture-dates');
const captureDates = createCaptureDateReader();
const dateRequests = new Map();
let folderGeneration = 0;

const thumbnails = createThumbnailCache(async (source, edge) => {
  const image = await nativeImage.createThumbnailFromPath(source, { width: edge, height: edge });
  if (image.isEmpty()) throw new Error('Thumbnail unavailable for this format');
  return image.toJPEG(80);
});

let window;
let currentFolder = null;
let images = [];
let openedName = null;
let rendererReady = false;
let resolveStartup;
const startupReady = new Promise(resolve => { resolveStartup = resolve; });
let fileOpenQueue = Promise.resolve();

function imageArgument(argv, workingDirectory = process.cwd()) {
  const file = argv.slice(app.isPackaged ? 1 : 2)
    .find(argument => !argument.startsWith('-') && isImageName(argument));
  return file ? path.resolve(workingDirectory, file) : null;
}

function enqueueImage(file) {
  if (!file) return;
  fileOpenQueue = fileOpenQueue.then(() => startupReady).then(async () => {
    const resolved = path.resolve(file);
    if (!isImageName(resolved) || !(await fs.stat(resolved)).isFile()) {
      throw new Error('Choose a supported image file.');
    }
    await loadFolder(path.dirname(resolved));
    openedName = path.basename(resolved);
    if (!window || window.isDestroyed()) await createWindow();
    if (rendererReady) window.webContents.send('folder-changed', folderState());
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }).catch(error => dialog.showErrorBox('Could not open image', error.message));
}

// macOS delivers the launch document before ready. Acquire the shared lock
// afterward so the file can travel with the notification to an existing copy.
let hasInstanceLock;
let launchImage = imageArgument(process.argv);
let secondaryQuitTimer;
app.on('open-file', (event, file) => {
  event.preventDefault();
  launchImage = file;
  if (hasInstanceLock === false) {
    const tookOver = app.requestSingleInstanceLock({ imagePath: file });
    if (tookOver) app.relaunch({ args: process.argv.slice(1).concat([file]) });
    clearTimeout(secondaryQuitTimer);
    secondaryQuitTimer = setTimeout(() => app.quit(), 100);
  } else enqueueImage(file);
});
const instanceReady = process.platform === 'darwin'
  ? app.whenReady().then(() => {
    hasInstanceLock = app.requestSingleInstanceLock({ imagePath: launchImage });
    return hasInstanceLock;
  })
  : Promise.resolve(hasInstanceLock = app.requestSingleInstanceLock({ imagePath: launchImage }));
app.on('second-instance', (_event, argv, workingDirectory, additionalData) => {
  const file = typeof additionalData?.imagePath === 'string'
    ? additionalData.imagePath
    : imageArgument(argv, workingDirectory);
  if (file) enqueueImage(file);
  else startupReady.then(async () => {
    if (!window || window.isDestroyed()) await createWindow();
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
});
enqueueImage(launchImage);
let store = { version: 1, recentFolder: null, folders: {} };

function storePath() {
  return path.join(app.getPath('userData'), 'reviews.json');
}

async function readStore() {
  try {
    const data = JSON.parse(await fs.readFile(storePath(), 'utf8'));
    if (data && data.version === 1 && data.folders && typeof data.folders === 'object') {
      store = data;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Could not read review history:', error);
  }
}

let storeWrites = Promise.resolve();
function saveStore() {
  const target = storePath();
  const snapshot = JSON.stringify(store, null, 2);
  storeWrites = storeWrites.catch(() => {}).then(async () => {
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.tmp`;
    await fs.writeFile(temporary, snapshot);
    await fs.rename(temporary, target);
  });
  return storeWrites;
}

function folderState() {
  return {
    folder: currentFolder,
    selectedName: openedName,
    layout: store.folders[currentFolder]?.layout || 'original',
    border: store.folders[currentFolder]?.border || defaultBorder(),
    images: images.map(image => ({ ...image }))
  };
}

async function loadFolder(folder) {
  const entries = await fs.readdir(folder, { withFileTypes: true });
  const names = entries
    .filter(entry => entry.isFile() && isImageName(entry.name))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  const statuses = store.folders[folder]?.statuses || {};
  currentFolder = folder;
  folderGeneration += 1;
  openedName = null;
  images = names.map(name => ({
    name,
    status: statuses[name] === 'keep' ? 'keep' : 'unreviewed',
    url: pathToFileURL(path.join(folder, name)).href,
    nativePreview: needsNativePreview(name),
    crops: store.folders[folder]?.crops?.[name] || {},
    rotation: store.folders[folder]?.rotations?.[name] || 0
  }));
  store.recentFolder = folder;
  await saveStore();
  thumbnails.warmFolder(folder, names);
  return folderState();
}

async function chooseFolder() {
  const result = await dialog.showOpenDialog(window, {
    title: 'Choose a folder of photos',
    defaultPath: currentFolder || app.getPath('pictures'),
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths.length) return null;
  return loadFolder(result.filePaths[0]);
}

async function createWindow() {
  rendererReady = false;
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 820,
    minHeight: 600,
    title: 'Cull Pix',
    backgroundColor: '#10131b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.on('closed', () => { window = null; rendererReady = false; });
  if (process.platform !== 'darwin') {
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const key = input.key.toLowerCase();
      const command = input.control && !input.alt && !input.meta;
      if (command && key === 'o') {
        event.preventDefault();
        chooseFolder().then(state => {
          if (state && window && !window.isDestroyed()) window.webContents.send('folder-changed', state);
        }).catch(error => dialog.showErrorBox('Could not open folder', error.message));
      } else if (key === 'f11') {
        event.preventDefault();
        window.setFullScreen(!window.isFullScreen());
      } else if (command && key === 'r') {
        event.preventDefault();
        window.webContents.reload();
      } else if (command && key === 'q') {
        event.preventDefault();
        app.quit();
      } else if (command && key === 'c') {
        event.preventDefault();
        window.webContents.copy();
      } else if (command && key === 'a') {
        event.preventDefault();
        window.webContents.selectAll();
      }
    });
  }
  await window.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  rendererReady = true;
}

function buildMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Folder…',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            try {
              const state = await chooseFolder();
              if (state) window.webContents.send('folder-changed', state);
            } catch (error) {
              dialog.showErrorBox('Could not open folder', error.message);
            }
          }
        },
        { role: 'quit' }
      ]
    },
    { label: 'Edit', submenu: [{ role: 'copy' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  if (!await instanceReady) {
    if (process.platform === 'darwin' && !launchImage) {
      secondaryQuitTimer = setTimeout(() => app.quit(), 1500);
    } else app.quit();
    return;
  }
  await readStore();
  updates = createUpdateController({ app, updater: require('electron-updater').autoUpdater,
    available: app.isPackaged && require('../package.json').autoUpdateSupported !== false
      && require('node:fs').existsSync(path.join(process.resourcesPath, 'app-update.yml')),
    unavailableReason: process.platform === 'darwin' && require('../package.json').autoUpdateSupported === false
      ? 'Automatic updates on macOS require an Apple-signed release build.' : undefined,
    notify: state => { for (const target of BrowserWindow.getAllWindows()) target.webContents.send('update-state', state); } });
  ipcMain.handle('get-update-state', () => updates.getState());
  ipcMain.handle('check-updates', () => updates.check());
  ipcMain.handle('install-update', () => updates.install());
  updates.start();

  ipcMain.handle('get-initial-state', async () => {
    await fileOpenQueue;
    if (!currentFolder && store.recentFolder) {
      try { await loadFolder(store.recentFolder); }
      catch (error) { console.error('Could not reopen recent folder:', error); }
    }
    return folderState();
  });

  ipcMain.handle('choose-folder', chooseFolder);

  ipcMain.handle('set-border', async (_event, { folder, border }) => {
    if (!folder || folder !== currentFolder || !validBorder(border)) throw new Error('Invalid border settings');
    store.folders[folder] ||= { statuses: {} };
    store.folders[folder].border = { ...border };
    await saveStore();
  });

  ipcMain.handle('reset-editing', async (_event, { folder, name }) => {
    const image = images.find(image => image.name === name);
    if (!folder || folder !== currentFolder || !image) throw new Error('Invalid photo reset');
    const saved = store.folders[folder] ||= { statuses: {} };
    saved.layout = 'original';
    saved.border = defaultBorder();
    if (saved.crops) delete saved.crops[name];
    if (saved.rotations) delete saved.rotations[name];
    image.crops = {};
    image.rotation = 0;
    await saveStore();
    return { layout: saved.layout, border: saved.border, crops: {}, rotation: 0 };
  });

  ipcMain.handle('export-image', async (_event, { folder, name, layout, crop, border, rotation = 0 }) => {
    if (!folder || folder !== currentFolder || !images.some(image => image.name === name)
        || !Object.hasOwn(layouts, layout) || !validCrop(crop) || !validBorder(border) || !validRotation(rotation)) throw new Error('Invalid export request');
    const source = path.join(folder, name);
    const result = await dialog.showSaveDialog(window, {
      title: 'Export image with crop and border',
      defaultPath: path.join(typeof store.exportFolder === 'string' ? store.exportFolder : folder, `${path.parse(name).name}-${layout}-export.jpg`),
      filters: [{ name: 'JPEG image', extensions: ['jpg', 'jpeg'] }, { name: 'PNG image', extensions: ['png'] }]
    });
    if (result.canceled || !result.filePath) return null;
    if (path.dirname(result.filePath).toLowerCase() === folder.toLowerCase()
        && images.some(image => image.name.toLowerCase() === path.basename(result.filePath).toLowerCase())) {
      throw new Error('Choose a new filename so the original photos stay unchanged.');
    }
    const exported = await exportImage(source, result.filePath, { layout, crop, border, rotation });
    store.exportFolder = path.dirname(result.filePath);
    await saveStore();
    return exported;
  });

  ipcMain.handle('set-rotation', async (_event, { folder, name, rotation }) => {
    const image = images.find(image => image.name === name);
    if (!folder || folder !== currentFolder || !image || !validRotation(rotation)) throw new Error('Invalid photo rotation');
    const turns = ((rotation - (image.rotation || 0) + 360) % 360) / 90;
    const crops = {};
    for (const [layout, crop] of Object.entries(image.crops)) if (validCrop(crop)) crops[layout] = rotateCrop(crop, turns);
    image.rotation = rotation;
    image.crops = crops;
    store.folders[folder] ||= { statuses: {} };
    store.folders[folder].rotations ||= {};
    store.folders[folder].rotations[name] = rotation;
    store.folders[folder].crops ||= {};
    store.folders[folder].crops[name] = crops;
    await saveStore();
    return { rotation, crops };
  });

  ipcMain.handle('app-action', (_event, action) => {
    if (action === 'fullscreen') window?.setFullScreen(!window.isFullScreen());
    else if (action === 'reload') window?.webContents.reload();
    else if (action === 'quit') app.quit();
    else throw new Error('Unknown app action');
  });

  ipcMain.handle('get-capture-dates', async (_event, folder) => {
    if (!folder || folder !== currentFolder) throw new Error('Photo folder is no longer open');
    const generation = folderGeneration;
    if (!dateRequests.has(generation)) {
      dateRequests.set(generation, captureDates.readFolder(folder, images.map(image => image.name), () => folderGeneration === generation));
    }
    try { return await dateRequests.get(generation); }
    finally { dateRequests.delete(generation); }
  });

  ipcMain.handle('set-layout', async (_event, { folder, layout }) => {
    if (folder !== currentFolder || !folder || !Object.hasOwn(layouts, layout)) throw new Error('Invalid crop layout');
    store.folders[folder] ||= { statuses: {} };
    store.folders[folder].layout = layout;
    await saveStore();
  });

  ipcMain.handle('set-crop', async (_event, { folder, name, layout, crop }) => {
    if (!folder || !Object.hasOwn(layouts, layout) || layout === 'original' || !validCrop(crop)) {
      throw new Error('Invalid crop');
    }
    // A debounced save may arrive just after the user opens another folder.
    const knownFolder = store.folders[folder];
    if (!knownFolder) throw new Error('Unknown photo folder');
    if (!isImageName(name) || path.basename(name) !== name) throw new Error('Invalid image name');
    const saved = { scale: crop.scale, x: crop.x, y: crop.y };
    knownFolder.crops ||= {};
    knownFolder.crops[name] ||= {};
    knownFolder.crops[name][layout] = saved;
    if (folder === currentFolder) {
      const image = images.find(image => image.name === name);
      if (image) image.crops[layout] = saved;
    }
    await saveStore();
  });

  ipcMain.handle('get-thumbnail', async (_event, { folder, name }) => {
    if (!currentFolder || folder !== currentFolder || !images.some(image => image.name === name)) {
      throw new Error('Image is no longer in the open folder');
    }
    return thumbnails.thumbnail(folder, name);
  });

  ipcMain.handle('set-status', async (_event, { name, status }) => {
    if (status !== 'keep' && status !== 'unreviewed') {
      throw new Error('Invalid review status');
    }
    const image = images.find(candidate => candidate.name === name);
    if (!image || !currentFolder) throw new Error('Image is no longer in the open folder');
    image.status = status;
    if (!store.folders[currentFolder]) store.folders[currentFolder] = { statuses: {} };
    if (status === 'unreviewed') delete store.folders[currentFolder].statuses[name];
    else store.folders[currentFolder].statuses[name] = status;
    await saveStore();
    return status;
  });

  ipcMain.handle('copy-keepers', async () => {
    if (!currentFolder) throw new Error('Open a folder first');
    const paths = images
      .filter(image => image.status === 'keep')
      .map(image => path.join(currentFolder, image.name));
    if (!paths.length) throw new Error('Mark at least one photo as a keeper first');
    const existing = (await Promise.all(paths.map(async file => {
      try { await fs.access(file); return file; }
      catch { return null; }
    }))).filter(Boolean);
    if (!existing.length) throw new Error('The keeper files could not be found');

    await clipboard.write([
      new ClipboardItem({
        'text/uri-list': existing.map(file => pathToFileURL(file).href).join('\r\n')
      })
    ]);
    return existing.length;
  });

  ipcMain.handle('native-preview', async (_event, { name, size }) => {
    if (!currentFolder || !needsNativePreview(name) || !images.some(image => image.name === name)) {
      throw new Error('Invalid image preview request');
    }
    const edge = size === 320 ? 320 : 2600;
    const image = await nativeImage.createThumbnailFromPath(path.join(currentFolder, name), {
      width: edge, height: edge
    });
    if (image.isEmpty()) throw new Error('A preview is unavailable for this format on this computer');
    return image.toDataURL();
  });

  buildMenu();
  createWindow();
  resolveStartup();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('will-quit', () => updates?.stop());
