// Your paints and colour tools: My paints, shopping list, paint lists, racks, explore by colour, colour tools,
// and paint schemes for models. Loaded together with paints.js.
import {
  S, helpers, saveDoc, lab, deltaE, labHex, lchOf, fromLch, hexRgb, familyOf, swatchStyle, closeness, inkOn, brandName,
  groupOf, NOCOLOUR, openPaint, draw, normHex, mixHex, fmt, FAMILIES, FAMILY_DOT, setSection, tile,
} from './paints.js';

const h = () => helpers();
const el = (...a) => h().el(...a);
const svg = (p) => h().svg(p);
const X = '<path d="m6 6 12 12M18 6 6 18"/>';
const UI = { list: null, listBrand: '', tool: 'picture', mineGroup: 'family', mineQ: '', explore: { hue: 265, width: 18, neutral: false, brand: '', mine: false, box: null }, pic: null, grad: {}, thin: null, contrast: {} };
const uid = () => Math.random().toString(36).slice(2, 10);
const owned = (p) => !!S.docs.owned[p.id];
const pdesc = (p) => `${brandName(p.b)} · ${p.r}${p.c ? ` · ${p.c}` : ''}`;
const plain = (p) => `${p.n} (${brandName(p.b)} ${p.r}${p.c ? ` ${p.c}` : ''})`;

// ---------- small shared pieces ----------
function chipRow(p, { extra = null, onclick = null } = {}) {
  return el('button', { type: 'button', class: 'pm-row', onclick: onclick || (() => openPaint(p)) },
    el('span', { class: 'pdot big', style: swatchStyle(p) }),
    el('span', { class: 'pm-name' }, el('b', {}, p.n, owned(p) ? el('span', { class: 'own-tag' }, 'Owned') : ''), el('small', {}, pdesc(p))),
    extra);
}
function head(title, sub, ...actions) {
  return el('div', { class: 'pv-head' }, el('div', {}, el('h2', {}, title), sub && el('p', { class: 'muted' }, sub)), el('div', { class: 'pv-acts' }, ...actions));
}
const btn = (label, onclick, cls = 'ghost') => el('button', { type: 'button', class: `btn small ${cls}`, onclick }, label);
function emptyBox(text, ...actions) { return el('div', { class: 'empty pv-empty' }, el('p', {}, text), ...actions); }
function nearest(target, { brand = '', mineOnly = false, group = 'solid', exclude = null, n = 1 } = {}) {
  const out = [];
  for (const q of S.paints) {
    if (q.g || NOCOLOUR.has(q.k) || q === exclude) continue;
    if (group && groupOf(q) !== group) continue;
    if (brand && q.b !== brand) continue;
    if (mineOnly && !owned(q)) continue;
    out.push({ p: q, d: deltaE(target, q.lab) });
  }
  out.sort((a, b) => a.d - b.d);
  if (n === 1) return out[0] || null;
  // The same paint sold in two ranges or sizes counts once.
  const seen = new Set(), res = [];
  for (const x of out) { const k = `${x.p.b}|${x.p.n.toLowerCase().replace(/\s*\d+\s*ml$/, '')}`; if (seen.has(k)) continue; seen.add(k); res.push(x); if (res.length >= n) break; }
  return res;
}
function brandSelect(value, onchange, { any = 'Any brand', mine = false } = {}) {
  return el('label', { class: 'select-wrap small' }, el('span', { class: 'sr-only' }, 'Brand'),
    el('select', { onchange: (e) => onchange(e.target.value) },
      el('option', { value: '' }, any),
      mine && el('option', { value: 'mine', selected: value === 'mine' }, 'Only paints I own'),
      Object.keys(S.brands).sort((a, b) => brandName(a).localeCompare(brandName(b))).map((k) => el('option', { value: k, selected: value === k }, brandName(k)))));
}
const matchOpts = (v) => (v === 'mine' ? { mineOnly: true } : { brand: v });
function copyText(text, what) { navigator.clipboard?.writeText(text).then(() => h().toast(`${what} copied`), () => h().toast('Copying isn\'t allowed here; select the text instead.', true)); }

/** A dialog to choose one paint: search by name, code or #colour. Paints you own come first. */
export function pickPaint({ title = 'Choose a paint', ownedFirst = true, onlyOwned = false, filter = null } = {}) {
  return new Promise((resolve) => {
    let d = document.getElementById('paint-pick-dlg');
    if (!d) { d = el('dialog', { id: 'paint-pick-dlg', class: 'sheet narrow', 'aria-labelledby': 'pick-h' }); document.body.append(d); }
    let done = false;
    const finish = (p) => { if (done) return; done = true; d.close(); resolve(p); };
    d.onclose = () => finish(null);
    d.onclick = (e) => { if (e.target === d) finish(null); };
    let mineOnly = onlyOwned;
    const list = el('ul', { class: 'pick-list', role: 'list' });
    const q = el('input', { type: 'search', placeholder: 'Name, code, brand or #colour', autocomplete: 'off', oninput: () => fill() });
    const fill = () => {
      const text = q.value.trim().toLowerCase();
      const hex = normHex(text);
      let pool = S.paints.filter((p) => (!p.g || owned(p)) && (!mineOnly || owned(p)) && (!filter || filter(p)));
      let rows;
      if (hex && /^#|^[0-9a-f]{6}$/i.test(text)) { const t = lab(hex); rows = pool.filter((p) => !NOCOLOUR.has(p.k)).map((p) => ({ p, d: deltaE(t, p.lab) })).sort((a, b) => a.d - b.d).slice(0, 60); }
      else {
        if (text) pool = pool.filter((p) => text.split(/\s+/).every((t) => `${p.n} ${p.c} ${brandName(p.b)} ${p.r}`.toLowerCase().includes(t)));
        rows = pool.sort((a, b) => (ownedFirst ? owned(b) - owned(a) : 0) || a.n.localeCompare(b.n)).slice(0, 80).map((p) => ({ p }));
      }
      list.replaceChildren(...(rows.length ? rows.map((x) => el('li', {}, chipRow(x.p, { onclick: () => finish(x.p), extra: x.d != null ? el('span', { class: 'pm-close d1' }, `ΔE ${fmt(x.d)}`) : null })))
        : [el('li', { class: 'muted pick-none' }, mineOnly ? 'None of the paints you own match. Untick "Only paints I own" to search them all.' : 'No paints match.')]));
    };
    d.replaceChildren(
      el('header', { class: 'sheet-head' }, el('h2', { id: 'pick-h' }, title),
        el('button', { class: 'icon-btn close', type: 'button', 'aria-label': 'Close', onclick: () => finish(null) }, svg(X))),
      el('div', { class: 'sheet-body stack' },
        el('label', { class: 'search' }, el('span', { class: 'sr-only' }, 'Search paints'), svg('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'), q),
        el('label', { class: 'check small-check' }, el('input', { type: 'checkbox', checked: mineOnly, onchange: (e) => { mineOnly = e.target.checked; fill(); } }), el('span', {}, 'Only paints I own')),
        list));
    fill();
    d.showModal();
    q.focus();
  });
}

// ---------- owning, shopping, lists (also used from the paint window) ----------
export async function toggleOwned(p) {
  if (S.docs.owned[p.id]) {
    delete S.docs.owned[p.id];
    h().toast(`${p.n} removed from your paints`);
  } else {
    S.docs.owned[p.id] = { qty: 1, added: Date.now() };
    const wasOnList = !!S.docs.shopping[p.id];
    if (wasOnList) { delete S.docs.shopping[p.id]; await saveDoc('shopping'); }
    h().toast(wasOnList ? `${p.n} added to your paints and taken off the shopping list` : `${p.n} added to your paints`);
  }
  await saveDoc('owned');
  draw();
}
export async function toggleShopping(p) {
  if (S.docs.shopping[p.id]) delete S.docs.shopping[p.id];
  else S.docs.shopping[p.id] = { qty: 1, added: Date.now() };
  await saveDoc('shopping');
  h().toast(S.docs.shopping[p.id] ? `${p.n} added to the shopping list` : `${p.n} taken off the shopping list`);
  draw();
}
export async function addToList(p) {
  const lists = S.docs.lists;
  const d = el('dialog', { class: 'sheet narrow', 'aria-label': 'Add to a list' });
  document.body.append(d);
  const name = el('input', { name: 'name', placeholder: 'New list name, e.g. Ultramarines' });
  const sel = el('select', { name: 'list', class: 'set-select' }, lists.map((l) => el('option', { value: l.id }, `${l.name} (${l.items.length})`)), el('option', { value: '' }, 'New list…'));
  const f = el('form', { class: 'sheet-body stack', onsubmit: async (e) => {
    e.preventDefault();
    let l = lists.find((x) => x.id === sel.value);
    if (!l) { if (!name.value.trim()) { h().toast('Give the new list a name.', true); return; } l = { id: uid(), name: name.value.trim(), note: '', items: [], created: Date.now() }; lists.push(l); }
    if (!l.items.some((i) => i.id === p.id)) l.items.push({ id: p.id, note: '' });
    await saveDoc('lists');
    d.close(); h().toast(`${p.n} added to ${l.name}`); draw();
  } },
    lists.length ? el('label', { class: 'field' }, el('span', {}, 'List'), sel) : '',
    el('label', { class: 'field' }, el('span', {}, lists.length ? 'Or a new list' : 'New list'), name),
    el('div', { class: 'form-actions' }, el('button', { class: 'btn primary', type: 'submit' }, 'Add to list'), el('button', { class: 'btn ghost', type: 'button', onclick: () => d.close() }, 'Cancel')));
  if (!lists.length) sel.value = '';
  d.append(el('header', { class: 'sheet-head' }, el('h2', {}, `Add ${p.n} to a list`), el('button', { class: 'icon-btn close', type: 'button', 'aria-label': 'Close', onclick: () => d.close() }, svg(X))), f);
  d.addEventListener('close', () => d.remove());
  d.showModal();
}
/** "A-3-2": rack code, row, slot. */
export function slotLabel(slot) {
  const [rid, r, c] = String(slot || '').split(':');
  const rack = S.docs.racks.find((x) => x.id === rid);
  return rack ? `${rack.code}-${Number(r) + 1}-${Number(c) + 1}` : '';
}

// ---------- My paints ----------
function renderMine(root) {
  const mine = S.paints.filter(owned);
  const q = UI.mineQ.toLowerCase();
  const shown = mine.filter((p) => !q || `${p.n} ${p.c} ${brandName(p.b)} ${p.r}`.toLowerCase().includes(q));
  const unplaced = mine.filter((p) => !S.docs.owned[p.id].slot).length;
  const groups = new Map();
  const keyOf = UI.mineGroup === 'brand' ? (p) => brandName(p.b) : UI.mineGroup === 'kind' ? (p) => (p.m ? 'Metallic' : { Wash: 'Washes & shades', Ink: 'Inks', Contrast: 'Contrast & one-coat', Glaze: 'Glazes', Primer: 'Primers', Varnish: 'Varnishes', Medium: 'Mediums' }[p.k] || 'Paints') : (p) => (p.m ? 'Metallics' : familyOf(p));
  for (const p of shown) (groups.get(keyOf(p)) || groups.set(keyOf(p), []).get(keyOf(p))).push(p);
  const order = UI.mineGroup === 'family' ? [...FAMILIES, 'Metallics'].filter((f) => groups.has(f)) : [...groups.keys()].sort();
  const mtile = (p) => el('button', { type: 'button', class: 'mtile', onclick: () => openPaint(p), title: plain(p) },
    el('span', { class: 'mswatch', style: swatchStyle(p) }, S.docs.owned[p.id].qty > 1 && el('span', { class: 'mqty', style: `color:${inkOn(p.h)}` }, `×${S.docs.owned[p.id].qty}`)),
    el('b', {}, p.n), el('small', {}, `${brandName(p.b)} · ${p.r}`), S.docs.owned[p.id].slot && el('small', { class: 'mslot' }, slotLabel(S.docs.owned[p.id].slot)));
  root.replaceChildren(
    head('My paints', mine.length ? `${mine.length} paint${mine.length === 1 ? '' : 's'}, ${Object.values(S.docs.owned).reduce((n, o) => n + (o.qty || 1), 0)} pots${unplaced && S.docs.racks.length ? ` · ${unplaced} not on a rack yet` : ''}` : null,
      btn('Add paints I own', async () => { for (;;) { const p = await pickPaint({ title: 'Add a paint you own', ownedFirst: false, filter: (x) => !owned(x) }); if (!p) break; await toggleOwned(p); } }, 'primary'),
      mine.length > 0 && btn('Copy as text', () => copyText(order.map((g) => `${g}\n${groups.get(g).map((p) => `  ${plain(p)}${S.docs.owned[p.id].qty > 1 ? ` ×${S.docs.owned[p.id].qty}` : ''}${S.docs.owned[p.id].slot ? ` [${slotLabel(S.docs.owned[p.id].slot)}]` : ''}`).join('\n')}`).join('\n\n'), 'Your paint list'))),
    !mine.length ? emptyBox('You haven\'t marked any paints as yours yet. Open any paint and press "I own this?", or add them here.', btn('Add paints I own', async () => { const p = await pickPaint({ title: 'Add a paint you own', ownedFirst: false }); if (p) toggleOwned(p); }, 'primary'))
      : el('div', {},
        el('div', { class: 'view-bar' },
          el('label', { class: 'search small' }, el('span', { class: 'sr-only' }, 'Filter your paints'), svg('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
            el('input', { type: 'search', placeholder: 'Filter your paints', value: UI.mineQ, oninput: (e) => { UI.mineQ = e.target.value; clearTimeout(UI.mt); UI.mt = setTimeout(() => { renderMine(root); const i = root.querySelector('input[type=search]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 150); } })),
          el('div', { class: 'seg', role: 'group', 'aria-label': 'Group by' }, [['family', 'Colour family'], ['brand', 'Brand'], ['kind', 'Type']].map(([k, l]) =>
            el('button', { 'aria-pressed': String(UI.mineGroup === k), onclick: () => { UI.mineGroup = k; renderMine(root); } }, el('span', {}, l))))),
        order.map((g) => el('section', { class: 'mgroup' },
          el('h3', {}, UI.mineGroup === 'family' && el('span', { class: 'pdot', style: `background:${FAMILY_DOT[g] || 'linear-gradient(135deg,#eee,#888 45%,#ddd)'}` }), g, el('span', { class: 'count' }, groups.get(g).length)),
          el('div', { class: 'mgrid' }, groups.get(g).sort((a, b) => b.lab[0] - a.lab[0]).map(mtile))))));
}

// ---------- Shopping list ----------
function twinOf(p) {
  let best = null;
  for (const q of S.paints) {
    if (!owned(q) || q === p || NOCOLOUR.has(q.k) || groupOf(q) !== groupOf(p)) continue;
    const d = deltaE(p.lab, q.lab);
    if (d < 3 && (!best || d < best.d)) best = { p: q, d };
  }
  return best;
}
function renderShopping(root) {
  const items = Object.entries(S.docs.shopping).map(([id, v]) => ({ p: S.byId.get(id), v })).filter((x) => x.p).sort((a, b) => brandName(a.p.b).localeCompare(brandName(b.p.b)) || a.p.n.localeCompare(b.p.n));
  const save = () => saveDoc('shopping');
  const text = () => {
    const by = new Map();
    for (const x of items) (by.get(brandName(x.p.b)) || by.set(brandName(x.p.b), []).get(brandName(x.p.b))).push(x);
    return [...by].map(([b, arr]) => `${b}\n${arr.map((x) => `  ${x.v.qty > 1 ? `${x.v.qty} × ` : ''}${x.p.n} (${x.p.r}${x.p.c ? ` ${x.p.c}` : ''})${x.v.note ? ` — ${x.v.note}` : ''}`).join('\n')}`).join('\n\n');
  };
  const twins = items.filter((x) => twinOf(x.p)).length;
  root.replaceChildren(
    head('Shopping list', items.length ? `${items.length} paint${items.length === 1 ? '' : 's'}${twins ? ` · ${twins} you may already have` : ''}` : null,
      btn('Add a paint', async () => { const p = await pickPaint({ title: 'Add to the shopping list', ownedFirst: false }); if (p && !S.docs.shopping[p.id]) toggleShopping(p); }, 'primary'),
      items.length > 0 && btn('Copy list', () => copyText(text(), 'Shopping list')),
      items.length > 0 && btn('Print', () => printSheet('Shopping list', el('pre', {}, text())))),
    !items.length ? emptyBox('Nothing on the list. Add paints from any paint window, or from a model\'s paint scheme.')
      : el('ul', { class: 'shop-list', role: 'list' }, items.map((x) => {
        const twin = twinOf(x.p);
        return el('li', { class: 'shop-item' },
          chipRow(x.p),
          twin && el('p', { class: 'shop-twin' }, svg('<path d="M12 8v5M12 16.5v.5"/><circle cx="12" cy="12" r="9"/>'), 'You already own ', el('button', { type: 'button', class: 'link-inline', onclick: () => openPaint(twin.p) }, plain(twin.p)), `, ${closeness(twin.d).toLowerCase()} (ΔE ${fmt(twin.d)}). You may not need this one.`),
          el('div', { class: 'shop-ctrl' },
            el('label', { class: 'qty' }, el('span', {}, 'Pots'), el('input', { type: 'number', min: 1, max: 99, value: x.v.qty || 1, onchange: (e) => { x.v.qty = Math.max(1, Number(e.target.value) || 1); save(); } })),
            el('input', { class: 'shop-note', placeholder: 'Note (shop, price…)', value: x.v.note || '', onchange: (e) => { x.v.note = e.target.value; save(); } }),
            btn('Bought', async () => { delete S.docs.shopping[x.p.id]; S.docs.owned[x.p.id] = { qty: x.v.qty || 1, added: Date.now(), ...(S.docs.owned[x.p.id] || {}) }; await save(); await saveDoc('owned'); h().toast(`${x.p.n} moved to your paints`); draw(); }, 'primary'),
            btn('Remove', async () => { delete S.docs.shopping[x.p.id]; await save(); draw(); })));
      })));
}

// ---------- Paint lists ----------
function renderLists(root) {
  const lists = S.docs.lists;
  const l = lists.find((x) => x.id === UI.list);
  if (!l) {
    root.replaceChildren(
      head('Paint lists', 'A list made once (for a tutorial, an army, a scheme) can be shown in any brand.',
        btn('New list', async () => { const n = { id: uid(), name: 'New list', note: '', items: [], created: Date.now() }; lists.push(n); await saveDoc('lists'); UI.list = n.id; draw(); }, 'primary')),
      !lists.length ? emptyBox('No lists yet. Make one here, or press "Add to a list" in any paint window.')
        : el('div', { class: 'list-cards' }, lists.map((x) => el('button', { type: 'button', class: 'list-card', onclick: () => { UI.list = x.id; draw(); } },
          el('span', { class: 'hstrip wide' }, (x.items.length ? x.items : [{}]).slice(0, 12).map((i) => el('i', { style: `background:${S.byId.get(i.id)?.h || 'var(--sunken)'}` }))),
          el('b', {}, x.name), el('small', { class: 'muted' }, `${x.items.length} paint${x.items.length === 1 ? '' : 's'}${x.note ? ` · ${x.note}` : ''}`)))));
    return;
  }
  const save = () => saveDoc('lists');
  const target = UI.listBrand;
  const rows = l.items.map((i) => ({ i, p: S.byId.get(i.id) })).filter((x) => x.p);
  const conv = (p) => (!target ? null : nearest(p.lab, { ...matchOpts(target), group: groupOf(p) === 'none' ? null : groupOf(p) }));
  const text = () => `${l.name}${target ? ` (in ${target === 'mine' ? 'my paints' : brandName(target)})` : ''}\n${rows.map((x, n) => { const c = conv(x.p); return `${n + 1}. ${c ? `${plain(c.p)} — for ${plain(x.p)}, ΔE ${fmt(c.d)}` : plain(x.p)}${x.i.note ? ` — ${x.i.note}` : ''}`; }).join('\n')}`;
  root.replaceChildren(
    el('button', { type: 'button', class: 'link-inline back-link', onclick: () => { UI.list = null; draw(); } }, '← All lists'),
    el('div', { class: 'pv-head' },
      el('div', { class: 'list-title' },
        el('input', { class: 'list-name', value: l.name, 'aria-label': 'List name', onchange: (e) => { l.name = e.target.value.trim() || 'Untitled list'; save(); } }),
        el('input', { class: 'list-note', value: l.note || '', placeholder: 'What it\'s for (optional)', 'aria-label': 'List note', onchange: (e) => { l.note = e.target.value; save(); } })),
      el('div', { class: 'pv-acts' },
        btn('Add a paint', async () => { const p = await pickPaint({ title: `Add to ${l.name}` }); if (p && !l.items.some((i) => i.id === p.id)) { l.items.push({ id: p.id, note: '' }); await save(); draw(); } }, 'primary'),
        btn('Copy', () => copyText(text(), 'List')),
        btn('Delete list', async () => { if (await h().confirmDlg(`Delete ${l.name}?`, 'The list is removed. The paints themselves stay.', [{ label: 'Cancel', value: '' }, { label: 'Delete list', value: 'y', cls: 'primary' }])) { S.docs.lists = lists.filter((x) => x !== l); await save(); UI.list = null; draw(); } }))),
    el('div', { class: 'view-bar' }, el('span', { class: 'muted' }, 'Show in'), brandSelect(target, (v) => { UI.listBrand = v; draw(); }, { any: 'The brands they were added in', mine: true })),
    !rows.length ? emptyBox('This list is empty. Add paints with the button above or from any paint window.')
      : el('ol', { class: 'plist', role: 'list' }, rows.map((x, n) => {
        const c = conv(x.p);
        return el('li', { class: 'plist-item' },
          el('span', { class: 'hnum' }, n + 1),
          el('div', { class: 'plist-main' },
            c ? chipRow(c.p, { extra: el('span', { class: `pm-close d${c.d < 5 ? 1 : c.d < 10 ? 2 : 3}` }, closeness(c.d), el('small', {}, `ΔE ${fmt(c.d)}`)) }) : chipRow(x.p),
            c && el('small', { class: 'muted plist-orig' }, `For ${plain(x.p)}`),
            el('input', { class: 'list-note small', value: x.i.note || '', placeholder: 'Step or note, e.g. "base coat"', 'aria-label': `Note for ${x.p.n}`, onchange: (e) => { x.i.note = e.target.value; save(); } })),
          el('div', { class: 'plist-ctrl' },
            el('button', { type: 'button', class: 'icon-btn small', 'aria-label': 'Move up', disabled: n === 0, onclick: async () => { l.items.splice(n - 1, 0, l.items.splice(n, 1)[0]); await save(); draw(); } }, svg('<path d="m6 15 6-6 6 6"/>')),
            el('button', { type: 'button', class: 'icon-btn small', 'aria-label': 'Move down', disabled: n === rows.length - 1, onclick: async () => { l.items.splice(n + 1, 0, l.items.splice(n, 1)[0]); await save(); draw(); } }, svg('<path d="m6 9 6 6 6-6"/>')),
            el('button', { type: 'button', class: 'icon-btn small', 'aria-label': `Remove ${x.p.n}`, onclick: async () => { l.items.splice(n, 1); await save(); draw(); } }, svg(X))));
      })));
}

// ---------- Racks ----------
function renderRacks(root) {
  const racks = S.docs.racks;
  const mine = S.paints.filter(owned);
  const placed = new Map(mine.filter((p) => S.docs.owned[p.id].slot).map((p) => [S.docs.owned[p.id].slot, p]));
  const unplaced = mine.filter((p) => !S.docs.owned[p.id].slot);
  const saveAll = async () => { await saveDoc('racks'); await saveDoc('owned'); };
  const editRack = (r = null) => {
    const d = el('dialog', { class: 'sheet narrow', 'aria-label': r ? 'Edit rack' : 'New rack' });
    document.body.append(d);
    d.addEventListener('close', () => d.remove());
    const f = el('form', { class: 'sheet-body stack', onsubmit: async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(f));
      const rows = Math.min(40, Math.max(1, Number(v.rows) || 1)), cols = Math.min(40, Math.max(1, Number(v.cols) || 1));
      if (r) {
        // Paints in slots that no longer exist go back to "not on a rack".
        for (const p of mine) { const [rid, rr, cc] = String(S.docs.owned[p.id].slot || '').split(':'); if (rid === r.id && (Number(rr) >= rows || Number(cc) >= cols)) delete S.docs.owned[p.id].slot; }
        Object.assign(r, { name: v.name.trim() || 'Rack', code: v.code.trim().toUpperCase() || 'A', rows, cols });
      } else racks.push({ id: uid(), name: v.name.trim() || 'Rack', code: v.code.trim().toUpperCase() || String.fromCharCode(65 + racks.length), rows, cols });
      await saveAll(); d.close(); draw();
    } },
      el('div', { class: 'two' },
        el('label', { class: 'field' }, el('span', {}, 'Name'), el('input', { name: 'name', required: true, value: r?.name || '', placeholder: 'e.g. Desk shelf' })),
        el('label', { class: 'field' }, el('span', {}, 'Code'), el('input', { name: 'code', maxlength: 3, value: r?.code || String.fromCharCode(65 + racks.length), placeholder: 'A' }))),
      el('div', { class: 'two' },
        el('label', { class: 'field' }, el('span', {}, 'Rows (shelves or drawers)'), el('input', { name: 'rows', type: 'number', min: 1, max: 40, value: r?.rows || 4 })),
        el('label', { class: 'field' }, el('span', {}, 'Slots in a row'), el('input', { name: 'cols', type: 'number', min: 1, max: 40, value: r?.cols || 10 }))),
      el('p', { class: 'muted small-note' }, 'Each slot gets a code like A-2-5: rack A, row 2, slot 5.'),
      el('div', { class: 'form-actions' }, el('button', { class: 'btn primary', type: 'submit' }, r ? 'Save rack' : 'Add rack'), el('button', { class: 'btn ghost', type: 'button', onclick: () => d.close() }, 'Cancel')));
    d.append(el('header', { class: 'sheet-head' }, el('h2', {}, r ? `Edit ${r.name}` : 'New rack'), el('button', { class: 'icon-btn close', type: 'button', 'aria-label': 'Close', onclick: () => d.close() }, svg(X))), f);
    d.showModal();
  };
  const autoFill = async () => {
    const free = [];
    for (const r of racks) for (let i = 0; i < r.rows; i++) for (let j = 0; j < r.cols; j++) { const k = `${r.id}:${i}:${j}`; if (!placed.has(k)) free.push(k); }
    const order = unplaced.sort((a, b) => FAMILIES.indexOf(familyOf(a)) - FAMILIES.indexOf(familyOf(b)) || b.lab[0] - a.lab[0]);
    const n = Math.min(free.length, order.length);
    order.slice(0, n).forEach((p, i) => { S.docs.owned[p.id].slot = free[i]; });
    await saveDoc('owned');
    h().toast(n < order.length ? `Placed ${n} paints; ${order.length - n} didn't fit. Add a rack or more slots.` : `Placed ${n} paint${n === 1 ? '' : 's'}, sorted by colour`);
    draw();
  };
  root.replaceChildren(
    head('Racks', racks.length ? `${placed.size} of ${mine.length} paints you own are on a rack${unplaced.length ? ` · ${unplaced.length} not placed yet` : ''}` : 'Plan where your paints live: shelves, drawers and slot codes.',
      btn('New rack', () => editRack(), 'primary'),
      racks.length > 0 && unplaced.length > 0 && btn(`Place ${unplaced.length} by colour`, autoFill)),
    ...(!racks.length ? [emptyBox('No racks yet. Add one with its rows and slots, then put your paints in it.', btn('New rack', () => editRack(), 'primary'))]
      : racks.map((r) => el('section', { class: 'rack' },
        el('div', { class: 'rack-head' }, el('h3', {}, el('span', { class: 'rack-code' }, r.code), r.name), el('small', { class: 'muted' }, `${r.rows} × ${r.cols}`),
          btn('Edit', () => editRack(r)),
          btn('Delete', async () => { if (!(await h().confirmDlg(`Delete ${r.name}?`, 'Its paints stay in My paints, just without a slot.', [{ label: 'Cancel', value: '' }, { label: 'Delete rack', value: 'y', cls: 'primary' }]))) return; for (const p of mine) if (String(S.docs.owned[p.id].slot || '').startsWith(`${r.id}:`)) delete S.docs.owned[p.id].slot; S.docs.racks = racks.filter((x) => x !== r); await saveAll(); draw(); })),
        el('div', { class: 'rack-grid', style: `grid-template-columns: 2.2em repeat(${r.cols}, minmax(34px, 1fr))` },
          ...[el('span', {}), Array.from({ length: r.cols }, (_, j) => el('span', { class: 'rack-lbl' }, j + 1)),
          Array.from({ length: r.rows }, (_, i) => [el('span', { class: 'rack-lbl' }, i + 1), Array.from({ length: r.cols }, (_, j) => {
            const key = `${r.id}:${i}:${j}`, p = placed.get(key), code = `${r.code}-${i + 1}-${j + 1}`;
            return p
              ? el('button', { type: 'button', class: 'slot full', style: swatchStyle(p), title: `${code}: ${plain(p)}`, 'aria-label': `${code}: ${p.n}`, onclick: async () => {
                const v = await h().confirmDlg(`${code}: ${p.n}`, pdesc(p), [{ label: 'Cancel', value: '' }, { label: 'Take out', value: 'out' }, { label: 'Open paint', value: 'open', cls: 'primary' }]);
                if (v === 'open') openPaint(p);
                if (v === 'out') { delete S.docs.owned[p.id].slot; await saveDoc('owned'); draw(); }
              } })
              : el('button', { type: 'button', class: 'slot', title: `${code}: empty`, 'aria-label': `${code}: empty`, onclick: async () => {
                const q = await pickPaint({ title: `Put a paint in ${code}`, onlyOwned: true, filter: (x) => owned(x) && !S.docs.owned[x.id].slot });
                if (!q) return;
                S.docs.owned[q.id].slot = key; await saveDoc('owned'); draw();
              } });
          })])].flat(3))))),
    unplaced.length > 0 && racks.length > 0 ? el('section', { class: 'mgroup' }, el('h3', {}, 'Not on a rack yet', el('span', { class: 'count' }, unplaced.length)),
      el('div', { class: 'udots' }, unplaced.map((p) => el('button', { type: 'button', class: 'udot', style: swatchStyle(p), title: plain(p), 'aria-label': plain(p), onclick: () => openPaint(p) })))) : '');
}

// ---------- Explore by colour ----------
function renderExplore(root) {
  const E = UI.explore;
  const pool = S.paints.filter((p) => !p.g && !NOCOLOUR.has(p.k) && (!E.brand || (E.brand === 'mine' ? owned(p) : p.b === E.brand)));
  const fam = new Map(FAMILIES.map((f) => [f, 0]));
  for (const p of pool) fam.set(familyOf(p), fam.get(familyOf(p)) + 1);
  const famSorted = [...fam].filter(([, n]) => n).sort((a, b) => b[1] - a[1]);
  const total = pool.length || 1;
  const goFamily = (f) => { S.sel.family.clear(); S.sel.family.add(f); if (E.brand && E.brand !== 'mine') { S.sel.brand.clear(); S.sel.brand.add(E.brand); } S.mineOnly = E.brand === 'mine'; setSection('catalogue'); };
  // The plane: chroma across, lightness up, for paints in the chosen hue band.
  const inBand = (p) => { const [, C, hue] = lchOf(p.lab); if (E.neutral) return C < 7; if (C < 7) return false; const d = Math.abs(((hue - E.hue + 540) % 360) - 180); return d <= E.width; };
  const band = pool.filter(inBand);
  const W = 620, H = 440, maxC = 100;
  const toXY = (p) => { const [L, C] = lchOf(p.lab); return [28 + (Math.min(C, maxC) / maxC) * (W - 40), H - 24 - (L / 100) * (H - 40)]; };
  const canvas = el('canvas', { width: W * 2, height: H * 2, class: 'xplane', role: 'img', 'aria-label': `Paints of hue ${Math.round(E.hue)}°, lightness against saturation` });
  const sel = () => { if (!E.box) return band; const [x0, y0, x1, y1] = E.box; return band.filter((p) => { const [x, y] = toXY(p); return x >= Math.min(x0, x1) && x <= Math.max(x0, x1) && y >= Math.min(y0, y1) && y <= Math.max(y0, y1); }); };
  const resultBox = el('div', {});
  const readout = el('div', { class: 'xread' });
  const paint = () => {
    const c = canvas.getContext('2d');
    c.setTransform(2, 0, 0, 2, 0, 0);
    c.clearRect(0, 0, W, H);
    // Faint colour background for the band's hue.
    for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) {
      const L = 100 - (j / 20) * 100, C = (i / 20) * maxC;
      c.fillStyle = E.neutral ? labHex([L, 0, 0]) : labHex(fromLch(L, C, E.hue));
      c.globalAlpha = 0.16; c.fillRect(28 + (i / 20) * (W - 40) - (W - 40) / 40, 16 + (j / 20) * (H - 40) - (H - 40) / 40, (W - 40) / 20 + 1, (H - 40) / 20 + 1);
    }
    c.globalAlpha = 1;
    c.strokeStyle = 'rgba(255,255,255,.07)'; c.fillStyle = 'rgba(255,255,255,.45)'; c.font = '11px system-ui';
    for (const v of [25, 50, 75]) { const y = H - 24 - (v / 100) * (H - 40), x = 28 + (v / maxC) * (W - 40); c.beginPath(); c.moveTo(28, y); c.lineTo(W - 12, y); c.moveTo(x, 16); c.lineTo(x, H - 24); c.stroke(); c.fillText(String(v), 4, y + 4); c.fillText(String(v), x - 7, H - 8); }
    const chosen = new Set(sel());
    for (const p of band) { const [x, y] = toXY(p); c.beginPath(); c.arc(x, y, chosen.has(p) && E.box ? 4.2 : 3.4, 0, 7); c.fillStyle = p.h; c.fill(); c.lineWidth = 1; c.strokeStyle = chosen.has(p) && E.box ? '#fff' : 'rgba(0,0,0,.45)'; c.stroke(); }
    if (E.box) { const [x0, y0, x1, y1] = E.box; c.strokeStyle = '#6fd3bd'; c.lineWidth = 1.5; c.setLineDash([5, 4]); c.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)); c.setLineDash([]); }
    const s = sel();
    readout.replaceChildren(el('b', {}, s.length.toLocaleString()), ` paint${s.length === 1 ? '' : 's'}${E.box ? ' in the box' : ' in this hue'}`, E.box && el('button', { type: 'button', class: 'link-inline', onclick: () => { E.box = null; paint(); list(); } }, 'Clear box'));
  };
  const list = () => {
    const s = sel().sort((a, b) => b.lab[0] - a.lab[0]);
    resultBox.replaceChildren(el('p', { class: 'muted' }, s.length > 200 ? `${s.length} paints, showing the first 200. Drag a box on the chart to narrow it down.` : `${s.length} paints`), el('div', { class: 'pgrid' }, s.slice(0, 200).map((p) => tile({ p }))));
  };
  let drag = null;
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H]; };
  canvas.addEventListener('pointerdown', (e) => { drag = pos(e); E.box = [...drag, ...drag]; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => { if (!drag) return; E.box = [...drag, ...pos(e)]; paint(); });
  canvas.addEventListener('pointerup', () => { if (!drag) return; drag = null; const [x0, y0, x1, y1] = E.box; if (Math.abs(x1 - x0) < 6 && Math.abs(y1 - y0) < 6) E.box = null; paint(); list(); });
  // Hue ring to pick from.
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (t, a) => { const n = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) n.setAttribute(k, v); return n; };
  const ring = mk('svg', { viewBox: '0 0 160 160', class: 'xring', role: 'slider', tabindex: 0, 'aria-label': 'Hue', 'aria-valuemin': 0, 'aria-valuemax': 359, 'aria-valuenow': Math.round(E.hue) });
  const at = (deg, r) => [80 + r * Math.cos((-deg * Math.PI) / 180), 80 + r * Math.sin((-deg * Math.PI) / 180)];
  for (let i = 0; i < 72; i++) { const [x0, y0] = at(i * 5, 64), [x1, y1] = at(i * 5 + 5.6, 64); ring.append(mk('path', { d: `M${x0} ${y0} A64 64 0 0 0 ${x1} ${y1}`, stroke: labHex(fromLch(62, 48, i * 5 + 2.5)), 'stroke-width': 18, fill: 'none' })); }
  if (!E.neutral) { const [a0, b0] = at(E.hue - E.width, 64), [a1, b1] = at(E.hue + E.width, 64); ring.append(mk('path', { d: `M${a0} ${b0} A64 64 0 ${E.width > 90 ? 1 : 0} 0 ${a1} ${b1}`, stroke: '#fff', 'stroke-width': 24, fill: 'none', opacity: 0.25 })); }
  const label = mk('text', { x: 80, y: 86, 'text-anchor': 'middle', 'font-size': 20, 'font-weight': 700, fill: 'currentColor' }); label.textContent = E.neutral ? 'Grey' : `${Math.round(E.hue)}°`; ring.append(label);
  const setHue = (e) => { const r = ring.getBoundingClientRect(); const x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2; E.hue = (Math.atan2(-y, x) * 180 / Math.PI + 360) % 360; E.neutral = false; E.box = null; renderExplore(root); };
  ring.addEventListener('click', setHue);
  ring.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { E.hue = (E.hue + 355) % 360; } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { E.hue = (E.hue + 5) % 360; } else return; e.preventDefault(); E.box = null; renderExplore(root); root.querySelector('.xring')?.focus(); });
  const PRESETS = [['Reds', 35], ['Oranges', 62], ['Yellows', 95], ['Greens', 140], ['Teals', 200], ['Blues', 265], ['Violets', 310], ['Pinks', 350]];
  root.replaceChildren(
    head('Explore by colour', `${pool.length.toLocaleString()} paints${E.brand ? ` (${E.brand === 'mine' ? 'yours' : brandName(E.brand)})` : ''}, placed by their colour, never by their name.`, brandSelect(E.brand, (v) => { E.brand = v; E.box = null; draw(); }, { any: 'Every brand', mine: true })),
    el('section', { class: 'xfam' },
      el('div', { class: 'xbar', role: 'list' }, famSorted.map(([f, n]) => el('button', { type: 'button', role: 'listitem', class: 'xseg', style: `flex:${n};background:${FAMILY_DOT[f]}`, title: `${f}: ${n} paints`, 'aria-label': `${f}: ${n} paints`, onclick: () => goFamily(f) }))),
      el('div', { class: 'xlegend' }, famSorted.map(([f, n]) => el('button', { type: 'button', class: 'xleg', onclick: () => goFamily(f) }, el('span', { class: 'pdot', style: `background:${FAMILY_DOT[f]}` }), el('span', {}, f), el('span', { class: 'count' }, `${n.toLocaleString()} · ${Math.round((n / total) * 100)}%`))))),
    el('section', { class: 'xexplore' },
      el('div', { class: 'xside' },
        ring,
        el('div', { class: 'xpresets' }, PRESETS.map(([l, v]) => el('button', { type: 'button', class: `chip${!E.neutral && Math.abs(((E.hue - v + 540) % 360) - 180) < 12 ? ' on' : ''}`, onclick: () => { E.hue = v; E.neutral = false; E.box = null; renderExplore(root); } }, l))),
        el('label', { class: 'field' }, el('span', {}, `Hue width ±${E.width}°`), el('input', { type: 'range', min: 6, max: 60, value: E.width, disabled: E.neutral, oninput: (e) => { E.width = Number(e.target.value); E.box = null; clearTimeout(UI.xt); UI.xt = setTimeout(() => renderExplore(root), 60); } })),
        el('button', { type: 'button', class: `btn small ${E.neutral ? 'primary' : 'ghost'}`, 'aria-pressed': String(E.neutral), onclick: () => { E.neutral = !E.neutral; E.box = null; renderExplore(root); } }, 'Greys, blacks and whites'),
        el('p', { class: 'muted small-note' }, 'Drag a box on the chart to pick out a group of paints. Where the chart is empty, nobody makes that colour.')),
      el('div', { class: 'xmain' }, canvas, el('div', { class: 'xaxes' }, el('span', {}, '↑ Lightness'), el('span', {}, 'Saturation →')), readout)),
    resultBox);
  paint(); list();
}

// ---------- Colour tools ----------
function renderTools(root) {
  const tabs = [['picture', 'Palette from a picture'], ['gradient', 'Gradient and thinning'], ['contrast', 'Contrast check']];
  const body = el('div', { class: 'tool-body' });
  root.replaceChildren(
    head('Colour tools', null),
    el('div', { class: 'seg tool-tabs', role: 'tablist', 'aria-label': 'Colour tools' }, tabs.map(([k, l]) => el('button', { role: 'tab', 'aria-selected': String(UI.tool === k), 'aria-pressed': String(UI.tool === k), onclick: () => { UI.tool = k; renderTools(root); } }, el('span', {}, l)))),
    body);
  ({ picture: toolPicture, gradient: toolGradient, contrast: toolContrast })[UI.tool](body);
}
function paintSlot(p, label, onpick) {
  return el('button', { type: 'button', class: `pslot${p ? ' set' : ''}`, onclick: async () => { const q = await pickPaint({ title: label }); if (q) onpick(q); } },
    el('span', { class: 'pdot big', style: p ? swatchStyle(p) : '' }),
    el('span', { class: 'pm-name' }, el('small', { class: 'lrole' }, label), el('b', {}, p ? p.n : 'Choose a paint'), p && el('small', {}, pdesc(p))));
}
function matchesBlock(hex, opts) {
  const res = nearest(lab(hex), { ...opts, n: 3 });
  return el('ul', { class: 'mini-matches', role: 'list' }, res.map((x) => el('li', {}, chipRow(x.p, { extra: el('span', { class: `pm-close d${x.d < 5 ? 1 : x.d < 10 ? 2 : 3}` }, `ΔE ${fmt(x.d)}`) }))));
}

// Palette from a picture: k-means on CIELAB colours of a scaled-down copy, plus click-to-pick.
// Palette from a picture. The picture is sampled small; the background (followed in from the edges) and
// separate islands such as logos and watermark text are left out, then the rest is grouped into colours
// (k-means in CIELAB). Each colour remembers a spot where it occurs, for the marker and its line.
export function kmeans(px, k) {
  const n = px.length / 3;
  if (!n) return { cents: [], assign: new Int32Array(0), counts: [] };
  const dist = (i, c) => (px[i * 3] - c[0]) ** 2 + (px[i * 3 + 1] - c[1]) ** 2 + (px[i * 3 + 2] - c[2]) ** 2;
  // Far-apart starting colours (k-means++ lite).
  const cents = [[px[0], px[1], px[2]]];
  while (cents.length < Math.min(k, n)) {
    let best = 0, bd = -1;
    for (let i = 0; i < n; i += 5) { const d = Math.min(...cents.map((c) => dist(i, c))); if (d > bd) { bd = d; best = i; } }
    cents.push([px[best * 3], px[best * 3 + 1], px[best * 3 + 2]]);
  }
  const assign = new Int32Array(n);
  let counts = [];
  for (let it = 0; it < 14; it++) {
    const sums = cents.map(() => [0, 0, 0]); counts = cents.map(() => 0);
    for (let i = 0; i < n; i++) {
      let bi = 0, bd = Infinity;
      for (let j = 0; j < cents.length; j++) { const d = dist(i, cents[j]); if (d < bd) { bd = d; bi = j; } }
      assign[i] = bi; sums[bi][0] += px[i * 3]; sums[bi][1] += px[i * 3 + 1]; sums[bi][2] += px[i * 3 + 2]; counts[bi]++;
    }
    for (let j = 0; j < cents.length; j++) if (counts[j]) cents[j] = sums[j].map((v) => v / counts[j]);
  }
  return { cents, assign, counts };
}
const labDist = (a, i, b) => Math.sqrt((a[i * 3] - b[0]) ** 2 + (a[i * 3 + 1] - b[1]) ** 2 + (a[i * 3 + 2] - b[2]) ** 2);
/** Which sampled pixels belong to the subject (1) rather than the background (0). */
export function subjectMask(lab3, alpha, w, h) {
  const n = w * h, keep = new Uint8Array(n).fill(1);
  for (let i = 0; i < n; i++) if (alpha[i] < 200) keep[i] = 0;
  // Background colours: the main colours along the edges.
  const edge = [];
  const bw = Math.max(1, Math.round(Math.min(w, h) * 0.04));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x < bw || y < bw || x >= w - bw || y >= h - bw) && alpha[y * w + x] >= 200) edge.push(y * w + x);
  if (!edge.length) return keep;
  const ep = new Float32Array(edge.length * 3);
  edge.forEach((i, j) => { ep[j * 3] = lab3[i * 3]; ep[j * 3 + 1] = lab3[i * 3 + 1]; ep[j * 3 + 2] = lab3[i * 3 + 2]; });
  const km = kmeans(ep, 4);
  const bg = km.cents.filter((c, j) => km.counts[j] / edge.length > 0.1);
  const nearBg = (i) => Math.min(...bg.map((c) => labDist(lab3, i, c)));
  // Grow the background in from the edges through similar neighbouring colours (copes with gradients).
  const seen = new Uint8Array(n), queue = [];
  for (const i of edge) if (nearBg(i) < 16) { seen[i] = 1; keep[i] = 0; queue.push(i); }
  while (queue.length) {
    const i = queue.pop(), x = i % w, y = (i - x) / w;
    for (const j of [x > 0 && i - 1, x < w - 1 && i + 1, y > 0 && i - w, y < h - 1 && i + w]) {
      if (j === false || seen[j] || alpha[j] < 200) continue;
      const step = Math.sqrt((lab3[i * 3] - lab3[j * 3]) ** 2 + (lab3[i * 3 + 1] - lab3[j * 3 + 1]) ** 2 + (lab3[i * 3 + 2] - lab3[j * 3 + 2]) ** 2);
      if (step < 7 && nearBg(j) < 30) { seen[j] = 1; keep[j] = 0; queue.push(j); }
    }
  }
  // Keep the subject: drop small separate islands (logos, watermark text, specks).
  const comp = new Int32Array(n).fill(-1), sizes = [];
  for (let i = 0; i < n; i++) {
    if (!keep[i] || comp[i] >= 0) continue;
    const id = sizes.length; let size = 0; const st = [i]; comp[i] = id;
    while (st.length) {
      const c = st.pop(); size++;
      const x = c % w, y = (c - x) / w;
      for (const j of [x > 0 && c - 1, x < w - 1 && c + 1, y > 0 && c - w, y < h - 1 && c + w]) if (j !== false && keep[j] && comp[j] < 0) { comp[j] = id; st.push(j); }
    }
    sizes.push(size);
  }
  const big = Math.max(0, ...sizes);
  // Logos and watermarks are much smaller than the subject; a big second part (another figure) stays.
  for (let i = 0; i < n; i++) if (keep[i] && sizes[comp[i]] < big * 0.25) keep[i] = 0;
  // If almost nothing is left, the "background" was really the subject: keep everything.
  const left = keep.reduce((s, v) => s + v, 0);
  if (left < n * 0.04) { for (let i = 0; i < n; i++) keep[i] = alpha[i] >= 200 ? 1 : 0; }
  return keep;
}
function toolPicture(root) {
  const P = UI.pic || (UI.pic = { src: null, colours: [], k: 6, match: '', bg: true, box: null, excl: [] });
  P.excl ||= []; P.bg ??= true;
  // What to draw over the picture: 'all' (lines and numbers), 'numbers' (numbers only) or 'none'.
  if (!P.marks) { try { P.marks = localStorage.getItem('mv.picMarks') || 'all'; } catch { P.marks = 'all'; } }
  const canvas = el('canvas', { class: 'pic-canvas', 'aria-label': 'Your picture. Click to pick a colour, or drag a box around the part to look at.' });
  const out = el('div', { class: 'pic-out' });
  const NS = 'http://www.w3.org/2000/svg';
  const lines = document.createElementNS(NS, 'svg'), linesTop = document.createElementNS(NS, 'svg');
  lines.setAttribute('class', 'pic-lines'); linesTop.setAttribute('class', 'pic-lines top');
  for (const s2 of [lines, linesTop]) s2.setAttribute('aria-hidden', 'true');
  const wrap = el('div', { class: 'pic-wrap' }, el('div', { class: 'pic-stage' }, canvas), out);
  wrap.append(lines, linesTop);
  let img = null, grid = null, mask = null, hover = -1;
  const load = (src) => { Object.assign(P, { src, colours: [], box: null, excl: [] }); toolPicture(root); };
  const file = el('input', { type: 'file', accept: 'image/*', hidden: true, onchange: (e) => { const f = e.target.files[0]; if (f) load(URL.createObjectURL(f)); } });
  const toHex = (r, g, b) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

  // Sample the picture small, once: colours (CIELAB) and transparency per pixel.
  const sample = () => {
    const s2 = Math.min(1, 140 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * s2)), hh = Math.max(1, Math.round(img.naturalHeight * s2));
    const sm = document.createElement('canvas'); sm.width = w; sm.height = hh;
    const cx = sm.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0, w, hh);
    const data = cx.getImageData(0, 0, w, hh).data, lab3 = new Float32Array(w * hh * 3), alpha = new Uint8Array(w * hh);
    for (let i = 0; i < w * hh; i++) { const L = lab(toHex(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])); lab3[i * 3] = L[0]; lab3[i * 3 + 1] = L[1]; lab3[i * 3 + 2] = L[2]; alpha[i] = data[i * 4 + 3]; }
    grid = { w, h: hh, lab3, alpha };
  };
  const analyse = () => {
    const { w, h: hh, lab3, alpha } = grid;
    mask = P.bg ? subjectMask(lab3, alpha, w, hh) : Uint8Array.from(alpha, (a) => (a >= 200 ? 1 : 0));
    if (P.box) { const [x0, y0, x1, y1] = P.box; for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) { const fx = (x + 0.5) / w, fy = (y + 0.5) / hh; if (fx < x0 || fx > x1 || fy < y0 || fy > y1) mask[y * w + x] = 0; } }
    // Pixels right next to a left-out area are a blur of both colours: leave them out of the colours too.
    const rim = (i) => { const x = i % w, y = (i - x) / w; return (x > 0 && !mask[i - 1]) || (x < w - 1 && !mask[i + 1]) || (y > 0 && !mask[i - w]) || (y < hh - 1 && !mask[i + w]); };
    const anyLeftOut = mask.some((v) => !v);
    // Colours you said no to are left out too.
    const idx = [];
    for (let i = 0; i < w * hh; i++) if (mask[i] && !(anyLeftOut && rim(i)) && !P.excl.some((c) => labDist(lab3, i, c) < 10)) idx.push(i);
    const px = new Float32Array(idx.length * 3);
    idx.forEach((i, j) => { px[j * 3] = lab3[i * 3]; px[j * 3 + 1] = lab3[i * 3 + 1]; px[j * 3 + 2] = lab3[i * 3 + 2]; });
    const km = kmeans(px, P.k);
    const picked = P.colours.filter((c) => c.picked);
    const found = km.cents.map((c, j) => {
      // A spot for the marker: a pixel of this colour, near the middle of where the colour occurs.
      const mine = []; for (let t = 0; t < idx.length; t++) if (km.assign[t] === j) mine.push(idx[t]);
      if (!mine.length) return null;
      const inSet = new Set(mine);
      const mx = mine.map((i) => i % w).sort((a, b) => a - b)[mine.length >> 1], my = mine.map((i) => Math.floor(i / w)).sort((a, b) => a - b)[mine.length >> 1];
      // Prefer a spot inside a patch of the colour (its neighbours the same colour), close to the colour, near the middle.
      const inside = (i) => { const x = i % w; let n = 0; for (const o of [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1]) { const k2 = i + o; if (Math.abs(((k2 % w) + w) % w - x) <= 1 && inSet.has(k2)) n++; } return n; };
      let best = mine[0], bs = Infinity;
      for (const i of mine) { const d = labDist(lab3, i, c) * 2 + Math.hypot((i % w) - mx, Math.floor(i / w) - my) * 0.6 + (8 - inside(i)) * 6; if (d < bs) { bs = d; best = i; } }
      return { hex: labHex(c), lab: c, share: km.counts[j] / Math.max(1, idx.length), x: ((best % w) + 0.5) / w, y: (Math.floor(best / w) + 0.5) / hh };
    }).filter((c) => c && c.share > 0.015).sort((a, b) => b.share - a.share);
    P.colours = [...picked, ...found];
  };
  const paint = (drag = null) => {
    const c = canvas.getContext('2d', { willReadFrequently: true });
    c.drawImage(img, 0, 0, canvas.width, canvas.height);
    if (mask) {
      // Dim what's left out (background, logos, outside the box).
      const m = document.createElement('canvas'); m.width = grid.w; m.height = grid.h;
      const mc = m.getContext('2d'), md = mc.createImageData(grid.w, grid.h);
      for (let i = 0; i < mask.length; i++) if (!mask[i]) { md.data[i * 4] = 14; md.data[i * 4 + 1] = 15; md.data[i * 4 + 2] = 18; md.data[i * 4 + 3] = 170; }
      mc.putImageData(md, 0, 0);
      c.imageSmoothingEnabled = true; c.drawImage(m, 0, 0, canvas.width, canvas.height);
    }
    const box = drag || P.box;
    if (box) { const [x0, y0, x1, y1] = box; c.strokeStyle = '#6fd3bd'; c.lineWidth = 2; c.setLineDash([6, 5]); c.strokeRect(Math.min(x0, x1) * canvas.width, Math.min(y0, y1) * canvas.height, Math.abs(x1 - x0) * canvas.width, Math.abs(y1 - y0) * canvas.height); c.setLineDash([]); }
  };
  const start = () => {
    const max = 720, sc = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    canvas.width = Math.round(img.naturalWidth * sc); canvas.height = Math.round(img.naturalHeight * sc);
    if (!grid) sample();
    if (!P.colours.some((c) => !c.picked)) analyse(); else if (!mask) analyse();
    paint(); drawOut();
  };
  const redo = () => { analyse(); paint(); drawOut(); };

  // Lines from each colour's card to its spot on the picture, ending in a small numbered circle.
  const drawLines = () => {
    const wr = wrap.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
    if (!cr.width) return;
    for (const s2 of [lines, linesTop]) { s2.setAttribute('viewBox', `0 0 ${wr.width} ${wr.height}`); s2.style.width = `${wr.width}px`; s2.style.height = `${wr.height}px`; s2.replaceChildren(); }
    const mk = (t, a) => { const n = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) n.setAttribute(k, v); return n; };
    const cards = out.querySelectorAll('.pic-colour');
    P.colours.forEach((col, i) => {
      if (col.x == null || !cards[i]) return;
      // Hidden lines and numbers still show for the colour you point at.
      const on = hover === i;
      if (P.marks === 'none' && !on) return;
      const sw = cards[i].querySelector('.pic-sw').getBoundingClientRect();
      const ex = cr.left - wr.left + col.x * cr.width, ey = cr.top - wr.top + col.y * cr.height;
      const beside = sw.left >= cr.right - 4;
      const sx = beside ? sw.left - wr.left : sw.left - wr.left + sw.width / 2, sy = beside ? sw.top - wr.top + sw.height / 2 : sw.top - wr.top;
      const d = beside ? `M${sx} ${sy} C${sx - 48} ${sy}, ${ex + 48} ${ey}, ${ex} ${ey}` : `M${sx} ${sy} C${sx} ${sy - 48}, ${ex} ${ey + 48}, ${ex} ${ey}`;
      const target = on ? linesTop : lines;
      if (P.marks === 'all' || on) target.append(
        mk('path', { d, fill: 'none', stroke: 'rgba(0,0,0,.55)', 'stroke-width': on ? 4.5 : 3.5, 'stroke-linecap': 'round' }),
        mk('path', { d, fill: 'none', stroke: '#fff', 'stroke-width': on ? 2 : 1.3, 'stroke-linecap': 'round', opacity: on ? 1 : 0.85 }),
        mk('circle', { cx: sx, cy: sy, r: 2.5, fill: '#fff' }));
      // The marker on the picture always sits on top.
      const g = mk('g', {});
      g.append(mk('circle', { cx: ex, cy: ey, r: on ? 9 : 7.5, fill: col.hex, stroke: '#fff', 'stroke-width': 2 }));
      const t = mk('text', { x: ex, y: ey + 3.2, 'text-anchor': 'middle', 'font-size': 9, 'font-weight': 800, fill: inkOn(col.hex) }); t.textContent = String(i + 1);
      g.append(t); linesTop.append(g);
    });
  };
  new ResizeObserver(() => requestAnimationFrame(drawLines)).observe(wrap);

  // The colour at a spot on the picture: the average of the 3 × 3 pixels around it (what a click picks),
  // read from the picture at up to 1600 px so small details can be picked.
  const PATCH = 3;
  let pickCtx = null, pickW = 0, pickH = 0;
  const colourAt = (fx, fy) => {
    if (!pickCtx) {
      const sc = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      pickW = Math.max(1, Math.round(img.naturalWidth * sc)); pickH = Math.max(1, Math.round(img.naturalHeight * sc));
      const c = document.createElement('canvas'); c.width = pickW; c.height = pickH; pickCtx = c.getContext('2d', { willReadFrequently: true }); pickCtx.drawImage(img, 0, 0, pickW, pickH);
    }
    const x = Math.min(pickW - 1, Math.floor(fx * pickW)), y = Math.min(pickH - 1, Math.floor(fy * pickH)), half = (PATCH - 1) / 2;
    const d = pickCtx.getImageData(Math.max(0, x - half), Math.max(0, y - half), PATCH, PATCH).data;
    let rr = 0, gg = 0, bb = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { if (!d[i + 3]) continue; rr += d[i]; gg += d[i + 1]; bb += d[i + 2]; n++; }
    return n ? toHex(rr / n, gg / n, bb / n) : null;
  };

  // A magnifying loupe that follows the pointer (above the finger on touch screens).
  const LOUPE = 150, ZOOM = 8;
  const loupe = el('canvas', { class: 'pic-loupe', width: LOUPE * 2, height: LOUPE * 2 });
  const loupeHex = el('span', { class: 'pic-loupe-hex' });
  const loupeSw = el('i', { class: 'pic-loupe-sw' });
  const loupeBox = el('div', { class: 'pic-loupe-wrap', 'aria-hidden': 'true', hidden: true }, loupe, el('span', { class: 'pic-loupe-label' }, loupeSw, loupeHex));
  wrap.append(loupeBox); // above the colour lines
  const hideLoupe = () => { loupeBox.hidden = true; };
  const showLoupe = (e, touch) => {
    if (!img) return;
    const r = canvas.getBoundingClientRect(), sr = wrap.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    if (fx < 0 || fy < 0 || fx > 1 || fy > 1) { hideLoupe(); return; }
    loupeBox.hidden = false;
    const lc = loupe.getContext('2d'), size = LOUPE * 2;
    // Source square in the original picture's pixels: what LOUPE on-screen pixels show at ZOOM.
    const perScreen = img.naturalWidth / r.width, span = (LOUPE / ZOOM) * perScreen;
    const cx = fx * img.naturalWidth, cy = fy * img.naturalHeight;
    lc.fillStyle = '#15171a'; lc.fillRect(0, 0, size, size);
    lc.imageSmoothingEnabled = false;
    lc.drawImage(img, cx - span / 2, cy - span / 2, span, span, 0, 0, size, size);
    // The patch a click samples, drawn as a small square (at least 10 px so it stays visible).
    if (!pickCtx) colourAt(0.5, 0.5);
    const patch = Math.max(20, PATCH * (r.width / pickW) * ZOOM * 2);
    lc.lineWidth = 3; lc.strokeStyle = 'rgba(0,0,0,.65)'; lc.strokeRect(size / 2 - patch / 2, size / 2 - patch / 2, patch, patch);
    lc.lineWidth = 1.5; lc.strokeStyle = '#fff'; lc.strokeRect(size / 2 - patch / 2, size / 2 - patch / 2, patch, patch);
    lc.beginPath(); for (const [x0, y0, x1, y1] of [[0, size / 2, size / 2 - patch, size / 2], [size / 2 + patch, size / 2, size, size / 2], [size / 2, 0, size / 2, size / 2 - patch], [size / 2, size / 2 + patch, size / 2, size]]) { lc.moveTo(x0, y0); lc.lineTo(x1, y1); }
    lc.strokeStyle = 'rgba(255,255,255,.55)'; lc.lineWidth = 1.5; lc.stroke();
    const hex = colourAt(Math.min(1, Math.max(0, fx)), Math.min(1, Math.max(0, fy)));
    loupeHex.textContent = hex || '—'; loupeSw.style.background = hex || 'transparent';
    // Up and to the right of the pointer; flipped near the edges; well above a finger.
    const px = e.clientX - sr.left, py = e.clientY - sr.top, gap = touch ? 46 : 18;
    let lx = px + gap, ly = py - LOUPE - gap;
    if (lx + LOUPE > sr.width + 40) lx = px - LOUPE - gap;
    if (ly < -40) ly = touch ? py + gap + 30 : py + gap;
    loupeBox.style.left = `${lx}px`; loupeBox.style.top = `${ly}px`;
  };
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' || !down) hideLoupe(); });
  canvas.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') showLoupe(e, false); });

  // Mouse: click picks the spot, drag draws a box to look only inside it.
  // Touch: drag moves the loupe and lifting picks; "Draw a box" switches the next drag to a box.
  let down = null;
  const at = (e) => { const r = canvas.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
  const boxing = (e) => e.pointerType === 'mouse' || P.boxMode;
  canvas.addEventListener('pointerdown', (e) => { down = at(e); try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ } if (!boxing(e)) showLoupe(e, true); });
  canvas.addEventListener('pointermove', (e) => {
    if (!down) { if (e.pointerType === 'mouse') showLoupe(e, false); return; }
    if (!boxing(e)) { showLoupe(e, true); return; }
    const p2 = at(e);
    if (Math.hypot((p2[0] - down[0]) * canvas.width, (p2[1] - down[1]) * canvas.height) > 6) { hideLoupe(); paint([...down, ...p2]); }
    else if (e.pointerType === 'mouse') showLoupe(e, false);
  });
  canvas.addEventListener('pointercancel', () => { down = null; hideLoupe(); paint(); });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    const p2 = at(e), d0 = down; down = null;
    if (e.pointerType !== 'mouse') hideLoupe();
    if (boxing(e) && Math.hypot((p2[0] - d0[0]) * canvas.width, (p2[1] - d0[1]) * canvas.height) > 6) {
      P.box = [Math.min(d0[0], p2[0]), Math.min(d0[1], p2[1]), Math.max(d0[0], p2[0]), Math.max(d0[1], p2[1])];
      P.boxMode = false;
      redo(); return;
    }
    const hex = colourAt(p2[0], p2[1]);
    if (!hex) return;
    P.colours.unshift({ hex, share: null, picked: true, x: p2[0], y: p2[1] });
    drawOut();
  });

  const drawOut = () => {
    out.replaceChildren(
      el('div', { class: 'view-bar' }, el('span', { class: 'muted' }, 'Match with'), brandSelect(P.match, (v) => { P.match = v; drawOut(); }, { mine: true }),
        el('label', { class: 'select-wrap small' }, el('span', { class: 'sr-only' }, 'Number of colours'), el('select', { onchange: (e) => { P.k = Number(e.target.value); redo(); } }, [4, 5, 6, 8, 10].map((n) => el('option', { value: n, selected: n === P.k }, `${n} colours`)))),
        el('label', { class: 'check small-check' }, el('input', { type: 'checkbox', checked: P.bg, onchange: (e) => { P.bg = e.target.checked; redo(); } }), el('span', {}, 'Leave out the background')),
        el('label', { class: 'select-wrap small' }, el('span', { class: 'sr-only' }, 'Lines and numbers on the picture'), el('select', { onchange: (e) => { P.marks = e.target.value; try { localStorage.setItem('mv.picMarks', P.marks); } catch { /* not kept */ } drawLines(); } },
          [['all', 'Lines and numbers'], ['numbers', 'Numbers only'], ['none', 'No lines or numbers']].map(([v, l]) => el('option', { value: v, selected: P.marks === v }, l))))),
      el('p', { class: 'muted pic-help' }, 'Dimmed parts are left out. Point at the picture to magnify it; click to pick that spot. Drag a box to look only inside it.',
        el('button', { type: 'button', class: `link-inline${P.boxMode ? ' on' : ''}`, 'aria-pressed': String(!!P.boxMode), onclick: () => { P.boxMode = !P.boxMode; drawOut(); } }, P.boxMode ? 'Drag on the picture to draw the box' : 'Draw a box (touch screens)'),
        P.box && el('button', { type: 'button', class: 'link-inline', onclick: () => { P.box = null; redo(); } }, 'Remove the box'),
        P.excl.length > 0 && el('button', { type: 'button', class: 'link-inline', onclick: () => { P.excl = []; redo(); } }, `Bring back ${P.excl.length} left-out colour${P.excl.length === 1 ? '' : 's'}`)),
      el('div', { class: 'pic-colours' }, P.colours.map((c, i) => el('div', { class: 'pic-colour', onmouseenter: () => { hover = i; drawLines(); }, onmouseleave: () => { hover = -1; drawLines(); }, onfocusin: () => { hover = i; drawLines(); } },
        el('div', { class: 'pic-sw', style: `background:${c.hex}` },
          el('span', { style: `color:${inkOn(c.hex)}` }, el('b', { class: 'pic-n' }, i + 1), c.picked ? ` Picked · ${c.hex}` : ` ${Math.round(c.share * 100)}% · ${c.hex}`),
          el('button', { type: 'button', class: 'icon-btn small', title: c.picked ? 'Remove' : 'Not this colour: leave it out and find another', 'aria-label': c.picked ? 'Remove this colour' : 'Not this colour', onclick: () => {
            if (c.picked) { P.colours.splice(i, 1); drawOut(); return; }
            P.excl.push(c.lab || lab(c.hex)); redo();
          } }, svg(X))),
        matchesBlock(c.hex, { ...matchOpts(P.match), group: 'solid' })))));
    requestAnimationFrame(drawLines);
  };
  const fromModel = async () => {
    try {
      const models = await h().api('GET', '/api/models');
      const withCover = models.filter((m) => m.coverUrl && m.coverKind !== 'video');
      const d = el('dialog', { class: 'sheet narrow', 'aria-label': 'Choose a model' }); document.body.append(d); d.addEventListener('close', () => d.remove());
      const q = el('input', { type: 'search', placeholder: 'Model name', oninput: () => fill() });
      const ul = el('ul', { class: 'pick-list', role: 'list' });
      const fill = () => ul.replaceChildren(...withCover.filter((m) => m.name.toLowerCase().includes(q.value.toLowerCase())).slice(0, 60).map((m) => el('li', {}, el('button', { type: 'button', class: 'pm-row', onclick: () => { d.close(); load(m.coverUrl); } }, el('img', { src: m.coverUrl, alt: '', class: 'pick-thumb', loading: 'lazy' }), el('span', { class: 'pm-name' }, el('b', {}, m.name), el('small', {}, m.designer || ''))))));
      d.append(el('header', { class: 'sheet-head' }, el('h2', {}, 'Use a model\'s cover'), el('button', { class: 'icon-btn close', type: 'button', 'aria-label': 'Close', onclick: () => d.close() }, svg(X))),
        el('div', { class: 'sheet-body stack' }, el('label', { class: 'search' }, el('span', { class: 'sr-only' }, 'Search models'), svg('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'), q), ul));
      fill(); d.showModal(); q.focus();
    } catch (e) { h().fail(e); }
  };
  root.replaceChildren(
    el('p', { class: 'muted tool-intro' }, 'Take the main colours from a photo, artwork or a model\'s cover, and find the paints for them. The background, logos and text are left out. You can also paste a picture with Ctrl+V.'),
    el('div', { class: 'pv-acts' }, btn('Choose a picture', () => file.click(), 'primary'), btn('Use a model\'s cover', fromModel), file),
    P.src ? wrap : emptyBox('No picture yet.'));
  if (P.src) { img = new Image(); img.onload = start; img.onerror = () => h().toast('That picture couldn\'t be opened.', true); img.src = P.src; }
  document.onpaste = (e) => {
    if (S.section !== 'tools' || UI.tool !== 'picture' || document.body.dataset.tab !== 'paints') return;
    const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
    if (f) { e.preventDefault(); load(URL.createObjectURL(f)); }
  };
}

function toolGradient(root) {
  const G = UI.grad;
  G.steps ||= 5; G.match ??= '';
  const a = G.a && S.byId.get(G.a), b = G.b && S.byId.get(G.b);
  const steps = [];
  if (a && b) for (let i = 0; i < G.steps; i++) {
    const t = i / (G.steps - 1), L = a.lab.map((v, j) => v + (b.lab[j] - v) * t);
    const m = i === 0 ? { p: a, d: 0 } : i === G.steps - 1 ? { p: b, d: 0 } : nearest(L, { ...matchOpts(G.match), group: null, exclude: null });
    steps.push({ ideal: labHex(L), m });
  }
  const t = G.thin && S.byId.get(G.thin);
  const thinRow = (under, label) => {
    const amounts = [[0, 'Straight'], [0.25, '4:1'], [0.4, '2:1'], [0.5, '1:1'], [0.67, '1:2'], [0.8, '1:4'], [0.9, '1:9']];
    return el('div', { class: 'thin-row' }, el('small', { class: 'muted' }, label), el('div', { class: 'thin-strip' }, amounts.map(([w, l]) => {
      // Thinner lets the undercoat show through: roughly paint and undercoat mixed by how much pigment is left.
      const cover = Math.pow(1 - w, 1.35);
      const c = mixWeighted(t.h, under, cover);
      return el('div', { class: 'thin-cell', style: `background:${c}` }, el('span', { style: `color:${inkOn(c)}` }, l));
    })));
  };
  root.replaceChildren(
    el('section', { class: 'tool-sec' },
      el('h3', {}, 'Gradient between two paints'),
      el('p', { class: 'muted tool-intro' }, 'Even steps from one paint to another, each matched to a real paint: a highlight ladder you can buy.'),
      el('div', { class: 'two-slots' }, paintSlot(a, 'From (darkest)', (p) => { G.a = p.id; draw(); }), paintSlot(b, 'To (lightest)', (p) => { G.b = p.id; draw(); })),
      el('div', { class: 'view-bar' },
        el('label', { class: 'select-wrap small' }, el('span', { class: 'sr-only' }, 'Steps'), el('select', { onchange: (e) => { G.steps = Number(e.target.value); draw(); } }, [3, 4, 5, 6, 7, 9].map((n) => el('option', { value: n, selected: n === G.steps }, `${n} steps`)))),
        el('span', { class: 'muted' }, 'Match with'), brandSelect(G.match, (v) => { G.match = v; draw(); }, { mine: true })),
      a && b ? el('div', { class: 'ladder-box' },
        el('div', { class: 'grad-steps', style: `grid-template-columns: repeat(${steps.length}, minmax(0, 1fr))` }, steps.map((s, i) => el('div', { class: 'grad-step' },
          el('div', { class: 'grad-ideal', style: `background:${s.ideal}`, title: `Ideal step ${i + 1}: ${s.ideal}` }),
          s.m ? el('button', { type: 'button', class: 'lstep', onclick: () => openPaint(s.m.p) }, el('span', { class: 'lchip', style: swatchStyle(s.m.p) }), el('b', {}, s.m.p.n), el('small', {}, `${brandName(s.m.p.b)}${i && i < steps.length - 1 ? ` · ΔE ${fmt(s.m.d)}` : ''}`)) : el('small', { class: 'muted' }, 'No match')))),
        el('div', { class: 'lramp', style: `background: linear-gradient(90deg, ${steps.map((s) => s.ideal).join(', ')})` }))
        : el('p', { class: 'muted' }, 'Choose both paints to see the steps.')),
    el('section', { class: 'tool-sec' },
      el('h3', {}, 'Thinning'),
      el('p', { class: 'muted tool-intro' }, 'How a paint looks thinned with water or medium over a white and a black undercoat (paint : thinner). A rough guide; real paints differ in how well they cover.'),
      paintSlot(t, 'Paint to thin', (p) => { G.thin = p.id; draw(); }),
      t ? el('div', { class: 'ladder-box' }, thinRow('#F2F1EC', 'Over white'), thinRow('#2A2A2A', 'Over grey'), thinRow('#0E0E0E', 'Over black')) : ''));
}
function mixWeighted(a, b, wa) {
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const gam = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  const x = hexRgb(a).map(lin), y = hexRgb(b).map(lin);
  return `#${x.map((v, i) => Math.round(gam(v * wa + y[i] * (1 - wa)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}
function luminance(hex) { return hexRgb(hex).map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0); }
function toolContrast(root) {
  const C = UI.contrast;
  const a = C.a && S.byId.get(C.a), b = C.b && S.byId.get(C.b);
  let result = null;
  if (a && b) {
    const la = luminance(a.h), lb = luminance(b.h), ratio = (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    const dL = Math.abs(a.lab[0] - b.lab[0]), d = deltaE(a.lab, b.lab);
    const [, ca, ha] = lchOf(a.lab), [, cb, hb] = lchOf(b.lab);
    const hueApart = ca > 7 && cb > 7 ? Math.min(Math.abs(ha - hb), 360 - Math.abs(ha - hb)) : null;
    const value = dL >= 40 ? 'Strong value contrast: the two read apart from across the table, even in a photo in black and white.' : dL >= 20 ? 'Clear value contrast: they separate well up close; add an edge highlight or a line to keep them apart at a distance.' : dL >= 8 ? 'Weak value contrast: they\'re told apart mostly by colour. From a distance, or in grey, they blur into one.' : 'Almost the same value: only the hue separates them. Good for subtle blends, poor for parts that should stand out.';
    const hue = hueApart == null ? 'At least one is close to neutral, so the contrast comes from lightness alone.' : hueApart > 150 ? 'Opposite hues: the strongest colour contrast, each makes the other look brighter.' : hueApart > 90 ? 'Far apart on the colour wheel: lively contrast.' : hueApart > 40 ? 'Moderately different hues.' : 'Neighbouring hues: harmonious, little colour contrast.';
    result = { ratio, dL, d, hueApart, value, hue };
  }
  const grey = (hex) => { const L = lab(hex)[0]; return labHex([L, 0, 0]); };
  root.replaceChildren(
    el('section', { class: 'tool-sec' },
      el('h3', {}, 'How two paints read against each other'),
      el('p', { class: 'muted tool-intro' }, 'Value (lightness) contrast is what makes parts read on the table; colour contrast adds punch.'),
      el('div', { class: 'two-slots' }, paintSlot(a, 'First paint', (p) => { C.a = p.id; draw(); }), paintSlot(b, 'Second paint', (p) => { C.b = p.id; draw(); })),
      result && el('div', { class: 'contrast-out' },
        el('div', { class: 'con-demo' },
          el('div', { class: 'con-box', style: `background:${a.h}` }, el('span', { class: 'con-in', style: `background:${b.h}` })),
          el('div', { class: 'con-box', style: `background:${b.h}` }, el('span', { class: 'con-in', style: `background:${a.h}` })),
          el('div', { class: 'con-box', style: `background:${grey(a.h)}` }, el('span', { class: 'con-in', style: `background:${grey(b.h)}` }), el('small', { style: `color:${inkOn(grey(a.h))}` }, 'In grey'))),
        el('dl', { class: 'paint-facts con-facts' },
          el('div', { class: 'pf-row' }, el('dt', {}, 'Value difference (ΔL)'), el('dd', { class: 'mono' }, fmt(result.dL))),
          el('div', { class: 'pf-row' }, el('dt', {}, 'Contrast ratio'), el('dd', { class: 'mono' }, `${fmt(result.ratio, 2)} : 1`)),
          el('div', { class: 'pf-row' }, el('dt', {}, 'Colour difference (ΔE)'), el('dd', { class: 'mono' }, fmt(result.d))),
          el('div', { class: 'pf-row' }, el('dt', {}, 'Hue apart'), el('dd', { class: 'mono' }, result.hueApart == null ? '—' : `${Math.round(result.hueApart)}°`))),
        el('div', { class: 'paint-notes' }, el('p', {}, result.value), el('p', {}, result.hue)))));
}

// ---------- paint schemes for models ----------
const TECHNIQUES = ['Brush', 'Layering', 'Drybrush', 'Wash', 'Glaze', 'Airbrush', 'Spray', 'Contrast / one-coat', 'Wet blend', 'Stipple', 'Edge highlight'];
const STEPS = [['base', 'Base'], ['shade', 'Shade'], ['highlight', 'Highlight'], ['extra', 'Extra (wash, glaze…)']];
const snap = (p) => p && { id: p.id, n: p.n, b: brandName(p.b), r: p.r, c: p.c, h: p.h };
/** Small summary for the model window: the scheme's colours, or nothing. */
export function schemeStrip(scheme) {
  const zones = scheme?.zones || [];
  const cols = zones.flatMap((z) => STEPS.map(([k]) => z[k]?.h).filter(Boolean));
  return cols;
}
export async function openScheme(model, { onsave = null } = {}) {
  let scheme = (await h().api('GET', `/api/paint-docs?keys=scheme:${model.id}`))[`scheme:${model.id}`] || { zones: [] };
  scheme = JSON.parse(JSON.stringify(scheme));
  let d = document.getElementById('scheme-dlg');
  if (!d) { d = el('dialog', { id: 'scheme-dlg', class: 'sheet scheme-dlg', 'aria-labelledby': 'scheme-h' }); document.body.append(d); }
  let placing = null; // zone index waiting for a click on the picture
  let picking = null; // zone index waiting for a colour pick from the picture
  const imgEl = model.coverUrl && model.coverKind !== 'video' ? el('img', { src: model.coverUrl, alt: `${model.name} cover`, crossorigin: 'anonymous' }) : null;
  const save = async (quiet = false) => {
    try { await h().api('PUT', `/api/paint-docs/scheme:${model.id}`, { value: scheme.zones.length ? scheme : null }); if (!quiet) h().toast('Paint scheme saved'); onsave?.(scheme); } catch (e) { h().fail(e); }
  };
  const missing = () => { const ids = new Set(); for (const z of scheme.zones) for (const [k] of STEPS) if (z[k] && !S.docs.owned[z[k].id]) ids.add(z[k].id); return [...ids].map((id) => S.byId.get(id)).filter(Boolean); };
  const render = () => {
    const miss = missing();
    const picture = imgEl && el('div', { class: `scheme-pic${placing != null || picking != null ? ' aiming' : ''}`, onclick: (e) => {
      if (placing == null && picking == null) return;
      const r = e.currentTarget.querySelector('img').getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      if (x < 0 || y < 0 || x > 1 || y > 1) return;
      if (placing != null) { scheme.zones[placing].pin = [x, y]; placing = null; save(true); render(); return; }
      // Pick a colour from the cover and suggest paints for this zone.
      try {
        const c = document.createElement('canvas'); const im = e.currentTarget.querySelector('img');
        c.width = im.naturalWidth; c.height = im.naturalHeight; const cx = c.getContext('2d'); cx.drawImage(im, 0, 0);
        const px = cx.getImageData(Math.round(x * c.width), Math.round(y * c.height), 1, 1).data;
        const hex = `#${[px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
        const zi = picking.zone, step = picking.step; picking = null;
        // Close paints you own first (only when they're genuinely close), then the closest of all.
        const opts = nearest(lab(hex), { n: 6, group: 'solid' });
        const mineFirst = nearest(lab(hex), { n: 2, group: 'solid', mineOnly: true }).filter((m) => m.d < 8);
        suggest(zi, hex, [...mineFirst, ...opts.filter((o) => !mineFirst.some((m) => m.p === o.p))].slice(0, 6), step);
      } catch { picking = null; h().toast('The colour couldn\'t be read from this picture.', true); render(); }
    } }, imgEl, scheme.zones.map((z, i) => z.pin && el('span', { class: 'scheme-pin', style: `left:${z.pin[0] * 100}%;top:${z.pin[1] * 100}%;background:${z.base?.h || '#888'};color:${inkOn(z.base?.h || '#888888')}`, title: z.name }, i + 1)));
    const zoneEl = (z, i) => el('section', { class: 'zone' },
      el('div', { class: 'zone-head' },
        el('span', { class: 'hnum' }, i + 1),
        el('input', { class: 'zone-name', value: z.name, placeholder: 'Zone, e.g. Skin, Cloak, Armour', 'aria-label': `Zone ${i + 1} name`, onchange: (e) => { z.name = e.target.value; save(true); } }),
        el('label', { class: 'select-wrap small' }, el('span', { class: 'sr-only' }, 'Technique'), el('select', { onchange: (e) => { z.technique = e.target.value; save(true); } }, TECHNIQUES.map((t) => el('option', { value: t, selected: z.technique === t }, t)))),
        el('button', { type: 'button', class: 'icon-btn small', 'aria-label': `Remove zone ${z.name || i + 1}`, onclick: () => { scheme.zones.splice(i, 1); save(true); render(); } }, svg(X))),
      el('div', { class: 'zone-steps' }, STEPS.map(([k, label]) => {
        const p = z[k] && (S.byId.get(z[k].id) || null);
        return el('div', { class: 'zone-step' }, paintSlot(p, label, (q) => { z[k] = snap(q); save(true); render(); }),
          el('div', { class: 'step-links' },
            imgEl && el('button', { type: 'button', class: `link-inline small-x${picking?.zone === i && picking.step === k ? ' on' : ''}`, title: `Pick the ${label.toLowerCase()} colour from the picture`, onclick: () => { picking = { zone: i, step: k }; placing = null; render(); } }, 'From picture'),
            z[k] && el('button', { type: 'button', class: 'link-inline small-x', onclick: () => { delete z[k]; save(true); render(); } }, 'Clear')));
      })),
      el('div', { class: 'zone-acts' },
        z.base && btn('Fill shade and highlight', () => {
          const p = S.byId.get(z.base.id); if (!p) return;
          // Same brand as the base, two steps darker and lighter, like the paint window's ladder.
          const darker = nearest(lab(labHex([Math.max(3, p.lab[0] - 14), p.lab[1] * 0.95, p.lab[2] * 0.95])), { brand: p.b, group: groupOf(p), exclude: p });
          const lighter = nearest(lab(labHex([Math.min(97, p.lab[0] + 14), p.lab[1] * 0.85, p.lab[2] * 0.85])), { brand: p.b, group: groupOf(p), exclude: p });
          if (darker) z.shade = snap(darker.p); if (lighter) z.highlight = snap(lighter.p); save(true); render();
        }),
        imgEl && btn(z.pin ? 'Move the marker' : 'Mark it on the picture', () => { placing = i; picking = null; render(); }),
        imgEl && btn('Pick its colour from the picture', () => { picking = { zone: i, step: STEPS.map(([k]) => k).find((k) => !z[k]) || 'base' }; placing = null; render(); }),
        el('input', { class: 'zone-note', value: z.note || '', placeholder: 'Notes (thinning, order, tips)', 'aria-label': 'Zone notes', onchange: (e) => { z.note = e.target.value; save(true); } })));
    const sg = UI.suggest, sz = sg && scheme.zones[sg.zone];
    const suggestBox = sg && el('div', { class: 'suggest' },
      el('p', {}, el('span', { class: 'pdot big', style: `background:${sg.hex}` }), `Paints closest to the colour you picked for ${sz?.name || `zone ${sg.zone + 1}`}. Use it as:`),
      el('div', { class: 'seg', role: 'group', 'aria-label': 'Use the paint as' }, STEPS.map(([k, label]) => el('button', { type: 'button', 'aria-pressed': String(sg.step === k), onclick: () => { sg.step = k; render(); } },
        el('span', {}, label.replace(/ \(.*\)$/, '')), sz?.[k] ? el('small', { class: 'seg-note' }, ' (replaces)') : ''))),
      el('ul', { class: 'mini-matches', role: 'list' }, sg.list.map((x) => el('li', {}, chipRow(x.p, { onclick: () => { scheme.zones[sg.zone][sg.step] = snap(x.p); UI.suggest = null; save(true); render(); }, extra: el('span', { class: 'pm-close d1' }, `ΔE ${fmt(x.d)}`) })))),
      btn('Close', () => { UI.suggest = null; render(); }));
    d.replaceChildren(
      el('header', { class: 'sheet-head' }, el('h2', { id: 'scheme-h' }, `Paint scheme: ${model.name}`),
        el('p', { class: 'muted' }, placing != null ? 'Click on the picture where this zone is.' : picking != null ? `Click on the picture to pick the ${(STEPS.find(([k]) => k === picking.step)?.[1] || 'base').toLowerCase().replace(/ \(.*\)$/, '')} colour.` : 'Zones with their base, shade and highlight paints. Saved as you go.'),
        el('button', { class: 'icon-btn close', 'aria-label': 'Close', onclick: () => d.close() }, svg(X))),
      el('div', { class: 'sheet-body scheme-body' },
        picture ? el('div', { class: 'scheme-left' }, picture) : '',
        el('div', { class: 'scheme-right' },
          suggestBox || '',
          scheme.zones.length ? scheme.zones.map(zoneEl) : el('p', { class: 'muted' }, 'No zones yet. Add one for each part you\'ll paint: skin, cloth, armour, base…'),
          el('div', { class: 'pv-acts' },
            btn('Add a zone', () => { scheme.zones.push({ name: '', technique: 'Brush' }); save(true); render(); setTimeout(() => d.querySelectorAll('.zone-name')[scheme.zones.length - 1]?.focus(), 30); }, 'primary'),
            miss.length > 0 && btn(`Add ${miss.length} paint${miss.length === 1 ? '' : 's'} you don't own to the shopping list`, async () => { for (const p of miss) if (!S.docs.shopping[p.id]) S.docs.shopping[p.id] = { qty: 1, added: Date.now(), note: `For ${model.name}` }; await saveDoc('shopping'); h().toast(`${miss.length} paint${miss.length === 1 ? '' : 's'} added to the shopping list`); render(); }),
            scheme.zones.length > 0 && btn('Print sheet', () => printScheme(model, scheme))))));
  };
  const suggest = (zone, hex, list, step = 'base') => { UI.suggest = { zone, hex, list, step }; render(); };
  UI.suggest = null;
  d.onclose = () => { UI.suggest = null; };
  render();
  if (!d.open) d.showModal();
}
function printSheet(title, ...content) {
  const w = window.open('', '_blank');
  if (!w) { h().toast('Allow pop-ups for ModelVault to print.', true); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/[<&]/g, '')}</title><style>
    body{font:14px/1.45 system-ui,sans-serif;color:#111;margin:28px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:22px 0 8px}
    .sw{display:inline-block;width:22px;height:22px;border-radius:5px;vertical-align:middle;margin-right:8px;border:1px solid #0002;print-color-adjust:exact;-webkit-print-color-adjust:exact}
    table{border-collapse:collapse;width:100%}td,th{padding:6px 8px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}th{font-size:12px;color:#555}
    .pic{position:relative;display:inline-block;max-width:320px;float:right;margin:0 0 12px 18px}.pic img{max-width:100%;border-radius:8px}
    .pin{position:absolute;transform:translate(-50%,-50%);width:22px;height:22px;border-radius:50%;font:700 12px/22px system-ui;text-align:center;border:2px solid #fff;box-shadow:0 0 0 1px #0006;print-color-adjust:exact;-webkit-print-color-adjust:exact}
    small{color:#666}pre{font:13px/1.5 ui-monospace,monospace;white-space:pre-wrap}</style></head><body></body></html>`);
  w.document.close();
  w.document.body.append(...content.map((c) => w.document.importNode(c, true)));
  w.document.body.prepend(Object.assign(w.document.createElement('h1'), { textContent: title }));
  setTimeout(() => w.print(), 400);
}
function printScheme(model, scheme) {
  const wrap = el('div', {});
  if (model.coverUrl && model.coverKind !== 'video') wrap.append(el('div', { class: 'pic' }, el('img', { src: new URL(model.coverUrl, location.href).href, alt: '' }),
    scheme.zones.map((z, i) => z.pin && el('span', { class: 'pin', style: `left:${z.pin[0] * 100}%;top:${z.pin[1] * 100}%;background:${z.base?.h || '#888'};color:${inkOn(z.base?.h || '#888888')}` }, i + 1))));
  wrap.append(el('p', {}, el('small', {}, [model.designer, `${scheme.zones.length} zones`, `printed ${new Date().toLocaleDateString()}`].filter(Boolean).join(' · '))));
  wrap.append(el('table', {}, el('thead', {}, el('tr', {}, ['#', 'Zone', 'Technique', 'Base', 'Shade', 'Highlight', 'Extra'].map((t) => el('th', {}, t)))),
    el('tbody', {}, scheme.zones.map((z, i) => el('tr', {}, el('td', {}, i + 1), el('td', {}, el('b', {}, z.name || `Zone ${i + 1}`), z.note ? el('div', {}, el('small', {}, z.note)) : ''), el('td', {}, z.technique || ''),
      STEPS.map(([k]) => el('td', {}, z[k] ? [el('span', { class: 'sw', style: `background:${z[k].h}` }), z[k].n, el('div', {}, el('small', {}, `${z[k].b} ${z[k].r}${z[k].c ? ` ${z[k].c}` : ''}${S.docs.owned[z[k].id] ? ' · owned' : ''}`))] : '')))))));
  printSheet(`Paint scheme: ${model.name}`, wrap);
}

// ---------- entry ----------
export function render(section) {
  const root = h().$('#paints');
  const title = { mine: 'My paints', shopping: 'Shopping list', lists: 'Paint lists', racks: 'Racks', explore: 'Explore by colour', tools: 'Colour tools' }[section] || '';
  h().$('#paint-title').textContent = title;
  ({ mine: renderMine, shopping: renderShopping, lists: renderLists, racks: renderRacks, explore: renderExplore, tools: renderTools }[section] || (() => {}))(root);
}
