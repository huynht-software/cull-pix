const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const exifr = require('exifr');
const { CACHE_DIRECTORY } = require('./thumbnail-cache');

function captureTimestamp(value, offset, subsecond) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value !== 'string') return null;
  const parts = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(value.trim());
  if (!parts) return null;
  const [year, month, day, hour, minute, second] = parts.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
      || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) return null;
  let time = date.getTime();
  if (typeof offset === 'string') {
    const zone = /^([+-])(\d{2}):(\d{2})$/.exec(offset.trim());
    if (zone && Number(zone[2]) <= 23 && Number(zone[3]) < 60) {
      time -= (zone[1] === '-' ? -1 : 1) * (Number(zone[2]) * 60 + Number(zone[3])) * 60000;
    }
  }
  if (/^\d+$/.test(String(subsecond ?? ''))) time += Number(String(subsecond).padEnd(3, '0').slice(0, 3));
  return time;
}

function createCaptureDateReader(parse = exifr.parse) {
  async function readFolder(folder, names, isCurrent = () => true) {
    const directory = path.join(folder, CACHE_DIRECTORY);
    const cachePath = path.join(directory, 'capture-dates-v1.json');
    let cached = {};
    try {
      const data = JSON.parse(await fs.readFile(cachePath, 'utf8'));
      if (data.version === 1 && data.entries && typeof data.entries === 'object') cached = data.entries;
    } catch { /* Metadata caches are optional. */ }
    const entries = {};
    const dates = {};
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, names.length) }, async () => {
      while (next < names.length && isCurrent()) {
        const name = names[next++];
        if (path.basename(name) !== name) continue;
        try {
          const source = path.join(folder, name);
          const stat = await fs.stat(source, { bigint: true });
          const signature = `${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
          const previous = cached[name];
          let dateTaken = null;
          if (previous?.signature === signature && (previous.dateTaken === null || Number.isFinite(previous.dateTaken))) {
            dateTaken = previous.dateTaken;
          } else {
            try {
              const metadata = await parse(source, { pick: ['DateTimeOriginal', 'OffsetTimeOriginal', 'SubSecTimeOriginal'], reviveValues: false });
              dateTaken = captureTimestamp(metadata?.DateTimeOriginal, metadata?.OffsetTimeOriginal, metadata?.SubSecTimeOriginal);
            } catch { /* Missing or unsupported EXIF has no capture date. */ }
          }
          dates[name] = dateTaken;
          entries[name] = { signature, dateTaken };
        } catch { dates[name] = null; }
      }
    }));
    // Do not let a cancelled pass overwrite a newer folder's metadata index.
    if (isCurrent()) {
      const temporary = path.join(directory, `capture-dates-${randomUUID()}.tmp`);
      try {
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(temporary, JSON.stringify({ version: 1, entries }));
        await fs.rename(temporary, cachePath);
      } catch { /* Read-only folders can still be sorted for this session. */ }
      finally { await fs.unlink(temporary).catch(() => {}); }
    }
    return dates;
  }
  return { readFolder };
}

module.exports = { captureTimestamp, createCaptureDateReader };
