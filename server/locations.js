// Network folders (SMB / Windows shares) that ModelVault connects to itself, so nobody has to edit the
// Docker YAML to add a library. Needs the container to be allowed to mount (cap_add: SYS_ADMIN, once).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { httpError, safeName } from './files.js';

const MOUNT_BASE = process.env.LOCATIONS_DIR || '/mnt/modelvault';
// On Windows a share is opened by its \\host\share path; signing in uses "net use" when Windows has no access yet.
const WIN = process.platform === 'win32';
const uncOf = (loc) => `\\\\${loc.host}\\${loc.share}${loc.folder ? `\\${loc.folder.replace(/\//g, '\\')}` : ''}`;
const dirFor = (loc) => loc.localPath || (WIN ? uncOf(loc) : path.join(MOUNT_BASE, loc.key));
const run = (cmd, args, timeout = 30000) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr: String(stderr || '') })) : resolve(String(stdout))));
});
const have = (cmd) => run('sh', ['-c', `command -v ${cmd}`], 5000).then(() => true, () => false);

/** "\\nas\share\3D Models", "smb://host/share/x" or "//host/share" → { host, share, folder } */
export function parseNetworkPath(input) {
  let s = String(input || '').trim().replace(/^smb:/i, '').replace(/\\/g, '/');
  s = s.replace(/^\/+/, '');
  const [host, share, ...rest] = s.split('/').map((x) => x.trim()).filter(Boolean);
  if (!host || !share) throw httpError(400, 'Enter the network folder like \\\\nas\\SharedFolder\\Sub folder (copy it from the File Explorer address bar).');
  if (rest.some((p) => p === '..' || p === '.')) throw httpError(400, 'That folder path is not valid.');
  return { host, share, folder: rest.join('/') };
}

/** Turn mount.cifs errors into something a person can act on. */
function explain(e, loc) {
  const msg = `${e.stderr || ''} ${e.message || ''}`;
  if (/error\(13\)|permission denied/i.test(msg)) return `The NAS refused the username or password, or that account has no access to "${loc.share}". Check both, and that the account has Read/Write on the shared folder.`;
  if (/error\(2\)|no such file/i.test(msg)) return `"${loc.share}${loc.folder ? `/${loc.folder}` : ''}" was not found on ${loc.host}. Check the shared folder name and the folder path.`;
  if (/error\(112\)|host is down|error\(113\)|no route|error\(110\)|timed out|could not resolve|unable to find suitable address/i.test(msg)) return `Couldn't reach ${loc.host}. Check the address, that the NAS is on, and that SMB is enabled on it (Control Panel > File Services > SMB).`;
  if (/error\(1\)|operation not permitted|only root/i.test(msg)) return 'ModelVault is not allowed to connect network folders yet. Do the one-time setup shown above, then try again.';
  if (/error\(95\)|operation not supported|error\(22\)|invalid argument/i.test(msg)) return `The NAS didn't accept the connection settings. On ${loc.host}, check Control Panel > File Services > SMB > Advanced and allow SMB2 or SMB3.`;
  if (/error\(19\)|no such device|filesystem not supported/i.test(msg)) return 'This NAS does not support connecting to network folders from inside Docker.';
  return (msg.trim().split('\n').filter(Boolean).pop() || 'Could not connect').slice(0, 300);
}

export class Locations {
  constructor(lib, roots, dataDir) {
    this.lib = lib; this.roots = roots;
    this.credDir = path.join(dataDir, 'locations');
    this.status = new Map(); // key -> { mounted, error }
  }
  saved() { try { return JSON.parse(this.lib.db.prepare(`SELECT value FROM settings WHERE key = 'locations'`).get()?.value || '[]'); } catch { return []; } }
  save(list) { this.lib.setRaw('locations', JSON.stringify(list)); }

  /** Can this container mount network folders? (needs CAP_SYS_ADMIN) */
  async canMount() {
    if (WIN) return true;
    try {
      const capEff = /CapEff:\s*([0-9a-f]+)/i.exec(await fsp.readFile('/proc/self/status', 'utf8'))?.[1];
      return !!capEff && (BigInt(`0x${capEff}`) & (1n << 21n)) !== 0n;
    } catch { return false; }
  }
  /** mount.cifs is needed for credentials files and name lookup. Older images get it installed on first use. */
  async ensureTools() {
    if (await have('mount.cifs')) return;
    if (await have('apk')) { try { await run('apk', ['add', '--no-cache', 'cifs-utils'], 120000); } catch { /* reported below */ } }
    if (!(await have('mount.cifs'))) throw httpError(500, 'Network folder support could not be installed. In Container Manager, open the modelvault project and choose Build, then try again.');
  }
  async isMounted(dir) {
    const mounts = await fsp.readFile('/proc/mounts', 'utf8').catch(() => '');
    const esc = dir.replace(/ /g, '\\040');
    return mounts.split('\n').some((l) => l.split(' ')[1] === esc);
  }

  async mountOne(loc) {
    if (loc.localPath) {
      if (await fsp.readdir(loc.localPath).then(() => true, () => false)) return loc.localPath;
      throw httpError(400, `Can't open ${loc.localPath}. If it's a mapped drive or a network folder, open it once in File Explorer, then choose Reconnect.`);
    }
    if (WIN) return this.openWindows(loc);
    const dir = path.join(MOUNT_BASE, loc.key);
    await fsp.mkdir(dir, { recursive: true });
    if (await this.isMounted(dir)) return dir;
    await this.ensureTools();
    const unc = `//${loc.host}/${loc.share}${loc.folder ? `/${loc.folder}` : ''}`;
    const cred = path.join(this.credDir, `${loc.key}.cred`);
    let lastErr;
    // Newest protocol first; older NAS units sometimes only speak SMB 2.1.
    for (const vers of loc.vers ? [loc.vers] : ['3.0', '2.1']) {
      try {
        await run('mount', ['-t', 'cifs', unc, dir, '-o', `credentials=${cred},vers=${vers},uid=0,gid=0,file_mode=0777,dir_mode=0777,iocharset=utf8,noserverino,nobrl`]);
        loc.vers = vers;
        return dir;
      } catch (e) { lastErr = e; if (!/error\((95|22)\)|not supported|invalid argument/i.test(`${e.stderr} ${e.message}`)) break; }
    }
    throw httpError(400, explain(lastErr, loc));
  }

  /** Windows: check the share can be read; if not, sign in with "net use" (no drive letter) and check again. */
  async openWindows(loc) {
    const dir = uncOf(loc);
    const ok = () => fsp.readdir(dir).then(() => true, () => false);
    if (await ok()) return dir;
    const share = `\\\\${loc.host}\\${loc.share}`;
    let pass = '';
    try { pass = /^password=(.*)$/m.exec(await fsp.readFile(path.join(this.credDir, `${loc.key}.cred`), 'utf8'))?.[1] || ''; } catch { /* no saved password */ }
    try {
      if (loc.username) await run('net', ['use', share, pass, `/user:${loc.username}`, '/persistent:no'], 30000);
    } catch (e) {
      const msg = `${e.stderr || ''} ${e.message || ''}`;
      if (/1326|password|logon failure/i.test(msg)) throw httpError(400, `${loc.host} refused the username or password. Check both, and that the account can open "${loc.share}".`);
      if (/53|67|not found|network path/i.test(msg)) throw httpError(400, `Couldn't reach ${share}. Check the address, that the NAS is on, and that this PC can open it in File Explorer.`);
      if (!/1219/.test(msg)) throw httpError(400, (msg.trim().split('\n').filter(Boolean).pop() || 'Could not connect').slice(0, 300));
      // 1219: Windows is already signed in to that NAS as someone else; use that connection.
    }
    if (await ok()) return dir;
    throw httpError(400, `ModelVault can't open ${dir}. Open it once in File Explorer (and tick "Remember my credentials"), check the folder path, then try again.`);
  }

  /** Windows: add a folder on this PC, a mapped drive (M:\Models) or a \\server\share path chosen in the folder browser. */
  async addFolder({ folder, name }) {
    if (!WIN) throw httpError(400, 'Adding folders by browsing is for the Windows version. On the NAS, connect a network folder instead.');
    const abs = path.resolve(String(folder || '').trim());
    if (!folder || !(await fsp.stat(abs).then((s) => s.isDirectory(), () => false))) throw httpError(400, 'That folder could not be opened.');
    for (const [k, r] of Object.entries(this.roots)) if (path.resolve(r).toLowerCase() === abs.toLowerCase()) throw httpError(400, `That folder is already in ModelVault as "${this.lib.rootLabel?.(k) || k}".`);
    const label = String(name || '').trim() || path.basename(abs) || abs.replace(/[\\:]+$/, '');
    let key = safeName(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'folder';
    while (this.roots[key]) key = `${key}-2`;
    const loc = { key, label, localPath: abs };
    this.roots[key] = abs;
    this.status.set(key, { mounted: true });
    this.save([...this.saved(), loc]);
    return this.publicList();
  }

  async add({ name, networkPath, username, password }) {
    if (!(await this.canMount())) throw httpError(400, 'ModelVault is not allowed to connect network folders yet. Do the one-time setup shown above, then try again.');
    const { host, share, folder } = parseNetworkPath(networkPath);
    if (!WIN && !String(username || '').trim()) throw httpError(400, 'Enter the username for that NAS.');
    if (/[\n\r]/.test(String(username)) || /[\n\r]/.test(String(password || ''))) throw httpError(400, 'Username and password cannot contain line breaks.');
    const label = String(name || '').trim() || (folder ? folder.split('/').pop() : share);
    let key = safeName(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'network';
    while (this.roots[key]) key = `${key}-2`;
    const loc = { key, label, host, share, folder, username: String(username).trim() };
    await fsp.mkdir(this.credDir, { recursive: true, mode: 0o700 });
    const cred = path.join(this.credDir, `${key}.cred`);
    await fsp.writeFile(cred, `username=${loc.username}\npassword=${password || ''}\n`, { mode: 0o600 });
    try {
      const dir = await this.mountOne(loc);
      this.roots[key] = dir;
      this.status.set(key, { mounted: true });
      this.save([...this.saved(), loc]);
      return this.publicList();
    } catch (e) {
      await fsp.rm(cred, { force: true });
      if (!WIN) await fsp.rmdir(path.join(MOUNT_BASE, key)).catch(() => {});
      throw e;
    }
  }

  async remove(key) {
    const list = this.saved();
    const loc = list.find((l) => l.key === key);
    if (!loc) throw httpError(404, 'That network folder is not connected');
    const dir = dirFor(loc);
    const inUse = this.lib.db.prepare('SELECT COUNT(*) AS n FROM models WHERE path LIKE ?').get(`${dir}${path.sep}%`).n;
    if (!WIN) {
      if (await this.isMounted(dir)) await run('umount', ['-l', dir]).catch(() => {});
      await fsp.rmdir(dir).catch(() => {});
    }
    await fsp.rm(path.join(this.credDir, `${key}.cred`), { force: true });
    delete this.roots[key];
    this.status.delete(key);
    this.save(list.filter((l) => l.key !== key));
    return { removed: true, modelsLeft: inUse };
  }

  /** Reconnect saved folders when ModelVault starts (connections don't survive a container restart). */
  async boot() {
    const list = this.saved();
    if (!list.length) return;
    for (const loc of list) {
      const dir = dirFor(loc);
      this.roots[loc.key] = dir; // keep the location known even while it is offline
      try { await this.mountOne(loc); this.status.set(loc.key, { mounted: true }); console.log(`Connected network folder ${loc.label}`); }
      catch (e) { this.status.set(loc.key, { mounted: false, error: e.message }); console.log(`Could not connect network folder ${loc.label}: ${e.message}`); }
    }
    this.save(list); // remembers which SMB version worked
  }
  async retry(key) {
    const loc = this.saved().find((l) => l.key === key);
    if (!loc) throw httpError(404, 'That network folder is not connected');
    try { await this.mountOne(loc); this.status.set(key, { mounted: true }); }
    catch (e) { this.status.set(key, { mounted: false, error: e.message }); throw e; }
    return this.publicList();
  }
  publicList() {
    return this.saved().map(({ key, label, host, share, folder, username, localPath }) => ({
      key, label, path: localPath || `\\\\${host}\\${share}${folder ? `\\${folder.replace(/\//g, '\\')}` : ''}`, username, local: !!localPath,
      mounted: this.status.get(key)?.mounted ?? false, error: this.status.get(key)?.error || '',
    }));
  }
}

export const locationsDir = MOUNT_BASE;
export { fs };
