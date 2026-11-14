// Built-in picture optimizer: makes JPG, PNG and WebP pictures smaller with libvips, keeping their format and name.
// A picture is only replaced when the new file is clearly smaller. GIFs and videos are left alone.
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { walk } from './files.js';

const run = (cmd, args, timeout = 120000) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).trim().split('\n').pop())) : resolve(String(stdout))));
});

export const STRENGTHS = {
  balanced: { max: 2560, q: 85, label: 'Balanced' },
  smaller: { max: 1920, q: 78, label: 'Smaller' },
  lossless: { max: 0, q: 0, label: 'Lossless only' },
};
const EXT = /\.(jpe?g|png|webp)$/i;
const MIN_BYTES = 120 * 1024; // smaller pictures aren't worth it

export class ImageOptimizer {
  constructor(lib) {
    this.lib = lib;
    lib.db.exec('CREATE TABLE IF NOT EXISTS optimized (path TEXT PRIMARY KEY, size INTEGER NOT NULL, strength TEXT NOT NULL)');
    // The size each picture had before it was first optimized, so the space saved can be shown.
    try { lib.db.exec('ALTER TABLE optimized ADD COLUMN before INTEGER'); } catch { /* already there */ }
    lib.db.exec('CREATE TABLE IF NOT EXISTS optimize_runs (at INTEGER NOT NULL, total INTEGER NOT NULL, changed INTEGER NOT NULL, saved INTEGER NOT NULL, auto INTEGER NOT NULL DEFAULT 0)');
    this.tool = null;      // promise: true when vips is ready
    this.keepOpt = null;   // "keep=none" (vips 8.15+) or "strip"
    this.queue = Promise.resolve();
  }
  strength() { return STRENGTHS[this.lib.setting('optimizeStrength')] ? this.lib.setting('optimizeStrength') : 'balanced'; }

  /** vips is in the image from now on; containers built before get it installed once, here. */
  async ready() {
    if (!this.tool) {
      this.tool = (async () => {
        const have = async () => { try { await run('vips', ['--version'], 15000); return true; } catch { return false; } };
        if (!(await have()) && process.platform !== 'win32') { try { await run('apk', ['add', '--no-cache', 'vips-tools'], 300000); } catch { /* reported below */ } }
        if (!(await have())) throw new Error('The picture tool (libvips) could not be installed. Rebuild the container to add it.');
        const v = /(\d+)\.(\d+)/.exec(await run('vips', ['--version'], 15000));
        this.keepOpt = v && (Number(v[1]) > 8 || Number(v[2]) >= 15) ? 'keep=none' : 'strip';
        return true;
      })();
      this.tool.catch(() => { this.tool = null; });
    }
    return this.tool;
  }

  /** Optimize one picture in place. Returns { before, after } (after === before when it was left alone). */
  async optimizeFile(abs, strengthKey = this.strength()) {
    if (!EXT.test(abs)) return null;
    let st;
    try { st = await fsp.stat(abs); } catch { return null; }
    if (!st.isFile() || st.size < MIN_BYTES) return { before: st.size, after: st.size, skipped: 'small' };
    const done = this.lib.db.prepare('SELECT size, strength, before FROM optimized WHERE path = ?').get(abs);
    // Optimized before at another strength: the original size still counts. Replaced by another file: start over.
    const original = done && done.size === st.size && done.before ? done.before : st.size;
    if (done && done.size === st.size && done.strength === strengthKey) return { before: st.size, after: st.size, skipped: 'done' };
    await this.ready();
    const s = STRENGTHS[strengthKey] || STRENGTHS.balanced;
    const ext = path.extname(abs).toLowerCase();
    const tmp = path.join(path.dirname(abs), `.mv-opt-${crypto.randomUUID()}${ext}`);
    const keep = this.keepOpt;
    const opts = ext === '.png' ? `[compression=9,${keep}]`
      : ext === '.webp' ? (s.q ? `[Q=${s.q},${keep}]` : `[lossless,${keep}]`)
      : s.q ? `[Q=${s.q},optimize_coding,interlace,${keep}]` : `[Q=95,optimize_coding,${keep}]`;
    try {
      if (s.max) await run('vips', ['thumbnail', abs, `${tmp}${opts}`, String(s.max), '--height', String(s.max), '--size', 'down'], 180000);
      else await run('vips', ['copy', abs, `${tmp}${opts}`], 180000);
      const out = await fsp.stat(tmp);
      // Only worth it when clearly smaller; keep the original date so sorting by date doesn't change.
      if (out.size > 0 && out.size < st.size * 0.92) {
        await fsp.utimes(tmp, st.atime, st.mtime).catch(() => {});
        await fsp.rename(tmp, abs);
        this.lib.db.prepare('INSERT OR REPLACE INTO optimized(path, size, strength, before) VALUES (?, ?, ?, ?)').run(abs, out.size, strengthKey, original);
        return { before: st.size, after: out.size };
      }
      await fsp.rm(tmp, { force: true });
      this.lib.db.prepare('INSERT OR REPLACE INTO optimized(path, size, strength, before) VALUES (?, ?, ?, ?)').run(abs, st.size, strengthKey, original);
      return { before: st.size, after: st.size, skipped: 'no gain' };
    } catch (e) {
      await fsp.rm(tmp, { force: true });
      throw e;
    }
  }

  /** The pictures in a model folder (not in .trash or other hidden folders). */
  async picturesOf(m) {
    try { return (await walk(m.path)).filter((f) => EXT.test(f.rel) && !f.rel.split('/').some((seg) => seg.startsWith('.'))).map((f) => ({ abs: path.join(m.path, f.rel), size: f.size })); }
    catch { return []; }
  }

  /** In the background, one at a time: a model's pictures after import or after files were added. */
  later(modelId) {
    if (this.lib.setting('optimizeImages') !== 'true') return;
    this.queue = this.queue.then(async () => {
      try {
        const m = this.lib.model(modelId);
        let changed = 0, saved = 0, total = 0;
        for (const p of await this.picturesOf(m)) {
          const r = await this.optimizeFile(p.abs).catch(() => null);
          if (r) total++;
          if (r && r.after < r.before) { changed++; saved += r.before - r.after; }
        }
        if (changed) this.record({ total, changed, saved, auto: true });
        await this.lib.refreshStats(modelId);
      }
      catch { /* model removed meanwhile */ }
    });
  }

  record({ total, changed, saved, auto = false }) {
    this.lib.db.prepare('INSERT INTO optimize_runs(at, total, changed, saved, auto) VALUES (?, ?, ?, ?, ?)').run(Date.now(), total, changed, saved, auto ? 1 : 0);
  }

  /** Space saved so far: in total, by the last "Optimize all pictures now" run, and automatically since then. */
  stats() {
    const db = this.lib.db;
    const all = db.prepare('SELECT COUNT(*) AS pictures, COALESCE(SUM(before - size), 0) AS saved, COALESCE(SUM(before), 0) AS before FROM optimized WHERE before > size').get();
    const last = db.prepare('SELECT at, total, changed, saved FROM optimize_runs WHERE auto = 0 ORDER BY at DESC LIMIT 1').get() || null;
    const since = db.prepare('SELECT COALESCE(SUM(changed), 0) AS changed, COALESCE(SUM(saved), 0) AS saved FROM optimize_runs WHERE auto = 1 AND at > ?').get(last ? last.at : 0);
    return { pictures: Number(all.pictures), saved: Number(all.saved), before: Number(all.before), last, since: { changed: Number(since.changed), saved: Number(since.saved) } };
  }

  /** How many pictures could still be optimized, and how big they are. */
  async estimate() {
    const key = this.strength();
    const isDone = this.lib.db.prepare('SELECT size, strength FROM optimized WHERE path = ?');
    let count = 0, bytes = 0, models = 0;
    for (const { id } of this.lib.db.prepare('SELECT id FROM models').all()) {
      const pics = (await this.picturesOf(this.lib.model(id))).filter((p) => { if (p.size < MIN_BYTES) return false; const d = isDone.get(p.abs); return !(d && d.size === p.size && d.strength === key); });
      if (pics.length) models++;
      count += pics.length; bytes += pics.reduce((t, p) => t + p.size, 0);
    }
    // Also gets the picture tool ready, so a missing one shows up before anything starts.
    const tool = await this.ready().then(() => true, (e) => e.message);
    return { count, bytes, models, strength: key, tool };
  }

  /** Optimize every picture in the library (or the given models) as a background job. */
  start(ids = null) {
    const lib = this.lib;
    const job = { id: crypto.randomUUID(), type: 'optimize', label: 'Optimizing pictures', status: 'running', total: 0, done: 0, saved: 0, changed: 0, current: '', errors: [] };
    lib.jobs.set(job.id, job);
    (async () => {
      try {
        await this.ready();
        const list = ids || lib.db.prepare('SELECT id FROM models').all().map((r) => r.id);
        const work = [];
        for (const id of list) { try { const m = lib.model(id); for (const p of await this.picturesOf(m)) work.push({ ...p, id, name: m.name }); } catch { /* gone */ } }
        job.total = work.length;
        const touched = new Set();
        // Two at a time: quicker, without swamping the NAS.
        let next = 0;
        const worker = async () => {
          while (next < work.length) {
            const w = work[next++];
            job.current = w.name;
            try {
              const r = await this.optimizeFile(w.abs);
              if (r && r.after < r.before) { job.saved += r.before - r.after; job.changed++; touched.add(w.id); }
            } catch (e) { if (job.errors.length < 50) job.errors.push(`${path.basename(w.abs)}: ${e.message}`); }
            job.done++;
          }
        };
        await Promise.all([worker(), worker()]);
        for (const id of touched) await lib.refreshStats(id).catch(() => {});
        this.record(job);
        job.status = 'done';
      } catch (e) { job.status = 'error'; job.errors.push(e.message); }
      job.current = ''; job.finishedAt = Date.now();
    })();
    return job;
  }
}
