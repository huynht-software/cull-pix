const { app, BrowserWindow, Menu, dialog, ipcMain, clipboard, ClipboardItem, nativeImage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { isImageName, needsNativePreview } = require('./library');

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

async function saveStore() {
  const target = storePath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(store, null, 2));
  await fs.rename(temporary, target);
}

function folderState() {
  return {
    folder: currentFolder,
    selectedName: openedName,
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
  openedName = null;
  images = names.map(name => ({
    name,
    status: statuses[name] === 'keep' ? 'keep' : 'unreviewed',
    url: pathToFileURL(path.join(folder, name)).href,
    nativePreview: needsNativePreview(name)
  }));
  store.recentFolder = folder;
  await saveStore();
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
  await window.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  rendererReady = true;
}

function buildMenu() {
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

  ipcMain.handle('get-initial-state', async () => {
    await fileOpenQueue;
    if (!currentFolder && store.recentFolder) {
      try { await loadFolder(store.recentFolder); }
      catch (error) { console.error('Could not reopen recent folder:', error); }
    }
    return folderState();
  });

  ipcMain.handle('choose-folder', chooseFolder);

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
      size: { width: edge, height: edge }
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
