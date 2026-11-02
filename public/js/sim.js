// Authoritative game simulation. Runs only on the host (or in single-player).
import { RULES, KILLERS, SPEED, DIFFICULTY, HALF } from './config.js';
import { barBox, losBlocked } from './map.js';
import {
  has, fwd, dist, killerOf, playerById, findInteraction, actionTime, terrorRadius, inExit, findSpace, vaultDuration, findExecute,
} from './rules.js';

export class Sim {
  constructor(M, roster, opts = {}) {
    this.M = M;
    this.opts = opts;
    this.diff = DIFFICULTY[opts.difficulty || 'normal'];
    const nSurv = roster.filter(r => r.role === 'survivor').length;
    this.S = {
      t: 0, phase: 'play', endT: 0,
      gensNeeded: Math.max(2, Math.min(5, nSurv + 1)), gensDone: 0, gatesPowered: false, collapse: -1,
      players: [],
      gens: M.gens.map(() => ({ p: 0, done: false, reg: false, n: 0 })),
      bars: M.bars.map(() => 0),
      cages: M.cages.map(() => null), cageBroken: M.cages.map(() => false),
      gates: M.gates.map(() => ({ p: 0, open: false })),
      spears: [], lanterns: [], lid: 0,
    };
    let si = 0;
    for (const r of roster) {
      const sp = r.role === 'killer' ? M.spawns.killer : M.spawns.survivors[si++ % 4];
      this.S.players.push({
        id: r.id, name: r.name, role: r.role, char: r.char, perks: (r.perks || []).slice(0, 3), bot: !!r.bot,
        x: sp.x, z: sp.z, yaw: r.role === 'killer' ? M.spawns.killerYaw : M.spawns.survivorYaw, pitch: 0, mv: 0, cr: 0, tp: 0,
        st: 'ok', hp: 2, act: null, prog: 0, healP: 0, bleed: 0, cage: -1, stage: 0, cageT: 0, cageMax: 1, esc: 0,
        wig: 0, boost: 0, boostMul: SPEED.hitBoost, vault: null,
        carry: null, atk: 0, atkT: 0, atkHit: false, stun: 0, ab: 0, abT: 0, abCd: 0, aim: false,
        reveal: 0, sixT: 0, chase: 0, mark: 0,
        charges: r.char === 'butcher' ? KILLERS.butcher.ability.charges : 0, chargeT: 0,
        ammo: r.char === 'harrower' ? KILLERS.harrower.ability.ammo : 0, ammoT: 0,
        ambush: 0, atkAmbush: false, tele: null, teleCd: 0,
        score: { a: 0, b: 0, c: 0, d: 0 }, outcome: '', diffMul: r.role === 'killer' && r.bot ? this.diff.killerSpeed : 1,
      });
    }
    this.inputs = new Map();
    for (const p of this.S.players) this.inputs.set(p.id, { e: false, latch: false });
    this.events = [];
    this.botSc = new Map();
  }

  ev(e) { this.events.push(e); }
  takeEvents() { const e = this.events; this.events = []; return e; }
  P(id) { return playerById(this.S, id); }

  // ---------------- messages from players (local, remote or bots) ----------------
  onMsg(id, m) {
    const S = this.S, M = this.M, p = this.P(id);
    if (!p || S.phase !== 'play') return;
    switch (m.t) {
      case 'pos': {
        if (m.tp !== p.tp) return;
        if (p.role === 'survivor' && p.st !== 'ok' && p.st !== 'down') return;
        if (p.act || p.stun > 0) { p.yaw = num(m.yaw, p.yaw); p.pitch = num(m.pitch, 0); return; }
        const nx = num(m.x, p.x), nz = num(m.z, p.z);
        if (Math.hypot(nx - p.x, nz - p.z) < 6) { p.x = nx; p.z = nz; }
        p.yaw = num(m.yaw, p.yaw); p.pitch = num(m.pitch, 0); p.mv = m.mv | 0; p.cr = m.cr ? 1 : 0;
        p.vault = m.v ? { remote: true } : null;
        break;
      }
      case 'in': {
        const inp = this.inputs.get(id);
        inp.e = !!m.e;
        if (!inp.e) inp.latch = false;
        if (p.role === 'killer' && p.char === 'harrower') p.aim = !!m.aim && p.abCd <= 0 && p.ammo > 0 && p.carry == null && !p.act && p.stun <= 0;
        break;
      }
      case 'act': this.onAct(p, m); break;
    }
  }

  onAct(p, m) {
    const S = this.S, M = this.M;
    switch (m.a) {
      case 'vault': {
        const kind = m.kind === 'bar' ? 'bar' : 'win';
        const o = kind === 'bar' ? M.bars[m.id] : M.windows[m.id];
        if (!o) return;
        const fast = !!m.fast && p.role === 'survivor';
        this.ev({ k: 'vault', id: p.id, x: o.x, z: o.z, fast });
        if (fast) { this.noise(o.x, o.z); const k = killerOf(S); if (k && dist(k, p) < 12) p.score.d += 50; }
        break;
      }
      case 'drop': {
        if (p.role !== 'survivor' || p.st !== 'ok' || p.act) return;
        const b = M.bars[m.id];
        if (!b || S.bars[b.id] !== 0 || dist(p, b) > 2.6) return;
        S.bars[b.id] = 1;
        this.ev({ k: 'drop', id: b.id, by: p.id });
        this.noise(b.x, b.z);
        // stun a killer standing in the barricade's path
        const k = killerOf(S);
        if (k && !k.vault) {
          const along = b.axis === 'x' ? k.z - b.z : k.x - b.x, cross = b.axis === 'x' ? k.x - b.x : k.z - b.z;
          if (Math.abs(along) < b.half + 0.4 && Math.abs(cross) < 1.3) {
            this.stunKiller(k, RULES.stunBarricade, true);
            p.score.d += 300;
            // shove the killer to the far side from the survivor
            const ps = Math.sign(b.axis === 'x' ? p.x - b.x : p.z - b.z) || 1;
            if (b.axis === 'x') k.x = b.x - ps * 0.85; else k.z = b.z - ps * 0.85;
            k.tp++;
          }
        }
        break;
      }
      case 'attack': {
        if (p.role !== 'killer' || p.atk || p.stun > 0 || p.carry != null || p.act || p.vault) return;
        if (p.char === 'wisp' && p.ab !== 0) return;
        if (p.char === 'butcher' && p.ab === 1) return;
        if (p.tele) return;
        p.atkAmbush = p.char === 'wisp' && p.ambush > 0;
        p.atk = 1; p.atkT = RULES.lungeTime * (has(p, 'stalker') ? 1.2 : 1) * (p.atkAmbush ? 1.4 : 1); p.atkHit = false;
        this.ev({ k: 'swing', id: p.id });
        break;
      }
      case 'ability': this.ability(p); break;
      case 'execute': {
        const it = findExecute(M, S, p);
        if (!it || (m.id && m.id !== it.id)) return;
        const s = this.P(it.id);
        for (const o of S.players) if (o.act && o.act.k === 'heal' && o.act.id === s.id) this.cancelAct(o);
        s.st = 'exec'; s.execBy = p.id; s.act = null; s.healP = 0;
        // the victim is dragged in front of the killer
        const ang = Math.atan2(s.x - p.x, s.z - p.z);
        p.yaw = ang;
        const spot = this.safeSpot(p.x + Math.sin(ang) * 1.05, p.z + Math.cos(ang) * 1.05, p.x, p.z);
        s.x = spot.x; s.z = spot.z; s.yaw = ang + Math.PI; s.tp++;
        p.act = { k: 'execute', id: s.id, t: 0 }; p.prog = 0;
        this.ev({ k: 'exec', id: s.id, by: p.id, char: p.char });
        this.ev({ k: 'msg', text: p.name + ' is executing ' + s.name + '!' });
        break;
      }
      case 'throw': {
        if (p.role !== 'killer' || p.char !== 'harrower' || p.abCd > 0 || p.ammo <= 0 || p.stun > 0 || p.carry != null || p.act) return;
        const yaw = num(m.yaw, p.yaw), pitch = Math.max(-0.6, Math.min(0.6, num(m.pitch, 0)));
        const sp = 32, f = fwd(yaw);
        S.spears.push({ x: p.x + f.x * 0.6, z: p.z + f.z * 0.6, y: 1.75, vx: f.x * sp * Math.cos(pitch), vz: f.z * sp * Math.cos(pitch), vy: sp * Math.sin(pitch), t: 0, by: p.id });
        p.abCd = KILLERS.harrower.ability.cooldown; p.aim = false; p.ammo--;
        this.ev({ k: 'throw', id: p.id, x: p.x, z: p.z });
        break;
      }
      case 'teleport': {
        if (p.role !== 'killer' || p.char !== 'lamplighter' || p.teleCd > 0 || p.tele || p.stun > 0 || p.act || p.carry != null || p.atk || p.vault) return;
        const yaw = num(m.yaw, p.yaw);
        let best = null, ba = 1e9;
        for (const L of S.lanterns) {
          const d = Math.hypot(L.x - p.x, L.z - p.z);
          if (d < 5) continue;
          let a = Math.abs(Math.atan2(Math.sin(Math.atan2(L.x - p.x, L.z - p.z) - yaw), Math.cos(Math.atan2(L.x - p.x, L.z - p.z) - yaw)));
          if (m.id != null && L.id === m.id) a = -1;
          if (a < ba) { ba = a; best = L; }
        }
        if (!best) return;
        p.tele = { t: 0, id: best.id };
        this.ev({ k: 'tele', id: p.id, x: p.x, z: p.z, to: best.id });
        break;
      }
      case 'bump': {
        if (p.char === 'butcher' && p.ab === 1) { this.endRampage(p); this.stunKiller(p, 2.0, false); }
        break;
      }
      case 'drop-carry': {
        if (p.role === 'killer' && p.carry != null && !p.act) this.releaseCarry(p, false);
        break;
      }
      case 'wig': {
        if (p.st !== 'carried') return;
        p.wig += RULES.wiggleRate * (has(p, 'resolve') ? 1.4 : 1);
        if (p.wig >= RULES.wiggleNeed) {
          const k = this.P(p.carriedBy);
          if (k) this.releaseCarry(k, true);
        }
        break;
      }
      case 'esc': {
        if (p.st !== 'caged' || p.stage !== 1 || p.esc >= 3) return;
        p.esc++;
        if (Math.random() < 0.07) { this.freeFromCage(p, null); this.ev({ k: 'msg', text: p.name + ' broke free of the cage!' }); }
        else this.ev({ k: 'escfail', id: p.id, left: 3 - p.esc });
        break;
      }
      case 'sc': this.skillResult(p, m.r); break;
      case 'vault-start': {
        // killer / survivor started a vault locally (bots call this directly)
        break;
      }
    }
  }

  noise(x, z) { this.ev({ k: 'noise', x, z }); }

  stunKiller(k, t, byBar) {
    if (k.act && k.act.k === 'execute') return;
    k.tele = null;
    k.stun = Math.max(k.stun, t); k.atk = 0; k.act = null; k.aim = false;
    if (k.carry != null) this.releaseCarry(k, true);
    if (k.char === 'butcher' && k.ab === 1) this.endRampage(k);
    this.ev({ k: 'stun', id: k.id, bar: byBar });
  }

  ability(p) {
    if (p.role !== 'killer' || p.stun > 0 || p.act || p.carry != null || p.vault) return;
    if (p.tele) return;
    if (p.char === 'butcher') {
      if (p.ab === 0 && p.abCd <= 0 && p.charges > 0 && !p.atk) { p.charges--; p.ab = 1; p.abT = 2.6; this.ev({ k: 'rampage', id: p.id }); }
    } else if (p.char === 'wisp') {
      if (p.ab === 0 && p.abCd <= 0 && !p.atk) { p.ab = 2; p.abT = 0.7; this.ev({ k: 'fade', id: p.id, on: true }); }
      else if (p.ab === 1) { p.ab = 3; p.abT = 1.0; this.ev({ k: 'fade', id: p.id, on: false }); }
    } else if (p.char === 'lamplighter') {
      if (p.abCd > 0 || p.atk) return;
      const mine = this.S.lanterns;
      if (mine.length >= KILLERS.lamplighter.ability.max) { const old = mine.shift(); this.ev({ k: 'snuff', id: old.id, x: old.x, z: old.z, by: null }); }
      const f = fwd(p.yaw), spot = this.safeSpot(p.x + f.x * 0.8, p.z + f.z * 0.8, p.x, p.z);
      const L = { id: ++this.S.lid, x: spot.x, z: spot.z };
      mine.push(L);
      p.abCd = KILLERS.lamplighter.ability.cooldown;
      this.ev({ k: 'lantern', id: L.id, x: L.x, z: L.z });
    }
  }
  endRampage(p) { p.ab = 0; p.abCd = 1.0; }

  releaseCarry(k, escaped) {
    const s = this.P(k.carry);
    k.carry = null;
    if (!s) return;
    s.carriedBy = null; s.wig = 0;
    const f = fwd(k.yaw);
    const spot = this.safeSpot(k.x - f.x * 0.9, k.z - f.z * 0.9, k.x, k.z);
    s.x = spot.x; s.z = spot.z; s.tp++;
    if (escaped) {
      s.st = 'ok'; s.hp = 1; s.boost = 1.5; s.boostMul = SPEED.hitBoost;
      k.stun = Math.max(k.stun, 2.6);
      s.score.d += 400;
      this.ev({ k: 'wiggle-free', id: s.id, x: s.x, z: s.z });
    } else { s.st = 'down'; s.healP = 0; }
  }

  safeSpot(x, z, fx, fz) {
    // pick a reachable point near (x,z), falling back to (fx,fz)
    const M = this.M;
    for (const [ox, oz] of [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6], [0.9, 0.9], [-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9]]) {
      const px = x + ox, pz = z + oz;
      let ok = !losBlocked(M, fx, fz, px, pz, 0.5);
      if (ok) for (const b of M.boxes) if (Math.abs(px - b.x) < b.hx + 0.38 && Math.abs(pz - b.z) < b.hz + 0.38) { ok = false; break; }
      if (ok) for (const c of M.circles) if (Math.hypot(px - c.x, pz - c.z) < c.r + 0.38) { ok = false; break; }
      if (ok) return { x: px, z: pz };
    }
    return { x: fx, z: fz };
  }

  skillResult(p, r) {
    const S = this.S;
    if (!p.act) return;
    if (p.act.k === 'repair') {
      const g = S.gens[p.act.id];
      if (r === 'great') { g.p = Math.min(1, g.p + (has(p, 'steady') ? 0.03 : 0.012)); p.score.a += 100; this.ev({ k: 'sc', id: p.id, r }); }
      else if (r === 'good') { p.score.a += 25; }
      else if (r === 'miss') {
        g.p = Math.max(0, g.p - 0.08);
        const gm = this.M.gens[p.act.id];
        this.ev({ k: 'genfail', id: p.act.id, by: p.id });
        this.noise(gm.x, gm.z);
        p.act = null; p.prog = 0;
        this.inputs.get(p.id).latch = true;
      }
    } else if (p.act.k === 'heal' || p.act.k === 'self') {
      const t = p.act.k === 'self' ? p : this.P(p.act.id);
      if (r === 'miss' && t) { t.healP = Math.max(0, t.healP - 0.1); this.noise(p.x, p.z); this.ev({ k: 'sc', id: p.id, r }); }
      if (r === 'great' && t) t.healP = Math.min(0.999, t.healP + 0.02);
    }
  }

  // ---------------- main update ----------------
  update(dt) {
    const S = this.S, M = this.M;
    if (S.phase !== 'play') return;
    S.t += dt;
    const K = killerOf(S);

    for (const p of S.players) {
      p.boost = Math.max(0, p.boost - dt);
      p.reveal = Math.max(0, p.reveal - dt);
      if (p.stun > 0) p.stun = Math.max(0, p.stun - dt);
      if (p.abCd > 0) p.abCd = Math.max(0, p.abCd - dt);
      if (p.teleCd > 0) p.teleCd = Math.max(0, p.teleCd - dt);
      if (p.ambush > 0) p.ambush = Math.max(0, p.ambush - dt);
      if (p.mark > 0) p.mark = Math.max(0, p.mark - dt);
      if (p.char === 'butcher' && p.role === 'killer' && p.charges < KILLERS.butcher.ability.charges) { p.chargeT += dt; if (p.chargeT >= KILLERS.butcher.ability.cooldown) { p.chargeT = 0; p.charges++; } }
      if (p.char === 'harrower' && p.role === 'killer' && p.ammo < KILLERS.harrower.ability.ammo) { p.ammoT += dt; if (p.ammoT >= KILLERS.harrower.ability.reload) { p.ammoT = 0; p.ammo++; } }
    }

    // ---- killer attack / abilities ----
    if (K) this.updateKiller(K, dt);

    // ---- interactions (hold E) ----
    for (const p of S.players) this.updateAction(p, dt);

    // ---- spears ----
    this.updateSpears(dt);

    // ---- survivor states ----
    for (const p of S.players) {
      if (p.role !== 'survivor') continue;
      if (p.st === 'carried') {
        const k = this.P(p.carriedBy);
        if (k) { const f = fwd(k.yaw); p.x = k.x + f.x * 0.25; p.z = k.z + f.z * 0.25; p.yaw = k.yaw; }
      } else if (p.st === 'caged') {
        const c = M.cages[p.cage];
        p.x = c.x; p.z = c.z;
        const rescuing = S.players.some(o => o.act && o.act.k === 'rescue' && o.act.id === p.cage);
        if (!rescuing) p.cageT -= dt * (K && has(K, 'rust') ? 1.2 : 1);
        if (p.cageT <= 0) this.kill(p, 'sacrificed');
      } else if (p.st === 'down') {
        const beingHelped = S.players.some(o => o.act && o.act.k === 'heal' && o.act.id === p.id);
        if (!beingHelped) p.bleed -= dt * (has(p, 'resolve') ? 0.66 : 1);
        if (p.bleed <= 0) this.kill(p, 'bled out');
      }
      if ((p.st === 'ok' || p.st === 'down') && inExit(M, p) >= 0 && S.gates[inExit(M, p)].open) {
        p.st = 'out'; p.outcome = 'escaped'; p.act = null; p.score.c += 2000;
        this.ev({ k: 'escaped', id: p.id });
      }
      if (p.st === 'ok' || p.st === 'down') p.score.c += dt * 2;
      // sixth sense timer
      if (has(p, 'sixth')) { p.sixT += dt; if (p.sixT > 29) p.sixT = 0; }
    }

    // ---- generators ----
    for (const g of S.gens) g.n = 0;
    for (const p of S.players) if (p.act && p.act.k === 'repair') S.gens[p.act.id].n++;
    const eff = [1, 1, 0.9, 0.8, 0.7];
    for (let i = 0; i < S.gens.length; i++) {
      const g = S.gens[i];
      if (g.done) continue;
      if (g.n > 0) {
        g.reg = false;
        let rate = 0;
        for (const p of S.players) if (p.act && p.act.k === 'repair' && p.act.id === i) {
          let r = 1 / RULES.genCharges;
          if (has(p, 'shared')) r *= 1 + 0.15 * (g.n - 1);
          if (K && has(K, 'dread') && dist(K, p) < terrorRadius(K)) r *= 0.9;
          rate += r;
          p.score.a += dt * 12;
        }
        g.p += rate * eff[Math.min(4, g.n)] * dt;
        if (g.p >= 1) this.completeGen(i);
      } else if (g.reg) {
        g.p -= dt * (0.25 / RULES.genCharges) * (K && has(K, 'overload') ? 1.5 : 1);
        if (g.p <= 0) { g.p = 0; g.reg = false; }
      }
    }

    // ---- endgame collapse ----
    if (S.collapse > 0) {
      S.collapse -= dt;
      if (S.collapse <= 0) {
        S.collapse = 0;
        for (const p of S.players) if (p.role === 'survivor' && ['ok', 'down', 'carried', 'caged'].includes(p.st)) this.kill(p, 'taken by the night');
      }
    }

    // ---- end condition ----
    const alive = S.players.filter(p => p.role === 'survivor' && ['ok', 'down', 'carried', 'caged', 'exec'].includes(p.st));
    if (alive.length === 0) this.endMatch();
  }

  updateKiller(K, dt) {
    const S = this.S, M = this.M;
    // lunge / recovery
    if (K.atk === 1) {
      K.atkT -= dt;
      const range = RULES.hitRange * (has(K, 'stalker') ? 1.2 : 1) * (K.atkAmbush ? 1.6 : 1);
      const f = fwd(K.yaw);
      for (const s of S.players) {
        if (s.role !== 'survivor' || s.st !== 'ok') continue;
        const dx = s.x - K.x, dz = s.z - K.z, d = Math.hypot(dx, dz);
        if (d > range) continue;
        const dot = d > 0.01 ? (dx * f.x + dz * f.z) / d : 1;
        if (dot < 0.62 && d > 0.9) continue;
        if (losBlocked(M, K.x, K.z, s.x, s.z, 1.0)) continue;
        this.damage(s, K, false);
        K.atk = 2; K.atkHit = true; K.atkT = RULES.hitCooldown * (has(K, 'relentless') ? 0.65 : 1);
        break;
      }
      if (K.atk === 1 && K.atkT <= 0) { K.atk = 2; K.atkHit = false; K.atkT = RULES.missCooldown; }
    } else if (K.atk === 2) {
      K.atkT -= dt;
      if (K.atkT <= 0) { K.atk = 0; K.atkHit = false; }
    }
    // abilities
    if (K.char === 'butcher' && K.ab === 1) {
      K.abT -= dt;
      const f = fwd(K.yaw);
      for (const s of S.players) {
        if (s.role !== 'survivor' || s.st !== 'ok') continue;
        const dx = s.x - K.x, dz = s.z - K.z, d = Math.hypot(dx, dz);
        if (d < 1.4 && (dx * f.x + dz * f.z) > -0.2) { this.damage(s, K, true); this.endRampage(K); K.atk = 2; K.atkHit = true; K.atkT = 2.2; break; }
      }
      if (K.ab === 1) for (const b of M.bars) if (S.bars[b.id] === 1 && Math.hypot(K.x + f.x * 0.8 - b.x, K.z + f.z * 0.8 - b.z) < b.half + 0.6) { S.bars[b.id] = 2; this.ev({ k: 'break', id: b.id }); }
      if (K.ab === 1 && K.abT <= 0) this.endRampage(K);
    } else if (K.char === 'wisp') {
      if (K.ab === 2) { K.abT -= dt; if (K.abT <= 0) { K.ab = 1; K.abT = 7; } }
      else if (K.ab === 1) { K.abT -= dt; if (K.abT <= 0) { K.ab = 3; K.abT = 1; this.ev({ k: 'fade', id: K.id, on: false }); } }
      else if (K.ab === 3) { K.abT -= dt; if (K.abT <= 0) { K.ab = 0; K.abCd = KILLERS.wisp.ability.cooldown; K.ambush = 2.5; } }
    } else if (K.char === 'lamplighter') {
      if (K.tele) {
        K.tele.t += dt;
        const L = S.lanterns.find(l => l.id === K.tele.id);
        if (!L) K.tele = null;
        else if (K.tele.t >= RULES.teleTime) {
          const spot = this.safeSpot(L.x + 0.9, L.z, L.x, L.z);
          K.x = spot.x; K.z = spot.z; K.tp++;
          K.tele = null; K.teleCd = RULES.teleCd;
          this.ev({ k: 'tele-end', id: K.id, x: K.x, z: K.z });
        }
      }
      // lanterns reveal survivors around them
      for (const s of S.players) if (s.role === 'survivor' && s.st === 'ok')
        for (const L of S.lanterns) if (Math.hypot(s.x - L.x, s.z - L.z) < RULES.lanternRadius) { s.reveal = Math.max(s.reveal, 0.3); break; }
    }
    // chase tracking for score
    let chasing = false;
    for (const s of S.players) if (s.role === 'survivor' && s.st === 'ok' && dist(s, K) < 12 && !losBlocked(M, K.x, K.z, s.x, s.z)) { chasing = true; s.score.d += dt * 6; }
    if (chasing) K.score.c += dt * 5;
  }

  damage(s, K, instantDown) {
    s.act = null; s.prog = 0;
    s.hp = instantDown ? 0 : s.hp - 1;
    K.score.a += 300;
    if (s.hp <= 0) {
      s.hp = 0; s.st = 'down'; s.bleed = RULES.bleedout; s.healP = 0; s.boost = 0;
      K.score.c += 500;
      this.ev({ k: 'hit', id: s.id, by: K.id, x: s.x, z: s.z, down: true });
      this.ev({ k: 'msg', text: s.name + ' is down!' });
    } else {
      s.boost = SPEED.hitBoostTime * (has(s, 'fleet') ? 1.5 : 1); s.boostMul = SPEED.hitBoost; s.healP = 0;
      this.ev({ k: 'hit', id: s.id, by: K.id, x: s.x, z: s.z, down: false });
    }
  }

  kill(p, how) {
    const S = this.S, K = killerOf(S);
    if (p.st === 'caged') { S.cageBroken[p.cage] = true; S.cages[p.cage] = null; }
    if (p.st === 'carried' && K) K.carry = null;
    p.st = 'dead'; p.outcome = how; p.act = null;
    if (K && how !== 'executed') { K.score.d += how === 'sacrificed' ? 1000 : 400; }
    this.ev({ k: 'died', id: p.id, how, x: p.x, z: p.z, cage: p.cage });
    this.ev({ k: 'msg', text: p.name + ' was ' + how + '.' });
    p.cage = -1;
  }

  freeFromCage(p, by) {
    const S = this.S, M = this.M, c = M.cages[p.cage];
    S.cages[p.cage] = null;
    p.st = 'ok'; p.hp = 1; p.cage = -1; p.healP = 0; p.esc = 0;
    const k = killerOf(S);
    // step out on the rescuer's side (or away from the killer)
    let ox = 1, oz = 0;
    if (by) { ox = by.x - c.x; oz = by.z - c.z; } else if (k) { ox = c.x - k.x; oz = c.z - k.z; }
    const d = Math.hypot(ox, oz) || 1;
    const spot = this.safeSpot(c.x + ox / d * 1.25, c.z + oz / d * 1.25, by ? by.x : c.x + 1.3, by ? by.z : c.z);
    p.x = spot.x; p.z = spot.z; p.tp++;
    if (has(p, 'lastwind')) { p.boost = 5; p.boostMul = 1.4; }
    this.ev({ k: 'rescued', id: p.id, by: by ? by.id : -1 });
  }

  completeGen(i) {
    const S = this.S, M = this.M;
    const g = S.gens[i];
    g.p = 1; g.done = true; g.reg = false;
    S.gensDone++;
    const K = killerOf(S);
    for (const p of S.players) if (p.act && p.act.k === 'repair' && p.act.id === i) {
      p.act = null; p.prog = 0; p.score.a += 300;
      if (K && has(K, 'sentry')) p.reveal = 6;
      this.inputs.get(p.id).latch = true;
    }
    this.ev({ k: 'gen', id: i, x: M.gens[i].x, z: M.gens[i].z, left: Math.max(0, S.gensNeeded - S.gensDone) });
    if (S.gensDone >= S.gensNeeded && !S.gatesPowered) {
      S.gatesPowered = true;
      S.collapse = RULES.collapse;
      // remaining generators are no longer needed
      S.gens.forEach(gg => { if (!gg.done) gg.reg = false; });
      for (const p of S.players) if (p.act && p.act.k === 'repair') { p.act = null; p.prog = 0; }
      this.ev({ k: 'powered' });
    }
  }

  updateAction(p, dt) {
    const S = this.S, M = this.M, inp = this.inputs.get(p.id);
    if (!inp) return;
    const wantE = inp.e && !inp.latch;
    if (p.act && p.act.k === 'execute') {
      const v = this.P(p.act.id);
      p.act.t += dt; p.prog = p.act.t / RULES.execTime;
      if (v) { v.x = p.x + Math.sin(p.yaw) * 1.05; v.z = p.z + Math.cos(p.yaw) * 1.05; }
      if (p.act.t >= RULES.execTime) {
        this.cancelAct(p);
        if (v && v.st === 'exec') { p.score.d += 1500; this.kill(v, 'executed'); }
      }
      return;
    }
    if (p.act) {
      // validate current action still applies
      const cur = findInteraction(M, S, p);
      const ok = wantE && cur && cur.k === p.act.k && cur.id === p.act.id && !p.vault;
      if (!ok) { this.cancelAct(p); return; }
      this.progressAct(p, dt);
      return;
    }
    if (!wantE || p.vault) return;
    const it = findInteraction(M, S, p);
    if (!it) return;
    p.act = { k: it.k, id: it.id, t: 0 };
    p.prog = 0;
    if (it.k === 'repair') { S.gens[it.id].reg = false; }
    if (it.k === 'kick' || it.k === 'break' || it.k === 'pickup' || it.k === 'cage') {
      // face the target
      const tgt = it.k === 'pickup' ? this.P(it.id) : it.k === 'cage' ? M.cages[it.id] : it.k === 'kick' ? M.gens[it.id] : M.bars[it.id];
      if (tgt) p.yaw = Math.atan2(tgt.x - p.x, tgt.z - p.z);
    }
    if (p.role === 'survivor' && (it.k === 'repair' || it.k === 'gate' || it.k === 'rescue')) {
      const tgt = it.k === 'repair' ? M.gens[it.id] : it.k === 'gate' ? { x: M.gates[it.id].sx, z: M.gates[it.id].sz } : M.cages[it.id];
      p.yaw = Math.atan2(tgt.x - p.x, tgt.z - p.z);
    }
    if (it.k === 'heal') { const t = this.P(it.id); if (t) p.yaw = Math.atan2(t.x - p.x, t.z - p.z); }
  }

  cancelAct(p) { p.act = null; p.prog = 0; }

  progressAct(p, dt) {
    const S = this.S, M = this.M, a = p.act;
    a.t += dt;
    const K = killerOf(S);
    switch (a.k) {
      case 'repair': p.prog = S.gens[a.id].p; break;
      case 'heal': case 'self': {
        const t = a.k === 'self' ? p : this.P(a.id);
        if (!t) { this.cancelAct(p); return; }
        let rate = 1 / RULES.healTime;
        if (has(p, 'medic')) rate *= a.k === 'self' ? 0.5 : 1.3;
        else if (a.k === 'self') rate *= 0.5;
        t.healP += rate * dt;
        p.prog = t.healP;
        p.score.b += dt * 15;
        if (t.healP >= 1) {
          t.healP = 0;
          if (t.st === 'down') {
            t.st = 'ok'; t.hp = 1; t.tp++;
            if (has(t, 'lastwind')) { t.boost = 5; t.boostMul = 1.4; }
          } else t.hp = 2;
          p.score.b += 400;
          this.ev({ k: 'healed', id: t.id, by: p.id });
          this.cancelAct(p);
          this.inputs.get(p.id).latch = true;
        }
        break;
      }
      case 'gate': {
        const g = S.gates[a.id];
        g.p += dt / actionTime('gate', p, S);
        p.prog = g.p;
        if (g.p >= 1) {
          g.p = 1; g.open = true; p.score.a += 500;
          this.ev({ k: 'gateopen', id: a.id });
          for (const o of S.players) if (o.act && o.act.k === 'gate' && o.act.id === a.id) this.cancelAct(o);
        }
        break;
      }
      default: {
        const T = actionTime(a.k, p, S);
        p.prog = Math.min(1, a.t / T);
        if (a.t >= T) this.finishAct(p);
      }
    }
  }

  finishAct(p) {
    const S = this.S, M = this.M, a = p.act;
    this.cancelAct(p);
    this.inputs.get(p.id).latch = true;
    switch (a.k) {
      case 'rescue': {
        const who = this.P(S.cages[a.id]);
        if (who) { this.freeFromCage(who, p); p.score.b += 1000; }
        break;
      }
      case 'pickup': {
        const s = this.P(a.id);
        if (!s || s.st !== 'down') return;
        s.st = 'carried'; s.carriedBy = p.id; s.wig = 0; s.act = null;
        for (const o of S.players) if (o.act && o.act.k === 'heal' && o.act.id === s.id) this.cancelAct(o);
        p.carry = s.id; p.score.d += 200;
        this.ev({ k: 'pickup', id: s.id, by: p.id });
        break;
      }
      case 'cage': {
        const s = this.P(p.carry);
        if (!s) { p.carry = null; return; }
        p.carry = null;
        s.carriedBy = null; s.wig = 0;
        s.stage++;
        s.cage = a.id; S.cages[a.id] = s.id;
        s.st = 'caged'; s.esc = 0; s.tp++;
        p.score.d += 500;
        if (s.stage >= 3) { this.ev({ k: 'caged', id: s.id, cage: a.id, stage: s.stage }); this.kill(s, 'sacrificed'); }
        else {
          s.cageMax = s.cageT = RULES.cageStage[s.stage - 1];
          this.ev({ k: 'caged', id: s.id, cage: a.id, stage: s.stage });
          this.ev({ k: 'msg', text: s.name + ' has been caged' + (s.stage === 2 ? ' for the second time!' : '.') });
        }
        break;
      }
      case 'kick': {
        const g = S.gens[a.id];
        g.reg = true;
        if (has(p, 'overload')) g.p = Math.max(0, g.p - 0.08);
        p.score.a += 100;
        this.ev({ k: 'kick', id: a.id });
        break;
      }
      case 'snuff': {
        const i = S.lanterns.findIndex(l => l.id === a.id);
        if (i >= 0) { const L = S.lanterns[i]; S.lanterns.splice(i, 1); p.score.d += 250; this.ev({ k: 'snuff', id: L.id, x: L.x, z: L.z, by: p.id }); }
        break;
      }
      case 'break': {
        S.bars[a.id] = 2; p.score.a += 100;
        this.ev({ k: 'break', id: a.id });
        break;
      }
    }
  }

  updateSpears(dt) {
    const S = this.S, M = this.M;
    for (let i = S.spears.length - 1; i >= 0; i--) {
      const sp = S.spears[i];
      let dead = false;
      const steps = 4, h = dt / steps;
      for (let k = 0; k < steps && !dead; k++) {
        sp.vy -= 7 * h;
        sp.x += sp.vx * h; sp.z += sp.vz * h; sp.y += sp.vy * h;
        sp.t += h;
        if (sp.y <= 0.05 || sp.t > 2.2) { dead = true; break; }
        for (const s of S.players) {
          if (s.role !== 'survivor' || s.st !== 'ok') continue;
          const top = s.cr ? 1.1 : 1.8;
          if (sp.y < top && Math.hypot(sp.x - s.x, sp.z - s.z) < 0.55) {
            const K = this.P(sp.by);
            this.damage(s, K, false);
            s.mark = 12; s.reveal = Math.max(s.reveal, 12);
            this.ev({ k: 'marked', id: s.id });
            if (K) K.score.b += 200;
            dead = true; break;
          }
        }
        if (dead) break;
        const bucket = M.hash.get(Math.floor((sp.x + HALF + 12) / 8) * 1000 + Math.floor((sp.z + HALF + 12) / 8)) || [];
        for (const o of bucket) {
          if (o.r !== undefined) { if (sp.y < o.h && Math.hypot(sp.x - o.x, sp.z - o.z) < o.r) { dead = true; break; } }
          else if (sp.y < o.h && Math.abs(sp.x - o.x) < o.hx && Math.abs(sp.z - o.z) < o.hz) { dead = true; break; }
        }
        for (const b of M.bars) if (S.bars[b.id] === 1) { const bb = barBox(b); if (sp.y < 1.05 && Math.abs(sp.x - bb.x) < bb.hx && Math.abs(sp.z - bb.z) < bb.hz) dead = true; }
      }
      if (dead) { this.ev({ k: 'spearend', x: sp.x, y: Math.max(0.1, sp.y), z: sp.z }); S.spears.splice(i, 1); }
    }
  }

  endMatch() {
    const S = this.S;
    if (S.phase === 'end') return;
    S.phase = 'end';
    const K = killerOf(S);
    for (const p of S.players) if (p.role === 'survivor' && !p.outcome) p.outcome = p.st === 'out' ? 'escaped' : 'sacrificed';
    const kills = S.players.filter(p => p.role === 'survivor' && p.outcome !== 'escaped').length;
    if (K) K.outcome = ['Brutal defeat', 'Entity displeased', 'Close call', 'Merciless victory', 'Merciless victory'][Math.min(4, Math.round(kills / Math.max(1, S.players.length - 1) * 4))];
    this.ev({ k: 'end' });
  }

  // used by bots and the local player to request a vault (validated & echoed as an event)
  canVault(p) { return findSpace(this.M, this.S, p); }
  vaultTime(p, kind, running) { return vaultDuration(p, kind, running); }
}

function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
