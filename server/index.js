import express from 'express';
import busboy from 'busboy';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { Library, renderTemplate } from './library.js';
import { Backups, applyPendingRestore, backupName } from './backup.js';
import { Updater } from './update.js';
import { sniffMedia, fsp, kindOf, resolveInside, httpError, within, exists, zipStream, safeName, ignored, isArchive, isMedia, uniquePath, move, isArchiveLike, listArchive, streamArchiveEntry, rmQuiet } from './files.js';
import { Watcher } from './watch.js';
import { Locations } from './locations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STARTED = new Date().toISOString();
const env = process.env;
const VERSION = '1.01';
// Windows writes ModelVault's output to a log file when it runs in the background: give each line the time.
if (env.MV_LOG_TIMES === '1') {
  for (const k of ['log', 'info', 'warn', 'error']) {
    const orig = console[k].bind(console);
    console[k] = (...a) => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); orig(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`, ...a); };
  }
}
const DATA_DIR = path.resolve(env.DATA_DIR || '/data');
const WIN = process.platform === 'win32';
// Windows: library and downloads folders chosen in Settings (saved in the data folder) win over settings.cmd.
const PATHS_FILE = path.join(DATA_DIR, 'paths.json');
// A backup chosen in Settings is put in place before the folders are read and the database opens.
let restored = null;
try { restored = applyPendingRestore(DATA_DIR); if (restored) console.log(`Restored a backup from ${restored.from}: ${restored.moved} models pointed at this install's folders`); }
catch (e) { console.error('Restoring the backup failed:', e.message); }
let chosen = {};
if (WIN) { try { chosen = JSON.parse(fs.readFileSync(PATHS_FILE, 'utf8')); } catch { chosen = {}; } }
const roots = { library: path.resolve(chosen.library || env.LIBRARY_DIR || '/library'), downloads: path.resolve(chosen.downloads || env.DOWNLOADS_DIR || '/downloads') };
// Extra folders to browse/import from, e.g. EXTRA_DIRS="orynt3d=/orynt3d,nas=/volume1/3d"
for (const pair of String(env.EXTRA_DIRS || '').split(',').map((s) => s.trim()).filter(Boolean)) {
  const [k, v] = pair.includes('=') ? pair.split('=') : [path.basename(pair), pair];
  roots[safeName(k).toLowerCase()] = path.resolve(v);
}
for (const r of Object.values(roots)) { try { fs.mkdirSync(r, { recursive: true }); } catch (e) { console.error(`Can't open ${r}: ${e.message}`); } } // a network folder may be offline
// A "Downloads" folder inside the library share becomes the downloads location: moving from it into the
// library is then instant, because both sit on the same disk. The original downloads folder stays available.
{
  const inLibrary = fs.readdirSync(roots.library, { withFileTypes: true }).find((e) => e.isDirectory() && e.name.toLowerCase() === 'downloads');
  if (inLibrary) { roots['downloads-old'] = roots.downloads; roots.downloads = path.join(roots.library, inLibrary.name); }
}

const db = openDb(DATA_DIR);
const lib = new Library(db, { dataDir: DATA_DIR, roots });
await lib.init();
const watcher = new Watcher(lib);
watcher.start();
// Network folders added in Settings reconnect first, then an interrupted import can carry on.
const locations = new Locations(lib, roots, DATA_DIR);
lib.netPaths = () => Object.fromEntries(locations.publicList().map((l) => [l.key, l.path]));
locations.boot().catch((e) => console.error('network folders', e.message)).finally(() => lib.resumeJobs());
const backups = new Backups(lib, { dataDir: DATA_DIR, roots, version: VERSION, locations,
  labels: () => ({ library: 'Library', downloads: 'Downloads', ...Object.fromEntries(locations.saved().map((l) => [l.key, l.label])) }) });

const app = express();
app.disable('x-powered-by');

// For the Windows tray icon: is ModelVault running, and which version? (Answers even when a login is set.)
app.get('/api/ping', (req, res) => res.set('Cache-Control', 'no-store').json({ app: 'ModelVault', version: VERSION, startedAt: STARTED }));

// Optional login: set APP_PASSWORD (and optionally APP_USER) in the container environment.
if (env.APP_PASSWORD) {
  const user = env.APP_USER || 'admin';
  const expected = Buffer.from(`${user}:${env.APP_PASSWORD}`);
  app.use((req, res, next) => {
    if (req.path.startsWith('/s/') || req.path.startsWith('/z/')) return next(); // signed slicer links carry their own token
    const h = req.headers.authorization || '';
    const got = h.startsWith('Basic ') ? Buffer.from(h.slice(6), 'base64') : Buffer.alloc(0);
    if (got.length === expected.length && crypto.timingSafeEqual(got, expected)) return next();
    res.set('WWW-Authenticate', 'Basic realm="ModelVault"').status(401).send('Login required');
  });
}

const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const rootOf = (key) => { const r = roots[key]; if (!r) throw httpError(400, `Unknown folder "${key}"`); return r; };
const json = express.json({ limit: '2mb' });

/** Stream multipart files to `dir`. Returns { fields, files:[{name, path, size}] }. */
function receiveFiles(req, dir, { maxFiles = 500 } = {}) {
  return new Promise((resolve, reject) => {
    const fields = {}, files = [], writes = [];
    let bb;
    try { bb = busboy({ headers: req.headers, limits: { files: maxFiles, fileSize: 50 * 1024 ** 3 }, defParamCharset: 'utf8' }); }
    catch (e) { return reject(httpError(400, 'Expected a file upload')); }
    bb.on('field', (k, v) => { fields[k] = v; });
    bb.on('file', (_name, stream, info) => {
      const clean = safeName(path.basename(String(info.filename || 'file').replace(/\\/g, '/')), 'file');
      const target = path.join(dir, `${crypto.randomUUID().slice(0, 8)}__${clean}`);
      const out = fs.createWriteStream(target);
      let size = 0;
      stream.on('data', (c) => { size += c.length; });
      writes.push(new Promise((res2, rej2) => { out.on('finish', () => res2({ name: clean, path: target, size })); out.on('error', rej2); stream.on('error', rej2); }));
      stream.pipe(out);
    });
    bb.on('error', reject);
    bb.on('close', () => Promise.all(writes).then((f) => { files.push(...f); resolve({ fields, files }); }, reject));
    req.pipe(bb);
  });
}

// ---------------- about and updates ----------------
const isIdle = () => ![...lib.drafts.values()].some((d) => d.status === 'processing') && ![...lib.jobs.values()].some((j) => j.status === 'running');
const updater = new Updater({ version: VERSION, root: ROOT, dataDir: DATA_DIR, lib, idle: isIdle, repo: env.UPDATE_REPO || 'R3nierjvr/ModelVault' });
updater.schedule();
app.get('/api/update', h(async (req, res) => res.json(updater.status())));
app.post('/api/update/check', h(async (req, res) => res.json(await updater.check())));
app.post('/api/update/install', h(async (req, res) => res.json(await updater.install())));
app.put('/api/update/token', json, h(async (req, res) => { await updater.setToken(req.body?.token); res.json(await updater.check()); }));
app.get('/api/about', h(async (req, res) => {
  const n = (sql) => { try { return db.prepare(sql).get().n; } catch { return 0; } };
  res.json({
    version: VERSION, kind: updater.kind, node: process.version, platform: process.platform, repo: updater.repo,
    dataDir: DATA_DIR, folders: Object.fromEntries(Object.entries(roots).filter(([, v]) => v)),
    counts: { models: n('SELECT COUNT(*) AS n FROM models'), designers: n("SELECT COUNT(DISTINCT designer) AS n FROM models WHERE designer <> ''"), tags: n('SELECT COUNT(*) AS n FROM tags'), customPaints: n('SELECT COUNT(*) AS n FROM custom_paints') },
    startedAt: STARTED,
  });
}));

// ---------------- opening ModelVault on a tablet or phone (Settings > Tailscale) ----------------
// This computer's network addresses, and its Tailscale name when Tailscale runs on the same computer.
const isTailscaleIp = (ip) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);
function tailscaleStatus() {
  const bins = process.platform === 'win32'
    ? ['tailscale.exe', path.join(env.ProgramFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe')]
    : ['tailscale', '/usr/bin/tailscale', '/usr/local/bin/tailscale'];
  return new Promise((resolve) => {
    const next = (i) => {
      if (i >= bins.length) return resolve(null);
      execFile(bins[i], ['status', '--json'], { timeout: 4000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
        if (err) return next(i + 1);
        try {
          const j = JSON.parse(out), self = j.Self || {};
          resolve({ name: String(self.DNSName || '').replace(/\.$/, ''), host: self.HostName || '', ips: (self.TailscaleIPs || []).filter((x) => x.includes('.')), running: j.BackendState === 'Running' });
        } catch { resolve(null); }
      });
    };
    next(0);
  });
}
app.get('/api/addresses', h(async (req, res) => {
  const docker = updater.kind === 'docker';
  const addresses = [];
  if (!docker) {
    for (const [name, list] of Object.entries(os.networkInterfaces())) {
      for (const a of list || []) {
        if (a.internal || a.family !== 'IPv4' || a.address.startsWith('169.254.')) continue;
        addresses.push({ address: a.address, adapter: name, tailscale: isTailscaleIp(a.address) || /tailscale/i.test(name) });
      }
    }
  }
  res.json({ port, docker, platform: process.platform, addresses, tailscale: docker ? null : await tailscaleStatus() });
}));

// ---------------- backups and restoring ----------------
app.get('/api/backup/estimate', h(async (req, res) => res.json(await backups.estimate())));
app.get('/api/backup/download', h(async (req, res) => {
  const full = req.query.full === '1';
  const name = backupName(full);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.setHeader('Cache-Control', 'no-store');
  try { await backups.write(res, { full }); res.end(); } catch (e) { console.error('backup download', e.message); res.destroy(e); }
}));
app.post('/api/backup/save', json, h(async (req, res) => res.json(backups.startSave({ full: !!req.body?.full, root: String(req.body?.root || 'library') }))));
app.get('/api/backup/list', h(async (req, res) => res.json({ list: await backups.list(), roots: Object.keys(roots) })));
// Restore: a backup is uploaded (or picked from a folder), looked at, then restored with the chosen folders.
const restoreFiles = new Map(); // token → { file, uploaded }
app.post('/api/restore/upload', h(async (req, res) => {
  const dir = path.join(DATA_DIR, 'restore', 'uploads');
  await fsp.mkdir(dir, { recursive: true });
  const { files } = await receiveFiles(req, dir, { maxFiles: 1 });
  if (!files[0]) throw httpError(400, 'Choose a backup file');
  let info;
  try { info = await backups.inspect(files[0].path); } catch (e) { await rmQuiet(files[0].path); throw e; }
  const token = crypto.randomUUID();
  restoreFiles.set(token, { file: files[0].path, uploaded: true });
  res.json({ token, name: files[0].name, size: files[0].size, ...info });
}));
app.post('/api/restore/inspect', json, h(async (req, res) => {
  const abs = await resolveInside(rootOf(String(req.body?.root || '')), String(req.body?.path || ''));
  const info = await backups.inspect(abs);
  const token = crypto.randomUUID();
  restoreFiles.set(token, { file: abs, uploaded: false });
  res.json({ token, name: path.basename(abs), size: (await fsp.stat(abs)).size, ...info });
}));
app.post('/api/restore/apply', json, h(async (req, res) => {
  const t = restoreFiles.get(String(req.body?.token || ''));
  if (!t) throw httpError(400, 'Choose the backup again.');
  res.json(backups.startRestore(t.file, { files: req.body?.files !== false, removeAfter: t.uploaded }));
}));
app.post('/api/restore/finish', h(async (req, res) => {
  if (!fs.existsSync(path.join(DATA_DIR, 'restore', 'next', 'plan.json'))) throw httpError(400, 'No restore is waiting.');
  res.json({ restarting: true });
  // Docker and the Windows launcher start ModelVault again; the backup is put in place as it starts.
  setTimeout(() => process.exit(0), 800);
}));
app.get('/api/restore/last', h(async (req, res) => {
  try { res.json(JSON.parse(await fsp.readFile(path.join(DATA_DIR, 'last-restore.json'), 'utf8'))); } catch { res.json(null); }
}));

// ---------------- meta ----------------
app.get('/api/meta', (req, res) => {
  const labels = Object.fromEntries(locations.saved().map((l) => [l.key, l.label]));
  const netPaths = Object.fromEntries(locations.publicList().map((l) => [l.key, l.path]));
  res.json({ version: VERSION, platform: process.platform, update: updater.status().available ? { latest: updater.status().latest } : null, rootLabels: labels, netPaths, groups: lib.groups(), designers: lib.designers(), tags: lib.tags(), settings: lib.settings(), roots: Object.keys(roots), rootPaths: Object.fromEntries(Object.entries(roots).filter(([, v]) => v)) });
});
app.put('/api/settings', json, (req, res) => {
  const s = req.body || {};
  if (s.folderPattern !== undefined) {
    const p = String(s.folderPattern).trim();
    if (!p || p.includes('..') || p.startsWith('/') || p.split('/').length > 6) throw httpError(400, 'Folder name format is not valid');
  }
  if (s.pcPaths !== undefined) {
    let v = s.pcPaths;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { throw httpError(400, 'Folder paths are not valid'); } }
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw httpError(400, 'Folder paths are not valid');
    s.pcPaths = JSON.stringify(Object.fromEntries(Object.entries(v).filter(([k, x]) => roots[k] && typeof x === 'string').map(([k, x]) => [k, x.trim().slice(0, 500)])));
  }
  if (s.optimizeStrength !== undefined && !['balanced', 'smaller', 'lossless'].includes(String(s.optimizeStrength))) s.optimizeStrength = 'balanced';
  if (s.displayFormat !== undefined) s.displayFormat = String(s.displayFormat).trim().slice(0, 200) || '{name}';
  if (s.tailscaleAddress !== undefined) s.tailscaleAddress = String(s.tailscaleAddress).replace(/[\s<>"']+/g, '').slice(0, 300);
  if (s.archiveFormat !== undefined) {
    s.archiveFormat = String(s.archiveFormat).replace(/[\\/]+/g, ' ').trim().slice(0, 200);
    if (!s.archiveFormat) throw httpError(400, 'Archive name format is empty');
  }
  if (s.archiveParts !== undefined) {
    let v = s.archiveParts;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { throw httpError(400, 'Archive parts are not valid'); } }
    if (!Array.isArray(v)) throw httpError(400, 'Archive parts are not valid');
    s.archiveParts = JSON.stringify(v.map((p) => ({ label: String(p?.label || '').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 40), words: String(p?.words || '').slice(0, 400) })).filter((p) => p.label).slice(0, 60));
  }
  if (s.watchFolders !== undefined) {
    for (const spec of String(s.watchFolders).split(',').map((x) => x.trim()).filter(Boolean)) {
      const root = spec.replace(/\\/g, '/').split('/')[0].toLowerCase();
      if (!roots[root] || spec.includes('..')) throw httpError(400, `"${spec}" is not inside a folder ModelVault can see. Start it with one of: ${Object.keys(roots).join(', ')}`);
    }
  }
  setTimeout(() => watcher.tick().catch(() => {}), 50);
  res.json(lib.saveSettings(s));
});

// ---------------- paints you added yourself (the catalogue is public/paints/paints.json) ----------------
db.exec(`CREATE TABLE IF NOT EXISTS custom_paints (id INTEGER PRIMARY KEY, brand TEXT NOT NULL, range TEXT NOT NULL DEFAULT '', name TEXT NOT NULL,
  code TEXT NOT NULL DEFAULT '', hex TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'Acrylic', kind TEXT NOT NULL DEFAULT 'Paint', metallic INTEGER NOT NULL DEFAULT 0,
  how TEXT NOT NULL DEFAULT '["Brush"]', created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
const PAINT_HOW = ['Brush', 'Airbrush', 'Spray', 'Drybrush', 'Dip'];
function paintBody(b = {}) {
  const t = (v, n) => String(v ?? '').trim().slice(0, n);
  const p = { brand: t(b.brand, 80), range: t(b.range, 80), name: t(b.name, 120), code: t(b.code, 40), hex: t(b.hex, 7).toUpperCase(), type: t(b.type, 30) || 'Acrylic', kind: t(b.kind, 30) || 'Paint', metallic: b.metallic ? 1 : 0,
    how: JSON.stringify((Array.isArray(b.how) ? b.how : []).filter((x) => PAINT_HOW.includes(x))) };
  if (!p.brand || !p.name) throw httpError(400, 'A paint needs a brand and a name.');
  if (!/^#[0-9A-F]{6}$/.test(p.hex)) throw httpError(400, 'Pick the paint\'s colour.');
  return p;
}
const paintOut = (r) => ({ ...r, metallic: !!r.metallic, how: JSON.parse(r.how || '[]') });
app.get('/api/paints/custom', (req, res) => res.json(db.prepare('SELECT * FROM custom_paints ORDER BY brand, name').all().map(paintOut)));
app.post('/api/paints/custom', json, h(async (req, res) => {
  const p = paintBody(req.body);
  const r = db.prepare('INSERT INTO custom_paints(brand, range, name, code, hex, type, kind, metallic, how) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(p.brand, p.range, p.name, p.code, p.hex, p.type, p.kind, p.metallic, p.how);
  res.json(paintOut(db.prepare('SELECT * FROM custom_paints WHERE id = ?').get(Number(r.lastInsertRowid))));
}));
app.put('/api/paints/custom/:id', json, h(async (req, res) => {
  const p = paintBody(req.body);
  const r = db.prepare('UPDATE custom_paints SET brand = ?, range = ?, name = ?, code = ?, hex = ?, type = ?, kind = ?, metallic = ?, how = ? WHERE id = ?').run(p.brand, p.range, p.name, p.code, p.hex, p.type, p.kind, p.metallic, p.how, Number(req.params.id));
  if (!r.changes) throw httpError(404, 'Paint not found');
  res.json(paintOut(db.prepare('SELECT * FROM custom_paints WHERE id = ?').get(Number(req.params.id))));
}));
// Many at once (for a whole range such as AMMO Atom): shared brand, range and type, one line per paint.
app.post('/api/paints/custom/bulk', json, h(async (req, res) => {
  const shared = req.body?.shared || {};
  const items = (Array.isArray(req.body?.items) ? req.body.items : []).slice(0, 2000).map((it) => paintBody({ ...shared, ...it }));
  if (!items.length) throw httpError(400, 'No paints to add.');
  const ins = db.prepare('INSERT INTO custom_paints(brand, range, name, code, hex, type, kind, metallic, how) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const ids = [];
  db.exec('BEGIN');
  try { for (const p of items) ids.push(Number(ins.run(p.brand, p.range, p.name, p.code, p.hex, p.type, p.kind, p.metallic, p.how).lastInsertRowid)); db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); throw e; }
  res.json(ids.map((id) => paintOut(db.prepare('SELECT * FROM custom_paints WHERE id = ?').get(id))));
}));
// Your own paint records, each kept as one JSON document: paints you own (with rack slots), the shopping list,
// racks, paint lists, and a paint scheme per model ("scheme:<model id>").
db.exec('CREATE TABLE IF NOT EXISTS paint_docs (key TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');
const DOC_KEY = /^(owned|shopping|racks|lists|materials|tools|scheme:\d+)$/;
app.get('/api/paint-docs', (req, res) => {
  const keys = String(req.query.keys || '').split(',').filter((k) => DOC_KEY.test(k));
  const out = {};
  for (const k of keys) { const r = db.prepare('SELECT json FROM paint_docs WHERE key = ?').get(k); out[k] = r ? JSON.parse(r.json) : null; }
  res.json(out);
});
app.get('/api/paint-docs/schemes', (req, res) => res.json(Object.fromEntries(db.prepare("SELECT key, json FROM paint_docs WHERE key LIKE 'scheme:%'").all().map((r) => [r.key.slice(7), JSON.parse(r.json)]))));
app.put('/api/paint-docs/:key', express.json({ limit: '4mb' }), h(async (req, res) => {
  const key = req.params.key;
  if (!DOC_KEY.test(key)) throw httpError(400, 'Unknown paint record.');
  if (req.body?.value == null) { db.prepare('DELETE FROM paint_docs WHERE key = ?').run(key); return res.json({ ok: true }); }
  db.prepare("INSERT INTO paint_docs(key, json, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at").run(key, JSON.stringify(req.body.value));
  res.json({ ok: true });
}));

// Your verdict on a match between two paints: 1 = good match (shown first), -1 = not a match (hidden).
db.exec('CREATE TABLE IF NOT EXISTS paint_votes (a TEXT NOT NULL, b TEXT NOT NULL, vote INTEGER NOT NULL, PRIMARY KEY (a, b))');
app.get('/api/paints/votes', (req, res) => res.json(db.prepare('SELECT a, b, vote FROM paint_votes').all()));
app.put('/api/paints/votes', json, h(async (req, res) => {
  const [a, b] = [String(req.body?.a || ''), String(req.body?.b || '')].sort();
  const vote = Math.sign(Number(req.body?.vote) || 0);
  if (!a || !b || a === b) throw httpError(400, 'Two paints are needed.');
  if (vote) db.prepare('INSERT INTO paint_votes(a, b, vote) VALUES (?, ?, ?) ON CONFLICT(a, b) DO UPDATE SET vote = excluded.vote').run(a, b, vote);
  else db.prepare('DELETE FROM paint_votes WHERE a = ? AND b = ?').run(a, b);
  res.json({ a, b, vote });
}));
app.delete('/api/paints/custom/:id', h(async (req, res) => { db.prepare('DELETE FROM custom_paints WHERE id = ?').run(Number(req.params.id)); res.json({ ok: true }); }));

// ---------------- pasted picture links ----------------
// A copied picture link (from a web page) is downloaded here, because the browser usually isn't allowed to read other sites.
app.post('/api/fetch-image', json, h(async (req, res) => {
  let url;
  try { url = new URL(String(req.body?.url || '')); } catch { throw httpError(400, 'That isn\'t a link.'); }
  if (!/^https?:$/.test(url.protocol)) throw httpError(400, 'Only http and https links can be downloaded.');
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 30000);
  try {
    let r;
    try { r = await fetch(url, { signal: ac.signal, redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 ModelVault', accept: 'image/*,*/*;q=0.5' } }); }
    catch { throw httpError(502, 'The picture\'s website couldn\'t be reached.'); }
    if (!r.ok) throw httpError(502, `The picture's website answered ${r.status}.`);
    const type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const LIMIT = 50 * 1024 * 1024;
    if (Number(r.headers.get('content-length') || 0) > LIMIT) throw httpError(413, 'That picture is over 50 MB.');
    const chunks = []; let size = 0;
    for await (const c of r.body) { size += c.length; if (size > LIMIT) throw httpError(413, 'That picture is over 50 MB.'); chunks.push(c); }
    const buf = Buffer.concat(chunks);
    const tmp = path.join(lib.stagingDir, `.fetch-${crypto.randomUUID()}`);
    await fsp.mkdir(lib.stagingDir, { recursive: true });
    await fsp.writeFile(tmp, buf);
    const sniff = await sniffMedia(tmp).catch(() => null);
    await fsp.rm(tmp, { force: true });
    if (sniff?.kind !== 'image' && !/^image\//.test(type)) throw httpError(400, 'That link isn\'t a picture.');
    const ext = sniff?.ext || `.${(type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')}`;
    const base = safeName(decodeURIComponent(path.basename(url.pathname)).replace(/\.[^.]+$/, '')).slice(0, 80) || 'Pasted picture';
    res.set('content-type', sniff?.mime || (/^image\//.test(type) ? type : 'image/jpeg'));
    res.set('x-file-name', encodeURIComponent(`${base}${ext}`));
    res.send(buf);
  } finally { clearTimeout(t); }
}));

// ---------------- picture optimizer ----------------
app.get('/api/images/estimate', h(async (req, res) => res.json(await lib.images.estimate())));
app.get('/api/images/stats', (req, res) => res.json(lib.images.stats()));
app.post('/api/images/optimize', json, (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : null;
  res.json(lib.images.start(ids && ids.length ? ids : null));
});

// ---------------- archive names ----------------
app.get('/api/models/:id/archives', h(async (req, res) => res.json(await lib.archivePlan(req.params.id))));
app.post('/api/models/:id/archives', json, h(async (req, res) => {
  const items = req.body?.items;
  if (!items || typeof items !== 'object') throw httpError(400, 'Nothing to rename');
  const renamed = await lib.nameArchives(req.params.id, items);
  await lib.refreshStats(Number(req.params.id));
  res.json({ renamed, ...(await lib.archivePlan(req.params.id)) });
}));
app.post('/api/models/:id/archives/preview', json, h(async (req, res) => res.json(await lib.archivePreview(req.params.id, req.body?.items || {}, req.body?.as || null))));
app.post('/api/archives/teach', json, (req, res) => res.json(lib.teachArchiveWord(req.body?.word, req.body?.label)));
// Example names for Settings, using the format and parts typed there (before they're saved).
app.post('/api/archives/preview', json, (req, res) => {
  const { format = '', parts } = req.body || {};
  const list = Array.isArray(parts) ? lib.archiveParts(parts) : lib.archiveParts();
  const m = { name: 'Ancient Dragon', designer: 'Example Studio', year: 2026, vals: [] };
  const fmt = String(format).replace(/[\\/]+/g, ' ').trim() || '{name}';
  const samples = ['Dragon_bust_1-6_presupported.zip', 'Dragon x-pose 1_10.7z', 'Dragon renders.zip', 'Dragon-75mm.rar'];
  res.json({ examples: samples.map((f) => {
    const ext = /\.[^.]+$/.exec(f)[0];
    return { from: f, to: `${lib.archiveBase(m, lib.detectArchive(f.slice(0, -ext.length), { ignore: m.name, parts: list }), fmt)}${ext}` };
  }) });
});

// ---------------- categories ----------------
app.post('/api/groups', json, (req, res) => res.json({ id: lib.ensureGroup(req.body?.name) }));
app.patch('/api/groups/:id', json, (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) throw httpError(400, 'Name is required');
  db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(name, Number(req.params.id));
  res.json({ ok: true });
});
app.delete('/api/groups/:id', (req, res) => {
  const g = db.prepare('SELECT builtin FROM groups WHERE id = ?').get(Number(req.params.id));
  if (!g) throw httpError(404, 'Category not found');
  if (g.builtin) throw httpError(400, 'Built-in categories can be renamed but not deleted');
  db.prepare('DELETE FROM groups WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});
app.post('/api/groups/:id/values', json, (req, res) => res.json({ id: lib.ensureValue(Number(req.params.id), req.body?.name) }));
app.patch('/api/values/:id', json, (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) throw httpError(400, 'Name is required');
  db.prepare('UPDATE group_values SET name = ? WHERE id = ?').run(name, Number(req.params.id));
  res.json({ ok: true });
});
app.delete('/api/values/:id', (req, res) => { db.prepare('DELETE FROM group_values WHERE id = ?').run(Number(req.params.id)); res.json({ ok: true }); });
app.post('/api/designers/rename', json, (req, res) => {
  const { from, to } = req.body || {};
  db.prepare(`UPDATE models SET designer = ?, updated_at = datetime('now') WHERE designer = ? COLLATE NOCASE`).run(String(to || '').trim(), String(from || ''));
  res.json({ ok: true });
});

// ---------------- translation ----------------
app.get('/api/translate', h(async (req, res) => res.json(await lib.translator.toEnglish(String(req.query.q || '').slice(0, 300)))));

// ---------------- network folders ----------------
app.get('/api/locations', h(async (req, res) => res.json({ canMount: await locations.canMount(), windows: process.platform === 'win32', list: locations.publicList() })));
app.post('/api/locations', json, h(async (req, res) => res.json({ list: await locations.add(req.body || {}) })));
app.post('/api/locations/folder', json, h(async (req, res) => res.json({ list: await locations.addFolder(req.body || {}) })));

// ---------- Windows: browse this PC's drives and folders to add them ----------
// Only answers this PC itself, or anyone once a login password is set, so folder names aren't shown to the whole network.
const pcOnly = (req) => {
  if (!WIN) throw httpError(404, 'Only in the Windows version');
  const ip = String(req.socket.remoteAddress || '');
  if (!env.APP_PASSWORD && !/^(::1|127\.|::ffff:127\.)/.test(ip)) throw httpError(403, 'For safety, folders can only be browsed on the PC that runs ModelVault (or set a login password in settings.cmd).');
};
const netUse = () => new Promise((resolve) => {
  import('node:child_process').then(({ execFile }) => execFile('net', ['use'], { timeout: 8000, windowsHide: true }, (err, out) => {
    const map = {};
    for (const line of String(out || '').split(/\r?\n/)) { const m = /\b([A-Z]):\s+(\\\\\S.*?)\s{2,}/.exec(line) || /\b([A-Z]):\s+(\\\\\S+)/.exec(line); if (m) map[m[1]] = m[2].trim(); }
    resolve(map);
  }));
});
app.get('/api/pc/folders', h(async (req, res) => {
  pcOnly(req);
  const want = String(req.query.path || '').trim();
  if (!want) {
    const mapped = await netUse();
    const drives = [];
    for (const c of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const root = `${c}:\\`;
      if (mapped[c] || (await fsp.access(root).then(() => true, () => false))) drives.push({ path: root, name: `${c}:`, network: mapped[c] || '' });
    }
    const home = env.USERPROFILE || '';
    const places = ['Desktop', 'Documents', 'Downloads', 'Pictures'].map((n) => ({ name: n, path: path.join(home, n) })).filter((p) => home && fs.existsSync(p.path));
    return res.json({ path: '', drives, places });
  }
  const abs = path.resolve(want);
  let entries;
  try { entries = await fsp.readdir(abs, { withFileTypes: true }); } catch { throw httpError(400, `Can't open ${abs}. If it's a network folder, open it once in File Explorer first.`); }
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('$') && !/^(System Volume Information|Recovery|PerfLogs|Config\.Msi)$/i.test(e.name)).map((e) => e.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const files = entries.filter((e) => e.isFile()).length;
  const parent = path.dirname(abs);
  res.json({ path: abs, parent: parent === abs ? '' : parent, dirs: dirs.slice(0, 2000), files });
}));
app.get('/api/pc/paths', h(async (req, res) => { if (!WIN) throw httpError(404, 'Only in the Windows version'); res.json({ library: roots.library, downloads: roots['downloads-old'] ? roots['downloads-old'] : roots.downloads, data: DATA_DIR }); }));
app.post('/api/pc/paths', json, h(async (req, res) => {
  pcOnly(req);
  const next = { ...chosen };
  for (const k of ['library', 'downloads']) {
    if (req.body?.[k] === undefined) continue;
    const abs = path.resolve(String(req.body[k]));
    if (!(await fsp.stat(abs).then((st) => st.isDirectory(), () => false))) throw httpError(400, `${abs} is not a folder ModelVault can open.`);
    next[k] = abs;
  }
  await fsp.writeFile(PATHS_FILE, JSON.stringify(next, null, 2));
  res.json({ ok: true, restarting: true });
  // The Windows launcher starts ModelVault again after exit code 0, with the new folders.
  setTimeout(() => process.exit(0), 600);
}));
app.post('/api/locations/:key/retry', h(async (req, res) => res.json({ list: await locations.retry(req.params.key) })));
app.delete('/api/locations/:key', h(async (req, res) => res.json(await locations.remove(req.params.key))));

// ---------------- organizer ----------------
app.post('/api/organize/preview', json, h(async (req, res) => {
  const tpl = String(req.body?.template || '').trim();
  if (!tpl || tpl.includes('..') || tpl.startsWith('/')) throw httpError(400, 'Folder name format is not valid');
  const plan = await lib.organizePlan(tpl, { pictures: !!req.body?.pictures, adopt: !!req.body?.adopt });
  // Samples of the format: one of your own models with the most details filled in, and a made-up one.
  const own = lib.db.prepare(`SELECT m.id, m.name, m.designer, m.year, (m.designer <> '') + (m.year IS NOT NULL) + (SELECT COUNT(*) FROM model_values mv WHERE mv.model_id = m.id) AS n
    FROM models m ORDER BY n DESC, m.id LIMIT 1`).get();
  const tokens = own ? lib.tokensFor({ ...own, values: lib.db.prepare('SELECT value_id FROM model_values WHERE model_id = ?').all(own.id).map((r) => r.value_id) }) : null;
  plan.samples = [
    ...(tokens ? [{ label: own.name, path: renderTemplate(tpl, tokens).join('/') }] : []),
    { label: 'Ancient Dragon by Example Studio, 2026 (a made-up model)', path: renderTemplate(tpl, { name: 'Ancient Dragon', designer: 'Example Studio', year: '2026', type: 'Statue', franchise: 'Fantasy', printtype: 'Resin', status: 'Printed' }).join('/') },
  ];
  res.json(plan);
}));
app.post('/api/organize/apply', json, (req, res) => {
  const b = req.body || {};
  const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter(Boolean) : null;
  res.json(lib.startOrganize(lib.setting('folderPattern'), { ids, adopt: b.adopt ?? lib.setting('adoptOnSave') === 'true', label: b.label || (ids ? `Moving ${ids.length} model${ids.length === 1 ? '' : 's'} into the library` : 'Organizing folders') }));
});
// Models the organizer couldn't move by itself (folders inside other models, failed moves) and the person's choices for them.
app.get('/api/organize/stuck', h(async (req, res) => res.json(await lib.stuckModels({ includeStay: req.query.all === '1' }))));
app.post('/api/organize/resolve', json, (req, res) => {
  const b = req.body || {};
  const ok = (list, actions) => (Array.isArray(list) ? list : []).filter((x) => x && Number(x.id) && actions.includes(x.action)).map((x) => ({ id: Number(x.id), action: x.action }));
  const families = ok(b.families, ['merge', 'split', 'stay']), errors = ok(b.errors, ['retry', 'stay']);
  if (!families.length && !errors.length) return res.status(400).json({ error: 'Nothing to do' });
  res.json(lib.resolveStuck({ families, errors }));
});
// Details read from file names for models already in the library (reviewed in the browser before applying).
app.post('/api/models/suggest', json, h(async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Boolean).slice(0, 2000);
  res.json(await lib.suggestDetails(ids));
}));
app.post('/api/models/apply-suggestions', json, h(async (req, res) => {
  const b = req.body || {};
  const r = await lib.applySuggestions(Array.isArray(b.items) ? b.items : [], { organize: b.organize !== false, ids: Array.isArray(b.ids) ? b.ids : null });
  res.json({ changed: r.changed, job: r.job?.id || null });
}));
app.post('/api/models/bulk', json, h(async (req, res) => res.json(await lib.bulk(req.body?.ids || [], req.body || {}))));

// ---------------- watch folders ----------------
app.get('/api/inbox', (req, res) => res.json(watcher.public()));
app.post('/api/inbox/import', json, h(async (req, res) => res.json(await watcher.import(req.body?.ids || [], req.body?.mode === 'separate' ? 'separate' : 'one'))));
app.post('/api/inbox/trash', json, h(async (req, res) => res.json(await watcher.trash(req.body?.ids || []))));
app.post('/api/inbox/ignore', json, h(async (req, res) => { await watcher.ignore(req.body?.ids || []); res.json({ ok: true }); }));

// ---------------- look inside archives ----------------
const archiveIn = async (base, rel) => {
  const abs = await resolveInside(base, rel);
  if (!isArchiveLike(abs) || !(await exists(abs))) throw httpError(400, 'Not an archive');
  return abs;
};
const sendEntry = (req, res, abs, entry) => {
  const child = streamArchiveEntry(abs, String(entry || ''));
  res.type(path.extname(String(entry)) || 'application/octet-stream');
  child.on('error', () => { if (!res.headersSent) res.status(500); res.end(); });
  child.stdout.pipe(res);
  req.on('close', () => child.kill());
};
app.get('/api/models/:id/archive', h(async (req, res) => res.json({ entries: await listArchive(await archiveIn(lib.model(Number(req.params.id)).path, String(req.query.rel || ''))) })));
app.get('/api/models/:id/archive-file', h(async (req, res) => sendEntry(req, res, await archiveIn(lib.model(Number(req.params.id)).path, String(req.query.rel || '')), req.query.entry)));
app.get('/api/browse/archive', h(async (req, res) => res.json({ entries: await listArchive(await archiveIn(rootOf(String(req.query.root)), String(req.query.path || ''))) })));

// ---------------- open in slicer ----------------
app.get('/api/models/:id/pc-path', h(async (req, res) => {
  const m = lib.model(Number(req.params.id));
  const abs = await resolveInside(m.path, String(req.query.rel || ''));
  const net = Object.fromEntries(locations.publicList().map((l) => [l.key, l.path]));
  const p = lib.pcPathFor(abs, net);
  if (!p) throw httpError(400, 'ModelVault does not know where your PC sees this folder yet. Add it in Settings > Library > Folder paths on your PC.');
  res.json({ path: p });
}));
const SECRET = crypto.randomBytes(32);
const sign = (x) => crypto.createHmac('sha256', SECRET).update(x).digest('hex').slice(0, 32);
app.get('/api/models/:id/slicer-link', (req, res) => {
  const m = lib.model(Number(req.params.id));
  const rel = String(req.query.rel || '');
  const exp = Date.now() + 6 * 3600e3;
  if (req.query.entry) {
    // A file inside an archive: /z/<token>/<id>/<archive path, base64>/<entry path>
    const entry = String(req.query.entry);
    return res.json({ path: `/z/${exp.toString(36)}.${sign(`${m.id}/${rel}::${entry}|${exp}`)}/${m.id}/${Buffer.from(rel).toString('base64url')}/${entry.replace(/^\.\//, '').split('/').map(encodeURIComponent).join('/')}`, raw: entry });
  }
  res.json({ path: `/s/${exp.toString(36)}.${sign(`${m.id}/${rel}|${exp}`)}/${m.id}/${rel.split('/').map(encodeURIComponent).join('/')}` });
});
app.get('/s/:token/:id/*', h(async (req, res) => {
  const [e36, sig] = String(req.params.token).split('.');
  const exp = parseInt(e36, 36);
  const good = sign(`${Number(req.params.id)}/${req.params[0]}|${exp}`);
  if (!(exp > Date.now()) || !sig || sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) throw httpError(403, 'This link has expired');
  const m = lib.model(Number(req.params.id));
  res.sendFile(await resolveInside(m.path, req.params[0]), { dotfiles: 'allow' });
}));

app.get('/z/:token/:id/:rel64/*', h(async (req, res) => {
  const [e36, sig] = String(req.params.token).split('.');
  const exp = parseInt(e36, 36);
  const rel = Buffer.from(req.params.rel64, 'base64url').toString();
  const abs = await archiveIn(lib.model(Number(req.params.id)).path, rel);
  // The archive may list the entry as "./path" or "path": accept whichever one was signed.
  const entry = [req.params[0], `./${req.params[0]}`].find((en) => { const good = sign(`${Number(req.params.id)}/${rel}::${en}|${exp}`); return sig && sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good)); });
  if (!(exp > Date.now()) || !entry) throw httpError(403, 'This link has expired');
  sendEntry(req, res, abs, entry);
}));

// ---------------- models ----------------
app.get('/api/models', (req, res) => res.json(lib.listModels()));
app.get('/api/models/:id', h(async (req, res) => res.json(await lib.modelWithFiles(req.params.id))));
app.patch('/api/models/:id', json, h(async (req, res) => res.json(await lib.updateModel(Number(req.params.id), req.body || {}))));
app.delete('/api/models/:id', h(async (req, res) => { await lib.deleteModel(Number(req.params.id), { deleteFiles: req.query.files === '1' }); res.json({ ok: true }); }));
app.post('/api/models/:id/rescan', h(async (req, res) => res.json(await lib.refreshStats(Number(req.params.id)))));
app.post('/api/models/:id/extract', json, (req, res) => res.json(lib.startExtract(Number(req.params.id), req.body?.rel)));
app.post('/api/models/:id/thumb', express.raw({ type: 'image/png', limit: '8mb' }), h(async (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length < 100) throw httpError(400, 'Expected a PNG');
  res.json(await lib.setThumb(Number(req.params.id), req.body));
}));
app.post('/api/models/:id/cover', h(async (req, res) => {
  const id = Number(req.params.id);
  if (req.is('application/json')) {
    await new Promise((r, j) => json(req, res, (e) => (e ? j(e) : r())));
    return res.json(await lib.setCoverFromFile(id, String(req.body?.rel || '')));
  }
  const m = lib.model(id);
  const { files } = await receiveFiles(req, m.path, { maxFiles: 1 });
  if (!files[0]) throw httpError(400, 'No file received');
  if (!isMedia(files[0].name)) { await fsp.rm(files[0].path, { force: true }); throw httpError(400, 'Covers must be an image, GIF or video'); }
  const uploaded = path.basename(files[0].path);
  const m2 = await lib.setCoverFromFile(id, uploaded);
  await fsp.rm(files[0].path, { force: true }); // the cover is a copy; drop the uploaded original
  lib.images.later(id);
  res.json(await lib.refreshStats(m2.id));
}));
// Add extra files (PDF instructions, more parts, photos of your print…) to a model.
app.post('/api/models/:id/files', h(async (req, res) => {
  const m = lib.model(Number(req.params.id));
  const tmp = path.join(lib.stagingDir, `.add-${crypto.randomUUID()}`);
  await fsp.mkdir(tmp, { recursive: true });
  try {
    const { files } = await receiveFiles(req, tmp);
    for (const f of files) await move(f.path, await uniquePath(path.join(m.path, f.name)));
  } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
  lib.images.later(m.id);
  res.json(await lib.refreshStats(m.id));
}));
app.delete('/api/models/:id/file', h(async (req, res) => res.json(await lib.deleteFile(Number(req.params.id), String(req.query.rel || '')))));
app.get('/api/models/:id/sniff', h(async (req, res) => {
  const m = lib.model(Number(req.params.id));
  const out = {};
  for (const rel of [].concat(req.query.rel || []).slice(0, 300)) {
    const abs = await resolveInside(m.path, String(rel));
    if (isMedia(abs)) out[rel] = (await sniffMedia(abs))?.kind || null;
  }
  res.json(out);
}));
app.get('/api/models/:id/download', (req, res) => {
  const m = lib.model(Number(req.params.id));
  res.set('Content-Type', 'application/zip');
  res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeName(m.name))}.zip`);
  const p = zipStream(m.path);
  p.stdout.pipe(res);
  req.on('close', () => p.kill());
});

// Serve model files (Range requests work, so videos stream and seek).
app.get('/files/:id/*', h(async (req, res) => {
  const m = lib.model(Number(req.params.id));
  const abs = await resolveInside(m.path, req.params[0]);
  if (!(await exists(abs))) throw httpError(404, 'File not found');
  if (req.query.download === '1') return res.download(abs, path.basename(abs), { dotfiles: 'allow' });
  // Send pictures and videos with their real type (a ".gif" that is really an MP4 then plays as video).
  const sniff = isMedia(abs) ? await sniffMedia(abs) : null;
  res.sendFile(abs, { dotfiles: 'allow', maxAge: '1h', headers: { 'X-Content-Type-Options': 'nosniff', ...(sniff ? { 'Content-Type': sniff.mime } : {}) } });
}));
app.use('/thumbs', express.static(path.join(DATA_DIR, 'thumbs'), { maxAge: '1h' }));

// ---------------- staged imports ----------------
app.get('/api/drafts', (req, res) => res.json(lib.listDrafts()));
app.post('/api/drafts/upload', h(async (req, res) => {
  const d = await lib.newDraft('upload');
  const src = path.join(lib.draftDir(d), 'src');
  const { fields, files } = await receiveFiles(req, src);
  // Dropped folders send their relative paths so the structure is kept.
  let rels = [];
  try { rels = JSON.parse(fields.paths || '[]'); } catch { rels = []; }
  for (const [i, f] of files.entries()) {
    const rel = String(rels[i] || f.name).split(/[\\/]+/).filter((s) => s && s !== '.' && s !== '..').map((s) => safeName(s, 'file')).join('/') || f.name;
    const dest = await uniquePath(path.join(src, rel));
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.rename(f.path, dest);
  }
  if (!files.length) { await lib.cancelDraft(d.id); throw httpError(400, 'No files received'); }
  lib.processDraft(d);
  res.json(lib.publicDraft(d));
}));
// Dropped files that already sit in a folder the NAS can see are taken from there (moved or copied) instead of uploaded.
app.post('/api/drafts/from-local', json, h(async (req, res) => {
  const files = Array.isArray(req.body?.files) ? req.body.files.slice(0, 500) : [];
  const found = await lib.findLocal(files);
  if (!found) return res.json({ matched: false });
  const d = await lib.newDraft('local');
  lib.ingest(d, found, { copy: lib.setting('importMode') === 'copy' });
  res.json({ matched: true, draft: lib.publicDraft(d) });
}));
app.post('/api/drafts/from-paths', json, h(async (req, res) => {
  const { root, paths = [], name } = req.body || {};
  const base = rootOf(root);
  if (!Array.isArray(paths) || !paths.length) throw httpError(400, 'Choose at least one file or folder');
  const abs = [];
  for (const p of paths) {
    const a = await resolveInside(base, p);
    if (a === base) throw httpError(400, 'Pick files or folders inside the folder, not the folder itself');
    if (within(lib.stagingDir, a) || within(a, lib.stagingDir)) throw httpError(400, 'That location cannot be imported');
    if (!(await exists(a))) throw httpError(404, `${p} no longer exists`);
    abs.push(a);
  }
  const d = await lib.newDraft(root);
  d.name = name || '';
  lib.ingest(d, abs, { copy: lib.setting('importMode') === 'copy' });
  res.json(lib.publicDraft(d));
}));
app.post('/api/drafts/:id/cover', h(async (req, res) => {
  const d = lib.draft(req.params.id);
  const tmp = path.join(lib.draftDir(d), 'tmp');
  await fsp.mkdir(tmp, { recursive: true });
  const { files } = await receiveFiles(req, tmp, { maxFiles: 1 });
  if (!files[0] || !isMedia(files[0].name)) throw httpError(400, 'Covers must be an image, GIF or video');
  const named = path.join(tmp, files[0].name);
  await fsp.rename(files[0].path, named);
  res.json(lib.publicDraft(await lib.addCoverToDraft(d, named)));
}));
app.get('/api/drafts/:id/file/*', h(async (req, res) => {
  const d = lib.draft(req.params.id);
  const abs = await resolveInside(path.join(lib.draftDir(d), 'content'), req.params[0]);
  res.sendFile(abs, { dotfiles: 'allow' });
}));
app.post('/api/drafts/:id/commit', json, h(async (req, res) => res.json(await lib.commitDraft(req.params.id, req.body || {}))));
app.delete('/api/drafts/:id', h(async (req, res) => { await lib.cancelDraft(req.params.id); res.json({ ok: true }); }));

// ---------------- folder browser ----------------
app.get('/api/browse', h(async (req, res) => {
  const key = String(req.query.root || 'downloads');
  const base = rootOf(key);
  const abs = await resolveInside(base, String(req.query.path || ''));
  const ents = await fsp.readdir(abs, { withFileTypes: true }).catch(() => { throw httpError(404, 'Folder not found'); });
  const entries = [];
  for (const e of ents) {
    if (ignored(e.name) || e.name.startsWith('.')) continue;
    const p = path.join(abs, e.name);
    const st = await fsp.stat(p).catch(() => null);
    if (!st) continue;
    const isDir = st.isDirectory();
    entries.push({ name: e.name, type: isDir ? 'dir' : 'file', size: isDir ? null : st.size, kind: isDir ? 'folder' : isArchiveLike(e.name) ? 'archive' : kindOf(e.name), mtime: st.mtimeMs, archive: !isDir && isArchiveLike(e.name) });
  }
  entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : a.type === 'dir' ? -1 : 1));
  // Possible doubles of models already in the library (not when browsing the library itself).
  if (key !== 'library') lib.history.check(entries).forEach((d, i) => { if (d) entries[i].dup = d; });
  const rel = path.relative(base, abs).split(path.sep).join('/');
  res.json({ root: key, path: rel, entries });
}));
// Delete unwanted downloads: they go to a .trash folder in that location, until it's emptied.
app.post('/api/browse/trash', json, h(async (req, res) => {
  const root = String(req.body?.root || 'downloads');
  const paths = Array.isArray(req.body?.paths) ? req.body.paths.map(String).slice(0, 2000) : [];
  lib.trashDir(root);
  let trashed = 0; const errors = [];
  for (const p of paths) { try { if (await lib.trashDownload(root, p)) trashed++; } catch (e) { errors.push(`${p}: ${e.message}`); } }
  res.json({ trashed, errors, trash: await lib.trashInfo(root) });
}));
app.get('/api/browse/trash', h(async (req, res) => res.json(await lib.trashInfo(String(req.query.root || 'downloads')))));
app.post('/api/browse/trash/empty', json, h(async (req, res) => res.json(await lib.emptyTrash(String(req.body?.root || 'downloads')))));
app.get('/api/browse/file', h(async (req, res) => {
  const abs = await resolveInside(rootOf(String(req.query.root)), String(req.query.path || ''));
  res.sendFile(abs, { dotfiles: 'allow' });
}));

// ---------------- existing library / Orynt3D ----------------
app.post('/api/scan/preview', json, h(async (req, res) => {
  const { root = 'library', path: rel = '', mode = 'smart' } = req.body || {};
  const abs = await resolveInside(rootOf(root), rel);
  const plan = await lib.planScan(abs, mode);
  const known = new Set(db.prepare('SELECT path FROM models').all().map((r) => r.path));
  res.json({ ...plan, root: undefined, existing: plan.plan.filter((p) => known.has(p.path)).length, plan: plan.plan.slice(0, 400).map(({ path: _p, ...rest }) => rest) });
}));
app.post('/api/scan/import', json, h(async (req, res) => {
  const { root = 'library', path: rel = '', mode = 'smart', relocate = false, coverMode = 'copy' } = req.body || {};
  const abs = await resolveInside(rootOf(root), rel);
  res.json(lib.startScanImport(abs, { mode, relocate: !!relocate && root !== 'library', coverMode }, { label: root === 'orynt3d' ? 'Importing Orynt3D library' : 'Importing existing library' }));
}));
app.get('/api/jobs', (req, res) => res.json(lib.listJobs()));
app.get('/api/jobs/:id', (req, res) => { const j = lib.jobs.get(req.params.id); if (!j) throw httpError(404, 'Job not found'); res.json(j); });

// ---------------- front end ----------------
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules/three'), { maxAge: '7d' }));
app.use(express.static(path.join(ROOT, 'public'), { maxAge: 0 }));
app.get(/^\/(?!api|files|thumbs|vendor|s\/|z\/).*/, (req, res) => res.sendFile(path.join(ROOT, 'public/index.html')));

app.use((err, req, res, _next) => {
  const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Something went wrong' });
});

// Self-update: when the program files in this folder change, restart so the new version loads
// (the container's restart policy starts it again). Waits for running imports to finish first.
{
  let pending = null;
  const idle = () => ![...lib.drafts.values()].some((d) => d.status === 'processing') && ![...lib.jobs.values()].some((j) => j.status === 'running');
  const bounce = () => { if (idle()) { console.log('Program files changed: restarting'); process.exit(0); } else pending = setTimeout(bounce, 5000); };
  // The Windows launcher starts ModelVault again after exit code 0, like Docker's restart policy.
  for (const f of fs.readdirSync(__dirname).filter((n) => n.endsWith('.js'))) {
    fs.watchFile(path.join(__dirname, f), { interval: 5000 }, (cur, prev) => { if (cur.mtimeMs !== prev.mtimeMs) { clearTimeout(pending); pending = setTimeout(bounce, 4000); } });
  }
}

const port = Number(env.PORT || 8420);
app.listen(port, () => console.log(`ModelVault ${VERSION} running on http://0.0.0.0:${port}  library=${roots.library}  downloads=${roots.downloads}`));
