// Fill in a new model's details from its file names: name, designer, year, categories, tags and source link.
// Uses the person's own library too: designers they already have, and words that past models with a
// category had in their names (for example "Vader" → Star Wars once a few Vader models are filed that way).

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'model', 'models', 'print', 'printable', 'files', 'file', 'stl', 'stls', 'version', 'final',
  'pack', 'part', 'parts', 'set', 'full', 'body', 'size', 'scale', 'support', 'supports', 'supported', 'presupported', 'unsupported', 'images', 'image', 'renders', 'lychee']);

// Words that point to a Type value (matched to whatever Type values the person has, by the first name that exists).
const TYPE_WORDS = [
  [/\bbusts?\b/, ['Bust']],
  [/\bdioramas?\b/, ["Diorama's", 'Diorama', 'Dioramas']],
  [/\b(statue|figure|figurine)s?\b/, ['Figure & Statue', 'Statue', 'Figure']],
  [/\b(miniatures?|minis?|28 ?mm|32 ?mm|35 ?mm)\b/, ['Miniature', 'Miniatures']],
  [/\b(terrain|scenery|tiles?)\b/, ['Terrain & Scenery', 'Terrain']],
  [/\b(articulated|flexi|print in place|pip)\b/, ['Articulated / Print-in-place', 'Articulated']],
  [/\b(cosplay|helmet|mask|wearable|prop)s?\b/, ['Cosplay & Prop', 'Cosplay', 'Prop']],
  [/\b(vehicle|car|truck|tank|spaceship|starship|ship|motorbike|motorcycle)s?\b/, ['Vehicle', 'Vehicles']],
  [/\b(organi[sz]er|storage|box|drawer|tray)s?\b/, ['Organizer & Storage']],
  [/\b(tool|clamp|jig|bracket|holder|mount|hook|adapter|wrench|funnel|compass)s?\b/, ['Functional / Tool', 'Functional', 'Tool']],
  [/\b(toy|game|dice|puzzle|fidget)s?\b/, ['Toy & Game', 'Toy', 'Game']],
  [/\b(vase|lamp|decor|wall art|poster|planter|sign)s?\b/, ['Decor & Art', 'Decor']],
  [/\b(kit|multi ?part)s?\b/, ['Kit / Multi-part']],
];
// Characters and words that point to a franchise (used only when that franchise is in the person's list).
const FRANCHISE_WORDS = [
  [/\b(star ?wars|vader|stormtroopers?|mandalorian|mando|grogu|yoda|jedi|sith|boba fett|clone troopers?|chewbacca|r2 ?d2|kylo|ahsoka|death trooper|scout trooper)\b/, ['Star Wars', 'Starwars']],
  [/\b(marvel|iron ?man|spider ?man|hulk|thor|captain america|venom|deadpool|wolverine|thanos|loki|black widow|moon ?knight|x ?men|groot|black panther|doctor strange|carnage|ghost rider|daredevil|punisher|mystique|jean grey|gamora|elektra|magik|emma frost|captain marvel|black cat|spider ?gwen|squirr?el girl|she ?hulk|scarlet witch|rogue)\b/, ['Marvel']],
  [/\b(dc comics|batman|superman|joker|harley quinn|wonder woman|aquaman|catwoman|bane|poison ivy|green lantern|the flash|nightwing|batgirl|batmobile|gotham|power girl|zatt?ann?a|black canary|stargirl|talia)\b/, ['DC']],
  [/\b(lord of the rings|lotr|gandalf|frodo|sauron|gollum|aragorn|legolas|nazgul|balrog|hobbit)\b/, ['The Lord of the Rings', 'Lord of the Rings']],
  [/\b(harry potter|hogwarts|dumbledore|voldemort|hermione|hagrid)\b/, ['Harry Potter']],
  [/\b(warhammer|40k|space marines?|orks?|tyranids?|necrons?|eldar|aeldari|sigmar|chaos marines?|primarch)\b/, ['Warhammer']],
  [/\b(dnd|d ?& ?d|dungeons|beholder|mind flayer|owlbear|tiefling)\b/, ['Dungeons & Dragons']],
  [/\b(pokemon|pokémon|pikachu|charizard|bulbasaur|squirtle|eevee|mewtwo|gengar|snorlax)\b/, ['Pokémon', 'Pokemon']],
  [/\b(zelda|hyrule|triforce|ganondorf)\b/, ['Zelda']],
  [/\b(halo|master chief|cortana)\b/, ['Halo']],
  [/\b(transformers?|optimus|bumblebee|megatron|decepticons?|autobots?)\b/, ['Transformers']],
  [/\b(god of war|kratos|atreus)\b/, ['God of War']],
  [/\b(street fighter|chun ?li|akuma|cammy|juri|dh?alsim)\b/, ['Street Fighter']],
  [/\b(indiana jones|indy)\b/, ['Indiana Jones']],
  [/\b(blade runner|replicant)\b/, ['Blade Runner']],
  [/\b(conan)\b/, ['Conan']],
  [/\b(witcher|geralt|yennefer|triss|ciri)\b/, ['The Witcher', 'Witcher']],
  [/\b(thundercats?|lion ?o|cheetara|tygra|panthro|mumm ?ra)\b/, ['Thundercats']],
  [/\b(rocketeer)\b/, ['The Rocketeer']],
  [/\b(final fantasy|sephiroth|cloud strife|tifa|aerith|yuna|yuffie|vincent valentine|zack fair|squall|tidus|buster sword)\b/, ['Final Fantasy']],
  [/\b(genshin|raiden shogun|nahida|ganyu|keqing|shenhe|yae miko|kazuha|yoimiya|hu tao|mavuika|arlecchino|furina)\b/, ['Genshin Impact']],
];
const RESIN = /\b(resin|lychee|lys|chitubox|ctb|presupported|pre supported|supported)\b/;
const FDM = /\b(fdm|bambu|prusa|orca|3mf|gcode|no supports needed)\b/;

const norm = (s) => ` ${String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[_.\-–—+,;:!()[\]{}]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
const squash = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Junk that download sites and file names carry: watermarks, IDs, "3d printable", scales, support words … */
export function cleanName(raw, { designer = '' } = {}) {
  let n = String(raw || '');
  n = n.replace(/@[\w.-]+/g, ' ')                                  // @stl_zone, @vse_pro_3D
    .replace(/_+/g, ' ')
    .replace(/^\s*[[(]\s*(unknown|telegram|fan ?art|thingiverse|cults ?3d|printables|free|nsfw|sfw)\s*[\])]\s*[-–]?\s*/i, '')
    .replace(/-?\d{8}T\d{6}Z(-\d+)*(-\d{3})?/gi, ' ')                 // Google Drive download stamps
    .replace(/\b(3d ?print(able|ed)?|3d ?models?|stl ?files?|stls?|fan ?art|print ?files?|ready to print|high ?poly|hi ?res|free)\b/gi, ' ')
    .replace(/\b(pre-?supported|un-?supported|supported|no ?supports?|with ?supports?)\b/gi, ' ')
    .replace(/\b1\s*[-_:/]\s*\d{1,2}(th)?(\s*scale)?\b/gi, ' ')      // 1-6, 1_10, 1/12th scale
    .replace(/\b\d{2,3}\s?mm\b/gi, ' ')                               // 75mm
    .replace(/\bv\d+(\.\d+)*\b/gi, ' ')                               // v2, v1.3
    .replace(/\b(lychee|chitubox|lys|ctb|ready ?for ?resin)\b/gi, ' ')        // slicer/format words
    .replace(/\s*(?:[-–]\s*|[([]\s*)(20[12]\d)\s*[)\]]?\s*$/, ' ')     // "- 2024" or "(2024)" at the end: that's the year field
    .replace(/\s+/g, ' ');
  // "(Designer) Name", "[Designer] Name", "Name by Designer": the designer goes in its own field.
  if (designer) {
    const d = escape(designer).replace(/\s+/g, '[\\s_-]*');
    n = n.replace(new RegExp(`^\\s*[\\[(]\\s*${d}\\s*[\\])]\\s*[-–]?\\s*`, 'i'), '')
      .replace(new RegExp(`\\s+by\\s+${d}\\s*$`, 'i'), '')
      .replace(new RegExp(`^\\s*${d}\\s+[-–]\\s+`, 'i'), '')
      .replace(new RegExp(`\\s+[-–]\\s+${d}\\s*$`, 'i'), '')
      .replace(new RegExp(`^\\s*${d}\\s+(?=\\S)`, 'i'), '');
  }
  n = n.replace(/\(\s*\)|\[\s*\]/g, ' ')
    .replace(/\s*[-–]\s*(?=[-–]|$)/g, ' ')        // dangling dashes
    .replace(/^\s*[-–]\s*/, '')
    .replace(/\s+/g, ' ').trim();
  // all lower case or ALL CAPS → Title Case
  if (n && (n === n.toLowerCase() || (n === n.toUpperCase() && /[A-Z]{4}/.test(n)))) n = n.toLowerCase().replace(/(^|[\s(-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
  return n;
}

/**
 * @param lib   the Library (for groups, designers and past models)
 * @param texts file and folder names to read
 * @param files the draft's files (for the 3MF check)
 */
export function guessDetails(lib, { texts = [], files = [], name = '' }) {
  const all = norm(texts.join(' | '));
  const found = [];

  // Designer, most certain first:
  //   1. "(X) …" or "[X] …" at the start of a name (spelled like a designer you already have, if one matches);
  //   2. a designer you already have, written in the model's own name;
  //   3. a designer you already have, in the other file names (longest first);
  //   4. "… by X".
  const known = lib.designers().map((d) => d.name).filter((n) => n.length > 2).sort((a, b) => b.length - a.length);
  const flat = squash(texts.join(' '));
  const placeholder = /^(stl|stls|fdm|resin|nsfw|sfw|free|unknown|telegram|fan ?art|thingiverse|cults ?3d|printables|patreon|pack|v\d.*)$/i;
  const asKnown = (x) => known.find((n) => squash(n) === squash(x)) || x;
  const inText = (t) => { const n1 = norm(t), f1 = squash(t); return known.find((n) => n1.includes(norm(n)) || (squash(n).length > 4 && f1.includes(squash(n)))); };
  let designer = '';
  for (const t of [name, ...texts]) {
    const m = /^\s*[[(]\s*([^\])]{2,40}?)\s*[\])]/.exec(String(t));
    if (m && !/^\d+$/.test(m[1]) && !placeholder.test(m[1].trim())) { designer = asKnown(m[1].replace(/_/g, ' ').trim()); break; }
  }
  if (!designer) designer = inText(name) || '';
  if (!designer) designer = inText(texts.join(' | ')) || '';
  if (!designer) {
    for (const t of texts) {
      const m = /\bby[\s_]+([A-Z][\w-]+(?:[\s_][A-Z][\w-]+){0,2})\s*$/.exec(String(t).replace(/\.[a-z0-9]{2,4}$/i, ''));
      if (m && !placeholder.test(m[1].trim())) { designer = asKnown(m[1].replace(/_/g, ' ').trim()); break; }
    }
  }
  if (designer) found.push('designer');

  const clean = cleanName(name, { designer }) || name;

  // Year: written in a name, or from a Google Drive download stamp.
  let year = null;
  const cur = new Date().getFullYear();
  for (const t of texts) {
    const m = /(?<!\d)(20[12]\d)(?!\d)/.exec(String(t).replace(/\d{8}T\d{6}Z/g, ''));
    if (m && Number(m[1]) <= cur + 1) { year = Number(m[1]); break; }
  }
  if (!year) { const m = /(?<!\d)(20[12]\d)\d{4}T\d{6}Z/.exec(texts.join(' ')); if (m) year = Number(m[1]); }
  if (year) found.push('year');

  // Categories.
  const groups = lib.groups();
  const values = new Set();
  const pick = (groupName, names) => {
    const g = groups.find((x) => x.name.toLowerCase() === groupName.toLowerCase());
    if (!g) return null;
    const hits = g.values.filter((v) => names.some((n) => v.name.toLowerCase() === n.toLowerCase() || squash(v.name) === squash(n)));
    const best = hits.sort((a, b) => (b.count || 0) - (a.count || 0))[0];
    if (best) values.add(best.id);
    return best;
  };
  // 1. A category value written in the name ("Star Wars", "Bust" …). Status (To print, Printed …) is left alone.
  for (const g of groups) {
    if (/^status$/i.test(g.name)) continue;
    for (const v of g.values) {
      const k = norm(v.name);
      if (k.trim().length < 2) continue;
      if (all.includes(k) || (squash(v.name).length > 5 && flat.includes(squash(v.name)))) values.add(v.id);
    }
  }
  // 2. Words that point to a type or a franchise.
  for (const [re, names] of TYPE_WORDS) if (re.test(all)) pick('Type', names);
  for (const [re, names] of FRANCHISE_WORDS) if (re.test(all)) pick('Franchise', names);
  // 3. Print type: resin words, 3MF files or FDM words.
  // Words taught for supports (Settings > Archive names, e.g. "spt") count as resin too.
  const supportWords = texts.some((t) => /presupported/i.test(lib.detectArchive(String(t).replace(/\.[a-z0-9]{2,4}$/i, ''), { ignore: name }).part));
  const resin = RESIN.test(all) || supportWords, fdm = FDM.test(all) || files.some((f) => /\.3mf$/i.test(f.rel || f.name || ''));
  // STL files print on both, so a model with STLs is "FDM & Resin" whatever its name says.
  const stl = files.some((f) => /\.stl$/i.test(f.rel || f.name || '')) || texts.some((t) => /\.stl$/i.test(String(t)));
  const ptype = groups.find((x) => /^print type$/i.test(x.name));
  if (stl && ptype) {
    for (const v of ptype.values) values.delete(v.id);
    if (!pick('Print Type', ['FDM & Resin'])) { pick('Print Type', ['FDM']); pick('Print Type', ['Resin']); }
  } else if (resin && fdm) pick('Print Type', ['FDM & Resin']) || (pick('Print Type', ['Resin']), pick('Print Type', ['FDM']));
  else if (resin) pick('Print Type', ['Resin']);
  else if (fdm) pick('Print Type', ['FDM']);
  // 4. Learned from the library: a word or pair of words that past models with a category nearly always had.
  for (const id of learned(lib, clean, groups)) values.add(id);
  if (values.size) found.push('categories');

  // Tags: scale and supports, read the same way as archive names.
  const tags = new Set();
  for (const t of texts) {
    const a = lib.detectArchive(String(t).replace(/\.[a-z0-9]{2,4}$/i, ''), { ignore: clean });
    if (a.scale) tags.add(a.scale);
    for (const p of a.part.split(' ')) if (/^(presupported|unsupported|nsfw)$/i.test(p)) tags.add(p);
  }
  if (tags.size) found.push('tags');

  // Source link: the one this designer's other models use.
  let source_url = '';
  if (designer) {
    source_url = lib.db.prepare(`SELECT source_url FROM models WHERE designer = ? COLLATE NOCASE AND source_url <> '' GROUP BY source_url ORDER BY COUNT(*) DESC LIMIT 1`).get(designer)?.source_url || '';
    if (source_url) found.push('source link');
  }
  return { name: clean, designer, year, values: [...values], tags: [...tags], source_url, found };
}

/** Category values that models with the same distinctive words in their names nearly always have. */
function learned(lib, name, groups) {
  const words = (s) => norm(s).trim().split(' ').filter((w) => w.length > 3 && !STOP.has(w) && !/^\d+$/.test(w));
  const keys = (s) => { const w = words(s); return [...new Set([...w, ...w.slice(1).map((x, i) => `${w[i]} ${x}`)])]; };
  const want = keys(name);
  if (!want.length) return [];
  // Type and print type come from the files themselves; status is the person's own progress.
  const skip = new Set(groups.filter((g) => /^(status|type|print type)$/i.test(g.name)).flatMap((g) => g.values.map((v) => v.id)));
  const rows = lib.db.prepare(`SELECT m.name, (SELECT group_concat(value_id) FROM model_values WHERE model_id = m.id) AS vals FROM models m`).all();
  const out = new Set();
  for (const k of want) {
    const with_ = rows.filter((r) => keys(r.name).includes(k));
    if (with_.length < 2 || with_.length > 40) continue; // too rare to trust, or too common to mean anything
    const counts = new Map();
    for (const r of with_) for (const v of String(r.vals || '').split(',').map(Number).filter(Boolean)) counts.set(v, (counts.get(v) || 0) + 1);
    for (const [v, c] of counts) if (!skip.has(v) && c / with_.length >= 0.8) out.add(v);
  }
  return [...out];
}
