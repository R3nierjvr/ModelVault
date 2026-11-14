// Paints: a catalogue of model paints from ten brands, with swatches, filters and "the same colour in another brand".
// Loaded the first time the Paints tab is opened. Colours come from public/paints/paints.json (open data, MIT);
// paints you add yourself are stored on the server.
import * as more from './paints-more.js';

let h; // helpers from app.js: $, $$, el, svg, api, toast, fail, confirmDlg
let ready = null;
export const helpers = () => h;

const KINDS = {
  Paint: 'Paint', Base: 'Base', Layer: 'Layer', Contrast: 'Contrast & one-coat', Wash: 'Wash & shade', Ink: 'Ink', Glaze: 'Glaze',
  Dry: 'Drybrush paint', Metallic: 'Metallic', Primer: 'Primer', Varnish: 'Varnish', Medium: 'Medium & thinner', Effect: 'Effects & technical',
  Texture: 'Texture', Fluorescent: 'Fluorescent', Dip: 'Dip',
};
const HOW = ['Brush', 'Airbrush', 'Spray', 'Drybrush', 'Dip'];
const TYPES = ['Acrylic', 'Enamel', 'Lacquer', 'Alcohol', 'Oil', 'Varnish-based', 'Other'];
// Colour matching only compares like with like: see-through paints with see-through paints, metallics with metallics.
const SHEER = new Set(['Wash', 'Ink', 'Glaze', 'Contrast', 'Dip']);
const NOCOLOUR = new Set(['Varnish', 'Medium']);
const groupOf = (p) => (NOCOLOUR.has(p.k) ? 'none' : p.m ? 'metal' : SHEER.has(p.k) ? 'sheer' : 'solid');
const PAGE = 240;
export const FAMILIES = ['Red', 'Pink', 'Orange', 'Brown', 'Beige', 'Yellow', 'Khaki', 'Green', 'Teal', 'Blue', 'Purple', 'White', 'Grey', 'Black'];
export const FAMILY_DOT = { Red: '#B3262B', Pink: '#D47A93', Orange: '#D9752B', Brown: '#6B4530', Beige: '#D7C2A0', Yellow: '#E2B93B', Khaki: '#8C8250', Green: '#3F7A45', Teal: '#2D8C8C', Blue: '#365C9E', Purple: '#6A4596', White: '#ECEAE4', Grey: '#808388', Black: '#1E1E20' };

const S = {
  brands: {}, paints: [], byId: new Map(), source: '', votes: new Map(),
  q: '', colour: null, sort: 'brand', view: 'swatch', shown: PAGE,
  sel: { brand: new Set(), kind: new Set(), how: new Set(), type: new Set(), range: new Set(), family: new Set() },
  metallic: false, gone: false, mineOnly: false, section: 'catalogue',
  // Your own records (saved on the NAS): owned paints { id: { qty, slot } }, shopping list { id: { qty, note } }, racks, lists.
  docs: { owned: {}, shopping: {}, racks: [], lists: [] },
  open: new Set(['Brand', 'What it is', 'Used with']), more: new Set(),
};
try { Object.assign(S, JSON.parse(localStorage.getItem('mv.paintPrefs') || '{}'), { open: new Set(JSON.parse(localStorage.getItem('mv.paintOpen') || '["Brand","What it is","Used with"]')) }); } catch { /* defaults */ }
const savePrefs = () => { try { localStorage.setItem('mv.paintPrefs', JSON.stringify({ sort: S.sort, view: S.view, section: S.section })); localStorage.setItem('mv.paintOpen', JSON.stringify([...S.open])); } catch { /* ignore */ } };

// ---------- colour maths (sRGB → CIELAB, CIEDE2000) ----------
function hexRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function lab(hex) {
  const [r, g, b] = hexRgb(hex).map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, y = r * 0.2126 + g * 0.7152 + b * 0.0722, z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function deltaE([L1, a1, b1], [L2, a2, b2]) {
  const rad = Math.PI / 180, C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = a1 * (1 + G), a2p = a2 * (1 + G), C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const hp = (a, b) => { const v = Math.atan2(b, a) / rad; return v < 0 ? v + 360 : v; };
  const h1p = hp(a1p, b1), h2p = hp(a2p, b2);
  const dL = L2 - L1, dC = C2p - C1p;
  let dh = h2p - h1p; if (C1p * C2p === 0) dh = 0; else if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin((dh / 2) * rad);
  const Lm = (L1 + L2) / 2, Cmp = (C1p + C2p) / 2;
  let hm = h1p + h2p; if (C1p * C2p !== 0) hm = Math.abs(h1p - h2p) > 180 ? (h1p + h2p + (h1p + h2p < 360 ? 360 : -360)) / 2 : (h1p + h2p) / 2;
  const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
  const SL = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2), SC = 1 + 0.045 * Cmp, SH = 1 + 0.015 * Cmp * T;
  const RT = -2 * Math.sqrt(Cmp ** 7 / (Cmp ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hm - 275) / 25) ** 2)) * rad);
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}
const closeness = (d) => (d < 2 ? 'Almost identical' : d < 5 ? 'Very close' : d < 10 ? 'Close' : d < 20 ? 'Similar' : 'Nearest there is');
const inkOn = (hex) => { const [r, g, b] = hexRgb(hex); return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#1a1c1f' : '#f4f5f6'; };
function hueKey(p) { const [L, a, b] = p.lab, C = Math.hypot(a, b); if (C < 8) return [0, -L]; const hue = (Math.atan2(b, a) * 180 / Math.PI + 360 + 20) % 360; return [1 + Math.floor(hue / 30), -L]; }
function normHex(s) {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(s).trim());
  if (!m) return null;
  const x = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return `#${x.toUpperCase()}`;
}

// ---------- data ----------
const brandName = (k) => S.brands[k]?.name || k;
function addCustom(c) {
  const known = Object.entries(S.brands).find(([k, b]) => !k.startsWith('my:') && (b.name.toLowerCase() === c.brand.toLowerCase() || k === c.brand.toLowerCase() || (b.maker && b.maker.toLowerCase() === c.brand.toLowerCase())));
  const key = known ? known[0] : `my:${c.brand.toLowerCase()}`;
  if (!S.brands[key]) S.brands[key] = { name: c.brand, maker: '' };
  const p = { id: `custom:${c.id}`, cid: c.id, b: key, r: c.range || 'Added by you', n: c.name, c: c.code, h: c.hex, t: c.type, k: c.kind, m: c.metallic ? 1 : 0, a: c.how.length ? c.how : ['Brush'], g: 0, mine: true };
  p.lab = lab(p.h);
  return p;
}
/** Save one of your records (owned, shopping, racks, lists) on the NAS. */
export async function saveDoc(key) {
  try { await h.api('PUT', `/api/paint-docs/${key}`, { value: S.docs[key] }); } catch (e) { h.fail(e); }
}
async function load() {
  const docs = h.api('GET', '/api/paint-docs?keys=owned,shopping,racks,lists').catch(() => ({}));
  const [cat, mine, votes] = await Promise.all([fetch('/paints/paints.json').then((r) => { if (!r.ok) throw new Error('The paint list could not be loaded.'); return r.json(); }), h.api('GET', '/api/paints/custom').catch(() => []), h.api('GET', '/api/paints/votes').catch(() => [])]);
  S.votes = new Map(votes.map((v) => [voteKey(v.a, v.b), v.vote]));
  S.brands = cat.brands; S.source = cat.source;
  S.paints = cat.paints.map((p) => ({ ...p, lab: lab(p.h) }));
  for (const c of mine) S.paints.push(addCustom(c));
  S.byId = new Map(S.paints.map((p) => [p.id, p]));
  const d = await docs;
  S.docs = { owned: d.owned || {}, shopping: d.shopping || {}, racks: d.racks || [], lists: d.lists || [] };
}

// ---------- filtering ----------
function textMatch(p, q) {
  const hay = `${p.n} ${p.c} ${brandName(p.b)} ${S.brands[p.b]?.maker || ''} ${p.r} ${KINDS[p.k] || p.k} ${p.t} ${p.a.join(' ')} ${p.m ? 'metallic' : ''}`.toLowerCase();
  return q.split(/\s+/).every((t) => hay.includes(t));
}
function passes(p, skip) {
  if (!S.gone && p.g) return false;
  if (S.metallic && !p.m) return false;
  if (S.mineOnly && !S.docs.owned[p.id]) return false;
  if (skip !== 'family' && S.sel.family.size && !S.sel.family.has(familyOf(p))) return false;
  if (S.q && !S.colour && !textMatch(p, S.q.toLowerCase())) return false;
  if (skip !== 'brand' && S.sel.brand.size && !S.sel.brand.has(p.b)) return false;
  if (skip !== 'kind' && S.sel.kind.size && !S.sel.kind.has(p.k) && !(S.sel.kind.has('Metallic') && p.m)) return false;
  if (skip !== 'how' && S.sel.how.size && !p.a.some((x) => S.sel.how.has(x))) return false;
  if (skip !== 'type' && S.sel.type.size && !S.sel.type.has(p.t)) return false;
  if (skip !== 'range' && S.sel.range.size && !S.sel.range.has(`${p.b}|${p.r}`)) return false;
  return true;
}
function results() {
  let list = S.paints.filter((p) => passes(p));
  if (S.colour) {
    const target = lab(S.colour);
    list = list.filter((p) => !NOCOLOUR.has(p.k)).map((p) => ({ p, d: deltaE(target, p.lab) })).filter((x) => x.d <= 15).sort((a, b) => a.d - b.d);
    return list;
  }
  const by = {
    brand: (a, b) => brandName(a.b).localeCompare(brandName(b.b)) || a.r.localeCompare(b.r) || a.n.localeCompare(b.n, undefined, { numeric: true }),
    name: (a, b) => a.n.localeCompare(b.n, undefined, { numeric: true }) || brandName(a.b).localeCompare(brandName(b.b)),
    colour: (a, b) => { const x = hueKey(a), y = hueKey(b); return x[0] - y[0] || x[1] - y[1]; },
    code: (a, b) => brandName(a.b).localeCompare(brandName(b.b)) || (a.c || '~').localeCompare(b.c || '~', undefined, { numeric: true }),
  }[S.sort] || ((a, b) => 0);
  return list.sort(by).map((p) => ({ p }));
}

// ---------- sidebar ----------
function facet(title, key, options) {
  const { el, svg } = h;
  if (!options.length) return null;
  const open = S.open.has(title);
  const limit = S.more.has(title) ? Infinity : 10;
  const set = S.sel[key];
  const visible = options.filter((o, i) => i < limit || set.has(o.key));
  const id = `pf-${key}`;
  return el('div', { class: 'fgroup' },
    el('button', { 'aria-expanded': String(open), 'aria-controls': id, onclick: () => { open ? S.open.delete(title) : S.open.add(title); savePrefs(); drawSide(); } }, title, svg('<path d="m7 10 5 5 5-5"/>')),
    open && el('div', { class: 'fopts', id, role: 'group', 'aria-label': title },
      visible.map((o) => el('label', { class: 'fopt' },
        el('input', { type: 'checkbox', checked: set.has(o.key), onchange: (e) => { e.target.checked ? set.add(o.key) : set.delete(o.key); S.shown = PAGE; draw(); } }),
        o.dot && el('span', { class: 'pdot', style: `background:${o.dot}` }),
        el('span', { class: 'fname', title: o.label }, o.label), el('span', { class: 'count' }, o.count))),
      options.length > limit && el('button', { class: 'more-btn', onclick: () => { S.more.add(title); drawSide(); } }, `Show ${options.length - limit} more`)));
}
function counts(skip, keyOf) {
  const m = new Map();
  for (const p of S.paints) if (passes(p, skip)) for (const k of [].concat(keyOf(p))) m.set(k, (m.get(k) || 0) + 1);
  return m;
}
const SECTIONS = [
  ['catalogue', 'All paints', '<circle cx="8" cy="8" r="3.5"/><circle cx="16" cy="8" r="3.5"/><circle cx="8" cy="16" r="3.5"/><circle cx="16" cy="16" r="3.5"/>'],
  ['mine', 'My paints', '<path d="M5 12.5 10 17l9-10"/>'],
  ['shopping', 'Shopping list', '<path d="M4 5h2l2 10h10l2-7H7"/><circle cx="10" cy="19" r="1.3"/><circle cx="17" cy="19" r="1.3"/>'],
  ['lists', 'Paint lists', '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'],
  ['racks', 'Racks', '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M4 15h16M10 4v16"/>'],
  ['explore', 'Explore by colour', '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16"/>'],
  ['tools', 'Colour tools', '<path d="m14 4 6 6-10 10H4v-6z"/>'],
];
export function setSection(sec) { S.section = sec; savePrefs(); draw(); window.scrollTo({ top: 0 }); }
function sectionCount(sec) {
  const n = { mine: Object.keys(S.docs.owned).length, shopping: Object.keys(S.docs.shopping).length, lists: S.docs.lists.length, racks: S.docs.racks.length }[sec];
  return n || '';
}
function drawSide() {
  const { el, $ } = h;
  const side = $('#paint-side');
  const keep = document.activeElement?.id;
  const nav = el('nav', { class: 'views', 'aria-label': 'Paint sections' }, SECTIONS.map(([k, label, icon]) =>
    el('button', { class: 'view-btn', 'aria-pressed': String(S.section === k), onclick: () => setSection(k) }, h.svg(icon), label, el('span', { class: 'count' }, sectionCount(k)))));
  if (S.section !== 'catalogue') {
    side.replaceChildren(nav, el('p', { class: 'paint-credit' }, 'Swatches are close to the real paint, not exact. Colour data: Miniature Painter Pro (MIT licence) and paints you added.'));
    return;
  }
  const bc = counts('brand', (p) => p.b);
  const kc = counts('kind', (p) => (p.m && p.k !== 'Metallic' ? [p.k, 'Metallic'] : p.k));
  const hc = counts('how', (p) => p.a);
  const tc = counts('type', (p) => p.t);
  const rc = counts('range', (p) => `${p.b}|${p.r}`);
  const fc = counts('family', (p) => familyOf(p));
  const famOpts = FAMILIES.filter((k) => fc.get(k) || S.sel.family.has(k)).map((k) => ({ key: k, label: k, count: fc.get(k) || 0, dot: FAMILY_DOT[k] }));
  const brandOpts = Object.keys(S.brands).filter((k) => bc.get(k) || S.sel.brand.has(k)).map((k) => ({ key: k, label: brandName(k), count: bc.get(k) || 0 })).sort((a, b) => a.label.localeCompare(b.label));
  const kindOpts = Object.keys(KINDS).filter((k) => kc.get(k) || S.sel.kind.has(k)).map((k) => ({ key: k, label: KINDS[k], count: kc.get(k) || 0 }));
  const howOpts = HOW.filter((k) => hc.get(k) || S.sel.how.has(k)).map((k) => ({ key: k, label: k, count: hc.get(k) || 0 }));
  const typeOpts = TYPES.filter((k) => tc.get(k) || S.sel.type.has(k)).map((k) => ({ key: k, label: k, count: tc.get(k) || 0 }));
  const oneBrand = S.sel.brand.size === 1;
  const rangeOpts = [...rc].filter(([k]) => !S.sel.brand.size || S.sel.brand.has(k.split('|')[0])).map(([k, c]) => { const [b, r] = k.split('|'); return { key: k, label: oneBrand ? r : `${brandName(b)}: ${r}`, count: c }; })
    .concat([...S.sel.range].filter((k) => !rc.has(k)).map((k) => ({ key: k, label: k.split('|')[1], count: 0 }))).sort((a, b) => a.label.localeCompare(b.label));

  const q = el('input', { id: 'paint-q', type: 'search', placeholder: 'Paint name, code or #colour', autocomplete: 'off', value: S.q,
    oninput: (e) => { clearTimeout(S.qt); S.qt = setTimeout(() => setQuery(e.target.value), 160); } });
  const pick = el('input', { id: 'paint-colour', type: 'color', value: S.colour || '#7a8b6f', 'aria-label': 'Pick a colour to find paints like it',
    oninput: (e) => { clearTimeout(S.ct); S.ct = setTimeout(() => setColour(e.target.value), 120); } });
  side.replaceChildren(
    nav,
    el('label', { class: 'search' }, el('span', { class: 'sr-only' }, 'Search paints'), h.svg('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'), q),
    el('div', { class: 'colour-find' },
      el('label', { class: 'colour-pick' }, pick, el('span', {}, S.colour ? el('b', {}, S.colour) : 'Find by colour')),
      S.colour && el('button', { type: 'button', class: 'link-inline', onclick: () => { S.colour = null; if (normHex(S.q)) S.q = ''; S.shown = PAGE; draw(); } }, 'Clear')),
    el('div', { class: 'filters' },
      facet('Brand', 'brand', brandOpts),
      facet('What it is', 'kind', kindOpts),
      facet('Colour family', 'family', famOpts),
      facet('Used with', 'how', howOpts),
      facet('Made with', 'type', typeOpts),
      facet('Range', 'range', rangeOpts)),
    el('label', { class: 'check small-check' }, el('input', { type: 'checkbox', checked: S.mineOnly, onchange: (e) => { S.mineOnly = e.target.checked; S.shown = PAGE; draw(); } }), el('span', {}, 'Only paints I own')),
    el('label', { class: 'check small-check' }, el('input', { type: 'checkbox', checked: S.metallic, onchange: (e) => { S.metallic = e.target.checked; S.shown = PAGE; draw(); } }), el('span', {}, 'Metallics only')),
    el('label', { class: 'check small-check' }, el('input', { type: 'checkbox', checked: S.gone, onchange: (e) => { S.gone = e.target.checked; S.shown = PAGE; draw(); } }), el('span', {}, 'Show discontinued paints')),
    anyFilter() && el('button', { class: 'link-btn', onclick: clearAll }, 'Clear all filters'),
    el('p', { class: 'paint-credit' }, 'Swatches are close to the real paint, not exact. Colour data: Miniature Painter Pro (MIT licence).'));
  if (keep === 'paint-q') { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
}
const anyFilter = () => Object.values(S.sel).some((s) => s.size) || S.metallic || S.mineOnly || S.q || S.colour;
function clearAll() { for (const s of Object.values(S.sel)) s.clear(); S.metallic = false; S.mineOnly = false; S.q = ''; S.colour = null; S.shown = PAGE; draw(); }
function setQuery(v) {
  S.q = v.trim();
  const hex = normHex(S.q);
  S.colour = hex && /^#|^[0-9a-f]{6}$/i.test(S.q) ? hex : null;
  S.shown = PAGE; draw();
}
function setColour(hex) { S.colour = normHex(hex); S.q = ''; S.shown = PAGE; draw(); }

// ---------- main ----------
/** a and b mixed, wa parts a (sRGB, like CSS color-mix). */
function blend(a, b, wa) {
  const x = hexRgb(a), y = hexRgb(b);
  return `#${x.map((v, i) => Math.round(v * wa + y[i] * (1 - wa)).toString(16).padStart(2, '0')).join('')}`;
}
function swatchStyle(p) {
  // Plain colours worked out here (not CSS color-mix), so older tablet browsers draw them too.
  // background-color comes first, so a browser that can't draw the gradient still shows the paint's colour.
  if (p.m) return `background-color: ${p.h}; background-image: linear-gradient(135deg, ${blend(p.h, '#FFFFFF', 0.55)} 0%, ${p.h} 38%, ${blend(p.h, '#000000', 0.65)} 70%, ${blend(p.h, '#FFFFFF', 0.8)} 100%)`;
  if (SHEER.has(p.k)) return `background-color: ${p.h}; background-image: linear-gradient(90deg, ${p.h} 0, ${p.h} 62%, ${blend(p.h, '#F2EFE8', 0.45)} 62%, ${blend(p.h, '#F2EFE8', 0.45)} 100%)`;
  return `background-color: ${p.h}`;
}
const tags = (p) => [p.g && 'Discontinued', p.mine && 'Added by you', KINDS[p.k] || p.k, p.m && p.k !== 'Metallic' && 'Metallic', p.t !== 'Acrylic' && p.t, ...p.a].filter(Boolean);
function tile(x) {
  const { el } = h, p = x.p;
  return el('button', { type: 'button', class: `ptile${p.g ? ' gone' : ''}`, onclick: () => openPaint(p), 'aria-label': `${p.n}, ${brandName(p.b)} ${p.r}${p.c ? ` ${p.c}` : ''}` },
    el('span', { class: 'pswatch', style: swatchStyle(p) }, x.d != null && el('span', { class: 'pmatch', style: `color:${inkOn(p.h)}` }, closeness(x.d)),
      S.docs.owned[p.id] && el('span', { class: 'powned', title: 'You own this', style: `color:${inkOn(p.h)}` }, h.svg('<path d="M5 12.5 10 17l9-10"/>'))),
    el('span', { class: 'pname' }, p.n),
    el('span', { class: 'pbrand' }, `${brandName(p.b)} · ${p.r}`),
    el('span', { class: 'pmeta' }, p.c && el('span', { class: 'pcode' }, p.c), tags(p).slice(0, 4).map((t) => el('span', { class: 'kind' }, t))));
}
function row(x) {
  const { el } = h, p = x.p;
  return el('tr', { tabindex: 0, onclick: () => openPaint(p), onkeydown: (e) => { if (e.key === 'Enter') openPaint(p); } },
    el('td', {}, el('span', { class: 'pdot big', style: swatchStyle(p) })),
    el('td', {}, el('b', {}, p.n), p.g ? el('small', { class: 'muted' }, ' discontinued') : ''),
    el('td', {}, brandName(p.b)), el('td', {}, p.r), el('td', { class: 'mono' }, p.c || ''),
    el('td', {}, KINDS[p.k] || p.k, p.m && p.k !== 'Metallic' ? ', metallic' : ''), el('td', {}, p.t), el('td', {}, p.a.join(', ')),
    el('td', { class: 'c-num' }, x.d != null ? closeness(x.d) : ''));
}
function draw() {
  const { el, $ } = h;
  drawSide();
  if (S.section !== 'catalogue') { more.render(S.section); return; }
  const list = results();
  const total = S.paints.filter((p) => S.gone || !p.g).length;
  $('#paint-title').textContent = S.colour ? `${list.length.toLocaleString()} paints close to ${S.colour}` : anyFilter() ? `${list.length.toLocaleString()} of ${total.toLocaleString()} paints` : `${total.toLocaleString()} paints`;
  const bar = el('div', { class: 'view-bar' },
    el('label', { class: 'select-wrap' }, el('span', { class: 'sr-only' }, 'Sort paints by'),
      el('select', { disabled: !!S.colour, title: S.colour ? 'Sorted by how close the colour is' : null, onchange: (e) => { S.sort = e.target.value; savePrefs(); S.shown = PAGE; draw(); } },
        [['brand', 'Brand and range'], ['colour', 'Colour'], ['name', 'Name A–Z'], ['code', 'Code']].map(([v, l]) => el('option', { value: v, selected: S.sort === v }, S.colour ? 'Closest colour first' : l)))),
    el('div', { class: 'seg', role: 'group', 'aria-label': 'View' },
      [['swatch', 'Swatches', '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>'],
        ['list', 'List', '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>']].map(([v, l, icon]) =>
        el('button', { 'aria-pressed': String(S.view === v), onclick: () => { S.view = v; savePrefs(); draw(); } }, h.svg(icon), el('span', {}, l)))));
  const chips = [];
  const chip = (k, label, remove) => chips.push(el('button', { class: 'chip', 'aria-label': `Remove filter ${k} ${label}`, onclick: () => { remove(); S.shown = PAGE; draw(); } }, el('span', { class: 'k' }, k), label, h.svg('<path d="m6 6 12 12M18 6 6 18"/>')));
  if (S.colour) chip('Colour', S.colour, () => { S.colour = null; if (normHex(S.q)) S.q = ''; });
  else if (S.q) chip('Search', S.q, () => { S.q = ''; });
  for (const b of S.sel.brand) chip('Brand', brandName(b), () => S.sel.brand.delete(b));
  for (const k of S.sel.kind) chip('What it is', KINDS[k] || k, () => S.sel.kind.delete(k));
  for (const k of S.sel.how) chip('Used with', k, () => S.sel.how.delete(k));
  for (const k of S.sel.type) chip('Made with', k, () => S.sel.type.delete(k));
  for (const k of S.sel.range) chip('Range', k.split('|')[1], () => S.sel.range.delete(k));
  if (S.metallic) chip('Only', 'Metallics', () => { S.metallic = false; });
  if (S.mineOnly) chip('Only', 'Paints I own', () => { S.mineOnly = false; });
  for (const k of S.sel.family) chip('Colour family', k, () => S.sel.family.delete(k));
  const page = list.slice(0, S.shown);
  const body = !list.length
    ? el('div', { class: 'empty' }, el('p', {}, S.colour ? 'No paints come close to that colour with these filters.' : 'No paints match. Try fewer filters or another word.'), anyFilter() && el('button', { class: 'btn ghost', onclick: clearAll }, 'Clear all filters'))
    : S.view === 'list'
      ? el('div', { class: 'ptable-wrap' }, el('table', { class: 'ptable' },
        el('thead', {}, el('tr', {}, ['', 'Name', 'Brand', 'Range', 'Code', 'What it is', 'Made with', 'Used with', S.colour ? 'Match' : ''].map((t) => el('th', { scope: 'col' }, t)))),
        el('tbody', {}, page.map(row))))
      : el('div', { class: 'pgrid' }, page.map(tile));
  $('#paints').replaceChildren(bar, chips.length ? el('div', { class: 'active-filters' }, chips) : '', body,
    list.length > S.shown ? el('div', { class: 'pmore' }, el('button', { class: 'btn ghost', onclick: () => { S.shown += PAGE * 2; draw(); } }, `Show ${Math.min(PAGE * 2, list.length - S.shown).toLocaleString()} more of ${(list.length - S.shown).toLocaleString()}`)) : '');
}

// ---------- one paint ----------
// More colour maths for the details: back from CIELAB to a colour, LCh, HSV, a colour family name.
function labHex([L, a, b]) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = (t) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const X = inv(fx) * 0.95047, Y = inv(fy), Z = inv(fz) * 1.08883;
  const lin = [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.204 * Y + 1.057 * Z];
  const gam = (v) => { v = Math.min(1, Math.max(0, v)); return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; };
  return `#${lin.map((v) => Math.round(gam(v) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}
const lchOf = ([L, a, b]) => [L, Math.hypot(a, b), (Math.atan2(b, a) * 180 / Math.PI + 360) % 360];
const fromLch = (L, C, hue) => [L, C * Math.cos(hue * Math.PI / 180), C * Math.sin(hue * Math.PI / 180)];
const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
function hsvOf(hex) {
  const [r, g, b] = hexRgb(hex).map((v) => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let hue = 0;
  if (d) hue = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(hue * 60 + 360) % 360, mx ? (d / mx) * 100 : 0, mx * 100];
}
/** A plain colour name, from lightness, chroma and hue (CIELAB hue angles: red ≈ 40°, yellow ≈ 100°, green ≈ 135°, blue ≈ 300°). */
function familyOf(p) {
  const [L, C, hue] = lchOf(p.lab);
  if (C < 7) return L > 88 ? 'White' : L < 20 ? 'Black' : 'Grey';
  if (hue >= 340 || hue < 22) return L > 62 ? 'Pink' : 'Red';
  if (hue < 50) return C < 32 && L < 55 ? 'Brown' : L > 72 && C < 40 ? 'Pink' : 'Red';
  if (hue < 80) return C < 55 && L < 62 ? 'Brown' : C < 30 ? 'Beige' : 'Orange';
  if (hue < 110) return C < 40 ? (L > 66 ? 'Beige' : 'Khaki') : 'Yellow';
  if (hue < 165) return 'Green';
  if (hue < 228) return 'Teal';
  if (hue < 312) return 'Blue';
  return 'Purple';
}
/** Mixing two paints 1:1, roughly (light adds up in linear RGB; real pigments differ a little). */
function mixHex(a, b) {
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const gam = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  const x = hexRgb(a).map(lin), y = hexRgb(b).map(lin);
  return `#${x.map((v, i) => Math.round(gam((v + y[i]) / 2) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}
const ordinal = (n) => ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'][n] || `${n}th`;

// Your verdicts on matches: 1 = a good match (shown first), -1 = not a match (hidden).
const voteKey = (a, b) => [a, b].sort().join('|');
const voteOf = (p, q) => S.votes.get(voteKey(p.id, q.id)) || 0;
async function vote(p, q, v) {
  const now = voteOf(p, q) === v ? 0 : v;
  try {
    await h.api('PUT', '/api/paints/votes', { a: p.id, b: q.id, vote: now });
    if (now) S.votes.set(voteKey(p.id, q.id), now); else S.votes.delete(voteKey(p.id, q.id));
  } catch (e) { h.fail(e); }
}

/** Candidates to compare a paint with: like with like (unless told otherwise), nothing discontinued unless asked. */
function comparable(p, { sameKind = true, gone = false } = {}) {
  const grp = groupOf(p);
  return S.paints.filter((q) => q !== p && !(q.b === p.b && q.n === p.n && q.r === p.r) && (gone || !q.g) && !NOCOLOUR.has(q.k) && (!sameKind || grp === 'none' || groupOf(q) === grp));
}
function matchesFor(p, opts) {
  const out = new Map();
  for (const q of comparable(p, opts)) (out.get(q.b) || out.set(q.b, []).get(q.b)).push({ p: q, d: deltaE(p.lab, q.lab), v: voteOf(p, q) });
  return [...out].map(([b, arr]) => {
    const kept = arr.filter((x) => x.v >= 0).sort((x, y) => y.v - x.v || x.d - y.d).slice(0, 3);
    return [b, kept, arr.filter((x) => x.v < 0)];
  }).sort((a, b) => (a[1][0]?.d ?? Infinity) - (b[1][0]?.d ?? Infinity));
}

/** Shade and highlight steps from one brand: about 12 and 24 points darker and lighter, keeping the hue. */
function ladder(base, brand) {
  const pool = S.paints.filter((q) => q.b === brand && !q.g && !NOCOLOUR.has(q.k) && groupOf(q) === groupOf(base) && q !== base);
  const [L0, C0, h0] = lchOf(base.lab);
  const score = (q, target) => {
    const [L, C, hue] = lchOf(q.lab), dL = L - L0;
    if (Math.sign(dL) !== Math.sign(target) || Math.abs(dL) < 4) return Infinity;
    const huePenalty = C0 < 8 ? C / 2 : C < 6 ? 12 : hueGap(hue, h0) / 2.5;
    return Math.abs(dL - target) + huePenalty + Math.abs(C - C0) / 5;
  };
  const best = (target, beyond) => {
    let pick = null, s = 28;
    for (const q of pool) {
      const L = q.lab[0];
      if (beyond && (target < 0 ? L > beyond.lab[0] - 4 : L < beyond.lab[0] + 4)) continue;
      const v = score(q, target);
      if (v < s) { s = v; pick = q; }
    }
    return pick;
  };
  const shade1 = best(-12), high1 = best(12);
  return { shade2: shade1 && best(-24, shade1), shade1, base, high1, high2: high1 && best(24, high1) };
}

const SCHEMES = {
  complementary: { name: 'Complementary', offsets: [0, 180], about: 'Opposite colours: the strongest contrast, good for a focal point.' },
  split: { name: 'Split-complementary', offsets: [0, 150, 210], about: 'The two colours either side of the opposite: contrast that is easier to balance.' },
  triadic: { name: 'Triadic', offsets: [0, 120, 240], about: 'Three colours spaced evenly round the wheel: lively but balanced.' },
  analogous: { name: 'Analogous', offsets: [0, -30, 30], about: 'Neighbouring colours: calm and natural, good for cloth and skin.' },
  tetradic: { name: 'Tetradic', offsets: [0, 90, 180, 270], about: 'Two pairs of opposites: rich, works best with one colour in charge.' },
  mono: { name: 'Monochromatic', light: [0, -24, -12, 12, 24], about: 'One hue, darker and lighter: shading and highlighting in a single colour.' },
};
function harmony(base, scheme, brand) {
  const [L, C, hue] = lchOf(base.lab);
  const sc = SCHEMES[scheme];
  const targets = sc.light ? sc.light.map((dl) => fromLch(Math.min(97, Math.max(4, L + dl)), C * (dl ? 0.92 : 1), hue)) : sc.offsets.map((o) => fromLch(L, C, hue + o));
  const pool = S.paints.filter((q) => !q.g && !NOCOLOUR.has(q.k) && groupOf(q) === 'solid' && (!brand || q.b === brand));
  return targets.map((t, i) => {
    if (i === 0) return { target: base.lab, p: base, d: 0, role: 'Base' };
    let pick = null, d = Infinity;
    for (const q of pool) { if (q === base) continue; const x = deltaE(t, q.lab); if (x < d) { d = x; pick = q; } }
    return { target: t, p: pick, d, role: sc.light ? (sc.light[i] < 0 ? 'Darker' : 'Lighter') : `Accent ${i}` };
  });
}
function wheel(items) {
  const { el } = h;
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  const R = 92, cx = 110, cy = 110;
  const at = (hue, r = R) => [cx + r * Math.cos((-hue * Math.PI) / 180), cy + r * Math.sin((-hue * Math.PI) / 180)];
  const s = mk('svg', { viewBox: '0 0 220 220', class: 'hwheel', role: 'img', 'aria-label': 'Colour wheel with the chosen paints marked' });
  for (let i = 0; i < 72; i++) {
    const a0 = i * 5, a1 = a0 + 5.6, [x0, y0] = at(a0), [x1, y1] = at(a1);
    s.append(mk('path', { d: `M${x0} ${y0} A${R} ${R} 0 0 0 ${x1} ${y1}`, stroke: labHex(fromLch(62, 48, a0 + 2.5)), 'stroke-width': 16, fill: 'none' }));
  }
  const pts = items.filter((x) => x.p).map((x) => { const [, C, hue] = lchOf(x.p.lab); return { x, xy: at(hue, C < 7 ? 0 : R) }; });
  if (pts.length > 1) s.append(mk('polygon', { points: pts.map((q) => q.xy.join(',')).join(' '), fill: 'rgba(255,255,255,.04)', stroke: 'rgba(255,255,255,.35)', 'stroke-dasharray': '4 4', 'stroke-width': 1.2 }));
  pts.forEach((q, i) => {
    const g = mk('g', {});
    g.append(mk('circle', { cx: q.xy[0], cy: q.xy[1], r: i === 0 ? 11 : 9, fill: q.x.p.h, stroke: i === 0 ? '#e8eaed' : '#1d2024', 'stroke-width': i === 0 ? 3 : 2.5 }));
    const t = mk('text', { x: q.xy[0], y: q.xy[1] + 3.5, 'text-anchor': 'middle', 'font-size': 10, 'font-weight': 700, fill: inkOn(q.x.p.h) });
    t.textContent = String(i + 1);
    g.append(t); s.append(g);
  });
  return el('div', { class: 'hwheel-wrap' }, s);
}

function dlg() {
  let d = document.getElementById('paint-dlg');
  if (!d) {
    d = h.el('dialog', { id: 'paint-dlg', class: 'sheet paint-dlg', 'aria-labelledby': 'paint-h' });
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    document.body.append(d);
  }
  return d;
}
const fmt = (n, dp = 1) => (Math.round(n * 10 ** dp) / 10 ** dp).toFixed(dp);
function openPaint(p, o = {}) {
  const opts = { sameKind: true, gone: false, showHidden: false, ladderBrand: p.b, scheme: null, harmBrand: '', ...o };
  const { el } = h;
  const d = dlg();
  const keepScroll = o.keepScroll ? d.querySelector('.sheet-body')?.scrollTop || 0 : 0;
  const again = (more) => openPaint(p, { ...opts, ...more, keepScroll: true });
  const grp = groupOf(p);
  const rows = grp === 'none' && opts.sameKind ? [] : matchesFor(p, opts);
  const own = rows.find(([b, kept]) => b === p.b && kept.length);
  const others = rows.filter(([b, kept]) => b !== p.b && kept.length);
  const hidden = rows.reduce((n, [, , gone]) => n + gone.length, 0);
  const [L, C, hue] = lchOf(p.lab), [r, g, b] = hexRgb(p.h), [hh, ss, vv] = hsvOf(p.h);
  const fam = familyOf(p);

  // Notes: what's worth knowing about this paint, in plain sentences.
  const notes = [];
  const bestOther = others.map(([, k]) => k[0]).sort((x, y) => x.d - y.d)[0];
  if (bestOther) {
    const how = bestOther.d < 2 ? 'practically the same paint' : bestOther.d < 5 ? 'a good substitute, though you may see a difference side by side' : bestOther.d < 10 ? 'close enough for most jobs, but not for touching up' : 'nothing in another brand is really close';
    notes.push(`The nearest match from another brand is ${bestOther.p.n} (${brandName(bestOther.p.b)} ${bestOther.p.r}) at ΔE ${fmt(bestOther.d)}: ${how}.`);
  }
  if (grp !== 'none') {
    const sib = S.paints.filter((q) => q.b === p.b && q.r === p.r && !q.g && !NOCOLOUR.has(q.k) && familyOf(q) === fam).sort((x, y) => y.lab[0] - x.lab[0]);
    const i = sib.indexOf(p);
    if (sib.length > 1 && i >= 0) notes.push(i === 0 ? `It's the lightest of the ${sib.length} ${fam.toLowerCase()} paints in ${p.r}.` : i === sib.length - 1 ? `It's the darkest of the ${sib.length} ${fam.toLowerCase()} paints in ${p.r}.` : `It's the ${ordinal(i + 1)} lightest of the ${sib.length} ${fam.toLowerCase()} paints in ${p.r}.`);
    // The same paint in another range of the brand (Base and Air, say) isn't a "closest paint": say it once.
    const sameAs = comparable(p, { sameKind: false, gone: opts.gone }).filter((q) => q.b === p.b && q.n.toLowerCase() === p.n.toLowerCase() && q.r !== p.r);
    if (sameAs.length) notes.push(`${brandName(p.b)} also makes it in ${sameAs.map((q) => q.r).join(', ')}.`);
    const twin = comparable(p, opts).filter((q) => q.b === p.b && q.n.toLowerCase() !== p.n.toLowerCase()).map((q) => ({ p: q, d: deltaE(p.lab, q.lab) })).sort((x, y) => x.d - y.d)[0];
    if (twin) notes.push(`${twin.p.n} (${twin.p.r}) is the closest other ${brandName(p.b)} paint, at ΔE ${fmt(twin.d)}${twin.d < 8 ? ': the two blend easily into each other' : ''}.`);
    const near = comparable(p, opts).filter((q) => deltaE(p.lab, q.lab) < 5).length;
    notes.push(near ? `${near} paint${near === 1 ? '' : 's'} in the whole list ${near === 1 ? 'is' : 'are'} within ΔE 5 of it.` : 'No other paint in the list comes within ΔE 5 of it, so it\'s fairly unusual.');
  }

  const matchRow = (x) => el('li', { class: `pm-item${x.v > 0 ? ' picked' : ''}` },
    el('button', { type: 'button', class: 'pm-row', onclick: () => openPaint(x.p) },
      el('span', { class: 'pdot big', style: swatchStyle(x.p) }),
      el('span', { class: 'pm-name' }, el('b', {}, x.p.n, S.docs.owned[x.p.id] ? el('span', { class: 'own-tag' }, 'Owned') : ''), el('small', {}, `${x.v > 0 ? 'Your pick · ' : ''}${x.p.r}${x.p.c ? ` · ${x.p.c}` : ''}${x.p.g ? ' · discontinued' : ''}`)),
      el('span', { class: `pm-close d${x.d < 5 ? 1 : x.d < 10 ? 2 : 3}` }, closeness(x.d), el('small', {}, `ΔE ${fmt(x.d)}`))),
    el('span', { class: 'pm-votes' },
      el('button', { type: 'button', class: `vote${x.v > 0 ? ' on' : ''}`, 'aria-pressed': String(x.v > 0), title: 'Good match: show it first', 'aria-label': `${x.p.n} is a good match`, onclick: async () => { await vote(p, x.p, 1); again({}); } }, h.svg('<path d="M7 11v8H4.5v-8zM7 11l3.6-6.3a1.6 1.6 0 0 1 2.9 1.2L12.8 10h5.4a2 2 0 0 1 2 2.4l-1.3 5.6a2 2 0 0 1-2 1.5H7"/>')),
      el('button', { type: 'button', class: `vote no${x.v < 0 ? ' on' : ''}`, 'aria-pressed': String(x.v < 0), title: 'Not a match: hide it', 'aria-label': `${x.p.n} is not a match`, onclick: async () => { await vote(p, x.p, -1); again({}); } }, h.svg('<path d="M7 13V5H4.5v8zM7 13l3.6 6.3a1.6 1.6 0 0 0 2.9-1.2L12.8 14h5.4a2 2 0 0 0 2-2.4l-1.3-5.6a2 2 0 0 0-2-1.5H7"/>'))));

  // Shade and highlight ladder, in this paint's brand or another one.
  const ladderBrand = opts.ladderBrand;
  const ladderBase = ladderBrand === p.b ? p : comparable(p, { sameKind: true }).filter((q) => q.b === ladderBrand).sort((x, y) => deltaE(p.lab, x.lab) - deltaE(p.lab, y.lab))[0];
  const lad = ladderBase && grp !== 'none' ? ladder(ladderBase, ladderBrand) : null;
  const steps = lad ? [['Shade 2', lad.shade2], ['Shade 1', lad.shade1], ['Base', lad.base], ['Highlight 1', lad.high1], ['Highlight 2', lad.high2]] : [];
  const stepEl = ([label, q]) => q
    ? el('button', { type: 'button', class: `lstep${q === lad.base ? ' base' : ''}`, onclick: () => (q === p ? null : openPaint(q)) },
      el('span', { class: 'lchip', style: swatchStyle(q) }), el('small', { class: 'lrole' }, label), el('b', {}, q.n), el('small', {}, q.r))
    : el('div', { class: 'lstep none' }, el('span', { class: 'lchip' }), el('small', { class: 'lrole' }, label), el('small', {}, 'Nothing suitable'));
  const ramp = steps.map(([, q]) => q?.h).filter(Boolean);
  const mix = lad?.shade1 && mixHex(lad.base.h, lad.shade1.h);
  const brandsWith = Object.keys(S.brands).filter((k) => S.paints.some((q) => q.b === k && !q.g && groupOf(q) === grp)).sort((a, b2) => brandName(a).localeCompare(brandName(b2)));

  // Colour harmonies.
  const neutral = C < 7;
  const scheme = opts.scheme || (neutral ? 'mono' : 'complementary');
  const harm = grp === 'none' ? [] : harmony(p, scheme, opts.harmBrand);

  d.replaceChildren(
    el('header', { class: 'sheet-head' },
      el('h2', { id: 'paint-h' }, p.n),
      el('p', { class: 'muted' }, `${brandName(p.b)}${S.brands[p.b]?.maker ? ` (${S.brands[p.b].maker})` : ''} · ${p.r}${p.c ? ` · ${p.c}` : ''}`),
      el('button', { class: 'icon-btn close', 'aria-label': 'Close', onclick: () => d.close() }, h.svg('<path d="m6 6 12 12M18 6 6 18"/>'))),
    el('div', { class: 'sheet-body paint-body' },
      el('div', { class: 'paint-hero' },
        el('div', { class: 'pswatch hero', style: swatchStyle(p) }, el('span', { style: `color:${inkOn(p.h)}` }, p.h)),
        el('dl', { class: 'paint-facts' },
          [['Brand', `${brandName(p.b)}${S.brands[p.b]?.maker ? ` (${S.brands[p.b].maker})` : ''}`], ['Range', p.r], ['Code', p.c || '—'],
            ['Hex', p.h], ['RGB', `${r}, ${g}, ${b}`], ['HSV', `${Math.round(hh)}°, ${Math.round(ss)}%, ${Math.round(vv)}%`],
            ['CIELAB', `${fmt(p.lab[0])}, ${fmt(p.lab[1])}, ${fmt(p.lab[2])}`], ['LCh', `${fmt(L)}, ${fmt(C)}, ${fmt(hue)}°`], ['Colour family', fam + (p.m ? ' (metallic)' : '')],
            ['What it is', KINDS[p.k] || p.k], ['Made with', p.t], ['Used with', p.a.join(', ')],
            p.g && ['Status', 'Discontinued'], p.note && ['Note', p.note], p.mine && ['Added', 'By you'],
            S.docs.owned[p.id] && ['You own', `${S.docs.owned[p.id].qty || 1}${S.docs.owned[p.id].slot ? `, stored in ${more.slotLabel(S.docs.owned[p.id].slot)}` : ''}`]].filter(Boolean)
            .map(([k, v]) => el('div', { class: 'pf-row' }, el('dt', {}, k), el('dd', { class: /^(Hex|RGB|HSV|CIELAB|LCh|Code)$/.test(k) ? 'mono' : '' }, v)))),
        el('div', { class: 'paint-acts' },
          el('button', { class: `btn small ${S.docs.owned[p.id] ? 'primary' : 'ghost'}`, 'aria-pressed': String(!!S.docs.owned[p.id]), onclick: async () => { await more.toggleOwned(p); again({}); } },
            S.docs.owned[p.id] ? 'I own this' : 'Mark as owned'),
          el('button', { class: `btn small ${S.docs.shopping[p.id] ? 'primary' : 'ghost'}`, 'aria-pressed': String(!!S.docs.shopping[p.id]), onclick: async () => { await more.toggleShopping(p); again({}); } },
            S.docs.shopping[p.id] ? 'On shopping list' : 'Add to shopping list'),
          el('button', { class: 'btn small ghost', onclick: () => { d.close(); S.section = 'catalogue'; setColour(p.h); window.scrollTo({ top: 0 }); } }, 'Show all paints like this'),
          el('button', { class: 'btn small ghost', onclick: () => more.addToList(p) }, 'Add to a list'),
          el('button', { class: 'btn small ghost', onclick: () => { navigator.clipboard?.writeText(`${p.n} (${brandName(p.b)} ${p.r}${p.c ? ` ${p.c}` : ''}) ${p.h}`).then(() => h.toast('Copied'), () => h.toast(p.h)); } }, 'Copy'),
          p.mine && el('button', { class: 'btn small ghost', onclick: () => { d.close(); editPaint(p); } }, 'Edit'),
          p.mine && el('button', { class: 'btn small ghost danger', onclick: async () => {
            if (!(await h.confirmDlg(`Delete ${p.n}?`, 'It\'s removed from your paints. Paints from the list aren\'t affected.', [{ label: 'Cancel', value: '' }, { label: 'Delete paint', value: 'y', cls: 'primary' }]))) return;
            try { await h.api('DELETE', `/api/paints/custom/${p.cid}`); S.paints = S.paints.filter((x) => x !== p); S.byId.delete(p.id); d.close(); draw(); h.toast(`Deleted ${p.n}`); } catch (e) { h.fail(e); }
          } }, 'Delete'))),
      notes.length ? el('div', { class: 'paint-notes' }, notes.map((t) => el('p', {}, t))) : '',

      el('section', { class: 'paint-matches' },
        el('div', { class: 'pm-head' }, el('h3', {}, 'The same colour in other brands'),
          el('label', { class: 'check small-check' }, el('input', { type: 'checkbox', checked: opts.sameKind, onchange: (e) => again({ sameKind: e.target.checked }) }),
            el('span', {}, grp === 'sheer' ? 'Only washes, inks and other see-through paints' : grp === 'metal' ? 'Only metallics' : grp === 'none' ? 'Varnishes and mediums have no colour to match' : 'Only solid paints (no washes or metallics)')),
          el('label', { class: 'check small-check' }, el('input', { type: 'checkbox', checked: opts.gone, onchange: (e) => again({ gone: e.target.checked }) }), el('span', {}, 'Include discontinued'))),
        el('p', { class: 'muted pm-help' }, 'ΔE is the colour difference: under 2 is hard to tell apart, under 5 is a good substitute. Mark a match with 👍 to show it first, or 👎 to hide it.'),
        !rows.length ? el('p', { class: 'muted' }, grp === 'none' ? 'Untick the box above to compare its colour with every paint anyway.' : 'Nothing to compare with.') : '',
        el('div', { class: 'pm-brands' }, others.map(([bk, arr]) => el('div', { class: 'pm-brand' }, el('h4', {}, brandName(bk)), el('ul', { role: 'list' }, arr.map(matchRow))))),
        own && el('div', { class: 'pm-brand own' }, el('h4', {}, `Also from ${brandName(p.b)}`), el('ul', { role: 'list' }, own[1].map(matchRow))),
        hidden > 0 && el('div', { class: 'pm-hidden' },
          el('button', { type: 'button', class: 'link-inline', onclick: () => again({ showHidden: !opts.showHidden }) }, opts.showHidden ? 'Hide the matches you marked as wrong' : `${hidden} match${hidden === 1 ? '' : 'es'} you marked as wrong ${hidden === 1 ? 'is' : 'are'} hidden. Show ${hidden === 1 ? 'it' : 'them'}`),
          opts.showHidden && el('ul', { role: 'list', class: 'pm-hidden-list' }, rows.flatMap(([, , gone]) => gone).map(matchRow)))),

      grp !== 'none' && el('section', { class: 'paint-ladder' },
        el('div', { class: 'pm-head' }, el('h3', {}, 'Shade and highlight'),
          el('label', { class: 'select-wrap small' }, el('span', { class: 'sr-only' }, 'Brand for shading and highlighting'),
            el('select', { onchange: (e) => again({ ladderBrand: e.target.value }) }, brandsWith.map((k) => el('option', { value: k, selected: k === ladderBrand }, `With ${brandName(k)} paints`))))),
        !lad ? el('p', { class: 'muted' }, `${brandName(ladderBrand)} has nothing close enough to build steps from.`)
          : el('div', { class: 'ladder-box' },
            ladderBase !== p && el('p', { class: 'muted small-note' }, `Built round ${ladderBase.n}, the closest ${brandName(ladderBrand)} paint to ${p.n}.`),
            el('div', { class: 'lsteps' }, steps.map(stepEl)),
            ramp.length > 1 && el('div', { class: 'lramp', style: `background: linear-gradient(90deg, ${ramp.join(', ')})`, role: 'img', 'aria-label': 'The blend from darkest shade to brightest highlight' }),
            mix && el('p', { class: 'lmix' }, el('span', { class: 'pdot big', style: `background:${mix}` }), `For a smoother step, mix ${lad.base.n} and ${lad.shade1.n} 1:1: it lands near this colour.`))),

      grp !== 'none' && el('section', { class: 'paint-harmony' },
        el('div', { class: 'pm-head' }, el('h3', {}, `Colour schemes with ${p.n}`),
          el('label', { class: 'select-wrap small' }, el('span', { class: 'sr-only' }, 'Brand for colour schemes'),
            el('select', { onchange: (e) => again({ harmBrand: e.target.value }) }, el('option', { value: '' }, 'Any brand'), Object.keys(S.brands).sort((a, b2) => brandName(a).localeCompare(brandName(b2))).map((k) => el('option', { value: k, selected: k === opts.harmBrand }, `Only ${brandName(k)}`))))),
        neutral && el('p', { class: 'muted small-note' }, 'Greys and other near-neutral colours have no hue to build schemes on, so only the one-colour scheme is shown.'),
        el('div', { class: 'hschemes', role: 'tablist', 'aria-label': 'Colour schemes' },
          Object.entries(SCHEMES).filter(([k]) => !neutral || k === 'mono').map(([k, sc]) => {
            const strip = harmony(p, k, opts.harmBrand).map((x) => x.p?.h || '#333');
            return el('button', { type: 'button', role: 'tab', class: 'hscheme', 'aria-selected': String(k === scheme), onclick: () => again({ scheme: k }) },
              el('span', { class: 'hstrip' }, strip.map((c) => el('i', { style: `background:${c}` }))), el('span', {}, sc.name));
          })),
        el('div', { class: 'hbody' },
          wheel(harm),
          el('div', { class: 'hlist' },
            el('p', { class: 'habout' }, SCHEMES[scheme].about),
            el('ol', { role: 'list' }, harm.map((x, i) => el('li', {},
              x.p ? el('button', { type: 'button', class: 'pm-row', onclick: () => (x.p === p ? null : openPaint(x.p)) },
                el('span', { class: 'hnum' }, i + 1), el('span', { class: 'pdot big', style: swatchStyle(x.p) }),
                el('span', { class: 'pm-name' }, el('small', { class: 'lrole' }, x.role), el('b', {}, x.p.n), el('small', {}, `${brandName(x.p.b)} · ${x.p.r}`)),
                el('span', { class: `pm-close d${x.d < 5 ? 1 : x.d < 10 ? 2 : 3}` }, i === 0 ? 'Your paint' : closeness(x.d), i ? el('small', {}, `ΔE ${fmt(x.d)} from the ideal`) : ''))
                : el('span', { class: 'muted' }, 'No paint found')))))))));
  if (!d.open) d.showModal();
  const body = d.querySelector('.sheet-body');
  if (body) body.scrollTop = keepScroll;
}

// ---------- adding your own paints ----------
function editPaint(p = null) {
  const { el } = h;
  let d = document.getElementById('paint-edit-dlg');
  if (!d) { d = el('dialog', { id: 'paint-edit-dlg', class: 'sheet narrow', 'aria-labelledby': 'paint-edit-h' }); d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); document.body.append(d); }
  const brandList = el('datalist', { id: 'pe-brands' }, [...new Set(Object.values(S.brands).map((b) => b.name))].sort().map((n) => el('option', { value: n })));
  const rangeList = el('datalist', { id: 'pe-ranges' });
  const fillRanges = (brand) => {
    const key = Object.keys(S.brands).find((k) => S.brands[k].name.toLowerCase() === String(brand).toLowerCase());
    rangeList.replaceChildren(...[...new Set(S.paints.filter((x) => x.b === key).map((x) => x.r))].sort().map((r) => el('option', { value: r })));
  };
  const hexIn = el('input', { name: 'hex', value: p?.h || '#7A8B6F', maxlength: 7, required: true, pattern: '#?[0-9A-Fa-f]{6}', class: 'mono', 'aria-label': 'Colour code' });
  const pick = el('input', { type: 'color', value: p?.h || '#7a8b6f', 'aria-label': 'Colour', oninput: (e) => { hexIn.value = e.target.value.toUpperCase(); } });
  hexIn.addEventListener('input', () => { const x = normHex(hexIn.value); if (x) pick.value = x; });
  const how = new Set(p?.a || ['Brush']);
  const f = el('form', { class: 'sheet-body stack', onsubmit: async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    const body = { brand: v.brand, range: v.range, name: v.name, code: v.code, hex: normHex(v.hex), type: v.type, kind: v.kind, metallic: !!v.metallic, how: [...how] };
    if (!body.hex) { h.toast('Enter the colour as #RRGGBB, or pick it.', true); return; }
    try {
      const saved = await h.api(p ? 'PUT' : 'POST', p ? `/api/paints/custom/${p.cid}` : '/api/paints/custom', body);
      const np = addCustom(saved);
      if (p) S.paints = S.paints.map((x) => (x === p ? np : x)); else S.paints.push(np);
      S.byId.set(np.id, np);
      d.close(); draw(); h.toast(p ? `Saved ${np.n}` : `Added ${np.n}`);
      openPaint(np);
    } catch (err) { h.fail(err); }
  } },
    brandList, rangeList,
    el('div', { class: 'two' },
      el('label', { class: 'field' }, el('span', {}, 'Brand'), el('input', { name: 'brand', list: 'pe-brands', required: true, value: p ? brandName(p.b) : '', placeholder: 'e.g. AMMO', onchange: (e) => fillRanges(e.target.value) })),
      el('label', { class: 'field' }, el('span', {}, 'Range'), el('input', { name: 'range', list: 'pe-ranges', value: p && p.r !== 'Added by you' ? p.r : '', placeholder: 'e.g. Atom' }))),
    el('div', { class: 'two' },
      el('label', { class: 'field' }, el('span', {}, 'Name'), el('input', { name: 'name', required: true, value: p?.n || '', placeholder: 'e.g. Deep Red' })),
      el('label', { class: 'field' }, el('span', {}, 'Code'), el('input', { name: 'code', value: p?.c || '', placeholder: 'e.g. ATOM-20044' }))),
    el('div', { class: 'field' }, el('span', {}, 'Colour'), el('div', { class: 'pe-colour' }, pick, hexIn), el('small', { class: 'muted' }, 'Pick it, or paste the colour code from the maker\'s website.')),
    el('div', { class: 'two' },
      el('label', { class: 'field' }, el('span', {}, 'What it is'), el('select', { name: 'kind', class: 'set-select' }, Object.entries(KINDS).map(([k, l]) => el('option', { value: k, selected: (p?.k || 'Paint') === k }, l)))),
      el('label', { class: 'field' }, el('span', {}, 'Made with'), el('select', { name: 'type', class: 'set-select' }, TYPES.map((t) => el('option', { value: t, selected: (p?.t || 'Acrylic') === t }, t))))),
    el('fieldset', { class: 'field pe-how' }, el('legend', {}, 'Used with'),
      el('div', { class: 'check-row' }, HOW.map((x) => el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: how.has(x), onchange: (e) => { e.target.checked ? how.add(x) : how.delete(x); } }), el('span', {}, x))))),
    el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'metallic', checked: !!p?.m }), el('span', {}, 'Metallic')),
    el('div', { class: 'form-actions' }, el('button', { class: 'btn primary', type: 'submit' }, p ? 'Save paint' : 'Add paint'), el('button', { class: 'btn ghost', type: 'button', onclick: () => d.close() }, 'Cancel')));
  d.replaceChildren(
    el('header', { class: 'sheet-head' }, el('h2', { id: 'paint-edit-h' }, p ? `Edit ${p.n}` : 'Add a paint'),
      el('p', { class: 'muted' }, 'For paints that aren\'t in the list, like AMMO Atom. It\'s compared with every other paint like the rest. ',
        !p && el('button', { type: 'button', class: 'link-inline', onclick: () => { d.close(); bulkPaints(); } }, 'Add a whole list at once')),
      el('button', { class: 'icon-btn close', type: 'button', 'aria-label': 'Close', onclick: () => d.close() }, h.svg('<path d="m6 6 12 12M18 6 6 18"/>'))),
    f);
  if (p) fillRanges(brandName(p.b));
  d.showModal();
}

// A whole range at once: one paint per line ("Name, code, #colour"), sharing brand, range and type.
function parseLine(line) {
  let rest = line.trim();
  if (!rest || /^(name|paint)\b.*\b(hex|colou?r|code)\b/i.test(rest)) return null;
  let hex = null;
  const hm = /#?\b([0-9a-f]{6})\b/i.exec(rest);
  if (hm) { hex = `#${hm[1].toUpperCase()}`; rest = rest.replace(hm[0], ' '); }
  else {
    const rgb = /(?:rgb\s*\()?\b(\d{1,3})\s*[,; ]\s*(\d{1,3})\s*[,; ]\s*(\d{1,3})\b\)?/i.exec(rest);
    if (rgb && rgb.slice(1).every((v) => Number(v) <= 255)) { hex = `#${rgb.slice(1).map((v) => Number(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`; rest = rest.replace(rgb[0], ' '); }
  }
  const cm = /\b([A-Z]{1,8}[-_ ]?\d{2,6}[A-Z]?|\d{2}\.\d{3})\b/.exec(rest);
  const code = cm ? cm[1] : '';
  if (cm) rest = rest.replace(cm[0], ' ');
  const name = rest.replace(/[\t,;|]+/g, ' ').replace(/\s+/g, ' ').replace(/^[\s\-–:]+|[\s\-–:]+$/g, '').trim();
  return { name, code, hex };
}
function bulkPaints() {
  const { el } = h;
  let d = document.getElementById('paint-bulk-dlg');
  if (!d) { d = el('dialog', { id: 'paint-bulk-dlg', class: 'sheet', 'aria-labelledby': 'paint-bulk-h' }); d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); document.body.append(d); }
  const how = new Set(['Brush', 'Airbrush']);
  const preview = el('div', { class: 'bulk-preview', 'aria-live': 'polite' });
  const text = el('textarea', { name: 'lines', rows: 10, class: 'mono', placeholder: 'Deep Red, ATOM-20044, #8B1A1A\nIcy Blue\tATOM-20118\t#A9C6D8\nSand 220 190 140', oninput: () => show() });
  let parsed = [];
  const show = () => {
    parsed = text.value.split(/\r?\n/).map(parseLine).filter(Boolean);
    const ok = parsed.filter((x) => x.name && x.hex), bad = parsed.filter((x) => !(x.name && x.hex));
    preview.replaceChildren(
      parsed.length ? el('p', { class: 'muted' }, `${ok.length} paint${ok.length === 1 ? '' : 's'} ready${bad.length ? `, ${bad.length} line${bad.length === 1 ? '' : 's'} without a name or colour (skipped)` : ''}.`) : '',
      el('div', { class: 'bulk-chips' }, ok.slice(0, 60).map((x) => el('span', { class: 'bulk-chip', title: `${x.name} ${x.code} ${x.hex}` }, el('i', { style: `background:${x.hex}` }), x.name))));
  };
  const f = el('form', { class: 'sheet-body stack', onsubmit: async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    const items = parsed.filter((x) => x.name && x.hex);
    if (!items.length) { h.toast('Paste at least one line with a name and a colour.', true); return; }
    try {
      const saved = await h.api('POST', '/api/paints/custom/bulk', { shared: { brand: v.brand, range: v.range, type: v.type, kind: v.kind, metallic: !!v.metallic, how: [...how] }, items });
      for (const c of saved) { const np = addCustom(c); S.paints.push(np); S.byId.set(np.id, np); }
      d.close(); draw(); h.toast(`Added ${saved.length} paints to ${v.brand}${v.range ? ` ${v.range}` : ''}`);
    } catch (err) { h.fail(err); }
  } },
    el('datalist', { id: 'pb-brands' }, [...new Set(Object.values(S.brands).map((b) => b.name))].sort().map((n) => el('option', { value: n }))),
    el('div', { class: 'two' },
      el('label', { class: 'field' }, el('span', {}, 'Brand'), el('input', { name: 'brand', list: 'pb-brands', required: true, placeholder: 'e.g. AMMO' })),
      el('label', { class: 'field' }, el('span', {}, 'Range'), el('input', { name: 'range', placeholder: 'e.g. Atom' }))),
    el('div', { class: 'two' },
      el('label', { class: 'field' }, el('span', {}, 'What they are'), el('select', { name: 'kind', class: 'set-select' }, Object.entries(KINDS).map(([k, l]) => el('option', { value: k }, l)))),
      el('label', { class: 'field' }, el('span', {}, 'Made with'), el('select', { name: 'type', class: 'set-select' }, TYPES.map((t) => el('option', { value: t }, t))))),
    el('fieldset', { class: 'field pe-how' }, el('legend', {}, 'Used with'),
      el('div', { class: 'check-row' }, HOW.map((x) => el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: how.has(x), onchange: (e) => { e.target.checked ? how.add(x) : how.delete(x); } }), el('span', {}, x))))),
    el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'metallic' }), el('span', {}, 'All metallic')),
    el('label', { class: 'field' }, el('span', {}, 'Paints, one per line'), text,
      el('small', { class: 'muted' }, 'Each line needs a name and a colour (#RRGGBB, or three numbers for red, green and blue). A code like ATOM-20044 is picked out too. You can paste straight from a spreadsheet.')),
    preview,
    el('div', { class: 'form-actions' }, el('button', { class: 'btn primary', type: 'submit' }, 'Add paints'), el('button', { class: 'btn ghost', type: 'button', onclick: () => d.close() }, 'Cancel')));
  d.replaceChildren(
    el('header', { class: 'sheet-head' }, el('h2', { id: 'paint-bulk-h' }, 'Add a list of paints'),
      el('p', { class: 'muted' }, 'For a whole range at once, such as AMMO Atom from AMMO\'s colour chart.'),
      el('button', { class: 'icon-btn close', type: 'button', 'aria-label': 'Close', onclick: () => d.close() }, h.svg('<path d="m6 6 12 12M18 6 6 18"/>'))),
    f);
  d.showModal();
}

// ---------- entry point ----------
/** Load the paints without showing the Paints tab (for a model's paint scheme). */
export async function ensureLoaded(helpers) {
  h = helpers;
  if (!ready) { ready = load(); ready.catch(() => { ready = null; }); }
  await ready;
  if (!S._addBound) { S._addBound = true; h.$('#paint-add').addEventListener('click', () => editPaint()); }
}
export { openScheme, schemeStrip } from './paints-more.js';
export async function show(helpers) {
  h = helpers;
  if (!ready) h.$('#paints').replaceChildren(h.el('p', { class: 'muted paint-loading' }, 'Loading paints…'));
  await ensureLoaded(helpers);
  draw();
}

// Shared with the other paint views (paints-more.js).
export { S, lab, deltaE, labHex, lchOf, fromLch, hexRgb, familyOf, swatchStyle, closeness, inkOn, brandName, KINDS, groupOf, NOCOLOUR, SHEER, openPaint, draw, normHex, mixHex, fmt, comparable, setColour, tile };
