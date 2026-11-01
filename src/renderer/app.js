const api = window.cullPix;
const elements = Object.fromEntries([
  'app-shell', 'sidebar', 'toggle-sidebar', 'toggle-filmstrip', 'filmstrip-panel',
  'open-folder', 'empty-open-folder', 'folder-name', 'toggle-non-keepers', 'toggle-loop',
  'reviewed-count', 'reviewed-percent', 'progress-fill', 'keeper-count',
  'unmarked-count', 'copy-keepers', 'copy-count',
  'position', 'stage', 'empty-state', 'main-image',
  'preview-error', 'reset-zoom', 'zoom-map', 'zoom-map-image', 'zoom-map-viewport', 'previous', 'next', 'stage-badge',
  'keep', 'visible-count', 'filmstrip', 'toast',
  'unmark-dialog', 'cancel-unmark', 'confirm-unmark'
].map(id => [id, document.getElementById(id)]));

const state = {
  folder: null,
  images: [],
  selectedName: null,
  showNonKeepers: true,
  loopNavigation: false,
  showSidebar: true,
  showFilmstrip: true,
  busy: false
};
const previewCache = new Map();
let toastTimer;
let previewToken = 0;
let thumbnailObserver;
let filmstripKey = null;
let lastScrolledName = null;
let pendingUnmark = null;
let mapPreviewKey = null;
let mapPointer = null;
const zoom = { scale: 1, x: 0, y: 0, imageKey: null, drag: null };

function updateZoom() {
  const image = elements['main-image'];
  const width = elements.stage.clientWidth;
  const height = elements.stage.clientHeight;
  const fit = image.naturalWidth && image.naturalHeight
    ? Math.min(width / image.naturalWidth, height / image.naturalHeight) : 0;
  const maxX = Math.max(0, (image.naturalWidth * fit * zoom.scale - width) / 2);
  const maxY = Math.max(0, (image.naturalHeight * fit * zoom.scale - height) / 2);
  zoom.x = Math.max(-maxX, Math.min(maxX, zoom.x));
  zoom.y = Math.max(-maxY, Math.min(maxY, zoom.y));
  image.style.transform = `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`;
  elements.stage.classList.toggle('zoomed', zoom.scale > 1);
  const reset = elements['reset-zoom'];
  reset.hidden = zoom.scale === 1;
  reset.textContent = `Fit · ${Math.round(zoom.scale * 100)}%`;
  updateZoomMap(image, width, height, fit);
}

function updateZoomMap(image, width, height, fit) {
  const map = elements['zoom-map'];
  map.hidden = zoom.scale <= 1 || image.hidden || !fit;
  if (map.hidden) return;
  const canvas = elements['zoom-map-image'];
  const mapFit = Math.min(Math.min(160, width * 0.25) / image.naturalWidth, 120 / image.naturalHeight);
  const mapWidth = Math.max(1, Math.round(image.naturalWidth * mapFit));
  const mapHeight = Math.max(1, Math.round(image.naturalHeight * mapFit));
  const key = `${zoom.imageKey}\u0000${mapWidth}\u0000${mapHeight}`;
  if (mapPreviewKey !== key) {
    canvas.width = mapWidth * 2;
    canvas.height = mapHeight * 2;
    canvas.style.width = `${mapWidth}px`;
    canvas.style.height = `${mapHeight}px`;
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    mapPreviewKey = key;
  }
  const photoWidth = image.naturalWidth * fit * zoom.scale;
  const photoHeight = image.naturalHeight * fit * zoom.scale;
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
  const image = elements['main-image'];
  const fit = Math.min(elements.stage.clientWidth / image.naturalWidth, elements.stage.clientHeight / image.naturalHeight);
  zoom.x = (0.5 - Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))) * image.naturalWidth * fit * zoom.scale;
  zoom.y = (0.5 - Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))) * image.naturalHeight * fit * zoom.scale;
  updateZoom();
}

function endMapPan() {
  const pointer = mapPointer;
  mapPointer = null;
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
  if (event.detail === 0) { zoom.x = zoom.y = 0; updateZoom(); }
});
elements['zoom-map'].addEventListener('keydown', event => {
  const directions = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
  const direction = directions[event.key];
  if (!direction) return;
  event.preventDefault();
  event.stopPropagation();
  zoom.x += direction[0] * elements.stage.clientWidth * 0.15;
  zoom.y += direction[1] * elements.stage.clientHeight * 0.15;
  updateZoom();
});

function resetZoom() {
  endMapPan();
  endPan();
  zoom.scale = 1;
  zoom.x = zoom.y = 0;
  updateZoom();
}

function zoomAt(scale, clientX, clientY) {
  if (!selectedImage() || elements['main-image'].hidden) return;
  const next = Math.max(1, Math.min(8, scale));
  const rect = elements.stage.getBoundingClientRect();
  const x = clientX - rect.left - rect.width / 2;
  const y = clientY - rect.top - rect.height / 2;
  const ratio = next / zoom.scale;
  zoom.x = x - (x - zoom.x) * ratio;
  zoom.y = y - (y - zoom.y) * ratio;
  zoom.scale = next;
  updateZoom();
}

function endPan() {
  if (zoom.drag && elements.stage.hasPointerCapture(zoom.drag.id)) {
    elements.stage.releasePointerCapture(zoom.drag.id);
  }
  zoom.drag = null;
  elements.stage.classList.remove('panning');
}

// Chromium reports trackpad pinches as Ctrl+wheel, as it does mouse-wheel zoom.
elements.stage.addEventListener('wheel', event => {
  if (event.ctrlKey) {
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? elements.stage.clientHeight : 1);
    zoomAt(zoom.scale * Math.exp(-Math.max(-200, Math.min(200, delta)) * 0.01), event.clientX, event.clientY);
  } else if (zoom.scale > 1 && selectedImage()) {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? elements.stage.clientHeight : 1;
    zoom.x -= event.deltaX * unit;
    zoom.y -= event.deltaY * unit;
    updateZoom();
  }
}, { passive: false });
elements.stage.addEventListener('pointerdown', event => {
  if (zoom.scale <= 1 || event.button !== 0 || event.target.closest('button')) return;
  event.preventDefault();
  zoom.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, panX: zoom.x, panY: zoom.y };
  elements.stage.setPointerCapture(event.pointerId);
  elements.stage.classList.add('panning');
});
elements.stage.addEventListener('pointermove', event => {
  if (!zoom.drag || zoom.drag.id !== event.pointerId) return;
  zoom.x = zoom.drag.panX + event.clientX - zoom.drag.x;
  zoom.y = zoom.drag.panY + event.clientY - zoom.drag.y;
  updateZoom();
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  elements.stage.addEventListener(type, endPan);
}
elements.stage.addEventListener('dblclick', event => {
  if (event.target.closest('button')) return;
  if (zoom.scale > 1) resetZoom();
  else zoomAt(2, event.clientX, event.clientY);
});
elements['reset-zoom'].addEventListener('click', resetZoom);
elements['main-image'].addEventListener('load', updateZoom);
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
  cancelUnmark();
  const sameFolder = folderState.folder === state.folder;
  state.folder = folderState.folder;
  state.images = folderState.images.map(image => ({ ...image, status: image.status === 'keep' ? 'keep' : 'unreviewed' }));
  previewCache.clear();
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
  render();
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
  if (!previewCache.has(key)) previewCache.set(key, api.getNativePreview(image.name, size));
  return previewCache.get(key);
}

function renderMainImage(image) {
  const key = image ? `${state.folder}\u0000${image.name}\u0000${image.url}` : null;
  if (zoom.imageKey === key) { updateZoom(); return; }
  zoom.imageKey = key;
  resetZoom();
  previewToken += 1;
  const token = previewToken;
  elements['main-image'].hidden = true;
  elements['main-image'].removeAttribute('src');
  elements['preview-error'].hidden = true;
  if (!image) return;

  elements['main-image'].alt = image.name;
  elements['main-image'].onerror = () => {
    if (token === previewToken) {
      elements['main-image'].hidden = true;
      elements['preview-error'].hidden = false;
    }
  };
  if (image.nativePreview) {
    getPreview(image, 2600).then(url => {
      if (token !== previewToken) return;
      elements['main-image'].src = url;
      elements['main-image'].hidden = false;
    }).catch(() => {
      if (token === previewToken) elements['preview-error'].hidden = false;
    });
  } else {
    elements['main-image'].src = image.url;
    elements['main-image'].hidden = false;
  }
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
  if (!state.showFilmstrip) return;
  const visible = visibleImages();
  const key = `${state.folder}\u0000${visible.map(image => image.name).join('\u0000')}`;

  if (key !== filmstripKey) {
    thumbnailObserver?.disconnect();
    elements.filmstrip.replaceChildren();
    const fragment = document.createDocumentFragment();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        const image = state.images.find(item => item.name === entry.target.dataset.name);
        if (!image) continue;
        const img = entry.target.querySelector('img');
        if (image.nativePreview) {
          getPreview(image, 320).then(url => { if (img.isConnected) img.src = url; }).catch(() => {});
        } else img.src = image.url;
      }
    }, { root: elements.filmstrip, rootMargin: '120px' });
    thumbnailObserver = observer;

    for (const image of visible) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'thumb';
      button.dataset.name = image.name;
      const img = document.createElement('img');
      img.alt = '';
      button.append(img);
      button.addEventListener('click', () => {
        state.selectedName = image.name;
        render();
      });
      fragment.append(button);
    }
    elements.filmstrip.append(fragment);
    elements.filmstrip.querySelectorAll('.thumb').forEach(button => observer.observe(button));
    filmstripKey = key;
    lastScrolledName = null;
  }

  const imagesByName = new Map(visible.map(image => [image.name, image]));
  for (const button of elements.filmstrip.querySelectorAll('.thumb')) {
    const image = imagesByName.get(button.dataset.name);
    button.classList.toggle('selected', image.name === state.selectedName);
    button.setAttribute('aria-current', String(image.name === state.selectedName));
    button.setAttribute('aria-label', `${image.name}, ${image.status === 'keep' ? 'keeper' : 'unmarked'}`);
    let marker = button.querySelector('.thumb-status');
    if (image.status === 'unreviewed') marker?.remove();
    else {
      if (!marker) {
        marker = document.createElement('span');
        button.append(marker);
      }
      marker.className = `thumb-status ${image.status}`;
      marker.textContent = '✓';
    }
  }
  const selected = elements.filmstrip.querySelector('.thumb.selected');
  if (selected && lastScrolledName !== state.selectedName) {
    lastScrolledName = state.selectedName;
    requestAnimationFrame(() => selected.scrollIntoView({ block: 'center', inline: 'nearest' }));
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
  if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
  if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
  const key = event.key.toLowerCase();
  if (key === 'arrowdown' || key === 'j') move(1);
  else if (key === 'arrowup' || key === 'k') move(-1);
  else if (key === 'l') toggleKeeper();
  else if (key === 'h') toggleNonKeepers();
  else if (key === 'b') toggleSidebar();
  else if (key === 'f') toggleFilmstrip();
  else if (key === 'c') copyKeepers();
  else if (key === 'z') resetZoom();
  else return;
  event.preventDefault();
}, true);

api.onFolderChanged(applyFolder);
api.getInitialState().then(applyFolder).catch(error => showToast(error.message || 'Could not load the library', true));
render();
