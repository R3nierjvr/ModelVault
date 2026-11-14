// Checking GitHub for a newer ModelVault, downloading it and installing it.
//
// How it installs depends on how ModelVault runs:
//   windows-installer  ModelVault-<v>-Setup.exe runs silently: it stops ModelVault, updates it and starts it again.
//   windows-portable   the portable zip's "app" folder is copied over this one, then ModelVault restarts.
//   docker / source    ModelVault-<v>-app.zip's server and public folders are copied over these, then it restarts
//                      (Docker's restart policy, or the Windows launcher, starts it again).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { httpError, rmQuiet } from './files.js';
import { readZipIndex, openEntry } from './backup.js';

const DAY = 24 * 3600 * 1000;

/** "3.20" vs "3.9": compares each number in turn. */
export function newer(a, b) {
  const pa = String(a).replace(/^v/i, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0; }
  return false;
}

export class Updater {
  constructor({ version, root, dataDir, lib, idle, repo }) {
    Object.assign(this, { version, root, dataDir, lib, idle, repo });
    this.dir = path.join(dataDir, 'update');
    this.tokenFile = path.join(dataDir, 'update-token');
    this.last = null; // { at, latest, available, notes, url, assets, error }
    this.job = null;
  }
  /** How this copy of ModelVault runs, which decides how it updates. */
  get kind() {
    if (process.platform === 'win32') {
      if (fs.existsSync(path.join(this.root, '..', 'Uninstall.exe'))) return 'windows-installer';
      if (fs.existsSync(path.join(this.root, '..', 'Start ModelVault.cmd'))) return 'windows-portable';
      return 'source';
    }
    return fs.existsSync('/.dockerenv') || process.env.container ? 'docker' : 'source';
  }
  token() { try { return fs.readFileSync(this.tokenFile, 'utf8').trim(); } catch { return ''; } }
  async setToken(t) {
    t = String(t || '').trim();
    if (t) await fsp.writeFile(this.tokenFile, t, { mode: 0o600 }); else await rmQuiet(this.tokenFile);
    this.last = null;
  }
  headers(extra = {}) {
    const t = this.token();
    return { 'User-Agent': `ModelVault/${this.version}`, Accept: 'application/vnd.github+json', ...(t ? { Authorization: `Bearer ${t}` } : {}), ...extra };
  }
  /** Ask GitHub for the newest release. */
  async check() {
    const at = Date.now();
    try {
      const r = await fetch(`https://api.github.com/repos/${this.repo}/releases/latest`, { headers: this.headers(), signal: AbortSignal.timeout(20000) });
      if (r.status === 404) throw httpError(502, this.token() ? 'No release found, or the access token can\'t read the repository.' : `No public release found for ${this.repo}. If the repository is private, add an access token below.`);
      if (r.status === 401 || r.status === 403) throw httpError(502, r.status === 401 ? 'GitHub didn\'t accept the access token.' : 'GitHub refused the check (too many checks from this network?). Try again later.');
      if (!r.ok) throw httpError(502, `GitHub answered ${r.status}.`);
      const rel = await r.json();
      const latest = String(rel.tag_name || '').replace(/^v/i, '');
      this.last = {
        // 3.x were development builds before the public 1.00, so they update to any 1.x or later.
        at, latest, available: newer(latest, this.version) || (/^3\./.test(this.version) && /^[1-2]\./.test(latest)), notes: rel.body || '', url: rel.html_url, published: rel.published_at,
        assets: (rel.assets || []).map((a) => ({ name: a.name, size: a.size, api: a.url, url: a.browser_download_url })),
      };
    } catch (e) {
      this.last = { ...(this.last || {}), at, error: e.name === 'TimeoutError' ? 'GitHub didn\'t answer. Check the internet connection.' : e.message };
    }
    return this.status();
  }
  /** The file this install needs from the release. */
  asset() {
    const a = this.last?.assets || [];
    const want = { 'windows-installer': /-Setup\.exe$/i, 'windows-portable': /windows-x64\.zip$/i }[this.kind] || /-app\.zip$/i;
    return a.find((x) => want.test(x.name)) || null;
  }
  status() {
    return {
      version: this.version, kind: this.kind, repo: this.repo, hasToken: !!this.token(),
      checkedAt: this.last?.at || null, latest: this.last?.latest || null, available: !!this.last?.available, error: this.last?.error || null,
      notes: this.last?.notes || '', url: this.last?.url || null, published: this.last?.published || null,
      asset: this.asset() ? { name: this.asset().name, size: this.asset().size } : null,
      job: this.job,
      auto: { check: this.lib.setting('updateCheck') !== 'false', install: this.lib.setting('updateAuto') === 'true' },
    };
  }
  /** Check once a day (first a minute after starting); install by itself if that's switched on. */
  schedule() {
    const tick = async () => {
      if (this.lib.setting('updateCheck') === 'false') return;
      const fresh = this.last?.at && Date.now() - this.last.at < DAY - 60000;
      if (!fresh) await this.check();
      if (this.last?.available && this.lib.setting('updateAuto') === 'true' && !this.job && this.idle()) {
        console.log(`Installing ModelVault ${this.last.latest} automatically`);
        this.install().catch((e) => console.error('auto update', e.message));
      }
    };
    setTimeout(tick, 60000);
    setInterval(tick, 3600 * 1000);
  }
  async download(a, file) {
    // Private repositories: the asset is fetched through the API with the token; public ones from the download link.
    const r = await fetch(this.token() ? a.api : a.url, { headers: this.headers({ Accept: 'application/octet-stream' }), redirect: 'follow' });
    if (!r.ok || !r.body) throw httpError(502, `Downloading ${a.name} failed (${r.status}).`);
    const total = Number(r.headers.get('content-length')) || a.size || 0;
    let got = 0;
    const body = Readable.fromWeb(r.body);
    body.on('data', (c) => { got += c.length; if (this.job) this.job.pct = total ? Math.round((got / total) * 100) : null; });
    await pipeline(body, fs.createWriteStream(file));
  }
  /** Copy an entry folder out of a zip over a folder of this install. */
  async copyFromZip(zip, prefix, dest) {
    const entries = await readZipIndex(zip);
    let n = 0;
    for (const e of entries.values()) {
      if (!e.name.startsWith(prefix)) continue;
      const rel = e.name.slice(prefix.length);
      if (!rel || rel.split('/').some((s) => s === '..' || s === '')) continue;
      const out = path.join(dest, ...rel.split('/'));
      await fsp.mkdir(path.dirname(out), { recursive: true });
      const tmp = `${out}.updating`;
      await pipeline(await openEntry(zip, e), fs.createWriteStream(tmp));
      await fsp.rename(tmp, out);
      n++;
    }
    return n;
  }
  async install() {
    if (this.job?.status === 'running') throw httpError(409, 'An update is already being installed.');
    if (!this.last?.available) throw httpError(400, 'You already have the newest version.');
    if (!this.idle()) throw httpError(409, 'An import or another job is running. Install the update when it has finished.');
    const a = this.asset();
    if (!a) throw httpError(400, `The ${this.last.latest} release has no file for this kind of install (${this.kind}).`);
    this.job = { status: 'running', phase: 'download', pct: 0, to: this.last.latest, error: null };
    (async () => {
      try {
        await fsp.mkdir(this.dir, { recursive: true });
        const file = path.join(this.dir, a.name);
        await this.download(a, file);
        this.job.phase = 'install';
        if (this.kind === 'windows-installer') {
          // The installer stops this ModelVault, updates it and starts it again in the background.
          spawn(file, ['/S'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
          this.job.phase = 'restarting';
          return;
        }
        const entries = await readZipIndex(file);
        const top = [...entries.keys()][0]?.split('/')[0] || '';
        if (this.kind === 'windows-portable') {
          await this.copyFromZip(file, `${top}/app/`, this.root);
        } else {
          for (const part of ['server', 'public']) await this.copyFromZip(file, `${top}/${part}/`, path.join(this.root, part));
        }
        await rmQuiet(file);
        this.job.phase = 'restarting';
        // Docker's restart policy, or the Windows launcher, starts the new version.
        setTimeout(() => process.exit(0), 1500);
      } catch (e) {
        this.job = { ...this.job, status: 'error', error: e.message };
      }
    })();
    return this.status();
  }
}
