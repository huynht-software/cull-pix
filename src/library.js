const path = require('node:path');

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif',
  '.heic', '.heif', '.tif', '.tiff'
]);

const NATIVE_PREVIEW_EXTENSIONS = new Set(['.heic', '.heif', '.tif', '.tiff']);

function isImageName(name) {
  return IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase());
}

function needsNativePreview(name) {
  return NATIVE_PREVIEW_EXTENSIONS.has(path.extname(name).toLowerCase());
}

function countStatuses(images) {
  return images.reduce((counts, image) => {
    counts[image.status === 'keep' ? 'keep' : 'unreviewed'] += 1;
    return counts;
  }, { keep: 0, unreviewed: 0 });
}

function visibleImages(images, showNonKeepers) {
  return showNonKeepers ? images : images.filter(image => image.status === 'keep');
}

function nextVisibleName(images, currentName, showNonKeepers, direction = 1, loop = false) {
  const visible = visibleImages(images, showNonKeepers);
  if (!visible.length) return null;
  const index = visible.findIndex(image => image.name === currentName);
  if (index < 0) return visible[0].name;
  const target = index + direction;
  if (!loop && (target < 0 || target >= visible.length)) return currentName;
  return visible[(target + visible.length) % visible.length].name;
}

module.exports = {
  isImageName,
  needsNativePreview,
  countStatuses,
  visibleImages,
  nextVisibleName
};
