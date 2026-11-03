const api = window.cullPix;
const { layouts, clamp, validCrop, imageGeometry, defaultBorder, validBorder, borderFrame, validRotation, rotatedDimensions } = window.CullCrop;
const { modes: sortModes, comparePhotos } = window.CullPhotoOrder;
const elements = Object.fromEntries([
  'app-shell', 'sidebar', 'toggle-sidebar', 'toggle-filmstrip', 'filmstrip-panel',
  'sidebar-resizer', 'filmstrip-resizer', 'filmstrip-columns',
  'photo-sort', 'show-filenames', 'sort-status',
  'open-folder', 'empty-open-folder', 'folder-name', 'toggle-non-keepers', 'toggle-loop',
  'reviewed-count', 'reviewed-percent', 'progress-fill', 'keeper-count',
  'unmarked-count', 'copy-keepers', 'copy-count',
  'position', 'stage', 'empty-state', 'main-image', 'photo-viewport',
  'crop-layout', 'crop-hint', 'crop-label', 'reset-crop', 'reset-editing', 'photo-mat',
  'border-enabled', 'border-options', 'border-width', 'border-width-label', 'border-color', 'export-image',
  'zoom-slider', 'zoom-percent', 'zoom-in', 'zoom-out',
  'rotate-left', 'rotate-right', 'reset-rotation', 'rotation-angle',
  'check-updates', 'install-update', 'update-status',
  'preview-error', 'reset-zoom', 'zoom-map', 'zoom-map-image', 'zoom-map-viewport', 'previous', 'next', 'stage-badge',
  'keep', 'visible-count', 'filmstrip', 'toast',
  'unmark-dialog', 'cancel-unmark', 'confirm-unmark'
].map(id => [id, document.getElementById(id)]));

const state = {
  folder: null,
  images: [],
  selectedName: null,
  layout: 'original',
  border: defaultBorder(),
  exporting: false,
  rotating: false,
  resetting: false,
  showNonKeepers: true,
  loopNavigation: false,
  showSidebar: true,
  showFilmstrip: true,
  sidebarWidth: innerWidth <= 1050 ? 220 : 258,
  filmstripWidth: innerWidth <= 1050 ? 148 : 172,
  filmstripColumns: 1,
  photoSort: 'name-asc',
  showFilenames: false,
  busy: false
};
const previewCache = new Map();
// Keep adjacent originals decoded, rather than starting their decode on a keypress.
// Both entry count and retained RGBA bytes are bounded; exports still use originals.
const decodedNeighbors = new Map();
const neighborBudget = 96 * 1024 * 1024;
let neighborTimer;
let neighborGeneration = 0;
let neighborWorker = false;
let toastTimer;
let previewToken = 0;
let thumbnailObserver;
let filmstripKey = null;
let filmstripAppearanceKey = null;
let filmstripSelection = null;
const filmstripButtons = new Map();
const dirtyThumbnails = new Set();
let pendingUnmark = null;
let mapPreviewKey = null;
let mapThumbnailKey = null;
let mapThumbnail = null;
let mapThumbnailFailed = false;
let renderedLayout = null;
let renderedRotation = null;
let mapPointer = null;
let mainImageReady = false;
const zoom = { scale: 1, x: 0, y: 0, imageKey: null, drag: null };
let cropX = 0;
let cropY = 0;
let spaceHeld = false;
let cropSaveTimer;
let pendingCropSave;
let folderRevision = 0;
let datesLoaded = false;
let captureDateRequest;
function showUpdateState(update) {
  elements['update-status'].textContent = `v${update.version} · ${update.message}`;
  elements['check-updates'].disabled = ['checking', 'downloading', 'unavailable'].includes(update.status);
  elements['install-update'].hidden = !update.canInstall;
}
api.onUpdateState(showUpdateState);
api.getUpdateState().then(showUpdateState).catch(() => {});
elements['check-updates'].addEventListener('click', () => api.checkUpdates().then(showUpdateState).catch(() => {}));
elements['install-update'].addEventListener('click', async () => { await flushCropSave(); if (!state.exporting) await api.installUpdate(); });
window.addEventListener('online', () => api.checkUpdates().catch(() => {}));

const sidebarSections = [...document.querySelectorAll('#sidebar details[data-section]')];
try {
  const saved = JSON.parse(localStorage.getItem('sidebar-sections') || '{}');
  for (const section of sidebarSections) {
    if (typeof saved[section.dataset.section] === 'boolean') section.open = saved[section.dataset.section];
  }
} catch { /* Default section states work without local storage. */ }
for (const section of sidebarSections) section.addEventListener('toggle', () => {
  try {
    localStorage.setItem('sidebar-sections', JSON.stringify(Object.fromEntries(sidebarSections.map(item => [item.dataset.section, item.open]))));
  } catch { /* Collapsing still works without storage. */ }
});

try {
  const preferences = JSON.parse(localStorage.getItem('panel-layout') || '{}');
  for (const key of ['sidebarWidth', 'filmstripWidth']) {
    if (Number.isFinite(preferences[key])) state[key] = preferences[key];
  }
  if ([1, 2, 3, 4].includes(preferences.filmstripColumns)) state.filmstripColumns = preferences.filmstripColumns;
  if (sortModes.includes(preferences.photoSort)) state.photoSort = preferences.photoSort;
  state.showFilenames = preferences.showFilenames === true;
} catch { /* The default layout also works when preferences cannot be read. */ }

function savePanelLayout() {
  try {
    localStorage.setItem('panel-layout', JSON.stringify({ sidebarWidth: state.sidebarWidth,
      filmstripWidth: state.filmstripWidth, filmstripColumns: state.filmstripColumns,
      photoSort: state.photoSort, showFilenames: state.showFilenames }));
  } catch { /* Resizing remains available if local storage is unavailable. */ }
}

function sizePanels() {
  const total = elements['app-shell'].clientWidth;
  const left = state.showSidebar ? state.sidebarWidth : 0;
  const rightMax = Math.max(140, Math.min(900, total - left - 300));
  state.filmstripWidth = clamp(state.filmstripWidth, 140, rightMax);
  const right = state.showFilmstrip ? state.filmstripWidth : 0;
  const leftMax = Math.max(200, Math.min(440, total - right - 300));
  state.sidebarWidth = clamp(state.sidebarWidth, 200, leftMax);
  elements['app-shell'].style.setProperty('--sidebar-width', `${state.sidebarWidth}px`);
  elements['app-shell'].style.setProperty('--filmstrip-width', `${state.filmstripWidth}px`);
  elements.filmstrip.style.setProperty('--filmstrip-columns', state.filmstripColumns);
  elements['filmstrip-columns'].value = String(state.filmstripColumns);
  for (const [id, min, max, value] of [
    ['sidebar-resizer', 200, leftMax, state.sidebarWidth],
    ['filmstrip-resizer', 140, rightMax, state.filmstripWidth]
  ]) {
    const handle = elements[id];
    handle.setAttribute('aria-valuemin', String(min));
    handle.setAttribute('aria-valuemax', String(max));
    handle.setAttribute('aria-valuenow', String(Math.round(value)));
  }
}

for (const [id, key, direction] of [
  ['sidebar-resizer', 'sidebarWidth', 1], ['filmstrip-resizer', 'filmstripWidth', -1]
]) {
  const handle = elements[id];
  let drag;
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    drag = { id: event.pointerId, x: event.clientX, width: state[key] };
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add('resizing');
  });
  handle.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    state[key] = drag.width + (event.clientX - drag.x) * direction;
    sizePanels();
  });
  const finish = () => {
    const previous = drag;
    drag = null;
    if (!previous) return;
    if (handle.hasPointerCapture(previous.id)) handle.releasePointerCapture(previous.id);
    document.body.classList.remove('resizing');
    savePanelLayout();
  };
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(event, finish);
  window.addEventListener('blur', finish);
  handle.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Home') state[key] = Number(handle.getAttribute('aria-valuemin'));
    else if (event.key === 'End') state[key] = Number(handle.getAttribute('aria-valuemax'));
    else state[key] += (event.key === 'ArrowRight' ? 16 : -16) * direction;
    sizePanels();
    savePanelLayout();
  });
}

function updateLoadedThumbnailCrops() {
  if (!state.showFilmstrip) return;
  const byName = new Map(state.images.map(image => [image.name, image]));
  for (const button of elements.filmstrip.children) {
    const image = byName.get(button.dataset.name);
    if (image) updateThumbnailCrop(button, image);
  }
}
new ResizeObserver(updateLoadedThumbnailCrops).observe(elements.filmstrip);
window.addEventListener('resize', sizePanels);
elements['filmstrip-columns'].addEventListener('change', () => {
  state.filmstripColumns = Number(elements['filmstrip-columns'].value);
  sizePanels();
  savePanelLayout();
  requestAnimationFrame(updateLoadedThumbnailCrops);
  elements.stage.focus({ preventScroll: true });
});

async function applyPhotoSort() {
  const folder = state.folder;
  const revision = folderRevision;
  elements['photo-sort'].value = state.photoSort;
  state.images.sort((a, b) => comparePhotos(a, b, state.photoSort));
  render();
  if (!folder || !state.photoSort.startsWith('taken-') || datesLoaded) {
    elements['sort-status'].hidden = !state.photoSort.startsWith('taken-') || !folder;
    elements['sort-status'].textContent = 'Photos without an EXIF capture date appear last, by name.';
    return;
  }
  elements['sort-status'].hidden = false;
  elements['sort-status'].textContent = 'Reading EXIF capture dates…';
  try {
    captureDateRequest ||= api.getCaptureDates(folder);
    const dates = await captureDateRequest;
    if (folderRevision !== revision) return;
    for (const image of state.images) image.dateTaken = dates[image.name] ?? null;
    datesLoaded = true;
    state.images.sort((a, b) => comparePhotos(a, b, state.photoSort));
    elements['sort-status'].textContent = 'Photos without an EXIF capture date appear last, by name.';
    elements['sort-status'].hidden = !state.photoSort.startsWith('taken-');
    render();
  } catch (error) {
    if (folderRevision !== revision) return;
    captureDateRequest = null;
    elements['sort-status'].textContent = 'Capture dates could not be read. Photos remain sorted by name.';
    showToast(error.message || 'Could not read capture dates', true);
  }
}
elements['photo-sort'].addEventListener('change', () => {
  state.photoSort = elements['photo-sort'].value;
  savePanelLayout();
  applyPhotoSort();
});
elements['show-filenames'].addEventListener('change', () => {
  state.showFilenames = elements['show-filenames'].checked;
  elements.filmstrip.classList.toggle('show-filenames', state.showFilenames);
  savePanelLayout();
});

for (const [value, layout] of Object.entries(layouts)) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = layout.label;
  elements['crop-layout'].append(option);
}

function isCropping() { return state.layout !== 'original'; }

function viewGeometry() {
  const image = elements['main-image'];
  const rotation = selectedImage()?.rotation || 0;
  const dimensions = rotatedDimensions(image.naturalWidth, image.naturalHeight, rotation);
  const frame = borderFrame(elements.stage.clientWidth, elements.stage.clientHeight,
    dimensions.width, dimensions.height, state.layout, state.border);
  return { ...frame, ...imageGeometry(frame.width, frame.height, dimensions.width, dimensions.height, state.layout, zoom.scale), rotation };
}

function setZoomPosition(x, y) {
  zoom.x = x;
  zoom.y = y;
  if (isCropping()) {
    const { photoWidth, photoHeight } = viewGeometry();
    cropX = photoWidth ? x / photoWidth : 0;
    cropY = photoHeight ? y / photoHeight : 0;
  }
  updateZoom();
}

function flushCropSave() {
  clearTimeout(cropSaveTimer);
  const pending = pendingCropSave;
  pendingCropSave = null;
  if (pending) return api.setCrop(pending.folder, pending.name, pending.layout, pending.crop)
    .catch(error => showToast(error.message || 'Could not save crop preview', true));
  return Promise.resolve();
}

function rememberCrop() {
  if (state.resetting) return;
  const image = selectedImage();
  if (!isCropping() || !image || !mainImageReady || elements['main-image'].hidden) return;
  const crop = { scale: zoom.scale, x: cropX, y: cropY };
  image.crops[state.layout] = crop;
  pendingCropSave = { folder: state.folder, name: image.name, layout: state.layout, crop };
  clearTimeout(cropSaveTimer);
  cropSaveTimer = setTimeout(flushCropSave, 200);
  const button = elements.filmstrip.querySelector('.thumb.selected');
  if (button) updateThumbnailCrop(button, image);
}

function updateZoom() {
  const image = elements['main-image'];
  const { width, height, outerWidth, outerHeight, borderPixels, fit, maxX, maxY, photoWidth, photoHeight, rotation } = viewGeometry();
  const mat = elements['photo-mat'];
  mat.hidden = !borderPixels || image.hidden;
  mat.style.width = `${outerWidth}px`;
  mat.style.height = `${outerHeight}px`;
  mat.style.backgroundColor = state.border.color;
  elements.stage.classList.toggle('bordered', borderPixels > 0 && !image.hidden);
  const viewport = elements['photo-viewport'];
  viewport.style.width = `${width}px`;
  viewport.style.height = `${height}px`;
  const baseWidth = image.naturalWidth * fit;
  const baseHeight = image.naturalHeight * fit;
  image.style.width = `${baseWidth}px`;
  image.style.height = `${baseHeight}px`;
  image.style.left = `${(width - baseWidth) / 2}px`;
  image.style.top = `${(height - baseHeight) / 2}px`;
  if (isCropping()) { zoom.x = cropX * photoWidth; zoom.y = cropY * photoHeight; }
  zoom.x = Math.max(-maxX, Math.min(maxX, zoom.x));
  zoom.y = Math.max(-maxY, Math.min(maxY, zoom.y));
  if (isCropping() && mainImageReady) {
    cropX = photoWidth ? zoom.x / photoWidth : 0;
    cropY = photoHeight ? zoom.y / photoHeight : 0;
  }
  image.style.transform = `translate(${zoom.x}px, ${zoom.y}px) rotate(${rotation}deg) scale(${zoom.scale})`;
  elements.stage.classList.toggle('zoomed', zoom.scale > 1);
  elements.stage.classList.toggle('cropping', isCropping() && !image.hidden);
  elements.stage.classList.toggle('crop-movable', isCropping() && spaceHeld);
  elements['crop-label'].hidden = !isCropping() || image.hidden;
  elements['crop-label'].textContent = `${layouts[state.layout].label} · Hold Space + drag`;
  elements['reset-crop'].disabled = !isCropping() || !mainImageReady || image.hidden
    || (zoom.scale === 1 && zoom.x === 0 && zoom.y === 0);
  elements['export-image'].disabled = !selectedImage() || !mainImageReady || state.exporting || state.resetting;
  elements['reset-editing'].disabled = !selectedImage() || state.exporting || state.rotating || state.resetting;
  for (const id of ['crop-layout', 'border-enabled', 'border-width', 'border-color']) elements[id].disabled = !state.folder || state.resetting;
  const canZoom = mainImageReady && !image.hidden && !state.resetting;
  elements['rotation-angle'].value = `${rotation}°`;
  elements['rotate-left'].disabled = !canZoom || state.rotating;
  elements['rotate-right'].disabled = !canZoom || state.rotating;
  elements['reset-rotation'].disabled = !canZoom || state.rotating || !rotation;
  elements['zoom-slider'].disabled = !canZoom;
  elements['zoom-percent'].disabled = !canZoom;
  elements['zoom-in'].disabled = !canZoom || zoom.scale >= 8;
  elements['zoom-out'].disabled = !canZoom || zoom.scale <= 1;
  elements['zoom-slider'].value = String(Math.round(Math.log(zoom.scale) / Math.log(8) * 1000));
  elements['zoom-slider'].setAttribute('aria-valuetext', `${(zoom.scale * 100).toFixed(1)} percent`);
  if (document.activeElement !== elements['zoom-percent']) elements['zoom-percent'].value = String(Math.round(zoom.scale * 1000) / 10);
  const reset = elements['reset-zoom'];
  reset.hidden = zoom.scale === 1;
  reset.textContent = `${isCropping() ? 'Fill' : 'Fit'} · ${Math.round(zoom.scale * 100)}%`;
  updateZoomMap(image, width, height, fit);
}

function updateZoomMap(image, width, height, fit) {
  const map = elements['zoom-map'];
  map.hidden = (zoom.scale <= 1 && !isCropping()) || image.hidden || !fit
    || (mapThumbnailKey === zoom.imageKey && mapThumbnailFailed);
  if (map.hidden) return;
  const canvas = elements['zoom-map-image'];
  const rotation = selectedImage()?.rotation || 0;
  const dimensions = rotatedDimensions(image.naturalWidth, image.naturalHeight, rotation);
  const mapFit = Math.min(Math.min(160, width * 0.25) / dimensions.width, 120 / dimensions.height);
  const mapWidth = Math.max(1, Math.round(dimensions.width * mapFit));
  const mapHeight = Math.max(1, Math.round(dimensions.height * mapFit));
  const key = `${zoom.imageKey}\u0000${rotation}\u0000${mapWidth}\u0000${mapHeight}`;
  if (mapThumbnailKey !== zoom.imageKey) {
    const sourceKey = zoom.imageKey;
    const selected = selectedImage();
    mapThumbnailKey = sourceKey;
    mapThumbnail = null;
    mapThumbnailFailed = false;
    mapPreviewKey = null;
    // Reuse the disk thumbnail; drawing the original here forces a full-size
    // canvas decode/readback on every cropped photo, before its first paint.
    if (selected) api.getThumbnail(state.folder, selected.name).then(async url => {
      const thumbnail = new Image();
      thumbnail.src = url;
      await thumbnail.decode();
      if (zoom.imageKey !== sourceKey || mapThumbnailKey !== sourceKey) return;
      mapThumbnail = thumbnail;
      updateZoom();
    }).catch(() => {
      if (mapThumbnailKey === sourceKey) { mapThumbnailFailed = true; map.hidden = true; }
    });
  }
  if (mapPreviewKey !== key) {
    canvas.width = mapWidth * 2;
    canvas.height = mapHeight * 2;
    canvas.style.width = `${mapWidth}px`;
    canvas.style.height = `${mapHeight}px`;
    if (mapThumbnail) {
      const context = canvas.getContext('2d');
      const drawWidth = rotation % 180 ? canvas.height : canvas.width;
      const drawHeight = rotation % 180 ? canvas.width : canvas.height;
      context.save();
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate(rotation * Math.PI / 180);
      context.drawImage(mapThumbnail, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
      context.restore();
      mapPreviewKey = key;
    }
  }
  const photoWidth = dimensions.width * fit * zoom.scale;
  const photoHeight = dimensions.height * fit * zoom.scale;
  const visibleWidth = Math.min(1, width / photoWidth);
  const visibleHeight = Math.min(1, height / photoHeight);
  const view = elements['zoom-map-viewport'];
  view.style.width = `${visibleWidth * 100}%`;
  view.style.height = `${visibleHeight * 100}%`;
  view.style.left = `${((1 - visibleWidth) / 2 - zoom.x / photoWidth) * 100}%`;
  view.style.top = `${((1 - visibleHeight) / 2 - zoom.y / photoHeight) * 100}%`;
}

function panFromMap(event) {
  const rect = elements['zoom-map-image'].getBoundingClientRect();
  const { photoWidth, photoHeight } = viewGeometry();
  setZoomPosition((0.5 - clamp((event.clientX - rect.left) / rect.width, 0, 1)) * photoWidth,
    (0.5 - clamp((event.clientY - rect.top) / rect.height, 0, 1)) * photoHeight);
  rememberCrop();
}

function endMapPan() {
  const pointer = mapPointer;
  mapPointer = null;
  flushCropSave();
  if (pointer !== null && elements['zoom-map'].hasPointerCapture(pointer)) elements['zoom-map'].releasePointerCapture(pointer);
}

elements['zoom-map'].addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  mapPointer = event.pointerId;
  elements['zoom-map'].setPointerCapture(event.pointerId);
  panFromMap(event);
});
elements['zoom-map'].addEventListener('pointermove', event => {
  if (event.pointerId !== mapPointer) return;
  event.stopPropagation();
  panFromMap(event);
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  elements['zoom-map'].addEventListener(type, endMapPan);
}
elements['zoom-map'].addEventListener('click', event => {
  if (event.detail === 0) { setZoomPosition(0, 0); rememberCrop(); }
});
elements['zoom-map'].addEventListener('keydown', event => {
  const directions = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
  const direction = directions[event.key];
  if (!direction) return;
  event.preventDefault();
  event.stopPropagation();
  const { width, height } = viewGeometry();
  setZoomPosition(zoom.x + direction[0] * width * 0.15, zoom.y + direction[1] * height * 0.15);
  rememberCrop();
});

function resetZoom() {
  endMapPan();
  endPan();
  zoom.scale = 1;
  cropX = cropY = 0;
  zoom.x = zoom.y = 0;
  updateZoom();
}

function zoomAt(scale, clientX, clientY) {
  if (!selectedImage() || elements['main-image'].hidden) return;
  const next = Math.max(1, Math.min(8, scale));
  const rect = elements['photo-viewport'].getBoundingClientRect();
  const x = clientX - rect.left - rect.width / 2;
  const y = clientY - rect.top - rect.height / 2;
  const ratio = next / zoom.scale;
  const nextX = x - (x - zoom.x) * ratio;
  const nextY = y - (y - zoom.y) * ratio;
  zoom.scale = next;
  setZoomPosition(nextX, nextY);
  rememberCrop();
}

function zoomFromControl(scale) {
  const rect = elements['photo-viewport'].getBoundingClientRect();
  zoomAt(scale, rect.left + rect.width / 2, rect.top + rect.height / 2);
}
elements['zoom-slider'].addEventListener('input', () => zoomFromControl(8 ** (Number(elements['zoom-slider'].value) / 1000)));
elements['zoom-percent'].addEventListener('input', () => {
  const percent = Number(elements['zoom-percent'].value);
  if (percent >= 100 && percent <= 800) zoomFromControl(percent / 100);
});
elements['zoom-percent'].addEventListener('change', () => {
  const percent = clamp(Number(elements['zoom-percent'].value) || 100, 100, 800);
  elements['zoom-percent'].value = String(percent);
  zoomFromControl(percent / 100);
});
elements['zoom-in'].addEventListener('click', () => zoomFromControl(zoom.scale + 0.01));
elements['zoom-out'].addEventListener('click', () => zoomFromControl(zoom.scale - 0.01));

function endPan() {
  const drag = zoom.drag;
  zoom.drag = null;
  if (drag && elements.stage.hasPointerCapture(drag.id)) {
    elements.stage.releasePointerCapture(drag.id);
  }
  elements.stage.classList.remove('panning');
  if (drag) flushCropSave();
}

// Chromium reports trackpad pinches as Ctrl+wheel, as it does mouse-wheel zoom.
elements.stage.addEventListener('wheel', event => {
  if (event.ctrlKey || (isCropping() && !event.shiftKey)) {
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? elements.stage.clientHeight : 1);
    // Keep small trackpad deltas smooth, but cap a coarse mouse-wheel notch at ~5%.
    const change = -Math.sign(delta) * 0.05 * (1 - Math.exp(-Math.abs(delta) / 5));
    zoomAt(zoom.scale * Math.exp(change), event.clientX, event.clientY);
  } else if (zoom.scale > 1 && selectedImage()) {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? elements.stage.clientHeight : 1;
    setZoomPosition(zoom.x - event.deltaX * unit, zoom.y - event.deltaY * unit);
    rememberCrop();
  }
}, { passive: false });
elements.stage.addEventListener('pointerdown', event => {
  if ((isCropping() ? !spaceHeld : zoom.scale <= 1) || elements['main-image'].hidden
      || event.button !== 0 || event.target.closest('button')) return;
  event.preventDefault();
  zoom.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, panX: zoom.x, panY: zoom.y };
  elements.stage.setPointerCapture(event.pointerId);
  elements.stage.classList.add('panning');
});
elements.stage.addEventListener('pointermove', event => {
  if (!zoom.drag || zoom.drag.id !== event.pointerId) return;
  setZoomPosition(zoom.drag.panX + event.clientX - zoom.drag.x, zoom.drag.panY + event.clientY - zoom.drag.y);
  rememberCrop();
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  elements.stage.addEventListener(type, endPan);
}
elements.stage.addEventListener('dblclick', event => {
  if (event.target.closest('button')) return;
  if (zoom.scale > 1) { resetZoom(); rememberCrop(); }
  else zoomAt(2, event.clientX, event.clientY);
});
elements['reset-zoom'].addEventListener('click', () => { resetZoom(); rememberCrop(); });
elements['reset-crop'].addEventListener('click', () => { resetZoom(); rememberCrop(); flushCropSave(); });
elements['main-image'].addEventListener('load', () => { mainImageReady = true; mapPreviewKey = null; updateZoom(); scheduleNeighbors(); });
new ResizeObserver(updateZoom).observe(elements.stage);

function visibleImages() {
  return state.showNonKeepers ? state.images : state.images.filter(image => image.status === 'keep');
}

function selectedImage() {
  return state.images.find(image => image.name === state.selectedName) || null;
}

function showToast(message, error = false) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle('error', error);
  elements.toast.classList.add('visible');
  toastTimer = setTimeout(() => elements.toast.classList.remove('visible'), 3500);
}

function chooseClosestVisible(oldName) {
  const visible = visibleImages();
  if (!visible.length) return null;
  const oldIndex = state.images.findIndex(image => image.name === oldName);
  return visible.find(image => state.images.indexOf(image) > oldIndex)?.name
    || (state.loopNavigation ? visible[0].name : visible.at(-1).name);
}

function applyFolder(folderState) {
  if (!folderState) return;
  flushCropSave();
  cancelUnmark();
  const sameFolder = folderState.folder === state.folder;
  state.folder = folderState.folder;
  folderRevision += 1;
  datesLoaded = false;
  captureDateRequest = null;
  state.layout = Object.hasOwn(layouts, folderState.layout) ? folderState.layout : 'original';
  state.border = validBorder(folderState.border) ? { ...folderState.border } : defaultBorder();
  syncBorderControls();
  elements['crop-layout'].value = state.layout;
  elements['crop-layout'].disabled = !state.folder;
  elements['crop-hint'].textContent = isCropping()
    ? 'Space + drag to reframe. Use the slider, percentage, or wheel to zoom. Originals stay unchanged.'
    : 'Originals stay unchanged.';
  state.images = folderState.images.map(image => ({ ...image, rotation: validRotation(image.rotation) ? image.rotation : 0,
    crops: image.crops || {}, status: image.status === 'keep' ? 'keep' : 'unreviewed' }));
  previewCache.clear();
  decodedNeighbors.clear();
  neighborGeneration += 1;
  clearTimeout(neighborTimer);
  filmstripKey = null;
  const openedName = folderState.selectedName;
  if (openedName && state.images.some(image => image.name === openedName)) state.showNonKeepers = true;
  state.selectedName = openedName && state.images.some(image => image.name === openedName)
    ? openedName
    : sameFolder && state.images.some(image => image.name === state.selectedName)
    ? state.selectedName
    : (state.images.find(image => image.status === 'unreviewed') || state.images[0])?.name || null;
  if (!state.showNonKeepers && selectedImage()?.status !== 'keep') {
    state.selectedName = chooseClosestVisible(state.selectedName);
  }
  applyPhotoSort();
}

async function openFolder() {
  try { applyFolder(await api.chooseFolder()); }
  catch (error) { showToast(error.message || 'Could not open folder', true); }
}

function renderStats() {
  const total = state.images.length;
  const keep = state.images.filter(image => image.status === 'keep').length;
  const unmarked = total - keep;
  elements['folder-name'].textContent = state.folder || 'No folder selected';
  elements['folder-name'].title = state.folder || '';
  elements['reviewed-count'].textContent = `${keep} of ${total} kept`;
  elements['reviewed-percent'].textContent = `${total ? Math.round(keep / total * 100) : 0}%`;
  elements['progress-fill'].style.width = `${total ? keep / total * 100 : 0}%`;
  elements['keeper-count'].textContent = keep;
  elements['unmarked-count'].textContent = unmarked;
  elements['copy-count'].textContent = keep;
  elements['copy-keepers'].disabled = !keep || state.busy;
  elements['toggle-non-keepers'].setAttribute('aria-pressed', String(state.showNonKeepers));
  elements['toggle-loop'].setAttribute('aria-pressed', String(state.loopNavigation));
  const count = visibleImages().length;
  elements['visible-count'].textContent = `${count} ${count === 1 ? 'photo' : 'photos'}${state.showNonKeepers ? '' : ' visible'}`;
}

async function getPreview(image, size) {
  const key = `${state.folder}\u0000${image.name}\u0000${size}`;
  if (!previewCache.has(key)) {
    const request = api.getNativePreview(image.name, size);
    previewCache.set(key, request);
    request.catch(() => { if (previewCache.get(key) === request) previewCache.delete(key); });
    while (previewCache.size > 4) previewCache.delete(previewCache.keys().next().value);
  }
  return previewCache.get(key);
}

function scheduleNeighbors() {
  clearTimeout(neighborTimer);
  const generation = ++neighborGeneration;
  neighborTimer = setTimeout(async () => {
    if (neighborWorker || !mainImageReady) return;
    neighborWorker = true;
    try {
      const visible = visibleImages();
      const index = visible.findIndex(image => image.name === state.selectedName);
      const neighbors = [1, -1].map(offset => {
        const target = index + offset;
        return state.loopNavigation ? visible[(target + visible.length) % visible.length] : visible[target];
      }).filter(image => image && image.name !== state.selectedName);
      const wanted = new Set(neighbors.map(image => image.url));
      for (const key of decodedNeighbors.keys()) if (!wanted.has(key)) decodedNeighbors.delete(key);
      for (const image of neighbors) {
        if (generation !== neighborGeneration) break;
        if (decodedNeighbors.has(image.url)) continue;
        try {
          const url = image.nativePreview ? await getPreview(image, 2600) : image.url;
          if (generation !== neighborGeneration) break;
          const decoded = new Image();
          decoded.decoding = 'async';
          decoded.src = url;
          await decoded.decode();
          if (generation !== neighborGeneration) break;
          const bytes = decoded.naturalWidth * decoded.naturalHeight * 4;
          const used = [...decodedNeighbors.values()].reduce((sum, item) => sum + item.bytes, 0);
          if (used + bytes <= neighborBudget) decodedNeighbors.set(image.url, { image: decoded, bytes });
        } catch { /* A speculative decode must never interrupt photo review. */ }
      }
    } finally {
      neighborWorker = false;
      if (generation !== neighborGeneration && mainImageReady) scheduleNeighbors();
    }
  }, 120);
}

function renderMainImage(image) {
  const key = image ? `${state.folder}\u0000${image.name}\u0000${image.url}` : null;
  if (zoom.imageKey === key) {
    if (renderedLayout !== state.layout || renderedRotation !== (image?.rotation || 0)) restoreCrop(image);
    updateZoom();
    return;
  }
  flushCropSave();
  clearTimeout(neighborTimer);
  neighborGeneration += 1;
  mainImageReady = false;
  zoom.imageKey = key;
  restoreCrop(image);
  previewToken += 1;
  const token = previewToken;
  elements['main-image'].hidden = true;
  updateZoom();
  if (!image) elements['main-image'].removeAttribute('src');
  elements['preview-error'].hidden = true;
  if (!image) return;

  elements['main-image'].alt = image.name;
  elements['main-image'].onerror = () => {
    if (token === previewToken) {
      elements['main-image'].hidden = true;
      elements['preview-error'].hidden = false;
    }
  };
  const warmed = decodedNeighbors.get(image.url);
  if (warmed) {
    elements['main-image'].src = warmed.image.src;
    elements['main-image'].hidden = false;
    updateZoom();
  } else if (image.nativePreview) {
    getPreview(image, 2600).then(url => {
      if (token !== previewToken) return;
      elements['main-image'].src = url;
      elements['main-image'].hidden = false;
      updateZoom();
    }).catch(() => {
      if (token === previewToken) elements['preview-error'].hidden = false;
    });
  } else {
    elements['main-image'].src = image.url;
    elements['main-image'].hidden = false;
    updateZoom();
  }
}

function restoreCrop(image) {
  flushCropSave();
  renderedLayout = state.layout;
  renderedRotation = image?.rotation || 0;
  resetZoom();
  const crop = image?.crops[state.layout];
  if (isCropping() && validCrop(crop)) {
    zoom.scale = crop.scale;
    cropX = crop.x;
    cropY = crop.y;
  }
}

function updateThumbnailCrop(button, image) {
  const img = button.querySelector('img');
  if (!img.naturalWidth || !img.naturalHeight) return;
  const viewport = button.querySelector('.thumb-viewport');
  const mat = button.querySelector('.thumb-mat');
  const rotation = image.rotation || 0;
  if (!isCropping() && !state.border.enabled && !rotation) {
    img.removeAttribute('style'); viewport.removeAttribute('style'); mat.hidden = true;
    delete img.dataset.cropKey; return;
  }
  const crop = validCrop(image.crops[state.layout]) ? image.crops[state.layout] : { scale: 1, x: 0, y: 0 };
  const border = state.border.enabled ? Math.min(button.clientWidth, button.clientHeight) * state.border.width / 100 : 0;
  const width = button.clientWidth - 2 * border;
  const height = button.clientHeight - 2 * border;
  const key = `${state.layout}:${rotation}:${width}:${height}:${crop.scale}:${crop.x}:${crop.y}:${state.border.color}:${state.border.enabled}`;
  if (img.dataset.cropKey === key) return;
  img.dataset.cropKey = key;
  viewport.style.inset = `${border}px`;
  mat.hidden = !state.border.enabled;
  mat.style.backgroundColor = state.border.color;
  const dimensions = rotatedDimensions(img.naturalWidth, img.naturalHeight, rotation);
  const fitLayout = isCropping() ? state.layout : state.border.enabled ? 'original' : 'square';
  const { fit, photoWidth, photoHeight, maxX, maxY } = imageGeometry(width, height, dimensions.width, dimensions.height, fitLayout, crop.scale);
  const baseWidth = img.naturalWidth * fit;
  const baseHeight = img.naturalHeight * fit;
  img.style.position = 'absolute';
  img.style.width = `${baseWidth}px`;
  img.style.height = `${baseHeight}px`;
  img.style.left = `${(width - baseWidth) / 2}px`;
  img.style.top = `${(height - baseHeight) / 2}px`;
  img.style.transform = `translate(${clamp(crop.x * photoWidth, -maxX, maxX)}px, ${clamp(crop.y * photoHeight, -maxY, maxY)}px) rotate(${rotation}deg) scale(${crop.scale})`;
}

function renderStage() {
  const visible = visibleImages();
  const image = selectedImage();
  const index = visible.findIndex(item => item.name === state.selectedName);
  elements.position.textContent = index >= 0 ? `${index + 1} / ${visible.length}` : '— / —';
  elements['empty-state'].hidden = Boolean(image);
  const emptyTitle = elements['empty-state'].querySelector('h2');
  const emptyText = elements['empty-state'].querySelector('p');
  const emptyButton = elements['empty-open-folder'];
  if (state.folder && !state.images.length) {
    emptyTitle.textContent = 'No supported photos here.';
    emptyText.textContent = 'Choose another folder with JPG, PNG, HEIC, TIFF, WebP, GIF, BMP, or AVIF files.';
    emptyButton.hidden = false;
  } else if (state.folder && !visible.length) {
    emptyTitle.textContent = 'All non-keepers are hidden.';
    emptyText.textContent = 'Show non-keepers to see these photos again.';
    emptyButton.hidden = true;
  } else {
    emptyTitle.textContent = 'Make the good shots count.';
    emptyText.textContent = 'Choose a folder to browse your photos and pick the ones worth keeping.';
    emptyButton.hidden = false;
  }

  renderMainImage(image);
  elements.previous.disabled = visible.length < 2 || state.busy || (!state.loopNavigation && index <= 0);
  elements.next.disabled = visible.length < 2 || state.busy || (!state.loopNavigation && index >= visible.length - 1);
  elements.keep.disabled = !image || state.busy;
  elements.keep.querySelector('.action-label').textContent = image?.status === 'keep' ? 'Unmark keeper' : 'Keep photo';
  elements.keep.setAttribute('aria-label', `${image?.status === 'keep' ? 'Unmark keeper' : 'Keep photo'} (L)`);
  const badge = elements['stage-badge'];
  badge.hidden = !image || image.status === 'unreviewed';
  badge.className = `stage-badge ${image?.status || ''}`;
  badge.textContent = '✓  KEEPER';
}

function renderFilmstrip() {
  elements.filmstrip.classList.toggle('show-filenames', state.showFilenames);
  elements['show-filenames'].checked = state.showFilenames;
  elements.filmstrip.classList.toggle('cropping', isCropping());
  elements.filmstrip.style.setProperty('--crop-ratio', layouts[state.layout].ratio || 1);
  if (!state.showFilmstrip) return;
  const visible = visibleImages();
  const key = `${state.folder}\u0000${visible.map(image => image.name).join('\u0000')}`;

  if (key !== filmstripKey) {
    thumbnailObserver?.disconnect();
    elements.filmstrip.replaceChildren();
    filmstripButtons.clear();
    dirtyThumbnails.clear();
    const fragment = document.createDocumentFragment();
    const folder = state.folder;
    const imagesByName = new Map(visible.map(image => [image.name, image]));
    const waiting = new Set();
    let active = 0;
    function loadVisibleThumbnails() {
      while (active < 2 && waiting.size) {
        const target = waiting.values().next().value;
        waiting.delete(target);
        if (!target.isConnected || state.folder !== folder) continue;
        observer.unobserve(target);
        const image = imagesByName.get(target.dataset.name);
        if (!image) continue;
        const img = target.querySelector('img');
        const fallback = () => {
          if (!img.isConnected || state.folder !== folder) return;
          img.onerror = null;
          if (image.nativePreview) {
            getPreview(image, 320).then(url => { if (img.isConnected) img.src = url; }).catch(() => {});
          } else img.src = image.url;
        };
        img.onerror = fallback;
        active += 1;
        api.getThumbnail(folder, image.name).then(url => {
          if (img.isConnected && state.folder === folder) img.src = url;
        }).catch(fallback).finally(() => { active -= 1; loadVisibleThumbnails(); });
      }
    }
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) waiting.add(entry.target);
        else waiting.delete(entry.target);
      }
      loadVisibleThumbnails();
    }, { root: elements.filmstrip, rootMargin: '120px' });
    thumbnailObserver = observer;

    for (const image of visible) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'thumb';
      button.dataset.name = image.name;
      filmstripButtons.set(image.name, button);
      button.title = image.name;
      const img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.onload = () => updateThumbnailCrop(button, image);
      const mat = document.createElement('span');
      mat.className = 'thumb-mat';
      mat.hidden = true;
      const viewport = document.createElement('span');
      viewport.className = 'thumb-viewport';
      viewport.append(img);
      button.append(mat, viewport);
      const filename = document.createElement('span');
      filename.className = 'thumb-filename';
      filename.textContent = image.name;
      button.append(filename);
      updateThumbnailState(button, image);
      button.addEventListener('click', () => {
        state.selectedName = image.name;
        render();
      });
      fragment.append(button);
    }
    elements.filmstrip.append(fragment);
    elements.filmstrip.querySelectorAll('.thumb').forEach(button => observer.observe(button));
    filmstripKey = key;
    filmstripSelection = state.selectedName;
    filmstripAppearanceKey = null;
  }
  const appearance = `${state.layout}:${state.border.enabled}:${state.border.width}:${state.border.color}`;
  if (appearance !== filmstripAppearanceKey) {
    for (const image of visible) updateThumbnailCrop(filmstripButtons.get(image.name), image);
    filmstripAppearanceKey = appearance;
  }
  if (filmstripSelection !== state.selectedName) {
    const previous = filmstripButtons.get(filmstripSelection);
    const next = filmstripButtons.get(state.selectedName);
    previous?.classList.remove('selected');
    previous?.setAttribute('aria-current', 'false');
    next?.classList.add('selected');
    next?.setAttribute('aria-current', 'true');
    filmstripSelection = state.selectedName;
  }
  for (const name of dirtyThumbnails) {
    const button = filmstripButtons.get(name);
    const image = state.images.find(image => image.name === name);
    if (button && image) updateThumbnailState(button, image);
  }
  dirtyThumbnails.clear();
}

function updateThumbnailState(button, image) {
  button.classList.toggle('selected', image.name === state.selectedName);
  button.setAttribute('aria-current', String(image.name === state.selectedName));
  button.setAttribute('aria-label', `${image.name}, ${image.status === 'keep' ? 'keeper' : 'unmarked'}`);
  let marker = button.querySelector('.thumb-status');
  if (image.status === 'unreviewed') marker?.remove();
  else {
    if (!marker) { marker = document.createElement('span'); button.append(marker); }
    marker.className = `thumb-status ${image.status}`;
    marker.textContent = '✓';
  }
}

function render() {
  renderPanels();
  renderStats();
  renderStage();
  renderFilmstrip();
}

function renderPanels() {
  elements['app-shell'].classList.toggle('sidebar-hidden', !state.showSidebar);
  elements['filmstrip-panel'].hidden = !state.showFilmstrip;
  elements['filmstrip-resizer'].parentElement.classList.toggle('collapsed', !state.showFilmstrip);
  sizePanels();
  for (const [id, shown, label] of [
    ['toggle-sidebar', state.showSidebar, 'sidebar'],
    ['toggle-filmstrip', state.showFilmstrip, 'photo strip']
  ]) {
    const button = elements[id];
    const action = shown ? 'Hide' : 'Show';
    button.setAttribute('aria-expanded', String(shown));
    button.setAttribute('aria-label', `${action} ${label}`);
    button.title = `${action} ${label} (${id === 'toggle-sidebar' ? 'B' : 'F'})`;
  }
}

function toggleSidebar() {
  state.showSidebar = !state.showSidebar;
  renderPanels();
}

function toggleFilmstrip() {
  state.showFilmstrip = !state.showFilmstrip;
  render();
}

function move(direction) {
  const visible = visibleImages();
  if (!visible.length || state.busy) return;
  const index = visible.findIndex(image => image.name === state.selectedName);
  const target = index + direction;
  if (!state.loopNavigation && (target < 0 || target >= visible.length)) return;
  state.selectedName = visible[(target + visible.length) % visible.length].name;
  render();
}

async function setStatus(status) {
  const image = selectedImage();
  if (!image || state.busy) return;
  const before = visibleImages();
  const index = before.findIndex(item => item.name === image.name);
  state.busy = true;
  try {
    await api.setStatus(image.name, status);
    image.status = status;
    dirtyThumbnails.add(image.name);
    const after = visibleImages();
    let next = null;
    const steps = state.loopNavigation ? before.length : before.length - index - 1;
    for (let step = 1; step <= steps; step += 1) {
      const candidate = before[(index + step) % before.length];
      if (after.includes(candidate) && candidate.name !== image.name) { next = candidate.name; break; }
    }
    state.selectedName = next || (after.includes(image) ? image.name
      : (state.loopNavigation ? after[0]?.name : after.at(-1)?.name) || null);
  } catch (error) {
    showToast(error.message || 'Could not save decision', true);
  } finally {
    state.busy = false;
    render();
  }
}

function toggleNonKeepers() {
  state.showNonKeepers = !state.showNonKeepers;
  if (!state.showNonKeepers && selectedImage()?.status !== 'keep') {
    state.selectedName = chooseClosestVisible(state.selectedName);
  } else if (state.showNonKeepers && !state.selectedName) {
    state.selectedName = state.images[0]?.name || null;
  }
  render();
}

function toggleKeeper() {
  if (selectedImage()?.status === 'keep') requestUnmark();
  else setStatus('keep');
}

function requestUnmark() {
  const image = selectedImage();
  if (image?.status !== 'keep' || state.busy || pendingUnmark) return;
  pendingUnmark = { name: image.name, folder: state.folder };
  elements['unmark-dialog'].showModal();
  elements['confirm-unmark'].focus();
}

function cancelUnmark() {
  pendingUnmark = null;
  if (elements['unmark-dialog'].open) elements['unmark-dialog'].close();
}

function confirmUnmark() {
  const target = pendingUnmark;
  cancelUnmark();
  if (target && target.folder === state.folder && target.name === state.selectedName) {
    setStatus('unreviewed');
  }
}

async function copyKeepers() {
  if (state.busy) return;
  state.busy = true;
  renderStats();
  try {
    const count = await api.copyKeepers();
    showToast(`Copied ${count} keeper ${count === 1 ? 'file' : 'files'}. Paste into Finder or Explorer.`);
  } catch (error) {
    showToast(error.message || 'Could not copy keeper files', true);
  } finally {
    state.busy = false;
    renderStats();
  }
}

elements['open-folder'].addEventListener('click', openFolder);

async function rotateSelectedPhoto(change) {
  const image = selectedImage();
  const folder = state.folder;
  if (!image || !mainImageReady || state.rotating || state.resetting) return;
  rememberCrop();
  state.rotating = true;
  updateZoom();
  try {
    await flushCropSave();
    const rotation = change === 'reset' ? 0 : ((image.rotation || 0) + change + 360) % 360;
    const result = await api.setRotation(folder, image.name, rotation);
    if (folder !== state.folder) return;
    image.rotation = result.rotation;
    image.crops = result.crops;
    const button = filmstripButtons.get(image.name);
    if (button) updateThumbnailCrop(button, image);
    renderStage();
  } catch (error) { showToast(error.message || 'Could not save rotation', true); }
  finally { state.rotating = false; updateZoom(); }
}
elements['rotate-left'].addEventListener('click', () => rotateSelectedPhoto(-90));
elements['rotate-right'].addEventListener('click', () => rotateSelectedPhoto(90));
elements['reset-rotation'].addEventListener('click', () => rotateSelectedPhoto('reset'));

elements['reset-editing'].addEventListener('click', async () => {
  const image = selectedImage();
  const folder = state.folder;
  if (!image || state.resetting || state.rotating || state.exporting) return;
  state.resetting = true;
  updateZoom();
  try {
    await flushCropSave();
    const result = await api.resetEditing(folder, image.name);
    if (state.folder !== folder) return;
    image.crops = result.crops;
    image.rotation = result.rotation;
    state.layout = result.layout;
    state.border = result.border;
    elements['crop-layout'].value = state.layout;
    elements['crop-hint'].textContent = 'Originals stay unchanged.';
    syncBorderControls();
    resetZoom();
    render();
    const button = filmstripButtons.get(image.name);
    if (button) updateThumbnailCrop(button, image);
    showToast('Crop, zoom, rotation, and border reset.');
  } catch (error) { showToast(error.message || 'Could not reset settings', true); }
  finally { state.resetting = false; updateZoom(); }
});

function syncBorderControls() {
  elements['border-enabled'].checked = state.border.enabled;
  elements['border-options'].hidden = !state.border.enabled;
  elements['border-width'].value = state.border.width;
  elements['border-width-label'].value = `${state.border.width}%`;
  elements['border-color'].value = state.border.color;
  elements['border-enabled'].disabled = !state.folder;
}
function changeBorder(save) {
  state.border = { enabled: elements['border-enabled'].checked, width: Number(elements['border-width'].value), color: elements['border-color'].value };
  syncBorderControls();
  updateZoom();
  updateLoadedThumbnailCrops();
  // Turning a border off also clears thumbnail mats in Original mode.
  if (!state.border.enabled && !isCropping()) {
    const byName = new Map(state.images.map(image => [image.name, image]));
    for (const button of elements.filmstrip.children) if (byName.has(button.dataset.name)) updateThumbnailCrop(button, byName.get(button.dataset.name));
  }
  if (save && state.folder) api.setBorder(state.folder, { ...state.border }).catch(error => showToast(error.message || 'Could not save border', true));
}
elements['border-enabled'].addEventListener('change', () => changeBorder(true));
for (const id of ['border-width', 'border-color']) {
  elements[id].addEventListener('input', () => changeBorder(false));
  elements[id].addEventListener('change', () => changeBorder(true));
}
elements['export-image'].addEventListener('click', async () => {
  const image = selectedImage();
  if (!image || !mainImageReady || state.exporting || state.resetting) return;
  rememberCrop();
  const settings = { folder: state.folder, name: image.name, layout: state.layout,
    crop: isCropping() ? { scale: zoom.scale, x: cropX, y: cropY } : { scale: 1, x: 0, y: 0 }, border: { ...state.border }, rotation: image.rotation || 0 };
  state.exporting = true;
  elements['export-image'].textContent = 'Exporting…';
  updateZoom();
  try {
    await flushCropSave();
    const result = await api.exportImage(settings);
    if (result) showToast(`Exported ${result.width} × ${result.height} pixels.`);
  } catch (error) { showToast(error.message || 'Could not export image', true); }
  finally {
    state.exporting = false;
    elements['export-image'].textContent = 'Export image…';
    updateZoom();
  }
});

for (const action of ['fullscreen', 'reload', 'quit']) {
  document.getElementById(`app-${action}`).addEventListener('click', async () => {
    await flushCropSave();
    api.appAction(action).catch(error => showToast(error.message || 'Could not perform app action', true));
  });
}

elements['crop-layout'].addEventListener('change', () => {
  flushCropSave();
  state.layout = elements['crop-layout'].value;
  elements['crop-hint'].textContent = isCropping()
    ? 'Space + drag to reframe. Use the slider, percentage, or wheel to zoom. Originals stay unchanged.'
    : 'Originals stay unchanged.';
  api.setLayout(state.folder, state.layout).catch(error => showToast(error.message || 'Could not save layout', true));
  render();
  elements.stage.focus({ preventScroll: true });
});
elements['empty-open-folder'].addEventListener('click', openFolder);
elements['toggle-non-keepers'].addEventListener('click', toggleNonKeepers);
elements['toggle-loop'].addEventListener('click', () => {
  state.loopNavigation = !state.loopNavigation;
  renderStats();
  renderStage();
});
elements['toggle-sidebar'].addEventListener('click', toggleSidebar);
elements['toggle-filmstrip'].addEventListener('click', toggleFilmstrip);
elements.previous.addEventListener('click', () => move(-1));
elements.next.addEventListener('click', () => move(1));
elements.keep.addEventListener('click', toggleKeeper);
elements['cancel-unmark'].addEventListener('click', cancelUnmark);
elements['confirm-unmark'].addEventListener('click', confirmUnmark);
elements['unmark-dialog'].addEventListener('cancel', event => {
  event.preventDefault();
  cancelUnmark();
});
elements['unmark-dialog'].addEventListener('click', event => {
  if (event.target === elements['unmark-dialog']) cancelUnmark();
});
elements['copy-keepers'].addEventListener('click', copyKeepers);

document.addEventListener('keydown', event => {
  if (pendingUnmark) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'Enter') confirmUnmark();
    else cancelUnmark();
    return;
  }
  if (event.target === elements['zoom-map'] && event.key.startsWith('Arrow')) return;
  if (['INPUT', 'TEXTAREA', 'SELECT', 'SUMMARY'].includes(document.activeElement?.tagName)) return;
  if (event.code === 'Space' || event.key === ' ') {
    if (event.target.closest('button')) return;
    if (isCropping()) { event.preventDefault(); spaceHeld = true; updateZoom(); }
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
  const key = event.key.toLowerCase();
  if (key === 'arrowdown' || key === 'j') move(1);
  else if (key === 'arrowup' || key === 'k') move(-1);
  else if (key === 'l') toggleKeeper();
  else if (key === 'h') toggleNonKeepers();
  else if (key === 'b') toggleSidebar();
  else if (key === 'f') toggleFilmstrip();
  else if (key === 'c') copyKeepers();
  else if (key === 'z') { resetZoom(); rememberCrop(); }
  else if (key === '+' || key === '=') zoomFromControl(zoom.scale + 0.01);
  else if (key === '-') zoomFromControl(zoom.scale - 0.01);
  else return;
  event.preventDefault();
}, true);

function releaseSpace() {
  spaceHeld = false;
  endPan();
  updateZoom();
  flushCropSave();
}
document.addEventListener('keyup', event => {
  if (event.code === 'Space' || event.key === ' ') { if (spaceHeld) event.preventDefault(); releaseSpace(); }
});
window.addEventListener('blur', releaseSpace);
window.addEventListener('beforeunload', flushCropSave);

api.onFolderChanged(applyFolder);
api.getInitialState().then(applyFolder).catch(error => showToast(error.message || 'Could not load the library', true));
render();
