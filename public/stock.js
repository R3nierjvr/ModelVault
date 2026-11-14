// Materials (FDM filament and resin) and Tools (printers, airbrushes, brushes, masks…): your own stock, saved on the NAS.
// The filament catalogue is SpoolmanDB (MIT); the material guide gives typical ranges, not a maker's settings.
import { lab, deltaE, familyOf as paintFamily, FAMILIES, FAMILY_DOT } from './paints.js';

let h;
let ready = null;
const S = {
  tab: 'materials', sec: { materials: 'mine', tools: 'all' },
  mats: [], tools: [], cat: null, catReady: null,
  mq: '', mkind: '', mmat: '', mlow: false, msort: 'material',
  cq: '', cbrand: '', cmat: '', cdia: '1.75', cshown: 120,
  res: null, resReady: null, rq: '', rbrand: '', rtype: '', rwash: '', rshown: 120,
  // Colour filters for your list, the filament list and the resin list.
  cf: { mine: { fams: [], picks: [], pattern: '' }, fil: { fams: [], picks: [], pattern: '' }, res: { fams: [], picks: [], pattern: '' } },
  tq: '', tneed: '',
};
try { Object.assign(S.sec, JSON.parse(localStorage.getItem('mv.stockSec') || '{}')); } catch { /* defaults */ }
const saveSec = () => { try { localStorage.setItem('mv.stockSec', JSON.stringify(S.sec)); } catch { /* ignore */ } };
const el = (...a) => h.el(...a);
const svg = (p) => h.svg(p);
const X = '<path d="m6 6 12 12M18 6 6 18"/>';
const uid = () => Math.random().toString(36).slice(2, 10);
const n0 = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const fmtG = (g) => (g >= 1000 ? `${(g / 1000).toFixed(g % 1000 ? 2 : 0)} kg` : `${Math.round(g)} g`);
const today = () => new Date().toISOString().slice(0, 10);
async function save(key) { try { await h.api('PUT', `/api/paint-docs/${key}`, { value: key === 'materials' ? S.mats : S.tools }); } catch (e) { h.fail(e); } }
/** replaceChildren that takes lists and skips empty parts. */
const put = (node, ...kids) => node.replaceChildren(...kids.flat(3).filter((k) => k != null && k !== false && k !== ''));
const btn = (label, onclick, cls = 'ghost') => el('button', { type: 'button', class: `btn small ${cls}`, onclick }, label);
function head(title, sub, ...actions) { return el('div', { class: 'pv-head' }, el('div', {}, el('h2', {}, title), sub && el('p', { class: 'muted' }, sub)), el('div', { class: 'pv-acts' }, ...actions)); }
function emptyBox(text, ...actions) { return el('div', { class: 'empty pv-empty' }, el('p', {}, text), ...actions); }

// ---------- material guide: typical ranges (°C) ----------
export const GUIDE = {
  PLA: { name: 'PLA', nozzle: [190, 220], bed: [50, 60], note: 'The easy one: low warp, no enclosure, stiff but brittle and softens in a hot car (about 55 °C).' },
  PETG: { name: 'PETG', nozzle: [230, 250], bed: [70, 85], note: 'Tougher and more heat-resistant than PLA. Strings easily: dry it and tune retraction. Sticks too well to smooth PEI and glass; use glue stick as a release layer.' },
  PCTG: { name: 'PCTG', nozzle: [240, 260], bed: [70, 90], note: 'Like PETG but tougher and clearer. Runs a little hotter; fine on an all-metal hotend, near the limit of a PTFE-lined one.' },
  ABS: { name: 'ABS', nozzle: [230, 250], bed: [95, 110], enclosure: true, fumes: true, note: 'Strong and heat-resistant, smooths with acetone. Warps and cracks in a draught: needs an enclosure. Gives off fumes; ventilate.' },
  ASA: { name: 'ASA', nozzle: [240, 260], bed: [95, 110], enclosure: true, fumes: true, note: 'ABS that survives sunlight: good for outdoor parts. Same warping and fumes as ABS.' },
  TPU: { name: 'TPU (flexible)', nozzle: [210, 235], bed: [40, 60], flexible: true, note: 'Rubbery. Direct drive handles it well (print around 25–35 mm/s, short retraction). Bowden extruders manage 95A only slowly; softer grades need direct drive.' },
  Nylon: { name: 'Nylon (PA)', nozzle: [240, 270], bed: [70, 90], enclosure: true, allMetal: true, dry: true, note: 'Very tough and slippery. Soaks up moisture within hours: print it straight from a dryer. Needs an all-metal hotend.' },
  PC: { name: 'Polycarbonate (PC)', nozzle: [260, 300], bed: [100, 120], enclosure: true, allMetal: true, note: 'Very strong and heat-resistant. Needs an all-metal hotend, a hot bed and an enclosure.' },
  HIPS: { name: 'HIPS', nozzle: [220, 240], bed: [90, 110], enclosure: true, note: 'Light and easy to sand. Dissolves in limonene, so it\'s used as a support for ABS.' },
  PVB: { name: 'PVB', nozzle: [200, 220], bed: [60, 75], note: 'Prints like PLA; smooths to a glossy finish with isopropyl alcohol.' },
  PVA: { name: 'PVA (water-soluble)', nozzle: [190, 215], bed: [45, 60], dry: true, note: 'Support that dissolves in water. Must be kept bone dry.' },
  Other: { name: 'Other', nozzle: [200, 240], bed: [50, 80], note: 'Check the maker\'s settings on the spool.' },
};
export function familyOf(material = '', name = '') {
  const m = `${material}`.toUpperCase();
  if (/PVA|BVOH/.test(m)) return 'PVA';
  if (/TPU|TPE|FLEX/.test(m)) return 'TPU';
  if (/PCTG/.test(m)) return 'PCTG';
  if (/PETG|HTPET|\bPET\b|PET-|COPET/.test(m)) return 'PETG';
  if (/ASA/.test(m)) return 'ASA';
  if (/ABS/.test(m)) return 'ABS';
  if (/^PC\b|^PC-|POLYCARB|^PC\+/.test(m)) return 'PC';
  if (/NYLON|^PA\d*|PA-|PAHT|PA6|PA12/.test(m)) return 'Nylon';
  if (/HIPS/.test(m)) return 'HIPS';
  if (/PVB/.test(m)) return 'PVB';
  if (/PLA|GREENTEC|BIOFUSION|PHA|WOOD/.test(m) || /\bPLA\b/i.test(name)) return 'PLA';
  return 'Other';
}
// ---------- resin guide: typical starting points for a mono LCD printer at 0.05 mm layers ----------
// exposure and bottom exposure in seconds, temperature of the resin in °C, wash and cure in minutes.
export const RESIN_GUIDE = {
  Standard: { name: 'Standard', exp: [1.5, 3], bottom: [20, 35], temp: [20, 30], wash: 'ipa', washMin: [2, 4], cure: [2, 5],
    use: 'Display models, terrain and general prints', note: 'The all-rounder: crisp detail and an easy finish, but brittle in thin parts and snaps rather than bends. A good first resin to tune your printer with.' },
  'ABS-like': { name: 'ABS-like', exp: [2, 3.5], bottom: [25, 40], temp: [22, 30], thick: true, wash: 'ipa', washMin: [2, 4], cure: [3, 5],
    use: 'Miniatures with thin parts, swords and spears, gaming pieces', note: 'Bends a little before it breaks, so thin weapons and spears survive handling. Slightly thicker than standard resin: keep it warm and give it a little more exposure.' },
  'Water-washable': { name: 'Water-washable', exp: [1.8, 3], bottom: [25, 35], temp: [20, 30], wash: 'water', washMin: [1, 3], cure: [2, 4], dryFirst: true,
    use: 'Printing without IPA', note: 'Washes off in plain water, but the wash water is still resin: cure it in the sun and filter it before throwing it away, never down the drain. Let prints dry fully before curing or they turn white and can crack. More brittle than standard resin, and it absorbs moisture over time.' },
  'Plant-based': { name: 'Plant-based', exp: [2, 3.5], bottom: [30, 45], temp: [22, 30], wash: 'ipa', washMin: [2, 4], cure: [3, 5],
    use: 'Printing indoors with less smell', note: 'Made partly from soybean or other plant oils, so it smells much less. It is still a resin: just as irritating to skin, so wear gloves as usual. Often needs longer exposure and supports that are a little stronger.' },
  Tough: { name: 'Tough', exp: [2.5, 4], bottom: [30, 45], temp: [25, 30], thick: true, wash: 'ipa', washMin: [2, 4], cure: [3, 6],
    use: 'Functional parts, clips, snap fits, jigs', note: 'Takes knocks and flexes without cracking. Thick and slow to flow back under the plate: warm it to 25–30 °C, print with slower lifts and use heavier supports.' },
  Flexible: { name: 'Flexible', exp: [2.5, 6], bottom: [30, 60], temp: [25, 30], thick: true, flexible: true, wash: 'ipa', washMin: [1, 2], cure: [2, 5],
    use: 'Gaskets, grips, tyres, bendy props', note: 'Rubbery once cured. Print slowly with low lift speeds and thick supports; tall thin parts wobble while printing. Wash briefly, because flexible resin soaks up IPA and swells. Often mixed 1:1 to 1:3 with standard or ABS-like resin for something in between.' },
  '8K / high detail': { name: '8K / high detail', exp: [1.5, 2.5], bottom: [20, 30], temp: [20, 30], fine: true, wash: 'ipa', washMin: [2, 4], cure: [2, 4],
    use: 'Miniatures, faces, jewellery masters', note: 'Finer pigment and lower shrinkage, so it holds the detail of an 8K or 12K screen. On a lower resolution screen it prints like a good standard resin. Easy to over-expose: start at the low end and run an exposure test.' },
  Clear: { name: 'Clear', exp: [1.2, 2.5], bottom: [15, 30], temp: [20, 30], wash: 'ipa', washMin: [2, 3], cure: [1, 3], clear: true,
    use: 'Lenses, light covers, gems, ice and water effects', note: 'Over-exposes and yellows easily. Wash thoroughly in clean IPA, then cure briefly; curing in a glass of water keeps it clearer. For glass-like parts, sand smooth and add a gloss clear coat.' },
  'High-temperature': { name: 'High-temperature', exp: [3, 8], bottom: [40, 60], temp: [28, 35], thick: true, heatCure: true, wash: 'ipa', washMin: [2, 4], cure: [10, 60],
    use: 'Moulds, parts near heat, hot-air and casting masters', note: 'Very thick when cold: warm it to around 30 °C or it can fail to print. Reaches its full heat resistance only after the maker\'s post-cure, which often includes time in an oven.' },
  Castable: { name: 'Castable', exp: [2.5, 5], bottom: [30, 50], temp: [22, 30], castable: true, wash: 'ipa', washMin: [2, 4], cure: [3, 10],
    use: 'Jewellery and metal casting', note: 'Burns out cleanly in a kiln, leaving little ash, for lost-wax casting. Follow the maker\'s burnout schedule exactly, and keep thin parts supported because the cured resin is soft.' },
  Engineering: { name: 'Engineering', exp: [2, 8], bottom: [30, 60], temp: [25, 35], thick: true, wash: 'ipa', washMin: [2, 5], cure: [5, 30],
    use: 'Functional parts that need a specific property', note: 'Made for a job: heat resistance, stiffness, wear or chemical resistance. Settings vary widely, so use the maker\'s data sheet. Some are made for professional printers only.' },
};
const resinKey = (f) => (RESIN_GUIDE[f.material] ? f.material : 'Standard');
const pixelOf = (pr) => n0(pr.xy) ?? (/(\d+(?:\.\d+)?)\s*(?:µm|um)/i.exec(pr.screen || '')?.[1] ? Number(/(\d+(?:\.\d+)?)\s*(?:µm|um)/i.exec(pr.screen)[1]) : null);
/** How well a resin suits a resin printer. Resin printers print almost any 405 nm resin, so it's "fine" or "with care". */
export function resinCompat(pr, f) {
  const g = RESIN_GUIDE[resinKey(f)];
  const why = [];
  let level = 'ok';
  const care = (text) => { why.push(text); level = 'care'; };
  if (g.thick && !pr.heater) care(`${g.name} resin is thick: warm the room or the bottle to ${g.temp[0]}–${g.temp[1]} °C before printing, or fit a vat heater, or prints can fail to stick and peel.`);
  if (g.fine) { const px = pixelOf(pr); if (px && px > 35) care(`Its extra detail shows on a high-resolution screen; ${pr.name}'s ${px} µm pixels print it like a good standard resin.`); }
  if (g.flexible) care('Print slowly with low lift speeds and thick supports; tall thin parts wobble.');
  if (g.castable) why.push('Follow the maker\'s burnout schedule when casting.');
  if (g.heatCure) why.push('Needs the maker\'s post-cure, often in an oven, to reach its full heat resistance.');
  if (f.pro) care('Made for professional printers: check the data sheet says it works with a 405 nm LCD printer like yours.');
  if (f.washWater || g.wash === 'water') why.push('Wash it in water, and cure the wash water before throwing it away.');
  return { level, why };
}
const resinRange = (r, unit) => `${r[0]}–${r[1]} ${unit}`;

const abrasive = (f) => /CF|GF|CARBON|GLASS|GLOW|METAL|STEEL|COPPER|BRONZE|BRASS|WOOD/i.test(`${f.material} ${f.name}`) || !!f.glow;
const shoreOf = (f) => { const m = /(\d{2})\s*A\b/i.exec(`${f.material} ${f.name}`); return m ? Number(m[1]) : null; };

// ---------- can this printer print it? ----------
const fdmPrinters = () => S.tools.filter((t) => t.cat === 'printer' && (t.type || 'FDM') === 'FDM' && t.condition !== 'Retired');
const resinPrinters = () => S.tools.filter((t) => t.cat === 'printer' && t.type === 'Resin' && t.condition !== 'Retired');
const hardenedNozzleOwned = () => S.tools.some((t) => t.cat === 'nozzle' && /hardened|steel|ruby|carbide/i.test(t.nozzleMat || ''));
export function compat(pr, f) {
  const g = GUIDE[familyOf(f.material, f.name)];
  const why = [];
  let level = 'ok';
  const worse = (l, text) => { why.push(text); if (l === 'no' || (l === 'care' && level === 'ok')) level = l; };
  const maxN = n0(pr.maxNozzle) ?? 250, maxB = n0(pr.maxBed) ?? 100;
  if (f.diameter && pr.diameter && Number(f.diameter) !== Number(pr.diameter)) worse('no', `It's ${f.diameter} mm filament; ${pr.name} takes ${pr.diameter} mm.`);
  const need = n0(f.nozzleTemp) ?? g.nozzle[0];
  if (g.allMetal && pr.hotend !== 'All-metal') worse('no', `${g.name} needs an all-metal hotend; ${pr.name} has a PTFE-lined one.`);
  else if (g.nozzle[0] > maxN) worse('no', `Needs at least ${g.nozzle[0]} °C; ${pr.name} reaches ${maxN} °C.`);
  else if (need > maxN) worse('care', `The maker suggests ${need} °C, above ${pr.name}'s ${maxN} °C: print at the low end of its range.`);
  else if (pr.hotend !== 'All-metal' && need > 240) worse('care', `${need} °C is above 240 °C, where the PTFE tube in a stock hotend starts to break down. Keep it at 240 °C or fit an all-metal hotend.`);
  const needB = n0(f.bedTemp) ?? g.bed[0];
  if (g.bed[0] > maxB) worse('no', `Needs a ${g.bed[0]} °C bed; ${pr.name}'s reaches ${maxB} °C.`);
  else if (needB > maxB) worse('care', `The maker suggests a ${needB} °C bed; ${pr.name} reaches ${maxB} °C.`);
  if (g.enclosure && !pr.enclosure) worse('care', `${g.name} warps and cracks in a draught: use an enclosure, or at least keep the room warm and still.`);
  if (g.fumes) why.push('Gives off fumes while printing: ventilate the room.');
  if (g.flexible && pr.extruder !== 'Direct drive') {
    const sh = shoreOf(f);
    if (sh != null && sh < 92) worse('no', `Soft TPU (${sh}A) jams in a Bowden extruder; it needs direct drive.`);
    else worse('care', 'On a Bowden extruder: print slowly (about 20 mm/s) with little or no retraction.');
  }
  if (abrasive(f) && !/hardened|steel|ruby|carbide/i.test(pr.nozzleMat || '')) worse('care', `Abrasive (carbon/glass fibre, glow, metal or wood fill): it wears out a brass nozzle quickly. ${hardenedNozzleOwned() ? 'Swap in your hardened nozzle.' : 'Use a hardened steel nozzle.'}`);
  if (g.dry) why.push('Keep it dry: print from a dryer box if you can.');
  return { level, why };
}
function compatChips(f) {
  if (f.kind === 'resin') {
    const rp = resinPrinters();
    if (!rp.length) return [el('span', { class: 'cchip no', title: 'Add a resin printer in Tools to print this.' }, 'No resin printer yet')];
    return rp.map((p) => { const c = resinCompat(p, f); return el('button', { type: 'button', class: `cchip ${c.level}`, title: c.why.join(' '), onclick: () => explain(p, f, c) }, `${p.name}: ${c.level === 'ok' ? 'prints it' : 'with care'}`); });
  }
  const ps = fdmPrinters();
  if (!ps.length) return [el('span', { class: 'cchip care', title: 'Add your printer in Tools.' }, 'No FDM printer set up')];
  return ps.map((p) => {
    const c = compat(p, f);
    const label = { ok: 'prints well', care: 'with care', no: 'can\'t print' }[c.level];
    return el('button', { type: 'button', class: `cchip ${c.level}`, title: c.why.join(' '), onclick: () => explain(p, f, c) }, `${p.name}: ${label}`);
  });
}
async function explain(p, f, c) {
  const kind = f.kind === 'resin' ? `${RESIN_GUIDE[resinKey(f)].name} resin` : GUIDE[familyOf(f.material, f.name)].name;
  await h.confirmDlg(`${p.name} and ${f.name || f.material}`, c.why.length ? c.why.join(' ') : `Fine: ${kind} prints well on ${p.name} with normal settings.`, [{ label: 'OK', value: 'y', cls: 'primary' }]);
}

// ---------- swatches ----------
function spoolStyle(f) {
  const cols = f.hexes?.length ? f.hexes : [f.hex || '#888888'];
  const fill = cols.length > 1 ? `conic-gradient(${cols.map((c, i) => `${c} ${(i / cols.length) * 100}% ${((i + 1) / cols.length) * 100}%`).join(', ')})` : cols[0];
  return `background: radial-gradient(circle, var(--panel) 0 19%, rgba(0,0,0,.35) 20%, transparent 23%), ${fill}`;
}
const spool = (f, cls = '') => el('span', { class: `spool ${cls}${f.translucent ? ' clear' : ''}`, style: spoolStyle(f), role: 'img', 'aria-label': f.colour || f.hex || '' });
// A resin bottle with a white outline, filled with the resin's colour up to what's left.
let bottleN = 0;
const BODY = 'M23 15v5c0 3.5-15 6-15 14.5V80a6 6 0 0 0 6 6h32a6 6 0 0 0 6-6V34.5C52 26 37 23.5 37 20v-5z';
function resinBottle(colours, { pct = 1, clear = false, label = '' } = {}) {
  const id = `rb${++bottleN}`;
  const cols = (colours || []).filter(Boolean);
  const top = 22, bottom = 86, level = bottom - (bottom - top) * Math.max(0, Math.min(1, pct));
  const fill = cols.length > 1 ? `url(#${id}g)` : cols[0] || '#777';
  const grad = cols.length > 1 ? `<linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1">${cols.map((c, i) => `<stop offset="${i / (cols.length - 1)}" stop-color="${c}"/>`).join('')}</linearGradient>` : '';
  const sp = el('span', { class: 'rbottle2', role: 'img', 'aria-label': label });
  sp.innerHTML = `<svg viewBox="0 0 60 90" width="58" height="87" aria-hidden="true" style="width:58px;height:87px"><defs><clipPath id="${id}"><path d="${BODY}"/></clipPath>${grad}</defs>`
    + `<path d="${BODY}" fill="rgba(255,255,255,.06)" stroke="none"/>`
    + `<g clip-path="url(#${id})"><rect x="0" y="${level}" width="60" height="${90 - level}" fill="${fill}" fill-opacity="${clear ? 0.72 : 1}" stroke="none"/>`
    + (pct > 0 && pct < 1 ? `<path d="M8 ${level}H52" stroke="rgba(255,255,255,.45)" stroke-width="1"/>` : '')
    + `<path d="M14 40v36" stroke="rgba(255,255,255,.35)" stroke-width="3" stroke-linecap="round"/></g>`
    + `<path d="${BODY}" fill="none" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/>`
    + `<rect x="20" y="3" width="20" height="12" rx="2.5" fill="#2a2e33" stroke="#fff" stroke-width="2.2"/>`
    + `<path d="M24 7v4M28 7v4M32 7v4M36 7v4" stroke="rgba(255,255,255,.5)" stroke-width="1.2" stroke-linecap="round"/></svg>`;
  return sp;
}
function bottle(f) {
  const pct = f.size ? Math.max(0, Math.min(1, (n0(f.remaining) ?? f.size) / f.size)) : 1;
  return resinBottle(coloursOf(f), { pct, clear: !!f.translucent, label: `${f.colour || f.name || 'Resin'}, ${Math.round(pct * 100)}% left` });
}

// ---------- colours: families, multi-colour and find by colour ----------
const famCache = new Map();
const famOf = (hex) => { if (!hex) return null; let f = famCache.get(hex); if (!f) { f = paintFamily({ lab: lab(hex) }); famCache.set(hex, f); } return f; };
/** Every colour of a spool or bottle (dual and tri-colour filament have more than one). */
const coloursOf = (x) => (x.hexes?.length ? x.hexes : x.hs?.length ? x.hs : [x.hex || x.h]).filter(Boolean);
const labsOf = (x) => x.labs || coloursOf(x).map((c) => lab(c));
// Metallic and silk colours go by their names too: a gold reads as orange or yellow by colour alone.
const METALS = [['Gold', /gold|brass/i, '#D4AF37'], ['Silver', /silver|chrome|aluminium|aluminum/i, '#C3C6CC'], ['Copper', /copper|bronze/i, '#B8733A']];
const FAMS = [...FAMILIES, ...METALS.map(([k]) => k)];
const DOT = { ...FAMILY_DOT, ...Object.fromEntries(METALS.map(([k, , c]) => [k, c])) };
function famSet(cols, text) {
  const s2 = new Set(cols.map(famOf));
  for (const [k, re] of METALS) if (re.test(text || '')) s2.add(k);
  return s2;
}
const famsOf = (x) => x.fams || famSet(coloursOf(x), `${x.colour || ''} ${x.name || ''}`);
const colourWord = (n) => ({ 2: 'Dual', 3: 'Tri', 4: 'Four' }[n] || `${n}`);
/** "Dual colour (side by side)" and the like, or '' for one colour. */
function multiLabel(x) {
  const n = coloursOf(x).length, mc = x.mc;
  if (n < 2) return '';
  if (mc === 'longitudinal') return n > 3 ? 'Rainbow (changes along the spool)' : `${colourWord(n)}-colour gradient (changes along the spool)`;
  return `${colourWord(n)}-colour${mc === 'coaxial' ? ' (side by side)' : ''}`;
}
/** null if it doesn't match the colour filter; otherwise how far off the picked colours are (0 without picks). */
function colourMatch(x, f) {
  const n = coloursOf(x).length;
  if (f.pattern === 'single' && n > 1) return null;
  if (f.pattern === 'multi' && n < 2) return null;
  if (f.fams.length) { const fs = famsOf(x); if (!f.fams.every((k) => fs.has(k))) return null; }
  if (!f.picks.length) return 0;
  const labs = labsOf(x);
  let worst = 0;
  for (const p of f.picks) { const t = lab(p); worst = Math.max(worst, Math.min(...labs.map((l) => deltaE(t, l)))); }
  return worst < (f.picks.length > 1 ? 20 : 15) ? worst : null;
}
const colourActive = (f) => f.fams.length || f.picks.length || f.pattern;
/** The colour filter: colour families, single or multi-colour, and up to three colours to find. */
function colourBar(f, items, onChange, { pattern = true } = {}) {
  const counts = new Map();
  for (const x of items) for (const k of famsOf(x)) counts.set(k, (counts.get(k) || 0) + 1);
  const multi = items.filter((x) => coloursOf(x).length > 1).length;
  const toggle = (k) => { f.fams = f.fams.includes(k) ? f.fams.filter((x) => x !== k) : [...f.fams, k]; onChange(); };
  let t;
  const pickRow = (c, i) => el('span', { class: 'colour-pick' },
    el('input', { type: 'color', value: c, 'aria-label': `Colour ${i + 1} to find`, oninput: (e) => { clearTimeout(t); const v = e.target.value.toUpperCase(); t = setTimeout(() => { f.picks[i] = v; onChange(); }, 200); } }),
    el('b', {}, c),
    el('button', { type: 'button', class: 'icon-btn small', 'aria-label': `Stop looking for ${c}`, title: 'Remove', onclick: () => { f.picks.splice(i, 1); onChange(); } }, svg(X)));
  const shown = FAMS.filter((k) => counts.get(k) || f.fams.includes(k));
  return el('div', { class: 'colour-bar' },
    el('div', { class: 'cfams', role: 'group', 'aria-label': 'Colour' },
      shown.map((k) => el('button', { type: 'button', class: 'cfam', 'aria-pressed': String(f.fams.includes(k)), onclick: () => toggle(k) },
        el('span', { class: 'pdot', style: `background:${DOT[k]}` }), k, el('span', { class: 'count' }, counts.get(k) || 0)))),
    el('div', { class: 'cpicks' },
      pattern && el('label', { class: 'select-wrap small' }, el('span', { class: 'sr-only' }, 'One or more colours'), el('select', { onchange: (e) => { f.pattern = e.target.value; onChange(); } },
        [['', 'One or more colours'], ['single', 'Single colour'], ['multi', `Multi-colour (dual, tri, rainbow) · ${multi}`]].map(([v, l]) => el('option', { value: v, selected: f.pattern === v }, l)))),
      f.picks.map(pickRow),
      f.picks.length < 3 && el('button', { type: 'button', class: 'btn small ghost', onclick: () => { f.picks.push(f.picks.length ? '#D4AF37' : '#3A7BD5'); onChange(); } }, f.picks.length ? '+ Another colour' : 'Find by colour'),
      colourActive(f) && el('button', { type: 'button', class: 'link-inline', onclick: () => { Object.assign(f, { fams: [], picks: [], pattern: '' }); onChange(); } }, 'Clear colour')),
    (f.fams.length + f.picks.length > 1) && el('p', { class: 'muted cbar-note' }, 'Showing only ones that have all of these colours, like a dual-colour silk.'));
}
/** Apply a colour filter to a list; closest first when colours are picked. */
function byColour(list, f) {
  if (!colourActive(f)) return list;
  const out = [];
  for (const x of list) { const d = colourMatch(x, f); if (d != null) out.push([x, d]); }
  if (f.picks.length) out.sort((a, b) => a[1] - b[1]);
  return out.map(([x, d]) => (f.picks.length ? { ...x, dist: d } : x));
}

// ---------- adding and editing materials ----------
const RESIN_TYPES = ['Standard', 'ABS-like', 'Water-washable', 'Plant-based', 'Tough', 'Flexible', '8K / high detail', 'Clear', 'High-temperature', 'Castable', 'Engineering', 'Other'];
function field(label, input, hint) { return el('label', { class: 'field' }, el('span', {}, label), input, hint && el('small', { class: 'muted' }, hint)); }
function dialog(title, sub, body) {
  const d = el('dialog', { class: 'sheet narrow', 'aria-label': title });
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  d.append(el('header', { class: 'sheet-head' }, el('h2', {}, title), sub && el('p', { class: 'muted' }, sub), el('button', { class: 'icon-btn close', type: 'button', 'aria-label': 'Close', onclick: () => d.close() }, svg(X))), body);
  d.showModal();
  return d;
}
function editMaterial(item = null, kind = 'filament') {
  const it = item ? { ...item } : { kind, diameter: 1.75, size: kind === 'resin' ? 1000 : 1000, remaining: kind === 'resin' ? 1000 : 1000, qty: 1, bought: today() };
  const isRes = it.kind === 'resin';
  // One colour, or up to four for dual, tri and rainbow filament.
  const cols = (it.hexes?.length ? it.hexes : [it.hex || '#808080']).slice(0, isRes ? 1 : 4);
  const colBox = el('div', { class: 'pe-colours' });
  const mcSel = el('select', { name: 'mc', class: 'set-select' }, [['coaxial', 'Side by side (dual or tri silk)'], ['longitudinal', 'Changes along the spool (gradient, rainbow)'], ['', 'Not sure']].map(([v, l]) => el('option', { value: v, selected: (it.mc ?? 'coaxial') === v }, l)));
  const mcField = field('How the colours are laid out', mcSel);
  const drawCols = () => {
    put(colBox, cols.map((c, i) => {
      const hex = el('input', { value: c, class: 'mono', maxlength: 7, 'aria-label': `Colour ${i + 1} code`, oninput: () => { if (/^#[0-9a-f]{6}$/i.test(hex.value)) { cols[i] = hex.value.toUpperCase(); pick.value = hex.value; } } });
      const pick = el('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(c) ? c : '#808080', 'aria-label': `Colour ${i + 1}`, oninput: (e) => { cols[i] = e.target.value.toUpperCase(); hex.value = cols[i]; } });
      return el('div', { class: 'pe-colour' }, pick, hex, i > 0 && el('button', { type: 'button', class: 'icon-btn small', 'aria-label': `Remove colour ${i + 1}`, onclick: () => { cols.splice(i, 1); drawCols(); } }, svg(X)));
    }), !isRes && cols.length < 4 && btn(cols.length > 1 ? '+ Another colour' : '+ Second colour (dual-colour filament)', () => { cols.push('#D4AF37'); drawCols(); }));
    mcField.hidden = cols.length < 2;
  };
  drawCols();
  const matList = el('datalist', { id: 'mat-list' }, [...new Set([...Object.values(GUIDE).map((g) => g.name.split(' (')[0]), 'PLA+', 'Silk PLA', 'Matte PLA', 'PETG-CF', 'PLA-CF', 'TPU 95A', 'Wood PLA'])].map((m) => el('option', { value: m })));
  let d;
  const f = el('form', { class: 'sheet-body stack', onsubmit: async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    const out = { ...it, ...v, kind: it.kind };
    out.hex = cols[0]; out.hexes = cols.length > 1 ? [...cols] : undefined; out.mc = cols.length > 1 ? v.mc || undefined : undefined;
    for (const k of ['size', 'remaining', 'spoolWeight', 'nozzleTemp', 'bedTemp', 'price', 'qty', 'diameter', 'exposure', 'bottomExposure', 'bottomLayers', 'layer']) if (k in v) out[k] = n0(v[k]);
    out.restock = !!v.restock; out.translucent = !!v.translucent;
    if (!out.name?.trim()) { h.toast('Give it a name.', true); return; }
    if (out.remaining != null && out.size && out.remaining > out.size) out.remaining = out.size;
    if (item) S.mats = S.mats.map((x) => (x.id === item.id ? out : x)); else S.mats.push({ ...out, id: uid(), added: Date.now() });
    await save('materials'); d.close(); h.toast(item ? 'Saved' : `Added ${out.name}`); render();
  } },
    matList,
    !item && el('div', { class: 'pv-acts' }, btn(isRes ? 'Pick from the resin list' : 'Pick from the filament list', async () => { d.close(); pickFromCatalogue(isRes ? 'resins' : 'catalogue'); }, 'primary'), el('span', { class: 'muted' }, 'or fill it in:')),
    el('div', { class: 'two' }, field('Brand', el('input', { name: 'brand', value: it.brand || '', placeholder: isRes ? 'e.g. Elegoo' : 'e.g. eSun' })), field('Name', el('input', { name: 'name', required: true, value: it.name || '', placeholder: isRes ? 'e.g. ABS-like Grey' : 'e.g. PLA+ Black' }))),
    el('div', { class: 'two' },
      isRes ? field('Type', el('select', { name: 'material', class: 'set-select' }, RESIN_TYPES.map((t) => el('option', { value: t, selected: it.material === t }, t))))
        : field('Material', el('input', { name: 'material', list: 'mat-list', required: true, value: it.material || 'PLA' })),
      field('Colour name', el('input', { name: 'colour', value: it.colour || '', placeholder: isRes ? 'e.g. Space Grey' : 'e.g. Silk Black Gold' }))),
    el('div', { class: 'field' }, el('span', {}, isRes ? 'Colour' : 'Colours'), colBox),
    !isRes && mcField,
    isRes
      ? el('div', { class: 'two' }, field('Bottle (ml)', el('input', { name: 'size', type: 'number', min: 0, value: it.size ?? '' })), field('Left (ml)', el('input', { name: 'remaining', type: 'number', min: 0, value: it.remaining ?? '' })))
      : el('div', { class: 'two' }, field('Spool (g of filament)', el('input', { name: 'size', type: 'number', min: 0, value: it.size ?? '' })), field('Left (g)', el('input', { name: 'remaining', type: 'number', min: 0, value: it.remaining ?? '' }))),
    isRes
      ? el('div', { class: 'three-col' }, field('Exposure (s)', el('input', { name: 'exposure', type: 'number', step: 0.1, value: it.exposure ?? '' })), field('Bottom exposure (s)', el('input', { name: 'bottomExposure', type: 'number', step: 0.5, value: it.bottomExposure ?? '' })), field('Bottom layers', el('input', { name: 'bottomLayers', type: 'number', value: it.bottomLayers ?? '' })))
      : el('div', { class: 'three-col' },
        field('Diameter', el('select', { name: 'diameter', class: 'set-select' }, [1.75, 2.85].map((x) => el('option', { value: x, selected: Number(it.diameter) === x }, `${x} mm`)))),
        field('Nozzle °C', el('input', { name: 'nozzleTemp', type: 'number', value: it.nozzleTemp ?? '' })),
        field('Bed °C', el('input', { name: 'bedTemp', type: 'number', value: it.bedTemp ?? '' }))),
    !isRes && field('Empty spool weight (g)', el('input', { name: 'spoolWeight', type: 'number', min: 0, value: it.spoolWeight ?? '' }), 'Lets you weigh the spool to see what\'s left.'),
    isRes && field('Layer height (mm)', el('input', { name: 'layer', type: 'number', step: 0.01, value: it.layer ?? '' })),
    el('div', { class: 'three-col' },
      field('How many', el('input', { name: 'qty', type: 'number', min: 1, value: it.qty ?? 1 })),
      field('Price each', el('input', { name: 'price', type: 'number', min: 0, step: 0.01, value: it.price ?? '' })),
      field('Bought', el('input', { name: 'bought', type: 'date', value: it.bought || '' }))),
    el('div', { class: 'two' }, field('Opened', el('input', { name: 'opened', type: 'date', value: it.opened || '' })), field(isRes ? 'Stored where' : 'Last dried', isRes ? el('input', { name: 'where', value: it.where || '' }) : el('input', { name: 'dried', type: 'date', value: it.dried || '' }))),
    !isRes && field('Stored where', el('input', { name: 'where', value: it.where || '', placeholder: 'e.g. Dry box 1' })),
    field('Notes', el('textarea', { name: 'notes', rows: 2 }, it.notes || '')),
    el('div', { class: 'check-row' },
      !isRes && el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'translucent', checked: !!it.translucent }), el('span', {}, 'Translucent')),
      el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'restock', checked: !!it.restock }), el('span', {}, 'Buy more'))),
    el('div', { class: 'form-actions' }, el('button', { class: 'btn primary', type: 'submit' }, item ? 'Save' : 'Add'), el('button', { class: 'btn ghost', type: 'button', onclick: () => d.close() }, 'Cancel')));
  d = dialog(item ? `Edit ${item.name}` : isRes ? 'Add resin' : 'Add filament', null, f);
}
function useMaterial(it) {
  const isRes = it.kind === 'resin', unit = isRes ? 'ml' : 'g';
  let d;
  const amount = el('input', { name: 'amount', type: 'number', min: 0, step: 1, placeholder: unit });
  const scale = el('input', { name: 'scale', type: 'number', min: 0, step: 1, placeholder: 'g on the scale' });
  const f = el('form', { class: 'sheet-body stack', onsubmit: async (e) => {
    e.preventDefault();
    let left = n0(it.remaining) ?? it.size ?? 0;
    if (!isRes && n0(scale.value) != null) {
      if (n0(it.spoolWeight) == null) { h.toast('Set the empty spool weight first (Edit).', true); return; }
      left = Math.max(0, n0(scale.value) - n0(it.spoolWeight));
    } else left = Math.max(0, left - (n0(amount.value) || 0));
    S.mats = S.mats.map((x) => (x.id === it.id ? { ...x, remaining: Math.round(left), opened: x.opened || today(), restock: x.restock || (x.size && left / x.size < 0.15) } : x));
    await save('materials'); d.close(); h.toast(`${it.name}: ${isRes ? `${Math.round(left)} ml` : fmtG(left)} left`); render();
  } },
    field(`Used (${unit})`, amount, isRes ? 'From your slicer\'s estimate.' : 'From your slicer\'s estimate, e.g. 42 g.'),
    !isRes && field('Or weigh the spool', scale, n0(it.spoolWeight) != null ? `Empty spool weighs ${it.spoolWeight} g; that\'s taken off.` : 'Set the empty spool weight under Edit to use this.'),
    el('div', { class: 'form-actions' }, el('button', { class: 'btn primary', type: 'submit' }, 'Update'), el('button', { class: 'btn ghost', type: 'button', onclick: () => d.close() }, 'Cancel')));
  d = dialog(`Use ${it.name}`, `${isRes ? `${n0(it.remaining) ?? it.size} ml` : fmtG(n0(it.remaining) ?? it.size)} left now.`, f);
  amount.focus();
}

// ---------- filament catalogue ----------
async function loadCatalogue() {
  if (!S.catReady) {
    S.catReady = fetch('/materials/filaments.json').then((r) => { if (!r.ok) throw new Error('The filament list could not be loaded.'); return r.json(); }).then((d) => {
      S.cat = { brands: d.brands, list: d.filaments.map((x, i) => { const cols = x.hs?.length ? x.hs : [x.h]; return { ...x, i, brand: d.brands[x.b], fam: familyOf(x.m, x.n), labs: cols.map((c) => lab(c)), fams: famSet(cols, `${x.c} ${x.n}`) }; }) };
    });
    S.catReady.catch(() => { S.catReady = null; });
  }
  return S.catReady;
}
const asItem = (c) => ({ kind: 'filament', brand: c.brand, name: `${c.brand} ${c.n}`.replace(new RegExp(`^${c.brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+${c.brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), c.brand), material: c.m, colour: c.c, hex: c.h, hexes: c.hs, mc: c.mc, diameter: (c.d || []).includes(1.75) ? 1.75 : (c.d || [1.75])[0], nozzleTemp: c.t ?? null, bedTemp: c.bt ?? null, size: c.w?.[0]?.[0] ?? 1000, remaining: c.w?.[0]?.[0] ?? 1000, spoolWeight: c.w?.[0]?.[1] ?? null, translucent: !!c.tr, glow: !!c.gl, finish: c.f, catId: c.i });
async function addFromCatalogue(c) {
  const it = { ...asItem(c), id: uid(), qty: 1, added: Date.now(), bought: today() };
  S.mats.push(it); await save('materials');
  h.toast(`Added ${it.name} to your spools`);
  render();
}
function catBase() {
  const q = S.cq.trim().toLowerCase();
  return S.cat.list.filter((c) => (!S.cbrand || c.brand === S.cbrand) && (!S.cmat || c.fam === S.cmat) && (!S.cdia || (c.d || []).map(String).includes(S.cdia)) && (!q || q.split(/\s+/).every((w) => `${c.brand} ${c.n} ${c.m} ${c.c}`.toLowerCase().includes(w))));
}
function catTile(c) {
  const it = asItem(c);
  const have = S.mats.some((m) => m.catId === c.i);
  return el('div', { class: 'ftile' },
    spool(it, 'big'),
    el('b', {}, c.n), el('small', { class: 'muted' }, `${c.brand} · ${c.m}${c.dist != null ? ` · ΔE ${c.dist.toFixed(1)}` : ''}`),
    el('small', { class: 'muted' }, [c.t && `${c.t} °C`, c.bt && `bed ${c.bt} °C`, (c.d || []).join(' / ') && `${(c.d || []).join(' / ')} mm`].filter(Boolean).join(' · ')),
    multiLabel(c) && el('small', { class: 'multi-tag' }, multiLabel(c)),
    el('div', { class: 'cchips' }, compatChips(it)),
    have ? el('span', { class: 'own-tag' }, 'In your spools') : btn('Add to my spools', () => addFromCatalogue(c)));
}
function pickFromCatalogue(sec = 'catalogue') { S.sec.materials = sec; saveSec(); render(); window.scrollTo({ top: 0 }); h.toast(sec === 'resins' ? 'Find your resin and press "Add to my resins".' : 'Find your filament and press "Add to my spools".'); }

// ---------- resin list ----------
async function loadResins() {
  if (!S.resReady) {
    S.resReady = fetch('/materials/resins.json').then((r) => { if (!r.ok) throw new Error('The resin list could not be loaded.'); return r.json(); }).then((d) => {
      S.res = { brands: d.brands, list: d.resins.map((x, i) => { const cols = x.hs?.length ? x.hs : [x.h]; return { ...x, i, brand: d.brands[x.b], labs: cols.map((c) => lab(c)), fams: famSet(cols, `${x.c || ''} ${x.n}`) }; }) };
    });
    S.resReady.catch(() => { S.resReady = null; });
  }
  return S.resReady;
}
const resinItem = (c) => ({ kind: 'resin', brand: c.brand, name: `${c.brand} ${c.n}`, material: c.y, colour: c.c || '', hex: c.h, size: 1000, remaining: 1000, translucent: !!c.tr, catId: `r${c.i}`, washWater: c.w === 'water', ...(c.pro ? { pro: true } : {}) });
async function addResin(c) {
  const it = { ...resinItem(c), id: uid(), qty: 1, added: Date.now(), bought: today() };
  S.mats.push(it); await save('materials');
  h.toast(`Added ${it.name} to your resins`);
  render();
}
function resinTile(c) {
  const have = S.mats.some((m) => m.catId === `r${c.i}`);
  const it = resinItem(c);
  return el('div', { class: 'ftile' },
    resinBottle(c.hs?.length > 1 ? c.hs : [c.h], { clear: !!c.tr, label: c.c || c.n }),
    el('b', {}, c.n), el('small', { class: 'muted' }, `${c.brand} · ${c.y}${c.dist != null ? ` · ΔE ${c.dist.toFixed(1)}` : ''}`),
    el('small', { class: 'muted' }, [c.w === 'water' ? 'Wash in water' : 'Wash in IPA', c.tr && 'translucent', c.gl && 'glows in the dark', c.bio && 'biocompatible', c.pro && 'engineering grade'].filter(Boolean).join(' · ')),
    (c.approx || c.nh) && el('small', { class: 'muted approx' }, c.nh ? 'No colour given by the maker' : 'Colour is approximate'),
    el('div', { class: 'cchips' }, compatChips(it)),
    c.u && el('a', { class: 'link-inline', href: c.u, target: '_blank', rel: 'noopener' }, 'Maker\'s page'),
    have ? el('span', { class: 'own-tag' }, 'In your resins') : btn('Add to my resins', () => addResin(c)));
}
async function renderResins(root) {
  if (!S.res) { put(root, el('p', { class: 'muted paint-loading' }, 'Loading the resin list…')); await loadResins(); }
  const q = S.rq.trim().toLowerCase();
  const base = S.res.list.filter((c) => (!S.rbrand || c.brand === S.rbrand) && (!S.rtype || c.y === S.rtype) && (!S.rwash || (S.rwash === 'water') === (c.w === 'water')) && (!q || q.split(/\s+/).every((w) => `${c.brand} ${c.n} ${c.y}`.toLowerCase().includes(w))));
  const list = byColour(base, S.cf.res);
  const brands = [...new Set(S.res.list.map((c) => c.brand))].sort((a, b) => a.localeCompare(b));
  const types = RESIN_TYPES.filter((t) => S.res.list.some((c) => c.y === t));
  const again = () => { S.rshown = 120; render(); };
  put(root,
    head('Resin list', `${S.res.list.length.toLocaleString()} resins from ${brands.length} brands. Data: OpenPrintTag (MIT licence) plus popular hobby resins with approximate colours.`,
      btn('Resin guide', () => { S.gkind = 'resin'; S.sec.materials = 'guide'; saveSec(); render(); window.scrollTo({ top: 0 }); })),
    el('div', { class: 'view-bar' },
      el('label', { class: 'search small' }, el('span', { class: 'sr-only' }, 'Search resins'), svg('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
        el('input', { type: 'search', placeholder: 'Brand, name or colour', value: S.rq, oninput: (e) => { S.rq = e.target.value; S.rshown = 120; clearTimeout(S.t); S.t = setTimeout(() => { render(); const i = root.querySelector('input[type=search]'); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); }, 180); } })),
      el('label', { class: 'select-wrap small' }, el('span', { class: 'sr-only' }, 'Brand'), el('select', { onchange: (e) => { S.rbrand = e.target.value; again(); } }, el('option', { value: '' }, 'Every brand'), brands.map((b) => el('option', { value: b, selected: S.rbrand === b }, b)))),
      el('label', { class: 'select-wrap small' }, el('span', { class: 'sr-only' }, 'Type'), el('select', { onchange: (e) => { S.rtype = e.target.value; again(); } }, el('option', { value: '' }, 'Every type'), types.map((t) => el('option', { value: t, selected: S.rtype === t }, t)))),
      el('label', { class: 'select-wrap small' }, el('span', { class: 'sr-only' }, 'Washing'), el('select', { onchange: (e) => { S.rwash = e.target.value; again(); } }, [['', 'Any washing'], ['water', 'Wash in water'], ['ipa', 'Wash in IPA']].map(([v, l]) => el('option', { value: v, selected: S.rwash === v }, l))))),
    colourBar(S.cf.res, base, again, { pattern: false }),
    el('p', { class: 'muted' }, `${list.length.toLocaleString()} resin${list.length === 1 ? '' : 's'}`),
    list.length ? el('div', { class: 'fgrid' }, list.slice(0, S.rshown).map(resinTile)) : emptyBox('Nothing matches. Try another brand, type or colour.'),
    list.length > S.rshown ? el('div', { class: 'pmore' }, btn(`Show more (${(list.length - S.rshown).toLocaleString()} left)`, () => { S.rshown += 240; render(); })) : '');
}

// ---------- material views ----------
function renderMine(root) {
  const q = S.mq.trim().toLowerCase();
  const pct = (m) => (m.size ? (n0(m.remaining) ?? m.size) / m.size : 1);
  const base = S.mats.filter((m) => (!S.mkind || m.kind === S.mkind) && (!S.mmat || (m.kind === 'resin' ? 'Resin' : familyOf(m.material, m.name)) === S.mmat) && (!S.mlow || pct(m) < 0.2 || m.restock) && (!q || `${m.brand} ${m.name} ${m.material} ${m.colour} ${m.where}`.toLowerCase().includes(q)));
  let list = byColour(base, S.cf.mine);
  const sorters = {
    material: (a, b) => (a.kind || '').localeCompare(b.kind || '') || familyOf(a.material).localeCompare(familyOf(b.material)) || (a.name || '').localeCompare(b.name || ''),
    left: (a, b) => pct(a) - pct(b),
    brand: (a, b) => (a.brand || '').localeCompare(b.brand || '') || (a.name || '').localeCompare(b.name || ''),
    colour: (a, b) => lab(a.hex || '#808080')[0] - lab(b.hex || '#808080')[0],
    family: (a, b) => FAMILIES.indexOf(famOf(a.hex || '#808080')) - FAMILIES.indexOf(famOf(b.hex || '#808080')) || lab(a.hex || '#808080')[0] - lab(b.hex || '#808080')[0],
  };
  if (!S.cf.mine.picks.length) list = list.sort(sorters[S.msort]);
  const fil = S.mats.filter((m) => m.kind !== 'resin'), res = S.mats.filter((m) => m.kind === 'resin');
  const kgLeft = fil.reduce((s, m) => s + (n0(m.remaining) ?? m.size ?? 0) * (m.qty || 1), 0);
  const mlLeft = res.reduce((s, m) => s + (n0(m.remaining) ?? m.size ?? 0) * (m.qty || 1), 0);
  const fams = [...new Set(S.mats.map((m) => (m.kind === 'resin' ? 'Resin' : familyOf(m.material, m.name))))].sort();
  const card = (m) => {
    const isRes = m.kind === 'resin';
    const left = n0(m.remaining) ?? m.size;
    const p = pct(m);
    return el('article', { class: `mcard${p < 0.2 ? ' low' : ''}` },
      isRes ? bottle(m) : spool(m, 'big'),
      el('div', { class: 'mcard-body' },
        el('div', { class: 'mcard-title' }, el('b', {}, m.name), m.qty > 1 && el('span', { class: 'count' }, `×${m.qty}`)),
        el('small', { class: 'muted' }, [m.brand, isRes ? `${m.material || 'Resin'} resin` : m.material, m.colour, !isRes && m.diameter && `${m.diameter} mm`, m.dist != null && `ΔE ${m.dist.toFixed(1)}`].filter(Boolean).join(' · ')),
        multiLabel(m) && el('small', { class: 'multi-tag' }, multiLabel(m)),
        el('small', { class: 'muted' }, isRes ? [m.exposure && `${m.exposure} s exposure`, m.bottomExposure && `${m.bottomExposure} s bottom × ${m.bottomLayers || '?'}`, m.layer && `${m.layer} mm layers`].filter(Boolean).join(' · ') || 'No exposure settings saved'
          : [`${m.nozzleTemp || GUIDE[familyOf(m.material, m.name)].nozzle.join('–')} °C`, `bed ${m.bedTemp || GUIDE[familyOf(m.material, m.name)].bed.join('–')} °C`, m.where].filter(Boolean).join(' · ')),
        m.size ? el('div', { class: 'mleft' }, el('span', { class: 'mbar' }, el('i', { style: `width:${Math.round(p * 100)}%;background:${p < 0.2 ? 'var(--danger)' : 'var(--accent)'}` })), el('small', {}, isRes ? `${Math.round(left)} of ${m.size} ml` : `${fmtG(left)} of ${fmtG(m.size)}`)) : '',
        el('div', { class: 'cchips' }, compatChips(m), m.restock && el('span', { class: 'cchip care' }, 'Buy more')),
        el('div', { class: 'mcard-acts' },
          btn(isRes ? 'Use some' : 'Use / weigh', () => useMaterial(m), 'primary'),
          btn('Edit', () => editMaterial(m)),
          btn('Delete', async () => { if (await h.confirmDlg(`Delete ${m.name}?`, 'It\'s removed from your materials.', [{ label: 'Cancel', value: '' }, { label: 'Delete', value: 'y', cls: 'primary' }])) { S.mats = S.mats.filter((x) => x.id !== m.id); await save('materials'); render(); } }))));
  };
  put(root, 
    head('My filament and resin', S.mats.length ? `${fil.length} filament${fil.length === 1 ? '' : 's'} (${fmtG(kgLeft)} left) · ${res.length} resin${res.length === 1 ? '' : 's'}${res.length ? ` (${Math.round(mlLeft)} ml left)` : ''}` : null,
      btn('Add filament', () => editMaterial(null, 'filament'), 'primary'), btn('Add resin', () => editMaterial(null, 'resin'))),
    !S.mats.length ? emptyBox('No filament or resin yet. Pick filament from the list of 6,000+ spools, or add your own.', btn('Browse the filament list', () => pickFromCatalogue(), 'primary'), btn('Add resin', () => editMaterial(null, 'resin')))
      : el('div', {},
        el('div', { class: 'view-bar' },
          el('label', { class: 'search small' }, el('span', { class: 'sr-only' }, 'Filter'), svg('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
            el('input', { type: 'search', placeholder: 'Filter', value: S.mq, oninput: (e) => { S.mq = e.target.value; clearTimeout(S.t); S.t = setTimeout(() => { render(); const i = root.querySelector('input[type=search]'); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); }, 160); } })),
          el('div', { class: 'seg', role: 'group', 'aria-label': 'Kind' }, [['', 'All'], ['filament', 'Filament'], ['resin', 'Resin']].map(([k, l]) => el('button', { 'aria-pressed': String(S.mkind === k), onclick: () => { S.mkind = k; render(); } }, el('span', {}, l)))),
          el('label', { class: 'select-wrap small' }, el('span', { class: 'sr-only' }, 'Material'), el('select', { onchange: (e) => { S.mmat = e.target.value; render(); } }, el('option', { value: '' }, 'Every material'), fams.map((f) => el('option', { value: f, selected: S.mmat === f }, GUIDE[f]?.name || f)))),
          el('label', { class: 'select-wrap small' }, el('span', { class: 'sr-only' }, 'Sort'), el('select', { onchange: (e) => { S.msort = e.target.value; render(); } }, [['material', 'By material'], ['family', 'By colour'], ['left', 'Least left first'], ['brand', 'By brand'], ['colour', 'Dark to light']].map(([k, l]) => el('option', { value: k, selected: S.msort === k }, l)))),
          el('label', { class: 'check small-check' }, el('input', { type: 'checkbox', checked: S.mlow, onchange: (e) => { S.mlow = e.target.checked; render(); } }), el('span', {}, 'Running low or to buy'))),
        colourBar(S.cf.mine, base, () => render()),
        list.length ? el('div', { class: 'mcards' }, list.map(card)) : emptyBox('Nothing matches.')));
}
async function renderCatalogue(root) {
  if (!S.cat) { put(root, el('p', { class: 'muted paint-loading' }, 'Loading the filament list…')); await loadCatalogue(); }
  const base = catBase();
  const list = byColour(base, S.cf.fil);
  const brands = [...new Set(S.cat.list.map((c) => c.brand))].sort((a, b) => a.localeCompare(b));
  put(root, 
    head('Filament list', `${S.cat.list.length.toLocaleString()} filaments from ${S.cat.brands.length} brands, checked against your printers. Colour data: SpoolmanDB (MIT licence).`),
    el('div', { class: 'view-bar' },
      el('label', { class: 'search small' }, el('span', { class: 'sr-only' }, 'Search filaments'), svg('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
        el('input', { type: 'search', placeholder: 'Brand, name or colour', value: S.cq, oninput: (e) => { S.cq = e.target.value; S.cshown = 120; clearTimeout(S.t); S.t = setTimeout(() => { render(); const i = root.querySelector('input[type=search]'); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); }, 180); } })),
      el('label', { class: 'select-wrap small' }, el('span', { class: 'sr-only' }, 'Brand'), el('select', { onchange: (e) => { S.cbrand = e.target.value; S.cshown = 120; render(); } }, el('option', { value: '' }, 'Every brand'), brands.map((b) => el('option', { value: b, selected: S.cbrand === b }, b)))),
      el('label', { class: 'select-wrap small' }, el('span', { class: 'sr-only' }, 'Material'), el('select', { onchange: (e) => { S.cmat = e.target.value; S.cshown = 120; render(); } }, el('option', { value: '' }, 'Every material'), Object.keys(GUIDE).map((k) => el('option', { value: k, selected: S.cmat === k }, GUIDE[k].name)))),
      el('label', { class: 'select-wrap small' }, el('span', { class: 'sr-only' }, 'Diameter'), el('select', { onchange: (e) => { S.cdia = e.target.value; S.cshown = 120; render(); } }, [['1.75', '1.75 mm'], ['2.85', '2.85 mm'], ['', 'Any diameter']].map(([v, l]) => el('option', { value: v, selected: S.cdia === v }, l))))),
    colourBar(S.cf.fil, base, () => { S.cshown = 120; render(); }),
    el('p', { class: 'muted' }, `${list.length.toLocaleString()} filament${list.length === 1 ? '' : 's'}${S.cf.fil.picks.length ? ` close to ${S.cf.fil.picks.join(' and ')}` : ''}`),
    list.length ? el('div', { class: 'fgrid' }, list.slice(0, S.cshown).map(catTile)) : emptyBox('Nothing matches. Try another brand or material.'),
    list.length > S.cshown ? el('div', { class: 'pmore' }, btn(`Show more (${(list.length - S.cshown).toLocaleString()} left)`, () => { S.cshown += 240; render(); })) : '');
}
function renderGuide(root) {
  const resin = S.gkind === 'resin';
  const pick = el('div', { class: 'seg guide-kind', role: 'group', 'aria-label': 'Material' },
    [['filament', 'Filament'], ['resin', 'Resin']].map(([k, l]) => el('button', { type: 'button', 'aria-pressed': String((S.gkind || 'filament') === k), onclick: () => { S.gkind = k; render(); } }, l)));
  if (resin) return renderResinGuide(root, pick);
  const ps = fdmPrinters();
  put(root,
    head('Material guide', 'Typical temperatures and what each material needs. Always check the spool or bottle: makers differ.', pick),
    el('div', { class: 'guide' }, Object.entries(GUIDE).filter(([k]) => k !== 'Other').map(([k, g]) => el('article', { class: 'gcard' },
      el('h3', {}, g.name),
      el('dl', { class: 'paint-facts gfacts' },
        el('div', { class: 'pf-row' }, el('dt', {}, 'Nozzle'), el('dd', { class: 'mono' }, `${g.nozzle[0]}–${g.nozzle[1]} °C`)),
        el('div', { class: 'pf-row' }, el('dt', {}, 'Bed'), el('dd', { class: 'mono' }, `${g.bed[0]}–${g.bed[1]} °C`)),
        el('div', { class: 'pf-row' }, el('dt', {}, 'Needs'), el('dd', {}, [g.enclosure && 'enclosure', g.allMetal && 'all-metal hotend', g.flexible && 'slow printing', g.dry && 'dry storage', g.fumes && 'ventilation'].filter(Boolean).join(', ') || 'nothing special'))),
      el('p', {}, g.note),
      el('div', { class: 'cchips' }, ps.map((p) => { const c = compat(p, { material: k, name: g.name }); return el('button', { type: 'button', class: `cchip ${c.level}`, title: c.why.join(' '), onclick: () => explain(p, { material: k, name: g.name }, c) }, `${p.name}: ${{ ok: 'prints well', care: 'with care', no: 'can\'t print' }[c.level]}`); }))))));
}
function renderResinGuide(root, pick) {
  const rp = resinPrinters();
  const mine = (k) => S.mats.filter((m) => m.kind === 'resin' && resinKey(m) === k).length;
  put(root,
    head('Material guide', 'Starting points for each kind of resin on a modern mono LCD printer at 0.05 mm layers. Every resin and printer differs: run an exposure test with each new bottle.', pick),
    !rp.length && el('p', { class: 'muted' }, 'Add your resin printer in Tools and each resin shows how it suits your printer.'),
    el('div', { class: 'guide' }, Object.entries(RESIN_GUIDE).map(([k, g]) => el('article', { class: 'gcard' },
      el('h3', {}, g.name, mine(k) ? el('small', { class: 'own-tag gown' }, `${mine(k)} in your resins`) : ''),
      el('p', { class: 'muted guse' }, g.use),
      el('dl', { class: 'paint-facts gfacts' },
        el('div', { class: 'pf-row' }, el('dt', {}, 'Exposure'), el('dd', { class: 'mono' }, resinRange(g.exp, 's'))),
        el('div', { class: 'pf-row' }, el('dt', {}, 'Bottom layers'), el('dd', { class: 'mono' }, resinRange(g.bottom, 's'))),
        el('div', { class: 'pf-row' }, el('dt', {}, 'Resin warm to'), el('dd', { class: 'mono' }, resinRange(g.temp, '°C'))),
        el('div', { class: 'pf-row' }, el('dt', {}, 'Wash'), el('dd', {}, `${g.wash === 'water' ? 'Water' : 'IPA'}, ${resinRange(g.washMin, 'min')}`)),
        el('div', { class: 'pf-row' }, el('dt', {}, 'UV cure'), el('dd', {}, `${resinRange(g.cure, 'min')}${g.heatCure ? ' plus heat' : ''}`)),
        el('div', { class: 'pf-row' }, el('dt', {}, 'Needs'), el('dd', {}, [g.thick && 'warmth', g.flexible && 'slow lifts', g.fine && 'a high-resolution screen', g.dryFirst && 'drying before curing', g.castable && 'a kiln to cast', g.heatCure && 'an oven post-cure', g.clear && 'clean IPA'].filter(Boolean).join(', ') || 'nothing special'))),
      el('p', {}, g.note),
      el('div', { class: 'cchips' }, rp.map((p) => { const f = { kind: 'resin', material: k, name: `${g.name} resin` }; const c = resinCompat(p, f); return el('button', { type: 'button', class: `cchip ${c.level}`, title: c.why.join(' '), onclick: () => explain(p, f, c) }, `${p.name}: ${c.level === 'ok' ? 'prints it' : 'with care'}`); }))))),
    el('div', { class: 'guide' },
      el('article', { class: 'gcard' }, el('h3', {}, 'Dialling in a new resin'),
        el('p', {}, 'Print an exposure test (such as the AmeraLabs Town, Cones of Calibration or a resin exposure range finder) at three or four exposures around the starting point. Pick the one where fine details are sharp and holes stay open.'),
        el('p', { class: 'muted' }, 'Too little exposure: soft, missing details, prints that fall off the supports. Too much: details blur, holes close up, parts come out slightly too big.')),
      el('article', { class: 'gcard' }, el('h3', {}, 'Common problems'),
        el('dl', { class: 'paint-facts gfacts' },
          el('div', { class: 'pf-row' }, el('dt', {}, 'Nothing on the plate'), el('dd', {}, 'Level the plate, add bottom exposure, warm the resin.')),
          el('div', { class: 'pf-row' }, el('dt', {}, 'Layer lines, splits'), el('dd', {}, 'Slow the lift, add supports, check the FEP is tight.')),
          el('div', { class: 'pf-row' }, el('dt', {}, 'Cracks days later'), el('dd', {}, 'Dry fully before curing, don\'t over-cure, hollow thick parts with drain holes.')),
          el('div', { class: 'pf-row' }, el('dt', {}, 'Sticky or tacky'), el('dd', {}, 'Fresher IPA, a second wash, a little more curing.')))),
      el('article', { class: 'gcard' }, el('h3', {}, 'Staying safe'),
        el('p', {}, 'Uncured resin irritates skin and lungs, and an allergy can build up over time: wear nitrile gloves and eye protection every time, and print in a ventilated room.'),
        el('p', { class: 'muted' }, 'Keep resin out of the sun and away from children and pets. Never pour resin, dirty IPA or wash water down the drain: cure it in the sun first, then throw it away with the rest of the rubbish.'))));
}

// ---------- tools ----------
const SIZES = ['20/0', '10/0', '5/0', '3/0', '2/0', '0', '1', '2', '3', '4', '5', '6', '8', '10', '12', 'Small', 'Medium', 'Large'];
const sel = (key, label, options) => ({ key, label, type: 'select', options });
const num = (key, label, step = 1) => ({ key, label, type: 'number', step });
const txt = (key, label, ph = '') => ({ key, label, type: 'text', ph });
const chk = (key, label) => ({ key, label, type: 'check' });
const dat = (key, label) => ({ key, label, type: 'date' });
const only = (f, type) => ({ ...f, only: type });
export const CATS = {
  printer: { label: '3D printers', one: 'printer', group: 'printing', icon: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 8h16M10 8v5l2 2 2-2V8"/>', fields: [sel('type', 'Type', ['FDM', 'Resin']), txt('build', 'Build volume (mm)', '220 × 220 × 250'), num('nozzle', 'Nozzle (mm)', 0.05), sel('nozzleMat', 'Nozzle material', ['Brass', 'Hardened steel', 'Stainless steel', 'Ruby', 'Tungsten carbide', 'Copper']), num('maxNozzle', 'Max nozzle °C'), num('maxBed', 'Max bed °C'), sel('hotend', 'Hotend', ['PTFE-lined', 'All-metal']), sel('extruder', 'Extruder', ['Bowden', 'Direct drive']), sel('diameter', 'Filament', ['1.75', '2.85']), txt('kinematics', 'Kinematics', 'Bed slinger, CoreXY, Delta…'), chk('enclosure', 'Has an enclosure'), txt('levelling', 'Bed levelling', 'Manual, BLTouch, CR Touch…'), txt('surface', 'Build surface'), txt('firmware', 'Firmware'),
    only(txt('screen', 'Screen', 'e.g. 12K (11520 × 5120)'), 'Resin'), only(num('xy', 'Pixel size (µm)', 0.1), 'Resin'), only(txt('file', 'Slice file type', '.goo, .ctb, .pwmx…'), 'Resin'), only(chk('heater', 'Heated vat or chamber'), 'Resin')].map((f) => (['nozzle', 'nozzleMat', 'maxNozzle', 'maxBed', 'hotend', 'extruder', 'diameter', 'kinematics', 'enclosure', 'levelling', 'surface'].includes(f.key) ? only(f, 'FDM') : f)) },
  nozzle: { label: 'Nozzles', one: 'nozzle', group: 'printing', icon: '<path d="M8 3h8v5l-2 3v4l-2 3-2-3v-4L8 8z"/>', fields: [sel('size', 'Size (mm)', ['0.2', '0.25', '0.4', '0.5', '0.6', '0.8', '1.0']), sel('nozzleMat', 'Material', ['Brass', 'Hardened steel', 'Stainless steel', 'Ruby', 'Tungsten carbide', 'Copper']), txt('fits', 'Fits', 'e.g. MK8 / Ender 3 V2')] },
  plate: { label: 'Build plates', one: 'build plate', group: 'printing', icon: '<path d="M3 15l9 4 9-4-9-4z"/><path d="M3 15v2l9 4 9-4v-2"/>', fields: [sel('surface', 'Surface', ['Textured PEI', 'Smooth PEI', 'Glass', 'Carborundum glass', 'Magnetic sticker', 'G10 / Garolite', 'Other']), txt('size', 'Size', '235 × 235 mm')] },
  part: { label: 'Spare parts and upgrades', one: 'part', group: 'printing', icon: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>', fields: [txt('fits', 'For', 'e.g. Ender 3'), chk('installed', 'Fitted')] },
  dryer: { label: 'Filament dryers and storage', one: 'dryer', group: 'printing', icon: '<rect x="3" y="6" width="18" height="12" rx="3"/><circle cx="9" cy="12" r="3"/><path d="M15 10h3M15 14h3"/>', fields: [num('maxTemp', 'Max °C'), num('spools', 'Spools it holds')] },
  washcure: { label: 'Wash and cure', one: 'wash and cure station', group: 'printing', icon: '<path d="M6 4h12l-1 16H7z"/><path d="M9 9h6"/>', fields: [] },
  printtool: { label: 'Printing hand tools', one: 'tool', group: 'printing', icon: '<path d="M14 4l6 6-9 9H5v-6z"/>', fields: [sel('toolType', 'Kind', ['Scraper / spatula', 'Flush cutters', 'Deburring tool', 'Calipers', 'Nozzle cleaning', 'Tweezers', 'Wrench / hex keys', 'Other'])] },
  post: { label: 'Post-processing', one: 'item', group: 'printing', icon: '<path d="M4 20l7-7M14 4l6 6-6 2-2 6-6-6 6-2z"/>', fields: [sel('toolType', 'Kind', ['Sandpaper', 'Files', 'Filler / putty', 'Glue', 'Primer / filler spray', 'Heat gun', 'Rotary tool', 'Other']), txt('grit', 'Grit or size')] },
  airbrush: { label: 'Airbrushes', one: 'airbrush', group: 'painting', icon: '<path d="M3 13h9l3-3h4l2 2-2 2h-4l-3 3H6z"/><path d="M12 10V6h3"/>', fields: [txt('model', 'Model'), sel('needle', 'Needle (mm)', ['0.15', '0.18', '0.2', '0.25', '0.3', '0.35', '0.4', '0.5', '0.8']), sel('feed', 'Feed', ['Gravity', 'Side feed', 'Siphon / bottom feed']), sel('action', 'Action', ['Dual action', 'Single action', 'Trigger']), num('cup', 'Cup (ml)')] },
  compressor: { label: 'Compressors', one: 'compressor', group: 'painting', icon: '<rect x="3" y="9" width="14" height="9" rx="3"/><path d="M17 12h3v3h-3M7 9V6h4v3"/>', fields: [num('tank', 'Tank (litres)'), num('maxBar', 'Max pressure (bar)', 0.1), chk('trap', 'Moisture trap'), chk('regulator', 'Pressure regulator')] },
  brush: { label: 'Brushes', one: 'brush', group: 'painting', icon: '<path d="M14 3l7 7-6 6-4-4z"/><path d="M11 12l-6 6c-1 1-2 3-2 3s2-1 3-2l6-6"/>', fields: [txt('series', 'Series', 'e.g. Series 7, Artis Opus S'), sel('size', 'Size', SIZES), sel('shape', 'Shape', ['Round', 'Detail / liner', 'Flat', 'Filbert', 'Drybrush', 'Fan', 'Glaze / wash', 'Other']), sel('hair', 'Hair', ['Kolinsky sable', 'Sable', 'Synthetic', 'Hog / bristle', 'Mixed', 'Other'])] },
  mask: { label: 'Masks and safety', one: 'item', group: 'both', icon: '<path d="M4 9c0-2 2-4 8-4s8 2 8 4v3c0 4-4 7-8 7s-8-3-8-7z"/><circle cx="8.5" cy="13" r="1.5"/><circle cx="15.5" cy="13" r="1.5"/>', fields: [sel('maskType', 'Kind', ['Half-mask respirator', 'Full-face respirator', 'Dust mask (FFP2/FFP3)', 'Nitrile gloves', 'Safety glasses', 'Apron', 'Other']), txt('filter', 'Filter', 'e.g. A1P2, ABEK1P3'), dat('filterChanged', 'Filter changed')] },
  masking: { label: 'Masking', one: 'masking item', group: 'painting', icon: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 7v10M17 7v10"/>', fields: [sel('maskingType', 'Kind', ['Masking tape', 'Liquid mask', 'Masking putty', 'Stencil', 'Other']), txt('width', 'Width or size')] },
  palette: { label: 'Palettes', one: 'palette', group: 'painting', icon: '<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-2 0-3 4 0 5-2a9 9 0 0 0-7-11z"/>', fields: [sel('paletteType', 'Kind', ['Wet palette', 'Ceramic', 'Plastic', 'Disposable paper', 'Other'])] },
  booth: { label: 'Spray booth and extraction', one: 'booth', group: 'painting', icon: '<rect x="3" y="4" width="18" height="14" rx="2"/><circle cx="12" cy="11" r="4"/>', fields: [txt('fan', 'Fan / airflow'), txt('boothFilter', 'Filter')] },
  light: { label: 'Light and magnification', one: 'lamp', group: 'both', icon: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10c1 1 1 2 1 3h6c0-1 0-2 1-3a6 6 0 0 0-4-10z"/>', fields: [] },
  hobby: { label: 'Hobby tools', one: 'tool', group: 'painting', icon: '<path d="M4 20l9-9M13 5l6 6-3 3-6-6z"/>', fields: [sel('toolType', 'Kind', ['Hobby knife', 'Sprue cutters', 'Files', 'Sculpting tools', 'Tweezers', 'Pin vise / drill', 'Clamp / holder', 'Cutting mat', 'Other'])] },
  other: { label: 'Other', one: 'item', group: 'both', icon: '<circle cx="6" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/>', fields: [] },
};
const CONDITIONS = ['New', 'Good', 'Worn', 'Needs replacing', 'Retired'];
const fieldsFor = (c, t) => (CATS[c] || CATS.other).fields.filter((f) => !f.only || f.only === ((t.type || 'FDM')));
function specList(t) {
  const c = { fields: fieldsFor(t.cat, t) };
  return c.fields.filter((f) => f.type !== 'check' && t[f.key] != null && t[f.key] !== '').map((f) => (f.type === 'number' ? `${f.label.replace(/ \(.*\)$/, '')} ${t[f.key]}${/°C/.test(f.label) ? '' : /\((mm|ml|litres|bar)\)/.exec(f.label)?.[1] ? ` ${/\((mm|ml|litres|bar)\)/.exec(f.label)[1]}` : ''}` : f.key === 'size' && t.cat === 'brush' ? `size ${t[f.key]}` : f.key === 'needle' ? `${t[f.key]} mm needle` : f.key === 'diameter' ? `${t[f.key]} mm filament` : f.key === 'xy' ? `${t[f.key]} µm pixels` : String(t[f.key])))
    .concat(c.fields.filter((f) => f.type === 'check' && t[f.key]).map((f) => f.label.toLowerCase()));
}
const specLine = (t) => specList(t).join(' · ');

// ---------- upkeep, what a tool is good for, and links ----------
const isRespirator = (t) => t.cat === 'mask' && /respirator/i.test(t.maskType || '');
/** What regular care this tool needs: { every (days), what } or null. Your own interval (0 = never) wins. */
function serviceOf(t) {
  const base = t.cat === 'printer' ? ((t.type || 'FDM') === 'Resin'
    ? { every: 30, what: 'Check the FEP film for dents and clouding, clean the vat and screen, and grease the Z screw.' }
    : { every: 90, what: 'Clean and oil the rods or rails, check belt tension, tighten loose wheels and screws, and clean the nozzle and fans.' })
    : t.cat === 'airbrush' ? { every: 30, what: 'Strip it and deep clean; check the needle tip and nozzle seal.' }
      : t.cat === 'compressor' ? { every: 30, what: 'Drain the tank and the moisture trap.' }
        : isRespirator(t) ? { every: 180, what: 'Change the filters (sooner if you can smell fumes through them).' }
          : t.cat === 'booth' ? { every: 180, what: 'Change the filter.' }
            : t.cat === 'washcure' ? { every: 30, what: 'Filter or replace the wash liquid.' }
              : t.cat === 'dryer' ? { every: 180, what: 'Recharge or replace the desiccant.' }
                : null;
  if (t.serviceEvery != null && t.serviceEvery !== '') { const n = Number(t.serviceEvery); return n > 0 ? { every: n, what: base?.what || 'Service it.' } : null; }
  return base;
}
const lastService = (t) => t.lastService || (isRespirator(t) ? t.filterChanged : '') || '';
const daysSince = (d) => Math.floor((Date.now() - new Date(`${d}T00:00:00`).getTime()) / 864e5);
/** 'due' | 'soon' | 'ok' | 'unknown' | null (needs no upkeep). */
function serviceState(t) {
  const sv = serviceOf(t);
  if (!sv || t.condition === 'Retired') return null;
  const last = lastService(t);
  if (!last) return 'unknown';
  const d = daysSince(last);
  return d >= sv.every ? 'due' : d >= sv.every * 0.85 ? 'soon' : 'ok';
}
const ago = (d) => { const n = daysSince(d); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n < 60 ? `${n} days ago` : n < 730 ? `${Math.round(n / 30)} months ago` : `${Math.round(n / 365)} years ago`; };
const needsReplacing = (t) => ['Worn', 'Needs replacing'].includes(t.condition);
/** One line on what this tool is best used for. */
function goodFor(t) {
  if (t.cat === 'airbrush' && t.needle) { const n = Number(t.needle); return n <= 0.2 ? 'Fine detail and thin layers. Thin the paint well; too fine for primer and metallics.' : n < 0.4 ? 'All-rounder: base coats, zenithal highlights and some detail.' : 'Primer, varnish, metallics and big areas.'; }
  if (t.cat === 'nozzle' && t.size) { const n = Number(t.size); const hard = /hardened|steel|ruby|carbide/i.test(t.nozzleMat || ''); return `${n <= 0.25 ? 'Fine detail and small text; slow, and not for filled filament.' : n <= 0.5 ? 'The all-rounder.' : 'Fast, strong prints with thick layers; best for filled filament.'}${hard ? ' Safe for abrasive filament (carbon fibre, glow, metal fill).' : ' Brass wears quickly with abrasive filament.'}`; }
  if (t.cat === 'brush') {
    if (t.shape === 'Drybrush') return 'Drybrushing: raised edges and texture.';
    if (t.shape === 'Glaze / wash') return 'Washes, shades and glazes.';
    if (t.shape === 'Flat') return 'Big flat areas, vehicles and terrain.';
    const i = SIZES.indexOf(String(t.size));
    if (i < 0) return '';
    return i <= 3 ? 'Eyes, freehand and the finest lines.' : i <= 5 ? 'Detail and edge highlights.' : i <= 7 ? 'Layering and most miniature work.' : i <= 14 ? 'Base coats and larger areas.' : '';
  }
  if (t.cat === 'mask') {
    if (/dust/i.test(t.maskType || '')) return 'Sanding dust only: it does not stop resin or spray fumes.';
    if (isRespirator(t)) return /\bA\d|organic|ABEK/i.test(t.filter || '') ? 'Resin fumes, spray cans and airbrushing lacquers or enamels.' : 'For resin and spray fumes it needs organic vapour (A-class) filters.';
    if (/glove/i.test(t.maskType || '')) return 'Handling uncured resin and solvents.';
  }
  if (t.cat === 'compressor') return `Miniatures spray at about 1 to 2 bar (15 to 30 psi).${t.trap ? '' : ' Without a moisture trap, water can spit into the paint.'}`;
  if (t.cat === 'plate') return { 'Textured PEI': 'PLA and PETG release when cool; hides first-layer marks.', 'Smooth PEI': 'Glossy bottoms. PETG and TPU can bond too well: use glue stick as a release layer.', Glass: 'Very flat, mirror finish; let it cool so the print pops off.', 'Carborundum glass': 'Grips when hot, releases when cool. Good for PLA and PETG.' }[t.surface] || '';
  return '';
}
const SITES = {
  creality: 'creality.com', 'bambu lab': 'bambulab.com', prusa: 'prusa3d.com', elegoo: 'elegoo.com', anycubic: 'anycubic.com', phrozen: 'phrozen3d.com', sovol: 'sovol3d.com', qidi: 'qidi3d.com', voron: 'vorondesign.com',
  artillery: 'artillery3d.com', flashforge: 'flashforge.com', snapmaker: 'snapmaker.com', ultimaker: 'ultimaker.com', ratrig: 'ratrig.com', formlabs: 'formlabs.com', lulzbot: 'lulzbot.com', geeetech: 'geeetech.com', kingroon: 'kingroon.com',
  flsun: 'flsun3d.com', raise3d: 'raise3d.com', peopoly: 'peopoly.net', 'micro swiss': 'micro-swiss.com', antclabs: 'antclabs.com', 'raspberry pi': 'raspberrypi.com', sunlu: 'sunlu.com', polymaker: 'polymaker.com', esun: 'esun3d.com',
  'harder & steenbeck': 'harder-airbrush.de', iwata: 'iwata-airbrush.com', badger: 'badgerairbrush.com', sparmax: 'sparmaxair.com', paasche: 'paascheairbrush.com', 'gsi creos (mr. hobby)': 'mr-hobby.com', '3m': '3m.com', gvs: 'gvs.com',
  'winsor & newton': 'winsornewton.com', 'rosemary & co': 'rosemaryandco.com', 'artis opus': 'artisopus.com', 'the army painter': 'thearmypainter.com', citadel: 'citadelcolour.com', princeton: 'princetonbrush.com', 'da vinci': 'davinci-defet.com',
  tamiya: 'tamiya.com', vallejo: 'acrylicosvallejo.com', humbrol: 'humbrol.com', xuron: 'xuron.com',
};
const searchUrl = (t) => `https://www.google.com/search?q=${encodeURIComponent([t.brand, t.name].filter(Boolean).join(' '))}`;
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : u && /^[\w.-]+\.[a-z]{2,}/i.test(u) ? `https://${u}` : '');
function toolLinks(t) {
  const out = (label, href) => el('a', { class: 'link-inline', href, target: '_blank', rel: 'noopener noreferrer' }, label);
  const site = SITES[(t.brand || '').trim().toLowerCase()];
  return el('div', { class: 'tlinks' }, safeUrl(t.url) && out('Product page', safeUrl(t.url)), site && out(`${t.brand} website`, `https://${site}`), out('Search online', searchUrl(t)));
}
/** Open another tab of the app. */
const goTab = (tab) => document.querySelector(`#tab-${tab}`)?.click();
async function goAirbrushPaints() {
  try { const P = await import('./paints.js'); P.S.sel.how.clear(); P.S.sel.how.add('Airbrush'); P.S.section = 'catalogue'; goTab('paints'); } catch (e) { h.fail(e); }
}
async function logService(t, text) {
  const entry = { d: today(), t: text };
  S.tools = S.tools.map((x) => (x.id === t.id ? { ...x, lastService: today(), ...(isRespirator(x) ? { filterChanged: today() } : {}), log: [entry, ...(x.log || [])].slice(0, 40) } : x));
  await save('tools'); h.toast(`${t.name}: logged for today`); render();
}
function addNote(t) {
  let d;
  const ta = el('textarea', { name: 'text', rows: 3, required: true, placeholder: t.cat === 'printer' ? 'e.g. Replaced the PTFE tube, re-levelled the bed' : 'e.g. New needle fitted' });
  const date = el('input', { type: 'date', name: 'date', value: today() });
  const svc = el('input', { type: 'checkbox', name: 'svc' });
  const f = el('form', { class: 'sheet-body stack', onsubmit: async (e) => {
    e.preventDefault();
    const entry = { d: date.value || today(), t: ta.value.trim() };
    if (!entry.t) return;
    S.tools = S.tools.map((x) => (x.id === t.id ? { ...x, ...(svc.checked ? { lastService: entry.d, ...(isRespirator(x) ? { filterChanged: entry.d } : {}) } : {}), log: [entry, ...(x.log || [])].sort((a, b) => b.d.localeCompare(a.d)).slice(0, 40) } : x));
    await save('tools'); d.close(); render();
  } },
    field('What you did', ta), field('When', date),
    serviceOf(t) && el('label', { class: 'check' }, svc, el('span', {}, 'This counts as its regular service')),
    el('div', { class: 'form-actions' }, el('button', { class: 'btn primary', type: 'submit' }, 'Add to history'), el('button', { class: 'btn ghost', type: 'button', onclick: () => d.close() }, 'Cancel')));
  d = dialog(`${t.name}: add to history`, null, f);
  ta.focus();
}
/** Swap the nozzle on a printer: it changes what the Materials tab says the printer can print. */
function changeNozzle(p) {
  let d;
  const sizes = ['0.2', '0.25', '0.4', '0.5', '0.6', '0.8', '1.0'], mats = ['Brass', 'Hardened steel', 'Stainless steel', 'Ruby', 'Tungsten carbide', 'Copper'];
  const size = el('select', { class: 'set-select' }, sizes.map((x) => el('option', { value: x, selected: Number(p.nozzle) === Number(x) }, `${x} mm`)));
  const mat = el('select', { class: 'set-select' }, mats.map((x) => el('option', { value: x, selected: p.nozzleMat === x }, x)));
  const mine = S.tools.filter((t) => t.cat === 'nozzle' && t.size);
  const f = el('form', { class: 'sheet-body stack', onsubmit: async (e) => {
    e.preventDefault();
    const entry = { d: today(), t: `Fitted a ${size.value} mm ${mat.value.toLowerCase()} nozzle` };
    S.tools = S.tools.map((x) => (x.id === p.id ? { ...x, nozzle: Number(size.value), nozzleMat: mat.value, log: [entry, ...(x.log || [])].slice(0, 40) } : x));
    await save('tools'); d.close(); h.toast(`${p.name} now has a ${size.value} mm ${mat.value.toLowerCase()} nozzle`); render();
  } },
    mine.length ? el('div', { class: 'field' }, el('span', {}, 'Your nozzles'), el('div', { class: 'size-ticks' }, mine.map((n) => el('button', { type: 'button', class: 'btn small ghost', onclick: () => { size.value = String(n.size); if (n.nozzleMat) mat.value = n.nozzleMat; } }, `${n.size} mm ${n.nozzleMat || ''}`.trim())))) : '',
    el('div', { class: 'two' }, field('Size', size), field('Material', mat)),
    el('p', { class: 'muted' }, 'A hardened nozzle lets the printer take abrasive filament (carbon fibre, glow, metal and wood fill) without a warning in Materials.'),
    el('div', { class: 'form-actions' }, el('button', { class: 'btn primary', type: 'submit' }, 'Fit this nozzle'), el('button', { class: 'btn ghost', type: 'button', onclick: () => d.close() }, 'Cancel')));
  d = dialog(`Change the nozzle on ${p.name}`, `Now: ${p.nozzle || '?'} mm ${String(p.nozzleMat || '').toLowerCase()}`, f);
}
// ---------- lists to pick tools from: printers (OrcaSlicer and UVtools profiles), painting tools, brushes ----------
let tcatReady = null;
function loadToolCatalogue() {
  if (!tcatReady) {
    tcatReady = fetch('/tools/catalogue.json').then((r) => { if (!r.ok) throw new Error('The tool list could not be loaded.'); return r.json(); }).then((d) => { S.tcat = d; return d; });
    tcatReady.catch(() => { tcatReady = null; });
  }
  return tcatReady;
}
/** Catalogue entries for a kind of tool, as { label, sub, fill } where fill is what goes into the form. */
function catalogueFor(cat) {
  const d = S.tcat;
  if (!d) return [];
  if (cat === 'printer') {
    return [
      ...d.fdm.map((p) => ({ label: `${p.b} ${p.n}`, sub: ['FDM', p.build && `${p.build} mm`, p.k, p.fw].filter(Boolean).join(' · '), fill: { type: 'FDM', brand: p.b, name: p.n, build: p.build, nozzle: p.nz?.includes(0.4) ? 0.4 : p.nz?.[0] ?? 0.4, nozzleMat: p.nm || 'Brass', extruder: p.ex || '', firmware: p.fw || '', kinematics: p.k || '', diameter: '1.75', notes: p.mm ? 'Prints with more than one nozzle or tool.' : '' } })),
      ...d.resin.map((p) => ({ label: `${p.b} ${p.n}`, sub: ['Resin', p.build && `${p.build} mm`, p.screen].filter(Boolean).join(' · '), fill: { type: 'Resin', brand: p.b, name: p.n, build: p.build, screen: p.screen || '', xy: p.xy ?? null, file: p.file || '' } })),
    ];
  }
  if (cat === 'brush') return d.brushes.map((b) => ({ label: `${b.b} ${b.n}`, sub: [b.shape, b.hair, (b.named || b.sizes).join(', ')].filter(Boolean).join(' · '), fill: { brand: b.b, series: b.n, shape: b.shape, hair: b.hair, name: `${b.b} ${b.n}` }, sizes: b.named || b.sizes, named: !!b.named }));
  return d.items.filter((x) => x.cat === cat).map((x) => ({ label: `${x.b === 'Generic' ? '' : `${x.b} `}${x.n}`, sub: Object.entries(x.f).filter(([k, v]) => v && k !== 'notes').map(([k, v]) => (v === true ? k.replace(/([A-Z])/g, ' $1').toLowerCase() : `${v}${k === 'cup' ? ' ml cup' : k === 'needle' ? ' mm needle' : k === 'tank' ? ' L tank' : k === 'spools' ? ' spool(s)' : ''}`)).join(' · '), fill: { brand: x.b === 'Generic' ? '' : x.b, name: x.n, ...x.f } }));
}
function editTool(item = null, cat = 'brush', prefill = null) {
  const it = item ? { ...item } : { cat, qty: 1, condition: 'New', bought: today(), ...(prefill || {}) };
  let d;
  // Brush series picked from the list: tick every size you have and each becomes its own brush.
  const sizes = !item && prefill?._sizes;
  const extra = el('div', { class: 'stack' });
  const drawExtra = (c) => {
    const def = fieldsFor(c, it).filter((f) => !(sizes && f.key === 'size'));
    extra.replaceChildren(...def.map((f) => f.type === 'check'
      ? el('label', { class: 'check' }, el('input', { type: 'checkbox', name: f.key, checked: !!it[f.key] }), el('span', {}, f.label))
      : field(f.label, f.type === 'select'
        ? el('select', { name: f.key, class: 'set-select', onchange: f.key === 'type' && c === 'printer' ? (e) => { Object.assign(it, Object.fromEntries(new FormData(e.target.form)), { type: e.target.value }); drawExtra(c); } : null },
          el('option', { value: '' }, '—'), [...f.options, ...(it[f.key] != null && it[f.key] !== '' && !f.options.includes(String(it[f.key])) ? [String(it[f.key])] : [])].map((o) => el('option', { value: o, selected: String(it[f.key] ?? '') === o }, o)))
        : el('input', { name: f.key, type: f.type, step: f.step, value: it[f.key] ?? '', placeholder: f.ph || '' }))));
    drawFinder(c);
  };
  // "Find it in the list"
  const finder = el('div', { class: 'tfind' });
  let fq = '', expanded = !prefill?._from;
  const drawFinder = (c) => {
    if (item) { finder.hidden = true; return; }
    if (!expanded) {
      finder.hidden = false;
      finder.replaceChildren(el('p', { class: 'tfind-picked' }, 'From the list: ', el('b', {}, prefill._from), ' ', el('button', { type: 'button', class: 'link-inline', onclick: () => { expanded = true; drawFinder(c); finder.querySelector('input')?.focus(); } }, 'Pick another')));
      return;
    }
    if (!S.tcat) { finder.replaceChildren(el('p', { class: 'muted' }, 'Loading the list…')); loadToolCatalogue().then(() => drawFinder(c), () => { finder.hidden = true; }); return; }
    const all = catalogueFor(c);
    finder.hidden = !all.length;
    if (!all.length) return;
    const words = fq.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const hits = all.filter((x) => words.every((w) => `${x.label} ${x.sub}`.toLowerCase().replace(/-/g, ' ').includes(w.replace(/-/g, ' '))));
    const results = el('div', { class: 'tfind-results', role: 'list' }, (words.length ? hits.slice(0, 12) : hits.slice(0, c === 'printer' ? 0 : 12)).map((x) => el('button', { type: 'button', role: 'listitem', class: 'tfind-row', onclick: () => {
      d.close();
      editTool(null, c, { ...x.fill, cat: c, _from: x.label, ...(x.sizes?.length ? { _sizes: x.sizes, _named: x.named } : {}) });
    } }, el('b', {}, x.label), el('small', { class: 'muted' }, x.sub))));
    const input = el('input', { type: 'search', value: fq, placeholder: c === 'printer' ? `Search ${S.tcat.fdm.length} FDM and ${S.tcat.resin.length} resin printers, e.g. Ender 3` : c === 'brush' ? 'Search brush ranges, e.g. Series 7' : `Search ${all.length} in the list`, oninput: (e) => { fq = e.target.value; const pos = e.target.selectionStart; drawFinder(c); const i = finder.querySelector('input'); i.focus(); i.setSelectionRange(pos, pos); } });
    finder.replaceChildren(el('label', { class: 'field' }, el('span', {}, 'Find it in the list'), input),
      results,
      words.length && !hits.length ? el('p', { class: 'muted' }, 'Not in the list: fill it in below.') : '',
      words.length > 0 && hits.length > 12 ? el('p', { class: 'muted' }, `${hits.length - 12} more: keep typing to narrow it down.`) : '');
  };
  const catSel = el('select', { name: 'cat', class: 'set-select', onchange: (e) => { fq = ''; drawExtra(e.target.value); } },
    [['printing', '3D printing'], ['painting', 'Painting'], ['both', 'Both']].map(([g, l]) => el('optgroup', { label: l }, Object.entries(CATS).filter(([, c]) => c.group === g).map(([k, c]) => el('option', { value: k, selected: it.cat === k }, c.label)))));
  const f = el('form', { class: 'sheet-body stack', onsubmit: async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    const def = CATS[v.cat] || CATS.other;
    const out = { ...it, ...v };
    for (const fd of def.fields) { if (fd.type === 'check') out[fd.key] = !!v[fd.key]; if (fd.type === 'number') out[fd.key] = n0(v[fd.key]); }
    out.qty = n0(v.qty) ?? 1; out.price = n0(v.price); out.restock = !!v.restock; out.serviceEvery = n0(v.serviceEvery);
    for (const k of ['_sizes', '_named', '_from', 'sizes']) delete out[k];
    if (!out.name?.trim()) { h.toast('Give it a name.', true); return; }
    if (sizes) {
      const picked = [...f.querySelectorAll('input[name=sizes]:checked')].map((x) => x.value);
      if (!picked.length) { h.toast('Tick the sizes you have.', true); return; }
      for (const sz of picked) S.tools.push({ ...out, size: sz, name: prefill._named ? `${out.name} ${sz}` : `${out.name} size ${sz}`, id: uid(), added: Date.now() });
      await save('tools'); d.close(); h.toast(`Added ${picked.length} brush${picked.length === 1 ? '' : 'es'}`); render(); return;
    }
    if (item) S.tools = S.tools.map((x) => (x.id === item.id ? out : x)); else S.tools.push({ ...out, id: uid(), added: Date.now() });
    await save('tools'); d.close(); h.toast(item ? 'Saved' : `Added ${out.name}`); render();
  } },
    field('What it is', catSel),
    finder,
    sizes && el('div', { class: 'field' }, el('span', {}, prefill._named ? 'Which ones you have' : 'Sizes you have'),
      el('div', { class: 'size-ticks' }, sizes.map((sz) => el('label', { class: 'size-tick' }, el('input', { type: 'checkbox', name: 'sizes', value: sz }), el('span', {}, sz)))),
      el('small', { class: 'muted' }, 'Each one you tick is added as its own brush.')),
    el('div', { class: 'two' }, field('Name', el('input', { name: 'name', required: true, value: it.name || '', placeholder: 'e.g. Ender 3, Harder & Steenbeck Infinity, Size 1 round' })), field('Brand', el('input', { name: 'brand', value: it.brand || '' }))),
    extra,
    el('div', { class: 'three-col' },
      field('How many', el('input', { name: 'qty', type: 'number', min: 0, value: it.qty ?? 1 })),
      field('Condition', el('select', { name: 'condition', class: 'set-select' }, CONDITIONS.map((c) => el('option', { value: c, selected: (it.condition || 'Good') === c }, c)))),
      field('Bought', el('input', { name: 'bought', type: 'date', value: it.bought || '' }))),
    el('div', { class: 'two' }, field('Price', el('input', { name: 'price', type: 'number', min: 0, step: 0.01, value: it.price ?? '' })), field('Kept where', el('input', { name: 'where', value: it.where || '' }))),
    field('Link', el('input', { name: 'url', type: 'url', value: it.url || '', placeholder: 'https://… the shop or maker\'s page' }), 'Shows on the card as "Product page".'),
    el('div', { class: 'two' },
      field('Service every (days)', el('input', { name: 'serviceEvery', type: 'number', min: 0, value: it.serviceEvery ?? '', placeholder: serviceOf(it)?.every ? `${serviceOf({ ...it, serviceEvery: null }).every} (usual)` : 'none' }), 'Leave empty for the usual; 0 for never.'),
      field('Last serviced', el('input', { name: 'lastService', type: 'date', value: it.lastService || '' }))),
    field('Notes', el('textarea', { name: 'notes', rows: 2 }, it.notes || '')),
    el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'restock', checked: !!it.restock }), el('span', {}, 'Buy more or replace')),
    el('div', { class: 'form-actions' }, el('button', { class: 'btn primary', type: 'submit' }, item ? 'Save' : 'Add'), el('button', { class: 'btn ghost', type: 'button', onclick: () => d.close() }, 'Cancel')));
  drawExtra(it.cat);
  d = dialog(item ? `Edit ${item.name}` : 'Add a tool', null, f);
}
function printerSummary(p) {
  if ((p.type || 'FDM') !== 'FDM') {
    const res = S.mats.filter((m) => m.kind === 'resin');
    return el('div', { class: 'psum' }, el('p', {}, res.length ? `You have ${res.length} resin${res.length === 1 ? '' : 's'} for it. ` : 'No resin in your materials yet. ', el('button', { type: 'button', class: 'link-inline', onclick: () => { S.sec.materials = res.length ? 'mine' : 'resins'; saveSec(); goTab('materials'); } }, res.length ? 'See your resin' : 'Browse the resin list')));
  }
  const fams = Object.keys(GUIDE).filter((k) => k !== 'Other');
  const by = { ok: [], care: [], no: [] };
  for (const k of fams) by[compat(p, { material: k, name: GUIDE[k].name }).level].push(GUIDE[k].name.replace(/ \(.*\)$/, ''));
  const mine = S.mats.filter((m) => m.kind !== 'resin').map((m) => compat(p, m).level);
  return el('div', { class: 'psum' },
    el('p', {}, el('b', {}, 'Prints well: '), by.ok.join(', ') || '—'),
    by.care.length ? el('p', {}, el('b', {}, 'With care: '), by.care.join(', ')) : '',
    by.no.length ? el('p', {}, el('b', {}, 'Can\'t print as it is: '), by.no.join(', ')) : '',
    el('p', { class: 'muted' }, mine.length ? `Your filament: ${mine.filter((l) => l === 'ok').length} print well, ${mine.filter((l) => l === 'care').length} with care, ${mine.filter((l) => l === 'no').length} can't. ` : 'No filament in your materials yet. ',
      el('button', { type: 'button', class: 'link-inline', onclick: () => { S.sec.materials = mine.length ? 'mine' : 'catalogue'; saveSec(); goTab('materials'); } }, mine.length ? 'See your filament' : 'Browse the filament list')));
}
function toolCard(t) {
  const c = CATS[t.cat] || CATS.other;
  const worn = needsReplacing(t);
  const sv = serviceOf(t), st = serviceState(t), last = lastService(t);
  const svWord = isRespirator(t) ? 'Filters changed' : 'Serviced';
  const tip = goodFor(t);
  const specs = specList(t);
  const setCondition = async (cond) => { S.tools = S.tools.map((x) => (x.id === t.id ? { ...x, condition: cond } : x)); await save('tools'); render(); };
  return el('article', { class: `tcard${t.condition === 'Retired' ? ' retired' : ''}${st === 'due' || worn ? ' attn' : ''}` },
    el('span', { class: 'ticon' }, svg(c.icon)),
    el('div', { class: 'mcard-body' },
      el('div', { class: 'mcard-title' }, el('b', {}, t.name), t.qty > 1 && el('span', { class: 'count' }, `×${t.qty}`)),
      el('small', { class: 'muted' }, [t.brand, c.label.replace(/s$/, ''), t.where && `kept in ${t.where}`].filter(Boolean).join(' · ')),
      el('div', { class: 'cchips' },
        el('span', { class: `cchip ${worn ? 'care' : t.condition === 'Retired' ? 'no' : 'ok'}` }, t.condition || 'Good'),
        st === 'due' && el('span', { class: 'cchip no', title: sv.what }, `${isRespirator(t) ? 'Filter change' : 'Service'} due: last ${ago(last)}`),
        st === 'soon' && el('span', { class: 'cchip care', title: sv.what }, `${isRespirator(t) ? 'Filter change' : 'Service'} due soon`),
        st === 'ok' && el('span', { class: 'cchip', title: sv.what }, `${svWord} ${ago(last)}`),
        st === 'unknown' && el('span', { class: 'cchip', title: sv.what }, `${isRespirator(t) ? 'Filter change' : 'Service'} not logged yet`),
        t.restock && el('span', { class: 'cchip care' }, 'Buy more / replace')),
      tip && el('p', { class: 'tgood' }, el('b', {}, 'Good for: '), tip),
      t.cat === 'printer' ? printerSummary(t) : '',
      (st === 'due' || st === 'soon' || st === 'unknown') && el('p', { class: 'tdue' }, el('b', {}, `Every ${sv.every >= 60 ? `${Math.round(sv.every / 30)} months` : `${sv.every} days`}: `), sv.what),
      specs.length ? el('details', { class: 'tmore' }, el('summary', {}, `Specs (${specs.length})`), el('div', { class: 'tspecs' }, specs.map((x) => el('span', {}, x)))) : '',
      t.notes && el('details', { class: 'tmore' }, el('summary', {}, 'Notes'), el('p', { class: 'muted tnote' }, t.notes)),
      t.log?.length ? el('details', { class: 'tmore' }, el('summary', {}, `History (${t.log.length})`), el('ul', { class: 'tlog' }, t.log.slice(0, 12).map((e) => el('li', {}, el('span', { class: 'mono' }, e.d), ' ', e.t)))) : '',
      el('div', { class: 'mcard-acts' },
        sv && btn(isRespirator(t) ? 'Filters changed today' : 'Serviced today', () => logService(t, isRespirator(t) ? 'Changed the filters' : 'Serviced'), st === 'due' || st === 'soon' || st === 'unknown' ? 'primary' : 'ghost'),
        t.cat === 'printer' && (t.type || 'FDM') === 'FDM' && btn('Change nozzle', () => changeNozzle(t)),
        t.cat === 'airbrush' && btn('Paints for airbrushing', () => goAirbrushPaints()),
        ['brush', 'nozzle', 'plate', 'post', 'masking'].includes(t.cat) && !worn && t.condition !== 'Retired' && btn('Mark as worn', () => setCondition('Worn')),
        worn && btn('Replaced: mark as new', () => setCondition('New')),
        btn('Add note', () => addNote(t)),
        btn('Edit', () => editTool(t)),
        btn('Delete', async () => { if (await h.confirmDlg(`Delete ${t.name}?`, 'It\'s removed from your tools.', [{ label: 'Cancel', value: '' }, { label: 'Delete', value: 'y', cls: 'primary' }])) { S.tools = S.tools.filter((x) => x.id !== t.id); await save('tools'); render(); } })),
      toolLinks(t)));
}
function renderTools(root, which) {
  const q = S.tq.trim().toLowerCase();
  let list = S.tools.filter((t) => !q || `${t.name} ${t.brand} ${t.notes} ${specLine(t)}`.toLowerCase().includes(q));
  if (which === 'printing') list = list.filter((t) => ['printing', 'both'].includes((CATS[t.cat] || CATS.other).group));
  if (which === 'painting') list = list.filter((t) => ['painting', 'both'].includes((CATS[t.cat] || CATS.other).group));
  if (which === 'restock') list = list.filter((t) => t.restock || ['Worn', 'Needs replacing'].includes(t.condition));
  const need = {
    due: list.filter((t) => ['due', 'soon'].includes(serviceState(t))),
    unknown: list.filter((t) => serviceState(t) === 'unknown'),
    worn: list.filter(needsReplacing),
    buy: list.filter((t) => t.restock),
  };
  if (!need[S.tneed]?.length) S.tneed = '';
  const all = list;
  if (S.tneed) list = need[S.tneed];
  const tile = (k, n, label, cls) => n > 0 && el('button', { type: 'button', class: `need ${cls}`, 'aria-pressed': String(S.tneed === k), onclick: () => { S.tneed = S.tneed === k ? '' : k; render(); } }, el('b', {}, n), el('span', {}, label));
  const strip = which !== 'restock' && all.length ? el('div', { class: 'needs', role: 'group', 'aria-label': 'What needs doing' },
    tile('due', need.due.length, need.due.length === 1 ? 'needs servicing' : 'need servicing', 'no'),
    tile('worn', need.worn.length, need.worn.length === 1 ? 'is worn' : 'are worn', 'care'),
    tile('buy', need.buy.length, 'to buy or replace', 'care'),
    tile('unknown', need.unknown.length, 'with no service logged yet', ''),
    !need.due.length && !need.worn.length && !need.buy.length && el('span', { class: 'need ok still' }, el('b', {}, '✓'), el('span', {}, 'Nothing is due or worn')),
    S.tneed && el('button', { type: 'button', class: 'link-inline', onclick: () => { S.tneed = ''; render(); } }, 'Show everything')) : '';
  const groups = Object.keys(CATS).map((k) => [k, list.filter((t) => t.cat === k)]).filter(([, a]) => a.length);
  const title = { all: 'All tools', printing: '3D printing tools', painting: 'Painting tools', restock: 'To replace or buy' }[which];
  const addCat = which === 'painting' ? 'airbrush' : which === 'printing' ? 'printer' : 'brush';
  put(root, 
    head(title, `${all.length} item${all.length === 1 ? '' : 's'}`, btn('Add a tool', () => editTool(null, addCat), 'primary')),
    strip,
    el('div', { class: 'view-bar' }, el('label', { class: 'search small' }, el('span', { class: 'sr-only' }, 'Filter tools'), svg('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
      el('input', { type: 'search', placeholder: 'Filter', value: S.tq, oninput: (e) => { S.tq = e.target.value; clearTimeout(S.t); S.t = setTimeout(() => { render(); const i = root.querySelector('input[type=search]'); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); }, 160); } }))),
    groups.length ? groups.map(([k, a]) => el('section', { class: 'mgroup' },
      el('h3', {}, el('span', { class: 'ticon small' }, svg(CATS[k].icon)), CATS[k].label, el('span', { class: 'count' }, a.length),
        el('button', { type: 'button', class: 'link-inline', onclick: () => editTool(null, k) }, `Add ${CATS[k].one}`)),
      el('div', { class: 'tcards' }, a.map(toolCard))))
      : emptyBox(which === 'restock' ? 'Nothing to replace. Mark tools as worn, or tick "Buy more or replace", and they show up here.'
        : !S.tools.length ? 'No tools yet. Start with your 3D printer: find it in the list of 600 printers and its build size, nozzle and firmware fill themselves in.' : 'Nothing here yet.',
        which !== 'restock' && !S.tools.length && btn('Add your printer', () => editTool(null, 'printer'), 'primary'),
        which !== 'restock' && btn(S.tools.length ? 'Add a tool' : 'Add another tool', () => editTool(null, addCat), S.tools.length ? 'primary' : 'ghost')));
}
function renderBrushes(root) {
  const brushes = S.tools.filter((t) => t.cat === 'brush').sort((a, b) => SIZES.indexOf(String(a.size)) - SIZES.indexOf(String(b.size)));
  const shapes = [...new Set(brushes.map((b) => b.shape || 'Round'))];
  const tip = (s) => { const i = SIZES.indexOf(String(s)); return i < 0 ? 8 : 3 + i * 1.6; };
  put(root, 
    head('Brushes', brushes.length ? `${brushes.reduce((n, b) => n + (b.qty || 1), 0)} brushes · ${brushes.filter((b) => ['Worn', 'Needs replacing'].includes(b.condition)).length} worn` : null, btn('Add a brush', () => editTool(null, 'brush'), 'primary')),
    !brushes.length ? emptyBox('No brushes yet. Add them with their size, shape and hair, and see your set from the finest to the biggest.', btn('Add a brush', () => editTool(null, 'brush'), 'primary'))
      : shapes.map((sh) => el('section', { class: 'mgroup' }, el('h3', {}, sh, el('span', { class: 'count' }, brushes.filter((b) => (b.shape || 'Round') === sh).length)),
        el('div', { class: 'brush-rack' }, brushes.filter((b) => (b.shape || 'Round') === sh).map((b) => el('button', { type: 'button', class: `brush ${(b.condition || '').toLowerCase().replace(/\s+/g, '-')}`, title: [b.name, b.brand, b.series, b.hair, b.condition].filter(Boolean).join(' · '), onclick: () => editTool(b) },
          el('span', { class: 'bhandle' }), el('span', { class: 'bferrule' }), el('span', { class: 'btip', style: `width:${tip(b.size)}px` }),
          el('b', {}, b.size || '?'), el('small', {}, [b.brand, b.series].filter(Boolean).join(' ') || b.name), b.condition && b.condition !== 'New' && b.condition !== 'Good' && el('small', { class: 'bworn' }, b.condition)))))));
}

// ---------- navigation ----------
const NAV = {
  materials: [['mine', 'My filament and resin', '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/>'], ['catalogue', 'Filament list', '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'], ['resins', 'Resin list', '<path d="M9 3h6M10 3v4l-4 9a3 3 0 0 0 3 4h6a3 3 0 0 0 3-4l-4-9V3"/><path d="M7.5 14h9"/>'], ['guide', 'Material guide', '<path d="M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4z"/><path d="M9 8h6M9 12h6"/>']],
  tools: [['all', 'All tools', '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>'], ['printing', '3D printing', CATS.printer.icon], ['painting', 'Painting', CATS.airbrush.icon], ['brushes', 'Brushes', CATS.brush.icon], ['restock', 'To replace or buy', '<path d="M4 5h2l2 10h10l2-7H7"/><circle cx="10" cy="19" r="1.3"/><circle cx="17" cy="19" r="1.3"/>']],
};
function count(tab, k) {
  if (tab === 'materials') return k === 'mine' ? S.mats.length || '' : '';
  const g = (t) => (CATS[t.cat] || CATS.other).group;
  return { all: S.tools.length, printing: S.tools.filter((t) => ['printing', 'both'].includes(g(t))).length, painting: S.tools.filter((t) => ['painting', 'both'].includes(g(t))).length, brushes: S.tools.filter((t) => t.cat === 'brush').length, restock: S.tools.filter((t) => t.restock || ['Worn', 'Needs replacing'].includes(t.condition)).length }[k] || '';
}
function render() {
  const side = h.$('#stock-side'), root = h.$('#stock');
  const tab = S.tab, sec = S.sec[tab];
  side.replaceChildren(
    el('nav', { class: 'views', 'aria-label': tab === 'materials' ? 'Material sections' : 'Tool sections' }, NAV[tab].map(([k, label, icon]) =>
      el('button', { class: 'view-btn', 'aria-pressed': String(sec === k), onclick: () => { S.sec[tab] = k; saveSec(); render(); window.scrollTo({ top: 0 }); } }, svg(icon), label, el('span', { class: 'count' }, count(tab, k))))),
    el('p', { class: 'paint-credit' }, tab === 'materials' ? 'Filament data: SpoolmanDB (MIT licence). Resin data: OpenPrintTag (MIT licence). Printer checks use your printers in Tools.' : 'Your printers here decide which filament the Materials tab says you can print.'));
  const add = h.$('#stock-add');
  const resinView = tab === 'materials' && (sec === 'resins' || (sec === 'guide' && S.gkind === 'resin'));
  add.textContent = tab === 'materials' ? (resinView ? 'Add resin' : 'Add filament') : 'Add a tool';
  add.onclick = () => (tab === 'materials' ? editMaterial(null, resinView ? 'resin' : 'filament') : editTool(null, sec === 'painting' ? 'airbrush' : sec === 'printing' ? 'printer' : 'brush'));
  h.$('#stock-title').textContent = NAV[tab].find(([k]) => k === sec)?.[1] || '';
  if (tab === 'materials') ({ mine: renderMine, catalogue: renderCatalogue, resins: renderResins, guide: renderGuide }[sec] || renderMine)(root);
  else if (sec === 'brushes') renderBrushes(root);
  else renderTools(root, sec);
}
async function load() {
  const d = await h.api('GET', '/api/paint-docs?keys=materials,tools');
  S.mats = d.materials || [];
  S.tools = d.tools;
  S.tools ||= []; // a new install starts empty: add your printer from the list
}
export async function show(tab, helpers) {
  h = helpers;
  S.tab = tab;
  if (!ready) { h.$('#stock').replaceChildren(el('p', { class: 'muted paint-loading' }, 'Loading…')); ready = load(); ready.catch(() => { ready = null; }); }
  await ready;
  render();
}
