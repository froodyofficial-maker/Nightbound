// Network snapshots: compact encoding (host) and smooth playback (clients).
//
// Host: every snapshot leaves out player fields that sit at their default value and the
// fields that never change during a match (name, perks, ...). Those, and the scoreboard,
// ride along in a keyframe once a second. A typical snapshot shrinks from ~4.6KB to ~1KB.
//
// Client: snapshots are stamped with the host's simulation clock. Other players are drawn a
// little in the past, interpolated between the two snapshots around that moment, so late or
// bunched-up packets no longer make anyone stutter or teleport.
import { SPEED } from './config.js';

const STATIC = ['name', 'role', 'char', 'skin', 'perks', 'diffMul'];
// default of every per-player field that changes during play; omitted while equal
const PDEF = {
  pitch: 0, mv: 0, cr: 0, tp: 0, st: 'ok', hp: 2, act: null, prog: 0, healP: 0, bleed: 0, cage: -1, stage: 0, cageT: 0,
  cageMax: 1, esc: 0, wig: 0, boost: 0, boostMul: SPEED.hitBoost, vault: null, carry: null, atk: 0, atkT: 0, atkHit: false,
  stun: 0, ab: 0, abT: 0, abCd: 0, aim: false, reveal: 0, sixT: 0, chase: 0, mark: 0, charges: 0, chargeT: 0, ammo: 0,
  ammoT: 0, ambush: 0, atkAmbush: false, tele: null, teleCd: 0, ab2Cd: 0, reel: null, pull: null, soundT: 0, outcome: '',
  bump: false, bot: false, flash: 0, flashOn: false, glare: 0, blind: 0, blindImm: 0,
};

const r3 = v => Math.round(v * 1000) / 1000;
function pack(v) {
  if (typeof v === 'number') return r3(v);
  if (Array.isArray(v)) return v.map(pack);
  if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = pack(v[k]); return o; }
  return v;
}

export function packSnap(S, keyframe) {
  const out = {};
  for (const k in S) if (k !== 'players') out[k] = pack(S[k]);
  out.players = S.players.map(p => {
    const o = {};
    for (const k in p) {
      const v = p[k];
      if (k === 'score' || STATIC.includes(k)) { if (keyframe) o[k] = pack(v); continue; }
      if (k in PDEF && v === PDEF[k]) continue;
      if (v === undefined || k === 'posT') continue;
      o[k] = pack(v);
    }
    return o;
  });
  if (keyframe) out.kf = 1;
  return out;
}

const angLerp = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };

export class SnapReader {
  constructor() {
    this.cache = new Map(); // id -> static fields + score
    this.buf = [];          // [{ t, pos: Map(id -> {x, z, yaw, tp}) }]
    this.offset = null;     // local clock minus host clock (seconds), tracking the fastest arrivals
    this.jitter = 0.03;
    this.ready = false;
    this.S = null;
  }
  // returns the decoded state, or null while waiting for the first keyframe
  read(s) {
    if (s.kf) {
      for (const p of s.players) {
        const c = this.cache.get(p.id) || {};
        for (const k of STATIC) if (k in p) c[k] = p[k];
        if (p.score) c.score = p.score;
        this.cache.set(p.id, c);
      }
      this.ready = true;
    }
    if (!this.ready) return null;
    for (const p of s.players) {
      const c = this.cache.get(p.id);
      if (!c) return null; // a player we have no keyframe for yet
      for (const k in PDEF) if (!(k in p)) p[k] = PDEF[k];
      for (const k in c) if (!(k in p)) p[k] = c[k];
    }
    delete s.kf;
    // clock sync
    const now = performance.now() / 1000, sample = now - s.t;
    if (this.offset == null || sample < this.offset) this.offset = sample;
    else this.offset += (sample - this.offset) * 0.02;
    this.jitter += (Math.min(0.5, sample - this.offset) - this.jitter) * 0.1;
    // keep raw positions: the live state gets overwritten with interpolated ones
    const pos = new Map();
    for (const p of s.players) pos.set(p.id, { x: p.x, z: p.z, yaw: p.yaw, tp: p.tp });
    if (this.buf.length && s.t <= this.buf[this.buf.length - 1].t) this.buf.length = 0; // host restarted its clock
    this.buf.push({ t: s.t, pos });
    if (this.buf.length > 40) this.buf.shift();
    this.S = s;
    return s;
  }
  // move every other player to where they were `delay` seconds ago on the host
  interpolate(S, myId) {
    if (!S || this.buf.length < 2 || this.offset == null) return;
    const delay = Math.max(0.07, Math.min(0.35, 0.06 + this.jitter * 2.2));
    const rt = performance.now() / 1000 - this.offset - delay;
    this.rt = rt; // host-clock moment this client is showing (sent with actions for lag compensation)
    const B = this.buf;
    let i = B.length - 2;
    while (i > 0 && B[i].t > rt) i--;
    const a = B[i], b = B[i + 1];
    let f = (rt - a.t) / Math.max(1e-3, b.t - a.t);
    // past the newest snapshot: extrapolate a little, then hold
    if (f > 1) f = 1 + Math.min(f - 1, 0.12 / Math.max(1e-3, b.t - a.t));
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
