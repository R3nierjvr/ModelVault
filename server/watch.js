import path from 'node:path';
import crypto from 'node:crypto';
import { fsp, kindOf, ignored, isArchiveLike, httpError } from './files.js';

const TEMP = /\.(part|crdownload|tmp|temp|download|partial|td|!ut)$/i;

/** "Dragon_Body (1).zip", "Dragon part 2.rar", "Dragon.7z.003" → "dragon" style key for grouping. */
export function nameKey(name) {
  let n = name.toLowerCase();
  n = n.replace(/\.(part\d+\.rar|(7z|zip|rar)\.\d{3}|[zr]\d{2})$/, '').replace(/\.[a-z0-9]{1,6}$/, '');
  n = n.replace(/\s*\(\d+\)$/, '').replace(/[\s_.-]*(part|pt|vol|cd|disc)?[\s_.-]*\d{1,3}([\s_.-]*of[\s_.-]*\d{1,3})?$/, '');
  return n.replace(/[^a-z0-9]+/g, ' ').trim() || name.toLowerCase();
}

/** Polls watch folders (such as a download folder) and offers new files as grouped imports. */
export class Watcher {
  constructor(lib) { this.lib = lib; this.seen = new Map(); this.bursts = []; this.folderInfo = []; this.busy = false; }
  start() { this.timer = setInterval(() => this.tick().catch((e) => console.error('watch', e.message)), 10000); this.tick().catch(() => {}); }

  folders() {
    const out = [];
    for (const spec of String(this.lib.setting('watchFolders') || '').split(',').map((s) => s.trim()).filter(Boolean)) {
      const [root, ...rest] = spec.replace(/\\/g, '/').split('/').filter(Boolean);
      const base = this.lib.roots[String(root).toLowerCase()];
      const rel = rest.join('/');
      if (!base || rel.includes('..')) { out.push({ spec, error: `Unknown location "${root}"` }); continue; }
      out.push({ spec, root: root.toLowerCase(), rel, abs: path.join(base, rel) });
    }
    return out;
  }
  ignoredSet() { try { return new Set(JSON.parse(this.lib.setting('watchIgnored') || '[]')); } catch { return new Set(); } }

  async tick() {
    if (this.busy) return;
    const now = Date.now();
    const quiet = Math.max(5, Number(this.lib.setting('watchQuiet')) || 30) * 1000;
    const gap = Math.max(1, Number(this.lib.setting('watchGap')) || 5) * 60000;
    const skip = this.ignoredSet();
    const items = [], alive = new Set(), info = [];
    for (const f of this.folders()) {
      if (f.error) { info.push({ spec: f.spec, error: f.error }); continue; }
      let ents;
      try { ents = await fsp.readdir(f.abs, { withFileTypes: true }); } catch { info.push({ spec: f.spec, error: 'Folder not found' }); continue; }
      let n = 0;
      for (const e of ents) {
        if (!e.isFile() || ignored(e.name) || e.name.startsWith('.') || TEMP.test(e.name)) continue;
        const abs = path.join(f.abs, e.name);
        if (this.lib.ingesting?.has(abs)) continue; // already on its way into the library
        const st = await fsp.stat(abs).catch(() => null);
        if (!st) continue;
        alive.add(abs);
        const prev = this.seen.get(abs);
        const same = prev && prev.size === st.size && prev.mtime === st.mtimeMs;
        if (!same) this.seen.set(abs, { size: st.size, mtime: st.mtimeMs, since: now });
        const rel = f.rel ? `${f.rel}/${e.name}` : e.name;
        const id = `${f.root}:${rel}:${st.size}`;
        if (skip.has(id)) continue;
        const stable = !!same && now - st.mtimeMs >= quiet && st.size > 0;
        items.push({ id, root: f.root, rel, abs, name: e.name, size: st.size, mtime: st.mtimeMs, stable, kind: isArchiveLike(e.name) ? 'archive' : kindOf(e.name), key: nameKey(e.name), folder: f.spec });
        n++;
      }
      info.push({ spec: f.spec, files: n });
    }
    for (const k of this.seen.keys()) if (!alive.has(k)) this.seen.delete(k);
    items.sort((a, b) => a.mtime - b.mtime);
    const bursts = [];
    for (const it of items) {
      const last = bursts[bursts.length - 1];
      if (last && last.folder === it.folder && it.mtime - last.last <= gap) { last.files.push(it); last.last = it.mtime; }
      else bursts.push({ folder: it.folder, files: [it], last: it.mtime });
    }
    for (const b of bursts) {
      b.id = crypto.createHash('sha1').update(b.files.map((f) => f.id).join('|')).digest('hex').slice(0, 12);
      b.ready = b.files.every((f) => f.stable) && now - b.last >= Math.max(quiet, 90000);
      b.name = [...new Set(b.files.map((f) => f.key))].slice(0, 3).join(', ');
    }
    // Possible doubles: already added (same file), or a model with that name.
    const hits = this.lib.history.check(items.map((f) => ({ name: f.name, size: f.size, type: 'file' })));
    items.forEach((f, i) => { f.dup = hits[i]; });
    this.bursts = bursts.reverse();
    this.folderInfo = info;
    const auto = this.lib.setting('watchAuto');
    if (auto === 'together' || auto === 'separate') {
      for (const b of this.bursts.filter((x) => x.ready)) {
        // Files that were added before are held back: they stay in Imports, flagged, for you to delete or import anyway.
        const ids = b.files.filter((f) => f.dup?.level !== 'same').map((f) => f.id);
        b.held = b.files.length - ids.length;
        if (ids.length) await this.import(ids, auto === 'together' ? 'one' : 'separate').catch((e) => console.error('auto import', e.message));
      }
    }
  }

  public() {
    return { folders: this.folderInfo, auto: this.lib.setting('watchAuto'), bursts: this.bursts.map((b) => ({ ...b, files: b.files.map(({ abs: _a, ...f }) => f) })) };
  }

  /** Move watch-folder files to a .trash folder in their location. */
  async trash(ids) {
    const all = new Map(this.bursts.flatMap((b) => b.files).map((f) => [f.id, f]));
    const files = ids.map((i) => all.get(i)).filter(Boolean);
    for (const f of files) await this.lib.trashDownload(f.root, f.rel);
    await this.tick().catch(() => {});
    return { trashed: files.length };
  }

  /** mode 'one': every file becomes one model. 'separate': one model per name group (multi-part sets stay together). */
  async import(ids, mode = 'one') {
    const all = new Map(this.bursts.flatMap((b) => b.files).map((f) => [f.id, f]));
    const files = ids.map((i) => all.get(i)).filter(Boolean);
    if (!files.length) throw httpError(400, 'Those files are no longer in the watch folder');
    const copy = this.lib.setting('importMode') === 'copy';
    let sets;
    if (mode === 'one') sets = [files];
    else {
      const byKey = new Map();
      for (const f of files.filter((x) => x.kind === 'archive')) (byKey.get(f.key) || byKey.set(f.key, []).get(f.key)).push(f);
      const loose = files.filter((x) => x.kind !== 'archive');
      const archiveSets = [...byKey.values()];
      for (const f of loose) {
        // Photos and PDFs posted with a model join the archive downloaded closest in time.
        const near = byKey.get(f.key) || archiveSets.slice().sort((a, b) => Math.min(...a.map((x) => Math.abs(x.mtime - f.mtime))) - Math.min(...b.map((x) => Math.abs(x.mtime - f.mtime))))[0];
        if (near) near.push(f); else byKey.set(f.key, [f]);
      }
      sets = [...byKey.values()];
    }
    this.busy = true;
    const drafts = [];
    try {
      for (const set of sets) {
        const d = await this.lib.newDraft(set[0].root);
        this.lib.ingest(d, set.map((f) => f.abs), { copy });
        drafts.push(d.id);
      }
    } finally { this.busy = false; }
    if (copy) return this.ignore(files.map((f) => f.id)).then(() => ({ drafts })); // copied files stay put: don't offer them again
    await this.tick().catch(() => {});
    return { drafts };
  }

  async ignore(ids) {
    const set = this.ignoredSet();
    for (const i of ids) set.add(String(i));
    this.lib.db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('watchIgnored', JSON.stringify([...set].slice(-5000)));
    await this.tick().catch(() => {});
  }
}
