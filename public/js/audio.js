// Fully synthesized audio (WebAudio). No sound files needed.
export class Sound {
  constructor() { this.ctx = null; this.vol = 0.8; this.music = 0.7; this.lx = 0; this.lz = 0; this.lyaw = 0; }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.vol; this.master.connect(c.destination);
    this.musicBus = c.createGain(); this.musicBus.gain.value = this.music; this.musicBus.connect(this.master);
    const comp = c.createDynamicsCompressor(); comp.connect(this.master); this.sfx = comp;
    // shared noise buffer
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    this.loops = {};
    this.nextBeat = 0;
  }
  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v; }
  setMusic(v) { this.music = v; if (this.musicBus) this.musicBus.gain.value = v; }
  get ok() { return !!this.ctx && this.ctx.state === 'running'; }

  listener(x, z, yaw) { this.lx = x; this.lz = z; this.lyaw = yaw; }

  // simple panning + distance attenuation (cheaper and more robust than PannerNode)
  spatial(x, z, ref = 4, maxD = 45) {
    const dx = x - this.lx, dz = z - this.lz, d = Math.hypot(dx, dz);
    if (d > maxD) return null;
    const g = ref / Math.max(ref, d) * Math.max(0, 1 - d / maxD);
    // listener right vector for yaw (forward = sin,cos ; right = -cos, sin)
    const rx = -Math.cos(this.lyaw), rz = Math.sin(this.lyaw);
    const pan = d > 0.5 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / d)) : 0;
    return { g, pan };
  }
  out(x, z, ref, maxD) {
    const c = this.ctx;
    const gain = c.createGain();
    if (x === undefined) { gain.connect(this.sfx); return gain; }
    const s = this.spatial(x, z, ref, maxD);
    if (!s) return null;
    const p = c.createStereoPanner(); p.pan.value = s.pan;
    const g2 = c.createGain(); g2.gain.value = s.g;
    gain.connect(g2); g2.connect(p); p.connect(this.sfx);
    return gain;
  }
  noise(dest, t0, dur, type, f0, f1, q = 1, vol = 1, attack = 0.005) {
    const c = this.ctx, src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(f0, t0); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t0 + dur); f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(dest); src.start(t0, Math.random()); src.stop(t0 + dur + 0.05);
  }
  tone(dest, t0, dur, type, f0, f1, vol = 1, attack = 0.005) {
    const c = this.ctx, o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t0); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + dur + 0.05);
    return o;
  }

  play(name, x, z, opt = {}) {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime;
    const o = (ref = 4, max = 45) => this.out(x, z, ref, max);
    let d;
    switch (name) {
      case 'click': d = o(); this.tone(d, t, 0.06, 'square', 900, 600, 0.05); break;
      case 'hover': d = o(); this.tone(d, t, 0.04, 'sine', 1400, null, 0.03); break;
      case 'swing': if (!(d = o(4, 30))) return; this.noise(d, t, 0.28, 'bandpass', 500, 2600, 2, 0.5, 0.05); break;
      case 'hit': {
        if (!(d = o(5, 60))) return;
        this.noise(d, t, 0.18, 'lowpass', 1800, 300, 1, 0.9);
        this.tone(d, t, 0.25, 'sine', 120, 40, 0.9);
        this.scream(d, t + 0.05, opt.pitch || 1, opt.down ? 1.1 : 0.7);
        break;
      }
      case 'scream': if (!(d = o(5, 60))) return; this.scream(d, t, opt.pitch || 1, opt.len || 1.4); break;
      case 'genfail': {
        if (!(d = o(6, 90))) return;
        this.noise(d, t, 0.9, 'lowpass', 2500, 120, 0.7, 1.4);
        this.tone(d, t, 0.6, 'sawtooth', 70, 30, 0.6);
        for (let i = 0; i < 6; i++) this.noise(d, t + 0.05 + Math.random() * 0.5, 0.05, 'highpass', 3000, null, 1, 0.4);
        break;
      }
      case 'gen': {
        if (!(d = o(10, 140))) return;
        for (const [f, v] of [[98, 0.5], [196, 0.3], [294, 0.18], [392, 0.1]]) this.tone(d, t, 3.2, 'sine', f, null, v, 0.01);
        this.noise(d, t, 0.15, 'highpass', 2000, null, 1, 0.3);
        this.tone(d, t + 0.1, 1.4, 'sawtooth', 50, 120, 0.12, 0.6);
        break;
      }
      case 'sc-warn': d = o(); this.tone(d, t, 0.12, 'sine', 1250, null, 0.25); this.tone(d, t + 0.13, 0.12, 'sine', 1250, null, 0.18); break;
      case 'sc-good': d = o(); this.tone(d, t, 0.12, 'triangle', 880, 990, 0.25); break;
      case 'sc-great': d = o(); this.tone(d, t, 0.25, 'sine', 1320, null, 0.25); this.tone(d, t + 0.06, 0.3, 'sine', 1760, null, 0.2); break;
      case 'drop': {
        if (!(d = o(5, 70))) return;
        this.noise(d, t, 0.45, 'lowpass', 900, 200, 1, 1.3);
        this.tone(d, t, 0.3, 'sine', 90, 45, 1);
        for (let i = 0; i < 5; i++) this.noise(d, t + 0.05 + i * 0.06 * Math.random(), 0.06, 'bandpass', 1500 + Math.random() * 1500, null, 4, 0.4);
        break;
      }
      case 'break': if (!(d = o(5, 60))) return; for (let i = 0; i < 7; i++) this.noise(d, t + i * 0.07, 0.12, 'bandpass', 600 + Math.random() * 1200, null, 3, 0.8); this.tone(d, t, 0.3, 'sine', 80, 40, 0.6); break;
      case 'vault': if (!(d = o(4, opt.fast ? 50 : 18))) return; this.noise(d, t, 0.3, 'bandpass', 300, 1200, 1.5, opt.fast ? 0.7 : 0.25, 0.04); this.tone(d, t + 0.25, 0.12, 'sine', 110, 60, opt.fast ? 0.5 : 0.2); break;
      case 'stun': if (!(d = o(5, 50))) return; this.tone(d, t, 0.25, 'sine', 70, 35, 1); this.tone(d, t + 0.05, 1.0, 'sawtooth', 140, 70, 0.25, 0.05); break;
      case 'kick': if (!(d = o(5, 50))) return; for (const f of [180, 271, 413]) this.tone(d, t, 0.6, 'square', f, f * 0.97, 0.12); this.noise(d, t, 0.2, 'highpass', 1500, null, 1, 0.4); break;
      case 'caged': {
        if (!(d = o(8, 120))) return;
        for (const f of [160, 240, 337]) this.tone(d, t, 1.2, 'square', f, f * 0.98, 0.08);
        this.noise(d, t, 1.5, 'highpass', 4000, 6000, 2, 0.15, 0.2);
        for (const f of [55, 58.3, 82.4]) this.tone(d, t + 0.1, 3, 'sawtooth', f, null, 0.12, 0.8);
        break;
      }
      case 'sacrifice': {
        d = o();
        for (const f of [41.2, 43.65, 61.7, 87.3]) this.tone(d, t, 4.5, 'sawtooth', f, f * 0.94, 0.12, 1.5);
        this.noise(d, t, 4, 'bandpass', 200, 2000, 3, 0.25, 2);
        break;
      }
      case 'powered': {
        d = o();
        for (const f of [110, 164.8, 220]) this.tone(d, t, 3.5, 'sawtooth', f * 0.8, f, 0.08, 1);
        this.tone(d, t, 3.5, 'sine', 55, null, 0.4, 0.5);
        break;
      }
      case 'gateopen': if (!(d = o(10, 140))) return; this.noise(d, t, 2.2, 'bandpass', 300, 120, 4, 0.8, 0.3); this.tone(d, t, 2.2, 'sawtooth', 60, 45, 0.15, 0.3); break;
      case 'escaped': d = o(); for (const [f, dt] of [[523, 0], [659, 0.12], [784, 0.24]]) this.tone(d, t + dt, 1.4, 'triangle', f, null, 0.15); break;
      case 'throw': if (!(d = o(4, 40))) return; this.noise(d, t, 0.35, 'bandpass', 800, 3000, 3, 0.6, 0.03); break;
      case 'thunk': if (!(d = o(4, 40))) return; this.noise(d, t, 0.12, 'lowpass', 1200, 200, 1, 0.8); this.tone(d, t, 0.15, 'sine', 200, 90, 0.5); break;
      case 'fade': if (!(d = o(6, 40))) return; this.tone(d, t, 1.2, 'sine', opt.on ? 900 : 300, opt.on ? 200 : 900, 0.15, 0.3); this.noise(d, t, 1.2, 'highpass', 5000, null, 1, 0.15, 0.4); break;
      case 'roar': if (!(d = o(8, 80))) return; this.tone(d, t, 1.3, 'sawtooth', 95, 60, 0.5, 0.05); this.tone(d, t, 1.3, 'square', 97, 61, 0.2, 0.05); this.noise(d, t, 1.2, 'bandpass', 400, 200, 2, 0.6, 0.05); break;
      case 'step': if (!(d = o(2, 18))) return; this.noise(d, t, 0.07, 'lowpass', opt.run ? 700 : 450, 150, 1, opt.vol || 0.25); break;
      case 'heal': d = o(); this.tone(d, t, 0.5, 'sine', 660, 880, 0.15); break;
      case 'pickup': if (!(d = o(5, 50))) return; this.tone(d, t, 0.4, 'sine', 90, 50, 0.6); this.scream(d, t + 0.1, opt.pitch || 1, 0.6); break;
      case 'end': d = o(); for (const f of [55, 65.4, 77.8]) this.tone(d, t, 4, 'sawtooth', f, f * 0.9, 0.1, 0.4); break;
      case 'lantern': if (!(d = o(4, 40))) return; this.noise(d, t, 0.6, 'bandpass', 1800, 600, 2, 0.4, 0.02); this.tone(d, t, 0.8, 'sine', 330, 220, 0.2, 0.05); break;
      case 'snuff': if (!(d = o(4, 40))) return; this.noise(d, t, 0.5, 'highpass', 3000, 900, 1, 0.35, 0.01); break;
      case 'whisper': {
        d = o();
        for (let i = 0; i < 3; i++) { const t0 = t + i * 0.35 + Math.random() * 0.2; this.noise(d, t0, 0.5, 'bandpass', 2600 + Math.random() * 1600, 1200, 9, 0.12 * (opt.vol || 1), 0.15); }
        this.tone(d, t, 1.6, 'sine', 880 + Math.random() * 200, 640, 0.03 * (opt.vol || 1), 0.4);
        break;
      }
      case 'thud': if (!(d = o(5, 40))) return; this.tone(d, t, 0.18, 'sine', 95, 40, 1, 0.003); this.noise(d, t, 0.09, 'lowpass', 900, 200, 1, 0.8); break;
      case 'grunt': if (!(d = o(3, 25))) return; this.scream(d, t, opt.pitch || 1, 0.35, 0.25); break;
    }
  }
  scream(dest, t, pitch, len, vol = 0.6) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sawtooth';
    const base = 420 * pitch;
    o.frequency.setValueAtTime(base * 1.4, t); o.frequency.linearRampToValueAtTime(base * 1.6, t + 0.15); o.frequency.exponentialRampToValueAtTime(base * 0.9, t + len);
    const vib = c.createOscillator(); vib.frequency.value = 7; const vg = c.createGain(); vg.gain.value = 18 * pitch; vib.connect(vg); vg.connect(o.frequency);
    const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 900 * pitch; f1.Q.value = 5;
    const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 2600 * pitch; f2.Q.value = 6;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(f1); o.connect(f2); f1.connect(g); f2.connect(g); g.connect(dest);
    o.start(t); vib.start(t); o.stop(t + len + 0.05); vib.stop(t + len + 0.05);
    this.noise(dest, t, len * 0.8, 'bandpass', 2400 * pitch, 1500 * pitch, 3, vol * 0.3, 0.03);
  }

  // ---------- continuous layers ----------
  loop(name, build) { if (!this.loops[name]) this.loops[name] = build(); return this.loops[name]; }
  ambience(on) {
    if (!this.ok) return;
    const c = this.ctx;
    const L = this.loop('amb', () => {
      const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380; f.Q.value = 0.7;
      const lfo = c.createOscillator(); lfo.frequency.value = 0.07; const lg = c.createGain(); lg.gain.value = 220; lfo.connect(lg); lg.connect(f.frequency);
      const g = c.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(this.musicBus); src.start(); lfo.start();
      const drone = []; const dg = c.createGain(); dg.gain.value = 0; dg.connect(this.musicBus);
      for (const fq of [43.65, 43.9, 65.4]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fq; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160; o.connect(lp); lp.connect(dg); o.start(); drone.push(o); }
      return { g, dg };
    });
    L.g.gain.setTargetAtTime(on ? 0.11 : 0, c.currentTime, 1.5);
    L.dg.gain.setTargetAtTime(on ? 0.045 : 0, c.currentTime, 2);
  }
  // terror radius: heartbeat + chase strings. intensity 0..1
  terror(intensity, chase) {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime;
    if (intensity > 0.02 && t >= this.nextBeat) {
      const iv = 1.2 - intensity * 0.78;
      const v = 0.25 + intensity * 0.75;
      const d = this.musicBus;
      this.tone(d, t, 0.18, 'sine', 62, 38, v, 0.01);
      this.noise(d, t, 0.06, 'lowpass', 180, null, 1, v * 0.4);
      this.tone(d, t + 0.2, 0.16, 'sine', 55, 34, v * 0.7, 0.01);
      this.nextBeat = t + iv;
    }
    const L = this.loop('chase', () => {
      const g = c.createGain(); g.gain.value = 0; g.connect(this.musicBus);
      const trem = c.createGain(); trem.gain.value = 0.5; trem.connect(g);
      const lfo = c.createOscillator(); lfo.frequency.value = 9; const lg = c.createGain(); lg.gain.value = 0.5; lfo.connect(lg); lg.connect(trem.gain); lfo.start();
      for (const f of [110, 116.5, 164.8, 233]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 3; bp.Q.value = 1.2; o.connect(bp); bp.connect(trem); o.start(); }
      return { g };
    });
    L.g.gain.setTargetAtTime(chase ? 0.09 * Math.min(1, chase) : 0, t, 0.6);
  }
  // nearest generator sounds
  gens(list) {
    if (!this.ok) return;
    const c = this.ctx;
    const L = this.loop('gens', () => {
      const mk = (type) => {
        const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
        const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = type === 'rep' ? 700 : 120; f.Q.value = type === 'rep' ? 3 : 1;
        const am = c.createGain(); am.gain.value = 0.5;
        const lfo = c.createOscillator(); lfo.frequency.value = type === 'rep' ? 13 : 30; const lg = c.createGain(); lg.gain.value = 0.5; lfo.connect(lg); lg.connect(am.gain); lfo.start();
        const pan = c.createStereoPanner(); const g = c.createGain(); g.gain.value = 0;
        src.connect(f); f.connect(am); am.connect(g); g.connect(pan); pan.connect(this.sfx); src.start();
        const hum = c.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 50; const hf = c.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 150; const hg = c.createGain(); hg.gain.value = type === 'rep' ? 0 : 0.4; hum.connect(hf); hf.connect(hg); hg.connect(g); hum.start();
        return { g, pan };
      };
      return { rep: mk('rep'), done: mk('done') };
    });
    // list: [{x,z,rep:bool,done:bool}]
    let best = { rep: null, done: null };
    for (const g of list) for (const k of ['rep', 'done']) if (g[k]) { const s = this.spatial(g.x, g.z, 3, k === 'rep' ? 30 : 22); if (s && (!best[k] || s.g > best[k].g)) best[k] = s; }
    for (const k of ['rep', 'done']) {
      const b = best[k];
      L[k].g.gain.setTargetAtTime(b ? b.g * (k === 'rep' ? 0.5 : 0.35) : 0, c.currentTime, 0.2);
      if (b) L[k].pan.pan.setTargetAtTime(b.pan, c.currentTime, 0.1);
    }
  }
  stopAll() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const k in this.loops) { const L = this.loops[k]; if (L.g) L.g.gain.setTargetAtTime(0, t, 0.3); if (L.dg) L.dg.gain.setTargetAtTime(0, t, 0.3); if (L.rep) { L.rep.g.gain.setTargetAtTime(0, t, 0.2); L.done.g.gain.setTargetAtTime(0, t, 0.2); } }
  }
}
export const sound = new Sound();
