(function (root) {
  const layouts = Object.freeze({
    original: { label: 'Original', ratio: 0 },
    square: { label: 'Square · 1:1', ratio: 1 },
    portrait: { label: 'Instagram portrait · 4:5', ratio: 4 / 5 },
    tall: { label: 'Instagram portrait · 3:4', ratio: 3 / 4 },
    landscape: { label: 'Instagram landscape · 1.91:1', ratio: 1.91 },
    story: { label: 'Instagram Story / Reel · 9:16', ratio: 9 / 16 }
  });
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const validRotation = rotation => [0, 90, 180, 270].includes(rotation);
  function rotatedDimensions(width, height, rotation = 0) {
    return rotation % 180 ? { width: height, height: width } : { width, height };
  }
  function rotateCrop(crop, turns) {
    let { x, y } = crop;
    for (let turn = 0; turn < ((turns % 4) + 4) % 4; turn += 1) [x, y] = [-y, x];
    return { scale: crop.scale, x, y };
  }
  const defaultBorder = () => ({ enabled: false, width: 3, color: '#ffffff' });
  function validBorder(border) {
    return border && typeof border.enabled === 'boolean' && Number.isFinite(border.width)
      && border.width >= 0 && border.width <= 20 && /^#[0-9a-f]{6}$/i.test(border.color);
  }
  function borderFrame(width, height, imageWidth, imageHeight, layout, border) {
    if (!validBorder(border) || !border.enabled || !border.width || !imageWidth || !imageHeight) {
      const frame = frameSize(width, height, layout);
      return { ...frame, outerWidth: frame.width, outerHeight: frame.height, borderPixels: 0 };
    }
    const ratio = layouts[layout]?.ratio || imageWidth / imageHeight;
    const fraction = border.width / 100;
    const original = !layouts[layout]?.ratio;
    const padding = fraction * Math.min(ratio, 1);
    const outerRatio = original ? (ratio + padding * 2) / (1 + padding * 2) : ratio;
    const outerWidth = Math.min(Math.max(1, width - 48), Math.max(1, height - 48) * outerRatio);
    const outerHeight = outerWidth / outerRatio;
    const borderPixels = original ? outerHeight * padding / (1 + padding * 2) : Math.min(outerWidth, outerHeight) * fraction;
    return { width: outerWidth - borderPixels * 2, height: outerHeight - borderPixels * 2,
      outerWidth, outerHeight, borderPixels };
  }

  function exportGeometry(imageWidth, imageHeight, layout, crop, border) {
    if (!Object.hasOwn(layouts, layout) || !validCrop(crop) || !validBorder(border)) throw new Error('Invalid export settings');
    const fraction = border.enabled ? border.width / 100 : 0;
    const ratio = layouts[layout].ratio;
    let width = imageWidth;
    let height = imageHeight;
    let padding;
    if (!ratio) {
      padding = Math.round(Math.min(width, height) * fraction);
    } else {
      const unitBorder = fraction * Math.min(ratio, 1);
      const innerRatio = (ratio - 2 * unitBorder) / (1 - 2 * unitBorder);
      const availableWidth = Math.min(imageWidth, imageHeight * innerRatio) / crop.scale;
      const availableHeight = availableWidth / innerRatio;
      let outerHeight = Math.floor(availableHeight / (1 - 2 * unitBorder));
      // Round to real pixels while keeping the output ratio and never enlarging the photo.
      do {
        const outerWidth = Math.max(1, Math.round(outerHeight * ratio));
        padding = Math.round(Math.min(outerWidth, outerHeight) * fraction);
        width = outerWidth - 2 * padding;
        height = outerHeight - 2 * padding;
        if (width <= availableWidth + 1 && height <= availableHeight + 1) break;
        outerHeight -= 1;
      } while (outerHeight > 0);
    }
    width = clamp(Math.round(width), 1, imageWidth);
    height = clamp(Math.round(height), 1, imageHeight);
    const left = Math.round(clamp(imageWidth * (0.5 - (ratio ? crop.x : 0)) - width / 2, 0, imageWidth - width));
    const top = Math.round(clamp(imageHeight * (0.5 - (ratio ? crop.y : 0)) - height / 2, 0, imageHeight - height));
    return { left, top, width, height, padding, outputWidth: width + padding * 2, outputHeight: height + padding * 2 };
  }
  function validCrop(crop) {
    return crop && Number.isFinite(crop.scale) && crop.scale >= 1 && crop.scale <= 8
      && Number.isFinite(crop.x) && Math.abs(crop.x) <= 0.5
      && Number.isFinite(crop.y) && Math.abs(crop.y) <= 0.5;
  }
  function frameSize(width, height, layout) {
    const ratio = layouts[layout]?.ratio || 0;
    if (!ratio) return { width, height };
    const availableWidth = Math.max(1, width - 48);
    const availableHeight = Math.max(1, height - 48);
    const frameWidth = Math.min(availableWidth, availableHeight * ratio);
    return { width: frameWidth, height: frameWidth / ratio };
  }
  function imageGeometry(width, height, imageWidth, imageHeight, layout, scale) {
    const fit = imageWidth && imageHeight
      ? (layouts[layout]?.ratio ? Math.max : Math.min)(width / imageWidth, height / imageHeight) : 0;
    const photoWidth = imageWidth * fit * scale;
    const photoHeight = imageHeight * fit * scale;
    return { fit, photoWidth, photoHeight,
      maxX: Math.max(0, (photoWidth - width) / 2),
      maxY: Math.max(0, (photoHeight - height) / 2) };
  }
  const api = { layouts, clamp, validCrop, frameSize, imageGeometry, defaultBorder, validBorder, borderFrame, exportGeometry, validRotation, rotatedDimensions, rotateCrop };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CullCrop = api;
})(globalThis);
