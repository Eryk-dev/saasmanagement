// Áudio do modo foco — 3 ambientes 100% sintetizados via Web Audio (nada de
// stream nem arquivo: funciona offline, sem copyright, nunca cai):
//   brown  — ruído marrom (graves densos, o clássico pra concentração)
//   wave40 — batida binaural de 40Hz gamma (L 200Hz / R 240Hz — o cérebro percebe a
//            diferença) — precisa de FONE estéreo pra fazer efeito
//   lofi   — ambient generativo: pads de acordes lentos + vinyl crackle +
//            kick surdo ~72bpm
// Singleton por aba; modo/volume persistem em localStorage.

const LS_KEY = "cockpit_focus_audio";

export const FOCUS_AUDIO_MODES = [
  { id: "brown", label: "ruído" },
  { id: "wave40", label: "40hz" },
  { id: "lofi", label: "lofi" },
];

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function makeFocusAudio() {
  let ctx = null, master = null, cleanup = null, mode = null;

  let prefs = { mode: "brown", volume: 0.5 };
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(LS_KEY) || "{}") }; } catch { /* default */ }
  if (!FOCUS_AUDIO_MODES.some((m) => m.id === prefs.mode)) prefs.mode = "brown"; // prefs antigas/inválidas
  const savePrefs = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ } };

  function ensureCtx() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
  }

  // ── ruído marrom: random walk num buffer com o fim fundido no começo (loop sem clique)
  function buildBrown() {
    const secs = 8, rate = ctx.sampleRate, n = secs * rate;
    const buf = ctx.createBuffer(1, n, rate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    const fade = Math.floor(0.4 * rate);
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      d[n - fade + i] = d[n - fade + i] * (1 - t) + d[i] * t;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const g = ctx.createGain(); g.gain.value = 0.4;
    src.connect(g).connect(master);
    src.start();
    return () => { try { src.stop(); } catch { /* já parado */ } };
  }

  // ── binaural 40Hz: um tom em cada ouvido, o "beat" é a diferença
  function buildWave40() {
    const parts = [[200, -1], [240, 1]].map(([hz, pan]) => {
      const osc = ctx.createOscillator(); osc.type = "sine"; osc.frequency.value = hz;
      const p = ctx.createStereoPanner(); p.pan.value = pan;
      const g = ctx.createGain(); g.gain.value = 0.12;
      osc.connect(p).connect(g).connect(master);
      osc.start();
      return osc;
    });
    return () => parts.forEach((o) => { try { o.stop(); } catch { /* já parado */ } });
  }

  // ── lofi boombap (~86bpm com swing): kick no 1 e no "e" do 3, snare no 2 e 4,
  // hats macios no contratempo, baixo redondo seguindo o acorde, pads escuros e
  // crackle de vinil GRAVE (lowpass — nada de chiado agudo).
  function buildLofi() {
    const stops = [];
    const spb = 60 / 86;         // segundos por tempo
    const BAR = 4 * spb;
    const swing = 0.14 * spb;    // contratempos levemente atrasados

    // bus da bateria: tudo abafado num lowpass (o "lo-fi")
    const drums = ctx.createBiquadFilter(); drums.type = "lowpass"; drums.frequency.value = 4200;
    drums.connect(master);

    // ruído base reutilizado pra snare/hat
    const nbuf = ctx.createBuffer(1, Math.floor(0.25 * ctx.sampleRate), ctx.sampleRate);
    const nd = nbuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    const live = new Set();
    const keep = (node) => { live.add(node); node.onended = () => live.delete(node); };

    function kick(t) {
      const o = ctx.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(95, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      o.connect(g).connect(drums); o.start(t); o.stop(t + 0.42); keep(o);
    }
    function snare(t) {
      const s = ctx.createBufferSource(); s.buffer = nbuf;
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1500; bp.Q.value = 0.9;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.3, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      s.connect(bp).connect(g).connect(drums); s.start(t); s.stop(t + 0.2); keep(s);
    }
    function hat(t) {
      const s = ctx.createBufferSource(); s.buffer = nbuf;
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 3200; bp.Q.value = 1.1;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.04, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      s.connect(bp).connect(g).connect(drums); s.start(t); s.stop(t + 0.06); keep(s);
    }
    function bass(t, midi, dur) {
      const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = midiHz(midi - 24);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.17, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.05); keep(o);
    }

    // pads escuros: i–VI–VII–v em dó menor, um acorde a cada 2 compassos
    const CHORDS = [
      [48, 55, 58, 63], // Cm7
      [44, 51, 56, 60], // AbMaj7
      [46, 53, 58, 62], // Bb-ish
      [43, 50, 55, 58], // Gm-ish
    ];
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 750;
    lp.connect(master);
    function pad(t, notes, dur) {
      for (const m of notes) {
        const o = ctx.createOscillator(); o.type = "triangle"; o.frequency.value = midiHz(m);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.045, t + 1.6);
        g.gain.setValueAtTime(0.045, t + dur - 1.4);
        g.gain.linearRampToValueAtTime(0, t + dur + 0.4);
        o.connect(g).connect(lp); o.start(t); o.stop(t + dur + 0.5); keep(o);
      }
    }

    // crackle de vinil grave: impulsos raros num lowpass (textura, sem "tsss")
    const cbuf = ctx.createBuffer(1, 4 * ctx.sampleRate, ctx.sampleRate);
    const cd = cbuf.getChannelData(0);
    for (let i = 0; i < cd.length; i++) {
      cd[i] = Math.random() < 0.0007 ? (Math.random() * 2 - 1) * 0.3 : (Math.random() * 2 - 1) * 0.006;
    }
    const crackle = ctx.createBufferSource(); crackle.buffer = cbuf; crackle.loop = true;
    const clp = ctx.createBiquadFilter(); clp.type = "lowpass"; clp.frequency.value = 2400;
    const cg = ctx.createGain(); cg.gain.value = 0.35;
    crackle.connect(clp).connect(cg).connect(master);
    crackle.start();
    stops.push(() => { try { crackle.stop(); } catch { /* ok */ } });

    // agendador por compasso, com lookahead sobre ctx.currentTime
    let nextBar = ctx.currentTime + 0.15, bar = 0;
    function schedule() {
      while (nextBar < ctx.currentTime + 2) {
        const t = nextBar;
        const chord = CHORDS[Math.floor(bar / 2) % CHORDS.length];
        if (bar % 2 === 0) pad(t, chord, 2 * BAR);
        kick(t); kick(t + 2.5 * spb + swing);
        snare(t + 1 * spb); snare(t + 3 * spb);
        for (const off of [0.5, 1.5, 2.5, 3.5]) hat(t + off * spb + swing);
        bass(t, chord[0], 1.1 * spb); bass(t + 2.5 * spb + swing, chord[0], 0.9 * spb);
        bar++; nextBar += BAR;
      }
    }
    const timer = setInterval(schedule, 500);
    schedule();
    stops.push(() => {
      clearInterval(timer);
      for (const o of live) { try { o.stop(); } catch { /* ok */ } }
    });
    return () => stops.forEach((f) => f());
  }

  const BUILDERS = { brown: buildBrown, wave40: buildWave40, lofi: buildLofi };

  function stop({ keepCtx = true } = {}) {
    if (!ctx || !cleanup) { mode = null; return; }
    const done = cleanup; cleanup = null; mode = null;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.35);
    setTimeout(() => { done(); if (!keepCtx && ctx) { ctx.close(); ctx = null; master = null; } }, 420);
  }

  function start(m) {
    if (!BUILDERS[m]) return;
    const hadPrev = !!cleanup;
    if (hadPrev) stop();
    ensureCtx();
    if (ctx.state === "suspended") ctx.resume();
    // se tinha som antes, espera o fade-out dele antes de subir o novo
    setTimeout(() => {
      if (mode !== m) return;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.linearRampToValueAtTime(prefs.volume, ctx.currentTime + 0.6);
    }, hadPrev ? 430 : 0);
    mode = m;
    prefs.mode = m; savePrefs();
    cleanup = BUILDERS[m]();
  }

  function setVolume(v) {
    prefs.volume = Math.max(0, Math.min(1, Number(v) || 0)); savePrefs();
    if (ctx && mode) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.linearRampToValueAtTime(prefs.volume, ctx.currentTime + 0.1);
    }
  }

  return {
    start, stop, setVolume,
    get mode() { return mode; },
    get volume() { return prefs.volume; },
    get lastMode() { return prefs.mode; },
  };
}
