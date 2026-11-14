import path from 'node:path';
import crypto from 'node:crypto';
import {
  fsp, kindOf, isArchive, walk, summarize, rankCovers, safeName, niceName, exists, uniquePath, move, moveContents,
  extractArchive, flattenSingleFolder, extractNested, rmQuiet, httpError, ignored, within, volumeInfo, isArchiveLike, listArchive, extractEntryTo, extractImagesTo, sniffMedia, sameFile, resolveInside,
} from './files.js';
import { tx } from './db.js';
import { Translator, needsTranslation } from './translate.js';
import { guessDetails } from './guess.js';
import { ImageOptimizer } from './images.js';
import { History } from './dupes.js';

// Archive name parts: a label, and the words in an archive's name (or "only pictures inside") that mean it.
// Checked top to bottom; a matched word is used up, so "presupported" isn't also read as "supported".
export const DEFAULT_ARCHIVE_PARTS = [
  { label: 'Bust', words: 'bust' },
  { label: 'X-Pose', words: 'x-pose, xpose, x pose, alt pose, alternate pose, alt-pose' },
  { label: 'Presupported', words: 'presupported, pre-supported, pre supported, supported' },
  { label: 'Unsupported', words: 'unsupported, un-supported, no supports, no-supports, nosupports, without supports' },
  { label: 'Images', words: 'images, renders, pictures, pics, artwork, gallery, photos' },
  { label: 'Base', words: 'base, bases' },
  { label: 'Lychee', words: 'lychee, lys' },
  { label: 'NSFW', words: 'nsfw' },
];

/** The year most of these files were made (the middle date), or 0 when their dates can't be trusted. */
export function yearFromDates(files) {
  const now = Date.now();
  const stamps = files.map((f) => f.mtime || 0).filter((t) => t > Date.UTC(1995, 0, 1) && t < now + 86400000).sort((a, b) => a - b);
  if (!stamps.length) return 0;
  return new Date(stamps[Math.floor(stamps.length / 2)]).getFullYear();
}

export const DEFAULT_SETTINGS = {
  folderPattern: '{name}',
  updateCheck: 'true', // check GitHub for a newer ModelVault once a day
  updateAuto: 'false', // and install it by itself
  tourDone: 'false', // the first-time tour has been finished or skipped
  tailscaleAddress: '', // Settings > Tailscale: the address a tablet or phone opens
  extractArchives: 'false',
  importMode: 'move',
  keepArchive: 'true',
  extractNested: 'true',
  autoThumbs: 'true',
  autoOrganize: 'true',
  adoptOnSave: 'true',
  translateNames: 'true',
  optimizeImages: 'true',       // shrink new pictures automatically (JPG, PNG, WebP; same format and name)
  optimizeStrength: 'balanced', // balanced | smaller | lossless
  displayFormat: '{name}', // how model names are shown in the library; the saved names don't change
  archiveAuto: 'true',
  archiveFormat: '{name} - {part} - {scale}',
  archiveParts: JSON.stringify(DEFAULT_ARCHIVE_PARTS),
  slicer: 'orcaslicer',
  slicers: 'orcaslicer,lychee,chitubox',
  pcPaths: '{}',
  watchFolders: '',
  watchAuto: 'off',
  watchQuiet: '30',
  watchGap: '5',
};

const ALIASES = { modelname: 'name', model: 'name', title: 'name', modeler: 'designer', modeller: 'designer', creator: 'designer', author: 'designer', artist: 'designer', modelerdesigner: 'designer', designermodeler: 'designer', category: 'type' };
export const tokenKey = (s) => { const k = String(s).toLowerCase().replace(/[^a-z0-9]+/g, ''); return ALIASES[k] || k; };
const SEP = '[\\s\\-–—_,|]*';
/** "{type}/{name} - {year} - {designer}" (or <<name>> style) → folder segments. Empty details drop out with their separator. */
export function renderTemplate(tpl, tokens) {
  const keys = [];
  // Pull the tokens out first so a "/" inside one (<<Modeler/designer>>) isn't read as a sub-folder.
  const norm = String(tpl || '{name}').replace(/<<\s*([^<>]+?)\s*>>/g, '{$1}').replace(/\{([^{}]+)\}/g, (_, k) => `\u0002${keys.push(k) - 1}\u0003`);
  const segs = norm.split('/').map((x) => x.trim()).filter(Boolean);
  const out = (segs.length ? segs : ['\u00020\u0003']).map((seg) => seg
    .replace(/\u0002(\d+)\u0003/g, (_, i) => { const v = tokens[tokenKey(keys[i] ?? 'name')]; return v ? String(v).replace(/[\\/]/g, ' ') : '\u0000'; })
    .replace(new RegExp(`${SEP}\u0000`, 'g'), '\u0001').replace(new RegExp(`^(\u0001${SEP})+`), '').replace(/\u0001/g, '')
    .replace(/\(\s*\)|\[\s*\]/g, '').trim());
  return out.map((x, i) => safeName(x, i === out.length - 1 ? tokens.name || 'Untitled' : 'Unsorted'));
}

export class Library {
  constructor(db, { dataDir, roots }) {
    this.db = db;
    this.dataDir = dataDir;
    this.roots = roots; // { library: '/library', downloads: '/downloads', ... }
    // Staging lives on the library volume so finishing an import is a fast rename, not a copy across Docker mounts.
    this.stagingDir = path.join(roots.library, '.modelvault-staging');
    this.thumbDir = path.join(dataDir, 'thumbs');
    this.defaults = { ...DEFAULT_SETTINGS, watchFolders: roots.watch ? 'watch' : roots.telegram ? 'telegram' : '' };
    this.drafts = new Map();
    this.translator = new Translator(db);
    this.jobs = new Map();
    this.moveErrors = new Map(); // model id → why its last move failed
    this.images = new ImageOptimizer(this);
    this.history = new History(this);
    // Remember the archives already in the library (once per model), shortly after starting and every few hours.
    const seed = () => this.history.seedMissing().catch((e) => console.warn('Download history:', e.message));
    setTimeout(seed, 20000).unref?.();
    setInterval(seed, 6 * 3600 * 1000).unref?.();
  }

  async init() {
    await fsp.mkdir(this.stagingDir, { recursive: true });
    await fsp.mkdir(this.thumbDir, { recursive: true });
    // Restore drafts that were waiting when the container last stopped.
    for (const id of await fsp.readdir(this.stagingDir)) {
      if (id.startsWith('.add-')) { await rmQuiet(path.join(this.stagingDir, id)); continue; }
      try {
        const d = JSON.parse(await fsp.readFile(path.join(this.stagingDir, id, 'draft.json'), 'utf8'));
        if (d.status === 'processing') d.status = 'error', d.error = 'Interrupted by a restart — cancel and import again.';
        this.drafts.set(id, d);
      } catch { await rmQuiet(path.join(this.stagingDir, id)); }
    }
  }

  // ---------- settings ----------
  settings() {
    const out = { ...this.defaults };
    for (const r of this.db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
    delete out.seeded; delete out.watchIgnored;
    out.libraryDir = this.roots.library;
    return out;
  }
  setting(k) { return this.settings()[k]; }
  saveSettings(obj) {
    const up = this.db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in obj) up.run(k, String(obj[k]));
    return this.settings();
  }

  // ---------- categories ----------
  groups() {
    const groups = this.db.prepare('SELECT id, name, builtin FROM groups ORDER BY sort, name').all();
    const vals = this.db.prepare(`SELECT v.id, v.group_id, v.name, COUNT(mv.model_id) AS count
      FROM group_values v LEFT JOIN model_values mv ON mv.value_id = v.id GROUP BY v.id ORDER BY v.name`).all();
    return groups.map((g) => ({ ...g, builtin: !!g.builtin, values: vals.filter((v) => v.group_id === g.id).map(({ id, name, count }) => ({ id, name, count })) }));
  }
  ensureGroup(name) {
    name = String(name).trim();
    if (!name) throw httpError(400, 'Category name is required');
    this.db.prepare('INSERT OR IGNORE INTO groups(name) VALUES (?)').run(name);
    return this.db.prepare('SELECT id FROM groups WHERE name = ?').get(name).id;
  }
  ensureValue(groupId, name) {
    name = String(name).trim();
    if (!name) throw httpError(400, 'Value is required');
    this.db.prepare('INSERT OR IGNORE INTO group_values(group_id, name) VALUES (?, ?)').run(groupId, name);
    return this.db.prepare('SELECT id FROM group_values WHERE group_id = ? AND name = ?').get(groupId, name).id;
  }
  groupIdByName(name) { return this.db.prepare('SELECT id FROM groups WHERE name = ?').get(name)?.id; }

  // ---------- models ----------
  listModels() {
    const rows = this.db.prepare(`SELECT m.id, m.name, m.designer, m.cover, m.thumb, m.favorite, m.no_ams, m.file_count, m.size, m.kinds, m.year, m.source_url, m.path,
        m.created_at, m.updated_at, m.source,
        (SELECT group_concat(value_id) FROM model_values WHERE model_id = m.id) AS vals,
        (SELECT group_concat(t.name, char(31)) FROM model_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.model_id = m.id) AS tags
      FROM models m ORDER BY m.created_at DESC, m.id DESC`).all();
    return rows.map((r) => this.#shape(r));
  }
  #shape(r) {
    return {
      ...r,
      favorite: !!r.favorite,
      noAms: !!r.no_ams, // multi-colour, but no AMS (or other filament changer) needed
      vals: r.vals ? String(r.vals).split(',').map(Number) : [],
      tags: r.tags ? String(r.tags).split('\x1f') : [],
      kinds: r.kinds ? r.kinds.split(',').filter(Boolean) : [],
      coverUrl: r.cover ? `/files/${r.id}/${encodePath(r.cover)}?v=${encodeURIComponent(r.updated_at)}` : null,
      coverKind: r.cover ? kindOf(r.cover) : null,
      folder: this.displayPath(path.dirname(r.path)).replace(/^library\/?/, ''),
      inLibrary: within(this.roots.library, r.path),
      thumbUrl: r.thumb ? `/thumbs/${r.thumb}?v=${encodeURIComponent(r.updated_at)}` : null,
    };
  }
  model(id) {
    const r = this.db.prepare(`SELECT m.*,
        (SELECT group_concat(value_id) FROM model_values WHERE model_id = m.id) AS vals,
        (SELECT group_concat(t.name, char(31)) FROM model_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.model_id = m.id) AS tags
      FROM models m WHERE m.id = ?`).get(Number(id));
    if (!r) throw httpError(404, 'Model not found');
    const m = this.#shape(r);
    m.managed = !!m.managed;
    return m;
  }
  async modelWithFiles(id) {
    const m = this.model(id);
    m.missing = !(await exists(m.path));
    m.files = m.missing ? [] : await walk(m.path);
    m.displayPath = this.displayPath(m.path);
    return m;
  }
  displayPath(abs) {
    for (const [k, r] of Object.entries(this.roots)) if (within(r, abs)) return `${k}/${path.relative(r, abs).split(path.sep).join('/')}`.replace(/\/$/, '');
    return abs;
  }
  setValues(modelId, valueIds) {
    this.db.prepare('DELETE FROM model_values WHERE model_id = ?').run(modelId);
    const ins = this.db.prepare('INSERT OR IGNORE INTO model_values(model_id, value_id) VALUES (?, ?)');
    for (const v of new Set(valueIds || [])) if (Number(v)) ins.run(modelId, Number(v));
  }
  addValues(modelId, valueIds) {
    const ins = this.db.prepare('INSERT OR IGNORE INTO model_values(model_id, value_id) VALUES (?, ?)');
    for (const v of valueIds) ins.run(modelId, v);
  }
  setTags(modelId, names, { replace = true } = {}) {
    if (replace) this.db.prepare('DELETE FROM model_tags WHERE model_id = ?').run(modelId);
    const insT = this.db.prepare('INSERT OR IGNORE INTO tags(name) VALUES (?)');
    const getT = this.db.prepare('SELECT id FROM tags WHERE name = ?');
    const link = this.db.prepare('INSERT OR IGNORE INTO model_tags(model_id, tag_id) VALUES (?, ?)');
    for (const raw of names || []) {
      const n = String(raw).trim().slice(0, 80);
      if (!n) continue;
      insT.run(n);
      link.run(modelId, getT.get(n).id);
    }
    this.db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM model_tags)').run();
  }
  designers() {
    return this.db.prepare(`SELECT designer AS name, COUNT(*) AS count FROM models WHERE designer <> '' GROUP BY designer COLLATE NOCASE ORDER BY designer COLLATE NOCASE`).all();
  }
  tags() {
    return this.db.prepare('SELECT t.name, COUNT(*) AS count FROM tags t JOIN model_tags mt ON mt.tag_id = t.id GROUP BY t.id ORDER BY t.name').all();
  }

  /** File count, size and file types. For models kept zipped, the types come from inside the archive. */
  async statsFor(dir) {
    const files = await walk(dir);
    const s = summarize(files);
    if (files.some((f) => f.kind === 'model')) return s;
    const kinds = new Set(s.kinds.split(',').filter(Boolean));
    const primaries = files.filter((f) => { const n = path.basename(f.rel); const v = volumeInfo(n); return v ? v.first : isArchive(n); }).slice(0, 10);
    for (const f of primaries) {
      try {
        for (const e of await listArchive(path.join(dir, f.rel))) {
          if (!['model', 'sliced', 'pdf'].includes(kindOf(e.path))) continue;
          const ext = path.extname(e.path).toLowerCase().slice(1);
          kinds.add(ext === 'stp' ? 'step' : ext);
        }
      } catch { /* unreadable archive: keep what we know */ }
    }
    s.kinds = kinds.size ? `,${[...kinds].sort().join(',')},` : '';
    return s;
  }

  async refreshStats(id) {
    const m = this.model(id);
    if (!(await exists(m.path))) return m;
    const s = await this.statsFor(m.path);
    this.db.prepare(`UPDATE models SET file_count = ?, size = ?, kinds = ?, updated_at = datetime('now') WHERE id = ?`).run(s.file_count, s.size, s.kinds, id);
    return this.model(id);
  }

  async updateModel(id, body, opts = {}) {
    const m = this.model(id);
    const sets = [], args = [];
    if (typeof body.designer === 'string') { sets.push('designer = ?'); args.push(body.designer.trim().slice(0, 120)); }
    if (typeof body.notes === 'string') { sets.push('notes = ?'); args.push(body.notes.slice(0, 20000)); }
    if (typeof body.source_url === 'string') { sets.push('source_url = ?'); args.push(body.source_url.trim().slice(0, 1000)); }
    if (typeof body.favorite === 'boolean') { sets.push('favorite = ?'); args.push(body.favorite ? 1 : 0); }
    if (typeof body.noAms === 'boolean') { sets.push('no_ams = ?'); args.push(body.noAms ? 1 : 0); }
    if ('year' in body) { const y = Math.round(Number(body.year)); sets.push('year = ?'); args.push(y >= 1900 && y <= 2200 ? y : null); }
    let newName = null;
    if (typeof body.name === 'string' && body.name.trim() && body.name.trim() !== m.name) {
      newName = body.name.trim().slice(0, 200);
      sets.push('name = ?'); args.push(newName);
    }
    tx(this.db, () => {
      if (sets.length) this.db.prepare(`UPDATE models SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...args, id);
      else this.db.prepare(`UPDATE models SET updated_at = datetime('now') WHERE id = ?`).run(id);
      if (Array.isArray(body.values)) this.setValues(id, body.values);
      if (Array.isArray(body.tags)) this.setTags(id, body.tags);
      if (Array.isArray(body.addValues)) this.addValues(id, body.addValues.map(Number).filter(Boolean));
      if (Array.isArray(body.addTags)) this.setTags(id, body.addTags, { replace: false });
    });
    // Keep the cover file named Cover-{Model Name}.
    if (newName && m.cover && /^cover-/i.test(path.basename(m.cover))) {
      const from = path.join(m.path, m.cover);
      if (await exists(from)) {
        const to = await uniquePath(path.join(path.dirname(from), `Cover-${safeName(newName)}${path.extname(m.cover)}`));
        await move(from, to);
        this.db.prepare('UPDATE models SET cover = ? WHERE id = ?').run(path.relative(m.path, to).split(path.sep).join('/'), id);
      }
    }
    // Saving a model puts its folder in order straight away: renamed and moved to the folder name format,
    // picture folders renamed to img, leftover "Previous cover" files cleared. Only for models inside the library.
    let organized = null;
    const affectsFolder = body.organize === true || ['name', 'designer', 'year', 'values', 'addValues'].some((k) => k in body);
    if (this.setting('autoOrganize') === 'true' && affectsFolder && !opts.skipOrganize) {
      const now = this.model(id);
      const adopt = this.setting('adoptOnSave') === 'true' && this.isOutside(now) && !now.stay;
      if (adopt) {
        // Coming in from another location can take a while (copying), so it runs in the background with progress.
        organized = { queued: true };
        if (!opts.deferAdopt) organized.job = this.startOrganize(undefined, { ids: [id], adopt: true, label: `Moving ${this.model(id).name} into the library` }).id;
      } else {
        try { organized = await this.organize(id, undefined, { pictures: true }); }
        catch (e) { organized = { error: e.message }; }
      }
    }
    // Archives follow the name format on every save (their names include the model's name).
    if (!organized?.queued && !opts.skipOrganize) {
      // Choices from "Name archives" that came along with Save are applied even when automatic naming is off.
      let named = 0;
      if (body.archives && typeof body.archives === 'object' && !this.isOutside(this.model(id))) {
        try { named = await this.nameArchives(id, body.archives); } catch (e) { organized = { ...(organized || {}), error: `archives: ${e.message}` }; }
      } else named = await this.autoNameArchives(id);
      if (named) { organized = { ...(organized || {}), archivesNamed: named }; await this.refreshStats(id); }
    }
    return { ...this.model(id), organized };
  }

  /** The Windows path of a file in a model, using "Folder paths on your PC" (Settings) or a network folder's own path. */
  pcPathFor(abs, extra = {}) {
    let map = {};
    try { map = JSON.parse(this.setting('pcPaths') || '{}'); } catch { map = {}; }
    map = { ...map, ...extra };
    const hits = Object.entries(this.roots).filter(([k, r]) => map[k] && String(map[k]).trim() && within(r, abs)).sort((a, b) => b[1].length - a[1].length);
    if (!hits.length) return null;
    const [k, r] = hits[0];
    const base = String(map[k]).trim().replace(/[\\/]+$/, '');
    const rel = path.relative(r, abs).split(path.sep).filter(Boolean).join('\\');
    return rel ? `${base}\\${rel}` : base;
  }

  // ---------- organizer ----------
  tokensFor({ name, designer, year, values }) {
    const t = { name, designer: designer || '', year: year ? String(year) : '' };
    const ids = (values || []).map(Number).filter(Boolean);
    if (ids.length) {
      const rows = this.db.prepare(`SELECT g.name AS g, v.name AS v FROM group_values v JOIN groups g ON g.id = v.group_id
        WHERE v.id IN (${ids.map(() => '?').join(',')}) ORDER BY v.name`).all(...ids);
      for (const r of rows) { const k = tokenKey(r.g); if (!t[k]) t[k] = r.v; }
    }
    return t;
  }
  targetFolder(model, template = this.setting('folderPattern')) {
    return path.join(this.roots.library, ...renderTemplate(template, this.tokensFor(model)));
  }
  /** Where a model's folder should be; null when it should stay put. */
  async organizeTarget(m, template, { adopt = false } = {}) {
    const lib = this.roots.library;
    if (m.path === lib) return null;
    const outside = !within(lib, m.path);
    if (outside && !adopt) return null; // indexed in place elsewhere and not asked to bring it in
    const target = this.targetFolder({ name: m.name, designer: m.designer, year: m.year, values: m.vals }, template);
    if (target === m.path || within(m.path, target)) return null;
    // Already the numbered twin of a taken name, e.g. "Dragon (2)".
    if (!outside && path.dirname(target) === path.dirname(m.path) && path.basename(m.path).replace(/ \(\d+\)$/, '') === path.basename(target) && (await exists(target))) return null;
    return target;
  }
  isOutside(m) { return !within(this.roots.library, m.path); }

  /** Where a path lives as a Windows/SMB path (\\server\share\…), from Folder paths on your PC and network folders. */
  uncOf(abs) { return this.pcPathFor(abs, this.netPaths?.() || {}); }
  /** If both paths sit inside one connected network folder, the same move can be a rename on the NAS itself. */
  bridgeFor(src, dest) {
    const net = this.netPaths?.() || {};
    const us = this.pcPathFor(src, net), ud = this.pcPathFor(dest, net);
    if (!us || !ud) return null;
    const norm = (p) => p.replace(/\//g, '\\').toLowerCase();
    for (const [key, unc] of Object.entries(net)) {
      const base = norm(unc).replace(/\\+$/, '');
      if (!this.roots[key] || !norm(us).startsWith(`${base}\\`) || !norm(ud).startsWith(`${base}\\`)) continue;
      const local = (u) => path.join(this.roots[key], ...u.slice(base.length + 1).split('\\').filter(Boolean));
      return { src: local(us), dest: local(ud), via: key };
    }
    return null;
  }
  /** Move a model folder: rename when possible (instant), through a shared network folder, or copy as a last resort. */
  async moveFolder(src, dest) {
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    try { await fsp.rename(src, dest); return 'renamed'; } catch (e) { if (e.code !== 'EXDEV') throw e; }
    const b = this.bridgeFor(src, dest);
    if (b && (await exists(b.src))) {
      await fsp.mkdir(path.dirname(b.dest), { recursive: true });
      await fsp.rename(b.src, b.dest);
      for (let i = 0; i < 10 && !(await exists(dest)); i++) await new Promise((r) => setTimeout(r, 300)); // let the other connection catch up
      return 'renamed';
    }
    await move(src, dest);
    return 'copied';
  }
  async organize(id, template, { pictures = false, adopt = false, allowInside = false } = {}) {
    const m = this.model(id);
    let moved = false, reason, how;
    const target = await this.organizeTarget(m, template, { adopt });
    if (target && (await exists(m.path))) {
      const others = this.db.prepare('SELECT path FROM models WHERE id <> ?').all(m.id);
      // Moving a folder that holds another model would carry that model along; one sitting inside another needs a decision too.
      // allowInside: the person chose to split it out of the folder around it.
      if (others.some((o) => within(m.path, o.path) || (!allowInside && within(o.path, m.path)))) reason = 'Contains or sits inside another model';
      else {
        const dest = await uniquePath(target);
        const from = path.dirname(m.path);
        how = await this.moveFolder(m.path, dest);
        this.db.prepare(`UPDATE models SET path = ?, managed = 1, updated_at = datetime('now') WHERE id = ?`).run(dest, id);
        // Tidy empty folders it left behind, in the library or wherever it came from.
        const home = Object.values(this.roots).filter((r) => within(r, from)).sort((a, b) => b.length - a.length)[0];
        if (home) await this.pruneEmpty(from, home);
        moved = true;
      }
    }
    const tidied = pictures ? await this.tidyPictures(id) : 0;
    return { moved, reason, tidied, how };
  }
  async pruneEmpty(dir, stopAt = this.roots.library) {
    const lib = stopAt, junk = new Set(['.ds_store', 'thumbs.db', 'desktop.ini', '@eadir']);
    while (dir !== lib && within(lib, dir) && !path.basename(dir).startsWith('.')) {
      const ents = await fsp.readdir(dir).catch(() => null);
      if (!ents || ents.some((e) => !junk.has(e.toLowerCase()))) return;
      for (const e of ents) await rmQuiet(path.join(dir, e));
      try { await fsp.rmdir(dir); } catch { return; }
      dir = path.dirname(dir);
    }
  }
  async organizePlan(template, { pictures = false, adopt = false } = {}) {
    const rel = (p) => path.relative(this.roots.library, p).split(path.sep).join('/');
    const changes = [];
    let inLibrary = 0, pictureModels = 0, outside = 0, outsideBytes = 0, archiveModels = 0, archiveFiles = 0;
    const naming = pictures && this.setting('archiveAuto') === 'true';
    for (const row of this.db.prepare('SELECT id FROM models ORDER BY name').all()) {
      const m = this.model(row.id);
      if (!within(this.roots.library, m.path)) {
        if (adopt && !m.stay) { outside++; outsideBytes += m.size || 0; }
        continue;
      }
      inLibrary++;
      const target = await this.organizeTarget(m, template);
      if (target) changes.push({ id: m.id, name: m.name, from: rel(m.path), to: rel(target) });
      if (pictures) { const pc = await this.pictureChanges(m.path); if (pc.folders.length || pc.strays.length) pictureModels++; }
      if (naming && !m.stay) {
        // Archives whose names don't follow the archive name format yet (read from their names only, to stay quick).
        const plan = await this.archivePlan(m.id, { quick: true }).catch(() => ({ items: [] }));
        const off = plan.items.filter((it) => !it.keep && it.newName !== it.current).length;
        if (off) { archiveModels++; archiveFiles += off; }
      }
    }
    const sample = await this.bridgeSample();
    return { inLibrary, count: changes.length, pictureModels, archiveModels, archiveFiles, outside, outsideBytes, fastMove: outside ? sample : null, changes: changes.slice(0, 300) };
  }
  /** Can models outside the library be moved in as a quick rename? (true / false) */
  async bridgeSample() {
    const row = this.db.prepare('SELECT id FROM models').all().map((r) => this.model(r.id)).find((m) => this.isOutside(m));
    if (!row) return null;
    return !!this.bridgeFor(row.path, path.join(this.roots.library, '__probe__'));
  }
  startOrganize(template, { ids = null, adopt = this.setting('adoptOnSave') === 'true', label } = {}) {
    const job = { id: crypto.randomUUID(), type: 'organize', label: label || 'Organizing folders', status: 'running', total: 0, done: 0, moved: 0, tidied: 0, adopted: 0, copied: 0, stuck: 0, current: '', errors: [] };
    this.jobs.set(job.id, job);
    // Asking for particular models by name overrides an earlier "leave it where it is".
    if (ids?.length) this.db.prepare(`UPDATE models SET stay = 0 WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
    (async () => {
      try {
        const list = ids || this.db.prepare('SELECT id FROM models WHERE stay = 0').all().map((r) => r.id);
        job.total = list.length;
        for (const id of list) {
          let name = String(id);
          try {
            const m = this.model(id);
            name = job.current = m.name;
            const outside = this.isOutside(m);
            const r = await this.organize(id, template, { pictures: true, adopt });
            if (r.moved) { job.moved++; if (outside) job.adopted++; if (r.how === 'copied') job.copied++; }
            if (r.tidied) job.tidied++;
            if (r.reason) { job.errors.push(`${m.name}: ${r.reason}`); job.stuck++; }
            else if (await this.autoNameArchives(id)) job.archives = (job.archives || 0) + 1;
            this.moveErrors.delete(id);
          } catch (e) {
            if (e.status === 404) continue; // removed meanwhile
            job.errors.push(`${name}: ${e.message}`); job.stuck++;
            this.moveErrors.set(id, e.message);
          } finally { job.done++; }
        }
        job.status = 'done';
      } catch (e) { job.status = 'error'; job.errors.push(e.message); }
      job.current = ''; job.finishedAt = Date.now();
    })();
    return job;
  }

  // ---------- models the organizer couldn't move by itself ----------
  /**
   * Folders that hold other models (for example a "Renders" folder imported as its own model, or supported and
   * unsupported versions imported separately), plus moves that failed. Each needs the person to choose what happens.
   */
  async stuckModels({ includeStay = false } = {}) {
    const all = this.db.prepare('SELECT id FROM models').all().map((r) => this.model(r.id));
    const tpl = this.setting('folderPattern');
    const adoptOn = this.setting('adoptOnSave') === 'true';
    // Nearest model folder around each model.
    const parent = new Map();
    for (const m of all) {
      let best = null;
      for (const o of all) if (o.id !== m.id && within(o.path, m.path) && (!best || o.path.length > best.path.length)) best = o;
      if (best) parent.set(m.id, best);
    }
    const rootOf = (m) => { let r = m; while (parent.has(r.id)) r = parent.get(r.id); return r; };
    const families = new Map();
    for (const m of all) {
      if (!parent.has(m.id)) continue;
      const r = rootOf(m);
      if (!families.has(r.id)) families.set(r.id, { root: r, members: [] });
      families.get(r.id).members.push(m);
    }
    const where = (m) => this.displayPath(m.path);
    const card = (m, base) => ({ id: m.id, name: m.name, size: m.size, files: m.file_count, kinds: m.kinds, folder: base ? path.relative(base, m.path).split(path.sep).join('/') : where(m),
      pictures: m.kinds.length > 0 && m.kinds.every((k) => k === 'image' || k === 'video') });
    const wantsMove = async (m) => (this.isOutside(m) ? adoptOn : !!(await this.organizeTarget(m, tpl)));
    const out = { families: [], errors: [], staying: 0 };
    for (const { root, members } of families.values()) {
      const stay = [root, ...members].some((m) => m.stay);
      if (stay && !includeStay) { out.staying += 1 + members.length; continue; }
      let wants = false;
      for (const m of [root, ...members]) if (await wantsMove(m)) { wants = true; break; }
      if (!wants && !stay) continue;
      members.sort((a, b) => a.path.localeCompare(b.path));
      out.families.push({ ...card(root), where: where(root), outside: this.isOutside(root), stay,
        size: root.size, members: members.map((c) => card(c, root.path)) });
    }
    const inFamily = new Set([...families.values()].flatMap((f) => [f.root.id, ...f.members.map((m) => m.id)]));
    for (const [id, error] of this.moveErrors) {
      if (inFamily.has(id)) continue;
      let m; try { m = this.model(id); } catch { this.moveErrors.delete(id); continue; }
      if (m.stay && !includeStay) { out.staying++; continue; }
      out.errors.push({ ...card(m), where: where(m), error, stay: !!m.stay });
    }
    out.families.sort((a, b) => a.name.localeCompare(b.name));
    out.count = out.families.reduce((n, f) => n + 1 + f.members.length, 0) + out.errors.length;
    return out;
  }

  /** Fold models that sit inside `rootId`'s folder into it: one model, all their files, categories and tags kept. */
  async mergeInto(rootId, childIds) {
    const root = this.model(rootId);
    for (const cid of childIds) {
      const c = this.model(cid), now = this.model(rootId);
      if (c.id === rootId || !within(root.path, c.path)) continue;
      this.addValues(rootId, c.vals);
      this.setTags(rootId, c.tags, { replace: false });
      const set = [];
      if (!now.cover && c.cover) set.push(['cover', path.relative(root.path, path.join(c.path, c.cover)).split(path.sep).join('/')]);
      if (!now.designer && c.designer) set.push(['designer', c.designer]);
      if (!now.source_url && c.source_url) set.push(['source_url', c.source_url]);
      if (!now.year && c.year) set.push(['year', c.year]);
      if (c.favorite) set.push(['favorite', 1]);
      if (c.noAms) set.push(['no_ams', 1]);
      for (const [k, v] of set) this.db.prepare(`UPDATE models SET ${k} = ? WHERE id = ?`).run(v, rootId);
      if (!now.thumb && c.thumb) {
        // Keep the 3D preview picture of the folded-in model.
        const name = `${rootId}.png`;
        try { await fsp.rename(path.join(this.thumbDir, c.thumb), path.join(this.thumbDir, name)); this.db.prepare('UPDATE models SET thumb = ? WHERE id = ?').run(name, rootId); this.db.prepare('UPDATE models SET thumb = NULL WHERE id = ?').run(cid); } catch { /* no preview to keep */ }
      }
      this.moveErrors.delete(cid);
      await this.deleteModel(cid); // the entry only: its files stay where they are, inside the merged model
    }
    await this.refreshStats(rootId);
  }

  /**
   * Carry out the choices from the "couldn't be moved" window, as a background job.
   * families: [{ id: rootId, action: 'merge' | 'split' | 'stay' }], errors: [{ id, action: 'retry' | 'stay' }]
   */
  resolveStuck({ families = [], errors = [] } = {}) {
    const n = families.length + errors.length;
    const job = { id: crypto.randomUUID(), type: 'organize', label: `Sorting out ${n} model${n === 1 ? '' : 's'}`, status: 'running', total: 0, done: 0, moved: 0, tidied: 0, adopted: 0, copied: 0, merged: 0, stuck: 0, current: '', errors: [] };
    this.jobs.set(job.id, job);
    const tpl = this.setting('folderPattern');
    const stay = this.db.prepare('UPDATE models SET stay = ? WHERE id = ?');
    const step = async (id, opts) => {
      const m = this.model(id), outside = this.isOutside(m);
      job.current = m.name;
      try {
        const r = await this.organize(id, tpl, { pictures: true, adopt: true, ...opts });
        if (r.moved) { job.moved++; if (outside) job.adopted++; if (r.how === 'copied') job.copied++; }
        if (r.tidied) job.tidied++;
        if (r.reason) { job.errors.push(`${m.name}: ${r.reason}`); job.stuck++; }
        this.moveErrors.delete(id);
      } catch (e) { job.errors.push(`${m.name}: ${e.message}`); job.stuck++; this.moveErrors.set(id, e.message); }
    };
    (async () => {
      try {
        const all = this.db.prepare('SELECT id, path FROM models').all();
        const plan = families.map((f) => {
          const root = all.find((r) => r.id === Number(f.id));
          const members = root ? all.filter((r) => r.id !== root.id && within(root.path, r.path)).sort((a, b) => b.path.length - a.path.length) : [];
          return { ...f, root, members };
        }).filter((f) => f.root);
        job.total = plan.reduce((t, f) => t + (f.action === 'split' ? 1 + f.members.length : 1), 0) + errors.length;
        for (const f of plan) {
          const ids = [f.root.id, ...f.members.map((r) => r.id)];
          try {
            if (f.action === 'stay') { for (const id of ids) stay.run(1, id); job.done++; continue; }
            for (const id of ids) stay.run(0, id);
            if (f.action === 'merge') {
              job.current = this.model(f.root.id).name;
              await this.mergeInto(f.root.id, f.members.map((r) => r.id));
              job.merged += f.members.length;
            } else {
              // Deepest first, so each one leaves the folder around it before that folder moves.
              for (const r of f.members) { await step(r.id, { allowInside: true }); job.done++; }
            }
            await step(f.root.id);
          } catch (e) { job.errors.push(`${f.root.path}: ${e.message}`); job.stuck++; }
          job.done++;
        }
        for (const x of errors) {
          const id = Number(x.id);
          try {
            if (x.action === 'stay') stay.run(1, id);
            else { stay.run(0, id); await step(id); }
          } catch (e) { job.errors.push(`${id}: ${e.message}`); }
          job.done++;
        }
        job.status = 'done';
      } catch (e) { job.status = 'error'; job.errors.push(e.message); }
      job.current = ''; job.finishedAt = Date.now();
    })();
    return job;
  }
  async bulk(ids, body) {
    let n = 0;
    const later = [];
    for (const id of ids.map(Number).filter(Boolean)) {
      if (body.remove) await this.deleteModel(id);
      else {
        const patch = {};
        if (typeof body.designer === 'string' && body.designer.trim()) patch.designer = body.designer;
        if (body.year) patch.year = body.year;
        if (Array.isArray(body.addTags) && body.addTags.length) patch.addTags = body.addTags;
        if (Array.isArray(body.addValues) && body.addValues.length) patch.addValues = body.addValues;
        if (typeof body.favorite === 'boolean') patch.favorite = body.favorite;
        if (typeof body.noAms === 'boolean') patch.noAms = body.noAms;
        const r = await this.updateModel(id, patch, { deferAdopt: true });
        if (r.organized?.queued) later.push(id);
      }
      n++;
    }
    const job = later.length ? this.startOrganize(undefined, { ids: later, adopt: true, label: `Moving ${later.length} model${later.length === 1 ? '' : 's'} into the library` }) : null;
    return { count: n, job: job?.id || null };
  }

  /** Make `rel` (inside the model folder) the cover, renamed to Cover-{Model Name}.ext */
  /** Make `rel` (inside the model folder) the cover, saved as Cover-{Model Name}. The chosen file stays where it is. */
  async setCoverFromFile(id, rel) {
    const m = this.model(id);
    const src = path.resolve(m.path, String(rel || ''));
    if (!within(m.path, src) || !(await exists(src))) throw httpError(400, 'File not found in this model');
    const sniff = await sniffMedia(src);
    const k = sniff?.kind || kindOf(src);
    if (k !== 'image' && k !== 'video') throw httpError(400, 'Covers must be an image, GIF or video');
    // Use the file's real type, so a video saved as ".gif" becomes Cover-Name.mp4 and plays.
    const ext = sniff?.ext && kindOf(`x${path.extname(src)}`) !== sniff.kind ? sniff.ext : path.extname(src).toLowerCase();
    const dest = path.join(m.path, `Cover-${safeName(m.name)}${ext}`);
    const old = m.cover ? path.join(m.path, m.cover) : null;
    if (old && path.resolve(old) === path.resolve(src)) return m; // already the cover
    const tmp = path.join(m.path, `.cover-${crypto.randomUUID().slice(0, 8)}${ext}`);
    await fsp.copyFile(src, tmp);
    // The old cover is removed, never kept as a "Previous cover" file. If it was the only copy of
    // that picture, it moves into the img folder instead so nothing is lost.
    for (const prev of new Set([old, dest].filter(Boolean))) {
      if (path.resolve(prev) === path.resolve(src) || !/^cover-/i.test(path.basename(prev)) || !(await exists(prev))) continue;
      await this.retirePicture(m.path, prev, [tmp]);
    }
    await fsp.rename(tmp, dest);
    this.db.prepare(`UPDATE models SET cover = ?, updated_at = datetime('now') WHERE id = ?`).run(path.basename(dest), id);
    await this.refreshStats(id);
    return this.model(id);
  }
  /** Remove a cover-style file: deleted if the same picture exists elsewhere in the model, otherwise moved into img. */
  async retirePicture(dir, abs, skip = []) {
    const size = (await fsp.stat(abs)).size;
    for (const f of await walk(dir)) {
      const other = path.join(dir, f.rel);
      if (f.size !== size || path.resolve(other) === path.resolve(abs) || skip.some((x) => path.resolve(x) === path.resolve(other))) continue;
      if (await sameFile(abs, other).catch(() => false)) { await fsp.rm(abs, { force: true }); return 'deleted'; }
    }
    const base = path.basename(abs).replace(/^(cover-|previous cover)\s*/i, '').replace(/^\(\d+\)/, '').trim() || 'picture';
    await move(abs, await uniquePath(path.join(dir, 'img', base.startsWith('.') ? `picture${base}` : base)));
    return 'kept';
  }

  /** Move a file into the library's .trash folder (never deleted outright). */
  async deleteFile(id, rel) {
    const m = this.model(id);
    const abs = path.resolve(m.path, String(rel || ''));
    if (!rel || !within(m.path, abs) || abs === m.path) throw httpError(400, 'File not found in this model');
    const st = await fsp.stat(abs).catch(() => null);
    if (!st || !st.isFile()) throw httpError(404, 'File not found in this model');
    const relClean = path.relative(m.path, abs);
    await move(abs, await uniquePath(path.join(this.roots.library, '.trash', safeName(m.name), relClean)));
    // Tidy folders the delete left empty (not the model folder itself).
    for (let d = path.dirname(abs); d !== m.path && within(m.path, d); d = path.dirname(d)) {
      const left = await fsp.readdir(d).catch(() => null);
      if (!left || left.some((n) => !ignored(n))) break;
      await fsp.rm(d, { recursive: true, force: true });
    }
    if (m.cover && path.resolve(m.path, m.cover) === abs) this.db.prepare(`UPDATE models SET cover = NULL, updated_at = datetime('now') WHERE id = ?`).run(id);
    return this.refreshStats(id);
  }

  /** Picture folders not called "img" (Images, Renders, Photos …) and old "Previous cover" files. */
  async pictureChanges(dir) {
    const out = { folders: [], strays: [] };
    const ents = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of ents) {
      if (e.isFile() && /^previous cover( \(\d+\))?\.[a-z0-9]+$/i.test(e.name)) out.strays.push(e.name);
      if (!e.isDirectory() || e.name.toLowerCase() === 'img' || e.name.startsWith('.') || ignored(e.name)) continue;
      const files = await walk(path.join(dir, e.name), { maxFiles: 2000 });
      if (files.length && files.every((f) => f.kind === 'image' || f.kind === 'video')) out.folders.push(e.name);
    }
    return out;
  }
  async tidyPictures(id) {
    const m = this.model(id);
    if (!within(this.roots.library, m.path) || m.path === this.roots.library) return 0;
    const { folders, strays } = await this.pictureChanges(m.path);
    if (!folders.length && !strays.length) return 0;
    let cover = m.cover;
    const img = path.join(m.path, 'img');
    for (const name of folders) {
      const from = path.join(m.path, name);
      for (const f of await walk(from)) {
        const to = await uniquePath(path.join(img, f.rel));
        await move(path.join(from, f.rel), to);
        if (cover === `${name}/${f.rel}`) cover = path.relative(m.path, to).split(path.sep).join('/');
      }
      await fsp.rm(from, { recursive: true, force: true });
    }
    for (const n of strays) await this.retirePicture(m.path, path.join(m.path, n));
    if (cover !== m.cover) this.db.prepare('UPDATE models SET cover = ? WHERE id = ?').run(cover, id);
    await this.refreshStats(id);
    return 1;
  }

  async setThumb(id, buf) {
    const m = this.model(id);
    const name = `${m.id}.png`;
    await fsp.writeFile(path.join(this.thumbDir, name), buf);
    this.db.prepare(`UPDATE models SET thumb = ?, updated_at = datetime('now') WHERE id = ?`).run(name, id);
    return this.model(id);
  }

  async deleteModel(id, { deleteFiles = false } = {}) {
    const m = this.model(id);
    if (deleteFiles && (await exists(m.path))) {
      // Never hard-delete: move into a .trash folder inside the library.
      const trash = path.join(this.roots.library, '.trash');
      await move(m.path, await uniquePath(path.join(trash, path.basename(m.path))));
    }
    if (m.thumb) await rmQuiet(path.join(this.thumbDir, m.thumb));
    this.db.prepare('DELETE FROM models WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM model_tags)').run();
  }

  /** Unzip an archive inside a model as a background job with progress. */
  startExtract(id, rel) {
    const m = this.model(id);
    const abs = path.resolve(m.path, String(rel || ''));
    const v = volumeInfo(path.basename(abs));
    if (!within(m.path, abs) || !(v ? v.first : isArchive(abs))) throw httpError(400, v ? 'Extract from the first part of this multi-part archive' : 'Not an archive in this model');
    const job = { id: crypto.randomUUID(), type: 'extract', label: `Extracting ${path.basename(abs)}`, status: 'running', pct: 0, name: path.basename(abs), errors: [] };
    this.jobs.set(job.id, job);
    (async () => {
      try {
        const dest = await uniquePath(abs.replace(/(\.part\d+)?\.(zip|7z|rar)(\.\d{3})?$/i, ''));
        await extractArchive(abs, dest, (p) => { job.pct = p; });
        await flattenSingleFolder(dest);
        await this.refreshStats(id);
        job.pct = 100; job.status = 'done';
      } catch (e) { job.status = 'error'; job.errors.push(e.message); }
      job.finishedAt = Date.now();
    })();
    return job;
  }

  /** Find dropped files (by name and size) in folders this server can see, so they can be moved instead of uploaded. */
  async findLocal(wanted) {
    if (!this.localIndex || Date.now() - this.localIndex.at > 20000) {
      const map = new Map();
      for (const [key, root] of Object.entries(this.roots)) {
        if (key === 'library') continue;
        for (const f of await walk(root, { maxFiles: 30000 })) { const k = `${path.basename(f.rel).toLowerCase()}|${f.size}`; if (!map.has(k)) map.set(k, path.join(root, f.rel)); }
      }
      this.localIndex = { at: Date.now(), map };
    }
    const found = wanted.map((w) => this.localIndex.map.get(`${String(w.name).toLowerCase()}|${Number(w.size)}`));
    if (!found.length || found.some((x) => !x)) return null;
    for (const p of found) if (!(await exists(p))) { this.localIndex = null; return null; }
    this.localIndex = null;
    return found;
  }

  // ---------- drafts (staged imports) ----------
  async newDraft(origin) {
    const id = crypto.randomUUID();
    const dir = path.join(this.stagingDir, id);
    await fsp.mkdir(path.join(dir, 'src'), { recursive: true });
    await fsp.mkdir(path.join(dir, 'content'), { recursive: true });
    const d = { id, origin, status: 'uploading', name: '', items: [], archives: [], files: [], covers: [], createdAt: Date.now() };
    this.drafts.set(id, d);
    return d;
  }
  draftDir(d) { return path.join(this.stagingDir, d.id); }
  async saveDraft(d) { await fsp.writeFile(path.join(this.draftDir(d), 'draft.json'), JSON.stringify(d)); }
  draft(id) { const d = this.drafts.get(id); if (!d) throw httpError(404, 'Import not found'); return d; }
  listDrafts() { return [...this.drafts.values()].sort((a, b) => a.createdAt - b.createdAt).map((d) => this.publicDraft(d)); }
  publicDraft(d) {
    const { items, ...rest } = d;
    return { ...rest, fromFolder: (d.items || []).length > 0 };
  }

  /** Move files/folders from an allowed root (e.g. Downloads) into a draft. */
  /** Bring files into a draft in the background (with progress), then prepare it. Returns straight away. */
  ingest(d, absPaths, { copy = false } = {}) {
    this.ingesting ||= new Set();
    for (const p of absPaths) this.ingesting.add(p);
    d.status = 'processing';
    if (!d.name) { d.rawName = path.basename(absPaths[0] || ''); d.name = niceName(d.rawName); } // rawName: read for details later
    const verb = copy ? 'Copying' : 'Moving';
    d.progress = { pct: 0, label: `${verb} ${absPaths.length} file${absPaths.length === 1 ? '' : 's'} to the library` };
    (async () => {
      const src = path.join(this.draftDir(d), 'src');
      let timer;
      try {
        let total = 0;
        for (const p of absPaths) { const st = await fsp.stat(p); total += st.isDirectory() ? (await walk(p)).reduce((n, f) => n + f.size, 0) : st.size; }
        let busy = false;
        timer = setInterval(async () => {
          if (busy || !total) return; busy = true;
          try { const done = (await walk(src)).reduce((n, f) => n + f.size, 0); d.progress = { ...d.progress, pct: Math.min(99, Math.round((done / total) * 100)) }; } catch { /* keep going */ }
          busy = false;
        }, 1000);
        await this.addPathsToDraft(d, absPaths, { copy });
        clearInterval(timer);
        d.progress = { pct: null, label: 'Reading the archive and unpacking pictures' };
        await this.processDraft(d);
      } catch (e) {
        clearInterval(timer);
        d.status = 'error'; d.error = `Could not ${copy ? 'copy' : 'move'} the files: ${e.message}`; d.progress = null;
        await this.saveDraft(d).catch(() => {});
      } finally { for (const p of absPaths) this.ingesting.delete(p); }
    })();
    return d;
  }
  async addPathsToDraft(d, absPaths, { copy = false } = {}) {
    d.copied = copy;
    for (const abs of absPaths) {
      const dest = await uniquePath(path.join(this.draftDir(d), 'src', path.basename(abs)));
      if (copy) await fsp.cp(abs, dest, { recursive: true, preserveTimestamps: true });
      else { await move(abs, dest); d.items.push({ origin: abs, current: dest }); }
    }
  }

  async processDraft(d) {
    d.status = 'processing';
    await this.saveDraft(d);
    try {
      const src = path.join(this.draftDir(d), 'src');
      const content = path.join(this.draftDir(d), 'content');
      const entries = (await fsp.readdir(src, { withFileTypes: true })).filter((e) => !ignored(e.name));
      const allArchives = entries.filter((e) => e.isFile() && isArchiveLike(e.name));
      const others = entries.filter((e) => !(e.isFile() && isArchiveLike(e.name)));
      d.archives = allArchives.map((e) => e.name);
      // Multi-part sets (part1.rar, .7z.001 …) are extracted once, from their first part.
      const archives = allArchives.filter((e) => { const v = volumeInfo(e.name); return v ? v.first : isArchive(e.name); });
      if (allArchives.length && !archives.length) throw new Error('The first part of this multi-part archive is missing. Download every part, then import them together.');

      const unpack = this.setting('extractArchives') === 'true';
      for (const a of unpack ? archives : []) {
        const into = archives.length === 1 ? content : path.join(content, safeName(niceName(a.name)));
        const i = archives.indexOf(a);
        d.progress = { pct: Math.round((i / archives.length) * 100), label: `Extracting ${a.name}` }; await this.saveDraft(d);
        await extractArchive(path.join(src, a.name), into, (p) => { d.progress = { pct: Math.round(((i + p / 100) / archives.length) * 100), label: `Extracting ${a.name}` }; });
        if (archives.length > 1) await flattenSingleFolder(into);
      }
      if (unpack && archives.length === 1 && others.length === 0) await flattenSingleFolder(content);
      for (const e of others) {
        const from = path.join(src, e.name);
        if (e.isDirectory() && entries.length === 1) { await moveContents(from, content); await rmQuiet(from); }
        else await move(from, await uniquePath(path.join(content, e.name)));
        const item = d.items.find((i) => i.current === from);
        if (item) item.current = e.isDirectory() && entries.length === 1 ? content : path.join(content, e.name);
      }
      if (unpack && this.setting('extractNested') === 'true') await extractNested(content, path.join(this.draftDir(d), 'nested'));

      let files = await walk(content);
      d.zipped = !unpack && archives.length > 0;
      d.tempCovers = [];
      if (d.zipped) {
        // Keep the archive zipped: read its file list and pull out only a few cover candidates.
        const inner = [];
        for (const a of archives) {
          for (const e of await listArchive(path.join(src, a.name))) inner.push({ rel: `${a.name}/${e.path.replace(/^\.\//, '')}`, entry: e.path, archive: a.name, size: e.size || 0, kind: kindOf(e.path), mtime: e.mtime || 0 });
        }
        // Images are the one thing unpacked: they go to an "img" folder so covers and previews work.
        const img = path.join(content, 'img');
        for (const a of archives) {
          if (await extractImagesTo(path.join(src, a.name), img)) continue;
          for (const c of inner.filter((x) => x.archive === a.name && x.kind === 'image' && x.size < 80 * 1024 * 1024).slice(0, 60)) {
            try { await fsp.mkdir(img, { recursive: true }); await extractEntryTo(path.join(src, c.archive), c.entry, await uniquePath(path.join(img, safeName(path.basename(c.entry), 'image')))); } catch { /* skip unreadable entry */ }
          }
        }
        if ((await exists(img)) && !(await fsp.readdir(img)).length) await rmQuiet(img);
        const loose = await walk(content);
        files = [...loose, ...inner.map(({ entry: _e, archive: _a, ...f }) => f)];
      }
      d.files = files;
      d.covers = rankCovers(d.zipped ? await walk(content) : files).map((f) => f.rel);
      let rawBase = (d.rawName || '').replace(/(\.(zip|7z|rar|stl|3mf|obj|step|stp|part\d+|\d{3}|[zr]\d{2}))+$/i, ''); // the file name as it was, for reading details
      if (!d.name) {
        const base = archives[0]?.name || (others.length === 1 ? others[0].name : files.find((f) => f.kind === 'model')?.rel || 'New model');
        d.name = niceName(path.basename(base));
        rawBase = path.basename(base).replace(/(\.(zip|7z|rar|stl|3mf|obj|step|stp|part\d+|\d{3}|[zr]\d{2}))+$/i, '');
      }
      // Names in Russian, Chinese and other non-Latin scripts get an English suggestion.
      if (this.setting('translateNames') === 'true' && needsTranslation(d.name)) {
        d.progress = { pct: null, label: 'Translating the name' };
        const t = await this.translator.toEnglish(d.name);
        if (t.en && t.en !== d.name) { d.originalName = d.name; d.name = t.en; d.translatedVia = t.via; }
      }
      d.cover = d.covers[0] || null;
      // Year: from the 3D files' dates, inside archives first (the designer's dates, not the download's).
      const insideArchives = files.filter((f) => d.zipped && archives.some((a) => f.rel.startsWith(`${a.name}/`)));
      const y = yearFromDates(insideArchives.filter((f) => f.kind === 'model')) || yearFromDates(files.filter((f) => f.kind === 'model')) || yearFromDates(insideArchives);
      d.yearFromFiles = !d.year && !!y;
      d.year = d.year || y || new Date().getFullYear();
      // Fill in as much as the file names tell: name, designer, year, categories, tags, source link.
      try {
        const inside = [...new Set(files.map((f) => f.rel.split('/')).flatMap((p) => (d.zipped ? p.slice(1, -1) : p.slice(0, -1)).slice(0, 2)))].slice(0, 30);
        const modelFiles = [...new Set(files.filter((f) => f.kind === 'model').map((f) => path.posix.basename(f.rel)))].slice(0, 40);
        const texts = [d.name, ...d.archives, ...others.map((e) => e.name), ...inside, ...modelFiles].filter(Boolean);
        const g = guessDetails(this, { texts, files, name: !d.originalName && rawBase ? rawBase : d.name });
        if (g.name) d.name = g.name;
        d.designer = d.designer || g.designer;
        if (g.year) { d.year = g.year; d.yearFromFiles = false; }
        d.values = g.values; d.tags = g.tags;
        d.source_url = d.source_url || g.source_url;
        d.guessed = [...g.found, ...(d.yearFromFiles && !g.year ? ['year (from the file dates)'] : [])];
      } catch (e) { console.warn('Could not read details from the file names:', e.message); }
      d.duplicateOf = this.db.prepare('SELECT id, name FROM models WHERE name = ? COLLATE NOCASE').get(d.name) || null;
      // Downloaded before? Archives by name and size; without archives, the loose 3D files.
      try {
        const downloaded = await this.downloadedFiles(d, src);
        const hits = this.history.check(downloaded.map((f) => ({ ...f, type: 'file' })));
        d.doubles = downloaded.map((f, i) => hits[i] && { name: f.name, ...hits[i] }).filter((h) => h && h.level !== 'similar');
      } catch { d.doubles = []; }
      d.designer = d.designer || this.guessDesigner(d.name + ' ' + d.archives.join(' '));
      d.status = 'ready'; d.progress = null;
    } catch (e) {
      d.status = 'error';
      d.error = e.message;
    }
    await this.saveDraft(d);
    return d;
  }

  guessDesigner(text) {
    const lower = text.toLowerCase();
    return this.designers().map((x) => x.name).sort((a, b) => b.length - a.length).find((n) => n.length > 2 && lower.includes(n.toLowerCase())) || '';
  }

  async addCoverToDraft(d, savedPath) {
    const content = path.join(this.draftDir(d), 'content');
    const dest = await uniquePath(path.join(content, path.basename(savedPath)));
    await move(savedPath, dest);
    d.files = await walk(content);
    d.covers = rankCovers(d.files).map((f) => f.rel);
    d.cover = path.relative(content, dest).split(path.sep).join('/');
    await this.saveDraft(d);
    return d;
  }

  async cancelDraft(id) {
    const d = this.draft(id);
    if (d.items.length) {
      const nested = path.join(this.draftDir(d), 'nested');
      const content = path.join(this.draftDir(d), 'content');
      if (await exists(nested)) await moveContents(nested, content);
      // Put everything back where it came from.
      for (const it of d.items) {
        if (await exists(it.current)) {
          if (it.current === path.join(this.draftDir(d), 'content')) await moveContents(it.current, it.origin);
          else await move(it.current, await uniquePath(it.origin));
        }
      }
    }
    await rmQuiet(this.draftDir(d));
    this.drafts.delete(id);
  }

  // ---------- deleting downloads ----------
  // Unwanted downloads go to a .trash folder at the top of their location (same disk, so it's instant).
  // Nothing is deleted for good until the trash is emptied.
  trashDir(root) { const base = this.roots[root]; if (!base || root === 'library') throw httpError(400, 'Only downloads and watch folders can be cleaned up here.'); return path.join(base, '.trash'); }
  async trashDownload(root, rel) {
    const base = this.roots[root];
    const abs = await resolveInside(base, String(rel || ''));
    if (path.resolve(abs) === path.resolve(base)) throw httpError(400, 'Pick files or folders, not the whole location.');
    if (this.ingesting?.has(abs)) throw httpError(409, `${path.basename(abs)} is being imported right now.`);
    // Never a model's files: those are removed from the model window.
    const inUse = this.db.prepare('SELECT name, path FROM models').all().find((m) => within(abs, m.path) || within(m.path, abs) || path.resolve(m.path) === path.resolve(abs));
    if (inUse) throw httpError(409, `${path.basename(abs)} belongs to the model ${inUse.name}. Remove it from the model window instead.`);
    if (!(await exists(abs))) return false;
    const dir = this.trashDir(root);
    await fsp.mkdir(dir, { recursive: true });
    await move(abs, await uniquePath(path.join(dir, path.basename(abs))));
    return true;
  }
  async trashInfo(root) {
    const files = await walk(this.trashDir(root)).catch(() => []);
    const top = await fsp.readdir(this.trashDir(root)).catch(() => []);
    return { items: top.length, files: files.length, bytes: files.reduce((n, f) => n + f.size, 0) };
  }
  async emptyTrash(root) {
    const dir = this.trashDir(root);
    const info = await this.trashInfo(root);
    for (const n of await fsp.readdir(dir).catch(() => [])) await fsp.rm(path.join(dir, n), { recursive: true, force: true });
    return info;
  }

  /** The files an import came from, as downloaded: its archives, or without archives its loose 3D files. */
  async downloadedFiles(d, src = path.join(this.draftDir(d), 'src')) {
    const out = [];
    for (const a of d.archives || []) { const st = await fsp.stat(path.join(src, a)).catch(() => null); if (st) out.push({ name: a, size: st.size }); }
    if (!out.length) for (const f of d.files || []) if (f.kind === 'model' && f.size > 0) out.push({ name: path.posix.basename(f.rel), size: f.size });
    return out;
  }

  async commitDraft(id, body) {
    const d = this.draft(id);
    if (d.status !== 'ready') throw httpError(409, 'This import is not ready yet');
    const name = String(body.name || d.name).trim().slice(0, 200) || 'Untitled';
    const designer = String(body.designer ?? d.designer ?? '').trim().slice(0, 120);
    const values = (body.values ?? d.values ?? []).map(Number).filter(Boolean);
    const yr = Math.round(Number(body.year ?? d.year));
    const year = yr >= 1900 && yr <= 2200 ? yr : null;
    const target = await uniquePath(this.targetFolder({ name, designer, year, values }));
    const content = path.join(this.draftDir(d), 'content');
    const src = path.join(this.draftDir(d), 'src');

    await moveContents(content, target);
    let cover = null;
    const pick = body.cover === undefined ? d.cover : body.cover;
    if (pick) {
      const from = path.join(target, pick);
      if (within(target, from) && (await exists(from))) {
        const to = await uniquePath(path.join(target, `Cover-${safeName(name)}${path.extname(from).toLowerCase()}`));
        // Covers picked from the img folder are copied, so img keeps every picture.
        if (/^img\//.test(pick)) await fsp.copyFile(from, to); else await move(from, to);
        cover = path.basename(to);
      }
    }
    // Cover candidates pulled out of a zipped archive: keep only the chosen one.
    for (const rel of d.tempCovers || []) if (rel !== pick) await rmQuiet(path.join(target, rel));
    const downloaded = await this.downloadedFiles(d, src).catch(() => []);
    const keep = d.zipped || this.setting('keepArchive') === 'true';
    for (const a of d.archives) {
      const p = path.join(src, a);
      if (!(await exists(p))) continue;
      if (keep) await move(p, await uniquePath(path.join(target, a)));
      else await rmQuiet(p);
    }
    let renamed = 0;
    if (this.setting('translateNames') === 'true') renamed = await this.englishNames(target);
    const stats = await this.statsFor(target);
    const id2 = tx(this.db, () => {
      const r = this.db.prepare(`INSERT INTO models(name, path, designer, notes, cover, source, managed, file_count, size, kinds, year, source_url, no_ams)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`).run(name, target, designer, String(body.notes || ''), cover, d.origin, stats.file_count, stats.size, stats.kinds, year, String(body.source_url ?? d.source_url ?? '').slice(0, 1000), body.noAms ? 1 : 0);
      const mid = Number(r.lastInsertRowid);
      this.setValues(mid, values);
      this.setTags(mid, body.tags ?? d.tags ?? []);
      return mid;
    });
    this.history.record(id2, name, downloaded); // their names as downloaded, before any renaming
    await rmQuiet(this.draftDir(d));
    this.drafts.delete(id);
    await this.autoNameArchives(id2);
    this.images.later(id2); // shrink its pictures in the background
    return { ...this.model(id2), renamedToEnglish: renamed };
  }
  /** Give files and folders with non-Latin names English names (deepest first). Returns how many were renamed. */
  async englishNames(dir) {
    let n = 0;
    const ents = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of ents) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) n += await this.englishNames(abs);
      if (!needsTranslation(e.name)) continue;
      // Keep the extension (and multi-part endings like .part1.rar or .7z.001) as they are.
      const m = e.isDirectory() ? null : /((\.part\d+)?\.[a-z0-9]{1,8}(\.\d{3})?)$/i.exec(e.name);
      const ext = m ? m[1] : '';
      const base = ext ? e.name.slice(0, -ext.length) : e.name;
      const { en } = await this.translator.toEnglish(base);
      if (!en || needsTranslation(en)) continue;
      try { await fsp.rename(abs, await uniquePath(path.join(dir, `${safeName(en, 'file')}${ext}`))); n++; } catch { /* leave it as it is */ }
    }
    return n;
  }

  // ---------- details from file names, for models already in the library ----------
  /** What the file names say that a model doesn't have yet: a cleaner name, designer, year, categories, tags, source link. */
  async suggestDetails(ids) {
    const out = [];
    const groupOf = new Map(this.groups().flatMap((g) => g.values.map((v) => [v.id, { name: v.name, group: g.name }])));
    for (const id of ids) {
      let m;
      try { m = this.model(id); } catch { continue; }
      let files = [];
      if (await exists(m.path)) files = await walk(m.path, { maxFiles: 3000 });
      const archives = files.map((f) => path.posix.basename(f.rel)).filter((n) => isArchiveLike(n));
      // Look inside a few archives: their 3D files decide the print type, and their dates the year.
      const inner = [];
      if (!files.some((f) => f.kind === 'model') || !m.year) {
        const firsts = files.filter((f) => { const n = path.posix.basename(f.rel); const v = volumeInfo(n); return v ? v.first : isArchive(n); }).slice(0, 4);
        for (const a of firsts) {
          try { for (const e of await listArchive(path.join(m.path, a.rel))) if (!e.dir) inner.push({ rel: `${a.rel}/${e.path}`, size: e.size || 0, kind: kindOf(e.path), mtime: e.mtime || 0 }); } catch { /* can't look inside */ }
        }
      }
      const loose = files.slice();
      files.push(...inner);
      const folders = [...new Set(files.map((f) => f.rel.split('/').slice(0, -1)).flatMap((p) => p.slice(0, 2)))].filter((n) => !/^(img|images?|renders?)$/i.test(n)).slice(0, 30);
      const modelFiles = [...new Set(files.filter((f) => f.kind === 'model').map((f) => path.posix.basename(f.rel)))].slice(0, 40);
      const texts = [m.name, path.basename(m.path), ...archives, ...folders, ...modelFiles];
      const g = guessDetails(this, { texts, files, name: m.name });
      const has = new Set(m.vals);
      const tagHas = new Set(m.tags.map((t) => t.toLowerCase()));
      const changes = {};
      if (g.name && g.name !== m.name && g.name.replace(/\s+/g, ' ').trim()) changes.name = g.name;
      if (!m.designer && g.designer) changes.designer = g.designer;
      if (!m.year && g.year) changes.year = g.year;
      // No year in the names: the dates of the 3D files, inside the archives first (those are the designer's dates).
      if (!m.year && !g.year) {
        const y = yearFromDates(inner.filter((f) => f.kind === 'model')) || yearFromDates(inner) || yearFromDates(loose.filter((f) => f.kind === 'model'));
        if (y) { changes.year = y; changes.yearFrom = 'file dates'; }
      }
      const addValues = g.values.filter((v) => !has.has(v) && groupOf.has(v));
      if (addValues.length) changes.addValues = addValues.map((v) => ({ id: v, ...groupOf.get(v) }));
      const addTags = g.tags.filter((t) => !tagHas.has(t.toLowerCase()));
      if (addTags.length) changes.addTags = addTags;
      if (!m.source_url && g.source_url) changes.source_url = g.source_url;
      // Archives, named as they would be with these changes.
      let archiveRows = [];
      try {
        const as = { name: changes.name, designer: changes.designer, year: changes.year, addValues: (changes.addValues || []).map((v) => v.id) };
        archiveRows = (await this.archivePlan(m.id, { as })).items.map(({ key, current, stem, suffix, part, scale, keep, newName, files: fs }) => ({ key, current, stem, suffix, part, scale, keep, newName, parts: fs.length }));
      } catch { /* folder missing */ }
      // What the model already has, so the review can offer to fill in the rest.
      const groupsWithValue = [...new Set(m.vals.map((v) => this.db.prepare('SELECT group_id FROM group_values WHERE id = ?').get(v)?.group_id).filter(Boolean))];
      const filled = { designer: !!m.designer, year: !!m.year, source_url: !!m.source_url, tags: m.tags.length > 0, groups: groupsWithValue };
      const current = { name: m.name, designer: m.designer || '', year: m.year || '', source_url: m.source_url || '', tags: m.tags, vals: m.vals };
      out.push({ id: m.id, name: m.name, designer: m.designer, changes, archives: archiveRows, has: filled, current });
    }
    return out;
  }
  /** Apply chosen suggestions, then organize those models in the background. */
  async applySuggestions(items, { organize = true, ids = null } = {}) {
    let changed = 0;
    for (const it of items) {
      const patch = {};
      if (typeof it.name === 'string' && it.name.trim()) patch.name = it.name;
      if (typeof it.designer === 'string') patch.designer = it.designer;      // may be '' to clear it
      if ('year' in it) patch.year = it.year;
      if (typeof it.source_url === 'string') patch.source_url = it.source_url;
      if (Array.isArray(it.values)) patch.values = it.values.map(Number).filter(Boolean); // the full set, as chosen in the review
      if (Array.isArray(it.tags)) patch.tags = it.tags.map(String).filter((t) => t.trim());
      if (Array.isArray(it.addValues) && it.addValues.length) patch.addValues = it.addValues.map(Number).filter(Boolean);
      if (Array.isArray(it.addTags) && it.addTags.length) patch.addTags = it.addTags;
      try {
        if (Object.keys(patch).length) { await this.updateModel(Number(it.id), patch, { skipOrganize: true }); changed++; }
        // Archive choices from the review: renamed now (with the new details), or left as they are for good.
        if (it.archives && typeof it.archives === 'object' && Object.keys(it.archives).length && !this.isOutside(this.model(Number(it.id)))) {
          await this.nameArchives(Number(it.id), it.archives);
        }
      } catch (e) { console.warn('Could not update model', it.id, e.message); }
    }
    const list = (ids || items.map((x) => x.id)).map(Number).filter(Boolean);
    const job = organize && list.length ? this.startOrganize(undefined, { ids: list, adopt: this.setting('adoptOnSave') === 'true', label: `Organizing ${list.length} model${list.length === 1 ? '' : 's'}` }) : null;
    return { changed, job };
  }

  // ---------- archive names ----------
  archiveParts(raw = this.setting('archiveParts')) {
    let list = raw;
    if (typeof raw === 'string') { try { list = JSON.parse(raw || '[]'); } catch { list = []; } }
    return (Array.isArray(list) ? list : []).map((p) => ({ label: String(p.label || '').trim(), words: String(p.words || '').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean) }))
      .filter((p) => p.label);
  }
  /** Read the part (Bust, X-Pose …) and scale (1-6, 75mm …) out of an archive's file name. */
  detectArchive(fileName, { onlyPictures = false, ignore = '', parts: partList = this.archiveParts() } = {}) {
    const norm = (x) => ` ${String(x).toLowerCase().replace(/[_.\s]+/g, ' ').trim()} `;
    let text = norm(fileName);
    // The model's own name doesn't count: "Batman Bust - 1-6.zip" isn't a "Bust" part of "Batman Bust".
    for (const n of [ignore].flat().filter(Boolean)) { const k = norm(n); if (k.trim()) text = text.split(k).join('  '); }
    const parts = [];
    for (const p of partList) {
      for (const w of p.words) {
        const re = new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s-]+/g, '[\\s-]*')}(?![a-z0-9])`, 'i');
        if (re.test(text)) { parts.push(p.label); text = text.replace(re, '$1 '); break; }
      }
    }
    if (!parts.length && onlyPictures) { const pics = partList.find((p) => p.words.includes('images') || /image|picture|render/i.test(p.label)); if (pics) parts.push(pics.label); }
    let scale = '';
    const raw = String(fileName);
    let m = /(?<!\d[-_.\s])(?<!\d)1\s*(?:[-_:/]|\s?to\s?)\s*([1-9]\d?)(?!\d)(?:\s*(?:th|scale))?/i.exec(raw);
    if (m) scale = `1-${m[1]}`;
    else if ((m = /(?<![\d.])(\d{2,3})\s?mm(?![a-z])/i.exec(raw))) scale = `${m[1]}mm`;
    return { part: parts.join(' '), scale };
  }
  /** "name - part - scale" for one archive, from the format in Settings. */
  archiveBase(m, { part = '', scale = '' } = {}, format = this.setting('archiveFormat')) {
    const tokens = { ...this.tokensFor({ name: m.name, designer: m.designer, year: m.year, values: m.vals }), part, scale };
    return renderTemplate(String(format || '{name}').replace(/[\\/]+/g, ' '), tokens).join(' ');
  }
  /** The archives in a model, with multi-part sets kept together (X.part1.rar + X.part2.rar, X.zip + X.z01 …). */
  async archiveSets(m) {
    const all = await walk(m.path);
    const sizeOf = new Map(all.map((f) => [f.rel, f.size]));
    const files = all.map((f) => f.rel).filter((rel) => !rel.split('/').some((seg) => seg.startsWith('.')) && isArchiveLike(path.posix.basename(rel)));
    const split = (name) => {
      let x;
      if ((x = /^(.*)(\.part\d+\.rar)$/i.exec(name))) return [x[1], x[2]];
      if ((x = /^(.*)(\.(?:7z|zip|rar)\.\d{3})$/i.exec(name))) return [x[1], x[2]];
      if ((x = /^(.*)(\.[zr]\d{2})$/i.exec(name))) return [x[1], x[2]];
      const ext = path.extname(name);
      return [name.slice(0, -ext.length), ext];
    };
    const sets = new Map();
    for (const rel of files) {
      const dir = path.posix.dirname(rel), [stem, suffix] = split(path.posix.basename(rel));
      const key = `${dir}/${stem}`;
      if (!sets.has(key)) sets.set(key, { dir: dir === '.' ? '' : dir, stem, files: [], size: 0 });
      sets.get(key).files.push({ rel, suffix });
      sets.get(key).size += sizeOf.get(rel) || 0;
    }
    for (const set of sets.values()) {
      set.files.sort((a, b) => a.suffix.localeCompare(b.suffix, undefined, { numeric: true }));
      // The part whose name ends in .zip/.rar/.7z/.001/.part1 is the one to look inside.
      set.main = (set.files.find((f) => /^\.(zip|rar|7z|part0*1\.rar|(7z|zip|rar)\.0*1)$/i.test(f.suffix)) || set.files[0]).rel;
    }
    return [...sets.values()].sort((a, b) => a.main.localeCompare(b.main, undefined, { numeric: true }));
  }
  #pictureCache = new Map();
  /** Does this archive hold only pictures and videos? (Remembered per file and size.) */
  async #onlyPictures(abs, size) {
    const key = `${abs}|${size}`;
    if (this.#pictureCache.has(key)) return this.#pictureCache.get(key);
    let yes = false;
    try {
      const list = (await listArchive(abs)).filter((e) => !e.dir);
      yes = list.length > 0 && list.every((e) => ['image', 'video'].includes(kindOf(e.path)));
    } catch { /* can't look inside */ }
    if (this.#pictureCache.size > 5000) this.#pictureCache.clear();
    this.#pictureCache.set(key, yes);
    return yes;
  }
  #archiveMeta(m) { try { const o = JSON.parse(m.archive_meta || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; } }
  /** Every archive with its detected or chosen part and scale, and the name it would get. */
  /** as: details to name with instead of the saved ones (a name or designer about to change). */
  async archivePlan(id, { quick = false, as = null } = {}) {
    const real = this.model(id), meta = this.#archiveMeta(real), out = [];
    const m = this.#modelAs(real, as), ignore = [...new Set([real.name, m.name])];
    for (const set of await this.archiveSets(m)) {
      const saved = meta[set.main];
      let onlyPictures = false;
      if (!quick && !saved && !this.detectArchive(set.stem, { ignore }).part) {
        onlyPictures = await this.#onlyPictures(path.join(real.path, set.main), set.size);
      }
      const detected = this.detectArchive(set.stem, { onlyPictures, ignore });
      const choice = saved || detected;
      const base = saved?.name || this.archiveBase(m, choice); // saved.name: a name typed by hand
      out.push({ key: set.main, dir: set.dir, current: path.posix.basename(set.main), stem: set.stem, files: set.files.map((f) => f.rel), size: set.size,
        part: choice.part || '', scale: choice.scale || '', name: saved?.name || '', keep: !!saved?.keep, detected, suffix: set.files.find((f) => f.rel === set.main).suffix,
        newName: saved?.keep ? path.posix.basename(set.main) : `${base}${set.files.find((f) => f.rel === set.main).suffix}` });
    }
    return { format: this.setting('archiveFormat'), parts: this.archiveParts().map((p) => p.label), items: out };
  }
  /**
   * Rename a model's archives. choices: { [key]: { part, scale, keep } } (missing ones use what's saved or detected).
   * Returns how many sets were renamed.
   */
  async nameArchives(id, choices = null) {
    const m = this.model(id);
    if (!(await exists(m.path))) return 0;
    const meta = this.#archiveMeta(m), next = {};
    let n = 0;
    const plan = await this.archivePlan(id);
    for (const it of plan.items) {
      const c = choices?.[it.key];
      const pick = c ? { part: String(c.part || '').trim().slice(0, 60), scale: String(c.scale || '').trim().slice(0, 20), name: this.#typedName(c.name, it.suffix), keep: !!c.keep }
        : { part: it.part, scale: it.scale, name: it.name, keep: it.keep };
      let key = it.key;
      if (!pick.keep) {
        const base = pick.name || this.archiveBase(m, pick);
        if (base !== it.stem) {
          // Find a free name for the whole set, then rename every part of it.
          const dirAbs = path.join(m.path, it.dir);
          const suffixes = it.files.map((rel) => rel.slice(path.posix.dirname(rel) === '.' ? it.stem.length : path.posix.dirname(rel).length + 1 + it.stem.length));
          let stem = base, k = 2;
          while ((await Promise.all(suffixes.map((sfx) => exists(path.join(dirAbs, `${stem}${sfx}`))))).some(Boolean)) stem = `${base} (${k++})`;
          for (let i = 0; i < it.files.length; i++) await fsp.rename(path.join(m.path, it.files[i]), path.join(dirAbs, `${stem}${suffixes[i]}`));
          const mainSfx = suffixes[it.files.indexOf(it.key)];
          key = (it.dir ? `${it.dir}/` : '') + `${stem}${mainSfx}`;
          n++;
        }
      }
      // Remember choices made by hand, so they survive the next rename; detected ones are found again anyway.
      const manual = c || meta[it.key];
      if (manual) next[key] = { part: pick.part, scale: pick.scale, ...(pick.name ? { name: pick.name } : {}), ...(pick.keep ? { keep: true } : {}) };
    }
    this.db.prepare(`UPDATE models SET archive_meta = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(next), id);
    return n;
  }
  /** The names archives would get with these choices, without renaming anything. */
  /** A whole archive name typed by hand, without its extension, made safe for a file name ('' when none). */
  #typedName(name, suffix = '') {
    let n = String(name || '').trim();
    if (!n) return '';
    if (suffix && n.toLowerCase().endsWith(suffix.toLowerCase())) n = n.slice(0, -suffix.length);
    n = n.replace(/\.(zip|7z|rar)$/i, '').trim();
    return n ? safeName(n, 'archive') : '';
  }
  #modelAs(m, as) {
    if (!as) return m;
    return { ...m, name: as.name || m.name, designer: as.designer ?? m.designer, year: as.year || m.year,
      vals: Array.isArray(as.values) ? as.values.map(Number) : [...new Set([...m.vals, ...(as.addValues || []).map(Number)])] };
  }
  async archivePreview(id, choices = {}, as = null) {
    const m = this.#modelAs(this.model(id), as), plan = await this.archivePlan(id, { as });
    return Object.fromEntries(plan.items.map((it) => {
      const c = choices[it.key];
      if (!c) return [it.key, it.newName];
      const typed = this.#typedName(c.name, it.suffix);
      return [it.key, c.keep ? it.current : `${typed || this.archiveBase(m, { part: String(c.part || '').trim(), scale: String(c.scale || '').trim() })}${it.suffix}`];
    }));
  }
  /** Remember that a word in archive names means a part ("spt" → Presupported). Adds the part if it's new. */
  teachArchiveWord(word, label) {
    word = String(word || '').trim().toLowerCase().slice(0, 40);
    label = String(label || '').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 40);
    if (!word || !label) throw httpError(400, 'Choose a word and what it means');
    let list = [];
    try { list = JSON.parse(this.setting('archiveParts') || '[]'); } catch { list = []; }
    // A word means one thing: take it off any other part first.
    for (const p of list) p.words = String(p.words || '').split(',').map((w) => w.trim()).filter((w) => w && w.toLowerCase() !== word).join(', ');
    let p = list.find((x) => String(x.label).toLowerCase() === label.toLowerCase());
    if (!p) { p = { label, words: '' }; list.push(p); }
    // Short words go first in the list, so "spt" is tried before longer words that contain it.
    p.words = [word, ...String(p.words || '').split(',').map((w) => w.trim()).filter(Boolean)].join(', ');
    this.saveSettings({ archiveParts: JSON.stringify(list) });
    return { label: p.label, words: p.words };
  }
  /** After import or save: name archives by the format, when that's switched on. Never throws. */
  async autoNameArchives(id) {
    if (this.setting('archiveAuto') !== 'true') return 0;
    try { const m = this.model(id); if (this.isOutside(m)) return 0; return await this.nameArchives(id); } catch (e) { console.warn('Naming archives failed:', e.message); return 0; }
  }

  // ---------- existing library / Orynt3D import ----------
  /** Walk a folder tree once: per-directory info about 3D files and Orynt3D manifests. */
  async scanTree(root, onDir) {
    const dirs = new Map();
    const rec = async (dir, depth) => {
      onDir?.();
      let ents;
      try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      const info = { abs: dir, has3d: false, config: null, children: [] };
      dirs.set(dir, info);
      for (const e of ents) {
        if (e.isFile()) {
          const lower = e.name.toLowerCase();
          if (lower === 'config.orynt3d' || (lower === 'user.json' && info.config?.from !== 'orynt3d')) {
            try { info.config = { ...normalizeManifest(JSON.parse(await fsp.readFile(path.join(dir, e.name), 'utf8'))), from: 'orynt3d' }; } catch { /* unreadable manifest */ }
          } else if (lower === 'datapackage.json' && !info.config) {
            // Manyfold writes a datapackage.json into each model folder.
            try { info.config = manyfoldMeta(JSON.parse(await fsp.readFile(path.join(dir, e.name), 'utf8'))); } catch { /* not a Manyfold file */ }
          } else if (/^readme(\.txt)?$/.test(lower) && !info.config) {
            // Thingiverse downloads: "<name> by <designer> on Thingiverse: <link>".
            try { const fh = await fsp.open(path.join(dir, e.name)); const { buffer, bytesRead } = await fh.read(Buffer.alloc(64 * 1024), 0, 64 * 1024, 0); await fh.close(); info.config = thingiverseMeta(buffer.subarray(0, bytesRead).toString('utf8')); } catch { /* unreadable */ }
          } else if (!ignored(e.name) && ['model', 'sliced', 'archive'].includes(kindOf(e.name))) info.has3d = true;
        }
      }
      if (depth > 25) return;
      for (const e of ents) {
        if (e.isDirectory() && !ignored(e.name) && !e.name.startsWith('.') && e.name.toLowerCase() !== 'modelvault backups') {
          const child = path.join(dir, e.name);
          if (child === this.roots.downloads) continue; // the downloads folder inside the library holds no models
          info.children.push(child);
          await rec(child, depth + 1);
        }
      }
    };
    await rec(root, 0);
    return dirs;
  }

  async planScan(rootAbs, mode = 'smart', onDir) {
    const dirs = await this.scanTree(rootAbs, onDir);
    const hasMeta = (i) => i?.config?.isModel;
    const subtreeHas3d = new Map();
    const has3dBelow = (abs) => {
      if (subtreeHas3d.has(abs)) return subtreeHas3d.get(abs);
      const i = dirs.get(abs);
      const v = !!i && (i.has3d || i.children.some(has3dBelow));
      subtreeHas3d.set(abs, v);
      return v;
    };
    const modelDirs = new Set();
    if (mode === 'top') {
      for (const c of dirs.get(rootAbs)?.children || []) if (has3dBelow(c)) modelDirs.add(c);
    } else {
      for (const [abs, i] of dirs) if (hasMeta(i) && abs !== rootAbs && has3dBelow(abs)) modelDirs.add(abs);
      for (const [abs, i] of dirs) {
        if (!i.has3d) continue;
        if (mode === 'leaf') { modelDirs.add(abs); continue; }
        // Absorb into the nearest ancestor that Orynt3D already treats as a model.
        let p = abs, owner = null;
        while (within(rootAbs, p)) { if (modelDirs.has(p) && hasMeta(dirs.get(p))) { owner = p; break; } if (p === rootAbs) break; p = path.dirname(p); }
        if (owner) continue;
        // Climb out of variant folders like "Supported", "STL", "32mm", "Parts".
        let m = abs;
        while (m !== rootAbs && VARIANT.test(path.basename(m)) && path.dirname(m) !== rootAbs) m = path.dirname(m);
        if (m === rootAbs) continue;
        modelDirs.add(m);
      }
      if (mode === 'leaf') for (const abs of [...modelDirs]) if (abs === rootAbs) modelDirs.delete(abs);
    }

    const plan = [];
    for (const abs of [...modelDirs].sort()) {
      // Inherit scan-level tags/attributes from this folder and its ancestors (Orynt3D propagation).
      const inherited = { tags: [], attributes: [] };
      for (let p = abs; within(rootAbs, p); p = path.dirname(p)) {
        const c = dirs.get(p)?.config;
        if (c) { inherited.tags.push(...c.scanTags); inherited.attributes.push(...c.scanAttributes); }
        if (p === rootAbs) break;
      }
      const meta = dirs.get(abs)?.config?.meta || {};
      const attributes = [...(meta.attributes || []), ...inherited.attributes];
      const tags = [];
      for (const t of [...(meta.tags || []), ...inherited.tags]) {
        const kv = /^([^:=]{2,30})\s*[:=]\s*(.+)$/.exec(t);
        if (kv && classifyAttr(kv[1])) attributes.push({ key: kv[1].trim(), value: kv[2].trim() });
        else tags.push(t);
      }
      let designer = '';
      const values = [];
      for (const a of attributes) {
        const cls = classifyAttr(a.key);
        if (cls === 'designer') { designer = designer || a.value; continue; }
        values.push({ group: cls || titleCase(a.key), value: a.value });
      }
      for (const c of meta.collections || []) values.push({ group: 'Collection', value: c });
      plan.push({
        path: abs,
        rel: path.relative(rootAbs, abs).split(path.sep).join('/') || '.',
        name: meta.name || niceName(path.basename(abs)),
        notes: meta.notes || '',
        cover: meta.cover || null,
        designer,
        tags: [...new Set(tags.map((t) => t.trim()).filter(Boolean))],
        values,
        orynt3d: dirs.get(abs)?.config?.from === 'orynt3d',
        from: dirs.get(abs)?.config?.from || '',
        sourceUrl: meta.sourceUrl || '',
      });
    }
    const by = (f) => plan.filter((p) => p.from === f).length;
    return { root: rootAbs, count: plan.length, withMetadata: plan.filter((p) => p.from).length, from: { orynt3d: by('orynt3d'), manyfold: by('manyfold'), thingiverse: by('thingiverse') }, configs: [...dirs.values()].filter((i) => i.config).length, plan };
  }

  startScanImport(rootAbs, opts, { label } = {}) {
    const job = { id: crypto.randomUUID(), type: 'scan', label: label || 'Importing existing library', status: 'running', phase: 'scan',
      folders: 0, total: 0, done: 0, added: 0, updated: 0, skipped: 0, current: '', peekTotal: 0, peekDone: 0, errors: [], startedAt: Date.now() };
    this.jobs.set(job.id, job);
    // Remembered so an import interrupted by a restart carries on where it stopped.
    this.setRaw('pendingScan', JSON.stringify({ rootAbs, opts, label: job.label }));
    (async () => {
      try {
        const { plan } = await this.planScan(rootAbs, opts.mode, () => { job.folders++; });
        job.total = plan.length;
        job.phase = 'import';
        const paths = plan.map((p) => p.path);
        const known = new Map(this.db.prepare('SELECT id, path, kinds FROM models').all().map((r) => [r.path, r]));
        // Zipped models whose archive contents haven't been read yet (e.g. a restart during the second pass).
        const unread = (r) => !/,(stl|3mf|obj|step|f3d|scad|blend|ply|gcode|bgcode),/.test(r.kinds) && /,(zip|7z|rar),/.test(r.kinds);
        const peek = [];
        for (const item of plan) {
          job.current = item.name;
          try {
            if (opts.resume && known.has(item.path)) { job.skipped++; if (unread(known.get(item.path))) peek.push(known.get(item.path).id); }
            else { const id = await this.importPlanned(item, opts, paths, job); if (id) peek.push(id); }
          } catch (e) { job.errors.push(`${item.rel}: ${e.message}`); }
          job.done++;
        }
        // Second pass: look inside archives so zipped models get their STL/3MF file types.
        job.phase = 'archives'; job.peekTotal = peek.length;
        for (const id of peek) {
          try { job.current = this.model(id).name; await this.refreshStats(id); } catch { /* model removed meanwhile */ }
          job.peekDone++;
        }
        job.status = 'done';
      } catch (e) { job.status = 'error'; job.errors.push(e.message); }
      job.current = ''; job.finishedAt = Date.now();
      this.setRaw('pendingScan', null);
    })();
    return job;
  }
  setRaw(key, value) {
    if (value === null) this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
    else this.db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
  }
  resumeJobs() {
    const raw = this.db.prepare(`SELECT value FROM settings WHERE key = 'pendingScan'`).get()?.value;
    if (!raw) return;
    try {
      const { rootAbs, opts, label } = JSON.parse(raw);
      console.log(`Resuming the library import of ${rootAbs}`);
      this.startScanImport(rootAbs, { ...opts, resume: true }, { label });
    } catch { this.setRaw('pendingScan', null); }
  }
  listJobs() {
    const now = Date.now();
    return [...this.jobs.values()].filter((j) => j.type && (j.status === 'running' || now - (j.finishedAt || 0) < 120000))
      .map((j) => ({ ...j, errors: j.errors.length, firstError: j.errors[0] || '' }));
  }
  async importPlanned(item, opts, allPaths, job) {
    let dir = item.path;
    const existing = this.db.prepare('SELECT id FROM models WHERE path = ?').get(dir);
    let managed = 0;
    if (!existing && opts.relocate && !allPaths.some((p) => p !== dir && within(dir, p))) {
      const valueIds = item.values.map((v) => this.ensureValue(this.ensureGroup(v.group), v.value));
      const target = await uniquePath(this.targetFolder({ name: item.name, designer: item.designer, values: valueIds }));
      await move(dir, target);
      dir = target; managed = 1;
    }
    const files = await walk(dir);
    // Cover: Orynt3D's own choice first, then the best-looking image/video.
    let coverRel = null;
    if (item.cover) {
      for (const cand of [path.resolve(dir, item.cover), path.resolve(item.path, item.cover)]) {
        const r = path.relative(dir, cand).split(path.sep).join('/');
        if (within(dir, cand) && files.some((f) => f.rel === r)) { coverRel = r; break; }
      }
    }
    coverRel = coverRel || rankCovers(files)[0]?.rel || null;
    if (coverRel && opts.coverMode !== 'none' && !/^cover-/i.test(path.basename(coverRel))) {
      try {
        const from = path.join(dir, coverRel);
        const to = await uniquePath(path.join(dir, `Cover-${safeName(item.name)}${path.extname(from).toLowerCase()}`));
        if (opts.coverMode === 'rename') await move(from, to); else await fsp.copyFile(from, to);
        coverRel = path.basename(to);
      } catch { /* read-only share: keep pointing at the original image */ }
    }
    const quick = await walk(dir);
    const stats = summarize(quick);
    const needsPeek = !quick.some((f) => f.kind === 'model') && quick.some((f) => f.kind === 'archive');
    const valueIds = item.values.map((v) => this.ensureValue(this.ensureGroup(v.group), v.value));
    return tx(this.db, () => {
      if (existing) {
        const id = existing.id;
        this.db.prepare(`UPDATE models SET designer = CASE WHEN designer = '' THEN ? ELSE designer END,
            notes = CASE WHEN notes = '' THEN ? ELSE notes END, cover = COALESCE(cover, ?),
            source_url = CASE WHEN source_url = '' THEN ? ELSE source_url END,
            file_count = ?, size = ?, kinds = ?, updated_at = datetime('now') WHERE id = ?`)
          .run(item.designer, item.notes, coverRel, item.sourceUrl || '', stats.file_count, stats.size, stats.kinds, id);
        this.addValues(id, valueIds);
        this.setTags(id, item.tags, { replace: false });
        job.updated++;
        return needsPeek ? id : null;
      } else {
        const r = this.db.prepare(`INSERT INTO models(name, path, designer, notes, cover, source, managed, file_count, size, kinds, source_url)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(item.name, dir, item.designer, item.notes, coverRel,
          item.from || 'scan', managed, stats.file_count, stats.size, stats.kinds, item.sourceUrl || '');
        const id = Number(r.lastInsertRowid);
        this.addValues(id, valueIds);
        this.setTags(id, item.tags, { replace: false });
        job.added++;
        return needsPeek ? id : null;
      }
    });
  }
}

const VARIANT = /^(pre[-_ ]?supported|presupported|supported|unsupported|un[-_ ]?supported|supports?|no[-_ ]?supports?|stls?|3mf|objs?|step|files?|fdm|resin|lys|chitubox|ctb|parts?|bits|bases?|split|hollow(ed)?|solid|print(ing)?([-_ ]?files)?|models?|meshes|mesh|scaled?|(\d+[-_ ]?mm)|(\d+%)|heroic|heroic scale|fdm[-_ ]?files|resin[-_ ]?files|variants?|options?|extras?|keyed|unkeyed|merged|kit)$/i;

const DESIGNER_KEYS = /^(creator|designer|design(ed)?[-_ ]?by|artist|author|sculptor|sculpted[-_ ]?by|studio|publisher|maker|by|brand|patreon)$/i;
const SYNONYMS = { type: 'Type', category: 'Type', kind: 'Type', franchise: 'Franchise', ip: 'Franchise', universe: 'Franchise', series: 'Franchise', fandom: 'Franchise', 'print type': 'Print Type', technology: 'Print Type', printer: 'Print Type', status: 'Status' };
function classifyAttr(key) {
  const k = String(key).trim();
  if (DESIGNER_KEYS.test(k)) return 'designer';
  return SYNONYMS[k.toLowerCase()] || null;
}
function titleCase(s) { return String(s).trim().replace(/\b\w/g, (c) => c.toUpperCase()); }

const stripHtml = (t) => String(t || '').replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n').trim();
/** Manyfold's datapackage.json (Frictionless Data): title, description, keywords, creator, licence, link. */
export function manyfoldMeta(j) {
  if (!j || typeof j !== 'object' || !(j.title || j.name) || !Array.isArray(j.resources)) return null;
  const people = Array.isArray(j.contributors) ? j.contributors : [];
  const creator = people.find((c) => !c?.roles || c.roles.some((r) => /creator|author|designer|sculptor/i.test(r))) || people[0];
  const attributes = [];
  if (creator?.title) attributes.push({ key: 'Designer', value: String(creator.title) });
  const lic = Array.isArray(j.licenses) ? j.licenses[0] : null;
  if (lic?.title || lic?.name) attributes.push({ key: 'License', value: String(lic.title || lic.name) });
  const preview = j.resources.find((r) => /preview|image/i.test(r?.role || '') || /^image\//.test(r?.mediatype || ''));
  return { meta: { name: j.title || niceName(j.name), notes: stripHtml(j.description), tags: arr(j.keywords), cover: preview?.path || null, collections: [], attributes, sourceUrl: typeof j.homepage === 'string' ? j.homepage : '' }, scanTags: [], scanAttributes: [], isModel: true, from: 'manyfold' };
}
/** Thingiverse's README.txt: "<name> by <designer> on Thingiverse: <link>", then a Summary. */
export function thingiverseMeta(text) {
  text = String(text || '').replace(/\r/g, '');
  const m = /^\s*(.+?) by (.+?) on Thingiverse:\s*(https?:\/\/\S+)/m.exec(text || '');
  if (!m) return null;
  const sum = /(?:^|\n)\s*Summary:?\s*\n(?:[-=]+\s*\n)?([\s\S]*?)(?=\n\s*\n\s*(?:Print Settings|Post-Printing|How I Designed This|Custom Section|Instructions)\b|$)/i.exec(text);
  const lic = /licensed under the (.+?) license/i.exec(text);
  const attributes = [{ key: 'Designer', value: m[2].trim() }];
  if (lic) attributes.push({ key: 'License', value: lic[1].trim() });
  return { meta: { name: m[1].trim(), notes: (sum?.[1] || '').trim().slice(0, 4000), tags: [], cover: null, collections: [], attributes, sourceUrl: m[3] }, scanTags: [], scanAttributes: [], isModel: true, from: 'thingiverse' };
}

/** Accept every known Orynt3D manifest version (v1 user.json → v5 config.orynt3d). */
export function normalizeManifest(j) {
  const out = { meta: {}, scanTags: [], scanAttributes: [], isModel: false };
  if (!j || typeof j !== 'object') return out;
  if (!('version' in j) && !('modelmeta' in j) && ('include' in j || 'notes' in j)) {
    out.scanTags = arr(j.include);
    out.meta.notes = j.notes || '';
  } else {
    const sc = j.scancfg || {}, mm = j.modelmeta || {};
    out.scanTags = Array.isArray(sc.tags?.include) ? arr(sc.tags.include) : arr(sc.include);
    out.scanAttributes = attrs(sc.attributes?.include);
    out.meta = { name: mm.name || null, notes: mm.notes || '', tags: arr(mm.tags), cover: mm.cover || null, collections: arr(mm.collections), attributes: attrs(mm.attributes) };
  }
  const m = out.meta;
  out.isModel = !!(m.name || m.cover || (m.tags && m.tags.length) || (m.attributes && m.attributes.length) || (m.collections && m.collections.length) || m.notes);
  return out;
}
const arr = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x.trim()) : []);
const attrs = (a) => (Array.isArray(a) ? a.filter((x) => x && x.key && x.value).map((x) => ({ key: String(x.key), value: String(x.value) })) : []);
export function encodePath(rel) { return String(rel).split('/').map(encodeURIComponent).join('/'); }
