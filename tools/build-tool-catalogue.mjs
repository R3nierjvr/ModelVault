// Builds public/tools/catalogue.json: printers and painting tools to choose from in the Tools tab.
//  - FDM printers: OrcaSlicer's printer profiles (github.com/SoftFever/OrcaSlicer, resources/profiles).
//  - Resin printers: UVtools' PrusaSlicer printer profiles (github.com/sn4k3/UVtools, PrusaSlicer/printer).
//    Only facts are taken (build volume, nozzle, firmware, screen size and resolution).
//  - Painting tools and brushes: a list made for ModelVault (below).
// Usage: node tools/build-tool-catalogue.mjs /path/to/OrcaSlicer/resources/profiles /path/to/UVtools/PrusaSlicer/printer
import fs from 'node:fs';
import path from 'node:path';

const [ORCA, UVT] = process.argv.slice(2);
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'tools');
if (!ORCA || !UVT) { console.error('Give the OrcaSlicer profiles folder and the UVtools PrusaSlicer/printer folder'); process.exit(1); }
const first = (v) => (Array.isArray(v) ? v[0] : v);
const round = (n) => Math.round(Number(n) * 10) / 10;

// ---------- FDM printers from OrcaSlicer ----------
const fdm = [];
for (const vf of fs.readdirSync(ORCA).filter((f) => f.endsWith('.json')).sort()) {
  const vendor = vf.replace(/\.json$/, '');
  const dir = path.join(ORCA, vendor, 'machine');
  if (!fs.existsSync(dir)) continue;
  let brand;
  try { brand = JSON.parse(fs.readFileSync(path.join(ORCA, vf), 'utf8')).name; } catch { brand = vendor; }
  if (['Custom Printer', 'Orca Arena Printer', 'OrcaFilamentLibrary'].includes(brand)) continue;
  brand = { Bambulab: 'Bambu Lab' }[brand] || brand;
  const all = new Map();
  for (const f of fs.readdirSync(dir, { recursive: true }).filter((x) => String(x).endsWith('.json'))) {
    try { const d = JSON.parse(fs.readFileSync(path.join(dir, String(f)), 'utf8')); all.set(d.name, d); } catch { /* skip broken */ }
  }
  const resolve = (d, seen = new Set()) => {
    if (!d?.inherits || seen.has(d.name)) return { ...d };
    seen.add(d.name);
    const parent = all.get(d.inherits);
    return { ...(parent ? resolve(parent, seen) : {}), ...d };
  };
  const models = new Map();
  for (const d of all.values()) {
    if (d.type !== 'machine_model') continue;
    if (d.machine_tech && d.machine_tech !== 'FFF') continue;
    models.set(d.name, { brand, model: d.name, nozzles: new Set(String(d.nozzle_diameter || '').split(';').filter(Boolean)) });
  }
  for (const d0 of all.values()) {
    if (d0.type !== 'machine' || d0.instantiation !== 'true') continue;
    const d = resolve(d0);
    const m = models.get(d.printer_model);
    if (!m) continue;
    for (const n of [].concat(d.nozzle_diameter || [])) m.nozzles.add(String(n));
    if (!m.area && d.printable_area) {
      const pts = (Array.isArray(d.printable_area) ? d.printable_area : String(d.printable_area).split(',')).map((p) => String(p).split('x').map(Number));
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      m.area = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
      m.round = pts.length > 8; // a round (delta) bed
    }
    m.height ||= Number(d.printable_height) || null;
    m.flavor ||= d.gcode_flavor;
    m.structure ||= d.printer_structure;
    const nt = first(d.nozzle_type); if (nt && nt !== 'undefine') m.nozzleType ||= nt;
    const et = first(d.extruder_type); if (et) m.extruder ||= et;
    if (Array.isArray(d.nozzle_diameter) && d.nozzle_diameter.length > 1) m.multi = true;
  }
  for (const m of models.values()) {
    if (!m.area) continue;
    const name = m.model.startsWith(`${m.brand} `) ? m.model.slice(m.brand.length + 1) : m.model;
    const e = { b: m.brand, n: name, build: `${round(m.area[0])} × ${round(m.area[1])} × ${round(m.height || 0)}` };
    if (m.round) e.build = `⌀${round(m.area[0])} × ${round(m.height || 0)}`;
    const nz = [...m.nozzles].map(Number).filter((x) => x > 0).sort((a, b) => a - b);
    if (nz.length) e.nz = [...new Set(nz)];
    const fw = { klipper: 'Klipper', marlin: 'Marlin', marlin2: 'Marlin 2', reprapfirmware: 'RepRapFirmware', repetier: 'Repetier' }[m.flavor];
    if (fw) e.fw = fw;
    if (m.brand === 'Bambu Lab') e.fw = 'Bambu Lab firmware';
    if (m.structure && m.structure !== 'undefine') e.k = { i3: 'Bed slinger (i3)', corexy: 'CoreXY', delta: 'Delta', hbot: 'H-bot' }[m.structure] || m.structure;
    if (m.nozzleType) e.nm = { brass: 'Brass', hardened_steel: 'Hardened steel', stainless_steel: 'Stainless steel', tungsten_carbide: 'Tungsten carbide' }[m.nozzleType] || undefined;
    if (m.extruder) e.ex = /direct/i.test(m.extruder) ? 'Direct drive' : /bowden/i.test(m.extruder) ? 'Bowden' : undefined;
    if (m.multi) e.mm = 1;
    fdm.push(e);
  }
}
// The same printer can come from two vendor folders; keep one.
const seenF = new Set();
const fdmOut = fdm.filter((e) => { const k = `${e.b}|${e.n}`.toLowerCase(); if (seenF.has(k)) return false; seenF.add(k); return true; })
  .sort((a, b) => a.b.localeCompare(b.b) || a.n.localeCompare(b.n, undefined, { numeric: true }));

// ---------- resin printers from UVtools ----------
const resin = [];
const BRANDS = ['Anycubic', 'Concepts3D', 'Creality', 'EPAX', 'Elegoo', 'Emake3D', 'FlashForge', 'Kelant', 'Longer', 'Nova3D', 'Peopoly', 'Phrozen', 'QIDI', 'UniFormation', 'Uniz', 'Voxelab', 'Wanhao', 'Zortrax', 'Anet'];
for (const f of fs.readdirSync(UVT).filter((x) => x.endsWith('.ini')).sort()) {
  const ini = Object.fromEntries(fs.readFileSync(path.join(UVT, f), 'utf8').split('\n').map((l) => /^(\w+)\s*=\s*(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2]]));
  let full = f.replace(/\.ini$/, '');
  if (/^UVtools Prusa/.test(full)) full = full.replace(/^UVtools /, 'Prusa ');
  const brand = [...BRANDS, 'Prusa'].find((b) => full.startsWith(`${b} `)) || full.split(' ')[0];
  const w = Number(ini.display_width), hgt = Number(ini.display_height), px = Number(ini.display_pixels_x), py = Number(ini.display_pixels_y), z = Number(ini.max_print_height);
  const big = Math.max(px, py);
  const kLabel = big >= 15000 ? '16K' : big >= 11000 ? '12K' : big >= 9000 ? '10K' : big >= 7000 ? '8K' : big >= 5500 ? '6K' : big >= 4500 ? '5K' : big >= 3800 ? '4K' : big >= 2400 ? '2K' : `${px} × ${py}`;
  const e = { b: brand, n: full.slice(brand.length + 1), build: `${round(w)} × ${round(hgt)} × ${round(z)}`, screen: `${kLabel} (${px} × ${py})` };
  if (w && px) e.xy = Math.round((w / px) * 1000 * 10) / 10;
  const fmt = /FILEFORMAT_(\w+)/.exec(ini.printer_notes || '')?.[1];
  if (fmt && !/encrypted/i.test(fmt)) e.file = `.${fmt.toLowerCase()}`;
  resin.push(e);
}
// A few current resin printers the profiles don't have yet (maker's figures).
resin.push(
  { b: 'Elegoo', n: 'Saturn 4 Ultra 16K', build: '211.68 × 118.37 × 220', screen: '16K (15120 × 6230)', xy: 14 },
  { b: 'Anycubic', n: 'Photon Mono M7 Max', build: '298 × 164 × 300', screen: '7K', xy: 46 },
  { b: 'Prusa', n: 'SL1S Speed', build: '127 × 80 × 150', screen: '2.5K (1620 × 2560)', xy: 49.7 },
  { b: 'Formlabs', n: 'Form 4', build: '200 × 125 × 210', screen: 'Backlit LCD (MSLA)', xy: 50 },
  { b: 'Formlabs', n: 'Form 3+', build: '145 × 145 × 185', screen: 'Laser (SLA)', xy: 25 },
);
const seenR = new Set();
const resinOut = resin.filter((e) => { const k = `${e.b}|${e.n}`.toLowerCase(); if (seenR.has(k)) return false; seenR.add(k); return true; })
  .sort((a, b) => a.b.localeCompare(b.b) || a.n.localeCompare(b.n, undefined, { numeric: true }));

// ---------- painting tools and brushes (made for ModelVault) ----------
// Each: [category, brand, name, fields]. Fields use the same keys as the Tools form.
const AB = (brand, name, needle, feed, action, cup, extra = {}) => ['airbrush', brand, name, { needle, feed, action, ...(cup ? { cup } : {}), ...extra }];
const items = [
  AB('Harder & Steenbeck', 'Infinity CR plus 2in1', '0.15', 'Gravity', 'Dual action', 2, { notes: 'Comes with 0.15 and 0.4 mm needles and 2 ml and 5 ml cups.' }),
  AB('Harder & Steenbeck', 'Infinity CR plus', '0.15', 'Gravity', 'Dual action', 2),
  AB('Harder & Steenbeck', 'Evolution Silverline 2in1', '0.2', 'Gravity', 'Dual action', 2, { notes: 'Comes with 0.2 and 0.4 mm needles and 2 ml and 5 ml cups.' }),
  AB('Harder & Steenbeck', 'Evolution CR plus', '0.2', 'Gravity', 'Dual action', 2),
  AB('Harder & Steenbeck', 'Ultra 2in1', '0.2', 'Gravity', 'Dual action', 2, { notes: 'Comes with 0.2 and 0.4 mm needles.' }),
  AB('Harder & Steenbeck', 'Ultra', '0.2', 'Gravity', 'Dual action', 2),
  AB('Iwata', 'Eclipse HP-CS', '0.35', 'Gravity', 'Dual action', 9),
  AB('Iwata', 'Eclipse HP-BCS', '0.5', 'Siphon / bottom feed', 'Dual action'),
  AB('Iwata', 'Neo CN', '0.35', 'Gravity', 'Dual action', 9),
  AB('Iwata', 'Revolution CR', '0.5', 'Gravity', 'Dual action', 9),
  AB('Iwata', 'Revolution BR', '0.5', 'Siphon / bottom feed', 'Dual action'),
  AB('Iwata', 'High Performance HP-C Plus', '0.3', 'Gravity', 'Dual action', 9),
  AB('Iwata', 'High Performance HP-B Plus', '0.2', 'Gravity', 'Dual action'),
  AB('Iwata', 'Hi-Line HP-CH', '0.3', 'Gravity', 'Dual action'),
  AB('Badger', 'Patriot 105', '0.5', 'Gravity', 'Dual action'),
  AB('Badger', 'Renegade Krome', '0.2', 'Gravity', 'Dual action'),
  AB('GSI Creos (Mr. Hobby)', 'Procon Boy WA Platinum 0.3 (PS-289)', '0.3', 'Gravity', 'Dual action'),
  AB('GSI Creos (Mr. Hobby)', 'Procon Boy FWA Platinum 0.2 (PS-270)', '0.2', 'Gravity', 'Dual action'),
  AB('GSI Creos (Mr. Hobby)', 'Procon Boy LWA Trigger 0.5 (PS-770)', '0.5', 'Gravity', 'Trigger'),
  AB('Sparmax', 'GP-35', '0.35', 'Gravity', 'Dual action'),
  AB('Paasche', 'Talon TG', '0.38', 'Gravity', 'Dual action'),
  AB('Paasche', 'VL', '0.55', 'Siphon / bottom feed', 'Dual action'),
  AB('Fengda', 'BD-130', '0.3', 'Gravity', 'Dual action'),
  AB('Generic', 'Dual-action gravity airbrush 0.3 mm', '0.3', 'Gravity', 'Dual action'),
  AB('Generic', 'Dual-action gravity airbrush 0.5 mm', '0.5', 'Gravity', 'Dual action'),
  ['compressor', 'Iwata', 'Smart Jet Pro', { regulator: true, trap: true }],
  ['compressor', 'Iwata', 'Ninja Jet', {}],
  ['compressor', 'Iwata', 'Sprint Jet', {}],
  ['compressor', 'Iwata', 'Power Jet Pro', { regulator: true, trap: true }],
  ['compressor', 'Sparmax', 'TC-620X', { regulator: true, trap: true }],
  ['compressor', 'Sparmax', 'Arism Mini', {}],
  ['compressor', 'Fengda', 'FD-186', { tank: 3, regulator: true, trap: true }],
  ['compressor', 'GSI Creos (Mr. Hobby)', 'Mr. Linear Compressor L5', { regulator: true }],
  ['compressor', 'Badger', 'TC910 Aspire Pro', { regulator: true, trap: true }],
  ['compressor', 'Generic', 'Mini compressor with tank', { regulator: true, trap: true }],
  ['mask', '3M', '6200 half-mask respirator', { maskType: 'Half-mask respirator', filter: '6001 organic vapour cartridges (A1) + P2 pre-filters' }],
  ['mask', '3M', '7502 half-mask respirator (silicone)', { maskType: 'Half-mask respirator', filter: '6001 organic vapour cartridges (A1) + P2 pre-filters' }],
  ['mask', '3M', '6800 full-face respirator', { maskType: 'Full-face respirator', filter: '6001 organic vapour cartridges (A1) + P2 pre-filters' }],
  ['mask', '3M', '4251+ maintenance-free respirator', { maskType: 'Half-mask respirator', filter: 'FFA1P2 R D' }],
  ['mask', '3M', '4255+ maintenance-free respirator', { maskType: 'Half-mask respirator', filter: 'FFA2P3 R D' }],
  ['mask', 'GVS', 'Elipse A1P3 half mask', { maskType: 'Half-mask respirator', filter: 'A1P3' }],
  ['mask', 'Generic', 'FFP2 dust mask', { maskType: 'Dust mask (FFP2/FFP3)' }],
  ['mask', 'Generic', 'FFP3 dust mask', { maskType: 'Dust mask (FFP2/FFP3)' }],
  ['mask', 'Generic', 'Nitrile gloves', { maskType: 'Nitrile gloves' }],
  ['mask', 'Generic', 'Safety glasses', { maskType: 'Safety glasses' }],
  ['masking', 'Tamiya', 'Masking Tape 6 mm', { maskingType: 'Masking tape', width: '6 mm' }],
  ['masking', 'Tamiya', 'Masking Tape 10 mm', { maskingType: 'Masking tape', width: '10 mm' }],
  ['masking', 'Tamiya', 'Masking Tape 18 mm', { maskingType: 'Masking tape', width: '18 mm' }],
  ['masking', 'Tamiya', 'Masking Tape for Curves 5 mm', { maskingType: 'Masking tape', width: '5 mm' }],
  ['masking', 'Vallejo', 'Liquid Mask', { maskingType: 'Liquid mask' }],
  ['masking', 'Humbrol', 'Maskol', { maskingType: 'Liquid mask' }],
  ['masking', 'Bostik', 'Blu Tack', { maskingType: 'Masking putty' }],
  ['palette', 'Redgrass Games', 'Everlasting Wet Palette', { paletteType: 'Wet palette' }],
  ['palette', 'The Army Painter', 'Wet Palette', { paletteType: 'Wet palette' }],
  ['palette', 'Masterson', 'Sta-Wet Handy Palette', { paletteType: 'Wet palette' }],
  ['palette', 'Generic', 'Ceramic palette', { paletteType: 'Ceramic' }],
  ['palette', 'Generic', 'Plastic well palette', { paletteType: 'Plastic' }],
  ['booth', 'Generic', 'Spray booth with extraction fan', {}],
  ['light', 'Donegan', 'OptiVISOR LX head magnifier', {}],
  ['light', 'Generic', 'Daylight LED desk lamp (5000–6500 K)', {}],
  ['light', 'Generic', 'Magnifier lamp', {}],
  ['hobby', 'Xuron', '2175 Maxi-Shear flush cutter', { toolType: 'Sprue cutters' }],
  ['hobby', 'GodHand', 'SPN-120 Ultimate Nipper', { toolType: 'Sprue cutters' }],
  ['hobby', 'Tamiya', 'Sharp Pointed Side Cutter (74035)', { toolType: 'Sprue cutters' }],
  ['hobby', 'Citadel', 'Fine Detail Cutters', { toolType: 'Sprue cutters' }],
  ['hobby', 'Citadel', 'Mouldline Remover', { toolType: 'Files' }],
  ['hobby', 'X-Acto', '#1 knife with #11 blades', { toolType: 'Hobby knife' }],
  ['hobby', 'Generic', 'Pin vise with micro drill bits', { toolType: 'Pin vise / drill' }],
  ['hobby', 'Generic', 'Self-healing cutting mat', { toolType: 'Cutting mat' }],
  ['hobby', 'Generic', 'Painting handle', { toolType: 'Clamp / holder' }],
  ['hobby', 'Generic', 'Sculpting tool set', { toolType: 'Sculpting tools' }],
  ['printtool', 'Hakko', 'CHP-170 micro cutter', { toolType: 'Flush cutters' }],
  ['printtool', 'Generic', 'Deburring tool', { toolType: 'Deburring tool' }],
  ['printtool', 'Generic', 'Digital calipers', { toolType: 'Calipers' }],
  ['printtool', 'Generic', 'Nozzle cleaning needles', { toolType: 'Nozzle cleaning' }],
  ['printtool', 'Generic', 'Scraper', { toolType: 'Scraper / spatula' }],
  ['dryer', 'Sunlu', 'FilaDryer S2', { spools: 1 }],
  ['dryer', 'Sunlu', 'FilaDryer S4', { spools: 4 }],
  ['dryer', 'Creality', 'Space Pi filament dryer', { spools: 1 }],
  ['dryer', 'eSun', 'eBox Lite', { spools: 1 }],
  ['dryer', 'Polymaker', 'PolyDryer', { spools: 1 }],
  ['washcure', 'Elegoo', 'Mercury Plus 2-in-1 wash and cure', {}],
  ['washcure', 'Elegoo', 'Mercury XS Bundle', {}],
  ['washcure', 'Anycubic', 'Wash & Cure 2.0', {}],
  ['washcure', 'Anycubic', 'Wash & Cure 3', {}],
  ['washcure', 'Anycubic', 'Wash & Cure 3 Plus', {}],
  ['washcure', 'Anycubic', 'Wash & Cure Max', {}],
  ['washcure', 'Creality', 'UW-01 wash and cure', {}],
  ['washcure', 'Creality', 'UW-03 wash and cure', {}],
].map(([cat, b, n, f]) => ({ cat, b, n, f }));

// Brush series: pick one and tick the sizes you have.
const brushes = [
  { b: 'Winsor & Newton', n: 'Series 7', shape: 'Round', hair: 'Kolinsky sable', sizes: ['3/0', '2/0', '0', '1', '2', '3', '4', '5', '6'] },
  { b: 'Winsor & Newton', n: 'Series 7 Miniature', shape: 'Detail / liner', hair: 'Kolinsky sable', sizes: ['3/0', '2/0', '0', '1', '2', '3'] },
  { b: 'Raphael', n: '8404', shape: 'Round', hair: 'Kolinsky sable', sizes: ['3/0', '2/0', '0', '1', '2', '3', '4'] },
  { b: 'Rosemary & Co', n: 'Series 33', shape: 'Round', hair: 'Kolinsky sable', sizes: ['3/0', '2/0', '0', '1', '2', '3', '4'] },
  { b: 'da Vinci', n: 'Maestro Series 10', shape: 'Round', hair: 'Kolinsky sable', sizes: ['3/0', '2/0', '0', '1', '2', '3', '4'] },
  { b: 'Artis Opus', n: 'Series S', shape: 'Round', hair: 'Kolinsky sable', sizes: ['3/0', '2/0', '0', '1', '2'] },
  { b: 'Artis Opus', n: 'Series M', shape: 'Round', hair: 'Kolinsky sable', sizes: ['0', '1', '2', '3'] },
  { b: 'Artis Opus', n: 'Series D (drybrush)', shape: 'Drybrush', hair: '', sizes: ['Small', 'Medium', 'Large'] },
  { b: 'The Army Painter', n: 'Wargamer', shape: 'Round', hair: 'Kolinsky sable', sizes: [], named: ['Insane Detail', 'Detail', 'Character', 'Regiment', 'Monster'] },
  { b: 'The Army Painter', n: 'Wargamer drybrush', shape: 'Drybrush', hair: 'Synthetic', sizes: [], named: ['Small Drybrush', 'Large Drybrush'] },
  { b: 'The Army Painter', n: 'Hobby', shape: 'Round', hair: 'Synthetic', sizes: [], named: ['Fine Detail', 'Highlighting', 'Precise Detail', 'Basecoating'] },
  { b: 'Citadel', n: 'Layer', shape: 'Round', hair: 'Synthetic', sizes: ['Small', 'Medium', 'Large'] },
  { b: 'Citadel', n: 'Artificer Layer', shape: 'Round', hair: 'Sable', sizes: ['Small', 'Medium', 'Large'] },
  { b: 'Citadel', n: 'Base', shape: 'Round', hair: 'Synthetic', sizes: ['Small', 'Medium', 'Large'] },
  { b: 'Citadel', n: 'Shade', shape: 'Glaze / wash', hair: 'Synthetic', sizes: ['Small', 'Medium', 'Large'] },
  { b: 'Citadel', n: 'Dry', shape: 'Drybrush', hair: 'Synthetic', sizes: ['Small', 'Medium', 'Large'] },
  { b: 'Princeton', n: 'Velvetouch 3950', shape: 'Round', hair: 'Synthetic', sizes: ['10/0', '5/0', '3/0', '2/0', '0', '1', '2', '4', '6'] },
  { b: 'Princeton', n: 'Velvetouch 3950 Liner', shape: 'Detail / liner', hair: 'Synthetic', sizes: ['10/0', '5/0', '3/0', '0', '1'] },
  { b: 'Generic', n: 'Synthetic detail brush', shape: 'Detail / liner', hair: 'Synthetic', sizes: ['20/0', '10/0', '5/0', '3/0', '2/0', '0', '1', '2'] },
  { b: 'Generic', n: 'Flat brush', shape: 'Flat', hair: 'Synthetic', sizes: ['2', '4', '6', '8', '10', '12'] },
  { b: 'Generic', n: 'Makeup brush (drybrushing)', shape: 'Drybrush', hair: 'Synthetic', sizes: ['Small', 'Medium', 'Large'] },
];

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'catalogue.json'), JSON.stringify({
  source: 'FDM printers: OrcaSlicer printer profiles. Resin printers: UVtools PrusaSlicer printer profiles. Painting tools and brushes: ModelVault.',
  fdm: fdmOut, resin: resinOut, items, brushes,
}));
console.log(fdmOut.length, 'FDM printers,', resinOut.length, 'resin printers,', items.length, 'tools,', brushes.length, 'brush series');
