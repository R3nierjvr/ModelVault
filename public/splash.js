// Opening splash: timing, skipping and sound. The picture itself is CSS (app.css, "opening splash").
// Every sound is made here with the Web Audio API, so there are no audio files to load.
(() => {
  const first = document.getElementById('splash');
  if (!first) return;
  const keep = first.cloneNode(true); // a fresh copy for "Play it now" in Settings
  const pref = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
  let seen = false;
  try { seen = sessionStorage.getItem('mv.splashSeen') === '1'; sessionStorage.setItem('mv.splashSeen', '1'); } catch { /* private mode: show it */ }
  window.mvSplash = { replay: () => run(keep.cloneNode(true)) };
  if (seen || pref('mv.splash', 'on') === 'off') first.remove();
  else run(first);

  function run(sp) {
    if (!sp.isConnected) document.body.prepend(sp);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const LENGTH = reduce ? 3.5 : 9; // the animation is 6 s; the finished logo then stays for 3 s
    const btn = sp.querySelector('.sp-sound');
    const elapsed = () => { const a = sp.querySelector('.sp-move')?.getAnimations()[0]; return a && a.currentTime != null ? a.currentTime / 1000 : 0; };
    let audio = null;

    // While the browser is holding the sound back, the first tap or Enter/Space turns it on instead of skipping.
    const blocked = () => btn?.dataset.state === 'blocked';
    const onKey = (e) => {
      if (e.key === 'Escape') done();
      else if (['Enter', ' '].includes(e.key)) { e.preventDefault(); blocked() ? start() : done(); }
    };
    function done(atEnd) {
      removeEventListener('keydown', onKey);
      if (!sp.isConnected) return;
      audio?.stop(atEnd ? 0.25 : 0.12);
      if (atEnd === true) return sp.remove();
      sp.classList.add('sp-out');
      setTimeout(() => sp.remove(), 320);
    }
    setTimeout(() => done(true), LENGTH * 1000);
    sp.addEventListener('click', () => (blocked() ? start() : done()));
    sp.querySelector('.sp-skip')?.addEventListener('click', (e) => { e.stopPropagation(); done(); });
    addEventListener('keydown', onKey);

    // ----- sound -----
    const show = (state) => {
      if (!btn) return;
      btn.dataset.state = state; // on | off | blocked
      btn.setAttribute('aria-pressed', String(state === 'on'));
      btn.setAttribute('aria-label', state === 'on' ? 'Sound on. Turn it off' : 'Turn sound on');
      btn.querySelector('.sp-sound-text').textContent = state === 'blocked' ? 'Tap anywhere for sound' : '';
    };
    const start = () => {
      if (!audio) audio = makeAudio();
      if (!audio) return show('off');
      audio.ctx.resume().then(() => {
        if (!sp.isConnected) return;
        audio.play(elapsed(), reduce);
        show('on');
      }).catch(() => show('blocked'));
    };
    btn?.addEventListener('click', (e) => {
      e.stopPropagation(); // the button doesn't skip the splash
      // Mutes this one showing only; the lasting choice is in Settings > Library > Opening animation.
      if (btn.dataset.state === 'on') { audio?.stop(0.1); audio = null; show('off'); }
      else start();
    });
    if (pref('mv.splashAudio', 'on') === 'off') return show('off'); // sound is on unless turned off in Settings
    audio = makeAudio();
    if (!audio) return show('off');
    // Browsers only allow sound after you've clicked something on the page, unless ModelVault is installed as an app.
    if (audio.ctx.state === 'running') { audio.play(elapsed(), reduce); show('on'); }
    else {
      show('blocked');
      audio.ctx.resume().then(() => { if (sp.isConnected && btn?.dataset.state === 'blocked') { audio.play(elapsed(), reduce); show('on'); } }).catch(() => {});
    }
  }

  function makeAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    let ctx;
    try { ctx = new AC(); } catch { return null; }
    const out = ctx.createDynamicsCompressor();
    out.threshold.value = -14; out.ratio.value = 4;
    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(out); out.connect(ctx.destination);
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    let playing = false;

    const env = (g, t, peak, attack, dur) => {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    };
    // Filtered noise, with the filter sweeping from f0 to f1.
    const noise = (t, dur, { type = 'lowpass', f0 = 800, f1 = f0, q = 1, gain = 0.2, attack = 0.01 } = {}) => {
      const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
      f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ctx.createGain(); env(g, t, gain, attack, dur);
      s.connect(f); f.connect(g); g.connect(master);
      s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
    };
    const tone = (t, freq, dur, { type = 'sine', gain = 0.1, attack = 0.005, to = freq } = {}) => {
      const o = ctx.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (to !== freq) o.frequency.exponentialRampToValueAtTime(to, t + dur);
      const g = ctx.createGain(); env(g, t, gain, attack, dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.05);
    };

    // The printer's stepper motors: a buzzy tone that changes pitch on every pass, with a tick at each turn.
    const stepper = (t0, from) => {
      const L = 14, start = 0.6, len = 2.0, seg = len / L;
      const notes = [262, 294, 330, 294, 349, 330, 392, 349, 330, 392, 440, 392, 349, 523];
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
      o1.type = 'square'; o2.type = 'sawtooth';
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500; lp.Q.value = 2;
      const g = ctx.createGain(); g.gain.value = 0.0001;
      o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(master);
      let began = false;
      for (let i = 0; i < L; i++) {
        const ts = start + i * seg;
        if (ts + seg <= from) continue;
        const at = t0 + Math.max(ts, from);
        o1.frequency.setValueAtTime(notes[i], at); o2.frequency.setValueAtTime(notes[i] * 2.005, at);
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(0.03, at + 0.02);
        g.gain.setValueAtTime(0.03, t0 + ts + seg - 0.025);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + ts + seg - 0.004);
        noise(t0 + ts + seg - 0.006, 0.02, { type: 'highpass', f0: 3200, gain: 0.07, attack: 0.002 });
        began = true;
      }
      if (!began) return;
      o1.start(t0 + Math.max(start, from)); o2.start(t0 + Math.max(start, from));
      o1.stop(t0 + start + len + 0.05); o2.stop(t0 + start + len + 0.05);
    };

    // Every cue at its moment in the 6-second animation (seconds).
    const CUES = [
      [0.15, (t) => noise(t, 0.45, { type: 'bandpass', f0: 1400, f1: 380, q: 1.2, gain: 0.08, attack: 0.08 })],            // nozzle drops in
      [2.62, (t) => { tone(t, 1318.5, 0.9, { gain: 0.1 }); tone(t + 0.08, 1975.5, 1.1, { gain: 0.08 }); tone(t + 0.08, 2637, 0.7, { gain: 0.025 }); }], // star finished
      [2.72, (t) => { noise(t, 0.55, { f0: 160, f1: 520, gain: 0.35, attack: 0.12 }); tone(t, 52, 0.55, { gain: 0.2, attack: 0.1 }); }], // vault rolls in
      [3.36, (t) => noise(t, 0.45, { type: 'bandpass', f0: 500, f1: 2600, q: 0.9, gain: 0.55, attack: 0.15 })],             // shove
      [3.85, (t) => { tone(t, 150, 0.2, { gain: 0.28, to: 70 }); noise(t, 0.07, { f0: 500, gain: 0.12 }); }],               // lands inside
      [3.9, (t) => { noise(t, 0.6, { type: 'bandpass', f0: 280, f1: 950, q: 1.2, gain: 0.5, attack: 0.3 }); tone(t + 0.05, 92, 0.5, { type: 'sawtooth', gain: 0.03, to: 118, attack: 0.15 }); }], // door swings
      [4.5, (t) => { // door slams shut
        tone(t, 72, 0.6, { gain: 0.5, to: 36 });
        noise(t, 0.28, { f0: 380, f1: 120, gain: 0.32, attack: 0.003 });
        for (const [f, g] of [[181, 0.05], [427, 0.04], [731, 0.03], [1093, 0.02], [1621, 0.012]]) tone(t, f, 1.3, { gain: g, attack: 0.003 });
      }],
      [4.64, (t) => { for (let i = 0; i < 6; i++) { noise(t + i * 0.055, 0.014, { type: 'highpass', f0: 2600, gain: 0.16, attack: 0.001 }); tone(t + i * 0.055, 1700 + i * 60, 0.025, { gain: 0.03 }); } }], // handle ratchets
      [4.78, (t) => { for (let i = 0; i < 8; i++) tone(t + i * 0.018, 2600 + i * 95, 0.35, { gain: 0.02 }); }],           // bolts light up
      [5.0, (t) => { tone(t, 230, 0.14, { gain: 0.22, to: 105 }); noise(t, 0.05, { type: 'bandpass', f0: 1500, q: 2, gain: 0.18, attack: 0.002 }); }], // locks
      [5.05, (t) => { // the logo: a warm chord that fades with the splash
        const end = t + 3.9; // rings on, slowly fading, while the logo holds
        for (const f of [261.6, 329.6, 392, 587.3]) {
          const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
          const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.045, t + 0.35); g.gain.exponentialRampToValueAtTime(0.012, end - 0.5); g.gain.exponentialRampToValueAtTime(0.0001, end);
          o.connect(lp); lp.connect(g); g.connect(master); o.start(t); o.stop(end + 0.05);
        }
        tone(t + 0.12, 2637, 0.8, { gain: 0.02 });
      }],
    ];

    return {
      ctx,
      /** Play from `from` seconds into the animation, skipping what has already happened. */
      play(from = 0, short = false) {
        if (playing) return;
        playing = true;
        const t0 = ctx.currentTime + 0.02 - from;
        if (short) { CUES[CUES.length - 1][1](ctx.currentTime + 0.02); return; } // reduced motion: just the closing chord
        stepper(t0, from);
        for (const [at, cue] of CUES) if (at >= from - 0.03) cue(t0 + Math.max(at, from));
      },
      stop(fade = 0.12) {
        const now = ctx.currentTime;
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(master.gain.value, now);
        master.gain.linearRampToValueAtTime(0, now + fade);
        setTimeout(() => ctx.close().catch(() => {}), (fade + 0.1) * 1000);
      },
    };
  }
})();
