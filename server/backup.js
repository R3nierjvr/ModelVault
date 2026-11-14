// Backups of a ModelVault install, and restoring one into another install.
//
// A backup is a ZIP file:
//   modelvault-backup.json   what's inside: when, which version, and where each location was on the old install
//   data/modelvault.db       the database (models, categories, tags, paints, materials, tools, settings)
//   data/thumbs/…            3D preview pictures
//   files/<location>/…       with model files: each model's folder, under the location it was in
// The ZIP is written and read here (no outside tools), with ZIP64 so backups can be bigger than 4 GB.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync } from 'node:sqlite';
import { httpError, within, rmQuiet } from './files.js';

export const MANIFEST = 'modelvault-backup.json';
const BACKUP_FOLDER = 'ModelVault backups';
const SKIP_DIRS = new Set(['.trash', '.modelvault-staging', '@eadir', '#recycle', BACKUP_FOLDER.toLowerCase()]);
const ZIP64 = 0xffffffff;

// ---------- ZIP writer ----------
function dosTime(d) {
  const t = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const day = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return [t, day];
}
class ZipWriter {
  constructor(out) { this.out = out; this.offset = 0; this.entries = []; }
  write(buf) {
    this.offset += buf.length;
    return this.out.write(buf) ? Promise.resolve() : new Promise((resolve, reject) => {
      const done = () => { this.out.off('error', fail); resolve(); };
      const fail = (e) => { this.out.off('drain', done); reject(e); };
      this.out.once('drain', done); this.out.once('error', fail);
    });
  }
  /** Add one entry from a file or a Buffer. Pictures, archives and big files are stored as they are; the rest is compressed. */
  async add(name, src, { mtime = new Date(), size = null } = {}) {
    const nameBuf = Buffer.from(name.replace(/\\/g, '/'), 'utf8');
    const total = Buffer.isBuffer(src) ? src.length : size;
    const store = total > 512 * 1024 * 1024 || /\.(zip|7z|rar|gz|xz|bz2|jpe?g|png|webp|gif|mp4|mov|webm|mkv|3mf|lys|lyt|ctb|goo|pwmx|pdf)$/i.test(name);
    const big = total >= 0xfffffff0;
    const [time, date] = dosTime(mtime);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(45, 4); local.writeUInt16LE(0x0808, 6); local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
    local.writeUInt32LE(0, 14); local.writeUInt32LE(big ? ZIP64 : 0, 18); local.writeUInt32LE(big ? ZIP64 : 0, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const extra = big ? Buffer.alloc(20) : Buffer.alloc(0);
    if (big) { extra.writeUInt16LE(1, 0); extra.writeUInt16LE(16, 2); }
    local.writeUInt16LE(extra.length, 28);
    const start = this.offset;
    await this.write(Buffer.concat([local, nameBuf, extra]));
    let crc = 0, usize = 0, csize = 0;
    const count = async (chunk) => { csize += chunk.length; await this.write(chunk); };
    const input = Buffer.isBuffer(src) ? [src] : fs.createReadStream(src, { highWaterMark: 1024 * 1024 });
    if (store) {
      for await (const chunk of input) { crc = zlib.crc32(chunk, crc); usize += chunk.length; await count(chunk); }
    } else {
      const def = zlib.createDeflateRaw({ level: 6 });
      const pump = (async () => { for await (const chunk of def) await count(chunk); })();
      for await (const chunk of input) { crc = zlib.crc32(chunk, crc); usize += chunk.length; if (!def.write(chunk)) await new Promise((r) => def.once('drain', r)); }
      def.end();
      await pump;
    }
    const desc = Buffer.alloc(big ? 24 : 16);
    desc.writeUInt32LE(0x08074b50, 0); desc.writeUInt32LE(crc >>> 0, 4);
    if (big) { desc.writeBigUInt64LE(BigInt(csize), 8); desc.writeBigUInt64LE(BigInt(usize), 16); } else { desc.writeUInt32LE(csize, 8); desc.writeUInt32LE(usize, 12); }
    await this.write(desc);
    this.entries.push({ nameBuf, crc: crc >>> 0, usize, csize, offset: start, store, time, date });
    return usize;
  }
  async finish() {
    const cdStart = this.offset;
    for (const e of this.entries) {
      const need = [e.usize >= ZIP64, e.csize >= ZIP64, e.offset >= ZIP64];
      const extra = Buffer.alloc(need.some(Boolean) ? 4 + 8 * need.filter(Boolean).length : 0);
      if (extra.length) {
        extra.writeUInt16LE(1, 0); extra.writeUInt16LE(extra.length - 4, 2);
        let at = 4;
        if (need[0]) { extra.writeBigUInt64LE(BigInt(e.usize), at); at += 8; }
        if (need[1]) { extra.writeBigUInt64LE(BigInt(e.csize), at); at += 8; }
        if (need[2]) extra.writeBigUInt64LE(BigInt(e.offset), at);
      }
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(45, 4); h.writeUInt16LE(45, 6); h.writeUInt16LE(0x0808, 8); h.writeUInt16LE(e.store ? 0 : 8, 10);
      h.writeUInt16LE(e.time, 12); h.writeUInt16LE(e.date, 14); h.writeUInt32LE(e.crc, 16);
      h.writeUInt32LE(need[1] ? ZIP64 : e.csize, 20); h.writeUInt32LE(need[0] ? ZIP64 : e.usize, 24);
      h.writeUInt16LE(e.nameBuf.length, 28); h.writeUInt16LE(extra.length, 30);
      h.writeUInt32LE(need[2] ? ZIP64 : e.offset, 42);
      await this.write(Buffer.concat([h, e.nameBuf, extra]));
    }
    const cdSize = this.offset - cdStart, n = this.entries.length;
    if (n >= 0xffff || cdStart >= ZIP64 || cdSize >= ZIP64) {
      const z64 = this.offset;
      const r = Buffer.alloc(56);
      r.writeUInt32LE(0x06064b50, 0); r.writeBigUInt64LE(44n, 4); r.writeUInt16LE(45, 12); r.writeUInt16LE(45, 14);
      r.writeBigUInt64LE(BigInt(n), 24); r.writeBigUInt64LE(BigInt(n), 32); r.writeBigUInt64LE(BigInt(cdSize), 40); r.writeBigUInt64LE(BigInt(cdStart), 48);
      const loc = Buffer.alloc(20);
      loc.writeUInt32LE(0x07064b50, 0); loc.writeBigUInt64LE(BigInt(z64), 8); loc.writeUInt32LE(1, 16);
      await this.write(Buffer.concat([r, loc]));
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(Math.min(n, 0xffff), 8); end.writeUInt16LE(Math.min(n, 0xffff), 10);
    end.writeUInt32LE(Math.min(cdSize, ZIP64), 12); end.writeUInt32LE(Math.min(cdStart, ZIP64), 16);
    await this.write(end);
  }
}

// ---------- ZIP reader (for backups; handles ZIP64, stored and deflated entries) ----------
export async function readZipIndex(file) {
  const fh = await fsp.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const tail = Buffer.alloc(Math.min(size, 66000));
    await fh.read(tail, 0, tail.length, size - tail.length);
    const at = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (at < 0) throw httpError(400, 'That file is not a ZIP file.');
    let count = tail.readUInt16LE(at + 10), cdSize = tail.readUInt32LE(at + 12), cdStart = tail.readUInt32LE(at + 16);
    const locAt = at - 20;
    if (locAt >= 0 && tail.readUInt32LE(locAt) === 0x07064b50) {
      const z64 = Number(tail.readBigUInt64LE(locAt + 8));
      const r = Buffer.alloc(56); await fh.read(r, 0, 56, z64);
      if (r.readUInt32LE(0) === 0x06064b50) { count = Number(r.readBigUInt64LE(32)); cdSize = Number(r.readBigUInt64LE(40)); cdStart = Number(r.readBigUInt64LE(48)); }
    }
    const cd = Buffer.alloc(cdSize); await fh.read(cd, 0, cdSize, cdStart);
    const entries = new Map();
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.length; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const method = cd.readUInt16LE(p + 10);
      let csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24), offset = cd.readUInt32LE(p + 42);
      const nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
      const name = cd.subarray(p + 46, p + 46 + nl).toString('utf8');
      let x = p + 46 + nl;
      const xEnd = x + xl;
      while (x + 4 <= xEnd) {
        const id = cd.readUInt16LE(x), len = cd.readUInt16LE(x + 2);
        if (id === 1) {
          let q = x + 4;
          if (usize === ZIP64) { usize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (csize === ZIP64) { csize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (offset === ZIP64) offset = Number(cd.readBigUInt64LE(q));
        }
        x += 4 + len;
      }
      if (!name.endsWith('/')) entries.set(name, { name, method, csize, usize, offset });
      p = xEnd + cl;
    }
    return entries;
  } finally { await fh.close(); }
}
/** A readable stream of one entry's contents. */
export async function openEntry(file, e) {
  const fh = await fsp.open(file, 'r');
  const h = Buffer.alloc(30); await fh.read(h, 0, 30, e.offset); await fh.close();
  if (h.readUInt32LE(0) !== 0x04034b50) throw httpError(400, `The backup is damaged near ${e.name}.`);
  const start = e.offset + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
  if (!e.csize) { const { Readable } = await import('node:stream'); return Readable.from([]); }
  const raw = fs.createReadStream(file, { start, end: start + e.csize - 1, highWaterMark: 1024 * 1024 });
  if (e.method === 0) return raw;
  if (e.method === 8) return raw.pipe(zlib.createInflateRaw());
  throw httpError(400, `The backup uses a compression ModelVault can't read (${e.name}).`);
}
async function extractEntry(file, e, dest) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.restoring`;
  await pipeline(await openEntry(file, e), fs.createWriteStream(tmp));
  await fsp.rename(tmp, dest);
}

// ---------- making a backup ----------
const stamp = () => new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '-');
export const backupName = (full) => `ModelVault backup ${stamp()}${full ? ' with model files' : ''}.zip`;

async function* walkFiles(dir, rel = '') {
  let ents;
  try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const abs = path.join(dir, e.name), r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name.toLowerCase())) yield* walkFiles(abs, r); } else if (e.isFile()) yield { abs, rel: r };
  }
}

export class Backups {
  constructor(lib, { dataDir, roots, labels, version, locations }) {
    Object.assign(this, { lib, dataDir, roots, labels, version, locations });
    this.restoreDir = path.join(dataDir, 'restore');
    // Database copies left by a backup that a restart interrupted.
    fsp.readdir(dataDir).then((names) => Promise.all(names.filter((n) => /^backup-[0-9a-f-]{36}\.db$/.test(n)).map((n) => rmQuiet(path.join(dataDir, n))))).catch(() => {});
  }
  /** Library model folders to copy, without folders that sit inside another model's folder (they're copied with it). */
  modelFolders() {
    const lib = this.roots.library;
    const paths = this.lib.db.prepare('SELECT path FROM models ORDER BY length(path)').all().map((r) => r.path).filter((p) => lib && within(lib, p) && p !== lib);
    const out = [];
    for (const p of paths) if (!out.some((q) => within(q, p) && q !== p)) out.push(p);
    return out;
  }
  async estimate() {
    const { n } = this.lib.db.prepare('SELECT COUNT(*) AS n FROM models').get();
    const size = this.lib.db.prepare('SELECT path, size FROM models').all().filter((r) => within(this.roots.library, r.path)).reduce((a, r) => a + (r.size || 0), 0);
    let db = 0, thumbs = 0;
    for (const f of ['modelvault.db', 'modelvault.db-wal']) db += (await fsp.stat(path.join(this.dataDir, f)).catch(() => ({ size: 0 }))).size;
    for await (const f of walkFiles(path.join(this.dataDir, 'thumbs'))) thumbs += (await fsp.stat(f.abs).catch(() => ({ size: 0 }))).size;
    return { models: n, modelBytes: size, dataBytes: db + thumbs };
  }
  /** Write a backup to a stream. job (optional) gets progress. */
  async write(out, { full = false, job = null, skip = null } = {}) {
    const zip = new ZipWriter(out);
    const snap = path.join(this.dataDir, `backup-${crypto.randomUUID()}.db`);
    try {
      this.lib.db.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`); // a consistent copy, even while ModelVault is busy
      const roots = Object.fromEntries(Object.entries(this.roots).filter(([, v]) => v));
      const folders = full ? this.modelFolders() : [];
      const models = this.lib.db.prepare('SELECT COUNT(*) AS n FROM models').get().n;
      // How a Windows PC reaches the library ("Folder paths on your PC"), so a restore on Windows can use it.
      let pcLibrary = '';
      try { pcLibrary = JSON.parse(this.lib.setting('pcPaths') || '{}').library || ''; } catch { /* none */ }
      const manifest = { app: 'ModelVault', kind: 'backup', format: 4, version: this.version, created: new Date().toISOString(), platform: process.platform, full, models, roots, labels: this.labels(), pcLibrary };
      await zip.add(MANIFEST, Buffer.from(JSON.stringify(manifest, null, 2)));
      if (job) { job.phase = 'data'; job.current = 'Database'; }
      await zip.add('data/modelvault.db', snap, { size: (await fsp.stat(snap)).size });
      for await (const f of walkFiles(path.join(this.dataDir, 'thumbs'))) {
        const st = await fsp.stat(f.abs).catch(() => null);
        if (st) await zip.add(`data/thumbs/${f.rel}`, f.abs, { mtime: st.mtime, size: st.size });
      }
      if (job) { job.phase = 'files'; job.total = folders.length; job.done = 0; }
      for (const dir of folders) {
        const key = 'library', rel = path.relative(this.roots.library, dir).split(path.sep).join('/');
        if (job) job.current = path.basename(dir);
        for await (const f of walkFiles(dir)) {
          if (skip && f.abs === skip) continue;
          const st = await fsp.stat(f.abs).catch(() => null);
          if (!st) continue;
          try { const n = await zip.add(`files/${key}/${rel ? `${rel}/` : ''}${f.rel}`, f.abs, { mtime: st.mtime, size: st.size }); if (job) job.bytes = (job.bytes || 0) + n; } catch (e) { if (job) job.errors.push(`${f.abs}: ${e.message}`); }
        }
        if (job) job.done++;
      }
      await zip.finish();
    } finally { await rmQuiet(snap); }
  }
  /** Save a backup into "<location>/ModelVault backups/" as a background job. */
  startSave({ full, root }) {
    const base = this.roots[root];
    if (!base) throw httpError(400, 'Choose where to save the backup.');
    const dir = path.join(base, BACKUP_FOLDER);
    const file = path.join(dir, backupName(full));
    const job = { id: crypto.randomUUID(), type: 'backup', label: full ? 'Backing up the library with model files' : 'Backing up the library', status: 'running', phase: 'data', total: 0, done: 0, bytes: 0, current: '', errors: [], file, root };
    this.lib.jobs.set(job.id, job);
    (async () => {
      const tmp = `${file}.partial`;
      try {
        await fsp.mkdir(dir, { recursive: true });
        const out = fs.createWriteStream(tmp);
        const closed = new Promise((resolve, reject) => { out.on('close', resolve); out.on('error', reject); });
        await this.write(out, { full, job, skip: tmp });
        out.end();
        await closed;
        await fsp.rename(tmp, file);
        job.size = (await fsp.stat(file)).size;
        job.status = 'done';
      } catch (e) { job.status = 'error'; job.error = e.message; job.errors.push(e.message); await rmQuiet(tmp); }
      job.finishedAt = Date.now();
    })();
    return job;
  }
  /** Backups saved in the "ModelVault backups" folder of each location. */
  async list() {
    const out = [];
    for (const [root, base] of Object.entries(this.roots)) {
      if (!base) continue;
      let ents;
      try { ents = await fsp.readdir(path.join(base, BACKUP_FOLDER), { withFileTypes: true }); } catch { continue; }
      for (const e of ents) {
        if (!e.isFile() || !/\.zip$/i.test(e.name)) continue;
        const st = await fsp.stat(path.join(base, BACKUP_FOLDER, e.name)).catch(() => null);
        if (st) out.push({ root, rel: `${BACKUP_FOLDER}/${e.name}`, name: e.name, size: st.size, mtime: st.mtimeMs, full: /with model files/i.test(e.name) });
      }
    }
    return out.sort((a, b) => b.mtime - a.mtime);
  }

  // ---------- restoring ----------
  // One rule: models that were in the backup's library point at the same place inside THIS install's library
  // folder, wherever that is (on Windows or a NAS). Files aren't moved. With model files, they're copied into
  // this library first. Models that were outside the library, and this install's own folder settings, are left alone.
  async open(file) {
    const entries = await readZipIndex(file);
    const me = entries.get(MANIFEST);
    if (!me || !entries.has('data/modelvault.db')) throw httpError(400, 'That ZIP is not a ModelVault backup.');
    const manifest = JSON.parse(await streamToString(await openEntry(file, me)));
    await fsp.mkdir(this.restoreDir, { recursive: true });
    const dbFile = path.join(this.restoreDir, `look-${crypto.randomUUID()}.db`);
    await extractEntry(file, entries.get('data/modelvault.db'), dbFile);
    return { entries, manifest, dbFile };
  }
  async inspect(file) {
    const { entries, manifest, dbFile } = await this.open(file);
    try {
      const db = new DatabaseSync(dbFile, { readOnly: true });
      let counts = {}, paths = [], pcLibrary = manifest.pcLibrary || '';
      try {
        if (!pcLibrary) { try { pcLibrary = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'pcPaths'").get()?.value || '{}').library || ''; } catch { /* none */ } }
        const n = (sql) => { try { return db.prepare(sql).get().n; } catch { return 0; } };
        paths = db.prepare('SELECT path FROM models').all().map((r) => r.path);
        counts = { models: paths.length, categories: n('SELECT COUNT(*) AS n FROM group_values'), tags: n('SELECT COUNT(*) AS n FROM tags'), paintDocs: n('SELECT COUNT(*) AS n FROM paint_docs'), customPaints: n('SELECT COUNT(*) AS n FROM custom_paints') };
      } finally { db.close(); }
      const oldLib = manifest.roots?.library || '';
      const inLib = paths.filter((p) => isInside(p, oldLib)).length;
      let fileBytes = 0;
      for (const e of entries.values()) if (e.name.startsWith('files/library/')) fileBytes += e.usize;
      const sw = await this.librarySwitch(manifest, pcLibrary);
      return {
        manifest: { created: manifest.created, version: manifest.version, platform: manifest.platform, full: manifest.full },
        counts, library: { from: oldLib, current: this.roots.library, models: inLib, ...sw }, outside: paths.length - inLib,
        hasFiles: fileBytes > 0, fileBytes,
      };
    } finally { await rmQuiet(dbFile); }
  }
  /**
   * Where this install's library should be after restoring without model files:
   *   on Windows, the old library as this PC reaches it (a Windows backup: its library path; a NAS backup: its
   *   "Folder paths on your PC" for the library). On a NAS (Docker) the library is the /library volume, so it stays.
   * { switchTo, reachable, reason }: switchTo is '' when the library stays as it is.
   */
  async librarySwitch(manifest, pcLibrary) {
    if (process.platform !== 'win32') return { switchTo: '', reason: 'docker' };
    const target = manifest.platform === 'win32' ? manifest.roots?.library || '' : pcLibrary;
    if (!target) return { switchTo: '', reason: manifest.platform === 'win32' ? 'none' : 'no-pc-path' };
    if (isInside(target, this.roots.library) && isInside(this.roots.library, target)) return { switchTo: '', reason: 'same' };
    const reachable = await fsp.stat(target).then((st) => st.isDirectory(), () => false);
    return { switchTo: target, reachable, reason: reachable ? 'switch' : 'unreachable' };
  }
  startRestore(file, { files = true, removeAfter = false } = {}) {
    const job = { id: crypto.randomUUID(), type: 'restore', label: 'Restoring a backup', status: 'running', phase: 'check', total: 0, done: 0, copied: 0, kept: 0, current: '', errors: [] };
    this.lib.jobs.set(job.id, job);
    (async () => {
      let look = null;
      try {
        look = await this.open(file);
        const { entries, manifest } = look;
        // Restoring with model files copies them into this library. Without them, on Windows the library
        // switches to where the old library is (the NAS share, say), so the models open from there.
        const hasFiles = [...entries.keys()].some((n) => n.startsWith('files/library/'));
        let base = this.roots.library, switchTo = '';
        if (!(files && hasFiles)) {
          let pcLibrary = manifest.pcLibrary || '';
          if (!pcLibrary) { const d = new DatabaseSync(look.dbFile, { readOnly: true }); try { pcLibrary = JSON.parse(d.prepare("SELECT value FROM settings WHERE key = 'pcPaths'").get()?.value || '{}').library || ''; } catch { /* none */ } finally { d.close(); } }
          const sw = await this.librarySwitch(manifest, pcLibrary);
          if (sw.reason === 'unreachable') throw httpError(400, `This PC can't open ${sw.switchTo}. Open it once in File Explorer, then restore again.`);
          if (sw.switchTo) { base = sw.switchTo; switchTo = sw.switchTo; }
        }
        // Model files (backups with model files): copied into this library, keeping their folders.
        const fileEntries = files ? [...entries.values()].filter((e) => e.name.startsWith('files/library/')) : [];
        job.total = fileEntries.length;
        job.phase = 'files';
        for (const e of fileEntries) {
          const rest = e.name.split('/').slice(2);
          if (!rest.length || rest.some((x) => x === '..' || x === '')) { job.done++; continue; }
          const dest = path.join(base, ...rest);
          if (!within(base, dest)) { job.done++; continue; }
          job.current = rest[rest.length - 2] || rest[0];
          const have = await fsp.stat(dest).catch(() => null);
          if (have && have.size === e.usize) job.kept++;
          else { try { await extractEntry(file, e, have ? `${dest}.from-backup${path.extname(dest)}` : dest); job.copied++; } catch (err) { job.errors.push(`${rest.join('/')}: ${err.message}`); } }
          job.done++;
        }
        job.phase = 'data';
        job.current = 'Database';
        const stage = path.join(this.restoreDir, 'next');
        await rmQuiet(stage);
        await fsp.mkdir(path.join(stage, 'thumbs'), { recursive: true });
        await fsp.copyFile(look.dbFile, path.join(stage, 'modelvault.db'));
        for (const e of entries.values()) {
          if (!e.name.startsWith('data/thumbs/')) continue;
          const rel = e.name.slice('data/thumbs/'.length);
          if (rel && !rel.split('/').includes('..')) await extractEntry(file, e, path.join(stage, 'thumbs', ...rel.split('/')));
        }
        // This install's own folder settings stay as they are.
        const keepSettings = Object.fromEntries(this.lib.db.prepare("SELECT key, value FROM settings WHERE key IN ('locations', 'pcPaths', 'watchFolders')").all().map((r) => [r.key, r.value]));
        for (const k of ['locations', 'pcPaths', 'watchFolders']) if (!(k in keepSettings)) keepSettings[k] = null;
        await fsp.writeFile(path.join(stage, 'plan.json'), JSON.stringify({ fromLibrary: manifest.roots?.library || '', toLibrary: base, switchLibrary: switchTo, keepSettings, from: manifest.created, version: manifest.version }, null, 2));
        if (removeAfter) await rmQuiet(file);
        job.status = 'done';
        job.restart = true;
      } catch (e) { job.status = 'error'; job.error = e.message; job.errors.push(e.message); }
      finally { if (look) await rmQuiet(look.dbFile); }
      job.finishedAt = Date.now();
    })();
    return job;
  }
}

function streamToString(s) { return new Promise((resolve, reject) => { const parts = []; s.on('data', (c) => parts.push(c)); s.on('end', () => resolve(Buffer.concat(parts).toString('utf8'))); s.on('error', reject); }); }
const trimEnd = (r) => String(r).replace(/[\\/]+$/, '');
const splitRel = (r) => String(r).split(/[\\/]+/).filter(Boolean);
const isWinPath = (p) => /^[a-z]:[\\/]|^[a-z]:$|^\\\\[^\\]/i.test(String(p || ''));
const normWin = (p) => String(p || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
/** Is path a inside folder b (or the same)? Works for Windows and Linux paths alike. */
function isInside(a, b) {
  if (!a || !b) return false;
  if (isWinPath(a) || isWinPath(b)) { const A = normWin(a), B = normWin(b); return A === B || A.startsWith(`${B}\\`); }
  const A = trimEnd(a), B = trimEnd(b);
  return A === B || A.startsWith(`${B}/`);
}

/**
 * On start, before the database opens: if a restore is waiting, keep the current database and thumbnails in
 * "before-restore/<date>", put the backup's in place, point the library's models at this install's library
 * folder, and keep this install's own folder settings.
 */
export function applyPendingRestore(dataDir) {
  const stage = path.join(dataDir, 'restore', 'next');
  const planFile = path.join(stage, 'plan.json');
  if (!fs.existsSync(planFile) || !fs.existsSync(path.join(stage, 'modelvault.db'))) return null;
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  const keep = path.join(dataDir, 'before-restore', new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-'));
  fs.mkdirSync(keep, { recursive: true });
  for (const f of ['modelvault.db', 'modelvault.db-wal', 'modelvault.db-shm', 'thumbs']) {
    const from = path.join(dataDir, f);
    if (fs.existsSync(from)) fs.renameSync(from, path.join(keep, f));
  }
  fs.renameSync(path.join(stage, 'modelvault.db'), path.join(dataDir, 'modelvault.db'));
  fs.renameSync(path.join(stage, 'thumbs'), path.join(dataDir, 'thumbs'));
  // Windows: the library folder becomes the old library (read from paths.json as ModelVault starts).
  if (plan.switchLibrary) {
    const file = path.join(dataDir, 'paths.json');
    let cur = {};
    try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); fs.copyFileSync(file, path.join(keep, 'paths.json')); } catch { /* none yet */ }
    fs.writeFileSync(file, JSON.stringify({ ...cur, library: plan.switchLibrary }, null, 2));
  }
  const db = new DatabaseSync(path.join(dataDir, 'modelvault.db'));
  let moved = 0, left = 0;
  try {
    const from = plan.fromLibrary, to = plan.toLibrary;
    const remap = (p) => {
      if (!from || !to || !isInside(p, from)) return null;
      const rest = splitRel(p.slice(trimEnd(from).length));
      return isWinPath(to) ? [trimEnd(to), ...rest].join('\\') : path.posix.join(to, ...rest);
    };
    db.exec('BEGIN');
    const upd = db.prepare('UPDATE models SET path = ? WHERE id = ?');
    for (const r of db.prepare('SELECT id, path FROM models').all()) {
      const n = remap(r.path);
      if (!n) { left++; continue; }
      if (n !== r.path) { try { upd.run(n, r.id); } catch { left++; continue; } }
      moved++;
    }
    try {
      const updO = db.prepare('UPDATE OR IGNORE optimized SET path = ? WHERE path = ?');
      for (const r of db.prepare('SELECT path FROM optimized').all()) { const n = remap(r.path); if (n && n !== r.path) updO.run(n, r.path); }
    } catch { /* older backup without picture records */ }
    const set = db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    const del = db.prepare('DELETE FROM settings WHERE key = ?');
    for (const [k, v] of Object.entries(plan.keepSettings || {})) (v == null ? del.run(k) : set.run(k, String(v)));
    try { del.run('pendingScan'); } catch { /* ignore */ }
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch { /* ignore */ } throw e; } finally { db.close(); }
  fs.rmSync(path.join(dataDir, 'restore'), { recursive: true, force: true });
  const result = { at: new Date().toISOString(), from: plan.from, version: plan.version, moved, left, library: plan.toLibrary, switched: !!plan.switchLibrary, keptIn: keep };
  fs.writeFileSync(path.join(dataDir, 'last-restore.json'), JSON.stringify(result, null, 2));
  return result;
}
