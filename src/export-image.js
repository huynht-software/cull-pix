const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exifr = require('exifr');
const sharp = require('sharp');
const { exportGeometry, validRotation, rotatedDimensions } = require('./crop');
const runFile = promisify(execFile);

async function openOriginal(source) {
  try {
    if (/\.hei[cf]$/i.test(source) && !sharp.format.heif.input.fileSuffix?.some(suffix => /\.hei[cf]$/i.test(suffix))) {
      throw new Error('HEIC requires the operating system decoder');
    }
    const pipeline = sharp(source).autoOrient();
    return { pipeline, metadata: await pipeline.metadata(), cleanup: async () => {} };
  } catch (originalError) {
    // HEIC/BMP decoding may be available through the OS even when libvips lacks it.
    if (!/\.(hei[cf]|bmp)$/i.test(source) || !['win32', 'darwin'].includes(process.platform)) throw originalError;
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'cull-pix-decode-'));
    const decoded = path.join(temporary, 'original.png');
    const cleanup = () => fs.rm(temporary, { recursive: true, force: true }).catch(() => {});
    try {
      if (process.platform === 'win32') {
        const script = `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore
$sourceStream = [IO.File]::OpenRead($env:CULL_PIX_EXPORT_SOURCE)
try {
  $decoder = [Windows.Media.Imaging.BitmapDecoder]::Create($sourceStream, [Windows.Media.Imaging.BitmapCreateOptions]::PreservePixelFormat, [Windows.Media.Imaging.BitmapCacheOption]::OnLoad)
  $encoder = New-Object Windows.Media.Imaging.PngBitmapEncoder
  $encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($decoder.Frames[0]))
  $targetStream = [IO.File]::Create($env:CULL_PIX_EXPORT_DECODED)
  try { $encoder.Save($targetStream) } finally { $targetStream.Dispose() }
} finally { $sourceStream.Dispose() }`;
        await runFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
          windowsHide: true, timeout: 120000,
          env: { ...process.env, CULL_PIX_EXPORT_SOURCE: source, CULL_PIX_EXPORT_DECODED: decoded }
        });
        const orientation = await exifr.orientation(source).catch(() => 1);
        if (orientation > 1 && orientation <= 8) {
          const pixels = await sharp(decoded).withMetadata({ orientation }).png().toBuffer();
          const pipeline = sharp(pixels).autoOrient();
          return { pipeline, metadata: await pipeline.metadata(), cleanup };
        }
      } else await runFile('/usr/bin/sips', ['-s', 'format', 'png', source, '--out', decoded], { timeout: 120000 });
      const pipeline = sharp(decoded).autoOrient();
      return { pipeline, metadata: await pipeline.metadata(), cleanup };
    } catch {
      await cleanup();
      throw new Error(/\.hei[cf]$/i.test(source)
        ? 'A full-resolution HEIC decoder is unavailable on this computer. Install the operating system’s HEIF/HEVC image codec or export from a JPEG/PNG copy.'
        : 'A full-resolution decoder is unavailable for this image. Try exporting from a JPEG/PNG copy.');
    }
  }
}

async function exportImage(source, destination, { layout, crop, border, rotation = 0 }) {
  if (!validRotation(rotation)) throw new Error('Invalid photo rotation');
  if (path.resolve(source).toLowerCase() === path.resolve(destination).toLowerCase()) {
    throw new Error('Choose a new filename. Export never overwrites the original photo.');
  }
  const extension = path.extname(destination).toLowerCase();
  if (!['.jpg', '.jpeg', '.png'].includes(extension)) throw new Error('Choose a JPEG or PNG filename.');
  let pipeline;
  let metadata;
  let cleanup;
  try {
    ({ pipeline, metadata, cleanup } = await openOriginal(source));
  } catch (error) {
    throw new Error(`The original image could not be decoded at full resolution. Try a JPEG, PNG, WebP, AVIF or TIFF source. ${error.message}`);
  }
  const oriented = metadata.autoOrient || (metadata.orientation >= 5 && metadata.orientation <= 8
    ? { width: metadata.height, height: metadata.width } : metadata);
  if (!oriented.width || !oriented.height) throw new Error('Original image dimensions are unavailable.');
  const dimensions = rotatedDimensions(oriented.width, oriented.height, rotation);
  const geometry = exportGeometry(dimensions.width, dimensions.height, layout, crop, border);
  if (rotation) pipeline = pipeline.rotate(rotation);
  pipeline = pipeline.extract({ left: geometry.left, top: geometry.top, width: geometry.width, height: geometry.height });
  if (geometry.padding) pipeline = pipeline.extend({ top: geometry.padding, bottom: geometry.padding,
    left: geometry.padding, right: geometry.padding, background: border.color });
  // Keep capture metadata, with orientation normalized after the pixel rotation.
  pipeline = pipeline.withMetadata({ orientation: 1 });
  if (extension === '.png') pipeline = pipeline.png();
  else pipeline = pipeline.flatten({ background: border.enabled ? border.color : '#ffffff' }).jpeg({ quality: 100, chromaSubsampling: '4:4:4' });
  const temporary = path.join(path.dirname(destination), `.cull-pix-export-${randomUUID()}.tmp`);
  try {
    await pipeline.toFile(temporary);
    await fs.rename(temporary, destination);
  } finally { await fs.unlink(temporary).catch(() => {}); await cleanup(); }
  return { file: destination, width: geometry.outputWidth, height: geometry.outputHeight };
}

module.exports = { exportImage };
