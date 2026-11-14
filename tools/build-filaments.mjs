// Builds public/materials/filaments.json from SpoolmanDB (github.com/Donkie/SpoolmanDB, MIT licence).
// Usage: node tools/build-filaments.mjs /path/to/SpoolmanDB
// One entry per colour; weights and diameters are kept as lists.
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2];
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'materials');
if (!SRC) { console.error('Give the SpoolmanDB folder'); process.exit(1); }

const brands = [];
const out = [];
const hex = (x) => `#${String(x).slice(0, 6).toUpperCase()}`;
for (const file of fs.readdirSync(path.join(SRC, 'filaments')).filter((f) => f.endsWith('.json')).sort()) {
  const d = JSON.parse(fs.readFileSync(path.join(SRC, 'filaments', file), 'utf8'));
  const bi = brands.push(d.manufacturer) - 1;
  for (const f of d.filaments) {
    for (const c of f.colors) {
      const e = {
        b: bi,
        n: String(f.name).replace('{color_name}', c.name).replace(/\s+/g, ' ').trim(),
        c: c.name,
        m: f.material,
        h: c.hex ? hex(c.hex) : null,
        hs: c.hexes ? c.hexes.map(hex) : undefined,
        d: f.diameters,
        w: (f.weights || []).map((w) => [w.weight, w.spool_weight ?? null]),
        t: f.extruder_temp ?? undefined,
        bt: f.bed_temp ?? undefined,
        den: f.density,
      };
      const finish = c.finish || f.finish, pattern = c.pattern || f.pattern, tr = c.translucent ?? f.translucent, gl = c.glow ?? f.glow, mc = c.multi_color_direction || f.multi_color_direction;
      if (finish) e.f = finish;
      if (pattern) e.p = pattern;
      if (tr) e.tr = 1;
      if (gl) e.gl = 1;
      if (mc) e.mc = mc;
      if (!e.h && e.hs) e.h = e.hs[0];
      if (!e.h) continue;
      out.push(e);
    }
  }
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'filaments.json'), JSON.stringify({ source: 'SpoolmanDB (github.com/Donkie/SpoolmanDB), MIT licence', brands, filaments: out }));
fs.copyFileSync(path.join(SRC, 'LICENSE'), path.join(OUT, 'LICENSE-filament-data.txt'));
console.log(brands.length, 'brands,', out.length, 'filaments');
