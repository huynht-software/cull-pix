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
  copyKeepers: async () => 1,
  getNativePreview: async () => '',
  testWrites: () => writes.slice(),
  testChangeFolder: () => changed({ folder: '/other', images })
});
