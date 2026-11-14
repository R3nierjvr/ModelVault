// Possible double models. Every archive (and loose 3D file) added to the library is remembered with the name it had
// when it was downloaded and its exact size, so a download that comes again (shared model posts often reuse the same
// archive name) is flagged even after the copy in the library was renamed. Archives already in the library are
// added to the record too, so renamed ones still match by size.
import path from 'node:path';
import { fsp, isArchiveLike, kindOf } from './files.js';
import { cleanName } from './guess.js';

const MIN_SAME = 256 * 1024; // smaller files can share a size by chance
const ENDINGS = /(\.(zip|7z|rar|tar|gz|tgz|stl|3mf|obj|step|stp|lys|chitubox|ctb|part\d+|\d{3}|[zr]\d{2}))+$/i;

/** "Some_Model (v2).part1.rar" → "somemodelv2": the name without endings, case or punctuation. */
export function normName(name) { return String(name || '').toLowerCase().replace(ENDINGS, '').replace(/[^\p{L}\p{N}]+/gu, ''); }
/** The model a file name describes, without designer tags, scales, "supported" and the like. */
function normModel(name) { return normName(cleanName(String(name || '').replace(ENDINGS, ''))) || normName(name); }
const remembered = (name) => isArchiveLike(name) || kindOf(name) === 'model';

export class History {
  constructor(lib) {
    this.lib = lib;
    const db = lib.db;
    db.exec(`CREATE TABLE IF NOT EXISTS download_history (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, norm TEXT NOT NULL, clean TEXT NOT NULL, size INTEGER NOT NULL,
      model_id INTEGER, model_name TEXT NOT NULL, added_at INTEGER NOT NULL, how TEXT NOT NULL DEFAULT 'import')`);
    db.exec('CREATE INDEX IF NOT EXISTS download_history_norm ON download_history(norm)');
    db.exec('CREATE INDEX IF NOT EXISTS download_history_size ON download_history(size)');
    db.exec('CREATE INDEX IF NOT EXISTS download_history_clean ON download_history(clean)');
    db.exec('CREATE TABLE IF NOT EXISTS download_history_seeded (model_id INTEGER PRIMARY KEY)');
    this.names = null;
  }

  /** Remember the files a model was added from (their names as downloaded). */
  record(modelId, modelName, files, how = 'import') {
    const ins = this.lib.db.prepare('INSERT INTO download_history(name, norm, clean, size, model_id, model_name, added_at, how) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const has = this.lib.db.prepare('SELECT 1 FROM download_history WHERE model_id = ? AND norm = ? AND size = ?');
    for (const f of files) {
      const name = path.basename(String(f.name || ''));
      if (!name || !remembered(name) || !(f.size > 0)) continue;
      if (has.get(modelId, normName(name), f.size)) continue;
      ins.run(name, normName(name), normModel(name), f.size, modelId, modelName, Date.now(), how);
    }
    this.names = null;
  }

  /** Archives and 3D files already in the library, for models added before the record existed. Runs in the background. */
  async seedMissing() {
    if (this.seeding) return;
    this.seeding = true;
    try {
      const db = this.lib.db;
      const todo = db.prepare('SELECT id, name, path FROM models WHERE id NOT IN (SELECT model_id FROM download_history_seeded)').all();
      for (const m of todo) {
        // Archives anywhere (a few folders deep); loose 3D files only at the top, where downloaded ones end up.
        // Only those files are measured, and there's a pause between models, so the NAS stays responsive.
        const files = await this.downloadsIn(m.path).catch(() => []);
        this.record(m.id, m.name, files, 'library');
        db.prepare('INSERT OR IGNORE INTO download_history_seeded(model_id) VALUES (?)').run(m.id);
        await new Promise((r) => setTimeout(r, 150));
      }
    } finally { this.seeding = false; }
  }

  async downloadsIn(root, depth = 3) {
    const out = [];
    const rec = async (dir, rel, level) => {
      let ents;
      try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (e.name.startsWith('.')) continue;
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) { if (level < depth) await rec(abs, `${rel}${e.name}/`, level + 1); continue; }
        if (!(isArchiveLike(e.name) || (level === 0 && kindOf(e.name) === 'model'))) continue;
        const st = await fsp.stat(abs).catch(() => null);
        if (st) out.push({ name: `${rel}${e.name}`, size: st.size });
      }
    };
    await rec(root, '', 0);
    return out;
  }

  modelNames() {
    if (!this.names || Date.now() - this.names.at > 30000) {
      const map = new Map();
      for (const m of this.lib.db.prepare('SELECT id, name FROM models').all()) {
        for (const k of new Set([normName(m.name), normModel(m.name)])) if (k.length >= 4 && !map.has(k)) map.set(k, m);
      }
      this.names = { at: Date.now(), map };
    }
    return this.names.map;
  }

  /**
   * How likely each download is to be in the library already. items: [{ name, size, type }].
   * Returns, per item, null or { level, why, model: { id, name, exists }, file }:
   *   same     same size as a file added before (with the same name, or renamed since)
   *   name     same name as a file added before, but another size (a new version?)
   *   similar  a model with this name is in the library
   */
  check(items) {
    const db = this.lib.db;
    const bySize = db.prepare('SELECT * FROM download_history WHERE size = ? ORDER BY added_at DESC LIMIT 20');
    const byNorm = db.prepare('SELECT * FROM download_history WHERE norm = ? ORDER BY added_at DESC LIMIT 5');
    const byClean = db.prepare('SELECT * FROM download_history WHERE clean = ? ORDER BY added_at DESC LIMIT 5');
    const alive = db.prepare('SELECT id, name FROM models WHERE id = ?');
    const names = this.modelNames();
    const modelOf = (row) => { const m = row.model_id && alive.get(row.model_id); return m ? { id: m.id, name: m.name, exists: true } : { id: null, name: row.model_name, exists: false }; };
    return items.map((it) => {
      const name = path.basename(String(it.name || ''));
      const isFile = it.type !== 'dir';
      if (isFile && !remembered(name)) return null;
      const norm = normName(name), clean = normModel(name);
      if (isFile && it.size >= MIN_SAME) {
        const rows = bySize.all(it.size);
        const row = rows.find((r) => r.norm === norm) || rows.find((r) => r.clean === clean && clean.length >= 4) || (isArchiveLike(name) ? rows.find((r) => isArchiveLike(r.name)) : null);
        if (row) {
          const model = modelOf(row);
          return { level: 'same', model, file: row.name, why: row.norm === norm ? `Added before${model.exists ? ` to ${model.name}` : ` (${model.name}, removed since)`}: same name and size.` : `Same size as ${row.name}${model.exists ? ` in ${model.name}` : ` (${model.name}, removed since)`}, so it's probably the same file renamed.` };
        }
      }
      if (norm.length >= 4) {
        const row = byNorm.get(norm) || (clean.length >= 4 ? byClean.get(clean) : null);
        if (row) {
          const model = modelOf(row);
          const where = model.exists ? ` to ${model.name}` : ` (${model.name}, removed since)`;
          return { level: 'name', model, file: row.name, why: row.norm === norm
            ? `A download called ${row.name} was added${where}, but this one is a different size. It could be a new version or another part.`
            : `${row.name}, with a similar name, was added${where}. Check whether this is the same model.` };
        }
      }
      const m = names.get(clean) || names.get(norm);
      if (m) return { level: 'similar', model: { id: m.id, name: m.name, exists: true }, file: null, why: `You already have a model called ${m.name}.` };
      return null;
    });
  }
}
