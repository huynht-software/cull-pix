const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const assert = require('node:assert/strict');
const timeout = setTimeout(() => { console.error('Zoom verification timed out'); app.exit(1); }, 20000);
app.whenReady().then(async () => {
  // Chromium's native gesture synthesis needs a visible compositor on Windows.
  const window = new BrowserWindow({ show: true, width: 1440, height: 900, webPreferences: {
    preload: path.join(__dirname, 'fixtures/review-preload.cjs'), contextIsolation: true, sandbox: false
  } });
  const read = expression => window.webContents.executeJavaScript(expression);
  const pause = () => new Promise(resolve => setTimeout(resolve, 100));
  const scale = () => read("new DOMMatrix(getComputedStyle(document.getElementById('main-image')).transform).a");
  try {
    await window.loadFile(path.join(__dirname, '../src/renderer/index.html'));
    await pause();
    const point = await read("(() => {const r=document.getElementById('stage').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()");
    window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Input.synthesizePinchGesture', {
      ...point, scaleFactor: 1.8, gestureSourceType: 'mouse'
    });
    await pause();
    assert.ok(await scale() > 1, 'Chromium pinch gestures zoom the image');
    assert.equal(window.webContents.getZoomFactor(), 1, 'Application UI remains unzoomed');
    assert.equal(await read('window.visualViewport.scale'), 1, 'Browser visual zoom remains unchanged');
    await read("document.getElementById('reset-zoom').click()");
    assert.equal(await scale(), 1, 'Fit resets pinch zoom');
    assert.equal(await read("document.getElementById('zoom-map').hidden"), true, 'Overview hidden at fit');
    window.webContents.sendInputEvent({ type: 'mouseWheel', ...point, deltaY: 60, deltaX: 0, modifiers: ['control'], canScroll: true });
    await pause();
    assert.ok(await scale() > 1, 'Ctrl+mouse wheel zooms in');
    const zoomed = await scale();
    window.webContents.sendInputEvent({ type: 'mouseWheel', ...point, deltaY: -20, deltaX: 0, modifiers: ['control'], canScroll: true });
    await pause();
    assert.ok(await scale() < zoomed, 'Reverse Ctrl+mouse wheel zooms out');
    await read('zoomFromControl(2)'); // Fine wheel steps intentionally no longer jump straight to deep zoom.
    window.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});
    window.webContents.sendInputEvent({type:'mouseMove',x:point.x+80,y:point.y+50});
    window.webContents.sendInputEvent({type:'mouseUp',x:point.x+80,y:point.y+50,button:'left',clickCount:1});
    await pause();
    assert.ok(await read("new DOMMatrix(document.getElementById('main-image').style.transform).e > 0"), 'Dragging pans the photo');
    await read("document.getElementById('stage').dispatchEvent(new WheelEvent('wheel',{deltaX:20,deltaY:10,bubbles:true,cancelable:true}))");
    assert.ok(await read("new DOMMatrix(document.getElementById('main-image').style.transform).e < 80"), 'Unmodified trackpad scroll pans');
    await read("document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',bubbles:true,cancelable:true}))");
    assert.equal(await scale(), 1, 'Z resets zoom');
    await read("document.getElementById('stage').dispatchEvent(new MouseEvent('dblclick',{clientX:"+point.x+",clientY:"+point.y+",bubbles:true}))");
    assert.equal(await scale(), 2, 'Double-click zooms in from fit');
    assert.equal(await read("document.getElementById('zoom-map').hidden"), false, 'Overview appears when zoomed');
    assert.ok(await read("parseFloat(document.getElementById('zoom-map-viewport').style.width) < 100"), 'Rectangle shows visible fraction');
    const mapPoint = await read("(() => {const r=document.getElementById('zoom-map-image').getBoundingClientRect(); return {x:Math.round(r.left+r.width*0.75),y:Math.round(r.top+r.height*0.75)};})()");
    window.webContents.sendInputEvent({type:'mouseDown',...mapPoint,button:'left',clickCount:1});
    window.webContents.sendInputEvent({type:'mouseUp',...mapPoint,button:'left',clickCount:1});
    await pause();
    assert.ok(await read("new DOMMatrix(document.getElementById('main-image').style.transform).e < 0"), 'Overview click pans to right side');
    assert.ok(await read("parseFloat(document.getElementById('zoom-map-viewport').style.left) > 25"), 'Rectangle follows panning');
    window.webContents.sendInputEvent({type:'mouseDown',...mapPoint,button:'left',clickCount:1});
    window.webContents.sendInputEvent({type:'mouseMove',x:mapPoint.x-60,y:mapPoint.y-60});
    window.webContents.sendInputEvent({type:'mouseUp',x:mapPoint.x-60,y:mapPoint.y-60,button:'left',clickCount:1});
    await pause();
    assert.ok(await read("new DOMMatrix(document.getElementById('main-image').style.transform).e > 0"), 'Overview drag pans to left side');
    await read("document.getElementById('zoom-map').focus()");
    const beforeArrow = await read("new DOMMatrix(document.getElementById('main-image').style.transform).e");
    await read("document.getElementById('zoom-map').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}))");
    assert.ok(await read("new DOMMatrix(document.getElementById('main-image').style.transform).e") < beforeArrow, 'Overview arrow keys pan without changing photo');
    await read("document.getElementById('zoom-map').blur()");
    await read("document.getElementById('toggle-filmstrip').click()");
    assert.equal(await scale(), 2, 'Panel visibility preserves zoom');
    await read("document.dispatchEvent(new KeyboardEvent('keydown',{key:'j',bubbles:true,cancelable:true}))");
    assert.equal(await scale(), 1, 'Next photo resets zoom');
    assert.equal(await read("document.getElementById('zoom-map').hidden"), true, 'Overview hides for next fitted photo');
    await read("document.getElementById('stage').dispatchEvent(new WheelEvent('wheel',{deltaY:-2000,ctrlKey:true,clientX:"+point.x+",clientY:"+point.y+",bubbles:true,cancelable:true}))");
    assert.ok(await scale() <= 8, 'Zoom is bounded');
    console.log('Zoom checks passed: native Chromium pinch, Ctrl+wheel, fixed UI, dragging, scroll panning, reset, panel resize, photo navigation.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { clearTimeout(timeout); window.destroy(); app.quit(); }
});
