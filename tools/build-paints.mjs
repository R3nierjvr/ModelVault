// Builds public/paints/paints.json from the MIT-licensed miniature-paints data (github.com/Arcturus5404/miniature-paints).
// Usage: node tools/build-paints.mjs /path/to/miniature-paints/paints
// Each paint gets: brand, range, name, code, hex, type (what it's made of), kind (what it does) and how it's applied.
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2];
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'paints');
if (!SRC) { console.error('Give the folder with the .md paint lists'); process.exit(1); }

export const BRANDS = {
  citadel: { file: 'Citadel_Colour', name: 'Citadel', maker: 'Games Workshop' },
  armypainter: { file: 'Army_Painter', name: 'The Army Painter' },
  vallejo: { file: 'Vallejo', name: 'Vallejo' },
  tamiya: { file: 'Tamiya', name: 'Tamiya' },
  ak: { file: ['AK', 'AKRC'], name: 'AK Interactive' },
  monument: { file: 'Monument', name: 'Pro Acryl', maker: 'Monument Hobbies' },
  scale75: { file: 'Scale75', name: 'Scale 75' },
  mrhobby: { file: 'MrHobby', name: 'Mr. Hobby', maker: 'GSI Creos (Gunze Sangyo)' },
  ammo: { file: 'Mig', name: 'AMMO', maker: 'MIG Jiménez' },
  reaper: { file: 'Reaper', name: 'Reaper Master Series', maker: 'Reaper Miniatures' },
};

// What each range is: type = acrylic / enamel / lacquer / alcohol; kind = what it does; how = how it's applied.
// Ranges are matched by their name (first match wins). "range" renames it for display.
const B = 'Brush', A = 'Airbrush', S = 'Spray', D = 'Drybrush', P = 'Dip';
const RULES = {
  citadel: [
    [/^Base$/, { kind: 'Base', how: [B] }],
    [/^Layer$/, { kind: 'Layer', how: [B] }],
    [/^Shade$/, { kind: 'Wash', how: [B] }],
    [/^Contrast$/, { kind: 'Contrast', how: [B] }],
    [/^Glaze$/, { kind: 'Glaze', how: [B] }],
    [/^Dry$/, { kind: 'Dry', how: [D] }],
    [/^Air$/, { kind: 'Paint', how: [A] }],
    [/^Spray$/, { kind: 'Primer', how: [S] }],
    [/^Technical$/, { kind: 'Effect', how: [B] }],
    [/^Foundation Wash/, { kind: 'Wash', how: [B], range: 'Foundation Wash', gone: true }],
    [/^Foundation Primer/, { kind: 'Primer', how: [S], range: 'Foundation Primer', gone: true }],
    [/^Foundation/, { kind: 'Base', how: [B], range: 'Foundation', gone: true }],
  ],
  armypainter: [
    [/^Warpaints Fanatic Wash/, { kind: 'Wash', how: [B] }],
    [/^Warpaints Fanatic/, { kind: 'Paint', how: [B] }],
    [/^Warpaints Air/, { kind: 'Paint', how: [A] }],
    [/^Warpaints Primer/, { kind: 'Primer', how: [S], range: 'Colour Primer (spray)' }],
    [/^Warpaints (Wash|Tone)/, { kind: 'Wash', how: [B] }],
    [/^Warpaints$/, { kind: 'Paint', how: [B] }],
    [/^Speedpaint/, { kind: 'Contrast', how: [B] }],
    [/Quickshade/, { kind: 'Wash', how: [B], range: 'Quickshade Washes' }],
    [/Wash/, { kind: 'Wash', how: [B] }],
    [/Primer/, { kind: 'Primer', how: [B] }],
    [/./, { kind: 'Paint', how: [B] }],
  ],
  vallejo: [
    [/^(Model Air|Game Air|Premium Airbrush Color)/, { kind: 'Paint', how: [A] }],
    [/^Mecha Color/, { kind: 'Paint', how: [B, A] }],
    [/^Surface Primer/, { kind: 'Primer', how: [A, B] }],
    [/^Metal Color/, { kind: 'Metallic', how: [A, B] }],
    [/^Liquid Gold/, { kind: 'Metallic', how: [B], type: 'Alcohol' }],
    [/Wash/, { kind: 'Wash', how: [B] }],
    [/^Weathering FX/, { kind: 'Effect', how: [B] }],
    [/Special FX/, { kind: 'Effect', how: [B] }],
    [/^Xpress Color Intense/, { kind: 'Contrast', how: [B] }],
    [/^Xpress Color/, { kind: 'Contrast', how: [B] }],
    [/Fluores/, { kind: 'Fluorescent', how: [B], range: 'Arte Deco Fluorescent' }],
    [/./, { kind: 'Paint', how: [B] }],
  ],
  tamiya: [
    [/^Tamiya Spray/, { kind: 'Paint', how: [S], type: 'Lacquer', range: 'TS Spray' }],
    [/^Aircraft Spray/, { kind: 'Paint', how: [S], type: 'Lacquer', range: 'AS Aircraft Spray' }],
    [/^Lacquer Paint/, { kind: 'Paint', how: [B, A], type: 'Lacquer', range: 'LP Lacquer' }],
    [/^Acrylics Mini Flat/, { kind: 'Paint', how: [B, A], range: 'Acrylic (XF flat)' }],
    [/^Acrylics Mini Gloss/, { kind: 'Paint', how: [B, A], range: 'Acrylic (X gloss)' }],
  ],
  ak: [
    [/^Real Colors - Clear/, { kind: 'Paint', how: [A, B], type: 'Lacquer', range: 'Real Colors Clear' }],
    [/^Real Colors - (.*)/, { kind: 'Paint', how: [A, B], type: 'Lacquer', range: 'Real Colors $1' }],
    [/^Air \(3rd Gen\)/, { kind: 'Paint', how: [A], range: '3rd Gen Air' }],
    [/^Primer \(3rd Gen\)/, { kind: 'Primer', how: [A, B], range: '3rd Gen Primer' }],
    [/^Ink \(3rd Gen\)/, { kind: 'Ink', how: [B, A], range: '3rd Gen Ink' }],
    [/^Auxiliary \(3rd Gen\)/, { kind: 'Medium', how: [B], range: '3rd Gen Auxiliary' }],
    [/^Metallic \(3rd Gen\)/, { kind: 'Metallic', how: [B], range: '3rd Gen Metallic' }],
    [/^(\w+) \(3rd Gen\)/, { kind: 'Paint', how: [B], range: '3rd Gen $1' }],
    [/^Air$/, { kind: 'Paint', how: [A], range: 'Air Series (2nd Gen)' }],
    [/./, { kind: 'Paint', how: [B, A], suffix: ' (2nd Gen)' }],
  ],
  monument: [
    [/Primer/, { kind: 'Primer', how: [A, B], range: 'Pro Acryl Primer' }],
    [/Wash/, { kind: 'Wash', how: [B], range: 'Pro Acryl Wash' }],
    [/Signature/, { kind: 'Paint', how: [B, A], range: 'Pro Acryl Signature Series' }],
    [/./, { kind: 'Paint', how: [B, A], range: 'Pro Acryl' }],
  ],
  scale75: [
    [/^Scale Color/, { kind: 'Paint', how: [B], range: 'Scalecolor' }],
    [/^Artist/, { kind: 'Paint', how: [B], range: 'Scalecolor Artist' }],
    [/^Fantasy/, { kind: 'Paint', how: [B], range: 'Fantasy & Games' }],
    [/^Warfront/, { kind: 'Paint', how: [B], range: 'Warfront' }],
    [/^Instant/, { kind: 'Contrast', how: [B], range: 'Instant Colors' }],
    [/^Metal N Alchemy/, { kind: 'Metallic', how: [B], range: 'Metal n’ Alchemy' }],
    [/^Inktensity/, { kind: 'Ink', how: [B, A], range: 'Inktensity' }],
    [/^FX/, { kind: 'Effect', how: [B], range: 'FX Fluor' }],
    [/^Soil Works/, { kind: 'Texture', how: [B], range: 'Soil Works' }],
    [/^Primers/, { kind: 'Primer', how: [A, B], range: 'Primer' }],
  ],
  mrhobby: [
    [/^Aqueous Hobby Color/, { kind: 'Paint', how: [B, A], range: 'Aqueous Hobby Color (H)' }],
    [/^Acrysion/, { kind: 'Paint', how: [B, A] }],
    [/Spray/, { kind: 'Paint', how: [S], type: 'Lacquer' }],
    [/^Mr Metal Color/, { kind: 'Metallic', how: [B, A], type: 'Lacquer' }],
    [/Metallic|Super Metallic/, { kind: 'Metallic', how: [A, B], type: 'Lacquer' }],
    [/^Mr Color$/, { kind: 'Paint', how: [B, A], type: 'Lacquer', range: 'Mr. Color (C)' }],
    [/./, { kind: 'Paint', how: [A, B], type: 'Lacquer' }],
  ],
  ammo: [
    [/^Washes/, { kind: 'Wash', how: [B], type: 'Enamel', range: 'Enamel Washes' }],
    [/^Primers/, { kind: 'Primer', how: [A], range: 'One Shot Primer' }],
    [/^Acrylics/, { kind: 'Paint', how: [B, A], range: 'Acrylic (AMIG)' }],
  ],
  reaper: [
    [/Wash/, { kind: 'Wash', how: [B], range: 'MSP Wash' }],
    [/Primer/, { kind: 'Primer', how: [B], range: 'MSP Brush-on Primer' }],
    [/Bones/, { kind: 'Paint', how: [B], range: 'MSP Bones' }],
    [/Pathfinder/, { kind: 'Paint', how: [B], range: 'MSP Pathfinder' }],
    [/Core/, { kind: 'Paint', how: [B], range: 'MSP Core Colors' }],
  ],
};

// Names say more than ranges sometimes: a metallic in a normal range, a varnish, a medium.
const METAL = /\b(metal(lic)?|silver|gold|bronze|copper|brass|steel|iron|chrome|gunmetal|alumin(i)?um|titanium|pewter|platinum|nickel|tin|zinc)\b|leadbelcher|retributor|ironbreaker|necron compound|gehenna|runefang|stormhost|warplock|sycorax|canoptek|fulgurite|hashut|liberator gold|auric|balthasar|brazen|thallium/i;
const VARNISH = /\bvarnish\b|'ardcoat|lahmian medium|^(matt|matte|gloss|satin)\s*(varnish|coat|clear|finish)?$|\bclear coat\b|\btop ?coat\b/i;
const MEDIUM = /\b(medium|thinner|retarder|flow improver|cleaner|reducer|diluent)\s*$|\b(thinner|retarder|flow improver|airbrush cleaner|levell?ing thinner|mixing medium)\b/i;
const FLUO = /\b(fluo|fluor|fluorescent|neon)\b/i;

function parse(file) {
  const rows = [];
  const lines = fs.readFileSync(path.join(SRC, `${file}.md`), 'utf8').split('\n');
  let cols = null;
  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells[0] === 'Name') { cols = cells; continue; }
    if (!cols || /^-+$/.test(cells[0])) continue;
    const get = (k) => cells[cols.indexOf(k)];
    const hex = /`(#[0-9A-Fa-f]{6})`/.exec(get('Hex') || '')?.[1];
    if (!hex) continue;
    const code = cols.includes('Code') ? get('Code') : '';
    rows.push({ name: get('Name').replace(/\s+/g, ' ').trim(), code: !code || code === 'null' ? '' : code, set: (get('Set') || '').replace(/\s+/g, ' ').trim(), hex: hex.toUpperCase(), file });
  }
  return rows;
}
const title = (s) => s.replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase());

const out = [];
const seen = new Set();
for (const [key, brand] of Object.entries(BRANDS)) {
  for (const file of [].concat(brand.file)) {
    for (const r of parse(file)) {
      const rule = RULES[key].find(([re]) => re.test(r.set));
      if (!rule) { console.warn('No rule for', key, r.set); continue; }
      const [re, spec] = rule;
      let range = !spec.range ? r.set : spec.range.includes('$') ? r.set.replace(re, spec.range) : spec.range;
      if (spec.suffix) range += spec.suffix;
      let kind = spec.kind;
      const name = key === 'tamiya' ? title(r.name) : r.name;
      if (VARNISH.test(name)) kind = 'Varnish';
      else if (MEDIUM.test(name)) kind = 'Medium';
      else if (/\bprimer\b/i.test(name) && kind === 'Paint') kind = 'Primer';
      else if (/\binks?\b/i.test(name) && kind === 'Paint') kind = 'Ink';
      else if (/\b(wash|shade)\b/i.test(name) && kind === 'Paint') kind = 'Wash';
      else if (FLUO.test(name) && kind === 'Paint') kind = 'Fluorescent';
      const metallic = kind === 'Metallic' || (['Paint', 'Base', 'Layer', 'Dry', 'Contrast', 'Primer'].includes(kind) && METAL.test(name));
      const id = `${key}:${range}:${r.code || name}`.toLowerCase();
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, b: key, r: range, n: name, c: r.code, h: r.hex, t: spec.type || 'Acrylic', k: kind, m: metallic ? 1 : 0, a: spec.how, g: spec.gone ? 1 : 0 });
    }
  }
}

// Dips: The Army Painter's Quickshade dip tins. The swatch is the wash of the same name.
for (const [name, code] of [['Soft Tone', 'QS1001'], ['Strong Tone', 'QS1002'], ['Dark Tone', 'QS1003']]) {
  const wash = out.find((p) => p.b === 'armypainter' && p.n === name && /Quickshade/.test(p.r));
  if (wash) out.push({ id: `armypainter:quickshade dip:${code}`.toLowerCase(), b: 'armypainter', r: 'Quickshade Dip', n: name, c: code, h: wash.h, t: 'Varnish-based', k: 'Dip', m: 0, a: [P, B], g: 0, note: 'Swatch taken from the Quickshade wash of the same name.' });
}

fs.mkdirSync(OUT, { recursive: true });
const brands = Object.fromEntries(Object.entries(BRANDS).map(([k, v]) => [k, { name: v.name, maker: v.maker || '' }]));
fs.writeFileSync(path.join(OUT, 'paints.json'), JSON.stringify({ source: 'Miniature Painter Pro paint data (github.com/Arcturus5404/miniature-paints), MIT licence', brands, paints: out }));
const count = (f) => Object.entries(out.reduce((a, p) => { const k = f(p); a[k] = (a[k] || 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]);
console.log('paints', out.length);
console.log('brands', count((p) => p.b));
console.log('kinds', count((p) => p.k));
console.log('types', count((p) => p.t));
console.log('metallic', out.filter((p) => p.m).length);
console.log('how', count((p) => p.a.join('+')));
