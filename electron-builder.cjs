module.exports = {
  appId: 'com.local.cullpix',
  productName: 'Cull Pix',
  directories: { output: 'release' },
  files: ['src/**/*', 'package.json'],
  asarUnpack: ['node_modules/@img/**/*'],
  npmRebuild: false,
  extraMetadata: { autoUpdateSupported: process.platform !== 'darwin' || Boolean(process.env.CSC_LINK) },
  publish: [{ provider: 'github', owner: 'huynht-software', repo: 'cull-pix', releaseType: 'release' }],
  win: { target: [{ target: 'nsis', arch: ['x64'] }], executableName: 'Cull Pix' },
  nsis: { oneClick: true, perMachine: false, createStartMenuShortcut: true, createDesktopShortcut: false,
    shortcutName: 'Cull Pix', runAfterFinish: false, deleteAppDataOnUninstall: false },
  mac: { target: ['dmg', 'zip'], category: 'public.app-category.photography',
    identity: process.env.CSC_LINK ? undefined : null,
    notarize: Boolean(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID) },
  artifactName: 'Cull-Pix-${version}-${os}-${arch}.${ext}'
};
