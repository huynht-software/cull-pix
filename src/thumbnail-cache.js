const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');

const CACHE_DIRECTORY = '.cull-pix-cache';
const EDGE = 320;
const hash = value => createHash('sha256').update(value).digest('hex');

function createThumbnailCache(generate, concurrency = 2) {
  const pending = new Map();
  const queue = [];
  const backgroundQueue = [];
  let active = 0;
  let warming;

  function drain() {
    while (active < concurrency && (queue.length || backgroundQueue.length)) {
      const { work, resolve, reject } = queue.shift() || backgroundQueue.shift();
      active += 1;
      Promise.resolve().then(work).then(resolve, reject).finally(() => { active -= 1; drain(); });
    }
  }

  async function thumbnail(folder, name, { background = false } = {}) {
    if (path.basename(name) !== name || name === '.' || name === '..') throw new Error('Invalid image name');
    const source = path.join(folder, name);
    const stat = await fs.stat(source, { bigint: true });
    if (!stat.isFile()) throw new Error('Image is no longer available');
    const fingerprint = hash(`v1:${EDGE}:${name}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`);
    const directory = path.join(folder, CACHE_DIRECTORY);
    const target = path.join(directory, `${fingerprint}.jpg`);
    if (pending.has(target)) {
      const entry = pending.get(target);
      // Bring a newly visible photo ahead of queued background work.
      const index = backgroundQueue.indexOf(entry.task);
      if (!background && index >= 0) queue.push(...backgroundQueue.splice(index, 1));
      return entry.promise;
    }
    let task;
    const result = new Promise((resolve, reject) => {
      task = { resolve, reject, work: async () => {
        try {
          const cached = await fs.stat(target);
          if (cached.isFile() && cached.size > 0) return pathToFileURL(target).href;
        } catch { /* A cache miss must not stop the review. */ }
        const bytes = await generate(source, EDGE);
        // Read-only folders can still show generated thumbnails for this session.
        let temporary;
        try {
          await fs.mkdir(directory, { recursive: true });
          temporary = path.join(directory, `${fingerprint}.${randomUUID()}.tmp`);
          await fs.writeFile(temporary, bytes, { flag: 'wx' });
          await fs.rename(temporary, target);
          return pathToFileURL(target).href;
        } catch {
          return `data:image/jpeg;base64,${bytes.toString('base64')}`;
        } finally {
          if (temporary) await fs.unlink(temporary).catch(() => {});
        }
      } };
      (background ? backgroundQueue : queue).push(task);
      drain();
    });
    pending.set(target, { promise: result, task });
    try { return await result; }
    finally { pending.delete(target); }
  }

  function warmFolder(folder, names) {
    warming?.cancel();
    let cancelled = false;
    const job = {
      cancel() { cancelled = true; },
      done: (async () => {
        // One background worker leaves capacity for visible photos and avoids
        // enqueuing thousands of jobs that would outlive a folder switch.
        for (const name of names) {
          if (cancelled) break;
          try { await thumbnail(folder, name, { background: true }); }
          catch { /* Skip missing files and formats without a native preview. */ }
        }
      })()
    };
    warming = job;
    return job;
  }

  return { thumbnail, warmFolder };
}

module.exports = { createThumbnailCache, CACHE_DIRECTORY };
