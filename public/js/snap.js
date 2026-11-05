// Network snapshots: compact encoding (host) and smooth playback (clients).
//
// Host: every snapshot leaves out player fields that sit at their default value and the
// fields that never change during a match (name, perks, ...). Those, the player ids and the
// scoreboard ride along in a keyframe once a second. World state (generators, gates, cages...)
// is only sent while it is changing, plus a short tail so a lost packet can't hide a change.
// Snapshots travel over an unreliable channel, so each one is numbered and stale ones are dropped.
// A typical snapshot is ~0.6KB, which fits one network packet.
//
// Client: snapshots are stamped with the host's simulation clock. Other players are drawn a
// little in the past, interpolated between the two snapshots around that moment, so late or
// bunched-up packets no longer make anyone stutter or teleport.
import { SPEED } from './config.js';

const STATIC = ['name', 'role', 'char', 'skin', 'perks', 'diffMul', 'item', 'pet'];
// default of every per-player field that changes during play; omitted while equal
const PDEF = {
  pitch: 0, mv: 0, cr: 0, tp: 0, st: 'ok', hp: 2, act: null, prog: 0, healP: 0, bleed: 0, cage: -1, stage: 0, cageT: 0,
  cageMax: 1, esc: 0, wig: 0, boost: 0, boostMul: SPEED.hitBoost, vault: null, carry: null, atk: 0, atkT: 0, atkHit: false,
  stun: 0, ab: 0, abT: 0, abCd: 0, aim: false, reveal: 0, sixT: 0, chase: 0, mark: 0, charges: 0, chargeT: 0, ammo: 0,
  ammoT: 0, ambush: 0, atkAmbush: false, tele: null, teleCd: 0, ab2Cd: 0, reel: null, pull: null, soundT: 0, outcome: '',
  bump: false, bot: false, flash: 0, flashOn: false, glare: 0, blind: 0, blindImm: 0, traps: 0, slimed: 0, phase: 0,
  haste: 0, turn: 0, card: 0, leap: null, hopF: 0, hop: null, emote: 0, snare: 0, tasers: 0, zap: 0, spied: 0, fl: 0, sp: 0, heard: 0, webbed: 0, dash: null, swapCd: 0,
  shp: 100, webs: 0, webK: 0, possT: 0, knows: null, possCd: 0, disguise: false, harmless: false, pdowns: 0, pcages: 0, noCage: false, split: false, exposed: 0,
};

const r3 = v => Math.round(v * 1000) / 1000;
const r2 = v => Math.round(v * 100) / 100;
const num = v => Number.isInteger(v) ? v : Math.abs(v) < 2 ? r3(v) : r2(v);
function pack(v) {
  if (typeof v === 'number') return num(v);
  if (Array.isArray(v)) return v.map(pack);
  if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = pack(v[k]); return o; }
  return v;
}
const ALWAYS = new Set(['t', 'phase']);
const HOT = 8; // snapshots a changed world field keeps being sent for

export class SnapWriter {
  constructor() { this.world = new Map(); this.q = 0; this.stat = []; }
  pack(S, keyframe) {
    // q: sequence number; w: host wall clock (unlike the simulation clock it never slips after a
    // long frame), used by clients for playback timing and lag compensation
    const out = { q: ++this.q, w: r3(performance.now() / 1000) };
    for (const k in S) {
      if (k === 'players') continue;
      const v = pack(S[k]);
      if (ALWAYS.has(k)) { out[k] = v; continue; }
      const j = typeof v === 'object' && v !== null ? JSON.stringify(v) : v;
      let w = this.world.get(k);
      if (!w || w.j !== j) this.world.set(k, w = { j, hot: HOT });
      if (keyframe || w.hot > 0) out[k] = v;
      w.hot--;
    }
    out.players = S.players.map((p, i) => {
      const o = {};
      if (keyframe) o.id = p.id;
      // static fields (role, character...) can change mid-match (Infection): resend them for a while
      const sj = STATIC.map(k => JSON.stringify(p[k])).join('|');
      let st = this.stat[i];
      if (!st || st.j !== sj) this.stat[i] = st = { j: sj, hot: st ? HOT : 0 };
      const sendStatic = keyframe || st.hot > 0;
      if (st.hot > 0) st.hot--;
      for (const k in p) {
        const v = p[k];
        if (k === 'id') continue;
        if (k === 'score') { if (keyframe) o[k] = pack(v); continue; }
        if (STATIC.includes(k)) { if (sendStatic) o[k] = pack(v); continue; }
        if (k in PDEF && v === PDEF[k]) continue;
        if (v === undefined || k === 'posT') continue;
        o[k] = pack(v);
      }
      return o;
    });
    if (keyframe) out.kf = 1;
    return out;
  }
}
// kept for callers that pack a one-off full snapshot
export function packSnap(S, keyframe) { return new SnapWriter().pack(S, true); }

const angLerp = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };

// One-way clock tracking shared by both buffers below. `offset` (local clock minus sender clock)
// follows the fastest arrival of the last two seconds, so it settles again quickly when the
// sender's clock slips (a long frame on the host); `jitter` is how much later than that
// packets usually land.
class Clock {
  constructor() { this.offset = null; this.jitter = 0.02; this.gap = 1 / 30; this.lastT = null; this.win = []; }
  sample(t, now) {
    const s = now - t, W = this.win;
    while (W.length && (W[W.length - 1].s >= s || now - W[0].at > 2)) { if (W[W.length - 1].s >= s) W.pop(); else W.shift(); }
    W.push({ at: now, s });
    const min = W[0].s;
    this.offset = this.offset == null ? min : this.offset + (min - this.offset) * 0.15;
    const late = Math.min(0.5, Math.max(0, s - this.offset));
    // rise quicker on spikes than it settles, so the playback delay doesn't wobble
    this.jitter += (late - this.jitter) * (late > this.jitter ? 0.1 : 0.03);
    if (this.lastT != null && t > this.lastT) this.gap += (Math.min(0.25, t - this.lastT) - this.gap) * 0.1;
    this.lastT = t;
  }
  // how far in the past to draw: one send interval plus room for the usual jitter
  delay() { return Math.max(0.05, Math.min(0.3, this.gap * 1.2 + this.jitter * 1.5 + 0.01)); }
}

export class SnapReader {
  constructor() {
    this.cache = new Map(); // id -> static fields + score
    this.order = [];        // player ids in snapshot order (from the last keyframe)
    this.buf = [];          // [{ t, pos: Map(id -> {x, z, yaw, tp}) }]
    this.clock = new Clock();
    this.lastQ = 0;
    this.ready = false;
    this.S = null;
  }
  get offset() { return this.clock.offset; }
  // returns the decoded state, or null while waiting for the first keyframe / for stale packets
  read(s) {
    // snapshots may arrive out of order or twice: only ever move forward
    if (typeof s.q === 'number') { if (s.q <= this.lastQ) return null; }
    if (s.kf) {
      this.order = s.players.map(p => p.id);
      for (const p of s.players) {
        const c = this.cache.get(p.id) || {};
        for (const k of STATIC) if (k in p) c[k] = p[k];
        if (p.score) c.score = p.score;
        this.cache.set(p.id, c);
      }
      this.ready = true;
    }
    if (!this.ready) return null;
    if (s.players.length !== this.order.length && !s.kf) return null; // roster changed: wait for a keyframe
    for (let i = 0; i < s.players.length; i++) {
      const p = s.players[i];
      if (p.id == null) p.id = this.order[i];
      const c = this.cache.get(p.id);
      if (!c) return null; // a player we have no keyframe for yet
      if (!s.kf) for (const k of STATIC) if (k in p) c[k] = p[k]; // a mid-match change (Infection)
      for (const k in PDEF) if (!(k in p)) p[k] = PDEF[k];
      for (const k in c) if (!(k in p)) p[k] = c[k];
    }
    // world fields that didn't change were left out: carry them over
    if (this.S) for (const k in this.S) if (!(k in s)) s[k] = this.S[k];
    if (typeof s.q === 'number') this.lastQ = s.q;
    const t = typeof s.w === 'number' ? s.w : s.t;
    delete s.kf; delete s.q; delete s.w;
    this.clock.sample(t, performance.now() / 1000);
    // keep raw positions: the live state gets overwritten with interpolated ones
    const pos = new Map();
    for (const p of s.players) pos.set(p.id, { x: p.x, z: p.z, yaw: p.yaw, tp: p.tp });
    const last = this.buf[this.buf.length - 1];
    if (last && t < last.t) this.buf.length = 0; // host restarted its clock
    if (!last || t > last.t) { this.buf.push({ t, pos }); if (this.buf.length > 60) this.buf.shift(); }
    this.S = s;
    return s;
  }
  // move every other player to where they were a moment ago on the host
  interpolate(S, myId) {
    const C = this.clock;
    if (!S || this.buf.length < 2 || C.offset == null) return;
    const rt = performance.now() / 1000 - C.offset - C.delay();
    this.rt = rt; // host wall-clock moment this client is showing (sent with actions for lag compensation)
    const B = this.buf;
    let i = B.length - 2;
    while (i > 0 && B[i].t > rt) i--;
    const a = B[i], b = B[i + 1];
    const span = Math.max(1e-3, b.t - a.t);
    let f = (rt - a.t) / span;
    // past the newest snapshot: extrapolate a little, then hold
    if (f > 1) f = 1 + Math.min(f - 1, 0.1 / span);
    if (f < 0) f = 0;
    for (const p of S.players) {
      if (p.id === myId) continue;
      const pa = a.pos.get(p.id), pb = b.pos.get(p.id);
      if (!pa || !pb || pa.tp !== pb.tp || Math.hypot(pb.x - pa.x, pb.z - pa.z) > 5) continue;
      const g = f > 1 && (p.st !== 'ok' || p.act) ? 1 : f;
      p.x = pa.x + (pb.x - pa.x) * g; p.z = pa.z + (pb.z - pa.z) * g;
      p.yaw = angLerp(pa.yaw, pb.yaw, Math.min(1, g));
    }
  }
}

// Host side: a remote player's position updates arrive in uneven bursts. Drawing them straight
// away makes that player stutter on the host's screen (and in every snapshot), so the host keeps
// a short buffer stamped with the sender's clock and draws them slightly in the past instead.
export class Track {
  constructor() { this.buf = []; this.clock = new Clock(); this.lastCt = -Infinity; this.at = 0; }
  // false when the update is older than one already seen (unordered channel)
  fresh(ct) { return !(typeof ct === 'number' && ct <= this.lastCt); }
  push(ct, x, z, yaw, tp) {
    const now = performance.now() / 1000;
    this.at = now;
    if (typeof ct !== 'number' || !isFinite(ct)) { this.buf.length = 0; return; }
    this.lastCt = ct;
    this.clock.sample(ct, now);
    const last = this.buf[this.buf.length - 1];
    if (last && (last.tp !== tp || Math.hypot(x - last.x, z - last.z) > 5)) this.buf.length = 0;
    this.buf.push({ t: ct, x, z, yaw, tp });
    if (this.buf.length > 30) this.buf.shift();
  }
  delay() { return this.clock.delay(); }
  sample(tp) {
    const now = performance.now() / 1000, B = this.buf;
    if (B.length < 2 || now - this.at > 0.5 || B[B.length - 1].tp !== tp) return null;
    const rt = now - this.clock.offset - this.clock.delay();
    let i = B.length - 2;
    while (i > 0 && B[i].t > rt) i--;
    const a = B[i], b = B[i + 1], span = Math.max(1e-3, b.t - a.t);
    let f = (rt - a.t) / span;
    if (f > 1) f = 1 + Math.min(f - 1, 0.08 / span);
    if (f < 0) f = 0;
    return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, yaw: angLerp(a.yaw, b.yaw, Math.min(1, f)) };
  }
}
