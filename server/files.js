import fs from 'node:fs';
import { PassThrough } from 'node:stream';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile, execFileSync, spawn } from 'node:child_process';

export const EXT = {
  model: ['.stl', '.3mf', '.obj', '.step', '.stp', '.f3d', '.scad', '.blend', '.ply'],
  sliced: ['.gcode', '.bgcode', '.gco', '.ctb', '.chitubox', '.lys', '.photon'],
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp'],
  video: ['.mp4', '.webm', '.mov', '.m4v'],
  pdf: ['.pdf'],
  archive: ['.zip', '.7z', '.rar'],
};
export const VIEWABLE_3D = ['.stl', '.3mf', '.obj'];

export function kindOf(name) {
  const ext = path.extname(name).toLowerCase();
  for (const [k, list] of Object.entries(EXT)) if (list.includes(ext)) return k;
  return 'other';
}
export const isArchive = (n) => kindOf(n) === 'archive';
/** Multi-part archives: name.part1.rar, name.7z.001, name.zip.001, name.z01 / name.r00 */
export function volumeInfo(name) {
  let m;
  if ((m = /^(.*)\.part(\d+)\.rar$/i.exec(name))) return { base: m[1], first: Number(m[2]) === 1 };
  if ((m = /^(.*\.(7z|zip|rar))\.(\d{3})$/i.exec(name))) return { base: m[1], first: Number(m[3]) === 1 };
  if ((m = /^(.*)\.[zr](\d{2})$/i.exec(name))) return { base: m[1], first: false };
  return null;
}
export const isArchiveLike = (n) => isArchive(n) || !!volumeInfo(n);
export const isMedia = (n) => ['image', 'video'].includes(kindOf(n));

/** What a picture or video really is, from its first bytes. Many downloaded ".gif" files are actually MP4 videos. */
export async function sniffMedia(abs) {
  let fh;
  try {
    fh = await fsp.open(abs, 'r');
    const b = Buffer.alloc(16);
    const { bytesRead } = await fh.read(b, 0, 16, 0);
    if (bytesRead < 12) return null;
    const ascii = (a, z) => b.toString('latin1', a, z);
    if (ascii(0, 4) === 'GIF8') return { mime: 'image/gif', ext: '.gif', kind: 'image' };
    if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return { mime: 'image/png', ext: '.png', kind: 'image' };
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg', kind: 'image' };
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { mime: 'image/webp', ext: '.webp', kind: 'image' };
    if (ascii(4, 8) === 'ftyp') {
      const brand = ascii(8, 12);
      if (/^(avif|avis)/.test(brand)) return { mime: 'image/avif', ext: '.avif', kind: 'image' };
      return brand === 'qt  ' ? { mime: 'video/quicktime', ext: '.mov', kind: 'video' } : { mime: 'video/mp4', ext: '.mp4', kind: 'video' };
    }
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { mime: 'video/webm', ext: '.webm', kind: 'video' };
    if (ascii(0, 2) === 'BM') return { mime: 'image/bmp', ext: '.bmp', kind: 'image' };
    return null;
  } catch { return null; } finally { await fh?.close().catch(() => {}); }
}

/** True when two files have identical contents. */
export async function sameFile(a, b) {
  const [sa, sb] = await Promise.all([fsp.stat(a), fsp.stat(b)]);
  if (sa.size !== sb.size) return false;
  if (sa.size > 64 * 1024 * 1024) return true; // same name pattern and size on a big video: treat as the same
  const [ba, bb] = await Promise.all([fsp.readFile(a), fsp.readFile(b)]);
  return ba.equals(bb);
}

const IGNORED = new Set(['.ds_store', 'thumbs.db', 'desktop.ini', '@eadir', '#recycle', '__macosx', '.trash', '_orynt3d', 'config.orynt3d', 'user.json']);
export const ignored = (name) => IGNORED.has(name.toLowerCase()) || name.startsWith('._');

/** Make a string safe as a single folder/file name on Synology (ext4/btrfs) and Windows shares. */
export function safeName(s, fallback = 'Untitled') {
  let out = String(s ?? '').replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[.\s]+|[.\s]+$/g, '');
  if (out.length > 120) out = out.slice(0, 120).trim();
  return out || fallback;
}

/** Human-friendly model name from an archive / file name. */
export function niceName(fileName) {
  let n = path.basename(fileName);
  while (/\.(zip|7z|rar|stl|3mf|obj|step|stp|jpe?g|png|gif|webp|mp4|pdf|part\d+|\d{3}|[zr]\d{2})$/i.test(n)) n = n.replace(/\.[^.]+$/, '');
  n = n.replace(/[_]+/g, ' ')
    .replace(/\s*\((\d+)\)$/, '')
    .replace(/[-\s](main|master|files?|stls?|fdm|print files?)$/i, '')
    .replace(/\s+-\s*\d{5,}$/, '') // "Name - 1234567" style IDs
    .replace(/\s+/g, ' ').trim();
  return n || path.basename(fileName);
}

export function within(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Resolve a user-supplied relative path inside root, refusing escapes (incl. via symlinks). */
export async function resolveInside(root, rel = '') {
  const abs = path.resolve(root, '.' + path.sep + String(rel || '').replace(/^[/\\]+/, ''));
  if (!within(root, abs)) throw httpError(400, 'Path is outside the allowed folder');
  try {
    const real = await fsp.realpath(abs);
    const realRoot = await fsp.realpath(root);
    if (!within(realRoot, real)) throw httpError(400, 'Path is outside the allowed folder');
  } catch (e) { if (e.status) throw e; }
  return abs;
}

export function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

export async function exists(p) { try { await fsp.access(p); return true; } catch { return false; } }

export async function uniquePath(p) {
  if (!(await exists(p))) return p;
  const dir = path.dirname(p), ext = path.extname(p), base = path.basename(p, ext);
  for (let i = 2; ; i++) {
    const c = path.join(dir, `${base} (${i})${ext}`);
    if (!(await exists(c))) return c;
  }
}

/** Move a file or folder; falls back to copy+delete across Docker volume mounts (EXDEV). */
export async function move(src, dest) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  try { await fsp.rename(src, dest); }
  catch (e) {
    if (e.code !== 'EXDEV') throw e;
    await fsp.cp(src, dest, { recursive: true, preserveTimestamps: true, errorOnExist: true, force: false });
    await fsp.rm(src, { recursive: true, force: true });
  }
}

/** Move the contents of srcDir into destDir (merging folders, renaming clashes). */
export async function moveContents(srcDir, destDir) {
  await fsp.mkdir(destDir, { recursive: true });
  for (const ent of await fsp.readdir(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, ent.name), d = path.join(destDir, ent.name);
    if (ent.isDirectory() && (await exists(d))) await moveContents(s, d);
    else await move(s, await uniquePath(d));
  }
}

/** Recursively list files: [{rel, size, kind, mtime}] */
export async function walk(root, { maxFiles = 20000 } = {}) {
  const out = [];
  async function rec(dir) {
    let ents;
    try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of ents) {
      if (out.length >= maxFiles) return;
      if (ignored(ent.name)) continue;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) await rec(abs);
      else if (ent.isFile()) {
        const st = await fsp.stat(abs).catch(() => null);
        if (!st) continue;
        out.push({ rel: path.relative(root, abs).split(path.sep).join('/'), size: st.size, kind: kindOf(ent.name), mtime: st.mtimeMs });
      }
    }
  }
  await rec(root);
  return out.sort((a, b) => a.rel.localeCompare(b.rel, undefined, { numeric: true }));
}

export function summarize(files) {
  const kinds = new Set();
  let size = 0;
  for (const f of files) {
    size += f.size;
    const ext = path.extname(f.rel).toLowerCase().slice(1);
    if (['model', 'sliced', 'pdf', 'archive'].includes(f.kind)) kinds.add(ext === 'stp' ? 'step' : ext);
  }
  return { file_count: files.length, size, kinds: kinds.size ? `,${[...kinds].sort().join(',')},` : '' };
}

/** Score files to pick the best cover image/video. */
export function rankCovers(files) {
  const media = files.filter((f) => f.kind === 'image' || f.kind === 'video');
  const score = (f) => {
    const name = path.basename(f.rel).toLowerCase();
    let s = 0;
    if (/^cover-/.test(name)) s += 1000;
    if (/cover|render|preview|hero|main|front|thumb|title|promo|showcase/.test(name)) s += 100;
    if (/supports?|scale|size|instruction|guide|layout|plate|ruler|parts?[_ -]?list/.test(name)) s -= 60;
    if (f.kind === 'image') s += 20;
    if (/\.gif$/.test(name)) s += 5;
    s -= f.rel.split('/').length * 8;
    s += Math.min(30, Math.log2(Math.max(f.size, 1)) - 10);
    return s;
  };
  return media.sort((a, b) => score(b) - score(a));
}

// Which tool reads what. Some builds of 7-Zip (Alpine's, used in the Docker image) can't open RAR at all,
// so RAR goes to libarchive's bsdtar there. FORCE_BSDTAR=1 sends everything to bsdtar (used for testing).
// Tool names: on Windows the standalone package puts 7z.exe on the PATH and uses Windows' own tar.exe (libarchive's bsdtar).
const WIN = process.platform === 'win32';
const SZ = process.env.SEVENZIP_BIN || '7z';
const BSDTAR = process.env.BSDTAR_BIN || (WIN ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'bsdtar');
const SEVENZIP = (() => { try { return String(execFileSync(SZ, ['i'], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 })); } catch { return null; } })();
const SEVENZIP_RAR = !!SEVENZIP && /^\s*\S*\s+\S*\s*Rar5?\s/im.test(SEVENZIP);
const isRarFile = (p) => /\.(rar|r\d{2})$/i.test(p);
const use7z = (archive) => !process.env.FORCE_BSDTAR && !!SEVENZIP && (!isRarFile(archive) || SEVENZIP_RAR);
const globEscape = (x) => x.replace(/[\\*?[\]]/g, '\\$&');
console.log(`Archive tools: 7-Zip ${SEVENZIP ? `yes (RAR ${SEVENZIP_RAR ? 'yes' : 'no, using bsdtar for RAR'})` : 'not found, using bsdtar'}`);

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) { err.stderr = String(stderr || ''); reject(err); } else resolve(String(stdout));
    });
  });
}

/** Extract zip / 7z / rar. Tries 7-Zip first, then libarchive's bsdtar (handles RAR4/RAR5). */
/** 7-Zip with live progress (0-100). Resolves false if 7z isn't installed or fails, so the caller can fall back. */
function extract7z(archive, dest, onProgress) {
  return new Promise((resolve) => {
    const child = spawn(SZ, ['x', '-y', '-bsp1', '-bso0', '-snld', `-o${dest}`, archive], { stdio: ['ignore', 'pipe', 'ignore'] });
    let last = -1;
    child.stdout.on('data', (buf) => {
      const m = [...String(buf).matchAll(/(\d{1,3})%/g)].pop();
      if (m && Number(m[1]) !== last) { last = Number(m[1]); onProgress?.(Math.min(100, last)); }
    });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}
export async function extractArchive(archive, dest, onProgress) {
  await fsp.mkdir(dest, { recursive: true });
  // Progress = bytes written so far against the archive's unpacked size (works whichever tool does the work).
  let timer = null, best = 0;
  const report = (p) => { if (p > best) { best = Math.min(99, Math.round(p)); onProgress?.(best); } };
  if (onProgress) {
    const total = await listArchive(archive).then((es) => es.reduce((n, e) => n + (e.size || 0), 0)).catch(() => 0);
    const size = async () => (await walk(dest, { maxFiles: 200000 })).reduce((n, f) => n + f.size, 0);
    const start = await size();
    let busy = false;
    if (total > 0) timer = setInterval(async () => { if (busy) return; busy = true; try { report(((await size()) - start) / total * 100); } catch { /* keep going */ } busy = false; }, 1200);
  }
  try { await extractArchiveInner(archive, dest, report); onProgress?.(100); } finally { clearInterval(timer); }
}
async function extractArchiveInner(archive, dest, onProgress) {
  if (use7z(archive) && (await extract7z(archive, dest, onProgress))) return;
  const errors = [];
  for (const [cmd, args] of [
    ['7zz', ['x', '-y', '-bd', '-snld', `-o${dest}`, archive]],
    [BSDTAR, ['-xf', archive, '-C', dest]],
    ['unrar', ['x', '-o+', '-y', archive, dest + path.sep]],
  ]) {
    try { await run(cmd, args); return; }
    catch (e) { errors.push(`${cmd}: ${e.code === 'ENOENT' ? 'not installed' : (e.stderr || e.message).trim().split('\n').slice(-2).join(' ')}`); }
  }
  throw new Error(`Could not extract ${path.basename(archive)} — ${errors.join(' | ')}`);
}

/** List what's inside an archive without extracting it: [{path, size, dir}] */
export async function listArchive(archive) {
  const sort = (es) => es.filter((e) => !e.dir).sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  if (use7z(archive)) {
    try {
      const out = await run(SZ, ['l', '-slt', '-ba', '-sccUTF-8', '--', archive]);
      const entries = [];
      for (const block of out.split(/\r?\n\r?\n/)) {
        const get = (k) => new RegExp(`^${k} = (.*)$`, 'm').exec(block)?.[1];
        const p = get('Path');
        if (!p) continue;
        const dir = get('Folder') === '+' || /^D/.test(get('Attributes') || '');
        const mod = Date.parse(String(get('Modified') || '').replace(' ', 'T'));
        entries.push({ path: p.replace(/\\/g, '/'), size: Number(get('Size') || 0), dir, mtime: Number.isFinite(mod) ? mod : 0 });
      }
      if (entries.length) return sort(entries);
    } catch { /* fall through to bsdtar */ }
  }
  // bsdtar -tv: "-rw-r--r--  0 user group   12345 Nov 11 18:38 path/with spaces.stl"
  const out = await run(BSDTAR, ['-tvf', archive], { env: { ...process.env, LC_ALL: 'C.UTF-8' } });
  const entries = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^(\S)\S*\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\w{3}\s+\d+\s+[\d:]+)\s(.*)$/.exec(line);
    if (!m) continue;
    // "Nov 11 18:38" has no year: it's within the last six months, so this year, or last year if that would be in the future.
    let when = /:/.test(m[3]) ? Date.parse(`${m[3].replace(/\s+[\d:]+$/, '')} ${new Date().getFullYear()}`) : Date.parse(m[3]);
    if (/:/.test(m[3]) && when > Date.now() + 86400000) when = Date.parse(`${m[3].replace(/\s+[\d:]+$/, '')} ${new Date().getFullYear() - 1}`);
    entries.push({ path: m[4].replace(/ -> .*$/, '').replace(/\\/g, '/'), size: Number(m[2]), dir: m[1] === 'd' || m[4].endsWith('/'), mtime: Number.isFinite(when) ? when : 0 });
  }
  return sort(entries);
}
/** Stream one file out of an archive (stdout of the returned child process). */
export function streamArchiveEntry(archive, entry) {
  if (/^[-@]/.test(entry) || entry.includes('\0')) throw httpError(400, 'Invalid entry name');
  // Try 7-Zip first where it can read the format; if it produces nothing, libarchive's bsdtar takes over.
  const out = new PassThrough();
  const tools = [...(use7z(archive) ? [[SZ, ['x', '-so', '-bd', '--', archive, entry]]] : []), [BSDTAR, ['-xOf', archive, '--', globEscape(entry)]]];
  let child = null, killed = false;
  const next = () => {
    const [cmd, args] = tools.shift();
    let bytes = 0;
    child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.on('data', (c) => { bytes += c.length; out.write(c); });
    const done = (ok) => { if (killed) return; if (!ok && bytes === 0 && tools.length) next(); else if (!ok && bytes === 0) out.destroy(new Error('Could not read that file from the archive')); else out.end(); };
    let settled = false;
    child.on('error', () => { if (!settled) { settled = true; done(false); } });
    child.on('close', (code) => { if (!settled) { settled = true; done(code === 0); } });
  };
  next();
  return { stdout: out, on: (ev, fn) => { if (ev === 'error') out.on('error', fn); }, kill: () => { killed = true; child?.kill(); out.destroy(); } };
}

export function extractEntryTo(archive, entry, dest) {
  return new Promise((resolve, reject) => {
    const child = streamArchiveEntry(archive, entry);
    const out = fs.createWriteStream(dest);
    child.on('error', reject); out.on('error', reject); out.on('finish', resolve);
    child.stdout.pipe(out);
  });
}

/** Pull every image out of an archive into one flat folder (the rest stays zipped). Returns false if 7-Zip couldn't do it. */
export async function extractImagesTo(archive, dest) {
  await fsp.mkdir(dest, { recursive: true });
  let ok = false;
  if (use7z(archive)) {
    const pats = EXT.image.flatMap((e) => [`-ir!*${e}`, `-ir!*${e.toUpperCase()}`]);
    try { await run('7z', ['e', '-y', '-aou', '-bd', `-o${dest}`, archive, ...pats]); ok = true; } catch { /* try bsdtar */ }
    // 7-Zip builds without the RAR codec leave empty files behind: treat that as a failure.
    if (ok) { const sizes = await Promise.all((await fsp.readdir(dest)).map((n) => fsp.stat(path.join(dest, n)).then((x) => x.size, () => 0))); if (sizes.length && sizes.every((x) => x === 0)) ok = false; }
  }
  if (!ok) {
    // Case-insensitive patterns like *.[jJ][pP][gG]; -s drops the folders so everything lands flat in dest.
    const pats = EXT.image.flatMap((e) => ['--include', `*.${[...e.slice(1)].map((c) => (/[a-z]/.test(c) ? `[${c}${c.toUpperCase()}]` : c)).join('')}`]);
    try { await run('bsdtar', ['-xf', archive, '-C', dest, '-s', '|.*/||', ...pats]); ok = true; }
    catch (e) { ok = (await fsp.readdir(dest)).length > 0; }
  }
  for (const n of await fsp.readdir(dest)) {
    const p = path.join(dest, n);
    const st = await fsp.stat(p).catch(() => null);
    if (n.startsWith('._') || ignored(n) || !st || !st.isFile() || st.size === 0) await rmQuiet(p); // junk and failed (empty) extractions
  }
  return ok;
}

/** If a folder only holds a single sub-folder, lift that sub-folder's contents up one level. */
export async function flattenSingleFolder(dir) {
  for (let i = 0; i < 3; i++) {
    const ents = (await fsp.readdir(dir, { withFileTypes: true })).filter((e) => !ignored(e.name));
    if (ents.length !== 1 || !ents[0].isDirectory()) return;
    const inner = path.join(dir, ents[0].name);
    const tmp = path.join(dir, `.__flatten_${Date.now()}`);
    await fsp.rename(inner, tmp);
    for (const e of await fsp.readdir(tmp)) await fsp.rename(path.join(tmp, e), await uniquePath(path.join(dir, e)));
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

/** Extract archives found inside an extracted folder (e.g. Supported.zip inside a pack), then remove them. */
export async function extractNested(dir, stash, depth = 2) {
  if (depth <= 0) return;
  const files = await walk(dir);
  let found = false;
  for (const f of files.filter((x) => x.kind === 'archive')) {
    const abs = path.join(dir, f.rel);
    const target = abs.replace(/\.(zip|7z|rar)$/i, '');
    try {
      await extractArchive(abs, await uniquePath(target));
      // Park the inner archive so a cancelled import can put it back.
      await move(abs, await uniquePath(path.join(stash, f.rel)));
      found = true;
    } catch { /* leave it in place if it can't be read */ }
  }
  if (found) await extractNested(dir, stash, depth - 1);
}

/** Stream a folder as a .zip to an HTTP response (libarchive, no temp file). */
export function zipStream(dir) {
  return spawn(BSDTAR, ['--format', 'zip', '-cf', '-', '-C', dir, '.'], { stdio: ['ignore', 'pipe', 'ignore'] });
}

export function fmtBytes(n) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function rmQuiet(p) { return fsp.rm(p, { recursive: true, force: true }).catch(() => {}); }
export { fs, fsp };
