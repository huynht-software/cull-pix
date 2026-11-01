const path = require('node:path');
const { packager } = require('@electron/packager');

const platform = process.argv[2];
if (platform !== 'darwin' && platform !== 'win32') {
  console.error('Usage: node scripts/package.js darwin|win32');
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
packager({
  dir: root,
  name: 'Cull Pix',
  executableName: 'Cull Pix',
  platform,
  arch: platform === 'darwin' ? process.arch : 'x64',
  appBundleId: 'com.local.cullpix',
  extendInfo: {
    CFBundleDocumentTypes: [{
      CFBundleTypeName: 'Image',
      CFBundleTypeRole: 'Viewer',
      LSHandlerRank: 'Alternate',
      CFBundleTypeExtensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'heic', 'heif', 'tif', 'tiff'],
      LSItemContentTypes: ['public.jpeg', 'public.png', 'public.tiff', 'com.compuserve.gif',
        'com.microsoft.bmp', 'public.heic', 'public.heif', 'org.webmproject.webp', 'public.avif']
    }]
  },
  out: path.join(root, 'dist'),
  overwrite: true,
  prune: true,
  ignore: [
    /^\/dist(\/|$)/,
    /^\/\.git(\/|$)/,
    /^\/test(\/|$)/
  ]
}).then(paths => {
  for (const packagedPath of paths) console.log(`Created ${packagedPath}`);
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
