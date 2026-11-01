const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cullPix', {
  getInitialState: () => ipcRenderer.invoke('get-initial-state'),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  setStatus: (name, status) => ipcRenderer.invoke('set-status', { name, status }),
  copyKeepers: () => ipcRenderer.invoke('copy-keepers'),
  getNativePreview: (name, size) => ipcRenderer.invoke('native-preview', { name, size }),
  onFolderChanged: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('folder-changed', listener);
    return () => ipcRenderer.removeListener('folder-changed', listener);
  }
});
