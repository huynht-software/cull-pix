const { contextBridge } = require('electron');
let changed;
const writes = [];
const images = [
  { name: 'a.png', status: 'keep' },
  { name: 'b.png', status: 'unreviewed' },
  { name: 'c.png', status: 'keep' }
].map(image => ({ ...image, url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="green"/></svg>' }));
contextBridge.exposeInMainWorld('cullPix', {
  getInitialState: async () => ({ folder: '/fixture', images }),
  onFolderChanged: callback => { changed = callback; },
  chooseFolder: async () => null,
  setStatus: async (name, status) => { writes.push({ name, status }); return status; },
  setLayout: async () => {},
  setCrop: async () => {},
  getCaptureDates: async () => ({ 'a.png': 200, 'b.png': 100, 'c.png': null }),
  appAction: async () => {},
  setBorder: async () => {},
  resetEditing: async () => ({ layout: 'original', border: { enabled: false, width: 3, color: '#ffffff' }, crops: {}, rotation: 0 }),
  setRotation: async (_folder, _name, rotation) => ({ rotation, crops: {} }),
  getUpdateState: async () => ({ version: '1.1.0', status: 'unavailable', canInstall: false, message: 'Test session' }),
  onUpdateState: () => {},
  checkUpdates: async () => ({ version: '1.1.0', status: 'unavailable', canInstall: false, message: 'Test session' }),
  installUpdate: async () => false,
  exportImage: async () => null,
  copyKeepers: async () => 1,
  getNativePreview: async () => '',
  getThumbnail: async (_folder, name) => (images.find(image => image.name === name) || images[0]).url,
  testWrites: () => writes.slice(),
  testChangeFolder: () => changed({ folder: '/other', images })
});
