// ModelVault front end — no build step, plain ES modules.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k instanceof Node ? k : String(k));
  return n;
}
const svg = (d, extra = '') => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = d + extra; return s; };
const ICON = {
  chevron: '<path d="m7 10 5 5 5-5"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  star: '<path d="m12 3.5 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
  cube: '<path d="M12 3 4 7.5v9L12 21l8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  archive: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 4v3M12 9v2M12 13v2"/><rect x="10.5" y="15" width="3" height="3" rx=".8"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="m5 17 5-4.5 3.5 3 2.5-2 3 3"/>',
  video: '<rect x="3.5" y="6" width="12" height="12" rx="3"/><path d="m15.5 10.5 5-3v9l-5-3"/>',
  pdf: '<path d="M7 3.5h7l4.5 4.5v12.5H7z"/><path d="M14 3.5V8h4.5M9.5 13h6M9.5 16.5h4"/>',
  file: '<path d="M7 3.5h7l4.5 4.5v12.5H7z"/><path d="M14 3.5V8h4.5"/>',
  sliced: '<path d="M5 18h14M7 14.5h10M9 11h6M11 7.5h2"/>',
  model: '<path d="M12 3 4 7.5v9L12 21l8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.9 12.2a1.5 1.5 0 0 0 1.5 1.3h6.2a1.5 1.5 0 0 0 1.5-1.3L17.5 7M10 10.5v6M14 10.5v6"/>',
  left: '<path d="m14.5 6-6 6 6 6"/>',
  right: '<path d="m9.5 6 6 6-6 6"/>',
};
const kindIcon = (k) => ICON[k] || ICON.file;

async function api(method, url, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(url, opt);
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error(data?.error || data || `Request failed (${r.status})`);
  return data;
}
function toast(msg, err = false) {
  const t = el('div', { class: `toast${err ? ' err' : ''}` }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), err ? 7000 : 3500);
}
const fail = (e) => toast(e.message || String(e), true);
function fmtBytes(n) { if (n == null) return ''; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < 4) { n /= 1024; i++; } return `${n.toFixed(i && n < 10 ? 1 : 0)} ${u[i]}`; }
const encPath = (rel) => rel.split('/').map(encodeURIComponent).join('/');
const extOf = (n) => (n.match(/\.([^./]+)$/)?.[1] || '').toLowerCase();
const VIEW3D = ['stl', '3mf', 'obj'];
const MEDIA_IMG = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp'];
const MEDIA_VID = ['mp4', 'webm', 'mov', 'm4v'];
const ARCH = ['zip', '7z', 'rar'];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const splitTags = (s) => String(s || '').split(',').map((t) => t.trim()).filter(Boolean);

// ---------------- state ----------------
const state = {
  models: [], meta: { groups: [], designers: [], tags: [], settings: {}, roots: [] },
  view: 'all', q: '', sort: localStorage.getItem('mv.sort') || 'new',
  sel: { designer: new Set(), values: new Set(), tags: new Set(), kinds: new Set() },
  expanded: new Set(JSON.parse(localStorage.getItem('mv.expanded') || '["Designer","Type","Franchise"]')),
  showAll: new Set(),
  page: 1, pageSize: Number(localStorage.getItem('mv.pageSize') ?? 100), pageSig: '',
  mode: localStorage.getItem('mv.mode') || 'tiles', groupBy: localStorage.getItem('mv.group') || '', folderKey: null, picked: new Set(), pager: null,
  rendered: 0, list: [],
  drafts: [], uploads: new Map(), draftEdits: new Map(),
};
let valueIndex = new Map();

async function loadMeta() {
  state.meta = await api('GET', '/api/meta');
  $('#settings-btn')?.classList.toggle('has-dot', !!state.meta.update);
  if ($('#about-dot')) $('#about-dot').hidden = !state.meta.update;
  valueIndex = new Map();
  for (const g of state.meta.groups) for (const v of g.values) valueIndex.set(v.id, { ...v, group: g.name, groupId: g.id });
  $('#designer-list').replaceChildren(...state.meta.designers.map((d) => el('option', { value: d.name })));
  $('#tag-list').replaceChildren(...state.meta.tags.map((t) => el('option', { value: t.name })));
}
async function loadModels() { state.models = await api('GET', '/api/models'); outsideIds = new Set(state.models.filter((m) => m.inLibrary === false).map((m) => m.id)); }
function fillGroupBy() {
  const opts = groupOptions();
  if (!opts.some((o) => o[0] === state.groupBy)) state.groupBy = '';
  $('#group-by').replaceChildren(...opts.map(([v, l]) => el('option', { value: v, selected: v === state.groupBy }, v ? `Group by ${l.toLowerCase()}` : l)));
}
async function refresh() {
  await Promise.all([loadMeta(), loadModels()]);
  const ids = new Set(state.models.map((m) => m.id));
  for (const id of state.picked) if (!ids.has(id)) state.picked.delete(id);
  fillGroupBy(); renderFilters(); renderGrid();
}

// ---------------- filtering ----------------
const created = (m) => new Date(m.created_at.replace(' ', 'T') + 'Z').getTime();
function matches(m, skip) {
  if (state.view === 'fav' && !m.favorite) return false;
  if (state.view === 'recent' && Date.now() - created(m) > 7 * 864e5) return false;
  if (state.view === 'noams' && !m.noAms) return false;
  if (state.q) {
    const hay = [m.name, m.designer, m.year || '', m.noAms ? 'no ams noams multi-colour multicolour' : '', m.folder, ...m.tags, ...m.kinds, ...m.vals.map((v) => valueIndex.get(v)?.name || '')].join(' ').toLowerCase();
    if (!state.q.toLowerCase().split(/\s+/).every((t) => hay.includes(t))) return false;
  }
  if (skip !== 'designer' && state.sel.designer.size && !state.sel.designer.has(m.designer || '—')) return false;
  if (skip !== 'tags' && state.sel.tags.size && !m.tags.some((t) => state.sel.tags.has(t.toLowerCase()))) return false;
  if (skip !== 'kinds' && state.sel.kinds.size && !m.kinds.some((k) => state.sel.kinds.has(k))) return false;
  if (state.sel.values.size) {
    const byGroup = new Map();
    for (const v of state.sel.values) { const g = valueIndex.get(v)?.groupId; if (g === undefined || g === skip) continue; (byGroup.get(g) || byGroup.set(g, new Set()).get(g)).add(v); }
    for (const set of byGroup.values()) if (!m.vals.some((v) => set.has(v))) return false;
  }
  return true;
}
function sorted(list) {
  const s = state.sort;
  const cmp = {
    new: (a, b) => created(b) - created(a) || b.id - a.id,
    old: (a, b) => created(a) - created(b) || a.id - b.id,
    name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
    designer: (a, b) => (a.designer || '￿').localeCompare(b.designer || '￿', undefined, { sensitivity: 'base' }) || a.name.localeCompare(b.name),
    size: (a, b) => b.size - a.size,
    year: (a, b) => (b.year || 0) - (a.year || 0) || a.name.localeCompare(b.name),
  }[s];
  return list.slice().sort(cmp);
}
const anyFilter = () => state.q || state.sel.designer.size || state.sel.values.size || state.sel.tags.size || state.sel.kinds.size;

// ---------------- sidebar ----------------
function facet(title, options, selSet, keyOf = (o) => o.key) {
  if (!options.length) return null;
  const open = state.expanded.has(title);
  const limit = state.showAll.has(title) ? Infinity : 8;
  const id = `f-${title.replace(/\W+/g, '-')}`;
  const visible = options.filter((o, i) => i < limit || selSet.has(keyOf(o)));
  return el('div', { class: 'fgroup' },
    el('button', { 'aria-expanded': String(open), 'aria-controls': id, onclick: () => { open ? state.expanded.delete(title) : state.expanded.add(title); localStorage.setItem('mv.expanded', JSON.stringify([...state.expanded])); renderFilters(); } },
      title, svg(ICON.chevron)),
    open && el('div', { class: 'fopts', id, role: 'group', 'aria-label': title },
      visible.map((o) => el('label', { class: 'fopt' },
        el('input', { type: 'checkbox', checked: selSet.has(keyOf(o)), onchange: (e) => { e.target.checked ? selSet.add(keyOf(o)) : selSet.delete(keyOf(o)); renderFilters(); renderGrid(); } }),
        el('span', { class: 'fname', title: o.label }, o.label), el('span', { class: 'count' }, o.count))),
      options.length > limit && el('button', { class: 'more-btn', onclick: () => { state.showAll.add(title); renderFilters(); } }, `Show ${options.length - limit} more`)));
}
function renderFilters() {
  const ms = state.models;
  $('#count-all').textContent = ms.length;
  $('#count-fav').textContent = ms.filter((m) => m.favorite).length || '';
  $('#count-recent').textContent = ms.filter((m) => Date.now() - created(m) < 7 * 864e5).length || '';
  $('#count-noams').textContent = ms.filter((m) => m.noAms).length || '';
  const base = (skip) => ms.filter((m) => matches(m, skip));
  const groups = [];
  // Designer
  const dCount = new Map();
  for (const m of base('designer')) { const d = m.designer || '—'; dCount.set(d, (dCount.get(d) || 0) + 1); }
  groups.push(facet('Designer', [...dCount].sort((a, b) => (b[0] === '—') - (a[0] === '—') || a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }))
    .map(([k, c]) => ({ key: k, label: k === '—' ? 'No designer' : k, count: c })), state.sel.designer));
  // Category groups
  for (const g of state.meta.groups) {
    const counts = new Map();
    for (const m of base(g.id)) for (const v of m.vals) if (valueIndex.get(v)?.groupId === g.id) counts.set(v, (counts.get(v) || 0) + 1);
    const opts = g.values.filter((v) => counts.get(v.id) || state.sel.values.has(v.id)).map((v) => ({ key: v.id, label: v.name, count: counts.get(v.id) || 0 }));
    groups.push(facet(g.name, opts, state.sel.values));
  }
  // Tags
  const tCount = new Map();
  for (const m of base('tags')) for (const t of m.tags) { const k = t.toLowerCase(); tCount.set(k, { label: t, count: (tCount.get(k)?.count || 0) + 1 }); }
  groups.push(facet('Tags', [...tCount].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)), state.sel.tags));
  // File types
  const kCount = new Map();
  for (const m of base('kinds')) for (const k of m.kinds) kCount.set(k, (kCount.get(k) || 0) + 1);
  groups.push(facet('File types', [...kCount].sort((a, b) => b[1] - a[1]).map(([k, c]) => ({ key: k, label: k.toUpperCase(), count: c })), state.sel.kinds));
  $('#filters').replaceChildren(...groups.filter(Boolean));
  $('#clear-filters').hidden = !anyFilter();
  renderActiveChips();
}
function renderActiveChips() {
  const chips = [];
  const chip = (k, label, remove) => el('button', { class: 'chip', 'aria-label': `Remove filter ${k} ${label}`, onclick: () => { remove(); renderFilters(); renderGrid(); } }, el('span', { class: 'k' }, k), label, svg(ICON.x));
  for (const d of state.sel.designer) chips.push(chip('Designer', d === '—' ? 'None' : d, () => state.sel.designer.delete(d)));
  for (const v of state.sel.values) { const x = valueIndex.get(v); if (x) chips.push(chip(x.group, x.name, () => state.sel.values.delete(v))); }
  for (const t of state.sel.tags) chips.push(chip('Tag', t, () => state.sel.tags.delete(t)));
  for (const k of state.sel.kinds) chips.push(chip('Type', k.toUpperCase(), () => state.sel.kinds.delete(k)));
  $('#active-filters').replaceChildren(...chips);
}

// ---------------- grid, list and folder views ----------------
const PAGE = 60;
const fmtDate = (m) => new Date(created(m)).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const groupOptions = () => [['', 'No grouping'], ['designer', 'Designer'], ...state.meta.groups.map((g) => [`g:${g.id}`, g.name]), ['year', 'Year'], ['folder', 'Folder on disk']];
function keysFor(m, by) {
  if (by === 'designer') return [m.designer || 'No designer'];
  if (by === 'year') return [m.year ? String(m.year) : 'No year'];
  if (by === 'folder') return [m.folder || 'Library (top level)'];
  if (by.startsWith('g:')) {
    const gid = Number(by.slice(2));
    const names = m.vals.map((v) => valueIndex.get(v)).filter((v) => v && v.groupId === gid).map((v) => v.name);
    return names.length ? names : [`No ${(state.meta.groups.find((g) => g.id === gid)?.name || 'category').toLowerCase()}`];
  }
  return [''];
}
function grouped(list, by) {
  const map = new Map();
  for (const m of list) for (const k of keysFor(m, by)) (map.get(k) || map.set(k, []).get(k)).push(m);
  const none = (k) => (k.startsWith('No ') ? 1 : 0);
  return [...map].sort((a, b) => none(a[0]) - none(b[0]) || (by === 'year' ? b[0].localeCompare(a[0]) : a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' })));
}
function renderGrid() {
  state.list = sorted(state.models.filter((m) => matches(m)));
  state.rendered = 0; state.pager = null;
  // Back to page 1 whenever the search, filters, sort or view change (not when models are added or edited).
  const sig = JSON.stringify([state.q, state.view, state.sort, state.mode, state.groupBy, state.folderKey, ...Object.values(state.sel).map((x) => [...x].sort())]);
  if (sig !== state.pageSig) { state.pageSig = sig; state.page = 1; }
  const root = $('#grid');
  root.replaceChildren();
  const titles = { all: `${state.models.length.toLocaleString()} models`, fav: 'Favourites', recent: 'Added this week', noams: 'No AMS needed' };
  $('#result-title').textContent = anyFilter() ? `${state.list.length} of ${state.models.length} models` : titles[state.view];
  const total = state.models.reduce((s, m) => s + m.size, 0);
  $('#stats').textContent = `${state.models.length ? `${state.models.length} models, ${fmtBytes(total)} on disk. ` : ''}ModelVault ${state.meta.version || ''}`;
  const empty = $('#empty');
  if (!state.models.length) {
    empty.hidden = false;
    empty.replaceChildren(el('img', { class: 'empty-vault', src: '/brand/icon.svg', alt: '' }), el('h2', {}, 'Your library is empty'),
      el('p', {}, 'Drag ZIP, 7Z or RAR files anywhere on this page, pick files from your downloads folder, or bring in your Orynt3D library.'),
      el('button', { class: 'btn primary', onclick: () => $('#file-input').click() }, 'Add models'),
      el('button', { class: 'btn ghost', onclick: () => openBrowser() }, 'Browse downloads'),
      el('button', { class: 'btn ghost', onclick: () => openSettings('existing') }, 'Import existing library'));
  } else if (!state.list.length) {
    empty.hidden = false;
    empty.replaceChildren(el('h2', {}, 'No models match'), el('p', {}, 'Try fewer filters or a different search.'),
      el('button', { class: 'btn ghost', onclick: clearFilters }, 'Clear all filters'));
  } else empty.hidden = true;
  drawBulk();
  if (!state.list.length) return;

  const by = state.mode === 'folders' ? state.groupBy || 'designer' : state.groupBy;
  if (state.mode === 'folders') {
    const groups = grouped(state.list, by);
    const open = groups.find((g) => g[0] === state.folderKey);
    const label = groupOptions().find((o) => o[0] === by)?.[1] || 'Folders';
    if (!open) {
      state.folderKey = null;
      root.append(el('div', { class: 'grid folders' }, groups.map(folderCard)));
    } else {
      root.append(el('nav', { class: 'crumbs big', 'aria-label': 'Folder' },
        el('button', { onclick: () => { state.folderKey = null; renderGrid(); } }, `All ${label.toLowerCase()} folders`),
        el('span', { class: 'sep', 'aria-hidden': 'true' }, '/'), el('button', { 'aria-current': 'location' }, `${open[0]} (${open[1].length})`)),
      el('div', { class: 'grid' }, pageOf(open[1]).map(card)), pagerFor(open[1].length));
    }
  } else if (state.mode === 'list') {
    const tbody = el('tbody');
    const head = (t, cls) => el('th', { scope: 'col', class: cls }, t);
    root.append(el('div', { class: 'list-wrap' }, el('table', { class: 'mlist' },
      el('thead', {}, el('tr', {}, el('th', { class: 'c-pick' }, el('span', { class: 'sr-only' }, 'Select')), head('Model'), head('Designer'), head('Categories', 'c-cats'), head('Tags', 'c-tags'), head('Year', 'c-num'), head('Files', 'c-num'), head('Size', 'c-num'), head('Added', 'c-date'))), tbody)));
    if (by) for (const [k, items] of grouped(pageOf(state.list), by)) tbody.append(el('tr', { class: 'group-row' }, el('th', { colspan: 9, scope: 'colgroup' }, k, el('span', { class: 'count' }, ` ${items.length}`))), ...items.map(row));
    else if (state.pageSize) tbody.append(...pageOf(state.list).map(row));
    else { state.pager = { el: tbody, render: row }; renderMore(); }
    root.append(pagerFor(state.list.length));
  } else if (by) {
    for (const [k, items] of grouped(pageOf(state.list), by)) {
      root.append(el('section', { class: 'group' }, el('h2', { class: 'group-h' }, k, el('span', { class: 'count' }, items.length)), el('div', { class: 'grid' }, items.map(card))));
    }
  } else {
    if (state.pageSize) root.append(el('div', { class: 'grid' }, pageOf(state.list).map(card)));
    else { state.pager = { el: el('div', { class: 'grid' }), render: card }; root.append(state.pager.el); renderMore(); }
  }
  if (state.mode === 'tiles') root.append(pagerFor(state.list.length));
  queueThumbs();
}
// ---------------- pages ----------------
function pageOf(items) {
  if (!state.pageSize) return items;
  const pages = Math.max(1, Math.ceil(items.length / state.pageSize));
  state.page = Math.min(Math.max(1, state.page), pages);
  return items.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
}
function goPage(n) { state.page = n; renderGrid(); window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }); }
function pagerFor(total) {
  if (!state.pageSize || total <= state.pageSize) return '';
  const size = state.pageSize, pages = Math.ceil(total / size), cur = state.page;
  const from = (cur - 1) * size + 1, to = Math.min(total, cur * size);
  // 1 … 4 5 [6] 7 8 … 20
  const nums = [...new Set([1, cur - 2, cur - 1, cur, cur + 1, cur + 2, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const btns = [];
  nums.forEach((n, i) => {
    if (i && n - nums[i - 1] > 1) btns.push(el('span', { class: 'gap', 'aria-hidden': 'true' }, '…'));
    btns.push(el('button', { class: 'pg', 'aria-current': n === cur ? 'page' : null, 'aria-label': `Page ${n}`, onclick: () => goPage(n) }, n));
  });
  return el('nav', { class: 'pager', 'aria-label': 'Pages' },
    el('span', { class: 'pg-info' }, `Showing ${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}`),
    el('div', { class: 'pg-btns' },
      el('button', { class: 'pg wide', disabled: cur === 1, onclick: () => goPage(cur - 1) }, 'Previous'),
      ...btns,
      el('button', { class: 'pg wide', disabled: cur === pages, onclick: () => goPage(cur + 1) }, 'Next')));
}
function renderMore() {
  if (!state.pager) return;
  const next = state.list.slice(state.rendered, state.rendered + PAGE);
  state.rendered += next.length;
  state.pager.el.append(...next.map(state.pager.render));
}
function coverEl(m, { eager = false } = {}) {
  const wrap = el('div', { class: 'cover' });
  if (m.coverUrl && m.coverKind === 'video') {
    const v = el('video', { src: m.coverUrl, muted: true, loop: true, playsinline: true, preload: 'metadata', 'aria-hidden': 'true' });
    v.muted = true;
    wrap.append(v, el('span', { class: 'vid-badge' }, 'Video'));
  } else if (m.coverUrl || m.thumbUrl) {
    wrap.append(el('img', { src: m.coverUrl || m.thumbUrl, alt: '', loading: eager ? 'eager' : 'lazy', decoding: 'async', onerror: (e) => { e.target.replaceWith(asVideoOr(e.target.src, () => el('div', { class: 'ph' }, svg(ICON.cube)), { autoplay: true })); } }));
  } else wrap.append(el('div', { class: 'ph' }, svg(ICON.cube)));
  return wrap;
}
/** Many downloaded ".gif" files are really MP4 videos: when a picture won't load, try it as a video. */
function asVideoOr(src, fallback, { autoplay = false, controls = false } = {}) {
  if (/\/thumbs\//.test(src)) return fallback();
  const v = el('video', { src, muted: true, loop: true, playsinline: true, autoplay: autoplay && !reduceMotion, controls, preload: 'metadata' });
  v.muted = true;
  v.addEventListener('error', () => v.replaceWith(fallback()), { once: true });
  return v;
}
// A model's name as shown, from Settings > Library > Model name format. The saved name doesn't change.
function displayName(m, fmt = state.meta?.settings?.displayFormat) {
  fmt = String(fmt || '{name}');
  if (fmt.trim() === '{name}') return m.name;
  const val = (t) => {
    t = t.trim().toLowerCase();
    if (t === 'name') return m.name;
    if (t === 'designer') return m.designer || '';
    if (t === 'year') return m.year ? String(m.year) : '';
    return m.vals.map((v) => valueIndex.get(v)).filter((v) => v && v.group.toLowerCase() === t).map((v) => v.name).join(', ');
  };
  let out = fmt.replace(/\{([^{}]+)\}|<<([^<>]+)>>/g, (_, a, b) => val(a || b));
  out = out.replace(/\(\s*\)|\[\s*\]/g, ' ')                           // empty brackets
    .replace(/(\s*[-–—|·,:]\s*)(?:[-–—|·,:]\s*)+/g, '$1')               // separators left next to each other
    .replace(/^[\s\-–—|·,:]+|[\s\-–—|·,:]+$/g, '').replace(/\s{2,}/g, ' ');
  return out || m.name;
}
const typeNames = (m, group = 'Type') => m.vals.map((v) => valueIndex.get(v)).filter((v) => v && v.group === group).map((v) => v.name);
const pickBox = (m) => el('label', { class: 'pick', title: 'Select' }, el('input', { type: 'checkbox', checked: state.picked.has(m.id), 'aria-label': `Select ${m.name}`, onchange: () => togglePick(m.id) }));
const openClick = (m) => (e) => { if (e.ctrlKey || e.metaKey || e.shiftKey) { e.preventDefault(); togglePick(m.id); } else openModel(m.id); };
function card(m) {
  const sub = [m.designer, ...typeNames(m)].filter(Boolean).join(', ');
  const kinds = m.kinds.filter((k) => !ARCH.includes(k)).slice(0, 4);
  const c = el('article', { class: `card${state.picked.has(m.id) ? ' picked' : ''}`, dataset: { mid: m.id, kind: 'card' } },
    el('button', { class: 'card-open', 'aria-label': `${displayName(m)}${m.designer ? ` by ${m.designer}` : ''}`, onclick: openClick(m) },
      coverEl(m),
      el('div', { class: 'card-body' },
        el('span', { class: 'card-name', title: displayName(m) }, displayName(m)),
        el('span', { class: 'card-sub' }, sub || `${m.file_count} file${m.file_count === 1 ? '' : 's'}`),
        el('div', { class: 'card-kinds' }, kinds.map((k) => el('span', { class: `kind${VIEW3D.includes(k) ? ' k3d' : ''}` }, k.toUpperCase())), m.year && el('span', { class: 'kind yr' }, m.year),
          m.noAms && el('span', { class: 'kind noams', title: 'Multi-colour, no AMS needed' }, 'No AMS')))),
    pickBox(m),
    el('button', { class: `fav-btn${m.favorite ? ' on' : ''}`, 'aria-pressed': String(m.favorite), 'aria-label': m.favorite ? `Remove ${m.name} from favourites` : `Add ${m.name} to favourites`, onclick: () => toggleFav(m) }, svg(ICON.star)));
  const v = $('video', c);
  if (v && !reduceMotion) {
    c.addEventListener('mouseenter', () => v.play().catch(() => {}));
    c.addEventListener('focusin', () => v.play().catch(() => {}));
    c.addEventListener('mouseleave', () => v.pause());
    c.addEventListener('focusout', () => v.pause());
  }
  return c;
}
function row(m) {
  const cats = m.vals.map((v) => valueIndex.get(v)).filter(Boolean);
  return el('tr', { class: state.picked.has(m.id) ? 'picked' : '', dataset: { mid: m.id, kind: 'row' } },
    el('td', { class: 'c-pick' }, pickBox(m)),
    el('td', {}, el('button', { class: 'row-open', onclick: openClick(m) }, el('span', { class: 'row-thumb' }, m.coverUrl && m.coverKind !== 'video' || m.thumbUrl ? el('img', { src: m.coverKind === 'video' ? m.thumbUrl : m.coverUrl || m.thumbUrl, alt: '', loading: 'lazy' }) : svg(m.coverKind === 'video' ? ICON.video : ICON.cube)),
      el('span', { class: 'row-name' }, m.favorite && el('span', { class: 'row-star', title: 'Favourite' }, svg(ICON.star)), displayName(m), el('small', {}, [...m.kinds.map((k) => k.toUpperCase()), m.noAms ? 'No AMS' : ''].filter(Boolean).join(' ') || '')))),
    el('td', {}, m.designer || el('span', { class: 'muted' }, 'None')),
    el('td', { class: 'c-cats' }, cats.slice(0, 4).map((v) => el('span', { class: 'kind', title: v.group }, v.name)), cats.length > 4 && el('span', { class: 'muted' }, ` +${cats.length - 4}`)),
    el('td', { class: 'c-tags muted' }, m.tags.slice(0, 5).join(', ')),
    el('td', { class: 'c-num' }, m.year || ''),
    el('td', { class: 'c-num' }, m.file_count),
    el('td', { class: 'c-num' }, fmtBytes(m.size)),
    el('td', { class: 'c-date muted' }, fmtDate(m)));
}
function folderCard([key, items]) {
  const pics = items.map((m) => (m.coverKind === 'video' ? m.thumbUrl : m.coverUrl || m.thumbUrl)).filter(Boolean).slice(0, 3);
  return el('button', { class: 'folder-card', 'aria-label': `${key}, ${items.length} models`, onclick: () => { state.folderKey = key; renderGrid(); window.scrollTo({ top: 0 }); } },
    el('div', { class: `pile n${pics.length}` }, pics.length ? pics.map((src) => el('img', { src, alt: '', loading: 'lazy' })) : el('div', { class: 'ph' }, svg(ICON.folder))),
    el('span', { class: 'card-name' }, key), el('span', { class: 'card-sub' }, `${items.length} model${items.length === 1 ? '' : 's'}`));
}
function redrawModel(id) {
  const m = state.models.find((x) => x.id === id);
  if (m) for (const n of $$(`[data-mid="${id}"]`)) n.replaceWith(n.dataset.kind === 'row' ? row(m) : card(m));
}
function updateCard(m) {
  const i = state.models.findIndex((x) => x.id === m.id);
  if (i >= 0) state.models[i] = { ...state.models[i], ...m };
  redrawModel(m.id);
}
async function toggleFav(m) {
  try { updateCard(await api('PATCH', `/api/models/${m.id}`, { favorite: !m.favorite })); renderFilters(); if (state.view === 'fav') renderGrid(); }
  catch (e) { fail(e); }
}
new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting) && state.rendered < state.list.length) renderMore(); }, { rootMargin: '800px' }).observe($('#sentinel'));
function clearFilters() { for (const s of Object.values(state.sel)) s.clear(); state.q = ''; $('#search').value = ''; renderFilters(); renderGrid(); }

// ---------------- selection and bulk edit ----------------
// Models that live outside the library folder (for example indexed in place from Orynt3D).
let outsideIds = new Set();
async function moveIntoLibrary(ids) {
  const list = ids.filter((id) => outsideIds.has(id) || (current && current.id === id));
  if (!list.length) return toast('Those models are already in your library.');
  try {
    await api('POST', '/api/organize/apply', { ids: list, adopt: true });
    pollJobs(true);
    toast(`Moving ${list.length} model${list.length === 1 ? '' : 's'} into your library. Progress shows in the sidebar.`);
    if ($('#model-dlg').open) $('#model-dlg').close();
  } catch (e) { fail(e); }
}
function togglePick(id) { state.picked.has(id) ? state.picked.delete(id) : state.picked.add(id); redrawModel(id); drawBulk(); }
function drawBulk() {
  const bar = $('#bulk-bar'), n = state.picked.size;
  bar.hidden = !n;
  if (!n) return;
  bar.replaceChildren(el('b', {}, `${n} selected`),
    el('button', { class: 'btn small primary', onclick: openBulk }, 'Edit details'),
    el('button', { class: 'btn small ghost', onclick: () => bulkApply({ favorite: true }, 'Added to favourites') }, 'Favourite'),
    el('button', { class: 'btn small ghost', title: 'Rename folders and archives to your formats, tidy pictures', onclick: organizeSelected }, 'Organize'),
    [...state.picked].some((id) => outsideIds.has(id))
      ? el('button', { class: 'btn small ghost', onclick: () => moveIntoLibrary([...state.picked]) }, 'Move into library') : '',
    el('button', { class: 'btn small ghost', onclick: () => { for (const m of state.list) state.picked.add(m.id); renderGrid(); } }, `Select all ${state.list.length} shown`),
    el('button', { class: 'btn small ghost danger', onclick: async () => {
      if (await confirmDlg(`Remove ${n} models from the library?`, 'Their files stay on disk. Only the ModelVault entries are removed.', [{ label: 'Cancel', value: '' }, { label: 'Remove from library', value: 'y', cls: 'primary' }])) bulkApply({ remove: true }, 'Models removed');
    } }, 'Remove'),
    el('button', { class: 'btn small ghost', onclick: () => { state.picked.clear(); renderGrid(); } }, 'Clear'));
}
// Organize only the selected models: first fill in details read from their file names (reviewed here), then
// folder name, picture folders, archive names (and move in any outside the library).
const orgUi = { ids: [], list: [], off: new Set(), edits: new Map(), form: new Map(), teach: null, timers: new Map() };
async function organizeSelected() {
  const ids = [...state.picked];
  Object.assign(orgUi, { ids, off: new Set(), edits: new Map(), form: new Map(), teach: null });
  toast(`Reading the file names of ${ids.length} model${ids.length === 1 ? '' : 's'}…`);
  try { orgUi.list = await api('POST', '/api/models/suggest', { ids }); } catch (e) { return fail(e); }
  drawOrganize();
  const d = $('#org-dlg'); if (!d.open) d.showModal();
  // Always start at the top of the list (the browser would scroll to whatever it focused).
  $('#org-list .org-val')?.focus({ preventScroll: true });
  const top = () => { d.scrollTop = 0; $('#org-form').scrollTop = 0; };
  top(); requestAnimationFrame(top);
}
const archParts = () => { try { return JSON.parse(state.meta.settings.archiveParts || '[]').map((p) => p.label).filter(Boolean); } catch { return []; } };
// The words in an archive's name, to click and say what they mean.
const archWords = (stem) => [...new Set(String(stem).split(/[\s_\-.()[\]{}@+,&]+/).filter((w) => w && !/^\d{1,2}$/.test(w)))].slice(0, 14);
const splitTagList = (t) => [...new Set(String(t).split(',').map((x) => x.trim()).filter(Boolean))];
// Every detail of a model, starting from what it has plus what the file names suggest; all editable.
function formOf(x) {
  if (!orgUi.form.has(x.id)) {
    const c = x.changes, cur = x.current;
    orgUi.form.set(x.id, { name: c.name || cur.name, designer: c.designer || cur.designer || '', year: String(c.year || cur.year || ''), source_url: c.source_url || cur.source_url || '',
      tags: [...new Set([...cur.tags, ...(c.addTags || [])])].join(', '), values: new Set([...cur.vals, ...(c.addValues || []).map((v) => v.id)]) });
  }
  return orgUi.form.get(x.id);
}
// How many details differ from what the model has now.
function detailChanges(x) {
  const f = formOf(x), cur = x.current;
  let n = 0;
  if (f.name.trim() && f.name.trim() !== cur.name) n++;
  if (f.designer.trim() !== (cur.designer || '')) n++;
  if (String(f.year).trim() !== String(cur.year || '')) n++;
  if (f.source_url.trim() !== (cur.source_url || '')) n++;
  const t1 = splitTagList(f.tags).map((t) => t.toLowerCase()).sort().join('|'), t0 = [...cur.tags].map((t) => t.toLowerCase()).sort().join('|');
  if (t1 !== t0) n++;
  const was = new Set(cur.vals);
  n += [...f.values].filter((v) => !was.has(v)).length + cur.vals.filter((v) => !f.values.has(v)).length;
  return n;
}
function drawOrganize() {
  const n = orgUi.ids.length, s = state.meta.settings;
  const outside = orgUi.ids.filter((id) => outsideIds.has(id)).length;
  const what = ['folders follow your folder name format', 'picture folders become "img"', s.archiveAuto === 'true' && 'archives follow your archive name format', s.adoptOnSave === 'true' && outside && `${outside} model${outside === 1 ? '' : 's'} outside the library ${outside === 1 ? 'is' : 'are'} moved in`].filter(Boolean);
  $('#org-h').textContent = `Organize ${n} model${n === 1 ? '' : 's'}`;
  $('#org-intro').textContent = `${what.join(', ').replace(/^./, (c) => c.toUpperCase())}. Every detail can be changed below: suggestions from the file names are filled in and marked. Click a word in an archive's name to teach ModelVault what it means.`;
  const renames = (x) => x.archives.filter((a) => !a.keep && (a.newName !== a.current || !a.part));
  const tick = (key, extra = {}) => el('input', { type: 'checkbox', checked: !orgUi.off.has(key), dataset: { k: key }, ...extra });
  const parts = archParts();
  const groups = state.meta.groups.filter((g) => !/^status$/i.test(g.name));
  $('#org-list').replaceChildren(...orgUi.list.map((x) => {
    const c = x.changes, cur = x.current, id = x.id, f = formOf(x);
    const changed = () => { syncOrg(); previewOrg(id); };
    const sugg = new Set((c.addValues || []).map((v) => v.id));
    // One detail: label (amber when empty), the control, and a "suggested" mark.
    const field = (label, control, { suggested = false, empty = false, extra = '' } = {}) => el('div', { class: `org-field${empty ? ' is-empty' : ''}` },
      el('b', {}, label), el('div', { class: 'org-ctl' }, control, suggested ? el('span', { class: 'org-sugg', title: 'Read from the files' }, typeof suggested === 'string' ? suggested : 'suggested') : '', extra));
    const text = (key, attrs = {}) => el('input', { class: 'set-input org-val', value: f[key], spellcheck: 'false', autocomplete: 'off', ...attrs,
      oninput: (e) => { f[key] = e.target.value; e.target.closest('.org-field')?.classList.toggle('is-empty', !e.target.value.trim()); changed(); } });
    const nameIn = text('name', { 'aria-label': `Name of ${x.name}` });
    const archRows = renames(x).map((a) => archRow(x, a, parts, tick));
    return el('section', { class: 'org-card', dataset: { id }, 'aria-label': x.name },
      el('h3', { class: 'org-name' }, x.name),
      el('div', { class: 'org-fields' },
        field('Name', nameIn, { suggested: !!c.name, extra: c.name ? el('button', { type: 'button', class: 'link-inline org-undo', onclick: () => { f.name = cur.name; nameIn.value = cur.name; changed(); } }, 'Keep the old name') : '' }),
        field('Designer', text('designer', { list: 'designer-list', placeholder: 'Who made it?', 'aria-label': `Designer of ${x.name}` }), { suggested: !!c.designer, empty: !f.designer }),
        field('Year', text('year', { type: 'number', min: 1990, max: 2200, placeholder: 'Year', class: 'set-input org-val org-year', 'aria-label': `Year of ${x.name}` }), { suggested: c.yearFrom ? `from ${c.yearFrom}` : !!c.year, empty: !f.year }),
        ...groups.map((g) => field(g.name, groupPick(g, f, changed, sugg), { suggested: g.values.some((v) => sugg.has(v.id)), empty: !g.values.some((v) => f.values.has(v.id)) })),
        field('Tags', text('tags', { list: 'tag-list', placeholder: 'Comma separated', 'aria-label': `Tags of ${x.name}` }), { suggested: !!c.addTags?.length, empty: !f.tags.trim() }),
        field('Source link', text('source_url', { type: 'url', placeholder: 'https://…', 'aria-label': `Source link of ${x.name}` }), { suggested: !!c.source_url, empty: !f.source_url })),
      ...archRows);
  }));
  const archTicks = $$('#org-list .org-arch input[type=checkbox]');
  const toggleAll = (on) => { archTicks.forEach((i) => { i.checked = on; i.dispatchEvent(new Event('change', { bubbles: true })); }); };
  $('#org-bar').replaceChildren(archTicks.length ? el('span', { class: 'muted' }, 'Archive renames:') : '',
    archTicks.length ? el('button', { type: 'button', class: 'link-inline', onclick: () => toggleAll(true) }, 'Tick all') : '',
    archTicks.length ? el('button', { type: 'button', class: 'link-inline', onclick: () => toggleAll(false) }, 'Untick all') : '');
  $('#org-list').onchange = (e) => {
    const k = e.target.dataset?.k; if (!k) return;
    e.target.checked ? orgUi.off.delete(k) : orgUi.off.add(k);
    syncOrg();
  };
  syncOrg();
  for (const x of orgUi.list) if (detailChanges(x) || [...orgUi.edits.keys()].some((k) => k.startsWith(`a:${x.id}:`))) previewOrg(x.id);
}
// One archive: tick to rename, its words to teach, and its own part, scale or whole name.
function archRow(x, a, parts, tick) {
  const id = x.id, k = `a:${id}:${a.key}`, ed = orgUi.edits.get(k);
  const to = el('span', { class: 'org-to' }, a.newName);
  const same = a.newName === a.current && !ed;
  const label = a.parts > 1 ? `Archive (${a.parts} parts)` : 'Archive';
  const row = el('div', { class: 'org-arch', dataset: { key: a.key } },
    same
      ? el('div', { class: 'org-change' }, el('span', { class: 'org-nobox' }), el('span', {}, el('b', {}, label), ' ', el('span', { class: 'org-to' }, a.current), ' ', el('span', { class: 'org-missing' }, 'no part found')))
      : el('label', { class: 'org-change' }, tick(k, { 'aria-label': `Rename ${a.current}` }),
        el('span', {}, el('b', {}, label), ' ', el('span', { class: 'org-from' }, a.current), el('span', { class: 'arrow' }, ' → '), to)),
    el('div', { class: 'org-words', role: 'group', 'aria-label': `Words in ${a.current}` },
      el('span', { class: 'muted' }, 'Words:'),
      ...archWords(a.stem).map((w) => el('button', { type: 'button', class: `tog${orgUi.teach?.word === w.toLowerCase() && orgUi.teach?.k === k ? ' on' : ''}`, onclick: () => { orgUi.teach = orgUi.teach?.k === k && orgUi.teach?.word === w.toLowerCase() ? null : { k, word: w.toLowerCase() }; drawOrganize(); } }, w)),
      el('button', { type: 'button', class: 'link-inline', onclick: () => { if (orgUi.edits.has(k)) orgUi.edits.delete(k); else orgUi.edits.set(k, { part: a.part, scale: a.scale, name: a.name || '' }); drawOrganize(); } }, ed ? 'Use the detected name' : 'Change the name')));
  if (orgUi.teach?.k === k) {
    const word = orgUi.teach.word;
    const custom = el('input', { class: 'set-input', placeholder: 'Or a new part…', 'aria-label': `New part for "${word}"` });
    const teach = async (lbl) => {
      if (!lbl) return;
      try {
        await api('POST', '/api/archives/teach', { word, label: lbl });
        await loadMeta();
        orgUi.list = await api('POST', '/api/models/suggest', { ids: orgUi.ids });
        orgUi.teach = null; drawOrganize();
        toast(`"${word}" now means ${lbl} in archive names. Saved in Settings > Archive names.`);
      } catch (e) { fail(e); }
    };
    custom.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); teach(custom.value.trim()); } });
    row.append(el('div', { class: 'org-teach' }, el('span', {}, el('b', {}, `"${word}"`), ' means'),
      ...parts.map((l) => el('button', { type: 'button', class: 'tog', onclick: () => teach(l) }, l)), custom,
      el('button', { type: 'button', class: 'btn small ghost', onclick: () => teach(custom.value.trim()) }, 'Save')));
  }
  if (ed) {
    const sel = new Set(parts.filter((l) => (` ${ed.part} `).includes(` ${l} `)));
    const other = el('input', { class: 'set-input', value: parts.reduce((r, l) => (sel.has(l) ? r.replace(l, '') : r), ed.part).replace(/\s+/g, ' ').trim(), placeholder: 'Something else…', 'aria-label': 'Other part' });
    const scale = el('input', { class: 'set-input', value: ed.scale, list: 'arch-scales', placeholder: 'Scale', 'aria-label': 'Scale' });
    const whole = el('input', { class: 'set-input org-whole', value: ed.name || '', placeholder: `Or type the whole name, e.g. ${a.newName.replace(/\.[^.]+$/, '')}`, 'aria-label': `Whole new name for ${a.current}`, spellcheck: 'false' });
    const box = el('div', { class: 'org-edit' });
    const upd = () => { ed.part = [...parts.filter((l) => sel.has(l)), other.value.trim()].filter(Boolean).join(' '); ed.scale = scale.value.trim(); ed.name = whole.value.trim(); box.classList.toggle('typed', !!ed.name); previewOrg(id); };
    other.addEventListener('input', upd); scale.addEventListener('input', upd); whole.addEventListener('input', upd);
    box.append(el('div', { class: 'org-by-parts' },
      el('span', { class: 'muted' }, 'Parts (pick one or more)'),
      el('div', { class: 'cat-chips' }, ...parts.map((l) => el('button', { type: 'button', class: 'tog', 'aria-pressed': String(sel.has(l)), onclick: (e) => { sel.has(l) ? sel.delete(l) : sel.add(l); e.currentTarget.setAttribute('aria-pressed', String(sel.has(l))); upd(); } }, l)), other), scale),
      el('label', { class: 'org-whole-row' }, el('span', { class: 'muted' }, 'Whole name'), whole, el('span', { class: 'muted' }, a.suffix)));
    box.classList.toggle('typed', !!ed.name);
    row.append(box);
  }
  row.to = to;
  return row;
}
// New values typed in lower case get capitals: "pixar" → "Pixar".
const niceNew = (x) => { const n = String(x).trim(); return n === n.toLowerCase() ? n.replace(/(^|\s)(\S)/g, (_, a, b) => a + b.toUpperCase()) : n; };
// A category: what's chosen (any number), the most used values, and a search that can add new ones.
function groupPick(g, f, changed, sugg = new Set()) {
  const chips = el('div', { class: 'cat-chips' });
  let q = '';
  const draw = () => {
    const t = q.toLowerCase();
    const shown = t ? g.values.filter((v) => v.name.toLowerCase().includes(t)).slice(0, 12)
      : [...g.values].sort((a, b) => (b.count || 0) - (a.count || 0) || a.name.localeCompare(b.name)).slice(0, 5);
    const chosen = g.values.filter((v) => f.values.has(v.id) && !shown.includes(v));
    const exact = g.values.some((v) => v.name.toLowerCase() === t);
    chips.replaceChildren(...[...chosen, ...shown].map((v) => el('button', { type: 'button', class: `tog${sugg.has(v.id) ? ' sugg' : ''}`, 'aria-pressed': String(f.values.has(v.id)), title: sugg.has(v.id) ? 'Suggested from the file names' : undefined,
      onclick: () => { f.values.has(v.id) ? f.values.delete(v.id) : f.values.add(v.id); draw(); changed(); chips.closest('.org-field')?.classList.toggle('is-empty', !g.values.some((x) => f.values.has(x.id))); } }, v.name)),
    t && !exact ? el('button', { type: 'button', class: 'tog add offer', onclick: addNew }, `+ Add "${niceNew(q)}" to ${g.name}`) : '');
  };
  async function addNew() {
    const name = niceNew(q);
    if (!name) return;
    try {
      const { id } = await api('POST', `/api/groups/${g.id}/values`, { name });
      if (!g.values.some((v) => v.id === id)) g.values.push({ id, name, count: 0 });
      f.values.add(id);
      q = ''; search.value = '';
      draw(); changed();
      chips.closest('.org-field')?.classList.remove('is-empty');
      await loadMeta(); renderFilters();
      toast(`Added ${name} to ${g.name}`);
    } catch (e) { fail(e); }
  }
  const search = el('input', { type: 'search', class: 'set-input org-search', placeholder: `Search or add…`, 'aria-label': `Search or add ${g.name}`, autocomplete: 'off', oninput: (e) => { q = e.target.value.trim(); draw(); } });
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const t = q.toLowerCase(); if (!t) return;
    const exact = g.values.find((v) => v.name.toLowerCase() === t);
    const hits = g.values.filter((v) => v.name.toLowerCase().includes(t));
    if (exact || hits.length === 1) { f.values.add((exact || hits[0]).id); q = ''; search.value = ''; draw(); changed(); chips.closest('.org-field')?.classList.remove('is-empty'); }
    else if (!hits.length) addNew();
  });
  draw();
  return el('div', { class: 'org-pick' }, chips, search);
}
function syncOrg() {
  const details = orgUi.list.reduce((n, x) => n + detailChanges(x), 0);
  const archives = $$('#org-list .org-arch input[type=checkbox]:checked').length + [...orgUi.edits.keys()].filter((k) => !orgUi.off.has(k) && !$(`#org-list .org-arch input[data-k="${CSS.escape(k)}"]`)).length;
  const total = details + archives;
  $('#org-go').textContent = total ? `Apply ${total} change${total === 1 ? '' : 's'} and organize` : 'Organize';
}
// What one model's details and archive choices add up to (only what differs from now).
function orgItem(x) {
  const f = formOf(x), cur = x.current, id = x.id, item = { id, archives: {} };
  if (f.name.trim() && f.name.trim() !== cur.name) item.name = f.name.trim();
  if (f.designer.trim() !== (cur.designer || '')) item.designer = f.designer.trim();
  if (String(f.year).trim() !== String(cur.year || '')) { const y = Number(f.year); item.year = y >= 1900 && y <= 2200 ? y : null; }
  if (f.source_url.trim() !== (cur.source_url || '')) item.source_url = f.source_url.trim();
  const tags = splitTagList(f.tags);
  if (tags.map((t) => t.toLowerCase()).sort().join('|') !== [...cur.tags].map((t) => t.toLowerCase()).sort().join('|')) item.tags = tags;
  const was = new Set(cur.vals);
  if (f.values.size !== was.size || [...f.values].some((v) => !was.has(v))) item.values = [...f.values];
  for (const a of x.archives.filter((r) => !r.keep)) {
    const k = `a:${id}:${a.key}`;
    if (a.newName !== a.current && orgUi.off.has(k)) item.archives[a.key] = { keep: true };
    else if (orgUi.edits.has(k)) item.archives[a.key] = { ...orgUi.edits.get(k) };
  }
  return item;
}
function previewOrg(id) {
  clearTimeout(orgUi.timers.get(id));
  orgUi.timers.set(id, setTimeout(async () => {
    const x = orgUi.list.find((y) => y.id === id), card = $(`#org-list .org-card[data-id="${id}"]`);
    if (!x || !card || !$$('.org-arch', card).length) return;
    const it = orgItem(x), f = formOf(x);
    try {
      const names = await api('POST', `/api/models/${id}/archives/preview`, { items: it.archives, as: { name: f.name.trim() || x.current.name, designer: f.designer.trim(), year: Number(f.year) || null, values: [...f.values] } });
      for (const row of $$('.org-arch', card)) if (names[row.dataset.key]) row.to.textContent = names[row.dataset.key];
    } catch { /* keep the last names */ }
  }, 200));
}
$('#org-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const items = orgUi.list.map(orgItem);
  try {
    const r = await api('POST', '/api/models/apply-suggestions', { items, ids: orgUi.ids });
    $('#org-dlg').close();
    state.picked.clear(); // done with this selection
    pollJobs(true);
    toast(`${r.changed ? `Updated ${r.changed} model${r.changed === 1 ? '' : 's'}. ` : ''}Organizing ${orgUi.ids.length}; progress shows in the sidebar.`);
    await refresh();
  } catch (err) { fail(err); }
});
let bulkValues = new Set();
function openBulk() {
  bulkValues = new Set();
  $('#bulk-form').reset();
  $('#bulk-h').textContent = `Edit ${state.picked.size} selected models`;
  $('#bulk-cats').replaceChildren(catPicker(bulkValues));
  $('#bulk-dlg').showModal();
}
async function bulkApply(body, done, { unselect = false } = {}) {
  try {
    const r = await api('POST', '/api/models/bulk', { ids: [...state.picked], ...body });
    if (r.job) { pollJobs(true); done += `. ${r.job ? 'Models from other locations are moving into your library; progress shows in the sidebar.' : ''}`; }
    if (body.remove || unselect) state.picked.clear(); // saved: the selection is done with
    toast(done); await refresh();
  } catch (e) { fail(e); }
}
$('#bulk-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  await bulkApply({ designer: f.designer.value, year: f.year.value ? Number(f.year.value) : undefined, addTags: splitTags(f.tags.value), addValues: [...bulkValues], ...(f.noAms.value ? { noAms: f.noAms.value === 'yes' } : {}) }, 'Changes applied', { unselect: true });
  $('#bulk-dlg').close();
});

// ---------------- auto 3D previews ----------------
const thumbTried = new Set();
let thumbBusy = false;
async function queueThumbs() {
  if (thumbBusy || state.meta.settings.autoThumbs !== 'true') return;
  thumbBusy = true;
  try {
    for (;;) {
      const m = state.list.find((x) => !x.cover && !x.thumb && !thumbTried.has(x.id) && x.kinds.some((k) => VIEW3D.includes(k)));
      if (!m) break;
      thumbTried.add(m.id);
      try {
        const d = await api('GET', `/api/models/${m.id}`);
        const f = d.files.filter((x) => VIEW3D.includes(extOf(x.rel)) && x.size < 80 * 1024 * 1024)
          .sort((a, b) => (extOf(a.rel) === 'stl' ? 0 : 1) - (extOf(b.rel) === 'stl' ? 0 : 1) || b.size - a.size)[0];
        let url = f && `/files/${m.id}/${encPath(f.rel)}`, ext = f && extOf(f.rel);
        if (!f) {
          const zip = d.files.find((x) => ARCH.includes(extOf(x.rel)) || /\.(7z|zip|rar)\.001$/i.test(x.rel));
          if (!zip) continue;
          const { entries } = await api('GET', `/api/models/${m.id}/archive?rel=${encodeURIComponent(zip.rel)}`);
          const e = entries.filter((x) => VIEW3D.includes(extOf(x.path)) && x.size < 80 * 1024 * 1024).sort((a, b) => (extOf(a.path) === 'stl' ? 0 : 1) - (extOf(b.path) === 'stl' ? 0 : 1) || b.size - a.size)[0];
          if (!e) continue;
          url = `/api/models/${m.id}/archive-file?rel=${encodeURIComponent(zip.rel)}&entry=${encodeURIComponent(e.path)}`; ext = extOf(e.path);
        }
        const { renderThumb } = await import('./viewer.js');
        const blob = await renderThumb(url, ext);
        const r = await fetch(`/api/models/${m.id}/thumb`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: blob });
        if (r.ok) updateCard(await r.json());
      } catch (e) { console.warn('Preview failed for', m.name, e); }
    }
  } finally { thumbBusy = false; }
}

// ---------------- paste a picture ----------------
// Copy a picture anywhere (a web page, a chat app, a file in Explorer) and paste it: it becomes the cover of the open
// model, or of the import you're working on. A copied picture link is downloaded by the server.
const PASTE_KEY = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘V' : 'Ctrl+V';
const pasteUi = { draft: null };
for (const ev of ['pointerdown', 'focusin', 'pointerover']) document.addEventListener(ev, (e) => { const a = e.target.closest?.('#imports-dlg article.draft[data-id]'); if (a) pasteUi.draft = a.dataset.id; });
const MEDIA_RE = /\.(jpe?g|png|gif|webp|avif|bmp|mp4|webm|mov|m4v)$/i;
function pastedMedia(cb) {
  const files = [...(cb.files || [])].filter((f) => /^(image|video)\//.test(f.type) || MEDIA_RE.test(f.name));
  if (!files.length) for (const it of cb.items || []) if (it.kind === 'file' && /^image\//.test(it.type)) { const f = it.getAsFile(); if (f) files.push(f); }
  const f = files[0];
  if (!f) return null;
  // Pasted screenshots and copied pictures are all called "image.png"; give them a name that says where they came from.
  if (!f.name || /^image\.\w+$/i.test(f.name)) {
    const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/\W.*/, '');
    const t = new Date(); const pad = (n) => String(n).padStart(2, '0');
    return new File([f], `Pasted ${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}.${ext}`, { type: f.type });
  }
  return f;
}
function pastedLink(cb) {
  const html = cb.getData('text/html') || '';
  const img = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  const text = (cb.getData('text/plain') || '').trim();
  const url = img ? img[1] : text;
  if (/^data:image\//i.test(url)) return url;
  if (/^https?:\/\/\S+$/i.test(url) && (img || /\.(jpe?g|png|gif|webp|avif|bmp)(\?|#|$)/i.test(url))) return url;
  return null;
}
async function linkToFile(url) {
  if (url.startsWith('data:')) { const b = await (await fetch(url)).blob(); return new File([b], `Pasted.${(b.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: b.type }); }
  toast('Downloading the picture…');
  const r = await fetch('/api/fetch-image', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) });
  if (!r.ok) { let m = 'The picture could not be downloaded.'; try { m = (await r.json()).error || m; } catch { /* not JSON */ } throw new Error(m); }
  const b = await r.blob();
  const name = decodeURIComponent((r.headers.get('x-file-name') || 'Pasted picture.jpg'));
  return new File([b], name, { type: b.type });
}
/** Where a pasted picture goes: the open model, else the import being worked on. */
function pasteTarget() {
  if (modelDlgOpen()) return { kind: 'model' };
  if (!$('#imports-dlg').open) return null;
  const cards = $$('#imports-dlg article.draft[data-id]').filter((a) => a.pasteCover);
  const card = cards.find((a) => a.dataset.id === pasteUi.draft) || (cards.length === 1 ? cards[0] : null);
  return card ? { kind: 'draft', card } : { kind: 'pick', count: cards.length };
}
document.addEventListener('paste', async (e) => {
  const cb = e.clipboardData; if (!cb) return;
  const target = pasteTarget(); if (!target) return;
  const inField = e.target.closest?.('input, textarea, [contenteditable=""], [contenteditable=true]');
  let file = pastedMedia(cb);
  // Text pasted into a field stays text; a link only becomes a cover when it isn't pasted into a field.
  const link = !file && !inField ? pastedLink(cb) : null;
  if (!file && !link) return;
  e.preventDefault();
  if (target.kind === 'pick') { toast(target.count ? 'Click the import the picture is for, then paste again.' : 'There\'s no import ready for a cover yet.', true); return; }
  try {
    if (!file) file = await linkToFile(link);
    if (!/^(image|video)\//.test(file.type) && !MEDIA_RE.test(file.name)) throw new Error('That isn\'t a picture.');
    if (target.kind === 'draft') return await target.card.pasteCover(file);
    if (current?.cover && !(await confirmDlg('Replace the cover?', `${displayName(current)} already has a cover. The pasted picture becomes the new cover, and the old one is kept in the img folder.`,
      [{ label: 'Cancel', value: '' }, { label: 'Replace cover', value: 'y', cls: 'primary' }]))) return;
    await coverToModel([file]);
  } catch (err) { fail(err); }
});

// ---------------- drag & drop / upload ----------------
let dragDepth = 0;
const modelDlgOpen = () => $('#model-dlg').open;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types?.includes('Files')) return;
  e.preventDefault(); dragDepth++;
  // Over an open model: choose between making it the cover and adding it to the files.
  if (modelDlgOpen()) $('#model-drop').hidden = false;
  else if (!$('#imports-dlg').open) $('#drop').classList.add('on');
});
const endModelDrop = () => { $('#model-drop').hidden = true; $$('#model-drop .mdrop-zone').forEach((z) => z.classList.remove('over')); };
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop').classList.remove('on'); endModelDrop(); } });
for (const zone of $$('#model-drop .mdrop-zone')) {
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = [...e.dataTransfer.files];
    dragDepth = 0; endModelDrop();
    if (zone.dataset.mdrop === 'cover') coverToModel(files); else addFilesToModel(files);
  });
}
window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
window.addEventListener('drop', async (e) => {
  if (!e.dataTransfer?.types?.includes('Files')) return;
  e.preventDefault(); dragDepth = 0; $('#drop').classList.remove('on'); endModelDrop();
  if (e.target.closest?.('[data-dropzone]')) return; // handled by that zone
  if (modelDlgOpen()) return addFilesToModel([...e.dataTransfer.files]);
  const entries = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  const groups = entries.length ? await groupEntries(entries) : groupFiles([...e.dataTransfer.files].map((f) => ({ file: f, path: f.name })));
  startUploads(await askGrouping(groups));
});
$('#upload-btn').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', async (e) => { const g = groupFiles([...e.target.files].map((f) => ({ file: f, path: f.name }))); e.target.value = ''; startUploads(await askGrouping(g)); });

async function readEntry(entry, prefix = '') {
  if (entry.isFile) return [{ file: await new Promise((r, j) => entry.file(r, j)), path: prefix + entry.name }];
  const reader = entry.createReader(), out = [];
  for (;;) {
    const batch = await new Promise((r, j) => reader.readEntries(r, j));
    if (!batch.length) break;
    for (const c of batch) out.push(...(await readEntry(c, `${prefix}${entry.name}/`)));
  }
  return out;
}
async function groupEntries(entries) {
  const groups = [], loose = [];
  for (const en of entries) {
    const files = await readEntry(en);
    if (en.isDirectory) { if (files.length) groups.push({ name: en.name, files }); }
    else loose.push(...files);
  }
  return groups.concat(groupFiles(loose));
}
/** Archives → one model each. Everything else → one model together (one archive plus images = one model). */
function groupFiles(items) {
  const isArc = (i) => ARCH.includes(extOf(i.path)) || /\.((7z|zip|rar)\.\d{3}|[zr]\d{2})$/i.test(i.path);
  const archives = items.filter(isArc);
  const others = items.filter((i) => !isArc(i));
  if (archives.length === 1 && others.every((o) => [...MEDIA_IMG, ...MEDIA_VID, 'pdf', 'txt', 'md'].includes(extOf(o.path)))) return [{ name: archives[0].path, files: items }];
  const g = archives.map((a) => ({ name: a.path, files: [a] }));
  if (others.length) g.push({ name: others[0].path, files: others });
  return g;
}
/** Several archives dropped together: one model in several downloads, or separate models? */
const partKey = (n) => n.toLowerCase().replace(/\.(part\d+\.rar|(7z|zip|rar)\.\d{3}|[zr]\d{2})$/, '').replace(/\.[a-z0-9]{1,6}$/, '');
async function askGrouping(groups) {
  // Parts of one split archive (name.part1.rar, name.7z.001 …) always belong together.
  const merged = [];
  for (const g of groups) {
    const key = g.files.length === 1 && /\.(part\d+\.rar|(7z|zip|rar)\.\d{3}|[zr]\d{2})$/i.test(g.files[0].path) ? partKey(g.files[0].path) : null;
    const host = key && merged.find((m) => m.key === key);
    if (host) host.files.push(...g.files); else merged.push({ ...g, key });
  }
  if (merged.length < 2) return merged;
  const choice = await confirmDlg(`You dropped ${merged.length} separate items`, 'Are these all parts of one model, or different models?', [
    { label: 'Cancel', value: 'cancel' }, { label: `${merged.length} separate models`, value: 'many', cls: 'ghost' }, { label: 'One model', value: 'one', cls: 'primary' }]);
  if (choice === 'one') return [{ name: merged[0].name, files: merged.flatMap((g) => g.files) }];
  return choice === 'many' ? merged : [];
}
function startUploads(groups) {
  if (!groups.length) return;
  openImports();
  for (const g of groups) startOne(g);
  renderImports();
}
async function startOne(g) {
  {
    // Files that already sit in a folder the NAS can see are moved (or copied) there directly: no upload needed.
    if (g.files.every((f) => !f.path.includes('/'))) {
      try {
        const r = await api('POST', '/api/drafts/from-local', { files: g.files.map((f) => ({ name: f.file.name, size: f.file.size })) });
        if (r.matched) { toast(`${g.name.split('/').pop()}: ${state.meta.settings.importMode === 'copy' ? 'copying' : 'moving'} from your NAS folder`); return pollDrafts(); }
      } catch { /* fall back to uploading */ }
    }
    const key = `u${Math.random().toString(36).slice(2)}`;
    const total = g.files.reduce((s, f) => s + f.file.size, 0);
    state.uploads.set(key, { name: g.name.split('/').pop(), loaded: 0, total });
    const fd = new FormData();
    fd.append('paths', JSON.stringify(g.files.map((f) => f.path)));
    for (const f of g.files) fd.append('file', f.file, f.file.name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/drafts/upload');
    xhr.upload.onprogress = (e) => { const u = state.uploads.get(key); if (u) { u.loaded = e.loaded; u.total = e.total || u.total; renderImports(); } };
    xhr.onload = () => {
      state.uploads.delete(key);
      if (xhr.status >= 300) { let m = 'Upload failed'; try { m = JSON.parse(xhr.responseText).error; } catch { /* */ } toast(`${g.name}: ${m}`, true); }
      pollDrafts();
    };
    xhr.onerror = () => { state.uploads.delete(key); toast(`${g.name}: upload failed. Check the connection to your NAS.`, true); renderImports(); };
    xhr.send(fd);
    renderImports();
  }
}

// ---------------- category picker (shared) ----------------
const TOP_VALUES = 5; // bigger categories show only their most used values (plus the chosen ones); search finds the rest
function catPicker(selected, onChange, { compact = false } = {}) {
  const box = el('div', { class: 'cats' });
  let moreOpen = false;
  const showAll = new Set(); // group ids opened with "Show all"
  const queries = new Map(); // group id -> what's typed in its search box
  let refocus = null;        // group id whose search box should keep focus after a redraw
  const addValue = async (g, name) => {
    try { const { id } = await api('POST', `/api/groups/${g.id}/values`, { name }); await loadMeta(); selected.add(id); onChange?.(); renderFilters(); toast(`Added ${name} to ${g.name}`); }
    catch (e) { fail(e); }
  };
  const draw = () => {
    const main = ['Type', 'Franchise'];
    const rows = state.meta.groups.map((g) => {
      const chipEls = g.values.map((v) => el('button', { type: 'button', class: 'tog', 'aria-pressed': String(selected.has(v.id)), dataset: { name: v.name.toLowerCase(), id: v.id },
        onclick: () => { selected.has(v.id) ? selected.delete(v.id) : selected.add(v.id); onChange?.(); draw(); } }, v.name));
      const chips = el('div', { class: 'cat-chips', role: 'group', 'aria-label': g.name }, chipEls);
      const add = el('button', { type: 'button', class: 'tog add', 'aria-label': `Add a ${g.name} value` }, '+ New');
      add.addEventListener('click', () => {
        const inp = el('input', { class: 'add-input', placeholder: `New ${g.name.toLowerCase()}`, 'aria-label': `New ${g.name} value` });
        const done = async (save) => {
          const name = inp.value.trim();
          if (save && name) await addValue(g, name);
          draw();
        };
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(true); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); } });
        inp.addEventListener('blur', () => done(true), { once: true });
        add.replaceWith(inp); inp.focus();
      });
      chips.append(add);
      const head = el('div', { class: 'cat-head' }, el('span', {}, g.name));
      if (g.values.length > TOP_VALUES) {
        // Only the most used values show, plus any already chosen; typing searches all of them.
        const top = new Set([...g.values].sort((a, b) => (b.count || 0) - (a.count || 0) || a.name.localeCompare(b.name)).slice(0, TOP_VALUES).map((v) => v.id));
        const offer = el('button', { type: 'button', class: 'tog add offer', hidden: true });
        const none = el('span', { class: 'cat-none', hidden: true }, 'No match.');
        const more = el('button', { type: 'button', class: 'tog add more-vals', onclick: () => { showAll.has(g.id) ? showAll.delete(g.id) : showAll.add(g.id); draw(); } });
        const apply = (q) => {
          const t = q.trim().toLowerCase();
          let shown = 0, hiddenCount = 0;
          for (const c of chipEls) {
            const on = c.getAttribute('aria-pressed') === 'true';
            const hit = on || (t ? c.dataset.name.includes(t) : showAll.has(g.id) || top.has(Number(c.dataset.id)));
            c.hidden = !hit;
            if (hit && t && !on) shown++;
            if (!hit) hiddenCount++;
          }
          const exact = g.values.some((v) => v.name.toLowerCase() === t);
          offer.hidden = !t || exact; offer.textContent = `+ Add "${q.trim()}"`;
          none.hidden = !t || shown > 0;
          add.hidden = !!t;
          more.hidden = !!t || (!hiddenCount && !showAll.has(g.id));
          more.textContent = showAll.has(g.id) ? 'Show fewer' : `${hiddenCount} more`;
          more.setAttribute('aria-expanded', String(showAll.has(g.id)));
        };
        offer.addEventListener('click', async () => { const q = queries.get(g.id) || ''; queries.delete(g.id); await addValue(g, q.trim()); draw(); });
        add.before(more); chips.append(none, offer);
        const search = el('input', { type: 'search', class: 'cat-search', placeholder: `Search ${g.name.toLowerCase()}…`, 'aria-label': `Search ${g.name}`, value: queries.get(g.id) || '', autocomplete: 'off', dataset: { gid: g.id } });
        search.addEventListener('input', () => { queries.set(g.id, search.value); apply(search.value); });
        search.addEventListener('keydown', async (e) => {
          if (e.key === 'Escape' && search.value) { e.preventDefault(); e.stopPropagation(); search.value = ''; queries.delete(g.id); apply(''); return; }
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const t = search.value.trim().toLowerCase();
          if (!t) return;
          const matches = chipEls.filter((c) => !c.hidden && c.getAttribute('aria-pressed') !== 'true');
          const exact = g.values.find((v) => v.name.toLowerCase() === t);
          queries.delete(g.id); refocus = g.id;
          if (exact) { if (!selected.has(exact.id)) { selected.add(exact.id); onChange?.(); } draw(); }
          else if (matches.length === 1) { selected.add(Number(matches[0].dataset.id)); onChange?.(); draw(); }
          else if (!matches.length) { await addValue(g, search.value.trim()); draw(); }
          else { queries.set(g.id, search.value); refocus = null; toast(`${matches.length} match. Keep typing, or click one.`); }
        });
        head.append(search);
        apply(queries.get(g.id) || '');
      }
      return { g, row: el('div', { class: 'cat-row' }, head, chips) };
    });
    if (!compact) box.replaceChildren(...rows.map((r) => r.row));
    else {
      const extra = rows.filter((r) => !main.includes(r.g.name));
      const picked = extra.reduce((n, r) => n + r.g.values.filter((v) => selected.has(v.id)).length, 0);
      const det = el('details', { class: 'more-cats', open: moreOpen || undefined, ontoggle: (e) => { moreOpen = e.target.open; } },
        el('summary', {}, `More categories: ${extra.map((r) => r.g.name).join(', ')}${picked ? ` (${picked} chosen)` : ''}`), ...extra.map((r) => r.row));
      box.replaceChildren(...rows.filter((r) => main.includes(r.g.name)).map((r) => r.row), extra.length ? det : '');
    }
    if (refocus != null) { box.querySelector(`.cat-search[data-gid="${refocus}"]`)?.focus(); refocus = null; }
  };
  draw();
  return box;
}

// ---------------- imports dialog ----------------
let pollTimer;
async function pollDrafts() {
  clearTimeout(pollTimer); pollTimer = null;
  try { state.drafts = await api('GET', '/api/drafts'); } catch (e) { return fail(e); }
  renderImports();
  updateBadge();
  if (state.drafts.some((d) => d.status === 'processing' || d.status === 'uploading') || state.uploads.size) pollTimer = setTimeout(pollDrafts, 1200);
}
function updateBadge() {
  const n = state.drafts.length + state.uploads.size + inbox.data.bursts.length;
  $('#imports-badge').hidden = !n; $('#imports-badge').textContent = n;
}
function openImports() { const d = $('#imports-dlg'); if (!d.open) d.showModal(); pollDrafts(); pollInbox(); }

// ---------------- inbox: new files in watch folders ----------------
const inbox = { data: { bursts: [], folders: [] }, off: new Set(), known: null, sig: '' };
async function pollInbox() {
  try { inbox.data = await api('GET', '/api/inbox'); } catch { return; }
  const ids = new Set(inbox.data.bursts.flatMap((b) => b.files.map((f) => f.id)));
  if (inbox.known && [...ids].some((i) => !inbox.known.has(i)) && !$('#imports-dlg').open && inbox.data.auto === 'off') toast('New downloads found in your watch folder. Open Imports to add them.');
  inbox.known = ids;
  renderInbox(); updateBadge();
  if ($('#imports-dlg').open) renderImports();
  if (inbox.data.auto !== 'off' && !pollTimer) pollDrafts();
}
function renderInbox() {
  const box = $('#inbox'), bursts = inbox.data.bursts;
  const sig = JSON.stringify(bursts.map((b) => [b.id, b.held, b.files.map((f) => [f.id, f.stable, f.dup?.level])]));
  box.hidden = !bursts.length;
  if (sig === inbox.sig) return;
  inbox.sig = sig;
  box.replaceChildren(el('h3', {}, 'New in your watch folders'), ...bursts.map((b) => {
    const settled = b.files.every((f) => f.stable);
    const picked = () => b.files.filter((f) => !inbox.off.has(f.id)).map((f) => f.id);
    const go = async (mode) => {
      const ids = picked();
      if (!ids.length) return toast('Tick at least one file.', true);
      try { await api('POST', '/api/inbox/import', { ids, mode }); inbox.sig = ''; await pollInbox(); pollDrafts(); } catch (e) { fail(e); }
    };
    const sets = new Set(b.files.filter((f) => f.kind === 'archive').map((f) => f.key)).size;
    return el('article', { class: 'burst' },
      el('header', {}, el('b', {}, `${b.files.length} file${b.files.length > 1 ? 's' : ''} in ${b.folder}`),
        el('span', { class: 'muted' }, ` downloaded ${new Date(b.last).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`),
        !settled && el('span', { class: 'kind' }, 'Still downloading')),
      el('ul', { role: 'list' }, b.files.map((f) => el('li', {},
        el('label', {}, el('input', { type: 'checkbox', checked: !inbox.off.has(f.id), onchange: (e) => { e.target.checked ? inbox.off.delete(f.id) : inbox.off.add(f.id); } }),
          el('span', { class: `ficon ${f.kind}` }, svg(kindIcon(f.kind))), el('span', { class: 'ename' }, f.name)),
        dupTag(f.dup),
        el('span', { class: 'esize' }, fmtBytes(f.size))))),
      b.held > 0 && el('p', { class: 'muted held' }, `${b.held === b.files.length ? 'These were' : `${b.held} of these were`} added before, so they weren't imported automatically. Delete them, or import them anyway.`),
      el('div', { class: 'form-actions' },
        el('button', { class: 'btn small primary', disabled: !settled, onclick: () => go('one') }, b.files.length > 1 ? 'Import as one model' : 'Import'),
        sets > 1 && el('button', { class: 'btn small ghost', disabled: !settled, onclick: () => go('separate') }, `Import as ${sets} models`),
        el('button', { class: 'btn small ghost', onclick: async () => { try { await api('POST', '/api/inbox/ignore', { ids: picked() }); inbox.sig = ''; pollInbox(); } catch (e) { fail(e); } } }, 'Ignore'),
        el('button', { class: 'btn small ghost danger', onclick: async () => {
          const ids = picked();
          if (!ids.length) return toast('Tick at least one file.', true);
          const ok = await confirmDlg(`Delete ${ids.length} file${ids.length === 1 ? '' : 's'}?`, `They move to the trash folder (.trash) in ${b.folder}, so you can still get them back until you empty the trash in Browse downloads.`,
            [{ label: 'Cancel', value: '' }, { label: 'Move to trash', value: 'y', cls: 'primary' }]);
          if (!ok) return;
          try { const r = await api('POST', '/api/inbox/trash', { ids }); toast(`Moved ${r.trashed} file${r.trashed === 1 ? '' : 's'} to the trash.`); inbox.sig = ''; pollInbox(); } catch (e) { fail(e); }
        } }, 'Delete…')));
  }));
}
setInterval(pollInbox, 8000);
const draftNodes = new Map();
function renderImports() {
  const list = $('#imports-list');
  const keep = new Set();
  for (const [key, u] of state.uploads) {
    keep.add(key);
    const pct = u.total ? Math.round((u.loaded / u.total) * 100) : 0;
    let n = draftNodes.get(key);
    if (!n) { n = el('article', { class: 'draft' }); draftNodes.set(key, n); list.append(n); }
    n.replaceChildren(el('div', { class: 'cover' }, el('div', { class: 'ph' }, svg(ICON.archive))),
      el('div', { class: 'draft-status' }, el('h3', {}, u.name), el('span', {}, `Uploading ${fmtBytes(u.loaded)} of ${fmtBytes(u.total)}`),
        el('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': `Uploading ${u.name}` }, el('i', { style: `width:${pct}%` }))));
  }
  for (const d of state.drafts) {
    keep.add(d.id);
    let n = draftNodes.get(d.id);
    if (n && d.status === 'processing' && d.progress) {
      const bar = $('.progress', n), lab = $('.plabel', n), known = d.progress.pct != null;
      if (bar) { bar.classList.toggle('indeterminate', !known); bar.firstChild.style.width = known ? `${d.progress.pct}%` : ''; if (known) bar.setAttribute('aria-valuenow', d.progress.pct); }
      if (lab) lab.textContent = known ? `${d.progress.label} (${d.progress.pct}%)` : `${d.progress.label}…`;
    }
    if (n && n.dataset.status === d.status) continue;
    const fresh = draftCard(d);
    fresh.dataset.status = d.status;
    if (n) n.replaceWith(fresh); else list.append(fresh);
    draftNodes.set(d.id, fresh);
  }
  for (const [k, n] of draftNodes) if (!keep.has(k)) { n.remove(); draftNodes.delete(k); }
  const ready = state.drafts.filter((d) => d.status === 'ready');
  let bar = $('#imports-bar');
  if (ready.length > 1) {
    bar ||= el('div', { id: 'imports-bar', class: 'form-actions' });
    bar.replaceChildren(el('button', { class: 'btn primary', onclick: commitAll }, `Add all ${ready.length} to library`));
    list.prepend(bar);
  } else bar?.remove();
  let empty = $('#imports-empty');
  if (!keep.size && !inbox.data.bursts.length) { empty ||= el('p', { id: 'imports-empty', class: 'imports-empty' }, 'Nothing waiting. Drop archives anywhere on the page or browse your downloads folder.'); list.append(empty); }
  else empty?.remove();
}
function draftCard(d) {
  if (d.status !== 'ready') {
    const busy = d.status !== 'error';
    return el('article', { class: 'draft' },
      el('div', { class: 'cover' }, el('div', { class: 'ph' }, svg(ICON.archive))),
      el('div', { class: 'draft-status' },
        el('h3', {}, d.name || d.archives?.[0] || 'Preparing import'),
        busy ? el('span', { class: 'plabel' }, 'Reading the archive and looking for covers…') : el('p', { class: 'error' }, d.error || 'Import failed'),
        busy && el('div', { class: 'progress indeterminate', role: 'progressbar', 'aria-label': 'Import progress' }, el('i')),
        !busy && el('div', {}, el('button', { class: 'btn ghost', onclick: () => cancelDraft(d) }, d.fromFolder ? 'Cancel and put files back' : 'Remove'))));
  }
  // Starts from what was read from the file names (name, designer, year, categories, tags, source link).
  const known = new Set(state.meta.groups.flatMap((g) => g.values.map((v) => v.id)));
  const ed = state.draftEdits.get(d.id) || { name: d.name, designer: d.designer || '', year: d.year || '', source: d.source_url || '', values: new Set((d.values || []).filter((id) => known.has(id))), tags: (d.tags || []).join(', '), cover: d.cover, noAms: false };
  state.draftEdits.set(d.id, ed);
  const fileUrl = (rel) => `/api/drafts/${d.id}/file/${encPath(rel)}`;
  const big = el('div', { class: 'cover', 'data-dropzone': '' });
  const drawBig = () => {
    const k = extOf(ed.cover || '');
    big.replaceChildren(!ed.cover ? el('div', { class: 'ph' }, svg(ICON.image)) : MEDIA_VID.includes(k)
      ? el('video', { src: fileUrl(ed.cover), muted: true, loop: true, autoplay: !reduceMotion, playsinline: true })
      : el('img', { src: fileUrl(ed.cover), alt: `Cover for ${ed.name}` }));
  };
  drawBig();
  const strip = el('div', { class: 'cover-strip', role: 'group', 'aria-label': 'Choose a cover' });
  const drawStrip = () => strip.replaceChildren(
    el('button', { type: 'button', 'aria-pressed': String(!ed.cover), title: 'No cover', 'aria-label': 'No cover', onclick: () => { ed.cover = null; drawBig(); drawStrip(); } }, svg(ICON.x)),
    ...d.covers.slice(0, 16).map((rel) => el('button', { type: 'button', 'aria-pressed': String(ed.cover === rel), title: rel, 'aria-label': `Use ${rel} as cover`, onclick: () => { ed.cover = rel; drawBig(); drawStrip(); } },
      MEDIA_VID.includes(extOf(rel)) ? el('video', { src: fileUrl(rel), muted: true, preload: 'metadata' }) : el('img', { src: fileUrl(rel), alt: '', loading: 'lazy' }))));
  drawStrip();
  const coverInput = el('input', { type: 'file', accept: 'image/*,video/*', hidden: true });
  const uploadCover = async (file) => {
    const fd = new FormData(); fd.append('file', file);
    try {
      const r = await fetch(`/api/drafts/${d.id}/cover`, { method: 'POST', body: fd });
      const nd = await r.json(); if (!r.ok) throw new Error(nd.error);
      Object.assign(d, nd); ed.cover = nd.cover; drawBig(); drawStrip();
    } catch (e) { fail(e); }
  };
  coverInput.addEventListener('change', () => coverInput.files[0] && uploadCover(coverInput.files[0]));
  big.addEventListener('dragover', (e) => e.preventDefault());
  big.addEventListener('drop', (e) => { e.preventDefault(); const f = [...e.dataTransfer.files][0]; if (f) uploadCover(f); });

  const counts = {};
  for (const f of d.files) { const k = extOf(f.rel); counts[k] = (counts[k] || 0) + 1; }
  const size = d.files.reduce((s, f) => s + f.size, 0);
  const summary = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, c]) => `${c} ${k.toUpperCase()}`).join(', ');
  const coverName = el('b', {}, `Cover-${ed.name || 'name'}`);
  const nameIn = el('input', { value: ed.name, required: true, oninput: (e) => { ed.name = e.target.value; coverName.textContent = `Cover-${ed.name || 'name'}`; } });
  const desIn = el('input', { value: ed.designer, list: 'designer-list', placeholder: 'Who made it?', oninput: (e) => { ed.designer = e.target.value; } });
  const srcIn = el('input', { type: 'url', value: ed.source, placeholder: 'https://…', oninput: (e) => { ed.source = e.target.value; } });
  linkDesigner(desIn, srcIn, (url) => { ed.source = url; });
  if (!ed.source && ed.designer) { const u = sourceForDesigner(ed.designer); if (u) { srcIn.value = ed.source = u; srcIn.dataset.auto = '1'; } }
  const tagIn = el('input', { value: ed.tags, list: 'tag-list', placeholder: 'Comma separated', oninput: (e) => { ed.tags = e.target.value; } });
  const card = el('article', { class: 'draft', dataset: { id: d.id } },
    el('div', { class: 'draft-cover' }, big, strip,
      el('button', { type: 'button', class: 'btn small ghost', onclick: () => coverInput.click() }, 'Upload a cover'), coverInput,
      el('small', { class: 'muted' }, `Or copy a picture and paste it here with ${PASTE_KEY}. The cover is saved as `, coverName, '.')),
    el('form', { class: 'draft-form', onsubmit: (e) => { e.preventDefault(); commitDraft(d); } },
      d.zipped && el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: !!ed.unzip, onchange: (e) => { ed.unzip = e.target.checked; } }), el('span', {}, 'Unzip this model after adding it. Left off, it stays zipped and only the pictures are unpacked into an img folder.')),
      d.originalName && el('p', { class: 'muted translated' }, `Translated from ${d.originalName}${d.translatedVia === 'letters' ? ' (spelled in English letters: translation service unavailable)' : ''}. Files with names like this are renamed to English when added.`),
      d.guessed?.length && el('p', { class: 'muted guessed' }, `Filled in from the file names: ${d.guessed.join(', ')}. Check them before adding.`),
      d.duplicateOf && el('p', { class: 'warn' }, `You already have a model called ${d.duplicateOf.name}. Adding this keeps both.`),
      ...(d.doubles || []).slice(0, 3).map((x) => el('p', { class: `dup-note ${x.level}` }, el('b', {}, `${x.name}: `), x.why, ' ',
        x.model?.exists && el('button', { type: 'button', class: 'link-inline', onclick: () => openModel(x.model.id) }, `Open ${x.model.name}`))),
      el('div', { class: 'draft-row three' },
        el('label', { class: 'field' }, el('span', {}, 'Model name'), nameIn),
        el('label', { class: 'field' }, el('span', {}, 'Designer'), desIn),
        el('label', { class: 'field' }, el('span', {}, 'Year'), el('input', { type: 'number', min: 1900, max: 2200, value: ed.year, oninput: (e) => { ed.year = e.target.value; } }))),
      el('div', { class: 'field' }, el('span', {}, 'Categories'), catPicker(ed.values, null, { compact: true })),
      el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: !!ed.noAms, onchange: (e) => { ed.noAms = e.target.checked; } }),
        el('span', {}, 'No AMS needed', el('small', { class: 'muted' }, 'Multi-colour, but printed in parts or with colour swaps'))),
      el('div', { class: 'draft-row' },
        el('label', { class: 'field' }, el('span', {}, 'Tags'), tagIn),
        el('label', { class: 'field' }, el('span', {}, 'Source link'), srcIn)),
      el('details', { class: 'draft-files' }, el('summary', {}, `${d.files.length} files, ${fmtBytes(size)}${summary ? ` (${summary})` : ''}${d.archives.length ? ` from ${d.archives.join(', ')}` : ''}`),
        el('ul', {}, d.files.slice(0, 200).map((f) => el('li', {}, `${f.rel} (${fmtBytes(f.size)})`)))),
      el('div', { class: 'form-actions' },
        el('button', { class: 'btn primary', type: 'submit' }, 'Add to library'),
        el('button', { class: 'btn ghost', type: 'button', onclick: () => cancelDraft(d) }, d.fromFolder ? 'Cancel and put files back' : 'Cancel'))));
  card.pasteCover = async (file) => { big.classList.add('pasting'); try { await uploadCover(file); toast(`Pasted cover added to ${ed.name || 'this import'}`); } finally { big.classList.remove('pasting'); } };
  return card;
}
async function commitDraft(d, { quiet = false } = {}) {
  const ed = state.draftEdits.get(d.id);
  if (!ed.name.trim()) { toast('Give the model a name first.', true); return false; }
  try {
    const m = await api('POST', `/api/drafts/${d.id}/commit`, { name: ed.name, designer: ed.designer, values: [...ed.values], tags: splitTags(ed.tags), cover: ed.cover, year: ed.year ? Number(ed.year) : null, source_url: ed.source, noAms: !!ed.noAms });
    state.draftEdits.delete(d.id);
    if (!quiet) toast(`Added ${m.name} to the library`);
    if (ed.unzip) (async () => {
      for (const a of d.archives.filter((n) => (ARCH.includes(extOf(n)) && !/\.part(?!0*1\.)\d+\.rar$/i.test(n)) || /\.(7z|zip|rar)\.001$/i.test(n))) await runExtract(m.id, a);
      refresh();
    })();
    await refresh(); await pollDrafts();
    return true;
  } catch (e) { fail(e); return false; }
}
async function commitAll() {
  let n = 0;
  for (const d of state.drafts.filter((x) => x.status === 'ready')) if (await commitDraft(d, { quiet: true })) n++;
  toast(`Added ${n} models to the library`);
}
async function cancelDraft(d) {
  try { await api('DELETE', `/api/drafts/${d.id}`); state.draftEdits.delete(d.id); toast(d.fromFolder ? 'Import cancelled. Files were put back.' : 'Import cancelled'); pollDrafts(); }
  catch (e) { fail(e); }
}
$('#imports-btn').addEventListener('click', openImports);

// ---------------- possible doubles ----------------
const DUP_LABEL = { same: 'Already added', name: 'Same name', similar: 'In library?' };
/** A small flag on a download that may already be in the library. Opens that model when it still exists. */
function dupTag(dup) {
  if (!dup) return null;
  return el('button', { type: 'button', class: `dup-tag ${dup.level}`, title: dup.why, 'aria-label': `${DUP_LABEL[dup.level]}: ${dup.why}`,
    onclick: (e) => { e.stopPropagation(); if (dup.model?.exists && dup.model.id) openModel(dup.model.id); else toast(dup.why); } }, DUP_LABEL[dup.level]);
}

// ---------------- folder browser ----------------
const browser = { root: 'downloads', path: '', entries: [], sel: new Set(), mode: 'import', onPick: null, sort: localStorage.getItem('mv.browseSort') || 'new', q: '' };
const rootLabel = (k) => ({ downloads: 'Downloads', library: 'Library', 'downloads-old': 'Downloads (previous)', ...(state.meta.rootLabels || {}) }[k] || k.charAt(0).toUpperCase() + k.slice(1));
function openBrowser({ mode = 'import', root, onPick } = {}) {
  Object.assign(browser, { mode, onPick, sel: new Set(), path: '' });
  browser.root = root || (state.meta.roots.includes('downloads') ? 'downloads' : state.meta.roots[0]);
  $('#browse-h').textContent = mode === 'pick' ? 'Choose a folder' : 'Browse downloads';
  $('#browse-sub').textContent = mode === 'pick' ? 'Open the folder you want to import, then choose Use this folder.' : 'Pick archives, files or folders to import. They are moved into your library when you add them.';
  $('#browse-pick').hidden = mode !== 'pick';
  $('#browse-one').hidden = $('#browse-each').hidden = $('#browse-move').hidden = mode === 'pick';
  $('#browse-root').replaceChildren(...state.meta.roots.map((r) => el('option', { value: r, selected: r === browser.root }, rootLabel(r))));
  $('#browse-dlg').showModal();
  browse();
}
async function browse(rel = browser.path) {
  try {
    const r = await api('GET', `/api/browse?root=${encodeURIComponent(browser.root)}&path=${encodeURIComponent(rel)}`);
    if (r.path !== browser.path || r.root !== browser.shownRoot) { browser.q = ''; $('#browse-q').value = ''; }
    browser.path = r.path; browser.shownRoot = r.root; browser.entries = r.entries; browser.sel.clear();
    drawBrowseTrash();
    drawBrowser();
  } catch (e) { fail(e); }
}
function drawBrowser() {
  const parts = browser.path ? browser.path.split('/') : [];
  const crumbs = [el('button', { 'aria-current': parts.length ? null : 'location', 'aria-label': `Top of ${rootLabel(browser.root)}`, onclick: () => browse('') }, 'Top')];
  parts.forEach((p, i) => crumbs.push(el('span', { class: 'sep', 'aria-hidden': 'true' }, '/'), el('button', { 'aria-current': i === parts.length - 1 ? 'location' : null, onclick: () => browse(parts.slice(0, i + 1).join('/')) }, p)));
  $('#crumbs').replaceChildren(...crumbs);
  const join = (n) => (browser.path ? `${browser.path}/${n}` : n);
  const list = $('#browse-list');
  const q = browser.q.toLowerCase();
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  const order = {
    new: (a, b) => b.mtime - a.mtime || byName(a, b),
    old: (a, b) => a.mtime - b.mtime || byName(a, b),
    name: byName,
    'name-desc': (a, b) => byName(b, a),
    big: (a, b) => (b.size ?? -1) - (a.size ?? -1) || byName(a, b),
    small: (a, b) => (a.size ?? Infinity) - (b.size ?? Infinity) || byName(a, b),
    type: (a, b) => extOf(a.name).localeCompare(extOf(b.name)) || byName(a, b),
  }[browser.sort] || byName;
  // Folders stay on top; everything is sorted the same way within them.
  const items = browser.entries.filter((e) => (browser.mode !== 'pick' || e.type === 'dir') && (!q || e.name.toLowerCase().includes(q)))
    .sort((a, b) => (a.type === b.type ? order(a, b) : a.type === 'dir' ? -1 : 1));
  browser.shown = items.map((e) => ({ ...e, rel: join(e.name) }));
  list.replaceChildren(...(items.length ? items.map((e) => {
    const rel = join(e.name);
    const k = e.type === 'dir' ? 'folder' : e.kind;
    const li = el('li', { class: browser.sel.has(rel) ? 'sel' : '' },
      browser.mode === 'import' && el('input', { type: 'checkbox', 'aria-label': `Select ${e.name}`, checked: browser.sel.has(rel), onchange: (ev) => { ev.target.checked ? browser.sel.add(rel) : browser.sel.delete(rel); li.classList.toggle('sel', ev.target.checked); updateBrowseSel(); } }),
      el('span', { class: `ficon ${k}` }, svg(kindIcon(k))),
      el('button', { class: 'ename', onclick: () => (e.type === 'dir' ? browse(rel) : previewEntry(e, rel)) }, e.name),
      browser.mode === 'import' && dupTag(e.dup),
      el('span', { class: 'edate' }, fmtWhen(e.mtime)),
      el('span', { class: 'esize' }, e.type === 'dir' ? '' : fmtBytes(e.size)));
    return li;
  }) : [el('li', { class: 'muted' }, browser.mode === 'pick' ? 'No sub-folders here.' : 'This folder is empty.')]));
  $('#browse-preview').replaceChildren(el('p', {}, browser.mode === 'pick' ? `Current folder: ${rootLabel(browser.root)}/${browser.path}` : 'Select a file name to preview it.'));
  updateBrowseSel();
}
function previewEntry(e, rel) {
  const url = `/api/browse/file?root=${encodeURIComponent(browser.root)}&path=${encodeURIComponent(rel)}`;
  const k = extOf(e.name);
  $('#browse-preview').replaceChildren(...[
    e.dup && el('p', { class: `dup-note ${e.dup.level}` }, el('b', {}, `${DUP_LABEL[e.dup.level]}. `), e.dup.why, ' ',
      e.dup.model?.exists && el('button', { type: 'button', class: 'link-inline', onclick: () => openModel(e.dup.model.id) }, `Open ${e.dup.model.name}`)),
    MEDIA_IMG.includes(k) ? el('img', { src: url, alt: e.name }) : MEDIA_VID.includes(k) ? el('video', { src: url, controls: true, muted: true }) : null,
    el('p', {}, el('b', {}, e.name)), el('p', {}, `${fmtBytes(e.size)}, modified ${new Date(e.mtime).toLocaleDateString()}`),
    k === 'pdf' ? el('a', { href: url, target: '_blank', rel: 'noopener' }, 'Open PDF') : null,
    e.archive ? el('p', {}, state.meta.settings?.extractArchives === 'true' ? 'Archives are unzipped when imported.' : 'Archives stay zipped when imported; only the pictures are unpacked.') : null,
  ].filter(Boolean));
  if (e.archive) {
    const box = el('ul', { class: 'peek-list' }, el('li', {}, 'Reading archive…'));
    $('#browse-preview').append(box);
    api('GET', `/api/browse/archive?root=${encodeURIComponent(browser.root)}&path=${encodeURIComponent(rel)}`)
      .then((r) => box.replaceChildren(...r.entries.slice(0, 300).map((x) => el('li', {}, x.path, x.size != null ? el('span', { class: 'esize' }, ` ${fmtBytes(x.size)}`) : ''))))
      .catch((er) => box.replaceChildren(el('li', { class: 'error' }, er.message)));
  }
}
function fmtWhen(ms) {
  if (!ms) return '';
  const d = new Date(ms), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) });
}
$('#browse-sort').value = browser.sort;
$('#browse-sort').addEventListener('change', (e) => { browser.sort = e.target.value; try { localStorage.setItem('mv.browseSort', browser.sort); } catch { /* ignore */ } drawBrowser(); });
$('#browse-q').addEventListener('input', (e) => { browser.q = e.target.value.trim(); drawBrowser(); });
function updateBrowseSel() {
  const n = browser.sel.size;
  $('#browse-sel').textContent = browser.mode === 'pick' ? '' : n ? `${n} selected` : 'Nothing selected';
  $('#browse-each').disabled = !n; $('#browse-one').disabled = n < 2;
  $('#browse-del').disabled = !n; $('#browse-del').hidden = browser.mode === 'pick' || browser.root === 'library';
  const dups = (browser.shown || []).filter((e) => e.dup?.level === 'same' && !browser.sel.has(e.rel));
  $('#browse-dups').hidden = browser.mode === 'pick' || !dups.length;
  $('#browse-dups').textContent = `Select ${dups.length} already added`;
  $('#browse-each').textContent = n > 1 ? `Import ${n} separately` : 'Import';
}
async function importFromBrowser(asOne) {
  const paths = [...browser.sel];
  $('#browse-dlg').close();
  openImports();
  try {
    if (asOne) await api('POST', '/api/drafts/from-paths', { root: browser.root, paths });
    else for (const p of paths) await api('POST', '/api/drafts/from-paths', { root: browser.root, paths: [p] });
  } catch (e) { fail(e); }
  pollDrafts();
}
$('#browse-btn').addEventListener('click', () => openBrowser());
$('#browse-dups').addEventListener('click', () => {
  for (const e of browser.shown || []) if (e.dup?.level === 'same') browser.sel.add(e.rel);
  drawBrowser();
});
async function drawBrowseTrash() {
  const box = $('#browse-trash');
  if (browser.mode === 'pick' || browser.root === 'library') { box.hidden = true; return; }
  let t; try { t = await api('GET', `/api/browse/trash?root=${encodeURIComponent(browser.root)}`); } catch { box.hidden = true; return; }
  box.hidden = !t.items;
  box.replaceChildren(`Trash: ${t.items.toLocaleString()} item${t.items === 1 ? '' : 's'}, ${fmtBytes(t.bytes)}. `,
    el('button', { type: 'button', class: 'link-inline danger', onclick: async () => {
      const ok = await confirmDlg(`Empty the trash in ${rootLabel(browser.root)}?`, `${t.files.toLocaleString()} file${t.files === 1 ? '' : 's'} (${fmtBytes(t.bytes)}) will be deleted for good. This can't be undone.`,
        [{ label: 'Cancel', value: '' }, { label: 'Delete for good', value: 'y', cls: 'primary danger-fill' }]);
      if (!ok) return;
      try { const r = await api('POST', '/api/browse/trash/empty', { root: browser.root }); toast(`Trash emptied: ${fmtBytes(r.bytes)} freed.`); drawBrowseTrash(); } catch (e) { fail(e); }
    } }, 'Empty trash…'));
}
$('#browse-del').addEventListener('click', async () => {
  const paths = [...browser.sel];
  if (!paths.length) return;
  const names = paths.map((p) => p.split('/').pop());
  const ok = await confirmDlg(`Delete ${paths.length === 1 ? names[0] : `${paths.length} items`}?`,
    `${paths.length === 1 ? 'It moves' : 'They move'} to the trash folder (.trash) in ${rootLabel(browser.root)}, so you can still get ${paths.length === 1 ? 'it' : 'them'} back until you empty the trash.${paths.length > 1 ? ` ${names.slice(0, 4).join(', ')}${names.length > 4 ? ` and ${names.length - 4} more` : ''}.` : ''}`,
    [{ label: 'Cancel', value: '' }, { label: 'Move to trash', value: 'y', cls: 'primary' }]);
  if (!ok) return;
  try {
    const r = await api('POST', '/api/browse/trash', { root: browser.root, paths });
    toast(r.errors.length ? `Moved ${r.trashed} to the trash. Not moved: ${r.errors.join('; ')}` : `Moved ${r.trashed} item${r.trashed === 1 ? '' : 's'} to the trash.`, !!r.errors.length);
    await browse();
  } catch (e) { fail(e); }
});
$('#browse-root').addEventListener('change', (e) => { browser.root = e.target.value; browse(''); });
$('#browse-refresh').addEventListener('click', () => browse());
$('#browse-each').addEventListener('click', () => importFromBrowser(false));
$('#browse-one').addEventListener('click', () => importFromBrowser(true));
$('#browse-pick').addEventListener('click', () => { browser.onPick?.(browser.root, browser.path); $('#browse-dlg').close(); });

// ---------------- model detail ----------------
let current = null, viewer = null, modelValues = new Set();
async function openModel(id) {
  if (!current || current.id !== Number(id)) archUi.pending = null;
  try { current = await api('GET', `/api/models/${id}`); } catch (e) { return fail(e); }
  const dlg = $('#model-dlg');
  if (!dlg.open) dlg.showModal();
  const f = $('#model-form');
  f.name.value = current.name; f.designer.value = current.designer; f.notes.value = current.notes;
  $('#model-scheme').replaceChildren(); drawModelScheme(current);
  f.year.value = current.year || ''; f.source_url.value = current.source_url || ''; f.source_url.dataset.auto = '';
  if (fileUi.modelId !== current.id) { Object.assign(fileUi, { modelId: current.id, q: '', kind: 'all', active: null }); fileUi.peek.clear(); $('#file-q').value = ''; }
  f.favorite.checked = current.favorite; f.noAms.checked = !!current.noAms; f.tags.value = current.tags.join(', ');
  modelValues = new Set(current.vals);
  $('#model-cats').replaceChildren(catPicker(modelValues));
  $('#model-path').textContent = current.missing ? `Folder not found: ${current.displayPath}` : current.displayPath;
  const outside = !current.missing && current.inLibrary === false;
  const note = $('#outside-note');
  note.hidden = !outside;
  if (outside) {
    const where = rootLabel(String(current.displayPath).split('/')[0]);
    note.replaceChildren(...(state.meta.settings.adoptOnSave === 'true'
      ? [`This model is still in ${where}. Saving moves it into your library and files it by your folder format.`]
      : [`This model is still in ${where}. `, el('button', { type: 'button', class: 'link-inline', onclick: () => moveIntoLibrary([current.id]) }, 'Move it into the library')]));
  }
  drawSource();
  $('#download-zip').href = `/api/models/${current.id}/download`;
  drawFiles();
  const first = current.cover || current.files.find((x) => VIEW3D.includes(extOf(x.rel)))?.rel || current.files.find((x) => extOf(x.rel) === 'pdf')?.rel;
  // No cover, only a 3D file: loading a big STL/3MF freezes the page for a while, so offer it instead of loading it.
  const f3 = !current.cover && first && VIEW3D.includes(extOf(first)) ? current.files.find((x) => x.rel === first) : null;
  if (f3 && (current.thumbUrl || (f3.size || 0) > 8 * 1024 * 1024)) return showNoCover(f3);
  showFile(first);
}
/** A model without a cover: its 3D preview picture if it has one, a button to load the 3D view, and ways to add a cover. */
function showNoCover(f3) {
  disposeViewer();
  $('#slide-dots').hidden = true;
  drawFiles();
  const pick = el('input', { type: 'file', accept: 'image/*,video/*', hidden: true, onchange: (e) => { coverToModel([...e.target.files]); e.target.value = ''; } });
  $('#stage').replaceChildren(el('div', { class: 'no-cover' },
    current.thumbUrl ? el('img', { src: current.thumbUrl, alt: '' }) : svg(ICON.cube),
    el('p', {}, el('b', {}, 'No cover picture yet.'), ` Drag one onto this window, paste one with ${PASTE_KEY}, or choose one.`),
    el('div', { class: 'no-cover-actions' },
      el('button', { type: 'button', class: 'btn small primary', onclick: () => pick.click() }, 'Choose a cover…'),
      el('button', { type: 'button', class: 'btn small ghost', onclick: () => showFile(f3.rel) }, `View ${f3.rel.split('/').pop()} in 3D (${fmtBytes(f3.size || 0)})`)),
    pick));
  $('#stage-info').textContent = '';
}
const fileUi = { q: '', kind: 'all', group: localStorage.getItem('mv.fgroup') || 'folder', peek: new Map(), active: null };
// How each slicer is opened: a web link it registered, or (Chitubox) by pasting the file's path.
const SLICERS = {
  orcaslicer: { name: 'OrcaSlicer', short: 'Orca', link: (u) => `orcaslicer://open?file=${encodeURIComponent(u)}` },
  bambustudio: { name: 'Bambu Studio', short: 'Bambu', link: (u) => `bambustudio://open?file=${encodeURIComponent(u)}` },
  prusaslicer: { name: 'PrusaSlicer', short: 'Prusa', link: (u) => `prusaslicer://open?file=${encodeURIComponent(u)}` },
  lychee: { name: 'Lychee Slicer', short: 'Lychee', link: (u) => `lycheeslicer://open/${encodeURIComponent(u)}` },
  chitubox: { name: 'Chitubox', short: 'Chitubox', copy: true },
};
const mainSlicerKey = () => (SLICERS[state.meta.settings.slicer] ? state.meta.settings.slicer : 'orcaslicer');
const enabledSlicers = () => { const on = String(state.meta.settings.slicers || '').split(',').filter((k) => SLICERS[k]); return [...new Set([mainSlicerKey(), ...on])]; };
const slicer = () => [SLICERS[mainSlicerKey()].name];
const SLICEABLE = ['stl', '3mf', 'obj', 'step', 'stp'];
function fileKind(name, fallback = 'other') {
  const k = extOf(name);
  if (VIEW3D.includes(k) || fallback === 'model') return 'model';
  if (MEDIA_IMG.includes(k)) return 'image';
  if (MEDIA_VID.includes(k)) return 'video';
  if (k === 'pdf' || ['txt', 'md'].includes(k)) return 'doc';
  if (ARCH.includes(k) || /\.(part\d+\.rar|(7z|zip|rar)\.\d{3})$/i.test(name)) return 'archive';
  return fallback === 'sliced' ? 'sliced' : 'other';
}
const FILE_GROUPS = [['all', 'All'], ['model', '3D models'], ['media', 'Images and video'], ['doc', 'Documents'], ['archive', 'Archives'], ['other', 'Other']];
const bucket = (k) => (k === 'image' || k === 'video' ? 'media' : k === 'sliced' ? 'other' : k);
const iconFor = (k) => kindIcon(k === 'doc' ? 'pdf' : k);
async function openInSlicer(rel, entry, key = mainSlicerKey()) {
  const sl = SLICERS[key] || SLICERS.orcaslicer;
  if (sl.copy) return copyPcPath(rel, sl);
  try {
    const { path } = await api('GET', `/api/models/${current.id}/slicer-link?rel=${encodeURIComponent(rel)}${entry ? `&entry=${encodeURIComponent(entry)}` : ''}`);
    window.location.href = sl.link(location.origin + path);
    toast(`Sending ${(entry || rel).split('/').pop()} to ${sl.name}`);
  } catch (e) { fail(e); }
}
async function copyPcPath(rel, sl) {
  try {
    const { path } = await api('GET', `/api/models/${current.id}/pc-path?rel=${encodeURIComponent(rel)}`);
    let ok = true;
    try { await navigator.clipboard.writeText(path); } catch { ok = false; }
    if (!ok) { // pages opened over plain http can't always use the clipboard: fall back to a hidden text box
      const t = el('textarea', { style: 'position:fixed;opacity:0', 'aria-hidden': 'true' }, path);
      document.body.append(t); t.select(); ok = document.execCommand('copy'); t.remove();
    }
    if (!ok) return confirmDlg('Copy this path', path, [{ label: 'Close', value: '' }]);
    toast(sl ? `Path copied. In ${sl.name}, press Ctrl+O and paste it into the file name box.` : 'File path copied');
  } catch (e) { fail(e); }
}
/** The "Open in" button plus a small menu for the other slicers and Copy file path. */
function openButtons(rel, entry, { big = false } = {}) {
  const usable = enabledSlicers().filter((k) => !(entry && SLICERS[k].copy));
  if (!usable.length) return null;
  const main = usable[0], sl = SLICERS[main];
  const name = (entry || rel).split('/').pop();
  const label = sl.copy ? `Copy path for ${sl.short}` : big ? `Open in ${sl.name}` : `Open in ${sl.short}`;
  const extra = usable.slice(1).map((k) => ({ label: SLICERS[k].copy ? `${SLICERS[k].name}: copy path to paste` : `Open in ${SLICERS[k].name}`, run: () => openInSlicer(rel, entry, k) }));
  if (!entry && !SLICERS[main].copy) extra.push({ label: 'Copy file path', run: () => copyPcPath(rel) });
  const mainBtn = el('button', { type: 'button', class: big ? 'go' : 'fact go', 'aria-label': `${label}: ${name}`, onclick: () => openInSlicer(rel, entry, main) }, label);
  if (!extra.length) return mainBtn;
  const more = el('button', { type: 'button', class: big ? 'go more' : 'fact go more', 'aria-label': `More ways to open ${name}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: (e) => showOpenMenu(e.currentTarget, extra) }, svg(ICON.chevron));
  return el('span', { class: 'split' }, mainBtn, more);
}
let menuFor = null;
function showOpenMenu(anchor, items) {
  const m = $('#open-menu');
  if (menuFor === anchor && !m.hidden) return hideOpenMenu();
  hideOpenMenu();
  menuFor = anchor; anchor.setAttribute('aria-expanded', 'true');
  m.replaceChildren(...items.map((it) => el('button', { type: 'button', role: 'menuitem', onclick: () => { hideOpenMenu(); it.run(); } }, it.label)));
  // The menu lives inside whichever window is open so it stays clickable above it.
  (anchor.closest('dialog') || document.body).append(m);
  m.hidden = false;
  const r = anchor.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.right - w))}px`;
  m.style.top = `${r.bottom + 6 + h > innerHeight ? r.top - h - 6 : r.bottom + 6}px`;
  m.firstChild?.focus();
}
function hideOpenMenu() { const m = $('#open-menu'); m.hidden = true; menuFor?.setAttribute('aria-expanded', 'false'); menuFor = null; }
document.addEventListener('click', (e) => { if (!e.target.closest('#open-menu, .more')) hideOpenMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#open-menu').hidden) { e.preventDefault(); e.stopPropagation(); hideOpenMenu(); } }, true);
async function togglePeek(rel) {
  if (fileUi.peek.has(rel)) { fileUi.peek.delete(rel); return drawFiles(); }
  fileUi.peek.set(rel, null); drawFiles();
  try { fileUi.peek.set(rel, (await api('GET', `/api/models/${current.id}/archive?rel=${encodeURIComponent(rel)}`)).entries); }
  catch (e) { fileUi.peek.delete(rel); fail(e); }
  drawFiles();
}
function drawFiles(active = fileUi.active) {
  fileUi.active = active;
  const list = $('#file-list');
  if (current.missing) return list.replaceChildren(el('li', { class: 'muted' }, 'The model folder is missing. It may have been moved or renamed outside ModelVault.'));
  const all = current.files.map((f) => ({ ...f, k: fileKind(f.rel, f.kind), name: f.rel.split('/').pop(), dir: f.rel.includes('/') ? f.rel.slice(0, f.rel.lastIndexOf('/')) : '' }));
  const counts = { all: all.length };
  for (const f of all) counts[bucket(f.k)] = (counts[bucket(f.k)] || 0) + 1;
  $('#name-archives').hidden = !all.some((f) => f.k === 'archive' || /\.(part\d+\.rar|(7z|zip|rar)\.\d{3}|[zr]\d{2})$/i.test(f.name));
  $('#file-chips').replaceChildren(...FILE_GROUPS.filter(([k]) => counts[k]).map(([k, label]) => el('button', { type: 'button', class: 'tog', 'aria-pressed': String(fileUi.kind === k), onclick: () => { fileUi.kind = k; drawFiles(); } }, `${label} ${counts[k]}`)));
  if (!all.length) return list.replaceChildren(el('li', { class: 'muted' }, 'No files yet. Drop files here to add them.'));
  const q = fileUi.q.toLowerCase();
  const shown = all.filter((f) => (fileUi.kind === 'all' || bucket(f.k) === fileUi.kind) && (!q || f.rel.toLowerCase().includes(q) || (fileUi.peek.get(f.rel) || []).some((e) => e.path.toLowerCase().includes(q))));
  if (!shown.length) return list.replaceChildren(el('li', { class: 'muted' }, 'No files match this filter.'));
  const rows = [];
  const fileRow = (f, indent) => {
    const url = `/files/${current.id}/${encPath(f.rel)}`;
    const isCover = f.rel === current.cover;
    const peeked = fileUi.peek.has(f.rel);
    rows.push(el('li', { class: active === f.rel ? 'active' : '', style: indent ? 'padding-left:22px' : '' },
      el('span', { class: `ficon ${f.k}` }, svg(iconFor(f.k))),
      el('button', { class: 'fopen', title: f.rel, onclick: () => showFile(f.rel) }, fileUi.group === 'folder' ? f.name : f.rel),
      isCover && el('span', { class: 'cover-mark' }, 'Cover'),
      el('span', { class: 'fsize' }, fmtBytes(f.size)),
      (f.k === 'image' || f.k === 'video') && !isCover && el('button', { class: 'fact', onclick: () => setCover(f.rel) }, 'Set as cover'),
      SLICEABLE.includes(extOf(f.name)) && openButtons(f.rel),
      f.k === 'archive' && el('button', { class: 'fact', 'aria-expanded': String(peeked), onclick: () => togglePeek(f.rel) }, peeked ? 'Hide contents' : 'Look inside'),
      f.k === 'archive' && (ARCH.includes(extOf(f.name)) && !/\.part(?!0*1\.)\d+\.rar$/i.test(f.name) || /\.(7z|zip|rar)\.001$/i.test(f.name)) && el('button', { class: 'fact', onclick: () => extractHere(f.rel) }, 'Extract'),
      el('a', { class: 'fact', href: `${url}?download=1`, 'aria-label': `Download ${f.name}` }, 'Download'),
      el('button', { class: 'fact del', 'aria-label': `Delete ${f.name}`, title: 'Delete', onclick: () => deleteFile(f.rel) }, svg(ICON.trash))));
    if (!peeked) return;
    const entries = fileUi.peek.get(f.rel);
    if (!entries) return rows.push(el('li', { class: 'inner muted' }, 'Reading archive…'));
    const inside = entries.filter((e) => !q || e.path.toLowerCase().includes(q) || f.rel.toLowerCase().includes(q));
    if (!inside.length) rows.push(el('li', { class: 'inner muted' }, 'Nothing inside matches.'));
    for (const e of inside.slice(0, 500)) {
      const ek = fileKind(e.path);
      const can = ek === 'model' || ek === 'image' || ek === 'video' || extOf(e.path) === 'pdf';
      rows.push(el('li', { class: `inner${active === `${f.rel}::${e.path}` ? ' active' : ''}` },
        el('span', { class: `ficon ${ek}` }, svg(iconFor(ek))),
        can ? el('button', { class: 'fopen', title: e.path, onclick: () => showFile(f.rel, e.path) }, e.path.replace(/^\.\//, '')) : el('span', { class: 'fopen plain', title: e.path }, e.path.replace(/^\.\//, '')),
        el('span', { class: 'fsize' }, fmtBytes(e.size)),
        SLICEABLE.includes(extOf(e.path)) && openButtons(f.rel, e.path)));
    }
    if (inside.length > 500) rows.push(el('li', { class: 'inner muted' }, `And ${inside.length - 500} more files.`));
  };
  if (fileUi.group === 'none') shown.forEach((f) => fileRow(f, false));
  else {
    const label = (f) => (fileUi.group === 'folder' ? f.dir : FILE_GROUPS.find(([k]) => k === bucket(f.k))[1]);
    const order = fileUi.group === 'type' ? FILE_GROUPS.map((g) => g[1]) : null;
    const groups = new Map();
    for (const f of shown) (groups.get(label(f)) || groups.set(label(f), []).get(label(f))).push(f);
    for (const [g, items] of [...groups].sort((a, b) => (order ? order.indexOf(a[0]) - order.indexOf(b[0]) : a[0].localeCompare(b[0], undefined, { numeric: true })))) {
      if (g) rows.push(el('li', { class: 'dir' }, el('span', { class: 'ficon folder' }, svg(ICON.folder)), g, el('span', { class: 'count' }, items.length)));
      items.forEach((f) => fileRow(f, !!g));
    }
  }
  list.replaceChildren(...rows);
}
$('#file-q').addEventListener('input', (e) => { fileUi.q = e.target.value.trim(); if (current) drawFiles(); });
$('#file-group').value = fileUi.group;
$('#file-group').addEventListener('change', (e) => { fileUi.group = e.target.value; localStorage.setItem('mv.fgroup', fileUi.group); if (current) drawFiles(); });
function sourceForDesigner(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return '';
  const counts = new Map();
  for (const m of state.models) if ((m.designer || '').toLowerCase() === n && m.source_url) counts.set(m.source_url, (counts.get(m.source_url) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}
/** When an existing designer is chosen and the link is empty (or was filled in this way before), fill it in. */
function linkDesigner(desInput, srcInput, onFill) {
  const fill = () => {
    const url = sourceForDesigner(desInput.value);
    const auto = srcInput.dataset.auto === '1';
    if (!url || (srcInput.value.trim() && !auto)) { if (auto && !url) { srcInput.value = ''; srcInput.dataset.auto = ''; onFill?.('', ''); } return; }
    srcInput.value = url; srcInput.dataset.auto = '1'; onFill?.(url, desInput.value.trim());
  };
  desInput.addEventListener('input', fill);
  desInput.addEventListener('change', fill);
  srcInput.addEventListener('input', () => { srcInput.dataset.auto = ''; });
}
linkDesigner($('#model-form').designer, $('#model-form').source_url, (url, who) => { drawSource(); if (url) $('#source-open').prepend(`Filled in from your other models by ${who}. `); });
function drawSource() {
  const v = $('#model-form').source_url.value.trim();
  $('#source-open').replaceChildren(...(/^https?:\/\//i.test(v) ? [el('a', { href: v, target: '_blank', rel: 'noopener noreferrer' }, 'Open source page')] : []));
}
$('#model-form').source_url.addEventListener('input', drawSource);
function disposeViewer() { viewer?.dispose(); viewer = null; }

// ---------------- slideshow of the model's pictures and videos ----------------
function slides() {
  if (!current) return [];
  const media = current.files.filter((f) => MEDIA_IMG.includes(extOf(f.rel)) || MEDIA_VID.includes(extOf(f.rel))).map((f) => f.rel);
  return current.cover && media.includes(current.cover) ? [current.cover, ...media.filter((r) => r !== current.cover)] : media;
}
const slideIndex = (rel) => slides().indexOf(rel);
function stepSlide(d) {
  const list = slides(), i = slideIndex(fileUi.active);
  if (list.length < 2 || i < 0) return;
  showFile(list[(i + d + list.length) % list.length]);
}
function drawSlideNav(rel) {
  const list = slides(), i = list.indexOf(rel), dots = $('#slide-dots');
  if (list.length < 2 || i < 0) { dots.replaceChildren(); dots.hidden = true; return; }
  const stage = $('#stage');
  stage.append(
    el('button', { class: 'slide-btn prev', 'aria-label': 'Previous picture', onclick: () => stepSlide(-1) }, svg(ICON.left)),
    el('button', { class: 'slide-btn next', 'aria-label': 'Next picture', onclick: () => stepSlide(1) }, svg(ICON.right)));
  dots.hidden = false;
  dots.replaceChildren(...(list.length <= 24
    ? list.map((r, n) => el('button', { class: 'dot', 'aria-current': n === i ? 'true' : null, 'aria-label': `Picture ${n + 1} of ${list.length}`, onclick: () => showFile(r) }))
    : [el('span', { class: 'slide-count' }, `${i + 1} of ${list.length}`)]));
}
// ---------------- full-screen lightbox ----------------
const box = { rel: null };
function openLightbox(rel) {
  const d = $('#lightbox');
  if (!d.open) d.showModal();
  showBox(rel);
}
function showBox(rel) {
  const list = slides(), i = list.indexOf(rel);
  if (i < 0) return;
  box.rel = rel;
  const url = `/files/${current.id}/${encPath(rel)}`, name = rel.split('/').pop();
  const media = MEDIA_VID.includes(extOf(rel))
    ? el('video', { class: 'lb-media', src: url, controls: true, loop: true, muted: true, autoplay: !reduceMotion, playsinline: true })
    : el('img', { class: 'lb-media', src: url, alt: name, onerror: (e) => e.target.replaceWith(Object.assign(asVideoOr(url, () => el('p', { class: 'note' }, `Couldn't show ${name}.`), { autoplay: true, controls: true }), { className: 'lb-media' })) });
  $('#lb-stage').replaceChildren(media);
  $('#lb-name').textContent = name;
  $('#lb-count').textContent = list.length > 1 ? `${i + 1} of ${list.length}` : '';
  $('#lb-download').href = `${url}?download=1`;
  const multi = list.length > 1;
  $('#lb-prev').hidden = $('#lb-next').hidden = !multi;
  $('#lb-dots').replaceChildren(...(multi && list.length <= 30 ? list.map((r, n) => el('button', { class: 'dot', 'aria-current': n === i ? 'true' : null, 'aria-label': `Picture ${n + 1} of ${list.length}`, onclick: () => showBox(r) })) : []));
  // Load the neighbours now so moving through is instant.
  for (const r of [list[(i + 1) % list.length], list[(i - 1 + list.length) % list.length]]) if (r && MEDIA_IMG.includes(extOf(r))) new Image().src = `/files/${current.id}/${encPath(r)}`;
}
function stepBox(d) { const list = slides(), i = list.indexOf(box.rel); if (list.length > 1 && i >= 0) showBox(list[(i + d + list.length) % list.length]); }
$('#lb-prev').addEventListener('click', () => stepBox(-1));
$('#lb-next').addEventListener('click', () => stepBox(1));
$('#lb-close').addEventListener('click', () => $('#lightbox').close());
// Clicking the dark area around the picture closes it.
$('#lightbox').addEventListener('click', (e) => { if (e.target === e.currentTarget || e.target.id === 'lb-stage') $('#lightbox').close(); });
$('#lightbox').addEventListener('close', () => { $('#lb-stage').replaceChildren(); if (current && box.rel && box.rel !== fileUi.active) showFile(box.rel); });
{
  let x0 = null;
  $('#lb-stage').addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') x0 = e.clientX; });
  $('#lb-stage').addEventListener('pointerup', (e) => { if (x0 == null) return; const dx = e.clientX - x0; x0 = null; if (Math.abs(dx) > 50) stepBox(dx < 0 ? 1 : -1); });
}

// Swipe on touch screens
{
  let x0 = null;
  $('#stage').addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') x0 = e.clientX; });
  $('#stage').addEventListener('pointerup', (e) => { if (x0 == null || viewer) return; const dx = e.clientX - x0; x0 = null; if (Math.abs(dx) > 50) stepSlide(dx < 0 ? 1 : -1); });
}
async function showFile(rel, entry) {
  disposeViewer();
  const stage = $('#stage'), info = $('#stage-info');
  info.textContent = '';
  $('#slide-dots').hidden = true;
  drawFiles(entry ? `${rel}::${entry}` : rel);
  if (!rel) {
    stage.replaceChildren(current.thumbUrl ? el('img', { src: current.thumbUrl, alt: '' }) : el('p', { class: 'note' }, 'Nothing to preview. Add a cover image or a 3D file.'));
    return;
  }
  const url = entry ? `/api/models/${current.id}/archive-file?rel=${encodeURIComponent(rel)}&entry=${encodeURIComponent(entry)}` : `/files/${current.id}/${encPath(rel)}`;
  const k = extOf(entry || rel);
  const name = (entry || rel).split('/').pop();
  const from = entry ? ` (inside ${rel.split('/').pop()})` : '';
  if (MEDIA_IMG.includes(k)) {
    const canBox = !entry && slideIndex(rel) >= 0;
    stage.replaceChildren(el('img', { class: `slide${canBox ? ' zoomable' : ''}`, src: url, alt: name, title: canBox ? 'View full screen' : null, onclick: canBox ? () => openLightbox(rel) : null, onerror: (e) => e.target.replaceWith(asVideoOr(url, () => el('p', { class: 'note' }, `Couldn't show ${name}.`), { autoplay: true, controls: true })) }));
    info.replaceChildren(name + from, ...(canBox ? [' ', el('button', { class: 'link-inline', onclick: () => openLightbox(rel) }, 'View full screen')] : []));
    if (!entry) drawSlideNav(rel);
  } else if (MEDIA_VID.includes(k)) {
    stage.replaceChildren(el('video', { class: 'slide', src: url, controls: true, loop: true, muted: true, autoplay: !reduceMotion, playsinline: true }));
    info.replaceChildren(name + from, ...(!entry && slideIndex(rel) >= 0 ? [' ', el('button', { class: 'link-inline', onclick: () => openLightbox(rel) }, 'View full screen')] : []));
    if (!entry) drawSlideNav(rel);
  }
  else if (k === 'pdf') { stage.replaceChildren(el('iframe', { src: url, title: name })); info.replaceChildren(name + from, ' ', el('a', { href: url, target: '_blank', rel: 'noopener' }, 'Open in a new tab')); }
  else if (['txt', 'md', 'csv', 'json', 'ini', 'cfg'].includes(k)) {
    const text = await fetch(url).then((r) => r.text()).catch(() => '');
    stage.replaceChildren(el('pre', { class: 'textview' }, text.slice(0, 200000)));
    info.textContent = name;
  } else if (VIEW3D.includes(k)) {
    const holder = el('div', { class: 'three' });
    const hud = el('div', { class: 'stage-hud' }, el('span', {}, 'Loading model…'));
    stage.replaceChildren(holder, hud);
    try {
      const { Viewer } = await import('./viewer.js');
      if ($('#stage').firstChild !== holder) return;
      viewer = new Viewer(holder);
      const res = await viewer.load(url, k, (p) => { if (p != null) hud.firstChild.textContent = `Loading ${Math.round(p * 100)}%`; });
      if (!res) return;
      const s = res.size;
      hud.replaceChildren(el('span', {}, `${s.x.toFixed(1)} × ${s.z.toFixed(1)} × ${s.y.toFixed(1)} mm`), el('span', {}, `${res.tris.toLocaleString()} triangles`),
        el('button', { type: 'button', onclick: () => viewer?.toggleWire() }, 'Wireframe'),
        openButtons(rel, entry, { big: true }));
      info.textContent = `${name}${from}. Drag to rotate, scroll to zoom, right-drag to pan.`;
    } catch (e) { stage.replaceChildren(el('p', { class: 'note' }, `Couldn't show ${name}: ${e.message || e}`)); }
  } else if (fileKind(rel) === 'archive') {
    stage.replaceChildren(el('div', { class: 'note' }, el('p', {}, `${name} is an archive.`),
      el('div', { class: 'form-actions', style: 'justify-content:center' },
        el('button', { class: 'btn primary', onclick: () => { if (!fileUi.peek.has(rel)) togglePeek(rel); } }, 'Look inside'),
        ARCH.includes(k) && el('button', { class: 'btn ghost', onclick: () => extractHere(rel) }, 'Extract into this model'))));
  } else {
    stage.replaceChildren(el('div', { class: 'note' }, el('p', {}, `${name} can't be previewed here.`),
      el('div', { class: 'form-actions', style: 'justify-content:center' }, SLICEABLE.includes(k) && el('button', { class: 'btn primary', onclick: () => openInSlicer(rel) }, `Open in ${slicer()[0]}`), el('a', { class: 'btn ghost', href: `${url}?download=1` }, 'Download file'))));
  }
}
async function deleteFile(rel) {
  const name = rel.split('/').pop();
  const isCover = rel === current.cover;
  if (!(await confirmDlg(`Delete ${name}?`, `${isCover ? 'This is the cover. ' : ''}It moves to the .trash folder in your library, so you can still get it back from there.`, [{ label: 'Cancel', value: '' }, { label: 'Delete', value: 'y', cls: 'primary' }]))) return;
  try {
    const m = await api('DELETE', `/api/models/${current.id}/file?rel=${encodeURIComponent(rel)}`);
    updateCard(m); toast(`Deleted ${name}`);
    const slide = slideIndex(fileUi.active);
    await openModel(current.id);
    // Stay near where you were in the slideshow.
    const list = slides();
    if (slide >= 0 && list.length) showFile(list[Math.min(slide, list.length - 1)]);
  } catch (e) { fail(e); }
}
async function setCover(rel) {
  try { const m = await api('POST', `/api/models/${current.id}/cover`, { rel }); updateCard(m); toast('Cover updated'); await openModel(current.id); }
  catch (e) { fail(e); }
}
/** Unzip an archive inside a model, with a live progress bar. */
async function runExtract(modelId, rel) {
  const bar = el('i'), label = el('span', {}, `Extracting ${rel.split('/').pop()}`);
  const t = el('div', { class: 'toast sticky' }, label, el('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Extracting' }, bar));
  $('#toasts').append(t);
  try {
    let job = await api('POST', `/api/models/${modelId}/extract`, { rel });
    while (job.status === 'running') {
      bar.style.width = `${job.pct}%`; label.textContent = `Extracting ${job.name} (${job.pct}%)`;
      await new Promise((r) => setTimeout(r, 500));
      job = await api('GET', `/api/jobs/${job.id}`);
    }
    if (job.status === 'error') throw new Error(job.errors[0] || 'Extraction failed');
    return true;
  } catch (e) { fail(e); return false; } finally { t.remove(); }
}
async function extractHere(rel) {
  const id = current.id;
  if (!(await runExtract(id, rel))) return;
  await refresh();
  if (current?.id === id) await openModel(id);
  toast('Extracted');
}
async function addFilesToModel(files) {
  if (!files.length || !current) return;
  const fd = new FormData(); for (const f of files) fd.append('file', f, f.name);
  toast(`Adding ${files.length} file${files.length > 1 ? 's' : ''}…`);
  try {
    const r = await fetch(`/api/models/${current.id}/files`, { method: 'POST', body: fd });
    const m = await r.json(); if (!r.ok) throw new Error(m.error);
    updateCard(m); await openModel(current.id); toast('Files added');
  } catch (e) { fail(e); }
}
// A picture or video dropped on "Make it the cover": it becomes Cover-{name}; anything else dropped with it is added as files.
async function coverToModel(files) {
  if (!files.length || !current) return;
  const media = files.find((f) => /^(image|video)\//.test(f.type) || /\.(jpe?g|png|gif|webp|avif|bmp|mp4|webm|mov|m4v)$/i.test(f.name));
  if (!media) { toast('A cover has to be a picture, GIF or video. Drop other files on "Add to this model\'s files".', true); return; }
  const fd = new FormData(); fd.append('file', media, media.name);
  toast('Setting the cover…');
  try {
    const r = await fetch(`/api/models/${current.id}/cover`, { method: 'POST', body: fd });
    const m = await r.json(); if (!r.ok) throw new Error(m.error);
    updateCard(m);
    const rest = files.filter((f) => f !== media);
    if (rest.length) await addFilesToModel(rest);
    else { await openModel(current.id); toast('Cover set'); }
  } catch (e) { fail(e); }
}
$('#add-files').addEventListener('click', () => $('#add-files-input').click());
$('#add-files-input').addEventListener('change', (e) => { addFilesToModel([...e.target.files]); e.target.value = ''; });
$('#model-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const m = await api('PATCH', `/api/models/${current.id}`, { name: f.name.value, designer: f.designer.value, notes: f.notes.value, favorite: f.favorite.checked, noAms: f.noAms.checked, values: [...modelValues], tags: splitTags(f.tags.value), year: f.year.value ? Number(f.year.value) : null, source_url: f.source_url.value, organize: true, ...(archUi.pending ? { archives: archUi.pending } : {}) });
    archUi.pending = null;
    $('#model-dlg').close();
    const o = m.organized || {};
    if (o.queued) { pollJobs(true); toast(`Saved ${m.name}. Moving it into your library now; progress shows in the sidebar.`); await refresh(); return; }
    const did = [o.moved && 'folder renamed', o.tidied && 'pictures moved to img', o.archivesNamed && `${o.archivesNamed} archive${o.archivesNamed === 1 ? '' : 's'} renamed`].filter(Boolean);
    toast(o.error ? `Saved ${m.name}, but it couldn't be tidied: ${o.error}`
      : did.length ? `Saved ${m.name}: ${did.join(', ')}.` : `Saved ${m.name}`, !!o.error);
    await refresh();
  } catch (err) { fail(err); }
});
$('#remove-model').addEventListener('click', async () => {
  const choice = await confirmDlg(`Remove ${current.name}?`, 'Remove it from ModelVault only, or also move its folder to the .trash folder inside your library.', [
    { label: 'Cancel', value: '' }, { label: 'Remove from library', value: 'db', cls: 'ghost' }, { label: 'Move files to trash', value: 'files', cls: 'primary' }]);
  if (!choice) return;
  try {
    await api('DELETE', `/api/models/${current.id}${choice === 'files' ? '?files=1' : ''}`);
    $('#model-dlg').close();
    toast(choice === 'files' ? 'Model moved to trash' : 'Model removed from library');
    refresh();
  } catch (e) { fail(e); }
});
$('#model-dlg').addEventListener('close', () => { disposeViewer(); $('#stage').replaceChildren(); current = null; });

// ---------------- settings ----------------
function openSettings(tab = 'general') {
  const s = state.meta.settings, f = $('#settings-form');
  $('#lib-dir').textContent = s.libraryDir;
  f.folderPattern.value = s.folderPattern;
  f.autoOrganize.checked = s.autoOrganize === 'true';
  f.adoptOnSave.checked = s.adoptOnSave === 'true';
  f.translateNames.checked = s.translateNames === 'true';
  $('#refresh-every').value = localStorage.getItem('mv.refreshEvery') ?? '10';
  $('#main-slicer').replaceChildren(...Object.entries(SLICERS).map(([k, v]) => el('option', { value: k, selected: k === mainSlicerKey() }, v.name)));
  const on = new Set(String(s.slicers || '').split(','));
  $('#slicer-checks').replaceChildren(...Object.entries(SLICERS).map(([k, v]) => el('label', { class: 'pill-check' }, el('input', { type: 'checkbox', name: 'slicer-on', value: k, checked: on.has(k) || k === mainSlicerKey() }), el('span', {}, v.name))));
  let pc = {}; try { pc = JSON.parse(s.pcPaths || '{}'); } catch { pc = {}; }
  const net = state.meta.netPaths || {};
  const onPc = state.meta.platform === 'win32';
  $('#pc-paths').replaceChildren(...state.meta.roots.map((r) => onPc && state.meta.rootPaths?.[r]
    ? el('div', { class: 'pc-row' }, el('span', { class: 'pc-name' }, rootLabel(r)), el('span', { class: 'pc-fixed' }, el('span', { class: 'mono' }, state.meta.rootPaths[r]), el('small', {}, 'This PC')))
    : net[r]
    ? el('div', { class: 'pc-row' }, el('span', { class: 'pc-name' }, rootLabel(r)), el('span', { class: 'pc-fixed' }, el('span', { class: 'mono' }, net[r]), el('small', {}, 'From the network folder')))
    : el('label', { class: 'pc-row' }, el('span', { class: 'pc-name' }, rootLabel(r)), el('input', { class: 'set-input mono', name: `pc-${r}`, value: pc[r] || '', placeholder: '\\\\nas\\share\\folder', spellcheck: 'false', autocomplete: 'off', 'aria-label': `Path on your PC for ${rootLabel(r)}` }))));
  $('#tpl-tokens').replaceChildren(...['name', 'designer', 'year', ...state.meta.groups.map((g) => g.name)].map((t) => el('button', { type: 'button', class: 'tog', onclick: () => {
    const i = $('#tpl'); const at = i.selectionStart ?? i.value.length;
    i.value = `${i.value.slice(0, at)}{${t}}${i.value.slice(i.selectionEnd ?? at)}`; i.focus(); i.selectionStart = i.selectionEnd = at + t.length + 2; previewTpl();
  } }, `{${t}}`)));
  $('#tpl-examples').replaceChildren(el('span', { class: 'muted' }, 'Try'),
    ...[['{name} - {year} - {designer}', 'Name - Year - Designer'], ['{type}/{franchise}/{name}', 'Type / Franchise / Name']].map(([tpl, label]) =>
      el('button', { type: 'button', class: 'link-inline', onclick: () => { $('#tpl').value = tpl; previewTpl(); } }, label)));
  previewTpl();
  const w = $('#watch-form');
  w.watchFolders.value = s.watchFolders; w.watchAuto.value = s.watchAuto; w.watchGap.value = s.watchGap; w.watchQuiet.value = s.watchQuiet;
  drawWatchStatus();
  f.keepArchive.checked = s.keepArchive === 'true';
  f.extractArchives.checked = s.extractArchives === 'true';
  f.extractNested.checked = s.extractNested === 'true';
  f.autoThumbs.checked = s.autoThumbs === 'true';
  syncUnzip();
  f.optimizeImages.checked = s.optimizeImages === 'true';
  f.optimizeStrength.value = s.optimizeStrength || 'balanced';
  drawOptimizeStats();
  f.displayFormat.value = s.displayFormat || '{name}';
  $('#display-tokens').replaceChildren(...['name', 'designer', 'year', ...state.meta.groups.map((g) => g.name.toLowerCase())].map((t) => el('button', { type: 'button', class: 'tog', onclick: () => {
    const i = $('#display-format'); const at = i.selectionStart ?? i.value.length;
    i.value = `${i.value.slice(0, at)}{${t}}${i.value.slice(i.selectionEnd ?? at)}`; i.focus(); i.selectionStart = i.selectionEnd = at + t.length + 2; previewDisplay();
  } }, `{${t}}`)));
  $('#display-examples').replaceChildren(el('span', { class: 'muted' }, 'Try'),
    ...[['{name}', 'Just the name'], ['{name} ({designer})', 'Name (Designer)'], ['({designer}) {name}', '(Designer) Name'], ['{name} - {year}', 'Name - Year']].map(([tpl, label]) =>
      el('button', { type: 'button', class: 'link-inline', onclick: () => { $('#display-format').value = tpl; previewDisplay(); } }, label)));
  previewDisplay();
  f.archiveAuto.checked = s.archiveAuto === 'true';
  f.archiveFormat.value = s.archiveFormat || '{name} - {part} - {scale}';
  $('#arch-tokens').replaceChildren(...['name', 'part', 'scale', 'designer', 'year', ...state.meta.groups.map((g) => g.name)].map((t) => el('button', { type: 'button', class: 'tog', onclick: () => {
    const i = $('#arch-format'); const at = i.selectionStart ?? i.value.length;
    i.value = `${i.value.slice(0, at)}{${t}}${i.value.slice(i.selectionEnd ?? at)}`; i.focus(); i.selectionStart = i.selectionEnd = at + t.length + 2; previewArch();
  } }, `{${t}}`)));
  let parts = []; try { parts = JSON.parse(s.archiveParts || '[]'); } catch { parts = []; }
  $('#arch-parts').replaceChildren(...parts.map(partRow));
  previewArch();
  $('#scan-root').replaceChildren(...state.meta.roots.map((r) => el('option', { value: r, selected: r === (state.meta.roots.find((x) => !['library', 'downloads'].includes(x)) || 'library') }, rootLabel(r))));
  syncRelocate();
  drawCatEditor();
  selectTab(tab);
  if (tab === 'existing') drawLocations();
  if (tab === 'tailscale') drawTailscale();
  if (!$('#settings-dlg').open) $('#settings-dlg').showModal();
}
// ---- picture optimizer (Settings) ----
$('#optimize-now').addEventListener('click', async () => {
  const b = $('#optimize-now');
  b.disabled = true; b.textContent = 'Counting pictures…';
  try {
    await saveLibrarySettings(); // use the strength chosen above
    const est = await api('GET', '/api/images/estimate');
    if (est.tool !== true) { toast(est.tool || 'The picture tool isn\'t ready. Rebuild the container to add it.'); return; }
    if (!est.count) { toast('Every picture is already optimized.'); return; }
    const strength = { balanced: 'Balanced (at most 2560 pixels, quality 85)', smaller: 'Smaller (at most 1920 pixels, quality 78)', lossless: 'Lossless (hidden data removed only)' }[est.strength];
    if (!(await confirmDlg(`Optimize ${est.count.toLocaleString()} pictures?`, `${fmtBytes(est.bytes)} of pictures in ${est.models.toLocaleString()} models, with ${strength}. Each picture is replaced only when the new one is clearly smaller; there's no undo. GIFs, videos and pictures inside archives aren't touched. It runs in the background.`,
      [{ label: 'Cancel', value: '' }, { label: 'Optimize pictures', value: 'y', cls: 'primary' }]))) return;
    await api('POST', '/api/images/optimize', {});
    pollJobs(true);
    toast('Optimizing pictures. Progress shows in the sidebar.');
  } catch (e) { fail(e); } finally { b.disabled = false; b.textContent = 'Optimize all pictures now…'; }
});

async function drawOptimizeStats() {
  let st;
  try { st = await api('GET', '/api/images/stats'); } catch { return; }
  const n = (x) => x.toLocaleString();
  const date = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  $('#optimize-stats').textContent = fmtBytes(st.saved);
  const lines = [];
  if (st.pictures) lines.push(`${n(st.pictures)} picture${st.pictures === 1 ? '' : 's'} made smaller, from ${fmtBytes(st.before)} to ${fmtBytes(st.before - st.saved)}.`);
  if (st.last) lines.push(`Last run on ${date(st.last.at)} saved ${fmtBytes(st.last.saved)} on ${n(st.last.changed)} of ${n(st.last.total)} pictures.`);
  if (st.since.changed) lines.push(`Since then, new pictures saved ${fmtBytes(st.since.saved)} automatically.`);
  $('#optimize-stats-sub').textContent = lines.join(' ') || 'Nothing optimized yet.';
}

// ---- model names as shown (Settings) ----
function previewDisplay() {
  const fmt = $('#display-format').value;
  // A few of your own models, preferring ones with a designer and year so the example shows something.
  const sample = [...state.list].sort((a, b) => (!!b.designer + !!b.year) - (!!a.designer + !!a.year)).slice(0, 3);
  const demo = { name: 'Ancient Dragon', designer: 'Example Studio', year: 2026, vals: [] };
  $('#display-preview').replaceChildren(el('span', { class: 'muted' }, sample.length ? 'Sample, with your models:' : 'Sample:'),
    ...(sample.length ? sample : [demo]).map((m) => el('p', { class: 'mono-path' }, el('b', {}, displayName(m, fmt)))));
}
$('#display-format').addEventListener('input', previewDisplay);

// ---- archive names (Settings) ----
function partRow(p = { label: '', words: '' }) {
  const row = el('div', { class: 'arch-part' },
    el('input', { class: 'set-input part-label', value: p.label, placeholder: 'Label, e.g. Bust', 'aria-label': 'Part label', autocomplete: 'off', oninput: previewArch }),
    el('input', { class: 'set-input part-words', value: p.words, placeholder: 'Words that mean it, e.g. bust, head', 'aria-label': `Words for ${p.label || 'this part'}`, autocomplete: 'off', spellcheck: 'false', oninput: previewArch }),
    el('div', { class: 'part-moves' },
      el('button', { type: 'button', class: 'icon-btn tiny', 'aria-label': 'Move up', title: 'Move up', onclick: () => { row.previousElementSibling?.before(row); previewArch(); } }, svg('<path d="m6 15 6-6 6 6"/>')),
      el('button', { type: 'button', class: 'icon-btn tiny', 'aria-label': 'Remove this part', title: 'Remove', onclick: () => { row.remove(); previewArch(); } }, svg(ICON.x))));
  return row;
}
const readParts = () => $$('#arch-parts .arch-part').map((r) => ({ label: $('.part-label', r).value.trim(), words: $('.part-words', r).value.trim() })).filter((p) => p.label);
$('#arch-part-add').addEventListener('click', () => { const r = partRow(); $('#arch-parts').append(r); $('.part-label', r).focus(); });
let archTimer;
function previewArch() {
  clearTimeout(archTimer);
  archTimer = setTimeout(async () => {
    try {
      const r = await api('POST', '/api/archives/preview', { format: $('#arch-format').value, parts: readParts() });
      $('#arch-preview').replaceChildren(el('span', { class: 'muted' }, 'Sample, for a model called "Ancient Dragon":'),
        ...r.examples.map((x) => el('p', { class: 'mono-path' }, x.from, el('span', { class: 'arrow' }, ' becomes '), el('b', {}, x.to))));
    } catch (e) { $('#arch-preview').replaceChildren(el('p', { class: 'error' }, e.message)); }
  }, 250);
}
$('#arch-format').addEventListener('input', previewArch);

// ---- archive names (a model's page) ----
// Choices made in "Name archives" and not applied there are applied by the model's "Save and close".
const archUi = { plan: null, timer: null, pending: null, dirty: false, applied: false };
async function openArchives() {
  try { archUi.plan = await api('GET', `/api/models/${current.id}/archives`); } catch (e) { return fail(e); }
  const p = archUi.plan;
  if (archUi.pending) for (const it of p.items) { const c = archUi.pending[it.key]; if (c) Object.assign(it, { part: c.part, scale: c.scale, keep: !!c.keep }); }
  archUi.dirty = false; archUi.applied = false;
  $('#arch-intro').replaceChildren(`Choose what each archive holds. Names follow your format `, el('code', {}, p.format), `, which you can change in Settings.`);
  $('#arch-list').replaceChildren(...p.items.map((it) => {
    const picked = new Set(it.part ? it.part.split(' ').filter(Boolean) : []);
    // Parts made of several words ("X-Pose", custom ones) are matched as whole labels first.
    const known = p.parts.filter((l) => (` ${it.part} `).includes(` ${l} `));
    const custom = known.reduce((rest, l) => rest.replace(l, ''), it.part).replace(/\s+/g, ' ').trim();
    const sel = new Set(known);
    const other = el('input', { class: 'set-input', value: custom, placeholder: 'Something else…', 'aria-label': `Other part for ${it.current}`, autocomplete: 'off' });
    const scale = el('input', { class: 'set-input', value: it.scale, list: 'arch-scales', placeholder: 'e.g. 1-6 or 75mm', 'aria-label': `Scale for ${it.current}`, autocomplete: 'off', spellcheck: 'false' });
    const keep = el('input', { type: 'checkbox', class: 'switch', checked: it.keep, 'aria-label': `Leave ${it.current} as it is` });
    const whole = el('input', { class: 'set-input', value: it.name || '', placeholder: 'Leave empty to use the format', 'aria-label': `Whole new name for ${it.current}`, spellcheck: 'false' });
    const out = el('b', { class: 'arch-new' }, it.newName);
    const card = el('section', { class: 'arch-card', 'aria-label': it.current, dataset: { key: it.key } },
      el('div', { class: 'arch-top' }, el('span', { class: 'mono arch-old', title: it.files.join('\n') }, it.current), el('span', { class: 'muted' }, `${fmtBytes(it.size)}${it.files.length > 1 ? ` · ${it.files.length} parts` : ''}`)),
      el('div', { class: 'arch-field' }, el('span', { class: 'arch-lab' }, 'Part'),
        el('div', { class: 'cat-chips' }, ...p.parts.map((l) => el('button', { type: 'button', class: 'tog', 'aria-pressed': String(sel.has(l)), onclick: (e) => { sel.has(l) ? sel.delete(l) : sel.add(l); e.currentTarget.setAttribute('aria-pressed', String(sel.has(l))); update(); } }, l)), other)),
      el('label', { class: 'arch-field' }, el('span', { class: 'arch-lab' }, 'Scale'), scale),
      el('label', { class: 'arch-field' }, el('span', { class: 'arch-lab' }, 'Or a whole name'), el('div', { class: 'arch-whole' }, whole, el('span', { class: 'muted' }, it.suffix))),
      el('label', { class: 'arch-field arch-keep' }, el('span', { class: 'arch-lab' }, 'Leave this name as it is'), keep),
      el('p', { class: 'arch-result' }, el('span', { class: 'muted' }, 'New name '), out));
    card.choice = () => ({ part: [...p.parts.filter((l) => sel.has(l)), other.value.trim()].filter(Boolean).join(' '), scale: scale.value.trim(), name: whole.value.trim(), keep: keep.checked });
    card.out = out;
    const update = () => { archUi.dirty = true; card.classList.toggle('kept', keep.checked); previewArchives(); };
    other.addEventListener('input', update); scale.addEventListener('input', update); keep.addEventListener('change', update); whole.addEventListener('input', update);
    card.classList.toggle('kept', it.keep);
    return card;
  }));
  const d = $('#arch-dlg'); if (!d.open) d.showModal();
  if (archUi.pending) previewArchives();
}
$('#arch-dlg').addEventListener('close', () => {
  if (archUi.applied || !archUi.dirty) return;
  archUi.pending = archChoices();
  toast('Your archive choices will be applied when you click Save and close.');
});
const archChoices = () => Object.fromEntries($$('#arch-list .arch-card').map((c) => [c.dataset.key, c.choice()]));
function previewArchives() {
  clearTimeout(archUi.timer);
  archUi.timer = setTimeout(async () => {
    try {
      const names = await api('POST', `/api/models/${current.id}/archives/preview`, { items: archChoices() });
      for (const c of $$('#arch-list .arch-card')) if (names[c.dataset.key]) c.out.textContent = names[c.dataset.key];
    } catch { /* keep the last preview */ }
  }, 200);
}
$('#name-archives').addEventListener('click', openArchives);
$('#arch-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api('POST', `/api/models/${current.id}/archives`, { items: archChoices() });
    archUi.applied = true; archUi.pending = null;
    $('#arch-dlg').close();
    toast(r.renamed ? `Renamed ${r.renamed} archive${r.renamed === 1 ? '' : 's'}` : 'Saved. The names already matched.');
    const fresh = await api('GET', `/api/models/${current.id}`);
    current.files = fresh.files; current.archive_meta = fresh.archive_meta;
    fileUi.peek?.clear?.();
    drawFiles();
  } catch (err) { fail(err); }
});

// Opening animation preferences live in this browser only.
{
  const get = (k) => { try { return localStorage.getItem(k) !== 'off'; } catch { return true; } };
  const set = (k, on) => { try { localStorage.setItem(k, on ? 'on' : 'off'); } catch { /* */ } };
  $('#pref-splash').checked = get('mv.splash');
  $('#pref-splash-sound').checked = get('mv.splashAudio');
  $('#pref-splash').addEventListener('change', (e) => { set('mv.splash', e.target.checked); toast(e.target.checked ? 'The opening animation will play' : 'The opening animation is off'); });
  $('#pref-splash-sound').addEventListener('change', (e) => { set('mv.splashAudio', e.target.checked); toast(e.target.checked ? 'The opening animation will play with sound' : 'The opening animation will be silent'); });
  $('#splash-replay').addEventListener('click', () => { $('#settings-dlg').close(); window.mvSplash?.replay(); });
}
// The two unzip options only matter when unzipping is on.
function syncUnzip() {
  const on = $('#extract-archives').checked;
  $('#unzip-options').classList.toggle('off', !on);
  for (const i of $$('#unzip-options input')) i.disabled = !on;
}
$('#extract-archives').addEventListener('change', syncUnzip);
function selectTab(name) {
  for (const t of $$('#settings-dlg [role=tab]')) {
    const on = t.id === `tab-${name}`;
    t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
    $(`#${t.getAttribute('aria-controls')}`).hidden = !on;
  }
}
$$('#settings-dlg [role=tab]').forEach((t, i, all) => {
  t.addEventListener('click', () => { selectTab(t.id.slice(4)); if (t.id === 'tab-existing') { drawLocations(); showSource(); } if (t.id === 'tab-backup') drawBackup(); if (t.id === 'tab-tailscale') drawTailscale(); if (t.id === 'tab-about') drawAbout(); });
  t.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (d) { const n = all[(i + d + all.length) % all.length]; selectTab(n.id.slice(4)); n.focus(); }
  });
});
$('#settings-btn').addEventListener('click', () => openSettings());
$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await saveLibrarySettings();
    toast('Settings saved'); queueThumbs();
    renderGrid(); // the model name format shows straight away
  } catch (err) { fail(err); }
});
async function saveLibrarySettings() {
  const f = $('#settings-form');
  state.meta.settings = await api('PUT', '/api/settings', { folderPattern: f.folderPattern.value, autoOrganize: f.autoOrganize.checked, adoptOnSave: f.adoptOnSave.checked, translateNames: f.translateNames.checked, slicer: f.slicer.value, slicers: [...f.querySelectorAll('input[name=slicer-on]:checked')].map((x) => x.value).join(','), pcPaths: Object.fromEntries([...f.querySelectorAll('input[name^="pc-"]')].map((x) => [x.name.slice(3), x.value.trim()])), extractArchives: f.extractArchives.checked, keepArchive: f.keepArchive.checked, extractNested: f.extractNested.checked, autoThumbs: f.autoThumbs.checked, optimizeImages: f.optimizeImages.checked, optimizeStrength: f.optimizeStrength.value, displayFormat: f.displayFormat.value, archiveAuto: f.archiveAuto.checked, archiveFormat: f.archiveFormat.value, archiveParts: readParts() });
}
let tplTimer;
function previewTpl() {
  clearTimeout(tplTimer);
  tplTimer = setTimeout(async () => {
    const out = $('#tpl-preview'), tpl = $('#tpl').value.trim();
    if (!tpl) return out.replaceChildren();
    try {
      const r = await api('POST', '/api/organize/preview', { template: tpl });
      out.replaceChildren(el('span', { class: 'muted' }, 'Sample:'),
        ...(r.samples || []).map((x) => el('p', { class: 'mono-path', title: x.label }, el('span', { class: 'muted' }, 'Library/'), el('b', {}, x.path), el('small', { class: 'muted sample-of' }, ` ${x.label}`))),
        el('p', {}, r.count ? el('b', {}, `${r.count} of ${r.inLibrary} folders would be renamed.`) : r.inLibrary ? 'Every folder already matches this format.' : 'New imports will use this format.'),
        ...r.changes.slice(0, 4).map((c) => el('p', { class: 'mono-path' }, c.from, el('span', { class: 'arrow' }, ' becomes '), el('b', {}, c.to))));
    } catch (e) { out.replaceChildren(el('p', { class: 'error' }, e.message)); }
  }, 250);
}
$('#tpl').addEventListener('input', previewTpl);
$('#refresh-every').addEventListener('change', (e) => { localStorage.setItem('mv.refreshEvery', e.target.value); toast(e.target.value === '0' ? 'The library refreshes when a bulk import finishes' : e.target.value === '1' ? 'The library refreshes after every imported model' : `The library refreshes every ${e.target.value} imported models`); });
$('#organize-now').addEventListener('click', async () => {
  try {
    await saveLibrarySettings();
    toast('Checking your library…');
    const adopt = state.meta.settings.adoptOnSave === 'true';
    const plan = await api('POST', '/api/organize/preview', { template: state.meta.settings.folderPattern, pictures: true, adopt });
    if (!plan.count && !plan.pictureModels && !plan.outside && !plan.archiveModels) return toast('Everything already matches: folders, picture folders and archive names.');
    const gb = (n) => `${(n / 1024 ** 3).toFixed(1)} GB`;
    const what = [plan.outside && `move ${plan.outside} model${plan.outside === 1 ? '' : 's'} (${gb(plan.outsideBytes)}) into the library`, plan.count && `rename ${plan.count} model folder${plan.count === 1 ? '' : 's'}`, plan.pictureModels && `tidy pictures in ${plan.pictureModels} model${plan.pictureModels === 1 ? '' : 's'}`, plan.archiveModels && `rename ${plan.archiveFiles} archive${plan.archiveFiles === 1 ? '' : 's'} in ${plan.archiveModels} model${plan.archiveModels === 1 ? '' : 's'}`].filter(Boolean).join(', ');
    const speed = plan.outside && plan.fastMove === false
      ? ` Moving them means copying ${gb(plan.outsideBytes)} through ModelVault's server, which can take hours. If they're on the same NAS share as your library, connect that share under Import existing library > Network folders first and the move becomes a quick rename.`
      : plan.outside ? ' They are on the same share as your library, so each move is a quick rename.' : '';
    if (!(await confirmDlg(`${what[0].toUpperCase()}${what.slice(1)}?`, `Folders are filed by your folder format, picture folders become "img", and old "Previous cover" files are cleared.${speed}`, [{ label: 'Cancel', value: '' }, { label: 'Go ahead', value: 'y', cls: 'primary' }]))) return;
    let job = await api('POST', '/api/organize/apply', { adopt });
    pollJobs(true);
    const out = $('#tpl-preview');
    while (job.status === 'running') { out.replaceChildren(el('p', {}, `Renaming ${job.done} of ${job.total}`)); await new Promise((r) => setTimeout(r, 500)); job = await api('GET', `/api/jobs/${job.id}`); }
    out.replaceChildren(el('p', {}, el('b', {}, `Done. ${job.moved} folders renamed, pictures tidied in ${job.tidied || 0} models${job.archives ? `, archives named in ${job.archives}` : ''}.`)),
      job.stuck ? el('p', {}, `${job.stuck} weren't moved. `, el('button', { type: 'button', class: 'link-inline', onclick: () => { checkStuck(); openStuck(); } }, 'Choose what to do with them')) : '',
      job.errors.length ? el('details', {}, el('summary', {}, `${job.errors.length} skipped`), el('ul', {}, job.errors.slice(0, 100).map((x) => el('li', {}, x)))) : '');
    refresh();
  } catch (e) { fail(e); }
});
// ---- watch folders: a list with "Add a folder to watch…" (any folder on Windows) ----
const watchSpecs = () => String($('#watch-form').watchFolders.value || '').split(',').map((x) => x.trim()).filter(Boolean);
/** "downloads/New models" → its real path, when the location is known. */
function watchPath(spec) {
  const [root, ...rest] = spec.replace(/\\/g, '/').split('/').filter(Boolean);
  const base = state.meta.rootPaths?.[root] || state.meta.rootPaths?.[root?.toLowerCase()];
  if (!base) return '';
  const sep = state.meta.platform === 'win32' ? '\\' : '/';
  return [base.replace(/[\\/]+$/, ''), ...rest].join(sep);
}
function watchLabel(spec) {
  const [root, ...rest] = spec.replace(/\\/g, '/').split('/').filter(Boolean);
  return [rootLabel(root), ...rest].join(' › ');
}
async function saveWatchList(specs) {
  $('#watch-form').watchFolders.value = specs.join(', ');
  state.meta.settings = await api('PUT', '/api/settings', { watchFolders: specs.join(', ') });
  drawWatchStatus();
  setTimeout(async () => { await pollInbox(); drawWatchStatus(); }, 800);
}
function drawWatchStatus() {
  const st = new Map((inbox.data.folders || []).map((x) => [x.spec, x]));
  const specs = watchSpecs();
  $('#watch-add-note').textContent = state.meta.platform === 'win32' ? 'Any folder on this PC, a mapped drive or a shared folder.' : 'A folder ModelVault can see. To watch a folder on another NAS or PC, connect it first under Import existing library > Network folders.';
  $('#watch-list').replaceChildren(...(specs.length ? specs.map((spec) => {
    const x = st.get(spec);
    return el('li', { class: `loc${x?.error ? ' off' : ''}` },
      el('span', { class: 'ficon folder' }, svg(ICON.folder)),
      el('div', { class: 'loc-text' }, el('b', {}, watchLabel(spec)), el('small', { class: 'mono' }, watchPath(spec) || spec),
        x ? el('small', { class: x.error ? 'error' : 'muted' }, x.error || `${x.files} file${x.files === 1 ? '' : 's'} waiting`) : ''),
      el('button', { type: 'button', class: 'btn small ghost danger', onclick: async () => { try { await saveWatchList(specs.filter((y) => y !== spec)); toast(`Stopped watching ${watchLabel(spec)}`); } catch (e) { fail(e); } } }, 'Stop watching'));
  }) : [el('li', { class: 'muted watch-empty' }, 'No folder is being watched yet.')]));
}
$('#watch-add').addEventListener('click', async () => {
  const specs = watchSpecs();
  const add = async (spec) => {
    if (specs.includes(spec)) return toast('That folder is already watched');
    try { await saveWatchList([...specs, spec]); toast(`Watching ${watchLabel(spec)}`); } catch (e) { fail(e); }
  };
  if (state.meta.platform !== 'win32') {
    openBrowser({ mode: 'pick', root: 'downloads', onPick: (root, p) => add(p ? `${root}/${p}` : root) });
    return;
  }
  // Windows: any folder. Inside a folder ModelVault already has, it's watched there; otherwise it's added as a folder first.
  const got = await pickPcFolder({ title: 'Choose a folder to watch', action: 'Watch' });
  if (!got) return;
  const norm = (x) => x.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  const want = norm(got.path);
  const inside = Object.entries(state.meta.rootPaths || {}).filter(([, base]) => want === norm(base) || want.startsWith(`${norm(base)}\\`)).sort((a, b) => b[1].length - a[1].length)[0];
  if (inside) {
    const rel = got.path.replace(/\//g, '\\').slice(inside[1].replace(/[\\/]+$/, '').length).split('\\').filter(Boolean);
    return add([inside[0], ...rel].join('/'));
  }
  try {
    const { list } = await api('POST', '/api/locations/folder', { folder: got.path, name: got.path.split(/[\\/]/).filter(Boolean).pop() });
    await loadMeta();
    await add(list[list.length - 1].key);
    openSettings('watch'); // shows the new folder under Folder paths on your PC too
  } catch (e) { fail(e); }
});
$('#watch-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const w = e.target;
  try {
    state.meta.settings = await api('PUT', '/api/settings', { watchFolders: w.watchFolders.value, watchAuto: w.watchAuto.value, watchGap: w.watchGap.value, watchQuiet: w.watchQuiet.value });
    toast('Watch settings saved');
    setTimeout(async () => { await pollInbox(); drawWatchStatus(); }, 600);
  } catch (err) { fail(err); }
});
function drawCatEditor() {
  $('#cat-editor').replaceChildren(...state.meta.groups.map((g) => {
    const nameIn = el('input', { class: 'cat-name', value: g.name, 'aria-label': `Name of the ${g.name} category`, spellcheck: 'false' });
    nameIn.addEventListener('change', async () => { try { await api('PATCH', `/api/groups/${g.id}`, { name: nameIn.value }); await refreshMetaUi(); toast('Category renamed'); } catch (e) { fail(e); } });
    nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); nameIn.blur(); } if (e.key === 'Escape') { nameIn.value = g.name; nameIn.blur(); } });
    const addIn = el('input', { class: 'set-input', placeholder: `Add to ${g.name}…`, 'aria-label': `Add a value to ${g.name}`, autocomplete: 'off' });
    const add = async () => {
      if (!addIn.value.trim()) return addIn.focus();
      try { await api('POST', `/api/groups/${g.id}/values`, { name: addIn.value }); await refreshMetaUi(); $(`[aria-label="Add a value to ${CSS.escape(g.name)}"]`)?.focus(); } catch (er) { fail(er); }
    };
    addIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    const used = g.values.reduce((n, v) => n + (v.count ? 1 : 0), 0);
    const vals = el('div', { class: 'vals' }, g.values.length ? g.values.map((v) => el('span', { class: 'val', 'data-name': v.name.toLowerCase() },
      el('span', { class: 'val-name' }, v.name), v.count ? el('span', { class: 'val-count', title: `${v.count} model${v.count === 1 ? '' : 's'}` }, v.count) : '',
      el('button', { type: 'button', 'aria-label': `Remove ${v.name}`, title: 'Remove', onclick: async () => {
        if (v.count && !(await confirmDlg(`Remove ${v.name}?`, `${v.count} model${v.count > 1 ? 's use' : ' uses'} it. They keep everything else.`, [{ label: 'Cancel', value: '' }, { label: 'Remove', value: 'y', cls: 'primary' }]))) return;
        try { await api('DELETE', `/api/values/${v.id}`); await refresh(); drawCatEditor(); } catch (e) { fail(e); }
      } }, svg(ICON.x)))) : el('p', { class: 'muted vals-empty' }, 'No values yet. Add the first one below.'));
    // Long lists get a quick filter.
    const find = g.values.length > 12 ? el('input', { type: 'search', class: 'cat-find', placeholder: 'Find…', 'aria-label': `Find in ${g.name}`, oninput: (e) => {
      const q = e.target.value.trim().toLowerCase();
      for (const v of vals.children) v.hidden = !!q && !String(v.dataset.name || '').includes(q);
    } }) : '';
    return el('section', { class: 'cat-card', 'aria-label': g.name },
      el('header', { class: 'cat-head' },
        el('div', { class: 'cat-title' }, nameIn, el('span', { class: 'cat-meta' }, `${g.values.length} value${g.values.length === 1 ? '' : 's'}${g.values.length ? `, ${used} in use` : ''}${g.builtin ? ' · Built-in' : ''}`)),
        find,
        g.builtin ? '' : el('button', { type: 'button', class: 'btn small ghost danger', onclick: async () => {
          if (!(await confirmDlg(`Delete the ${g.name} category?`, 'Its values are removed from every model. Files are not touched.', [{ label: 'Cancel', value: '' }, { label: 'Delete category', value: 'y', cls: 'primary' }]))) return;
          try { await api('DELETE', `/api/groups/${g.id}`); await refresh(); drawCatEditor(); } catch (e) { fail(e); }
        } }, 'Delete category')),
      vals,
      el('div', { class: 'cat-add' }, addIn, el('button', { type: 'button', class: 'btn small ghost', onclick: add }, 'Add')));
  }));
  $('#designer-count').textContent = state.meta.designers.length || '';
  $('#designer-editor').replaceChildren(...(state.meta.designers.length ? state.meta.designers.map((d) => {
    const inp = el('input', { class: 'inline-input', value: d.name, 'aria-label': `Rename designer ${d.name}` });
    inp.addEventListener('change', async () => { try { await api('POST', '/api/designers/rename', { from: d.name, to: inp.value }); await refresh(); drawCatEditor(); toast('Designer updated'); } catch (e) { fail(e); } });
    return el('label', {}, inp, el('span', { class: 'count', title: `${d.count} model${d.count === 1 ? '' : 's'}` }, `${d.count}`));
  }) : [el('p', { class: 'muted' }, 'Designers appear here once models have one.')]));
  filterDesigners();
}
function filterDesigners() {
  const q = ($('#designer-q').value || '').trim().toLowerCase();
  for (const row of $$('#designer-editor > label')) row.hidden = !!q && !$('input', row).value.toLowerCase().includes(q);
}
$('#designer-q').addEventListener('input', filterDesigners);
{
  const fold = $('#designers-fold');
  try { fold.open = localStorage.getItem('mv.designersOpen') === '1'; } catch { /* closed by default */ }
  fold.addEventListener('toggle', () => { try { localStorage.setItem('mv.designersOpen', fold.open ? '1' : '0'); } catch { /* ignore */ } });
}
async function refreshMetaUi() { await loadMeta(); drawCatEditor(); renderFilters(); }
$('#new-group').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { await api('POST', '/api/groups', { name: e.target.name.value }); e.target.reset(); await refreshMetaUi(); toast('Category added'); } catch (er) { fail(er); }
});

// existing library import
const scanForm = $('#scan-form');
// ---------------- network folders ----------------
const SETUP_YAML = `    cap_add:
      - SYS_ADMIN
      - DAC_READ_SEARCH
    security_opt:
      - apparmor:unconfined`;
// ---------- Windows: pick folders on this PC (drives, mapped drives, shared folders) ----------
function pickPcFolder({ title, action = 'Use this folder', withName = false, start = '' }) {
  return new Promise((resolve) => {
    const d = el('dialog', { class: 'sheet narrow pcpick', 'aria-label': title });
    document.body.append(d);
    let result = null, cur = '';
    d.addEventListener('close', () => { d.remove(); resolve(result); });
    const body = el('div', { class: 'sheet-body stack' });
    const typed = el('input', { type: 'text', placeholder: 'Or type a path: D:\\3D Models or \\\\nas\\share\\Models', spellcheck: 'false', autocomplete: 'off' });
    const name = el('input', { type: 'text', placeholder: 'Name to show in ModelVault (optional)', autocomplete: 'off' });
    const go = async (p) => {
      let r;
      try { r = await api('GET', `/api/pc/folders?path=${encodeURIComponent(p || '')}`); } catch (e) { toast(e.message, true); return; }
      cur = r.path;
      const row = (label, sub, target, icon = ICON.folder) => el('li', {}, el('button', { type: 'button', class: 'pc-row', onclick: () => go(target) }, el('span', { class: 'ficon folder' }, svg(icon)), el('span', { class: 'pc-name' }, el('b', {}, label), sub && el('small', { class: 'muted' }, sub))));
      const crumbs = [];
      if (cur) {
        const parts = cur.startsWith('\\\\') ? (() => { const [h, sh, ...rest] = cur.slice(2).split('\\').filter(Boolean); const out = [[`\\\\${h}\\${sh}`, `\\\\${h}\\${sh}\\`]]; let acc = `\\\\${h}\\${sh}`; for (const x of rest) { acc += `\\${x}`; out.push([x, acc]); } return out; })()
          : (() => { const segs = cur.split('\\').filter(Boolean); let acc = ''; return segs.map((x, i) => { acc = i === 0 ? `${x}\\` : `${acc}${acc.endsWith('\\') ? '' : '\\'}${x}`; return [x, acc]; }); })();
        crumbs.push(el('button', { type: 'button', class: 'link-inline', onclick: () => go('') }, 'This PC'));
        for (const [label, target] of parts) crumbs.push(el('span', { class: 'muted' }, ' › '), el('button', { type: 'button', class: 'link-inline', onclick: () => go(target) }, label));
      }
      body.replaceChildren(
        cur ? el('div', { class: 'pc-crumbs' }, ...crumbs) : el('p', { class: 'muted' }, 'Choose a drive or a folder, then open the folder you want.'),
        el('ul', { class: 'pc-list', role: 'list' },
          ...(cur ? [
            r.parent !== undefined && el('li', {}, el('button', { type: 'button', class: 'pc-row up', onclick: () => go(r.parent) }, el('span', { class: 'ficon' }, svg('<path d="M12 19V5M5 12l7-7 7 7"/>')), el('b', {}, 'Up one level'))),
            ...r.dirs.map((n) => row(n, '', `${cur}${cur.endsWith('\\') ? '' : '\\'}${n}`)),
            !r.dirs.length && el('li', { class: 'muted pc-empty' }, `No folders in here${r.files ? ` (${r.files} file${r.files === 1 ? '' : 's'})` : ''}.`),
          ] : [
            ...r.drives.map((x) => row(x.name, x.network || 'This PC', x.path, x.network ? '<rect x="3" y="5" width="18" height="10" rx="2"/><path d="M12 15v4M7 19h10"/>' : '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="17" cy="12" r="1"/>')),
            ...r.places.map((x) => row(x.name, x.path, x.path)),
          ])),
        el('div', { class: 'pc-typed' }, typed, el('button', { type: 'button', class: 'btn small ghost', onclick: () => typed.value.trim() && go(typed.value.trim()) }, 'Go')),
        withName && cur ? name : '',
        el('div', { class: 'form-actions' },
          el('button', { type: 'button', class: 'btn primary', disabled: !cur, onclick: () => { result = { path: cur, name: name.value.trim() }; d.close(); } }, cur ? `${action}: ${cur.split('\\').filter(Boolean).pop() || cur}` : action),
          el('button', { type: 'button', class: 'btn ghost', onclick: () => d.close() }, 'Cancel')));
    };
    typed.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (typed.value.trim()) go(typed.value.trim()); } });
    d.append(el('header', { class: 'sheet-head' }, el('h2', {}, title), el('button', { class: 'icon-btn close', type: 'button', 'aria-label': 'Close', onclick: () => d.close() }, svg(ICON.x || '<path d="m6 6 12 12M18 6 6 18"/>'))), body);
    d.showModal();
    go(start);
  });
}
async function drawPcFolders(r) {
  const box = $('#pc-folders');
  box.hidden = !r.windows;
  if (!r.windows) return;
  let p = null;
  try { p = await api('GET', '/api/pc/paths'); } catch { /* older server */ }
  const change = (k, label) => el('button', { type: 'button', class: 'btn small ghost', onclick: async () => {
    const got = await pickPcFolder({ title: `Choose the ${label.toLowerCase()} folder`, start: p?.[k] || '' });
    if (!got) return;
    if (!(await confirmDlg(`Use ${got.path} as the ${label.toLowerCase()} folder?`, k === 'library' ? 'New imports go there. Models already in ModelVault stay where they are. ModelVault restarts to switch (a few seconds).' : 'ModelVault looks for new downloads there. It restarts to switch (a few seconds).', [{ label: 'Cancel', value: '' }, { label: 'Switch and restart', value: 'y', cls: 'primary' }]))) return;
    try { await api('POST', '/api/pc/paths', { [k]: got.path }); toast('Restarting ModelVault…'); setTimeout(() => location.reload(), 6000); } catch (e) { fail(e); }
  } }, 'Change…');
  $('#pc-where').replaceChildren(...(p ? [['library', 'Library'], ['downloads', 'Downloads']].flatMap(([k, label]) => [el('dt', {}, label), el('dd', {}, el('code', {}, p[k]), change(k, label))]) : []));
  const local = r.list.filter((l) => l.local);
  $('#pc-list').replaceChildren(...local.map((l) => el('li', { class: `loc${l.mounted ? '' : ' off'}` },
    el('span', { class: 'ficon folder' }, svg(ICON.folder)),
    el('div', { class: 'loc-text' }, el('b', {}, l.label), el('small', {}, l.path), !l.mounted && el('small', { class: 'error' }, l.error || 'Not available')),
    !l.mounted && el('button', { class: 'btn small ghost', onclick: async () => { try { await api('POST', `/api/locations/${l.key}/retry`); drawLocations(); } catch (e) { fail(e); drawLocations(); } } }, 'Reconnect'),
    el('button', { class: 'btn small ghost danger', onclick: async () => {
      if (!(await confirmDlg(`Remove ${l.label} from ModelVault?`, 'Nothing in the folder is changed or deleted. Models imported from it stay in your library.', [{ label: 'Cancel', value: '' }, { label: 'Remove', value: 'y', cls: 'primary' }]))) return;
      try { await api('DELETE', `/api/locations/${l.key}`); await loadMeta(); fillScanRoots(); drawLocations(); } catch (e) { fail(e); }
    } }, 'Remove'))));
}
$('#pc-add').addEventListener('click', async () => {
  const got = await pickPcFolder({ title: 'Add a folder', action: 'Add', withName: true });
  if (!got) return;
  try {
    const { list } = await api('POST', '/api/locations/folder', { folder: got.path, name: got.name });
    const added = list[list.length - 1];
    await loadMeta(); fillScanRoots(added.key); $('#scan-path').value = ''; $('#scan-go').disabled = true;
    await drawLocations();
    toast(`Added ${added.label}. Choose Preview below to see what it holds.`);
  } catch (e) { fail(e); }
});
async function drawLocations() {
  let r;
  try { r = await api('GET', '/api/locations'); } catch (e) { return; }
  drawPcFolders(r);
  if (r.windows) { $('#netloc-h').textContent = 'Network folders with a password'; }
  const setup = $('#loc-setup');
  setup.hidden = r.canMount && !r.windows;
  { const u = $('#loc-form input[name=username]'); if (u) u.required = !r.windows; }
  if (r.windows) setup.replaceChildren(el('p', {}, 'Only needed when Windows asks for a password to open the share. If File Explorer opens it already, use "Add a folder…" above instead.'));
  if (!r.canMount) {
    const code = el('pre', { class: 'yaml' }, SETUP_YAML);
    setup.replaceChildren(
      el('b', {}, 'One-time setup first'),
      el('p', {}, 'ModelVault needs permission to connect to network folders. After this, anyone can add folders here without touching Container Manager.'),
      el('ol', {},
        el('li', {}, 'In Container Manager, open Project > modelvault > YAML Configuration.'),
        el('li', {}, 'Find the line ', el('code', {}, 'restart: unless-stopped'), ' and paste these lines straight underneath it, keeping the spaces at the start:')),
      code,
      el('div', { class: 'form-actions' }, el('button', { type: 'button', class: 'btn small ghost', onclick: async () => { try { await navigator.clipboard.writeText(SETUP_YAML); toast('Copied'); } catch { const rg = document.createRange(); rg.selectNodeContents(code); getSelection().removeAllRanges(); getSelection().addRange(rg); toast('Selected. Press Ctrl+C to copy'); } } }, 'Copy the lines')),
      el('p', { class: 'muted' }, 'The editor sometimes adds extra spaces when you paste. Check that cap_add and security_opt start exactly under the r of restart, and each dash line is two spaces further in. If the build says "did not find expected key", the spacing is off.'),
      el('ol', { start: 3 }, el('li', {}, 'Save and let the project rebuild, then come back here.')));
  }
  $('#loc-form').querySelector('button[type=submit]').disabled = !r.canMount;
  $('#loc-list').replaceChildren(...r.list.filter((l) => !l.local).map((l) => el('li', { class: `loc${l.mounted ? '' : ' off'}` },
    el('span', { class: `ficon ${l.mounted ? 'folder' : ''}` }, svg(ICON.folder)),
    el('div', { class: 'loc-text' }, el('b', {}, l.label), el('small', {}, l.path), !l.mounted && el('small', { class: 'error' }, l.error || 'Not connected')),
    !l.mounted && el('button', { class: 'btn small ghost', onclick: async () => { try { await api('POST', `/api/locations/${l.key}/retry`); toast(`Reconnected ${l.label}`); drawLocations(); } catch (e) { fail(e); drawLocations(); } } }, 'Reconnect'),
    el('button', { class: 'btn small ghost danger', onclick: async () => {
      if (!(await confirmDlg(`Disconnect ${l.label}?`, 'Nothing on the NAS is changed or deleted. Models imported from it stay in your library, but their files cannot be opened until you connect the folder again.', [{ label: 'Cancel', value: '' }, { label: 'Disconnect', value: 'y', cls: 'primary' }]))) return;
      try { await api('DELETE', `/api/locations/${l.key}`); await loadMeta(); fillScanRoots(); drawLocations(); toast(`Disconnected ${l.label}`); } catch (e) { fail(e); }
    } }, 'Disconnect'))));
}
function fillScanRoots(select) {
  const pick = select || $('#scan-root').value;
  $('#scan-root').replaceChildren(...state.meta.roots.map((r) => el('option', { value: r, selected: r === pick }, rootLabel(r))));
  syncRelocate();
}
$('#loc-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, btn = f.querySelector('button[type=submit]'), msg = $('#loc-msg');
  btn.disabled = true; msg.textContent = 'Connecting…'; msg.className = 'muted';
  try {
    const { list } = await api('POST', '/api/locations', { networkPath: f.networkPath.value, username: f.username.value, password: f.password.value, name: f.name.value });
    const added = list[list.length - 1];
    f.reset(); msg.textContent = '';
    await loadMeta(); fillScanRoots(added.key); $('#scan-path').value = ''; $('#scan-go').disabled = true;
    await drawLocations();
    toast(`Connected ${added.label}. Choose Preview below to see what it holds.`);
    $('#scan-form button[type=submit]').focus();
  } catch (er) { msg.textContent = er.message; msg.className = 'error'; }
  finally { btn.disabled = false; drawLocations(); }
});

function syncRelocate() { $('#relocate-wrap').hidden = $('#scan-root').value === 'library'; }
$('#scan-root').addEventListener('change', () => { syncRelocate(); $('#scan-go').disabled = true; });
$('#scan-path').addEventListener('input', () => { $('#scan-go').disabled = true; });
$('#scan-browse').addEventListener('click', () => openBrowser({ mode: 'pick', root: $('#scan-root').value, onPick: (root, p) => { $('#scan-root').value = root; $('#scan-path').value = p; syncRelocate(); $('#scan-go').disabled = true; } }));
const scanBody = () => ({ root: scanForm.root.value, path: scanForm.path.value, mode: scanForm.mode.value, coverMode: scanForm.coverMode.value, relocate: scanForm.relocate.checked });
scanForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const out = $('#scan-result');
  out.replaceChildren(el('div', { class: 'progress indeterminate', 'aria-label': 'Scanning' }, el('i')));
  try {
    const r = await api('POST', '/api/scan/preview', scanBody());
    $('#scan-go').disabled = !r.count;
    out.replaceChildren(el('div', { class: 'scan-summary' },
      el('p', {}, el('b', {}, `${r.count} models found`), r.withMetadata ? `, ${r.withMetadata} with details from another app` : '', r.existing ? `. ${r.existing} are already in your library and will be updated.` : '.'),
      el('p', { class: 'muted' }, r.withMetadata ? `Details read from ${[r.from?.orynt3d && `Orynt3D (${r.from.orynt3d})`, r.from?.manyfold && `Manyfold (${r.from.manyfold})`, r.from?.thingiverse && `Thingiverse (${r.from.thingiverse})`].filter(Boolean).join(', ')}. The rest are named by their folders.` : 'No details from another app found. Names come from the folder names, and designers are guessed where they can be.')),
      el('div', { style: 'overflow:auto;max-height:46vh' }, el('table', { class: 'scan-table' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Model'), el('th', {}, 'Designer'), el('th', {}, 'Categories and tags'))),
        el('tbody', {}, r.plan.map((p) => el('tr', {},
          el('td', {}, p.name, el('small', {}, p.rel)),
          el('td', {}, p.designer || '—'),
          el('td', {}, [...p.values.map((v) => `${v.group}: ${v.value}`), ...p.tags].join(', ') || '—')))))),
      r.count > r.plan.length ? el('p', { class: 'muted' }, `Showing the first ${r.plan.length}.`) : '');
  } catch (er) { out.replaceChildren(el('p', { class: 'error' }, er.message)); }
});
$('#scan-go').addEventListener('click', async () => {
  const out = $('#scan-result');
  $('#scan-go').disabled = true;
  try {
    let job = await api('POST', '/api/scan/import', scanBody());
    pollJobs(true);
    const bar = el('i');
    const label = el('p', {}, 'Importing…');
    out.replaceChildren(label, el('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Import progress' }, bar),
      el('p', { class: 'muted' }, 'You can close this window. The import carries on in the background, and its progress shows at the bottom of the sidebar.'));
    while (job.status === 'running') {
      await new Promise((r) => setTimeout(r, 1000));
      job = await api('GET', `/api/jobs/${job.id}`);
      const t = jobText(job);
      bar.style.width = `${t.pct ?? 3}%`;
      label.textContent = t.line;
    }
    out.replaceChildren(el('div', { class: 'scan-summary' }, el('p', {}, el('b', {}, `Done. ${job.added} added, ${job.updated} updated.`)),
      job.errors.length ? el('details', {}, el('summary', { class: 'error' }, `${job.errors.length} problems`), el('ul', {}, job.errors.slice(0, 100).map((x) => el('li', {}, x)))) : ''));
    refresh();
  } catch (e) { out.replaceChildren(el('p', { class: 'error' }, e.message)); }
});

// ---------------- where an imported library comes from ----------------
const SOURCES = {
  orynt3d: 'Point ModelVault at your Orynt3D library. Names, notes, tags, covers, collections and attributes from its <code>config.orynt3d</code> files are imported. Your files stay where they are unless you choose to move them.',
  other: 'ModelVault reads the details other apps keep next to your models: <b>Manyfold</b> (<code>datapackage.json</code>: name, description, tags, creator, licence, link) and <b>Thingiverse</b> downloads (<code>README.txt</code>: name, designer, link and summary). Folders from Printables, Cults3D, MyMiniFactory and other sites are imported too, named by their folders. Your files stay where they are unless you choose to move them.',
  folder: 'Index any folder that already holds models. Each model is named by its folder, and designers are guessed where they can be. Your files stay where they are unless you choose to move them.',
};
let source = (() => { try { return localStorage.getItem('mv.importSource') || 'modelvault'; } catch { return 'modelvault'; } })();
function showSource(next = source) {
  source = SOURCES[next] || next === 'modelvault' ? next : 'modelvault';
  try { localStorage.setItem('mv.importSource', source); } catch { /* not kept */ }
  for (const b of $$('#src-pick [role=radio]')) { const on = b.dataset.src === source; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; }
  $('#src-backup').hidden = source !== 'modelvault';
  $('#src-folders').hidden = source === 'modelvault';
  if (SOURCES[source]) $('#scan-intro').innerHTML = SOURCES[source];
  if (source === 'modelvault') drawSavedBackups();
}
$$('#src-pick [role=radio]').forEach((b, i, all) => {
  b.addEventListener('click', () => showSource(b.dataset.src));
  b.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (d) { e.preventDefault(); const n = all[(i + d + all.length) % all.length]; showSource(n.dataset.src); n.focus(); }
  });
});

// ---------------- restoring a backup ----------------
const when = (t) => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
async function drawSavedBackups() {
  const box = $('#restore-saved');
  let r;
  try { r = await api('GET', '/api/backup/list'); } catch { return box.replaceChildren(); }
  box.replaceChildren(...(r.list.length ? [el('p', { class: 'muted' }, 'Or restore one saved in your folders:'),
    el('ul', { class: 'backup-files', role: 'list' }, r.list.slice(0, 12).map((b) => el('li', {},
      el('span', { class: 'bf-name' }, el('b', {}, b.name), el('small', { class: 'muted' }, `${rootLabel(b.root)} · ${fmtBytes(b.size)} · ${when(b.mtime)}`)),
      el('button', { type: 'button', class: 'btn small ghost', onclick: () => inspectBackup({ root: b.root, path: b.rel }) }, 'Restore…'))))] : []));
}
$('#restore-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const out = $('#restore-panel');
  const bar = el('i', { style: 'width:0%' });
  out.replaceChildren(el('p', {}, `Uploading ${f.name}…`), el('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Upload' }, bar));
  try {
    const info = await new Promise((resolve, reject) => {
      const fd = new FormData(); fd.append('file', f, f.name);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/restore/upload');
      xhr.upload.onprogress = (ev) => { if (ev.total) bar.style.width = `${Math.round((ev.loaded / ev.total) * 100)}%`; };
      xhr.onload = () => { let j = null; try { j = JSON.parse(xhr.responseText); } catch { /* not JSON */ } if (xhr.status < 300 && j) resolve(j); else reject(new Error(j?.error || `Upload failed (${xhr.status})`)); };
      xhr.onerror = () => reject(new Error('Upload failed. Check the connection to ModelVault.'));
      xhr.send(fd);
    });
    drawRestorePlan(info);
  } catch (er) { out.replaceChildren(el('p', { class: 'error' }, er.message)); }
});
async function inspectBackup(where) {
  const out = $('#restore-panel');
  out.replaceChildren(el('p', {}, 'Reading the backup…'), el('div', { class: 'progress indeterminate', 'aria-label': 'Reading' }, el('i')));
  out.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  try { drawRestorePlan(await api('POST', '/api/restore/inspect', where)); } catch (e) { out.replaceChildren(el('p', { class: 'error' }, e.message)); }
}
function drawRestorePlan(info) {
  const out = $('#restore-panel');
  const c = info.counts || {};
  const L = info.library;
  const fromLabel = info.manifest.platform === 'win32' ? 'Windows' : info.manifest.platform === 'linux' ? 'a NAS (Docker)' : info.manifest.platform;
  const filesBox = el('input', { type: 'checkbox', checked: info.hasFiles, disabled: !info.hasFiles });
  const libBox = el('div', { class: 'restore-lib' });
  const drawLib = () => {
    const copying = info.hasFiles && filesBox.checked;
    const models = `${L.models.toLocaleString()} model${L.models === 1 ? '' : 's'} from the backup's library`;
    const lines = [];
    if (copying) {
      lines.push(el('p', {}, el('b', {}, models), ' are copied into this install\'s library folder:'), el('p', { class: 'mono-path' }, L.current),
        el('small', { class: 'muted' }, 'In the same folders as before. Files already there are kept.'));
    } else if (L.switchTo) {
      lines.push(el('p', {}, el('b', {}, models), ' open from where they are now. This install\'s library folder changes to:'), el('p', { class: 'mono-path' }, L.switchTo),
        el('small', { class: 'muted' }, `It was ${L.current}. Nothing is moved.`));
      if (!L.reachable) lines.push(el('p', { class: 'error' }, 'This PC can\'t open that folder right now. Open it once in File Explorer (sign in if asked), then choose the backup again.'));
    } else {
      lines.push(el('p', {}, el('b', {}, models), ' are in this install\'s library folder:'), el('p', { class: 'mono-path' }, L.current),
        el('small', { class: 'muted' }, L.reason === 'no-pc-path' ? 'The backup doesn\'t say how a PC reaches the NAS library (Settings > Library > Folder paths on your PC was empty), so the library folder stays as it is. Nothing is moved.'
          : L.reason === 'docker' ? 'Each model keeps its folder inside the library (the /library volume). Nothing is moved.' : 'Each model keeps its folder inside the library. Nothing is moved.'));
    }
    if (info.outside) lines.push(el('small', { class: 'muted' }, info.outside === 1 ? '1 model was outside the backup\'s library and keeps its path.' : `${info.outside.toLocaleString()} models were outside the backup's library and keep their paths.`));
    libBox.replaceChildren(...lines);
    restoreBtn.disabled = !copying && !!L.switchTo && !L.reachable;
  };
  filesBox.addEventListener('change', drawLib);
  let restoreBtn;
  out.replaceChildren(el('div', { class: 'restore-plan' },
    el('h4', {}, info.name),
    el('p', {}, `Made ${when(info.manifest.created)} with ModelVault ${info.manifest.version || '?'} on ${fromLabel}. ${fmtBytes(info.size)}.`),
    el('ul', { class: 'restore-counts' }, [
      [c.models, 'models'], [c.categories, 'category values'], [c.tags, 'tags'], [c.paintDocs, 'paint, material and tool lists'], [c.customPaints, 'paints you added'],
    ].filter(([n]) => n).map(([n, l]) => el('li', {}, el('b', {}, n.toLocaleString()), ` ${l}`)),
      info.hasFiles ? el('li', {}, el('b', {}, fmtBytes(info.fileBytes)), ' of model files') : ''),
    libBox,
    info.hasFiles ? el('label', { class: 'check' }, filesBox, el('span', {}, 'Copy the model files from the backup')) : '',
    el('p', { class: 'warn-note' }, 'Restoring replaces what\'s in ModelVault now with the backup. The current database is kept in the data folder under "before-restore". Downloads and other folder settings stay as they are. ModelVault restarts to finish (about half a minute).'),
    el('div', { class: 'form-actions' },
      restoreBtn = el('button', { type: 'button', class: 'btn primary', onclick: async (e) => {
        if (!(await confirmDlg('Restore this backup?', 'What\'s in ModelVault now is replaced by the backup (and kept aside). ModelVault restarts when it\'s done.', [{ label: 'Cancel', value: '' }, { label: 'Restore', value: 'y', cls: 'primary' }]))) return;
        e.target.disabled = true;
        try {
          let job = await api('POST', '/api/restore/apply', { token: info.token, files: filesBox.checked });
          pollJobs(true);
          const bar = el('i'), line = el('p', {}, 'Restoring…');
          out.replaceChildren(line, el('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Restore progress' }, bar));
          while (job.status === 'running') {
            await new Promise((r) => setTimeout(r, 1000));
            job = await api('GET', `/api/jobs/${job.id}`);
            const t = jobText(job); bar.style.width = `${t.pct ?? 5}%`; line.textContent = `${t.line}${t.sub ? `: ${t.sub}` : ''}`;
          }
          if (job.status !== 'done') throw new Error(job.error || 'The restore stopped.');
          line.textContent = `Ready${job.copied ? ` (${job.copied.toLocaleString()} files copied, ${job.kept.toLocaleString()} already there)` : ''}. Restarting ModelVault…`;
          await api('POST', '/api/restore/finish');
          waitForRestart();
        } catch (er) { out.append(el('p', { class: 'error' }, er.message)); e.target.disabled = false; }
      } }, 'Restore'),
      el('button', { type: 'button', class: 'btn ghost', onclick: () => out.replaceChildren() }, 'Cancel'))));
  drawLib();
}
async function waitForRestart() {
  await new Promise((r) => setTimeout(r, 4000));
  for (let i = 0; i < 90; i++) {
    try { const r = await fetch('/api/restore/last', { cache: 'no-store' }); if (r.ok) { sessionStorage.setItem('mv.justRestored', '1'); location.reload(); return; } } catch { /* still restarting */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  toast('ModelVault is taking a while to restart. Reload the page in a minute.', true);
}
(async () => {
  if (sessionStorage.getItem('mv.justRestored') !== '1') return;
  sessionStorage.removeItem('mv.justRestored');
  try {
    const r = await api('GET', '/api/restore/last');
    if (r) toast(`Backup restored: ${r.moved.toLocaleString()} models in ${r.library}${r.switched ? ' (now your library folder)' : ''}${r.left ? `; ${r.left.toLocaleString()} outside the library kept their paths` : ''}.`);
  } catch { /* ignore */ }
})();

// ---------------- about and updates ----------------
const KIND = { 'windows-installer': 'Windows (installed)', 'windows-portable': 'Windows (portable)', docker: 'Docker', source: 'run from source' };
/** Just enough Markdown for release notes: headings, bullets, bold, code and links. */
function mdLite(text) {
  const inline = (t) => {
    const out = [];
    const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:[^)\s]+)\)/g;
    let at = 0, m;
    while ((m = re.exec(t))) {
      if (m.index > at) out.push(t.slice(at, m.index));
      out.push(m[1] ? el('b', {}, m[1]) : m[2] ? el('code', {}, m[2]) : el('a', { href: m[4], target: '_blank', rel: 'noopener noreferrer' }, m[3]));
      at = re.lastIndex;
    }
    out.push(t.slice(at));
    return out;
  };
  const nodes = [];
  let list = null;
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    const li = /^\s*[-*]\s+(.*)$/.exec(line), hd = /^(#{1,4})\s+(.*)$/.exec(line);
    if (li) { if (!list) { list = el('ul'); nodes.push(list); } list.append(el('li', {}, ...inline(li[1]))); continue; }
    list = null;
    if (hd) nodes.push(el('h4', {}, ...inline(hd[2])));
    else if (line.trim()) nodes.push(el('p', {}, ...inline(line)));
  }
  return nodes;
}
async function drawAbout() {
  try {
    const a = await api('GET', '/api/about');
    $('#about-name').textContent = `ModelVault ${a.version}`;
    $('#about-sub').textContent = `by V3sper Studios · ${KIND[a.kind] || a.kind}`;
    const row = (k, v) => [el('dt', {}, k), el('dd', {}, v)];
    $('#about-info').replaceChildren(
      ...row('Version', `${a.version} · ${KIND[a.kind] || a.kind} · Node.js ${a.node.replace(/^v/, '')}`),
      ...row('Library', `${a.counts.models.toLocaleString()} models from ${a.counts.designers.toLocaleString()} designers, ${a.counts.tags.toLocaleString()} tags`),
      ...row('Data folder', el('code', {}, a.dataDir)),
      ...Object.entries(a.folders).flatMap(([k, v]) => row(rootLabel(k), el('code', {}, v))),
      ...row('Running since', new Date(a.startedAt).toLocaleString()),
      ...row('Source', el('a', { href: `https://github.com/${a.repo}`, target: '_blank', rel: 'noopener noreferrer' }, `github.com/${a.repo}`)));
  } catch (e) { $('#about-info').replaceChildren(el('dd', { class: 'error' }, e.message)); }
  drawUpdate(await api('GET', '/api/update').catch(() => null));
}
let updPoll = null;
function drawUpdate(u) {
  if (!u) return;
  const box = $('#upd-status');
  $('#upd-check').checked = u.auto.check;
  $('#upd-auto').checked = u.auto.install;
  $('#upd-token-clear').hidden = !u.hasToken;
  $('#about-dot').hidden = !u.available;
  $('#settings-btn').classList.toggle('has-dot', !!u.available);
  const checked = u.checkedAt ? `Checked ${new Date(u.checkedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.` : 'Not checked yet.';
  const checkBtn = el('button', { type: 'button', class: 'btn ghost', onclick: async (e) => { e.target.disabled = true; e.target.textContent = 'Checking…'; drawUpdate(await api('POST', '/api/update/check').catch((er) => { fail(er); return u; })); } }, 'Check for updates');
  const job = u.job;
  if (job && (job.status === 'running' || job.phase === 'restarting') && job.status !== 'error') {
    const label = job.phase === 'download' ? `Downloading ModelVault ${job.to}${job.pct != null ? `: ${job.pct}%` : '…'}` : job.phase === 'install' ? `Installing ModelVault ${job.to}…` : `Restarting with ModelVault ${job.to}. This page reloads by itself.`;
    box.replaceChildren(el('p', {}, el('b', {}, label)), el('div', { class: `progress${job.phase === 'download' && job.pct != null ? '' : ' indeterminate'}`, role: 'progressbar', 'aria-label': label }, el('i', { style: job.pct != null && job.phase === 'download' ? `width:${job.pct}%` : '' })));
    clearTimeout(updPoll);
    if (job.phase === 'restarting') waitForNewVersion(job.to);
    else updPoll = setTimeout(async () => drawUpdate(await api('GET', '/api/update').catch(() => null)), 1000);
    return;
  }
  const parts = [];
  if (u.error) parts.push(el('p', { class: 'error' }, u.error));
  if (u.available) {
    parts.push(el('p', {}, el('b', {}, `ModelVault ${u.latest} is available.`), ` You have ${u.version}. `, el('span', { class: 'muted' }, checked)));
    parts.push(el('div', { class: 'form-actions' },
      u.asset ? el('button', { type: 'button', class: 'btn primary', onclick: async (e) => {
        if (!(await confirmDlg(`Install ModelVault ${u.latest}?`, `It downloads ${u.asset.name} (${fmtBytes(u.asset.size)}) and restarts ModelVault, which takes about half a minute. Your library and settings stay as they are.`, [{ label: 'Cancel', value: '' }, { label: 'Download and install', value: 'y', cls: 'primary' }]))) return;
        e.target.disabled = true;
        try { drawUpdate(await api('POST', '/api/update/install')); } catch (er) { fail(er); e.target.disabled = false; }
      } }, `Download and install ${u.latest}`) : el('p', { class: 'muted' }, 'This release has no file for this kind of install.'),
      u.url && el('a', { class: 'btn ghost', href: u.url, target: '_blank', rel: 'noopener noreferrer' }, 'Release page'), checkBtn));
  } else {
    if (!u.error) parts.push(el('p', {}, u.latest ? el('b', {}, `You have the newest version (${u.version}).`) : 'ModelVault can check GitHub for a newer version.', ' ', el('span', { class: 'muted' }, checked)));
    parts.push(el('div', { class: 'form-actions' }, checkBtn));
  }
  if (job?.status === 'error') parts.push(el('p', { class: 'error' }, `The last update didn't install: ${job.error}`));
  box.replaceChildren(...parts);
  $('#upd-notes').replaceChildren(...(u.notes && u.latest ? [el('details', { class: 'upd-notes', open: !!u.available }, el('summary', {}, `What's in ${u.latest}`), el('div', { class: 'md' }, ...mdLite(u.notes)))] : []));
}
async function waitForNewVersion(to) {
  await new Promise((r) => setTimeout(r, 5000));
  for (let i = 0; i < 120; i++) {
    try { const m = await fetch('/api/meta', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)); if (m && m.version === to) { sessionStorage.setItem('mv.updatedTo', to); location.reload(); return; } } catch { /* restarting */ }
    await new Promise((r) => setTimeout(r, 2500));
  }
  toast('The update is taking a while. Reload the page in a minute.', true);
}
{
  const to = sessionStorage.getItem('mv.updatedTo');
  if (to) { sessionStorage.removeItem('mv.updatedTo'); setTimeout(() => toast(`ModelVault updated to ${to}`), 1500); }
}
for (const [id, key] of [['#upd-check', 'updateCheck'], ['#upd-auto', 'updateAuto']]) {
  $(id).addEventListener('change', async (e) => {
    try { state.meta.settings = await api('PUT', '/api/settings', { [key]: e.target.checked }); toast(e.target.checked ? 'Turned on' : 'Turned off'); } catch (er) { fail(er); }
  });
}
$('#upd-token-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const t = e.target.token.value.trim();
  if (!t) return;
  try { drawUpdate(await api('PUT', '/api/update/token', { token: t })); e.target.token.value = ''; toast('Token saved'); } catch (er) { fail(er); }
});
$('#upd-token-clear').addEventListener('click', async () => { try { drawUpdate(await api('PUT', '/api/update/token', { token: '' })); toast('Token removed'); } catch (er) { fail(er); } });

// ---------------- making a backup ----------------
async function drawBackup() {
  try {
    const e = await api('GET', '/api/backup/estimate');
    $('#bk-lite-size').textContent = `About ${fmtBytes(e.dataBytes)} for ${e.models.toLocaleString()} models.`;
    $('#bk-full-size').textContent = `About ${fmtBytes(e.dataBytes + e.modelBytes)}, including ${fmtBytes(e.modelBytes)} of model files.`;
  } catch { /* leave blank */ }
  let r;
  try { r = await api('GET', '/api/backup/list'); } catch { return; }
  $('#backup-list').replaceChildren(r.list.length ? el('ul', { class: 'backup-files', role: 'list' }, r.list.map((b) => el('li', {},
    el('span', { class: 'bf-name' }, el('b', {}, b.name), el('small', { class: 'muted' }, `${rootLabel(b.root)} > ModelVault backups · ${fmtBytes(b.size)} · ${when(b.mtime)}`)),
    el('button', { type: 'button', class: 'btn small ghost', onclick: () => { selectTab('existing'); drawLocations(); showSource('modelvault'); inspectBackup({ root: b.root, path: b.rel }); } }, 'Restore…'))))
    : el('p', { class: 'muted' }, 'No saved backups yet.'));
}
for (const b of $$('#pane-backup [data-save]')) b.addEventListener('click', async () => {
  const full = b.dataset.save === '1';
  const roots = state.meta.roots;
  const sel = el('select', { class: 'set-select' }, roots.map((r) => el('option', { value: r, selected: r === 'library' }, rootLabel(r))));
  const d = el('dialog', { class: 'sheet narrow' });
  document.body.append(d);
  const done = new Promise((resolve) => d.addEventListener('close', () => { d.remove(); resolve(d.returnValue); }));
  d.append(el('header', { class: 'sheet-head' }, el('h2', {}, full ? 'Save a backup with model files' : 'Save a backup')),
    el('form', { method: 'dialog', class: 'sheet-body stack' },
      el('label', { class: 'field' }, el('span', {}, 'Save it in'), sel),
      el('p', { class: 'muted' }, 'It goes into a "ModelVault backups" folder there. For a backup with model files, choose a different drive from your library if you can, so one failing drive can\'t take both.'),
      el('div', { class: 'form-actions' }, el('button', { class: 'btn primary', value: 'go' }, 'Save backup'), el('button', { class: 'btn ghost', value: '' }, 'Cancel'))));
  d.showModal();
  if ((await done) !== 'go') return;
  try {
    await api('POST', '/api/backup/save', { full, root: sel.value });
    pollJobs(true);
    toast('Saving the backup. Progress shows at the bottom of the sidebar.');
  } catch (e) { fail(e); }
});

// ---------------- background jobs (sidebar progress) ----------------
const jobsUi = { list: [], timer: null, sinceRefresh: new Map(), dismissed: new Set(JSON.parse(sessionStorage.getItem('mv.dismissed') || '[]')), lastRefresh: 0, lastDone: new Map() };
function jobText(j) {
  if (j.type === 'backup') {
    if (j.status === 'error') return { title: j.label, line: `Stopped: ${j.firstError || 'something went wrong'}`, pct: null };
    if (j.status !== 'running') return { title: 'Backup saved', line: `${fmtBytes(j.size || 0)} in ${rootLabel(j.root)} > ModelVault backups`, pct: 100 };
    if (j.phase !== 'files' || !j.total) return { title: j.label, line: 'Saving the database and pictures…', pct: null };
    return { title: j.label, line: `Model ${Math.min(j.done + 1, j.total).toLocaleString()} of ${j.total.toLocaleString()} · ${fmtBytes(j.bytes || 0)}`, sub: j.current, pct: Math.round((j.done / j.total) * 100) };
  }
  if (j.type === 'restore') {
    if (j.status === 'error') return { title: j.label, line: `Stopped: ${j.firstError || 'something went wrong'}`, pct: null };
    if (j.status !== 'running') return { title: 'Backup ready to restore', line: 'ModelVault restarts to finish', pct: 100 };
    if (j.phase === 'files' && j.total) return { title: j.label, line: `File ${Math.min(j.done + 1, j.total).toLocaleString()} of ${j.total.toLocaleString()}`, sub: j.current, pct: Math.round((j.done / j.total) * 100) };
    return { title: j.label, line: 'Reading the backup…', pct: null };
  }
  if (j.type === 'scan') {
    if (j.status !== 'running') {
      if (j.status === 'error') return { title: j.label, line: `Stopped: ${j.firstError || 'something went wrong'}`, pct: null };
      const parts = [`${j.added} added`, j.updated && `${j.updated} updated`, j.skipped && `${j.skipped} already imported`, j.errors && `${j.errors} skipped with problems`].filter(Boolean);
      return { title: 'Import finished', line: parts.join(', '), pct: 100 };
    }
    if (j.phase === 'scan') return { title: j.label, line: `Looking through folders (${j.folders.toLocaleString()} checked)…`, pct: null };
    if (j.phase === 'archives') return { title: j.label, line: `Reading archive contents ${Math.min(j.peekDone + 1, j.peekTotal)} of ${j.peekTotal}`, sub: j.current, pct: j.peekTotal ? Math.round((j.peekDone / j.peekTotal) * 100) : 100 };
    return { title: j.label, line: `Importing model ${Math.min(j.done + 1, j.total)} of ${j.total}`, sub: j.current, pct: j.total ? Math.round((j.done / j.total) * 100) : 0 };
  }
  if (j.type === 'organize') {
    if (j.status !== 'running') return { title: j.adopted ? 'Moved into the library' : 'Folders organized', line: [j.merged && `${j.merged} merged`, j.adopted && `${j.adopted} moved into the library`, (j.moved - (j.adopted || 0)) > 0 && `${j.moved - (j.adopted || 0)} renamed`, j.tidied && `pictures tidied in ${j.tidied}`, j.archives && `archives named in ${j.archives}`, j.stuck ? `${j.stuck} not moved` : j.errors && `${j.errors} skipped`].filter(Boolean).join(', ') || 'Nothing needed changing', pct: 100 };
    return { title: j.label, line: `Model ${Math.min(j.done + 1, j.total)} of ${j.total}${j.copied ? ' (copying, this takes a while)' : ''}`, sub: j.current, pct: j.total ? Math.round((j.done / j.total) * 100) : 0 };
  }
  if (j.type === 'optimize') {
    if (j.status === 'error') return { title: j.label, line: `Stopped: ${j.firstError || 'something went wrong'}`, pct: null };
    if (j.status !== 'running') return { title: 'Pictures optimized', line: j.changed ? `${j.changed.toLocaleString()} picture${j.changed === 1 ? '' : 's'} made smaller, ${fmtBytes(j.saved)} saved${j.errors ? `, ${j.errors} skipped` : ''}` : 'They were already as small as they can be', pct: 100 };
    if (!j.total) return { title: j.label, line: 'Finding pictures…', pct: null };
    return { title: j.label, line: `Picture ${Math.min(j.done + 1, j.total).toLocaleString()} of ${j.total.toLocaleString()} · ${fmtBytes(j.saved)} saved`, sub: j.current, pct: Math.round((j.done / j.total) * 100) };
  }
  if (j.status === 'error') return { title: j.label, line: `Stopped: ${j.firstError || 'something went wrong'}`, pct: null };
  return { title: j.status === 'running' ? j.label : `Extracted ${j.name}`, line: j.status === 'running' ? `${j.pct}%` : 'Done', pct: j.pct };
}
function jobCard(j) {
  const t = jobText(j), running = j.status === 'running';
  return el('div', { class: `job${running ? '' : ' finished'}${j.status === 'error' ? ' failed' : ''}` },
    el('div', { class: 'job-head' }, running && el('span', { class: 'spinner', 'aria-hidden': 'true' }), el('b', {}, t.title),
      !running && el('button', { class: 'job-x', 'aria-label': 'Dismiss', onclick: () => { jobsUi.dismissed.add(j.id); sessionStorage.setItem('mv.dismissed', JSON.stringify([...jobsUi.dismissed])); drawJobs(); } }, svg(ICON.x))),
    el('div', { class: `progress${t.pct == null ? ' indeterminate' : ''}`, role: 'progressbar', 'aria-label': t.title, 'aria-valuenow': t.pct ?? undefined, 'aria-valuemin': 0, 'aria-valuemax': 100 }, el('i', { style: t.pct == null ? '' : `width:${t.pct}%` })),
    el('span', { class: 'job-line' }, t.line), t.sub && el('span', { class: 'job-sub', title: t.sub }, t.sub),
    !running && j.type === 'organize' && j.stuck > 0 && el('button', { type: 'button', class: 'link-inline job-act', onclick: () => { checkStuck(); openStuck(); } }, 'Choose what to do with them'));
}
function drawJobs() {
  const shown = jobsUi.list.filter((j) => j.status === 'running' || !jobsUi.dismissed.has(j.id));
  for (const box of [$('#jobs'), $('#jobs-mobile')]) box.replaceChildren(...shown.map(jobCard));
  $('#jobs-mobile').hidden = !shown.length;
}
async function pollJobs(soon = false) {
  clearTimeout(jobsUi.timer);
  if (soon) { jobsUi.timer = setTimeout(() => pollJobs(), 400); return; }
  try {
    jobsUi.list = await api('GET', '/api/jobs');
    drawJobs();
    // New models appear while a bulk import runs: every N models (Settings > Library), and always when it ends.
    const every = Number(localStorage.getItem('mv.refreshEvery') ?? 10);
    let due = false;
    for (const j of jobsUi.list.filter((x) => x.type === 'scan' || x.type === 'organize')) {
      const count = (j.added ?? 0) + (j.updated ?? 0) + (j.moved ?? 0) + (j.peekDone ?? 0);
      const last = jobsUi.sinceRefresh.get(j.id) ?? 0;
      if (every > 0 && count - last >= every) due = true;
    }
    const ended = jobsUi.list.filter((j) => j.status !== 'running' && !jobsUi.lastDone.has(`end:${j.id}`));
    const ending = ended.length > 0;
    // A move that left models behind asks what to do with them (only for jobs that finished while this page was open).
    if (ended.some((j) => j.type === 'optimize')) drawOptimizeStats();
    if (ended.some((j) => j.type === 'backup') && !$('#pane-backup').hidden) drawBackup();
    if (ended.some((j) => j.type === 'organize')) checkStuck({ open: jobsUi.seen && ended.some((j) => j.type === 'organize' && j.stuck > 0) });
    jobsUi.seen = true;
    for (const j of jobsUi.list) if (j.status !== 'running') jobsUi.lastDone.set(`end:${j.id}`, 1);
    if ((due && Date.now() - jobsUi.lastRefresh > 3000) || ending) {
      for (const j of jobsUi.list) jobsUi.sinceRefresh.set(j.id, (j.added ?? 0) + (j.updated ?? 0) + (j.moved ?? 0) + (j.peekDone ?? 0));
      jobsUi.lastRefresh = Date.now();
      await loadModels(); renderFilters(); renderGrid();
    }
  } catch { /* server restarting: try again shortly */ }
  jobsUi.timer = setTimeout(() => pollJobs(), jobsUi.list.some((j) => j.status === 'running') ? 1500 : 10000);
}

// ---------------- models that weren't moved ----------------
// Folders that hold other models (a "Renders" folder imported as its own model, supported and unsupported versions
// imported separately) can't be moved on their own, and some moves fail. The person picks what happens to each.
const stuck = { data: null, showStaying: false };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
async function checkStuck({ open = false } = {}) {
  try { stuck.data = await api('GET', `/api/organize/stuck${stuck.showStaying ? '?all=1' : ''}`); } catch { return; }
  const n = stuck.data.count;
  const note = $('#stuck-note');
  note.hidden = !n;
  note.replaceChildren(el('b', {}, `${plural(n, 'model')} weren't moved`), el('span', {}, 'Choose what to do'));
  note.setAttribute('aria-label', `${plural(n, 'model')} weren't moved. Choose what to do`);
  if ($('#stuck-dlg').open) drawStuck();
  else if (open && n && !$('#model-dlg').open && !$('#imports-dlg').open) openStuck();
}
function openStuck() { const d = $('#stuck-dlg'); drawStuck(); if (!d.open) d.showModal(); }
const FAMILY_CHOICES = [
  ['merge', 'Merge into one model', (f) => `${f.members.length === 1 ? `"${f.members[0].name}" becomes` : `The ${f.members.length} models inside become`} part of "${f.name}", with their categories and tags. No files are deleted.`],
  ['split', 'Keep as separate models', () => 'Each one gets its own folder in the library, using your folder name format.'],
  ['stay', 'Leave where they are', (f) => `${f.outside ? 'They stay where they are now' : 'Their folders stay as they are'} and you won't be asked about them again.`],
];
const ERROR_CHOICES = [['retry', 'Try again'], ['stay', 'Leave it where it is']];
function stuckChoice(name, choices, picked) {
  return el('fieldset', { class: 'radios stuck-choices' }, el('legend', { class: 'sr-only' }, 'What should happen'),
    ...choices.map(([value, label, help]) => el('label', {},
      el('input', { type: 'radio', name, value, checked: value === picked }),
      el('span', {}, el('b', {}, label), value === 'merge' ? el('span', { class: 'rec' }, ' Recommended') : '', help ? el('br') : '', help ? el('span', {}, help) : ''))));
}
function drawStuck() {
  const d = stuck.data || { families: [], errors: [], staying: 0, count: 0 };
  const list = $('#stuck-list');
  if (!d.count) {
    list.replaceChildren(el('p', { class: 'stuck-empty' }, 'Every model is where it should be. Nothing needs a decision.'));
  } else {
    list.replaceChildren(
      ...d.families.map((f) => el('section', { class: 'stuck-card', 'aria-label': f.name },
        el('div', { class: 'stuck-top' }, el('b', { class: 'stuck-name' }, f.name), el('span', { class: 'muted' }, fmtBytes(f.size))),
        el('p', { class: 'mono-path' }, f.where),
        el('p', { class: 'stuck-inside' }, `Has ${plural(f.members.length, 'more model')} inside:`),
        el('ul', { class: 'stuck-members' }, ...f.members.map((c) => el('li', {},
          el('span', {}, c.name), c.folder !== c.name ? el('span', { class: 'muted' }, ` in ${c.folder}`) : '',
          el('span', { class: 'muted' }, ` · ${c.pictures ? 'pictures only, ' : ''}${fmtBytes(c.size)}`)))),
        stuckChoice(`f${f.id}`, FAMILY_CHOICES.map(([v, l, help]) => [v, l, help(f)]), f.stay ? 'stay' : 'merge'))),
      ...(d.errors.length ? [el('h3', { class: 'stuck-h3' }, 'Moves that failed')] : []),
      ...d.errors.map((x) => el('section', { class: 'stuck-card', 'aria-label': x.name },
        el('div', { class: 'stuck-top' }, el('b', { class: 'stuck-name' }, x.name), el('span', { class: 'muted' }, fmtBytes(x.size))),
        el('p', { class: 'mono-path' }, x.where),
        el('p', { class: 'error' }, x.error),
        stuckChoice(`e${x.id}`, ERROR_CHOICES, x.stay ? 'stay' : 'retry'))));
  }
  $('#stuck-intro').textContent = d.families.length
    ? 'These folders hold other models, so moving one would carry the others along. Choose what should happen to each.'
    : d.errors.length ? 'These models couldn\'t be moved. Try again, or leave them where they are.' : '';
  const all = $('#stuck-all');
  all.hidden = d.families.length < 2;
  all.replaceChildren(el('span', { class: 'muted' }, 'Set all to'), el('div', { class: 'seg', role: 'group', 'aria-label': 'Set every choice to' },
    ...FAMILY_CHOICES.map(([v, l]) => el('button', { type: 'button', 'aria-pressed': 'false', onclick: (e) => {
      $$('#stuck-list .stuck-choices').forEach((fs) => { const r = fs.querySelector(`input[value="${v}"]`); if (r) r.checked = true; });
      $$('#stuck-all .seg button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
    } }, l))));
  const staying = $('#stuck-staying');
  staying.hidden = !d.staying && !stuck.showStaying;
  staying.replaceChildren(stuck.showStaying ? 'Showing models you chose to leave where they are. ' : `You chose to leave ${plural(d.staying, 'model')} where ${d.staying === 1 ? 'it is' : 'they are'}. `,
    el('button', { type: 'button', class: 'link-inline', onclick: () => { stuck.showStaying = !stuck.showStaying; checkStuck(); } }, stuck.showStaying ? 'Hide them' : 'Show them'));
  $('#stuck-apply').hidden = !d.count;
}
$('#stuck-note').addEventListener('click', () => { checkStuck(); openStuck(); });
$('#stuck-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const d = stuck.data, form = e.currentTarget;
  const pick = (name) => form.querySelector(`input[name="${name}"]:checked`)?.value;
  const families = d.families.map((f) => ({ id: f.id, action: pick(`f${f.id}`) })).filter((x) => x.action && !(x.action === 'stay' && d.families.find((f) => f.id === x.id).stay));
  const errors = d.errors.map((x) => ({ id: x.id, action: pick(`e${x.id}`) })).filter((x) => x.action && !(x.action === 'stay' && d.errors.find((y) => y.id === x.id).stay));
  if (!families.length && !errors.length) { $('#stuck-dlg').close(); return; }
  try {
    await api('POST', '/api/organize/resolve', { families, errors });
    $('#stuck-dlg').close();
    toast('Sorting them out. Progress shows in the sidebar.');
    pollJobs(true);
  } catch (err) { fail(err); }
});

// ---------------- confirm ----------------
function confirmDlg(title, msg, actions) {
  const dlg = $('#confirm-dlg');
  $('#confirm-h').textContent = title; $('#confirm-msg').textContent = msg;
  $('#confirm-actions').replaceChildren(...actions.map((a) => el('button', { class: `btn ${a.cls || 'ghost'}`, value: a.value }, a.label)));
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((res) => dlg.addEventListener('close', () => res(dlg.returnValue), { once: true }));
}

// ---------------- chrome ----------------
$$('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
$$('dialog.sheet').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));
let qTimer;
$('#search').addEventListener('input', (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { state.q = e.target.value.trim(); renderFilters(); renderGrid(); }, 140); });
$('#sort').value = state.sort;
$('#page-size').value = String(state.pageSize);
$('#page-size').addEventListener('change', (e) => { state.pageSize = Number(e.target.value); localStorage.setItem('mv.pageSize', state.pageSize); state.page = 1; renderGrid(); });
$('#sort').addEventListener('change', (e) => { state.sort = e.target.value; localStorage.setItem('mv.sort', state.sort); renderGrid(); });
const size = Number(localStorage.getItem('mv.card') || 220);
$('#card-size').value = size; document.documentElement.style.setProperty('--card', `${size}px`);
$('#card-size').addEventListener('input', (e) => { document.documentElement.style.setProperty('--card', `${e.target.value}px`); localStorage.setItem('mv.card', e.target.value); });
// ---------------- paint scheme in the model window ----------------
const paintHelpers = () => ({ $, $$, el, svg, api, toast, fail, confirmDlg, fmtBytes });
async function drawModelScheme(m) {
  const box = $('#model-scheme');
  if (!box) return;
  let scheme = null;
  try { scheme = (await api('GET', `/api/paint-docs?keys=scheme:${m.id}`))[`scheme:${m.id}`]; } catch { /* none */ }
  if (current?.id !== m.id) return;
  const zones = scheme?.zones || [];
  const colours = zones.flatMap((z) => ['base', 'shade', 'highlight', 'extra'].map((k) => z[k]?.h).filter(Boolean));
  box.replaceChildren(
    zones.length ? el('div', { class: 'scheme-sum' },
      el('span', { class: 'hstrip wide' }, colours.slice(0, 16).map((c) => el('i', { style: `background:${c}` }))),
      el('small', { class: 'muted' }, `${zones.length} zone${zones.length === 1 ? '' : 's'}: ${zones.map((z) => z.name).filter(Boolean).join(', ') || 'unnamed'}`)) : '',
    el('button', { type: 'button', class: 'btn small ghost', onclick: async () => {
      try {
        const mod = await import('./paints.js');
        await mod.ensureLoaded(paintHelpers());
        await mod.openScheme(current, { onsave: () => drawModelScheme(current) });
      } catch (e) { fail(e); }
    } }, zones.length ? 'Open paint scheme' : 'Plan a paint scheme'));
}

// ---------------- Models / Paints tabs ----------------
// The paint catalogue lives in its own module and is only loaded the first time Paints is opened.
let paintsMod = null, stockMod = null;
const TABS = ['models', 'paints', 'materials', 'tools'];
async function showTab(tab, { remember = true } = {}) {
  if (!TABS.includes(tab)) tab = 'models';
  document.body.dataset.tab = tab;
  for (const t of TABS) $(`#tab-${t}`).setAttribute('aria-selected', String(t === tab));
  if (remember) { try { localStorage.setItem('mv.tab', tab); } catch { /* ignore */ } }
  const hash = tab === 'models' ? '' : `#${tab}`;
  if (location.hash !== hash) history.replaceState(null, '', hash || location.pathname + location.search);
  try {
    if (tab === 'paints') { paintsMod ||= await import('./paints.js'); await paintsMod.show(paintHelpers()); }
    if (tab === 'materials' || tab === 'tools') { stockMod ||= await import('./stock.js'); await stockMod.show(tab, paintHelpers()); }
  } catch (e) { fail(e); }
  window.scrollTo({ top: 0 });
}
for (const t of TABS) $(`#tab-${t}`).addEventListener('click', () => showTab(t));
// Arrow keys move between the tabs.
$('.tabs').addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const i = TABS.indexOf(document.body.dataset.tab), next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
  showTab(next); $(`#tab-${next}`).focus();
});
const openAboutFirst = location.hash === '#about'; // from the Windows tray icon's "About"
showTab(TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : !location.hash || openAboutFirst ? (() => { try { return localStorage.getItem('mv.tab') || 'models'; } catch { return 'models'; } })() : 'models', { remember: false });

$$('.view-btn').forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.view; $$('.view-btn').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); renderFilters(); renderGrid(); }));
$('#clear-filters').addEventListener('click', clearFilters);
const syncMode = () => $$('#view-mode button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
$$('#view-mode button').forEach((b) => b.addEventListener('click', () => { state.mode = b.dataset.mode; state.folderKey = null; localStorage.setItem('mv.mode', state.mode); syncMode(); renderGrid(); }));
syncMode();
$('#group-by').addEventListener('change', (e) => { state.groupBy = e.target.value; state.folderKey = null; localStorage.setItem('mv.group', state.groupBy); renderGrid(); });
// The sidebar on narrow screens (phones, tablets upright) slides over the page: close it with its X,
// by tapping the dimmed page, with Escape, or by picking a section in it.
const narrow = () => matchMedia('(max-width: 900px)').matches;
function setSidebar(open, { focus = true } = {}) {
  const s = $('.sidebar');
  if (s.classList.contains('open') === open) return;
  s.classList.toggle('open', open);
  $('#side-scrim').hidden = !open;
  $('#menu-btn').setAttribute('aria-expanded', String(open));
  if (focus) (open ? $('#side-close') : $('#menu-btn')).focus({ preventScroll: true });
}
$('#menu-btn').addEventListener('click', () => setSidebar(!$('.sidebar').classList.contains('open')));
$('#side-close').addEventListener('click', () => setSidebar(false));
$('#side-scrim').addEventListener('click', () => setSidebar(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('.sidebar').classList.contains('open') && !document.querySelector('dialog[open]')) { e.preventDefault(); setSidebar(false); } });
$('.sidebar').addEventListener('click', (e) => { if (narrow() && e.target.closest('.view-btn')) setSidebar(false, { focus: false }); });
for (const t of ['models', 'paints', 'materials', 'tools']) $(`#tab-${t}`).addEventListener('click', () => setSidebar(false, { focus: false }));
matchMedia('(max-width: 900px)').addEventListener?.('change', (e) => { if (!e.matches) setSidebar(false, { focus: false }); });
document.addEventListener('keydown', (e) => {
  if ($('#lightbox').open) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); stepBox(e.key === 'ArrowRight' ? 1 : -1); }
    return;
  }
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.altKey && $('#model-dlg').open && !$('#confirm-dlg').open
    && !e.target.closest('input, textarea, select, [contenteditable]') && slideIndex(fileUi.active) >= 0) { e.preventDefault(); stepSlide(e.key === 'ArrowRight' ? 1 : -1); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && $('#model-dlg').open) { e.preventDefault(); $('#model-form').requestSubmit(); return; }
  if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && e.altKey && !document.querySelector('dialog[open]') && state.pageSize) {
    const pages = Math.ceil(state.list.length / state.pageSize);
    const n = state.page + (e.key === 'ArrowRight' ? 1 : -1);
    if (n >= 1 && n <= pages) { e.preventDefault(); goPage(n); }
  }
  if (e.key === '/' && !e.target.closest('input, textarea, select') && !document.querySelector('dialog[open]')) { e.preventDefault(); $('#search').focus(); }
});

const syncMove = () => $$('.move-box').forEach((b) => { b.checked = state.meta.settings.importMode !== 'copy'; });
$$('.move-box').forEach((b) => b.addEventListener('change', async () => {
  try { state.meta.settings = await api('PUT', '/api/settings', { importMode: b.checked ? 'move' : 'copy' }); syncMove(); toast(b.checked ? 'Originals will be moved into the library' : 'Originals will be copied and left in place'); }
  catch (e) { fail(e); }
}));
await refresh();
syncMove();
if (openAboutFirst) openSettings('about');
// ---------------- Settings > Tailscale: open ModelVault on a tablet or phone ----------------
let tsInfo = null, tsSave = null, qrLib = null;
const tsPort = () => tsInfo?.port || Number(location.port) || 8420;
/** "my-pc", "100.1.2.3", "my-pc.tail1.ts.net" or a full link → the link a tablet opens (null if it can't be one). */
function tsLink(raw) {
  let v = String(raw || '').trim().replace(/\s+/g, '');
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) {
    const host = v.split('/')[0];
    const hasPort = /:\d+$/.test(host);
    // A ts.net name without a port is the https address that "tailscale serve" gives.
    v = /\.ts\.net$/i.test(host) && !hasPort ? `https://${v}` : `http://${hasPort ? v : v.replace(host, `${host}:${tsPort()}`)}`;
  }
  if (!/^https?:\/\/(\[[0-9a-f:.]+\]|[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*)(:\d{1,5})?(\/[^\s]*)?$/i.test(v)) return null;
  try { const u = new URL(v); return ['http:', 'https:'].includes(u.protocol) && u.hostname ? u.href.replace(/\/$/, '') : null; } catch { return null; }
}
function loadQr() {
  qrLib ||= new Promise((resolve, reject) => {
    const sc = el('script', { src: '/lib/qrcode.js' });
    sc.onload = () => resolve(window.qrcode);
    sc.onerror = () => { qrLib = null; reject(new Error('The QR code maker could not be loaded.')); };
    document.head.append(sc);
  });
  return qrLib;
}
/** A QR code as SVG: dark squares on white with a quiet border, so every camera can read it. */
function qrSvg(qrcode, text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const n = q.getModuleCount(), m = 4, size = n + m * 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
  const svgNs = 'http://www.w3.org/2000/svg';
  const svgEl = document.createElementNS(svgNs, 'svg');
  svgEl.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svgEl.setAttribute('shape-rendering', 'crispEdges');
  svgEl.innerHTML = `<rect width="${size}" height="${size}" style="fill:#fff;stroke:none"/><path d="${d}" style="fill:#000;stroke:none"/>`;
  return svgEl;
}
async function drawTsQr() {
  const raw = $('#ts-address').value, link = tsLink(raw), box = $('#ts-qr');
  $('#ts-open').hidden = $('#ts-copy').hidden = !link;
  if (link) $('#ts-open').href = link;
  $('#ts-url').replaceChildren(link ? el('b', {}, link) : el('span', { class: raw ? 'error' : 'muted' }, raw ? 'That doesn\'t look like an address. Try the name or the 100.x.x.x address from the Tailscale app.' : 'Type an address, or pick one above, and its QR code shows here.'));
  for (const c of $$('#ts-suggest .chip')) c.classList.toggle('on', c.dataset.link === link);
  if (!link) { box.replaceChildren(el('span', { class: 'ts-qr-empty' }, 'QR code')); box.classList.add('empty'); return; }
  try {
    const qrcode = await loadQr();
    if (tsLink($('#ts-address').value) !== link) return; // the address changed meanwhile
    box.replaceChildren(qrSvg(qrcode, link)); box.classList.remove('empty');
    box.setAttribute('aria-label', `QR code for ${link}`);
  } catch (e) { box.replaceChildren(el('span', { class: 'error' }, e.message)); }
}
function saveTsAddress() {
  clearTimeout(tsSave);
  tsSave = setTimeout(async () => {
    try { state.meta.settings = await api('PUT', '/api/settings', { tailscaleAddress: $('#ts-address').value.trim() }); } catch (e) { fail(e); }
  }, 600);
}
async function drawTailscale() {
  const win = state.meta.platform === 'win32';
  const input = $('#ts-address');
  if (document.activeElement !== input) input.value = state.meta.settings.tailscaleAddress || '';
  drawTsQr();
  const code = (text) => el('span', { class: 'ts-code' }, el('code', {}, text), el('button', { type: 'button', class: 'link-btn', onclick: async () => { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Select the command and press Ctrl+C to copy it'); } } }, 'Copy'));
  const port = tsPort();
  $('#ts-steps').replaceChildren(...(win ? [
    el('li', {}, 'Install Tailscale on this PC from ', el('a', { href: 'https://tailscale.com/download', target: '_blank', rel: 'noopener noreferrer' }, 'tailscale.com/download'), ' and sign in.'),
    el('li', {}, 'Install the Tailscale app on your tablet (App Store or Google Play) and sign in with the same account.'),
    el('li', {}, 'Pick this PC\'s Tailscale address above, or type its name from the Tailscale app, then scan the QR code with the tablet.'),
    el('li', {}, el('b', {}, 'Optional, for an https:// address: '), 'open Command Prompt on this PC and run', code(`tailscale serve --bg localhost:${port}`), `Then use https://<this PC's name>.<your tailnet>.ts.net (the name ending in .ts.net, without a port). It keeps working after restarts. To turn it off, run`, code('tailscale serve --https=443 off')),
  ] : [
    el('li', {}, 'Install Tailscale on the computer or NAS that runs ModelVault. On a Synology NAS: Package Center > Tailscale, then open it and sign in.'),
    el('li', {}, 'Install the Tailscale app on your tablet (App Store or Google Play) and sign in with the same account.'),
    el('li', {}, `Type the NAS's name or 100.x.x.x address from the Tailscale app above (ModelVault adds :${port}), then scan the QR code with the tablet.`),
    el('li', {}, el('b', {}, 'Optional, for an https:// address: '), 'if you can use SSH on the NAS, run', code(`sudo tailscale serve --bg localhost:${port}`), 'Then use https://<the NAS\'s name>.<your tailnet>.ts.net, without a port.'),
  ]));
  $('#ts-help').replaceChildren(...[
    el('li', {}, el('b', {}, 'Tailscale switched on on both: '), 'the Tailscale app on the tablet and on this ', win ? 'PC' : 'computer', ' should both say Connected, signed in to the same account.'),
    el('li', {}, el('b', {}, 'Name not found: '), 'use the 100.x.x.x address instead, or turn on MagicDNS in the Tailscale admin console (DNS page).'),
    win && el('li', {}, el('b', {}, 'Windows Firewall: '), 'if you chose Cancel when Windows asked about Node.js, open Windows Security > Firewall & network protection > Allow an app through firewall > Change settings, find node.exe (in ModelVault\'s runtime folder) and tick Private. Tailscale counts as a private network. With tailscale serve this isn\'t needed.'),
    win && el('li', {}, el('b', {}, 'PC asleep: '), 'ModelVault can\'t answer while this PC sleeps. Set sleep to Never when plugged in, and turn on Start with Windows in the menu of ModelVault\'s icon next to the clock.'),
    el('li', {}, el('b', {}, 'A login: '), win ? 'to ask for a password, set APP_USER and APP_PASSWORD in Start menu > ModelVault settings, then restart ModelVault. ' : 'to ask for a password, set APP_USER and APP_PASSWORD in docker-compose.yml. ', 'With a password set you can also browse this computer\'s folders from the tablet.'),
    el('li', {}, el('b', {}, 'Slicers: '), 'opening a model in your slicer works on the computer that has the slicer. Everything else works on the tablet.'),
  ].filter(Boolean));
  // Suggestions: what this computer knows about itself.
  const box = $('#ts-suggest');
  try { tsInfo = await api('GET', '/api/addresses'); } catch { tsInfo = null; }
  const sugg = [];
  const add = (label, link) => { if (link && !sugg.some((x) => x.link === link)) sugg.push({ label, link }); };
  const t = tsInfo?.tailscale;
  if (t?.name) { add('Tailscale name', tsLink(`${t.name}:${tsPort()}`)); add('With tailscale serve', `https://${t.name}`); }
  for (const ip of t?.ips || []) add('Tailscale', tsLink(ip));
  for (const a of tsInfo?.addresses || []) if (a.tailscale) add('Tailscale', tsLink(a.address));
  for (const a of tsInfo?.addresses || []) if (!a.tailscale && !/vEthernet|WSL|Docker|VirtualBox|VMware|Hyper-V|br-|veth/i.test(a.adapter)) add('Home network', tsLink(a.address));
  if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) add('The address you\'re using now', location.origin);
  const note = t && !t.running ? 'Tailscale is installed here but not connected: open it and sign in.' : !t && win ? 'Tailscale isn\'t installed on this PC yet (or ModelVault can\'t find it).' : '';
  box.replaceChildren(
    sugg.length ? el('div', { class: 'cat-chips' }, sugg.map((x) => el('button', { type: 'button', class: 'chip', 'data-link': x.link, onclick: () => { $('#ts-address').value = x.link; saveTsAddress(); drawTsQr(); } }, el('span', { class: 'k' }, x.label), x.link.replace(/^https?:\/\//, '')))) : '',
    note ? el('small', { class: 'muted' }, note) : '');
  drawTsQr();
}
$('#ts-address').addEventListener('input', () => { saveTsAddress(); drawTsQr(); });
$('#ts-copy').addEventListener('click', async () => {
  const link = tsLink($('#ts-address').value);
  if (!link) return;
  try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch { $('#ts-address').select(); toast('Selected. Press Ctrl+C to copy'); }
});

// ---------------- first-time tour (tour.js) ----------------
async function runTour() {
  const { startTour } = await import('./tour.js');
  await showTab('models');
  startTour({
    platform: state.meta.platform,
    importLibrary: () => openSettings('existing'),
    onEnd: async (completed) => {
      try { state.meta.settings = await api('PUT', '/api/settings', { tourDone: 'true' }); } catch { /* shown again next time */ }
      if (!completed) toast('Tour skipped. You can take it any time from Settings > About.');
    },
  });
}
$('#tour-btn').addEventListener('click', () => { $('#settings-dlg').close(); runTour(); });
// A new, empty library: start the tour once the opening animation has finished.
if (state.meta.settings.tourDone !== 'true' && !state.models.length && !openAboutFirst) {
  const wait = setInterval(() => {
    if (document.getElementById('splash') || document.querySelector('dialog[open]')) return;
    clearInterval(wait);
    setTimeout(() => { if (!document.querySelector('dialog[open]') && state.meta.settings.tourDone !== 'true') runTour().catch(fail); }, 600);
  }, 300);
}
pollDrafts();
pollJobs();
pollInbox();
checkStuck();
