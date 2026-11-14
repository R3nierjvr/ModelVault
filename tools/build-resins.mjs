// Builds public/materials/resins.json.
//  - OpenPrintTag database (github.com/OpenPrintTag/openprinttag-database, MIT licence, © Prusa Research): every SLA material.
//  - A short hand-made list of popular hobby resin lines (Elegoo, Anycubic, …) whose colours are approximate.
// Usage: node tools/build-resins.mjs /path/to/openprinttag-database
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2];
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'materials');
if (!SRC) { console.error('Give the openprinttag-database folder'); process.exit(1); }

// The YAML here is simple; read only the fields we need.
const field = (txt, key) => { const m = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(txt); return m ? m[1].trim().replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1') : null; };
const hexOf = (rgba) => (rgba ? `#${rgba.replace(/^#/, '').slice(0, 6).toUpperCase()}` : null);

/** The kind of resin, from its name (and tags). */
function typeOf(name, tags = [], pro = false) {
  const n = name.toLowerCase();
  if (/cast/.test(n) || tags.includes('contains_wax')) return 'Castable';
  if (/flex|elastomer|rebound|\b\d{2}a\b|tenacious flex/.test(n)) return 'Flexible';
  if (/water[- ]?wash|water washable|water-wash/.test(n)) return 'Water-washable';
  if (/plant|bio-?based|biobased|\bbio\b/.test(n) || tags.includes('bio_based')) return 'Plant-based';
  if (/high[- ]?temp|\bhdt\b|tr250|tr300|heat/.test(n) || tags.includes('high_temperature')) return 'High-temperature';
  if (/abs/.test(n)) return 'ABS-like';
  if (/tough|impact|nylon|\bblu\b|blu-|strong|mecha|onyx|rigid|pc\/gf|tenacious/.test(n)) return 'Tough';
  if (/8k|12k|14k|16k|hyperfine|high-resolution|sculpt|\brpg\b/.test(n)) return '8K / high detail';
  if (pro) return 'Engineering';
  if (/clear|transparent/.test(n) && !/model|basic|standard/.test(n)) return 'Clear';
  return 'Standard';
}

// Shorter names where the maker's name carries a sales line.
const RENAME = {
  'Fast Tough - 50% Tougher than ABS-Like resin Tough Grey': 'Fast Tough Grey',
  'Fast Tough - 50%': 'Fast Tough',
  'Fast Mecha - Wear-resistant ABS-like resin': 'Fast Mecha ABS-Like',
  'Tenacious Easy Navy Grey- Easy to Print Model resin with Great Impact Resistance': 'Tenacious Easy Navy Grey',
  'Rebound 55A - Fast-Rebound 3D Printing Resin': 'Rebound 55A Flexible',
  'Tenacious Flex Black- 70A Flexible resin': 'Tenacious Flex 70A Black',
  'Tenacious Lava - 72D': 'Tenacious Lava 72D',
};
const tidy = (n) => (RENAME[n] || n).replace(/\s+-\s*|\s*-\s+/g, ' ').replace(/\bresin\b/g, 'Resin').replace(/\s+/g, ' ').trim();
const brands = [];
const brandIx = (name) => { let i = brands.indexOf(name); if (i < 0) i = brands.push(name) - 1; return i; };
const out = [];
const PRO = new Set(['henkel', 'forward-am', 'altana', 'liqcreate']);

const mdir = path.join(SRC, 'data', 'materials');
for (const bslug of fs.readdirSync(mdir).sort()) {
  for (const file of fs.readdirSync(path.join(mdir, bslug)).filter((f) => f.endsWith('.yaml')).sort()) {
    const t = fs.readFileSync(path.join(mdir, bslug, file), 'utf8');
    if (field(t, 'class') !== 'SLA') continue;
    const bfile = path.join(SRC, 'data', 'brands', `${bslug}.yaml`);
    const brand = fs.existsSync(bfile) ? field(fs.readFileSync(bfile, 'utf8'), 'name') : bslug;
    const name = tidy(field(t, 'name'));
    const h = hexOf(/primary_color:\s*\n\s*color_rgba:\s*'?([#0-9a-fA-F]+)/.exec(t)?.[1]);
    const tagBlock = /^tags:\n((?:- .*\n?)+)/m.exec(t)?.[1] || '';
    const tags = tagBlock.split('\n').map((l) => l.replace(/^- /, '').trim()).filter(Boolean);
    const second = [...(/secondary_colors:\n((?:[- ] .*\n?)+)/.exec(t)?.[1] || '').matchAll(/color_rgba:\s*'?([#0-9a-fA-F]+)/g)].map((m) => hexOf(m[1]));
    const e = { b: brandIx(brand), n: name.replace(/\s+/g, ' ').trim(), y: typeOf(name, tags, PRO.has(bslug)), h: h || '#9A9A9A' };
    if (second.length) e.hs = [e.h, ...second];
    if (tags.includes('transparent') || tags.includes('translucent') || /clear|transparent|translucent/i.test(name)) e.tr = 1;
    if (tags.includes('glow_in_the_dark')) e.gl = 1;
    if (tags.includes('biocompatible')) e.bio = 1;
    if (e.y === 'Water-washable') e.w = 'water';
    const den = /^\s+density:\s*([\d.]+)/m.exec(t)?.[1]; if (den) e.den = Number(den);
    const url = field(t, 'url'); if (url) e.u = url;
    if (PRO.has(bslug)) e.pro = 1;
    if (!h) e.nh = 1; // no colour given
    out.push(e);
  }
}

// Popular hobby resin lines. Colours are approximate (from product photos), not measured.
const C = {
  Grey: '#8E9196', Black: '#232426', White: '#ECECE8', Beige: '#D8C2A2', Clear: '#E4EAEC', Skin: '#E8B99E',
  'Clear Red': '#C4343C', 'Clear Green': '#33A361', 'Clear Blue': '#2F70C4', 'Clear Yellow': '#E8C93A',
  'Space Grey': '#6E7277', 'Red Clay': '#B0654E', Vanilla: '#EEE2C3', 'Ceramic Grey': '#BABCB7', 'Dark Grey': '#55585C',
  Red: '#C8302E', Blue: '#2D5EB6', Green: '#3D994B', Yellow: '#E7C537', Orchid: '#B77FC6', Apricot: '#E9A877',
};
const LINES = [
  ['Elegoo', 'Standard Resin', 'Standard', ['Grey', 'Black', 'White', 'Beige', 'Clear', 'Clear Red', 'Clear Green', 'Clear Blue']],
  ['Elegoo', 'Standard Resin V2.0', 'Standard', ['Grey', 'Black', 'White', 'Orchid']],
  ['Elegoo', 'Rapid Standard Resin', 'Standard', ['Grey', 'Black', 'White']],
  ['Elegoo', '8K Standard Resin', '8K / high detail', ['Space Grey', 'Red Clay']],
  ['Elegoo', 'ABS-Like Resin', 'ABS-like', ['Grey', 'Black', 'White', 'Beige', 'Clear']],
  ['Elegoo', 'ABS-Like Resin V3.0', 'ABS-like', ['Grey', 'Black', 'White']],
  ['Elegoo', '8K ABS-Like Resin V3.0', '8K / high detail', ['Space Grey']],
  ['Elegoo', 'Water-Washable Resin', 'Water-washable', ['Grey', 'Black', 'White', 'Beige', 'Ceramic Grey', 'Clear', 'Clear Red', 'Clear Green', 'Clear Blue']],
  ['Elegoo', 'Water-Washable Resin V2.0', 'Water-washable', ['Grey', 'Black', 'White']],
  ['Elegoo', '8K Water-Washable Resin', 'Water-washable', ['Space Grey', 'Vanilla']],
  ['Elegoo', 'Water-Washable ABS-Like Resin', 'Water-washable', ['Grey', 'Ceramic Grey']],
  ['Elegoo', 'Plant-Based Resin', 'Plant-based', ['Grey', 'Black', 'White', 'Clear Green']],
  ['Elegoo', 'Tough Resin', 'Tough', ['Black', 'Grey']],
  ['Anycubic', 'Standard Resin', 'Standard', ['Grey', 'Black', 'White', 'Clear', 'Skin', 'Red', 'Blue', 'Green', 'Yellow']],
  ['Anycubic', 'Standard Resin V2', 'Standard', ['Grey', 'Black', 'White']],
  ['Anycubic', 'ABS-Like Resin Pro 2', 'ABS-like', ['Grey', 'Black', 'White']],
  ['Anycubic', 'Plant-Based Resin', 'Plant-based', ['Grey', 'Black', 'White', 'Clear', 'Beige']],
  ['Anycubic', 'Water-Wash Resin+', 'Water-washable', ['Grey', 'Black', 'White', 'Clear', 'Beige']],
  ['Anycubic', 'High Speed Resin', 'Standard', ['Grey']],
  ['Anycubic', '14K Resin', '8K / high detail', ['Grey']],
  ['Anycubic', 'Craftsman Resin', '8K / high detail', ['Beige', 'Grey', 'Apricot']],
  ['Creality', 'Standard Resin', 'Standard', ['Grey', 'Black', 'White', 'Clear']],
  ['Creality', 'Water-Washable Resin', 'Water-washable', ['Grey', 'Black', 'White']],
  ['Sunlu', 'Standard Resin', 'Standard', ['Grey', 'Black', 'White', 'Clear', 'Beige']],
  ['Sunlu', 'ABS-Like Resin', 'ABS-like', ['Grey', 'Black', 'White']],
  ['Sunlu', 'Water-Washable Resin', 'Water-washable', ['Grey', 'Black', 'White', 'Clear']],
  ['Sunlu', 'Plant-Based Resin', 'Plant-based', ['Grey', 'Black', 'White', 'Clear']],
  ['eSun', 'Standard Resin', 'Standard', ['Grey', 'Black', 'White', 'Clear', 'Beige']],
  ['eSun', 'Water-Washable Resin', 'Water-washable', ['Grey', 'Black', 'White']],
  ['eSun', 'eResin-PLA Plant-Based Resin', 'Plant-based', ['Grey', 'Black', 'White', 'Clear']],
  ['Monocure 3D', 'Rapid Resin', 'Standard', ['Grey', 'Black', 'White', 'Clear']],
];
for (const [brand, line, y, colours] of LINES) {
  for (const c of colours) {
    const e = { b: brandIx(brand), n: `${line} ${c}`, c, y, h: C[c], approx: 1 };
    if (/clear/i.test(c)) e.tr = 1;
    if (y === 'Water-washable') e.w = 'water';
    out.push(e);
  }
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'resins.json'), JSON.stringify({ source: 'OpenPrintTag database (github.com/OpenPrintTag/openprinttag-database), MIT licence, © Prusa Research; plus popular hobby resins added by ModelVault with approximate colours', brands, resins: out }));
fs.copyFileSync(path.join(SRC, 'LICENSE'), path.join(OUT, 'LICENSE-resin-data.txt'));
const types = {}; for (const e of out) types[e.y] = (types[e.y] || 0) + 1;
console.log(brands.length, 'brands,', out.length, 'resins', types);
