// First-time tour: the page is dimmed (75%) apart from a spotlight on one thing at a time, with a card that
// explains it. The card can be dragged out of the way by its top bar; once moved it stays where it was put.
// Back / Next (or the arrow keys) move through the steps; Skip tour (or Esc) ends it.

const STEPS = [
  { title: 'Welcome to ModelVault', text: 'ModelVault keeps your 3D print models, paints, filament, resin and tools in one place. This quick tour shows you around; it takes about a minute.', next: 'Show me around' },
  { target: '#upload-btn', title: 'Add models', text: 'Press Add models, or drag files and folders anywhere onto the page. ZIP, 7Z and RAR archives, STL, 3MF, OBJ, pictures and PDFs all work, and each archive becomes one model.' },
  { target: '#browse-btn', title: 'Browse downloads', text: 'Pick files straight from your downloads folder, or any other folder ModelVault can see. Anything you\'ve added before is flagged, so you don\'t import it twice.' },
  { target: '#imports-btn', title: 'Imports', text: 'New files wait here until you check them. Give each one a name, designer, categories and a cover, then press Add to library.' },
  { target: '.sidebar .search', title: 'Find your models', text: 'Search by name, designer or tag. Below the search box you can filter by category and designer, and jump to your favourites or what you added this week.' },
  { target: '#view-mode', title: 'Pick a view', text: 'Show your models as tiles, as a detailed list, or by the folders they\'re in. The slider next to it changes the size of the tiles.' },
  { target: '#tab-paints', title: 'Paints', text: 'About 6,000 miniature paints. Mark the ones you own, find matches across brands, make a palette from a picture and plan a paint scheme for each model.' },
  { target: '#tab-materials', title: 'Materials', text: 'Your filament spools and resin bottles, and how much is left. The Material guide shows what each filament and resin needs, checked against your printers.' },
  { target: '#tab-tools', title: 'Tools', text: 'Your printers, nozzles, airbrushes, brushes and more, with service reminders. Start with Add your printer: pick it from the list and its details fill themselves in.' },
  { target: '#settings-btn', title: 'Settings', text: 'How your models and folders are named, watch folders for new downloads, importing an existing library, backups and updates. You can take this tour again from Settings > About.' },
  { title: 'You\'re all set', text: 'Add your first models, or bring in the library you already have.', allSet: true, extra: true },
  { target: '.made-by .dino-link', title: 'Support ModelVault', text: 'ModelVault is free, and made by one person in their spare time. If it saves you time, please consider buying me a dinosaur on Ko-fi or sponsoring me on GitHub. The 🦖 at the bottom of the sidebar and Settings > About take you there any time.',
    links: [{ label: '🦖 Buy me a dinosaur', href: 'https://ko-fi.com/v3sperstudios', primary: true }, { label: 'Sponsor on GitHub', href: 'https://github.com/sponsors/R3nierjvr' }], finish: true },
];

let active = null;

/**
 * Starts the tour. opts: { platform, onEnd(completed), importLibrary() }.
 * Returns false if a tour is already running.
 */
export function startTour(opts = {}) {
  if (active) return false;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const steps = STEPS.map((s) => (s.allSet && opts.platform === 'win32'
    ? { ...s, text: `${s.text} On Windows, ModelVault's icon next to the clock shows whether it's running; right-click it to stop ModelVault or view its log.` }
    : s));
  let i = 0, moved = null, drag = null, raf = 0;

  const root = document.createElement('div');
  root.className = `tour${reduce ? ' tour-still' : ''}`;
  root.innerHTML = `
    <div class="tour-block"></div>
    <div class="tour-spot" aria-hidden="true"></div>
    <section class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-text">
      <div class="tour-grip" title="Drag to move this card">
        <span class="tour-count"></span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="7" r="1.3"/><circle cx="15" cy="7" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="17" r="1.3"/><circle cx="15" cy="17" r="1.3"/></svg>
      </div>
      <h2 id="tour-title"></h2>
      <p id="tour-text"></p>
      <div class="tour-links" hidden></div>
      <div class="tour-dots" aria-hidden="true"></div>
      <div class="tour-actions">
        <button type="button" class="link-btn tour-skip">Skip tour</button>
        <span class="tour-gap"></span>
        <button type="button" class="btn ghost small tour-back">Back</button>
        <button type="button" class="btn ghost small tour-extra" hidden>Import an existing library</button>
        <button type="button" class="btn primary small tour-next">Next</button>
      </div>
    </section>`;
  const $ = (s) => root.querySelector(s);
  const card = $('.tour-card'), spot = $('.tour-spot');
  $('.tour-dots').append(...steps.map(() => document.createElement('i')));
  document.body.append(root);
  const before = document.activeElement;

  const visible = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) return null;
    if (getComputedStyle(el).visibility === 'hidden') return null;
    return r;
  };

  function place() {
    const s = steps[i];
    const el = s.target ? document.querySelector(s.target) : null;
    const r = visible(el);
    const pad = 8;
    if (r) {
      Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px`, opacity: '1' });
    } else {
      Object.assign(spot.style, { left: `${innerWidth / 2}px`, top: `${innerHeight / 2}px`, width: '0px', height: '0px', opacity: '1' });
    }
    const cw = card.offsetWidth, ch = card.offsetHeight, m = 16;
    let x, y;
    if (moved) ({ x, y } = moved);
    else if (!r) { x = (innerWidth - cw) / 2; y = (innerHeight - ch) / 2; }
    else {
      const gap = 18;
      const spots = [
        [r.left + r.width / 2 - cw / 2, r.bottom + pad + gap],   // below
        [r.left + r.width / 2 - cw / 2, r.top - pad - gap - ch], // above
        [r.right + pad + gap, r.top + r.height / 2 - ch / 2],    // right
        [r.left - pad - gap - cw, r.top + r.height / 2 - ch / 2], // left
      ];
      const fits = ([a, b]) => b >= m && b + ch <= innerHeight - m && a + cw >= m && a <= innerWidth - m;
      [x, y] = spots.find(([a, b]) => fits([a, b]) && a >= m && a + cw <= innerWidth - m) || spots.find(fits) || [(innerWidth - cw) / 2, innerHeight - ch - m];
    }
    x = Math.min(Math.max(m, x), Math.max(m, innerWidth - cw - m));
    y = Math.min(Math.max(m, y), Math.max(m, innerHeight - ch - m));
    card.style.left = `${x}px`;
    card.style.top = `${y}px`;
  }
  const replace = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(place); };

  function show(n) {
    i = Math.max(0, Math.min(steps.length - 1, n));
    const s = steps[i];
    const el = s.target ? document.querySelector(s.target) : null;
    if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    $('#tour-title').textContent = s.title;
    $('#tour-text').textContent = s.text;
    $('.tour-count').textContent = `${i + 1} of ${steps.length}`;
    [...$('.tour-dots').children].forEach((d, k) => d.classList.toggle('on', k <= i));
    $('.tour-back').hidden = i === 0;
    $('.tour-skip').hidden = !!s.finish;
    $('.tour-extra').hidden = !s.extra || !opts.importLibrary;
    const links = $('.tour-links');
    links.hidden = !s.links;
    links.replaceChildren(...(s.links || []).map((l) => Object.assign(document.createElement('a'), {
      className: `btn small ${l.primary ? 'primary' : 'ghost'}`, href: l.href, target: '_blank', rel: 'noopener noreferrer', textContent: l.label })));
    $('.tour-next').textContent = s.finish ? 'Finish' : s.next || 'Next';
    card.classList.toggle('tour-wide', !s.target);
    place();
    $('.tour-next').focus({ preventScroll: true });
  }

  function end(completed, then) {
    if (!active) return;
    active = null;
    removeEventListener('resize', replace);
    removeEventListener('scroll', replace, true);
    removeEventListener('keydown', onKey, true);
    root.classList.add('tour-out');
    setTimeout(() => root.remove(), reduce ? 0 : 200);
    if (before?.focus && before.isConnected) before.focus({ preventScroll: true });
    opts.onEnd?.(completed);
    then?.();
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(false); }
    else if (e.key === 'ArrowRight' && !steps[i].finish) { e.preventDefault(); show(i + 1); }
    else if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); show(i - 1); }
    else if (e.key === 'Tab') {
      // Keep the keyboard inside the card.
      const f = [...card.querySelectorAll('button, a')].filter((b) => !b.hidden && !b.closest('[hidden]'));
      const k = f.indexOf(document.activeElement);
      if (e.shiftKey && k <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && k === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  }

  $('.tour-next').addEventListener('click', () => (steps[i].finish ? end(true) : show(i + 1)));
  $('.tour-back').addEventListener('click', () => show(i - 1));
  $('.tour-skip').addEventListener('click', () => end(false));
  $('.tour-extra').addEventListener('click', () => end(true, opts.importLibrary));

  // Dragging the card by its top bar.
  const grip = $('.tour-grip');
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const r = card.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    grip.setPointerCapture(e.pointerId);
    card.classList.add('tour-dragging');
  });
  grip.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const x = Math.min(Math.max(8, e.clientX - drag.dx), innerWidth - card.offsetWidth - 8);
    const y = Math.min(Math.max(8, e.clientY - drag.dy), innerHeight - card.offsetHeight - 8);
    card.style.left = `${x}px`;
    card.style.top = `${y}px`;
    moved = { x, y };
  });
  const drop = () => { drag = null; card.classList.remove('tour-dragging'); };
  grip.addEventListener('pointerup', drop);
  grip.addEventListener('pointercancel', drop);
  grip.addEventListener('dblclick', () => { moved = null; place(); }); // double-click: back next to the highlight

  addEventListener('resize', replace);
  addEventListener('scroll', replace, true);
  addEventListener('keydown', onKey, true);
  active = { end };
  requestAnimationFrame(() => { root.classList.add('tour-in'); show(0); });
  return true;
}
