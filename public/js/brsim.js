// Fortnight (battle royale event): the host-side simulation and its bots.
// Same outward shape as Sim (S, onMsg, update, takeEvents, P, inputs), so sessions, snapshots and
// the renderer treat it like any other match. Everyone is a regular player underneath; `look`
// only decides whether they wear a killer's or a survivor's body. Nobody has any powers.
import { Sim } from './sim.js';
import { findPath, cellOf, cellPos, moveCircle, terrainH } from './map.js';
import { stepMover } from './movement.js';
import { angDiff, dist } from './rules.js';
import { WEAPONS, HEALS, AMMO, RARITY, SLOTS, MAX_HP, MAX_SH, FOG_PHASES, rollChest, rollSack, weaponDmg, fogAt, itemName } from './brdata.js';
import { DIFFICULTY } from './config.js';

const EYE = 1.45;
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const bodyH = p => (p.look === 'killer' ? 2.1 : 1.85);
const bodyR = p => (p.look === 'killer' ? 0.5 : 0.42);
export const alive = p => p.st === 'ok';

// ---------- rays against the map (bullets, line of sight, the crosshair) ----------
// nearest distance along (o + t d), |d| = 1, at which something solid is hit; Infinity if nothing
export function rayWall(M, ox, oy, oz, dx, dy, dz, maxT) {
  if (!M.hash) return Infinity;
  const hh = (M.half || 50) + 12, seen = new Set();
  let best = Infinity;
  if (M.terrain) {
    // hills and mountains: march along the ray
    for (let t = 0.4; t < maxT; t += t < 20 ? 0.6 : 1.2) { const x = ox + dx * t, z = oz + dz * t; if (oy + dy * t < terrainH(M, x, z)) { best = Math.max(0, t - 0.3); break; } }
  } else if (dy < -1e-6) best = Math.min(best, -oy / dy); // the ground
  const steps = Math.ceil(maxT / 4) + 1;
  for (let s = 0; s <= steps; s++) {
    const t = Math.min(maxT, s * 4); if (t > best + 4) break;
    const x = ox + dx * t, z = oz + dz * t, a = Math.floor((x + hh) / 8), b = Math.floor((z + hh) / 8);
    for (let ia = a - 1; ia <= a + 1; ia++) for (let ib = b - 1; ib <= b + 1; ib++) {
      const bucket = M.hash.get(ia * 1000 + ib); if (!bucket) continue;
      for (const o of bucket) {
        if (seen.has(o)) continue; seen.add(o);
        const h = o.h || 1;
        if (o.r !== undefined) {
          if (o.kind === 'cage') continue;
          const r = o.kind === 'tree' ? o.r * 0.9 : o.r;
          const fx = ox - o.x, fz = oz - o.z, A = dx * dx + dz * dz; if (A < 1e-9) continue;
          const B = 2 * (fx * dx + fz * dz), C = fx * fx + fz * fz - r * r, D = B * B - 4 * A * C; if (D < 0) continue;
          const t0 = (-B - Math.sqrt(D)) / (2 * A); if (t0 < 0 || t0 > maxT) continue;
          const y = oy + dy * t0; if (y >= 0 && y <= h && t0 < best) best = t0;
        } else {
          let t0 = 0, t1 = maxT;
          for (const [o0, d0, lo, hi] of [[ox, dx, o.x - o.hx, o.x + o.hx], [oy, dy, 0, h], [oz, dz, o.z - o.hz, o.z + o.hz]]) {
            if (Math.abs(d0) < 1e-9) { if (o0 < lo || o0 > hi) { t0 = Infinity; break; } continue; }
            let a0 = (lo - o0) / d0, a1 = (hi - o0) / d0; if (a0 > a1) [a0, a1] = [a1, a0];
            t0 = Math.max(t0, a0); t1 = Math.min(t1, a1); if (t0 > t1) { t0 = Infinity; break; }
          }
          if (t0 < best) best = t0;
        }
      }
    }
  }
  return best;
}
// a ray against a standing player (vertical cylinder): distance or Infinity, and whether it's the head
export function rayBody(px, pz, base, H, R, ox, oy, oz, dx, dy, dz, maxT) {
  oy -= base; // measured from the ground they stand on
  const fx = ox - px, fz = oz - pz, A = dx * dx + dz * dz;
  if (A < 1e-9) return { t: Infinity };
  const B = 2 * (fx * dx + fz * dz), C = fx * fx + fz * fz - R * R, D = B * B - 4 * A * C;
  if (D < 0) return { t: Infinity };
  const s = Math.sqrt(D), ta = (-B - s) / (2 * A), tb = (-B + s) / (2 * A);
  for (const t of [ta, tb]) {
    if (t < 0 || t > maxT) continue;
    const y = oy + dy * t;
    if (y >= 0 && y <= H) return { t, head: y > H - 0.32 };
  }
  // straight down through the top (shooting from above)
  if (Math.abs(dy) > 1e-6) { const t = (H - oy) / dy; if (t > 0 && t < maxT) { const x = ox + dx * t - px, z = oz + dz * t - pz; if (x * x + z * z < R * R) return { t, head: true }; } }
  return { t: Infinity };
}

export class BRSim {
  constructor(M, roster, opts = {}) {
    this.M = M; this.opts = opts; this.mode = 'fortnight';
    this.diff = DIFFICULTY[opts.difficulty || 'normal'];
    const S = this.S = {
      t: 0, phase: 'play', endT: 0, mode: 'fortnight', timer: 0, infStart: 0, lastStand: false,
      gensNeeded: 0, gensDone: 0, gatesPowered: false, collapse: -1,
      players: [], gens: [], bars: M.bars.map(() => 0), cages: [], cageBroken: [], gates: [],
      spears: [], lanterns: [], lid: 0, dark: 0, chains: [], traps: [], tid: 0, slime: [], saws: [], bears: [], slend: null, spider: null,
      chests: [], zaps: [], dolls: [], sopen: [],
      // Fortnight: opened chests, floor loot that's been taken, loot lying around, the fog
      copen: [], gone: [], loot: [], fog: null, left: 0,
    };
    this.lootId = 1;
    const sp = M.spawns.survivors.slice().sort(() => Math.random() - 0.5);
    roster.forEach((r, i) => {
      const at = sp[i % sp.length], extra = Math.floor(i / sp.length);
      const pos = extra ? { x: at.x + Math.cos(i) * 2 * extra, z: at.z + Math.sin(i) * 2 * extra } : at;
      const p = Sim.prototype.makePlayer.call(this, { ...r, role: 'survivor', item: 'flashlight', perks: [] }, pos, 'classic');
      Object.assign(p, {
        role: 'survivor', look: r.role === 'killer' ? 'killer' : 'survivor', br: 1, perks: [], flash: 0, item: 'none',
        yaw: Math.random() * 6.28, life: MAX_HP, ward: 0, inv: Array(SLOTS).fill(null), slot: 0, mg: 0, rel: 0, heal: null, kills: 0, place: 0, ads: false,
        ammo: { light: 0, medium: 0, shells: 0, heavy: 0 }, dmg: 0, hopF: 0,
      });
      S.players.push(p);
    });
    this.inputs = new Map(); for (const p of S.players) this.inputs.set(p.id, { e: false, latch: false });
    this.priv = new Map(); for (const p of S.players) this.priv.set(p.id, { fcd: 0, mcd: 0, heldFire: false, born: 0 });
    this.events = [];
    this.hist = [];
    S.left = S.players.length;
    // the fog starts wide open around the whole island
    const half = M.half;
    this.fogPhase = -1; this.ring = { x: 0, z: 0, r: half * 1.5 };
    this.nextFog();
  }
  ev(e) { this.events.push(e); }
  takeEvents() { const e = this.events; this.events = []; return e; }
  P(id) { return this.S.players.find(p => p.id === id) || null; }

  nextFog() {
    const S = this.S, M = this.M, k = ++this.fogPhase, F = FOG_PHASES[k];
    if (!F) { S.fog = { ...S.fog, ph: k, t0: S.t + 1e6, t1: S.t + 1e6 }; return; }
    const cur = this.ring, nr = M.half * F.r;
    // the next ring sits inside this one, on ground you can walk to
    let nx = cur.x, nz = cur.z;
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * 6.28, d = Math.random() * Math.max(0, cur.r - nr) * 0.9;
      const x = cur.x + Math.cos(a) * d, z = cur.z + Math.sin(a) * d;
      if (Math.abs(x) > M.half - Math.max(8, nr * 0.6) || Math.abs(z) > M.half - Math.max(8, nr * 0.6)) continue;
      const c = cellOf(M, x, z); if (M.brReach && !M.brReach[c]) continue;
      nx = x; nz = z; break;
    }
    S.fog = { ph: k, n: FOG_PHASES.length, x: +cur.x.toFixed(2), z: +cur.z.toFixed(2), r: +cur.r.toFixed(2), nx: +nx.toFixed(2), nz: +nz.toFixed(2), nr: +nr.toFixed(2), t0: +(S.t + F.wait).toFixed(2), t1: +(S.t + F.wait + F.shrink).toFixed(2), dps: F.dps };
    if (k > 0) this.ev({ k: 'brfog', ph: k });
  }

  // ---------------- messages ----------------
  onMsg(id, m) {
    const S = this.S, p = this.P(id);
    if (!p || S.phase !== 'play' || !m) return;
    if (m.t === 'pos') {
      if (m.tp !== p.tp || !alive(p)) return;
      const nx = num(m.x, p.x), nz = num(m.z, p.z), since = Math.min(2, S.t - (p.posT ?? S.t)) + 0.25;
      if (Math.hypot(nx - p.x, nz - p.z) <= 2 + since * 10) { p.x = nx; p.z = nz; } else p.tp++;
      p.posT = S.t; p.yaw = num(m.yaw, p.yaw); p.pitch = num(m.pitch, 0); p.mv = m.mv | 0; p.cr = m.cr ? 1 : 0;
      p.hopF = Math.max(0, Math.min(1, num(m.h, 0)));
      return;
    }
    if (m.t === 'in') { p.ads = !!m.aim && alive(p); this.priv.get(id).heldFire = !!m.fire; return; }
    if (m.t !== 'act') return;
    if (typeof m.aid === 'number') { const seen = (this.aids ||= new Map()); let q = seen.get(id); if (!q) seen.set(id, q = []); if (q.includes(m.aid)) return; q.push(m.aid); if (q.length > 60) q.shift(); }
    if (!alive(p)) return;
    switch (m.a) {
      case 'fire': this.fire(p, m); break;
      case 'reload': this.startReload(p); break;
      case 'slot': this.setSlot(p, m.i | 0); break;
      case 'pickup': this.pickup(p, m.u); break;
      case 'chest': this.openChest(p, m.id | 0); break;
      case 'sack': this.openSack(p, m.id | 0); break;
      case 'drop': this.dropSlot(p, m.i == null ? p.slot : m.i | 0); break;
      case 'emote': p.emote = Math.max(0, Math.min(4, m.n | 0)); break;
    }
  }

  cur(p) { return p.inv[p.slot]; }
  setSlot(p, i) {
    if (i < 0 || i >= SLOTS || i === p.slot) return;
    const it = this.cur(p); if (it && it.k === 'w') it.n = p.mg;
    p.slot = i; p.rel = 0; p.heal = null; p.inv = p.inv.slice();
    const nw = this.cur(p); p.mg = nw && nw.k === 'w' ? nw.n : 0;
    this.priv.get(p.id).fcd = Math.max(this.priv.get(p.id).fcd, 0.25); // a moment to bring it up
  }
  startReload(p) {
    const it = this.cur(p); if (!it || it.k !== 'w' || p.rel > 0) return;
    const W = WEAPONS[it.id]; if (p.mg >= W.mag || !(p.ammo[W.ammo] > 0)) return;
    p.rel = W.reload; p.heal = null;
    this.ev({ k: 'brrel', id: p.id });
  }
  // fire (or use the heal / swing the bare hands): m.ax/ay/az is the point under the crosshair
  fire(p, m) {
    const S = this.S, pv = this.priv.get(p.id), it = this.cur(p);
    if (it && it.k === 'h') { this.startHeal(p); return; }
    if (pv.fcd > 0 || p.rel > 0) return;
    p.heal = null;
    const yaw = p.yaw, rx = -Math.cos(yaw), rz = Math.sin(yaw);
    const ox = p.x + Math.sin(yaw) * 0.35 + rx * 0.22, oy = EYE + terrainH(this.M, p.x, p.z), oz = p.z + Math.cos(yaw) * 0.35 + rz * 0.22;
    let ax = num(m.ax, NaN), ay = num(m.ay, NaN), az = num(m.az, NaN);
    if (!isFinite(ax)) { const pt = num(m.pitch, p.pitch || 0); ax = p.x + Math.sin(yaw) * 50 * Math.cos(pt); ay = oy + Math.sin(pt) * 50; az = p.z + Math.cos(yaw) * 50 * Math.cos(pt); }
    // where everyone was when the shooter saw them (lag compensation, at most 0.3s back)
    const rt = typeof m.rt === 'number' && !p.bot ? Math.max(S.t - 0.3, Math.min(S.t, m.rt)) : S.t;
    const at = this.posAt(rt);
    if (!it) {
      // bare hands: a shove that hurts a little
      pv.fcd = 0.55; p.atk = 1; p.atkT = 0; this.ev({ k: 'brswing', id: p.id });
      let best = null, bd = 2.1;
      for (const o of S.players) {
        if (o === p || !alive(o)) continue;
        const q = at.get(o.id) || o, d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d < bd && Math.abs(angDiff(yaw, Math.atan2(q.x - p.x, q.z - p.z))) < 0.9) { bd = d; best = o; }
      }
      if (best) this.damage(best, p, 18, 'hands', false);
      return;
    }
    const W = WEAPONS[it.id];
    if (p.mg <= 0) { this.startReload(p); return; }
    pv.fcd = W.fire;
    p.mg--;
    let dx = ax - ox, dy = ay - oy, dz = az - oz; const L = Math.hypot(dx, dy, dz) || 1; dx /= L; dy /= L; dz /= L;
    const moving = p.mv >= 1 ? 1.35 : 1, sp = W.spread * (p.ads ? (W.pellets ? 0.75 : 0.35) : 1) * moving * (p.hopF > 0 ? 1.6 : 1);
    const maxT = W.range * 3, dmg = weaponDmg(it), shots = W.pellets || 1, hits = [];
    let endX = ox + dx * 40, endY = oy + dy * 40, endZ = oz + dz * 40;
    for (let s = 0; s < shots; s++) {
      // random cone around the aim
      const a = Math.random() * 6.28, r = sp * Math.sqrt(Math.random());
      let ux = -dz, uz = dx; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
      const vx = dy * uz, vy = dz * ux - dx * uz, vz = -dy * ux;
      let ex = dx + (ux * Math.cos(a) + vx * Math.sin(a)) * r, ey = dy + vy * Math.sin(a) * r, ez = dz + (uz * Math.cos(a) + vz * Math.sin(a)) * r;
      const el = Math.hypot(ex, ey, ez); ex /= el; ey /= el; ez /= el;
      const wall = rayWall(this.M, ox, oy, oz, ex, ey, ez, maxT);
      let best = null, bt = Math.min(wall, maxT);
      for (const o of S.players) {
        if (o === p || !alive(o)) continue;
        const q = at.get(o.id) || o, h = rayBody(q.x, q.z, terrainH(this.M, q.x, q.z), bodyH(o) * (o.cr ? 0.72 : 1), bodyR(o) + (p.bot ? 0 : 0.08), ox, oy, oz, ex, ey, ez, bt);
        if (h.t < bt) { bt = h.t; best = { o, head: h.head }; }
      }
      if (s === 0 || best) { endX = ox + ex * bt; endY = oy + ey * bt; endZ = oz + ez * bt; }
      if (best) {
        const d = bt, f = d <= W.range ? 1 : d <= W.range * 2 ? 1 - 0.5 * (d - W.range) / W.range : Math.max(0, 0.5 - 0.5 * (d - W.range * 2) / W.range);
        hits.push({ o: best.o, dmg: dmg * f * (best.head ? W.head : 1), head: best.head });
      }
    }
    // pellets on the same target add up into one hit
    const per = new Map(); for (const h of hits) { const c = per.get(h.o) || { dmg: 0, head: false }; c.dmg += h.dmg; c.head ||= h.head; per.set(h.o, c); }
    this.ev({ k: 'brshot', id: p.id, w: it.id, x: +endX.toFixed(2), y: +endY.toFixed(2), z: +endZ.toFixed(2), hit: per.size ? 1 : 0 });
    for (const [o, h] of per) this.damage(o, p, Math.round(h.dmg), it.id, h.head);
    if (p.mg <= 0 && p.ammo[W.ammo] > 0) this.startReload(p);
  }
  posAt(t) {
    const out = new Map();
    if (t >= this.S.t - 1e-3 || !this.hist.length) return out;
    let snap = this.hist[0];
    for (const h of this.hist) { if (h.t <= t) snap = h; else break; }
    for (const [id, x, z] of snap.p) out.set(id, { x, z });
    return out;
  }
  damage(o, by, amount, w, head, fog = false) {
    if (!alive(o) || amount <= 0) return;
    let left = amount;
    if (!fog && o.ward > 0) { const a = Math.min(o.ward, left); o.ward -= a; left -= a; }
    o.life = Math.max(0, o.life - left);
    o.heal = null;
    if (by) by.dmg = (by.dmg || 0) + amount;
    this.ev({ k: 'brdmg', id: o.id, by: by ? by.id : null, n: amount, head: head ? 1 : 0, ward: o.ward > 0 ? 1 : 0, fog: fog ? 1 : 0 });
    if (o.life <= 0) this.eliminate(o, by, w, head, fog);
  }
  eliminate(o, by, w, head, fog) {
    const S = this.S;
    o.place = S.players.filter(alive).length;
    o.st = 'dead'; o.outcome = 'out'; o.heal = null; o.rel = 0; o.mv = 0;
    if (by && by !== o) by.kills++;
    // everything they carried spills out
    const drops = [];
    o.inv.forEach((it, i) => { if (it) { if (it.k === 'w' && i === o.slot) it.n = o.mg; drops.push({ ...it }); } });
    for (const k in o.ammo) if (o.ammo[k] > 0) drops.push({ k: 'a', id: k, n: o.ammo[k] });
    drops.forEach((d, i) => { const a = i / Math.max(1, drops.length) * 6.28; this.drop(d, o.x + Math.cos(a) * 1.1, o.z + Math.sin(a) * 1.1); });
    o.inv = Array(SLOTS).fill(null); o.ammo = { light: 0, medium: 0, shells: 0, heavy: 0 }; o.mg = 0;
    this.ev({ k: 'brkill', id: o.id, by: by ? by.id : null, w: w || '', head: head ? 1 : 0, fog: fog ? 1 : 0, left: o.place - 1 });
  }
  drop(it, x, z) {
    const p = moveCircle(this.M, null, x, z, 0, 0, 0.3);
    this.S.loot.push({ u: this.lootId++, x: +p.x.toFixed(2), z: +p.z.toFixed(2), k: it.k, i: it.id, r: it.r || 0, n: it.n });
  }
  dropSlot(p, i) {
    const it = p.inv[i]; if (!it) return;
    if (i === p.slot && it.k === 'w') it.n = p.mg;
    p.inv = p.inv.slice(); p.inv[i] = null; if (i === p.slot) { p.mg = 0; p.rel = 0; p.heal = null; }
    this.drop(it, p.x + Math.sin(p.yaw) * 1.2, p.z + Math.cos(p.yaw) * 1.2);
  }
  lootById(u) {
    if (typeof u === 'string' && u[0] === 'f') { const i = +u.slice(1), L = this.M.br.loot[i]; return L && !this.S.gone.includes(i) ? { L: { x: L.x, z: L.z, k: L.k, i: L.id, r: L.r || 0, n: L.n }, floor: i } : null; }
    const L = this.S.loot.find(l => l.u === u); return L ? { L, floor: -1 } : null;
  }
  pickup(p, u) {
    const S = this.S, f = this.lootById(u); if (!f) return;
    const L = f.L; if (Math.hypot(L.x - p.x, L.z - p.z) > 2.6) return;
    const take = () => { if (f.floor >= 0) S.gone = [...S.gone, f.floor]; else S.loot = S.loot.filter(l => l !== L); };
    if (L.k === 'a') {
      const A = AMMO[L.i], room = A.max - p.ammo[L.i]; if (room <= 0) return;
      const n = Math.min(room, L.n); p.ammo = { ...p.ammo, [L.i]: p.ammo[L.i] + n };
      take(); if (n < L.n) this.drop({ k: 'a', id: L.i, n: L.n - n }, L.x, L.z);
      this.ev({ k: 'brpick', id: p.id, it: { k: 'a', id: L.i, n } }); return;
    }
    const item = { k: L.k, id: L.i, r: L.r, n: L.n };
    p.inv = p.inv.slice();
    if (L.k === 'h') {
      // heals stack with the same kind
      const i = p.inv.findIndex(x => x && x.k === 'h' && x.id === L.i && x.n < HEALS[L.i].stack);
      if (i >= 0) { const room = HEALS[L.i].stack - p.inv[i].n, n = Math.min(room, L.n); p.inv[i] = { ...p.inv[i], n: p.inv[i].n + n }; take(); if (n < L.n) this.drop({ k: 'h', id: L.i, n: L.n - n }, L.x, L.z); this.ev({ k: 'brpick', id: p.id, it: item }); return; }
    }
    let i = p.inv.findIndex(x => !x);
    if (i < 0) { i = p.slot; this.dropSlot(p, i); p.inv = p.inv.slice(); }
    p.inv[i] = item; take();
    if (i === p.slot) { p.mg = item.k === 'w' ? item.n : 0; p.rel = 0; }
    this.ev({ k: 'brpick', id: p.id, it: item });
  }
  openChest(p, id) {
    const S = this.S, C = this.M.br.chests[id]; if (!C || S.copen.includes(id) || Math.hypot(C.x - p.x, C.z - p.z) > 2.6) return;
    S.copen = [...S.copen, id];
    const items = rollChest(Math.random);
    items.forEach((it, i) => { const a = C.rot + Math.PI / 2 + (i - (items.length - 1) / 2) * 0.55; this.drop(it, C.x + Math.sin(a) * 1.15, C.z + Math.cos(a) * 1.15); });
    this.ev({ k: 'brchest', id, by: p.id });
  }
  openSack(p, id) {
    const S = this.S, C = (this.M.br.sacks || [])[id]; if (!C || S.sopen.includes(id) || Math.hypot(C.x - p.x, C.z - p.z) > 2.4) return;
    S.sopen = [...S.sopen, id];
    rollSack(Math.random).forEach((it, i) => { const a = C.rot + i * 1.4; this.drop(it, C.x + Math.sin(a) * 0.8, C.z + Math.cos(a) * 0.8); });
    this.ev({ k: 'brsack', id, by: p.id });
  }
  startHeal(p) {
    const it = this.cur(p); if (!it || it.k !== 'h' || p.heal) return;
    const H = HEALS[it.id];
    if (H.hp && p.life >= H.cap) { this.ev({ k: 'brnote', id: p.id, text: p.life >= MAX_HP ? 'Health is full' : `${H.name} only heal up to ${H.cap}` }); return; }
    if (H.sh && p.ward >= H.cap) { this.ev({ k: 'brnote', id: p.id, text: p.ward >= MAX_SH ? 'Ward is full' : `${H.name} only fills ward up to ${H.cap}` }); return; }
    p.heal = { id: it.id, t: 0, d: H.time }; p.rel = 0;
  }

  // ---------------- the clock ----------------
  update(dt) {
    const S = this.S;
    if (S.phase !== 'play') return;
    S.t += dt;
    // position history for lag-compensated shots
    this.hist.push({ t: S.t, p: S.players.filter(alive).map(p => [p.id, p.x, p.z]) });
    while (this.hist.length && this.hist[0].t < S.t - 0.35) this.hist.shift();
    const ring = fogAt(S.fog, S.t);
    if (S.t >= S.fog.t1) { this.ring = { x: S.fog.nx, z: S.fog.nz, r: S.fog.nr }; this.nextFog(); }
    this.fogTick = (this.fogTick || 0) + dt;
    const fogNow = this.fogTick >= 1; if (fogNow) this.fogTick -= 1;
    for (const p of S.players) {
      if (!alive(p)) continue;
      const pv = this.priv.get(p.id);
      pv.fcd = Math.max(0, pv.fcd - dt);
      if (p.atk) { p.atkT += dt; if (p.atkT > 0.45) { p.atk = 0; p.atkT = 0; } }
      // automatic weapons keep firing while the trigger is held (humans send 'fire' each shot themselves)
      if (p.rel > 0) {
        p.rel -= dt;
        if (p.rel <= 0) {
          p.rel = 0; const it = this.cur(p);
          if (it && it.k === 'w') { const W = WEAPONS[it.id], n = Math.min(W.mag - p.mg, p.ammo[W.ammo]); p.mg += n; p.ammo = { ...p.ammo, [W.ammo]: p.ammo[W.ammo] - n }; }
        }
      }
      if (p.heal) {
        p.heal.t += dt;
        if (p.heal.t >= p.heal.d) {
          const H = HEALS[p.heal.id], i = p.slot, it = p.inv[i];
          if (it && it.k === 'h' && it.id === p.heal.id) {
            if (H.hp) p.life = Math.max(p.life, Math.min(H.cap, p.life + H.hp));
            if (H.sh) p.ward = Math.max(p.ward, Math.min(H.cap, p.ward + H.sh));
            p.inv = p.inv.slice(); p.inv[i] = it.n > 1 ? { ...it, n: it.n - 1 } : null;
            this.ev({ k: 'brheal', id: p.id, h: p.heal.id });
          }
          p.heal = null;
        }
      }
      if (fogNow && ring && Math.hypot(p.x - ring.x, p.z - ring.z) > ring.r) this.damage(p, null, S.fog.dps, 'fog', false, true);
    }
    // the end: one left standing, or nobody real is left to play
    const live = S.players.filter(alive);
    S.left = live.length;
    if (live.length <= 1 || (S.players.some(p => !p.bot) && !live.some(p => !p.bot))) {
      S.phase = 'end'; S.endT = S.t;
      const order = live.sort((a, b) => (b.kills - a.kills) || (b.life + b.ward) - (a.life + a.ward));
      order.forEach((p, i) => { p.place = i + 1; p.outcome = i === 0 && live.length === 1 ? 'win' : 'out'; });
      if (live.length === 1) this.ev({ k: 'brwin', id: live[0].id });
      const n = S.players.length;
      for (const p of S.players) {
        // Embers: placement, eliminations and damage dealt
        const a = Math.round((n + 1 - (p.place || n)) / n * 600), b = p.kills * 150, c = Math.round(Math.min(600, (p.dmg || 0) * 0.6)), d = p.outcome === 'win' ? 1000 : 0;
        p.score = { a, b, c, d };
      }
    }
  }
}

// ---------------- bots ----------------
// Each bot loots, keeps ahead of the fog, heals when it's safe and fights whoever it can see.
const PREF = { shotgun: [0, 9], smg: [3, 20], revolver: [4, 32], rifle: [10, 60], hunting: [25, 160] };
export class BRBots {
  constructor(sim) {
    this.sim = sim; this.b = new Map();
    const D = sim.opts.difficulty || 'normal';
    this.skill = { easy: { acc: 0.2, react: 1.1, turn: 3.5, see: 22 }, normal: { acc: 0.3, react: 0.75, turn: 5, see: 28 }, hard: { acc: 0.45, react: 0.45, turn: 8, see: 36 } }[D] || { acc: 0.3, react: 0.75, turn: 5, see: 28 };
  }
  onEvents(evs) {
    for (const e of evs) if (e.k === 'brdmg' && e.by) {
      // shot at: turn on whoever did it
      const b = this.b.get(e.id); if (b) { b.threat = e.by; b.threatT = 4; }
    }
  }
  brain(p) {
    let b = this.b.get(p.id);
    if (!b) this.b.set(p.id, b = { think: Math.random() * 0.3, goal: null, path: null, pi: 0, repath: 0, target: null, seenT: 0, strafe: Math.random() < 0.5 ? 1 : -1, strafeT: 0, stuckT: 0, lx: p.x, lz: p.z, trig: 0, threat: null, threatT: 0, lootT: 0, wander: null, aimErr: { x: 0, y: 0, z: 0 } });
    return b;
  }
  update(dt) {
    const sim = this.sim, S = sim.S;
    if (S.phase !== 'play') return;
    for (const p of S.players) if (p.bot && alive(p)) { try { this.step(p, this.brain(p), dt); } catch (e) { console.warn('br bot', e); } }
  }
  canSee(p, o) {
    const dx = o.x - p.x, dz = o.z - p.z, d = Math.hypot(dx, dz); if (d < 0.5) return true;
    const M = this.sim.M, ey = EYE + terrainH(M, p.x, p.z), ty = bodyH(o) * 0.6 + terrainH(M, o.x, o.z), dy = ty - ey, L = Math.hypot(dx, dy, dz);
    return rayWall(M, p.x, ey, p.z, dx / L, dy / L, dz / L, L) >= L - 0.4;
  }
  bestWeapon(p, d) {
    let best = -1, bs = -1;
    p.inv.forEach((it, i) => {
      if (!it || it.k !== 'w') return;
      const W = WEAPONS[it.id], mag = i === p.slot ? p.mg : it.n;
      if (mag <= 0 && !(p.ammo[W.ammo] > 0)) return;
      const [lo, hi] = PREF[it.id]; let s = (d >= lo && d <= hi ? 10 : 3) + (it.r || 0) + (mag > 0 ? 2 : 0) - (i === p.slot ? 0 : 0.5);
      if (s > bs) { bs = s; best = i; }
    });
    return best;
  }
  step(p, b, dt) {
    const sim = this.sim, S = sim.S, M = sim.M, K = this.skill;
    b.think -= dt; b.threatT -= dt; b.strafeT -= dt;
    const ring = fogAt(S.fog, S.t), next = S.fog ? { x: S.fog.nx, z: S.fog.nz, r: S.fog.nr } : ring;
    // --- who to fight
    if (b.think <= 0) {
      b.think = 0.25 + Math.random() * 0.1;
      let best = null, bd = K.see;
      for (const o of S.players) {
        if (o === p || !alive(o)) continue;
        const d = dist(p, o); if (d > (o.id === b.threat ? K.see * 1.5 : bd)) continue;
        if (S.t < 40 && o.id !== b.threat && d > 9) continue; // landing: loot first
        if (o.id !== b.threat && d > 16 && !p.inv.some(x => x && x.k === 'w' && (x.id === 'rifle' || x.id === 'hunting'))) continue; // too far for what we carry
        if (!this.canSee(p, o)) continue;
        const sc = d - (o.id === b.threat ? 15 : 0); if (!best || sc < bd) { bd = sc; best = o; }
      }
      if (best && best.id !== b.target) { b.target = best.id; b.seenT = 0; b.aimErr = { x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5), z: (Math.random() - 0.5) * 2 }; }
      if (!best && b.target) { const t = sim.P(b.target); if (!t || !alive(t) || dist(p, t) > K.see * 1.3) b.target = null; else b.lost = (b.lost || 0) + 0.3; }
      if (best) b.lost = 0;
      if (b.lost > 3) { b.target = null; b.lost = 0; }
    }
    const T = b.target ? sim.P(b.target) : null;
    const hasGun = p.inv.some((it, i) => it && it.k === 'w' && ((i === p.slot ? p.mg : it.n) > 0 || p.ammo[WEAPONS[it.id].ammo] > 0));
    let mx = 0, mz = 0, sprint = true;
    if (T && alive(T)) {
      b.seenT += dt;
      const d = dist(p, T), wi = this.bestWeapon(p, d);
      if (wi >= 0 && wi !== p.slot && !p.heal) sim.onMsg(p.id, { t: 'act', a: 'slot', i: wi });
      if (wi < 0 && p.slot >= 0 && p.inv[p.slot]) { const e = p.inv.findIndex(x => !x); if (e >= 0) sim.onMsg(p.id, { t: 'act', a: 'slot', i: e }); }
      // face them
      const want = Math.atan2(T.x - p.x, T.z - p.z);
      p.yaw += Math.max(-K.turn * dt, Math.min(K.turn * dt, angDiff(p.yaw, want)));
      const it = p.inv[p.slot], W = it && it.k === 'w' ? WEAPONS[it.id] : null;
      const [lo, hi] = W ? PREF[it.id] : [0, 1.6];
      // keep a good range and strafe
      const toX = (T.x - p.x) / (d || 1), toZ = (T.z - p.z) / (d || 1);
      if (b.strafeT <= 0) { b.strafeT = 0.6 + Math.random() * 1.2; if (Math.random() < 0.45) b.strafe = -b.strafe; }
      const fwdK = d > hi ? 1 : d < lo ? -0.8 : 0;
      mx = toX * fwdK + -toZ * b.strafe * 0.8; mz = toZ * fwdK + toX * b.strafe * 0.8;
      if (!hasGun) { mx = toX; mz = toZ; } // fists: close in
      sprint = d > hi || !hasGun;
      // badly hurt and not cornered: back off to heal
      if (p.life + p.ward < 40 && d > 5 && p.inv.some(x => x && x.k === 'h')) { mx = -toX + -toZ * b.strafe * 0.5; mz = -toZ + toX * b.strafe * 0.5; sprint = true; if (d > 14) { b.target = null; b.threat = null; } }
      // pull the trigger once they're lined up and the reaction time has passed
      if (b.seenT > K.react && Math.abs(angDiff(p.yaw, want)) < 0.25 && !p.heal) {
        if (!W) { if (d < 2) sim.onMsg(p.id, { t: 'act', a: 'fire' }); }
        else if (p.mg <= 0) sim.onMsg(p.id, { t: 'act', a: 'reload' });
        else if (d < W.range * 2.6) {
          b.trig -= dt;
          if (b.trig <= 0) {
            // automatic guns fire in bursts
            b.burst = (b.burst || 0) + 1;
            b.trig = W.auto ? (b.burst % (4 + (p.id.length % 4)) === 0 ? 0.5 + Math.random() * 0.7 : W.fire) : W.fire + 0.25 + Math.random() * 0.45;
            // each shot hits or misses on purpose: better with time on target, worse with range
            const chance = K.acc * Math.max(0.15, 1 - d / (W.range * 2.2)) * Math.min(1.15, 0.55 + b.seenT * 0.25) * (T.mv === 2 ? 0.8 : 1);
            const hitIt = Math.random() < chance, miss = hitIt ? 0 : 0.9 + Math.random() * 1.4, ma = Math.random() * 6.28;
            const tx = T.x + Math.cos(ma) * miss, tz = T.z + Math.sin(ma) * miss;
            const ty = terrainH(M, T.x, T.z) + bodyH(T) * (hitIt && Math.random() < 0.15 ? 0.92 : 0.6) + (hitIt ? 0 : (Math.random() - 0.3) * 0.8);
            p.ads = d > 12;
            sim.onMsg(p.id, { t: 'act', a: 'fire', ax: tx, ay: ty, az: tz });
          }
        }
      }
    } else {
      p.ads = false;
      b.seenT = 0;
      // reload / heal while nobody's around
      const it = p.inv[p.slot];
      if (it && it.k === 'w' && p.mg < WEAPONS[it.id].mag && p.ammo[WEAPONS[it.id].ammo] > 0 && !p.rel) sim.onMsg(p.id, { t: 'act', a: 'reload' });
      const hurt = p.life < 70, warded = p.ward < 50;
      const healI = p.inv.findIndex(x => x && x.k === 'h' && ((HEALS[x.id].hp && hurt && p.life < HEALS[x.id].cap) || (HEALS[x.id].sh && warded && p.ward < HEALS[x.id].cap)));
      if (healI >= 0 && !p.heal && !(b.threatT > 0)) { if (p.slot !== healI) sim.onMsg(p.id, { t: 'act', a: 'slot', i: healI }); sim.onMsg(p.id, { t: 'act', a: 'fire' }); }
      if (p.heal) { this.move(p, b, 0, 0, dt, false); return; }
      // where to go: out of the fog first, then loot, then somewhere safe
      const outside = ring && Math.hypot(p.x - ring.x, p.z - ring.z) > ring.r - 4;
      const willBeOut = next && Math.hypot(p.x - next.x, p.z - next.z) > next.r * 0.85 && S.t > S.fog.t0 - 25;
      let goal = null;
      // once heading for safety, keep going until well inside (no dithering at the edge)
      if (outside || willBeOut) b.goSafe = true;
      if (b.goSafe && next && Math.hypot(p.x - next.x, p.z - next.z) < next.r * 0.6 && !outside) b.goSafe = false;
      if (b.goSafe) {
        if (!b.safe || Math.hypot(b.safe.x - next.x, b.safe.z - next.z) > next.r * 0.7) b.safe = this.spot(next.x, next.z, next.r * 0.5);
        goal = { ...b.safe, key: 'safe' };
      } else {
        b.lootT -= dt;
        if (!b.loot || b.lootT <= 0) { b.lootT = 1.5; b.loot = this.findLoot(p, hasGun); }
        if (b.loot) {
          const L = b.loot, d = Math.hypot(L.x - p.x, L.z - p.z);
          if (d < 1.8) {
            if (L.chest != null) sim.onMsg(p.id, { t: 'act', a: 'chest', id: L.chest });
            else if (L.sack != null) sim.onMsg(p.id, { t: 'act', a: 'sack', id: L.sack });
            else sim.onMsg(p.id, { t: 'act', a: 'pickup', u: L.u });
            (b.skip ||= new Set()).add(L.chest != null ? 'c' + L.chest : L.sack != null ? 's' + L.sack : 'u' + L.u); // tried once: don't come back for it
            b.loot = null; b.lootT = 0.2;
          } else goal = { x: L.x, z: L.z, key: 'loot' + (L.chest ?? L.u) };
        }
        if (!goal) {
          if (b.wander && Math.hypot(b.wander.x - p.x, b.wander.z - p.z) < 3 && !(b.hold > 0) && !b.held) { b.hold = 3 + Math.random() * 7; b.held = true; }
          if (b.hold > 0) { b.hold -= dt; p.yaw += Math.sin(S.t * 0.7 + p.x) * dt * 0.8; this.move(p, b, 0, 0, dt, false); return; }
          if (!b.wander || Math.hypot(b.wander.x - p.x, b.wander.z - p.z) < 3 || (ring && Math.hypot(b.wander.x - ring.x, b.wander.z - ring.z) > ring.r * 0.9)) {
            b.held = false;
            const c = S.t > S.fog.t0 - 25 ? next : ring || { x: 0, z: 0, r: M.half };
            b.wander = this.spot(c.x, c.z, Math.min(c.r, M.half) * 0.8);
          }
          goal = { ...b.wander, key: 'wander' };
        }
      }
      this.goTo(p, b, goal, dt);
      return;
    }
    this.move(p, b, mx, mz, dt, sprint);
  }
  // a random spot you can walk to within r of (x, z)
  spot(x, z, r) {
    const M = this.sim.M;
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * 6.28, d = Math.random() * r, px = Math.max(-M.half + 4, Math.min(M.half - 4, x + Math.cos(a) * d)), pz = Math.max(-M.half + 4, Math.min(M.half - 4, z + Math.sin(a) * d));
      const k = cellOf(M, px, pz); if (M.grid.type[k] === 0 && (!M.brReach || M.brReach[k])) return { x: px, z: pz };
    }
    return { x, z };
  }
  // the nearest thing worth picking up (a gun first if we have none)
  findLoot(p, hasGun) {
    const sim = this.sim, S = sim.S, M = sim.M;
    let best = null, bd = 1e9;
    const F = S.fog, late = F && S.t > F.t0 - 25;
    const consider = (x, z, score, o) => { if (late && Math.hypot(x - F.nx, z - F.nz) > F.nr * 0.85) return; const d = Math.hypot(x - p.x, z - p.z) - score; if (d < bd && Math.hypot(x - p.x, z - p.z) < 60) { bd = d; best = { x, z, ...o }; } };
    const b = this.b.get(p.id), skip = (b && b.skip) || new Set();
    M.br.chests.forEach((c, i) => { if (!S.copen.includes(i) && !skip.has('c' + i)) consider(c.x, c.z, hasGun ? 6 : 14, { chest: i }); });
    (M.br.sacks || []).forEach((c, i) => { if (!S.sopen.includes(i) && !skip.has('s' + i)) consider(c.x, c.z, hasGun ? 3 : 6, { sack: i }); });
    const wantAmmo = new Set(p.inv.filter(x => x && x.k === 'w').map(x => WEAPONS[x.id].ammo).filter(a => p.ammo[a] < AMMO[a].max * 0.8));
    const full = p.inv.every(Boolean);
    const val = L => L.k === 'w' ? (hasGun ? (full ? -100 : 3 + (L.r || 0) * 2) : 20) : L.k === 'h' ? (full && !p.inv.some(x => x && x.k === 'h' && x.id === L.i) ? -100 : 4) : (wantAmmo.has(L.i) ? 6 : -100);
    M.br.loot.forEach((L, i) => { if (!S.gone.includes(i) && !skip.has('uf' + i)) { const v = val({ k: L.k, i: L.id, r: L.r }); if (v > -50) consider(L.x, L.z, v, { u: 'f' + i }); } });
    for (const L of S.loot) { if (skip.has('u' + L.u)) continue; const v = val(L); if (v > -50) consider(L.x, L.z, v, { u: L.u }); }
    return best;
  }
  goTo(p, b, goal, dt) {
    const M = this.sim.M;
    // far goals: plan toward a point ~45m along the way
    let gx = goal.x, gz = goal.z; const d = Math.hypot(gx - p.x, gz - p.z);
    if (d > 45) { gx = p.x + (gx - p.x) / d * 45; gz = p.z + (gz - p.z) / d * 45; }
    b.repath -= dt;
    const key = goal.key + ':' + Math.round(gx / 6) + ',' + Math.round(gz / 6);
    if (!b.path || b.repath <= 0 || key !== b.pkey) {
      b.pkey = key; b.repath = 1.4 + Math.random() * 0.5;
      b.path = findPath(M, p.x, p.z, gx, gz, t => (t === 1 || t === 2 ? Infinity : 1), 12000); b.pi = 0;
      if (!b.path) { if (b.loot) (b.skip ||= new Set()).add(b.loot.chest != null ? 'c' + b.loot.chest : b.loot.sack != null ? 's' + b.loot.sack : 'u' + b.loot.u); b.wander = null; b.loot = null; b.safe = null; }
    }
    if (!b.path || b.pi >= b.path.length) { this.move(p, b, gx - p.x, gz - p.z, dt, true); return; }
    while (b.pi < b.path.length) { const c = cellPos(M, b.path[b.pi]); if (Math.hypot(c.x - p.x, c.z - p.z) < 0.6) b.pi++; else break; }
    if (b.pi >= b.path.length) { this.move(p, b, gx - p.x, gz - p.z, dt, true); return; }
    // head for the farthest of the next few path cells that can be reached in a straight line
    let ti = b.pi;
    for (let k = b.pi + 1; k < Math.min(b.path.length, b.pi + 8); k++) { const q = cellPos(M, b.path[k]); if (this.clear(p.x, p.z, q.x, q.z)) ti = k; else break; }
    const c = cellPos(M, b.path[ti]);
    const mx = c.x - p.x, mz = c.z - p.z;
    p.yaw += angDiff(p.yaw, Math.atan2(mx, mz)) * Math.min(1, dt * 8);
    this.move(p, b, mx, mz, dt, true);
  }
  clear(x0, z0, x1, z1) {
    const M = this.sim.M, g = M.grid, n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.25);
    for (let i = 1; i <= n; i++) { const t = g.type[cellOf(M, x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n)]; if (t === 1 || t === 2) return false; }
    return true;
  }
  move(p, b, mx, mz, dt, sprint) {
    const S = this.sim.S, M = this.sim.M, m = Math.hypot(mx, mz);
    if (m > 1e-3) { mx /= m; mz /= m; }
    if (b.side > 0) { b.side -= dt; mx = Math.sin(b.sideA); mz = Math.cos(b.sideA); }
    stepMover(M, S, p, { mx, mz, sprint, crouch: false }, dt);
    // stuck: step sideways for a moment, then plan again
    if (m > 0.1) {
      const moved = Math.hypot(p.x - b.lx, p.z - b.lz);
      b.stuckT = moved < 0.6 * dt ? b.stuckT + dt : Math.max(0, b.stuckT - dt);
      if (b.stuckT > 0.8) {
        b.stuckT = 0; b.side = 0.7; b.path = null; b.stuckN = (b.stuckN || 0) + 1;
        let bestA = Math.random() * 6.28, bestD = -1;
        for (let i = 0; i < 8; i++) { const a = i / 8 * 6.28, r = moveCircle(M, S, p.x, p.z, Math.sin(a) * 1.2, Math.cos(a) * 1.2, 0.36); const d2 = Math.hypot(r.x - p.x, r.z - p.z) + Math.random() * 0.2; if (d2 > bestD) { bestD = d2; bestA = a; } }
        b.sideA = bestA;
        if (b.stuckN > 3) { b.stuckN = 0; b.loot = null; b.wander = null; b.safe = null; } // give up on that goal
      }
    }
    b.lx = p.x; b.lz = p.z;
  }
}
export { itemName };
