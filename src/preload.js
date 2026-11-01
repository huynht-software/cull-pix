const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cullPix', {
  getInitialState: () => ipcRenderer.invoke('get-initial-state'),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  setStatus: (name, status) => ipcRenderer.invoke('set-status', { name, status }),
  setLayout: (folder, layout) => ipcRenderer.invoke('set-layout', { folder, layout }),
  setCrop: (folder, name, layout, crop) => ipcRenderer.invoke('set-crop', { folder, name, layout, crop }),
  copyKeepers: () => ipcRenderer.invoke('copy-keepers'),
  getNativePreview: (name, size) => ipcRenderer.invoke('native-preview', { name, size }),
  getThumbnail: (folder, name) => ipcRenderer.invoke('get-thumbnail', { folder, name }),
  getCaptureDates: folder => ipcRenderer.invoke('get-capture-dates', folder),
  appAction: action => ipcRenderer.invoke('app-action', action),
  setBorder: (folder, border) => ipcRenderer.invoke('set-border', { folder, border }),
  setRotation: (folder, name, rotation) => ipcRenderer.invoke('set-rotation', { folder, name, rotation }),
  getUpdateState: () => ipcRenderer.invoke('get-update-state'),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('update-state', listener);
    return () => ipcRenderer.removeListener('update-state', listener);
  },
  exportImage: settings => ipcRenderer.invoke('export-image', settings),
  onFolderChanged: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('folder-changed', listener);
    return () => ipcRenderer.removeListener('folder-changed', listener);
  }
});
