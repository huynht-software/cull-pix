// Exercise Launch Services against a disposable copy of the packaged Mac app.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'cull-pix-launch-'));
const bundle = path.join(fixture, 'Cull Pix Test.app');
fs.cpSync(path.join(__dirname, '../dist/Cull Pix-darwin-arm64/Cull Pix.app'), bundle, { recursive: true, verbatimSymlinks: true });
const resources = path.join(bundle, 'Contents/Resources/app');
const archive = path.join(bundle, 'Contents/Resources/app.asar');
if (fs.existsSync(archive)) {
  require('@electron/asar').extractAll(archive, resources);
  fs.rmSync(archive);
  execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Delete :ElectronAsarIntegrity', path.join(bundle, 'Contents/Info.plist')]);
}
const metadata = JSON.parse(fs.readFileSync(path.join(resources, 'package.json')));
metadata.main = 'launch-check.cjs';
fs.writeFileSync(path.join(resources, 'package.json'), JSON.stringify(metadata));
execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :CFBundleIdentifier com.local.cullpix.test.${Date.now()}`, path.join(bundle, 'Contents/Info.plist')]);
const report = path.join(fixture, 'report.json');
const stop = path.join(fixture, 'stop');
const trace = path.join(fixture, 'trace.txt');
fs.writeFileSync(path.join(resources, 'launch-check.cjs'), `
const {app, BrowserWindow} = require('electron');
const fs = require('node:fs');
app.setPath('userData', ${JSON.stringify(path.join(fixture, 'profile'))});
const events = [];
const trace = (type, data) => fs.appendFileSync(${JSON.stringify(trace)}, JSON.stringify({pid:process.pid,type,data})+'\\n');
trace('boot', process.argv);
app.on('ready',()=>trace('ready'));
app.on('will-quit',()=>trace('quit'));
app.on('open-file', (_event, file) => (events.push({type:'open-file', file}),trace('open-file',file)));
app.on('second-instance', (_event, argv, cwd, data) => (events.push({type:'second-instance', argv, data}), trace('second-instance',{argv,data})));
require('./src/main');
const timer = setInterval(async () => {
  if(fs.existsSync(${JSON.stringify(stop)})) { clearInterval(timer); app.quit(); return; }
  const window = BrowserWindow.getAllWindows()[0];
  if(!window || window.webContents.isLoadingMainFrame()) return;
  try {
    const selected = await window.webContents.executeJavaScript("document.querySelector('.thumb.selected')?.dataset.name");
    fs.writeFileSync(${JSON.stringify(report)}, JSON.stringify({selected,events,pid:process.pid}));
  } catch {}
},100);
`);
execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle], {stdio:'pipe'});
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6ioAAAAASUVORK5CYII=', 'base64');
for (const name of ['a.jpg', 'b.jpg']) fs.writeFileSync(path.join(fixture, name), png);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(name) {
  for (let i = 0; i < 100; i++) {
    try { const state = JSON.parse(fs.readFileSync(report)); if(state.selected === name) return state; } catch {}
    await pause(100);
  }
  if(fs.existsSync(trace)) console.error(fs.readFileSync(trace,'utf8'));
  throw new Error(`Launch Services did not select ${name}; report: ${fs.existsSync(report) ? fs.readFileSync(report) : 'missing'}`);
}
(async () => {
  try {
    if (process.env.CULL_PIX_DEV_LAUNCH) {
      spawn(require('electron'), [resources, path.join(fixture, 'a.jpg')], {stdio:'ignore'});
    } else if (process.env.CULL_PIX_DIRECT_LAUNCH) {
      spawn(path.join(bundle, 'Contents/MacOS/Cull Pix'), [path.join(fixture, 'a.jpg')], {stdio:'ignore'});
    } else execFileSync('/usr/bin/open', ['-a', bundle, path.join(fixture, 'a.jpg')]);
    const first = await waitFor('a.jpg');
    execFileSync('/usr/bin/open', ['-a', bundle, path.join(fixture, 'b.jpg')]);
    const second = await waitFor('b.jpg');
    assert.equal(first.pid, second.pid, 'Warm opens must use the original process');
    execFileSync('/usr/bin/open', ['-a', bundle, path.join(fixture, 'a.jpg')]);
    const third = await waitFor('a.jpg');
    assert.equal(first.pid, third.pid, 'Repeated opens must keep using the original process');
    console.log(process.env.CULL_PIX_DEV_LAUNCH
      ? 'Real macOS file opening passed: Finder files forwarded to the running development copy.'
      : 'Real macOS file opening passed: cold launch and repeated images in the same running packaged app.');
  } finally {
    fs.writeFileSync(stop, '');
    await pause(700);
    fs.rmSync(fixture, {recursive:true,force:true});
  }
})().then(async () => {
  if (!process.env.CULL_PIX_DEV_LAUNCH && !process.env.CULL_PIX_DIRECT_LAUNCH) {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [__filename], {
        stdio: 'inherit', env: { ...process.env, CULL_PIX_DEV_LAUNCH: '1' }
      });
      child.on('error', reject);
      child.on('exit', code => code === 0 ? resolve() : reject(new Error('Development-copy file opening failed')));
    });
  }
}).catch(error => { console.error(error); process.exitCode = 1; });
