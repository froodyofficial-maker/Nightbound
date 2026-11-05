// Authoritative game simulation. Runs only on the host (or in single-player).
import { RULES, KILLERS, SURVIVORS, POSSESS_MAX, POWER_LV, powerReach, SPEED, DIFFICULTY, HALF, MODES, INFECT_POOL, SURV_PERKS, PERK_SLOTS, ITEMS } from './config.js';
import { barBox, losBlocked, moveCircle, findPath, cellOf, cellPos, levelOf, levelsMeet, losL, heightAt, levelStep } from './map.js';
import {
  has, fwd, dist, killerOf, killersOf, nearestKiller, anyKillerHas, playerById, findInteraction, actionTime, terrorRadius, inExit, findSpace, vaultDuration, findExecute, angDiff,
} from './rules.js';

const POSSESSION = true;

export class Sim {
  constructor(M, roster, opts = {}) {
    this.M = M;
    this.opts = opts;
    this.diff = DIFFICULTY[opts.difficulty || 'normal'];
    const nSurv = roster.filter(r => r.role === 'survivor').length;
    const mode = MODES[opts.mode] ? opts.mode : 'classic';
    this.mode = mode;
    this.S = {
      t: 0, phase: 'play', endT: 0, mode, timer: MODES[mode].time || 0, infStart: nSurv, lastStand: false,
      gensNeeded: Math.max(2, Math.min(mode === 'duo' ? Math.min(6, M.gens.length - 1) : (M.half || HALF) > 60 ? Math.min(8, M.gens.length - 2) : 5, nSurv + 1)), gensDone: 0, gatesPowered: false, collapse: -1,
      players: [],
      gens: M.gens.map(() => ({ p: 0, done: false, reg: false, n: 0 })),
      bars: M.bars.map(() => 0),
      cages: M.cages.map(() => null), cageBroken: M.cages.map(() => false),
      gates: M.gates.map(() => ({ p: 0, open: false })),
      spears: [], lanterns: [], lid: 0, dark: 0, chains: [], traps: [], tid: 0, slime: [], saws: [], bears: [], slend: null, spider: null,
      chests: (M.chests || []).map(() => ({ open: false, it: null })), zaps: [],
    };
    let si = 0, ki = 0;
    for (const r of roster) {
      // extra killers / survivors (Two Killers) spawn beside the regular spawn points
      const nsp = M.spawns.survivors.length;
      let sp = r.role === 'killer' ? M.spawns.killer : M.spawns.survivors[si % nsp];
      const extra = r.role === 'killer' ? ki++ : Math.floor(si++ / nsp);
      if (extra > 0) { const a = extra * 2.1 + (r.role === 'killer' ? 0 : si), d = 1.6 + extra * 0.4; sp = this.safeSpot(sp.x + Math.cos(a) * d, sp.z + Math.sin(a) * d, sp.x, sp.z); }
      this.S.players.push(this.makePlayer(r, sp, mode));
    }
    this.inputs = new Map();
    for (const p of this.S.players) this.inputs.set(p.id, { e: false, latch: false });
    this.events = [];
    this.botSc = new Map();
    this.possession = null; // Chucky's Possession (host only, never sent to clients)
    // Chucky's Soul Split: spare Good Guy dolls lying around the map
    this.S.dolls = [];
    if (this.S.players.some(p => p.char === 'chucky')) {
      const spots = [...M.gens, ...M.cages].sort(() => Math.random() - 0.5);
      for (const g of spots) {
        if (this.S.dolls.length >= 4) break;
        const a = Math.random() * 6.28, sp = this.safeSpot(g.x + Math.cos(a) * 2.6, g.z + Math.sin(a) * 2.6, g.x, g.z);
        if (this.S.dolls.some(d => Math.hypot(d.x - sp.x, d.z - sp.z) < 18)) continue;
        // only where Chucky can actually walk out from (no dolls sealed in a corner)
        const walk = (t, r) => t === 1 || t === 4 ? Infinity : 1;
        if (!findPath(M, sp.x, sp.z, M.spawns.killer.x, M.spawns.killer.z, walk, 60000)) continue;
        this.S.dolls.push({ id: this.S.dolls.length, x: +sp.x.toFixed(2), z: +sp.z.toFixed(2), yaw: +(Math.random() * 6.28).toFixed(2) });
      }
    }
    this.possessionOn = POSSESSION;
  }

  makePlayer(r, sp, mode = this.mode) {
    const M = this.M;
    {
      return ({
        id: r.id, name: r.name, role: r.role, char: r.char, skin: typeof r.skin === 'string' ? r.skin.slice(0, 24) : 'default', perks: (r.perks || []).filter(k => !SURV_PERKS[k] || !SURV_PERKS[k].only || SURV_PERKS[k].only === r.char).slice(0, PERK_SLOTS), bot: !!r.bot,
        x: sp.x, z: sp.z, yaw: r.role === 'killer' ? M.spawns.killerYaw : M.spawns.survivorYaw, pitch: 0, mv: 0, cr: 0, tp: 0,
        st: 'ok', hp: 2, act: null, prog: 0, healP: 0, bleed: 0, cage: -1, stage: 0, cageT: 0, cageMax: 1, esc: 0,
        wig: 0, boost: 0, boostMul: SPEED.hitBoost, vault: null,
        carry: null, atk: 0, atkT: 0, atkHit: false, stun: 0, ab: 0, abT: 0, abCd: 0, aim: false,
        reveal: 0, sixT: 0, chase: 0, mark: 0,
        charges: r.char === 'butcher' ? KILLERS.butcher.ability.charges : 0, chargeT: 0,
        ammo: r.char === 'harrower' ? KILLERS.harrower.ability.ammo : r.char === 'bateman' ? 1 : 0, ammoT: 0,
        ambush: 0, atkAmbush: false, tele: null, teleCd: 0, ab2Cd: 0, reel: null, pull: null, soundT: 0,
        item: mode === 'bloodmoon' && r.role === 'survivor' ? 'taser' : r.item === 'trap' ? 'trap' : 'flashlight', flash: r.role === 'survivor' && r.item !== 'trap' && mode !== 'bloodmoon' ? RULES.flashBattery * (mode === 'dark' ? 0.5 : 1) : 0, traps: r.role === 'survivor' && r.item === 'trap' && mode !== 'bloodmoon' ? (r.char === 'raghuvir' || r.char === 'abeer' ? 3 : 2) + ((r.perks || []).includes('containment') ? 1 : 0) : 0, flashOn: false, glare: 0, blind: 0, blindImm: 0, tasers: mode === 'bloodmoon' && r.role === 'survivor' ? 2 : 0, zap: 0, spied: 0, fl: 0, sp: 0, reach: r.role === 'killer' && POWER_LV[r.char] ? (r.char === 'granny' && r.og ? 999 : powerReach(r.char, r.lv)) : 0, og: r.char === 'granny' && !!r.og, heard: 0, webbed: 0, webs: r.role === 'survivor' && r.char === 'spiderman' ? SURVIVORS.spiderman.web.shots : 0, webK: 0, dash: null, swapCd: 0,
        score: { a: 0, b: 0, c: 0, d: 0 }, outcome: '', diffMul: r.role === 'killer' && r.bot ? this.diff.killerSpeed : 1,
        possCd: 0, disguise: false, harmless: false, pdowns: 0, pcages: 0, noCage: false, split: false,
        pet: typeof r.pet === 'string' && ['ted', 'rosy'].includes(r.pet) ? r.pet : '',
      });
    }
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
        if (p.role === 'survivor' && p.st !== 'ok' && p.st !== 'down' && p.st !== 'ghost') return;
        if (p.act || p.stun > 0 || p.leap || p.dash || p.pull || p.snare > 0) { p.yaw = num(m.yaw, p.yaw); p.pitch = num(m.pitch, 0); return; }
        const nx = num(m.x, p.x), nz = num(m.z, p.z);
        // accept anything the player could have covered since their last update (lag spikes
        // included); otherwise pull them back to where the host has them instead of desyncing
        const since = Math.min(2, S.t - (p.posT ?? S.t)) + 0.25;
        if (Math.hypot(nx - p.x, nz - p.z) <= 2 + since * 9) {
          p.x = nx; p.z = nz;
          // floors (Granny's House): the player's own idea of which floor they are on, if it's one
          // they could have stepped to from the floor the host has them on
          if (M.stairs && typeof m.fl === 'number') { const nf = m.fl | 0; if (nf === (p.fl || 0) || levelsMeet(p, { fl: nf })) { p.fl = nf; if (typeof m.sp === 'number') p.sp = m.sp; } }
        }
        else p.tp++;
        p.posT = S.t;
        p.yaw = num(m.yaw, p.yaw); p.pitch = num(m.pitch, 0); p.mv = m.mv | 0; p.cr = m.cr ? 1 : 0;
        p.hopF = Math.max(0, Math.min(1, num(m.h, 0))); // remote Chucky mid-jump (drawn by everyone)
        p.vault = m.v ? { remote: true } : null;
        break;
      }
      case 'in': {
        const inp = this.inputs.get(id);
        inp.e = !!m.e;
        if (!inp.e) inp.latch = false;
        if ('flash' in m && p.role === 'survivor') p.flashOn = !!m.flash && p.flash > 0 && p.st === 'ok' && !p.act && !p.vault;
        if (p.role === 'killer' && p.char === 'foreman') p.aim = !!m.aim && p.abCd <= 0 && !p.pull && p.carry == null && !p.act && p.stun <= 0;
        if (p.role === 'killer' && p.char === 'harrower') p.aim = !!m.aim && p.abCd <= 0 && p.ammo > 0 && p.carry == null && !p.act && p.stun <= 0;
        if (p.role === 'killer' && p.char === 'bateman') { const was = p.aim; p.aim = !!m.aim && p.abCd <= 0 && p.ammo > 0 && p.carry == null && !p.act && p.stun <= 0 && !p.atk; if (p.aim && !was) p.abT = 0; }
        if (p.role === 'killer' && p.char === 'granny') { const was = p.aim; p.aim = !!m.aim && p.abCd <= 0 && !p.dash && p.carry == null && !p.act && p.stun <= 0 && !p.atk && !p.tele && p.ab !== 1; if (p.aim && !was) p.abT = 0; }
        if (p.role === 'killer' && p.char === 'chucky') { const was = p.aim; p.aim = !!m.aim && p.abCd <= 0 && !p.leap && p.carry == null && !p.act && p.stun <= 0 && !p.atk; if (p.aim && !was) p.abT = 0; }
        break;
      }
      case 'act': {
        // a key press may arrive more than once (resent over the public relay, which can drop
        // messages): act on each one once
        if (typeof m.aid === 'number') { const seen = (this.aids ||= new Map()); let q = seen.get(id); if (!q) seen.set(id, q = []); if (q.includes(m.aid)) return; q.push(m.aid); if (q.length > 40) q.shift(); }
        this.onAct(p, m); break;
      }
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
        if (fast) { this.noise(o.x, o.z); const k = nearestKiller(S, p); if (k && dist(k, p) < 12) p.score.d += 50; }
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
        for (const k of killersOf(S)) if (!k.vault) {
          const along = b.axis === 'x' ? k.z - b.z : k.x - b.x, cross = b.axis === 'x' ? k.x - b.x : k.z - b.z;
          if (Math.abs(along) < b.half + 0.4 && Math.abs(cross) < 1.3) {
            this.stunKiller(k, RULES.stunBarricade, true);
            p.score.d += 300;
            // shove the killer to the far side from the survivor
            const ps = Math.sign(b.axis === 'x' ? p.x - b.x : p.z - b.z) || 1;
            if (b.axis === 'x') k.x = b.x - ps * 0.85; else k.z = b.z - ps * 0.85;
            k.tp++;
            break;
          }
        }
        break;
      }
      case 'takeover': {
        // a fallen survivor steps into a bot's body and plays on
        if (p.role !== 'survivor' || p.st !== 'dead' || p.bot) return;
        const b = this.P(m.id);
        if (!b || !b.bot || b.role !== 'survivor' || !['ok', 'down', 'carried', 'caged'].includes(b.st)) return;
        const was = b.name.replace(/ \(bot\)$/, '');
        b.bot = false; b.name = p.name;
        for (const k in p.score) { b.score[k] = (b.score[k] || 0) + p.score[k]; p.score[k] = 0; }
        const inp = this.inputs.get(b.id); if (inp) { inp.e = false; inp.latch = false; }
        b.tp++;
        this.ev({ k: 'takeover', from: p.id, to: b.id, name: p.name, was });
        break;
      }
      case 'emote': {
        // survivors only: 1 dance, 2 wave, 3 cheer, 4 bow (0 stops). Moving or doing anything ends it.
        const n = Math.max(0, Math.min(4, m.n | 0));
        if (n && (p.role !== 'survivor' || p.st !== 'ok' || p.act || p.vault || p.disguise)) return;
        p.emote = n;
        (this.emoteAt ||= new Map()).set(p.id, { x: p.x, z: p.z, t: S.t });
        if (n) this.ev({ k: 'emote', id: p.id, n });
        break;
      }
      case 'web': {
        // Spider-Man's Web Shooters: a strand along the aim; the first killer it reaches is webbed
        // (slowed hard), and one carrying a survivor drops them
        const W = SURVIVORS.spiderman.web;
        if (p.role !== 'survivor' || p.char !== 'spiderman' || p.st !== 'ok' || p.act || p.vault || !(p.webs > 0) || ((this.webCd ||= new Map()).get(p.id) || 0) > S.t) return;
        p.webs--; this.webCd.set(p.id, S.t + W.cd);
        const yaw = num(m.yaw, p.yaw), f = fwd(yaw);
        let hit = null, hd = W.range;
        for (const K of S.players) {
          if (K.role !== 'killer' || K.st === 'dead' || K.disguise || !levelsMeet(p, K)) continue;
          const dx = K.x - p.x, dz = K.z - p.z, along = dx * f.x + dz * f.z, side = Math.abs(dx * f.z - dz * f.x);
          if (along < 0.2 || along > hd || side > 0.8 || losL(M, p, K, 1.2)) continue;
          hit = K; hd = along;
        }
        let reach = hit ? hd : W.range;
        if (!hit) for (let d = 0.5; d < W.range; d += 0.25) if (losL(M, p, { x: p.x + f.x * d, z: p.z + f.z * d, fl: p.fl }, 1.2)) { reach = d; break; }
        this.ev({ k: 'web', id: p.id, x: p.x, z: p.z, tx: +(hit ? hit.x : p.x + f.x * reach).toFixed(2), tz: +(hit ? hit.z : p.z + f.z * reach).toFixed(2), hit: hit ? hit.id : null, left: p.webs });
        if (hit) {
          const carried = hit.carry;
          if (carried != null) { this.releaseCarry(hit, true); hit.webK = Math.max(hit.webK || 0, W.carryTime); p.score.d += 900; }
          else { hit.webK = Math.max(hit.webK || 0, W.time); p.score.d += 400; }
          this.ev({ k: 'webhit', id: hit.id, by: p.id, freed: carried, x: hit.x, z: hit.z });
        }
        break;
      }
      case 'taser': {
        // Taser: a short-range shot along the aim; the first killer it reaches is electrocuted
        if (p.role !== 'survivor' || p.st !== 'ok' || p.act || p.vault || p.item !== 'taser' || !(p.tasers > 0) || ((this.taserCd ||= new Map()).get(p.id) || 0) > S.t) return;
        p.tasers--; this.taserCd.set(p.id, S.t + 0.8);
        const yaw = num(m.yaw, p.yaw), f = fwd(yaw), T = ITEMS.taser;
        let hit = null, hd = T.range;
        for (const K of S.players) {
          if (K.role !== 'killer' || K.st === 'dead' || K.disguise) continue;
          const dx = K.x - p.x, dz = K.z - p.z, along = dx * f.x + dz * f.z, side = Math.abs(dx * f.z - dz * f.x);
          if (along < 0.2 || along > hd || side > 0.75 || losBlocked(M, p.x, p.z, K.x, K.z, 1.2)) continue;
          hit = K; hd = along;
        }
        // the darts stop at the first wall
        let reach = hit ? hd : T.range;
        if (!hit) for (let d = 0.5; d < T.range; d += 0.25) if (losBlocked(M, p.x, p.z, p.x + f.x * d, p.z + f.z * d, 1.2)) { reach = d; break; }
        const ex = p.x + f.x * reach, ez = p.z + f.z * reach;
        this.ev({ k: 'taser', id: p.id, x: p.x, z: p.z, tx: hit ? hit.x : ex, tz: hit ? hit.z : ez, hit: hit ? hit.id : null });
        if (hit) {
          this.stunKiller(hit, T.stun, false); hit.zap = T.stun;
          p.score.d += 600;
          this.ev({ k: 'tazed', id: hit.id, by: p.id });
        }
        if (p.tasers <= 0) this.ev({ k: 'taserdead', id: p.id });
        break;
      }
      case 'trap': {
        // Ghost Trap: set it down; the killer stepping on it is stunned
        if (p.role !== 'survivor' || p.st !== 'ok' || p.act || p.vault || !(p.traps > 0)) return;
        if (this.S.traps.some(t => Math.hypot(t.x - p.x, t.z - p.z) < 2)) return;
        p.traps--; const f = fwd(p.yaw);
        const t = { id: ++this.S.tid, x: p.x + f.x * 0.9, z: p.z + f.z * 0.9, by: p.id };
        this.S.traps.push(t); this.ev({ k: 'trapset', id: p.id, x: t.x, z: t.z });
        break;
      }
      case 'attack': {
        if (p.role !== 'killer' || p.atk || p.stun > 0 || p.carry != null || p.act || p.vault || p.leap) return;
        if (p.char === 'wisp' && p.ab !== 0) return;
        if (p.char === 'butcher' && p.ab === 1) return;
        if (p.tele) return;
        p.atkAmbush = p.char === 'wisp' && p.ambush > 0;
        p.atk = 1; p.atkT = RULES.lungeTime * (has(p, 'stalker') ? 1.2 : 1) * (p.atkAmbush ? 1.4 : 1); p.atkHit = false;
        // lag compensation: an online killer swung at survivors as they appeared on their screen
        (this.rw ||= new Map()).set(p.id, typeof m.rt === 'number' && isFinite(m.rt) ? Math.max(0, Math.min(0.8, this.S.t - m.rt)) : 0);
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
        const spot = this.safeSpot(p.x + Math.sin(ang) * 1.05, p.z + Math.cos(ang) * 1.05, p.x, p.z, p.fl || 0);
        s.x = spot.x; s.z = spot.z; s.fl = p.fl || 0; s.sp = p.sp; s.yaw = ang + Math.PI; s.tp++;
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
      case 'sawthrow': {
        // Patrick Bateman hurls his chainsaw: it flies flat and fast, then lies where it lands
        if (p.role !== 'killer' || p.char !== 'bateman' || !p.aim || p.ammo <= 0 || p.stun > 0 || p.carry != null || p.act) return;
        if (p.abT < KILLERS.bateman.ability.aim) return; // he has to wind up
        const yaw = num(m.yaw, p.yaw), pitch = Math.max(-0.4, Math.min(0.4, num(m.pitch, 0))), sp = 26, f = fwd(yaw);
        S.saws.push({ id: ++S.lid, st: 'fly', x: p.x + f.x * 0.7, z: p.z + f.z * 0.7, y: 1.3, vx: f.x * sp * Math.cos(pitch), vz: f.z * sp * Math.cos(pitch), vy: 2.2 + sp * Math.sin(pitch), t: 0, by: p.id });
        p.ammo = 0; p.ammoT = 0; p.aim = false; p.abT = 0;
        this.ev({ k: 'sawthrow', id: p.id, x: p.x, z: p.z });
        break;
      }
      case 'possess': {
        // Chucky's Possession: take over a downed survivor (or let them go once the job is done)
        if (!POSSESSION) return;
        if (p.disguise) { if (this.possession && this.possession.X === p.id && p.pdowns >= 1 && p.pcages >= 1 && p.carry == null && !p.act) this.release(); return; }
        if (p.role !== 'killer' || p.char !== 'chucky' || p.harmless || p.possCd > 0 || this.possession || this.mode === 'infection') return;
        if (p.stun > 0 || p.act || p.carry != null || p.leap || p.atk) return;
        let X = null, bd = 2.2;
        for (const s of S.players) if (s.role === 'survivor' && s.st === 'down' && !(s.turn > 0) && !has(s, 'exorcist')) { const d = dist(p, s); if (d < bd) { bd = d; X = s; } }
        if (X) this.possess(p, X);
        break;
      }
      case 'split': {
        // Chucky's Soul Split: with one generator to go, jump into a spare doll; the old body fights on
        if (p.role !== 'killer' || p.char !== 'chucky' || p.split || p.disguise || p.harmless || this.possession) return;
        if (S.gatesPowered || S.gensNeeded - S.gensDone !== 1 || !S.dolls.length || p.carry != null || p.act) return;
        this.soulSplit(p);
        break;
      }
      case 'pounce': {
        // Chucky: leap as far as he coiled for, knife first
        if (p.role !== 'killer' || p.char !== 'chucky' || !p.aim || p.leap || p.stun > 0 || p.carry != null || p.act) return;
        const D = KILLERS.chucky.ability, yaw = num(m.yaw, p.yaw), f = fwd(yaw);
        const mx = p.reach || D.max, dist = D.min + (mx - D.min) * Math.min(1, Math.max(0, p.abT - 0.1) / D.coil);
        p.yaw = yaw; p.aim = false; p.abT = 0;
        p.leap = { t: 0, d: +(0.35 + dist * 0.035).toFixed(3), x0: p.x, z0: p.z, x1: p.x + f.x * dist, z1: p.z + f.z * dist, h: +(0.7 + dist * 0.06).toFixed(2) };
        this.ev({ k: 'pounce', id: p.id, x: p.x, z: p.z });
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
      case 'rush': {
        if (p.role === 'killer' && p.char === 'granny' && p.skin === 'grandpa') { this.shotgun(p, m); break; }
        // Bat Rush: released after winding up; the longer the wind-up, the further she goes (no limit)
        if (p.role !== 'killer' || p.char !== 'granny' || !p.aim || p.dash || p.stun > 0 || p.act || p.carry != null) { if (p.char === 'granny') p.aim = false; return; }
        const D = KILLERS.granny.ability, k = Math.max(0, Math.min(1, (p.abT - D.minCharge) / (D.maxCharge - D.minCharge)));
        p.aim = false;
        if (p.abT < D.minCharge) return;
        const kk = Math.max(0, (p.abT - D.minCharge) / (D.maxCharge - D.minCharge));
        const yaw = num(m.yaw, p.yaw), f = fwd(yaw), len = Math.min(p.reach || 25, D.minDist + kk * (D.maxDist - D.minDist)); // capped by her power level
        p.yaw = yaw; p.dash = { t: 0, d: len / D.speed, dx: f.x, dz: f.z, full: p.abT >= D.maxCharge - 0.02 };
        p.abCd = D.cooldown; p.abT = 0;
        this.ev({ k: 'rush', id: p.id, x: p.x, z: p.z, charge: +k.toFixed(2) });
        break;
      }
      case 'bodyswap': {
        // Body Swap: Granny and Spider Mom trade places, any time
        const sp = S.spider;
        if (p.role !== 'killer' || p.char !== 'granny' || !sp || (p.swapCd || 0) > 0 || p.stun > 0 || p.act || p.dash || p.tele || p.carry != null || p.vault) return;
        const ox = p.x, oz = p.z, ofl = p.fl || 0;
        const to = this.safeSpot(sp.x, sp.z, sp.x, sp.z, 0);
        p.x = to.x; p.z = to.z; p.fl = 0; p.sp = undefined; p.tp++; p.aim = false; p.ab = 0;
        const back = this.safeSpot(ox, oz, ox, oz, 0);
        sp.x = back.x; sp.z = back.z; sp.st = 0; sp.jump = (sp.jump || 0) + 1;
        if (this.spiderState) { this.spiderState.path = null; this.spiderState.wait = 1.2; }
        p.swapCd = KILLERS.granny.swap.cooldown;
        this.ev({ k: 'bodyswap', id: p.id, x0: ox, z0: oz, x1: p.x, z1: p.z, fl0: ofl });
        break;
      }
      case 'creep': {
        if (p.role !== 'killer' || p.char !== 'granny' || p.teleCd > 0 || p.tele || p.stun > 0 || p.act || p.carry != null || p.atk || p.vault) return;
        const L = { gen: M.gens, hook: M.cages, win: M.windows, bar: M.bars }[m.kind], o = m.kind === 'spider' ? S.spider : L && L[m.id | 0];
        if (!o || (m.kind === 'hook' && S.cageBroken[o.id]) || (m.kind === 'bar' && S.bars[o.id] === 2)) return;
        p.tele = { t: 0, x: o.x, z: o.z, g: 1 }; p.ab = 0; p.aim = false;
        this.ev({ k: 'creep', id: p.id, x: p.x, z: p.z, tx: o.x, tz: o.z });
        break;
      }
      case 'chain': {
        if (p.role !== 'killer' || p.char !== 'foreman' || p.abCd > 0 || p.stun > 0 || p.carry != null || p.act || p.pull || p.atk) return;
        const yaw = num(m.yaw, p.yaw), f = fwd(yaw);
        // the hook flies where he aims, up and down too: aim high to grab a treetop or a roof
        const pitch = Math.max(-0.35, Math.min(1.0, num(m.pitch, 0)));
        S.chains.push({ by: p.id, x: p.x + f.x * 0.5, z: p.z + f.z * 0.5, y: 1.55, dx: f.x, dz: f.z, cp: Math.cos(pitch), sp: Math.sin(pitch), d: 0, st: 'fly', t: 0, tgt: null });
        p.abCd = KILLERS.foreman.ability.cooldown; p.aim = false;
        this.ev({ k: 'chainthrow', id: p.id, x: p.x, z: p.z });
        break;
      }
      case 'ability2': {
        if (p.role === 'killer' && p.char === 'granny' && p.ab2Cd <= 0 && !p.ab && !p.tele && !p.act && p.stun <= 0 && !p.atk && p.carry == null) {
          // I Hear You: she stops and listens; anyone making noise anywhere is revealed
          const D = KILLERS.granny.ability2, ids = [];
          for (const s of S.players) if (s.role === 'survivor' && s.st === 'ok' && (s.mv === 2 || s.act || s.vault)) { s.reveal = Math.max(s.reveal, D.reveal); s.heard = D.heard; ids.push(s.id); }
          p.ab2Cd = D.cooldown; p.ab = 1; p.abT = 0.8; p.aim = false; p.score.b += ids.length * 100;
          this.ev({ k: 'hearyou', id: p.id, x: p.x, z: p.z, ids });
        }
        if (p.role === 'killer' && p.char === 'chucky' && p.ab2Cd <= 0 && !p.act && p.stun <= 0) {
          // Chucky's Laugh: every survivor in earshot gives themselves away
          const D = KILLERS.chucky.ability2, ids = [];
          for (const s of S.players) if (s.role === 'survivor' && s.st === 'ok' && dist(s, p) < D.radius) { s.reveal = Math.max(s.reveal, D.reveal); ids.push(s.id); }
          p.ab2Cd = D.cooldown; p.score.b += ids.length * 100;
          this.ev({ k: 'laugh', id: p.id, x: p.x, z: p.z, ids });
        }
        if (p.role === 'killer' && p.char === 'bateman' && p.ab2Cd <= 0 && !p.act && p.stun <= 0 && !p.atk) {
          // Business Card: everyone in front of him who can see it is intimidated
          const D = KILLERS.bateman.ability2, f = fwd(p.yaw), ids = [];
          for (const s of S.players) {
            if (s.role !== 'survivor' || s.st !== 'ok') continue;
            const dx = s.x - p.x, dz = s.z - p.z, d = Math.hypot(dx, dz);
            if (d > D.range || (d > 1 && (dx * f.x + dz * f.z) / d < 0.5) || losBlocked(M, p.x, p.z, s.x, s.z, 1.2)) continue;
            s.card = 5; s.reveal = Math.max(s.reveal, 5); ids.push(s.id);
          }
          p.ab2Cd = D.cooldown; p.score.b += ids.length * 150;
          this.ev({ k: 'card', id: p.id, x: p.x, z: p.z, ids });
        }
        if (p.role === 'killer' && p.char === 'slimer' && p.ab2Cd <= 0 && !p.act && p.stun <= 0 && p.carry == null && !(p.phase > 0)) {
          p.phase = KILLERS.slimer.ability2.duration; p.ab2Cd = KILLERS.slimer.ability2.cooldown;
          this.ev({ k: 'phase', id: p.id, x: p.x, z: p.z });
        }
        if (p.role === 'killer' && p.char === 'foreman' && !p.ab && p.ab2Cd <= 0 && !p.act && p.stun <= 0 && !p.tele) {
          p.ab = 1; p.abT = KILLERS.foreman.ability2.duration; S.dark = p.abT;
          this.ev({ k: 'lightsout', id: p.id, on: true });
        }
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
        p.wig += RULES.wiggleRate * (has(p, 'resolve') ? 1.4 : 1) * (has(this.P(p.carriedBy) || {}, 'irongrip') ? 0.7 : 1);
        if (p.wig >= RULES.wiggleNeed) {
          const k = this.P(p.carriedBy);
          if (k) this.releaseCarry(k, true);
        }
        break;
      }
      case 'esc': {
        // trying to unhook yourself: a 4% chance, and every failed attempt costs hook time
        // (Spider-Man: 5 attempts at 30% each)
        const D = SURVIVORS[p.char] || {}, tries = D.hookEscapes || 3;
        if (p.st !== 'caged' || p.stage !== 1 || p.esc >= tries) return;
        p.esc++;
        if (Math.random() < (D.hookChance ?? RULES.selfUnhook)) { this.freeFromCage(p, null); this.ev({ k: 'msg', text: p.name + ' unhooked themselves!' }); }
        else { p.cageT = Math.max(0.01, p.cageT - RULES.selfUnhookCost); this.ev({ k: 'escfail', id: p.id, left: tries - p.esc }); }
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
    k.tele = null; if (k.leap) { k.leap = null; k.tp++; }
    k.stun = Math.max(k.stun, t); k.atk = 0; k.act = null; k.aim = false;
    if (k.carry != null) this.releaseCarry(k, true);
    if (k.char === 'butcher' && k.ab === 1) this.endRampage(k);
    this.ev({ k: 'stun', id: k.id, bar: byBar });
  }

  ability(p) {
    if (p.role !== 'killer' || p.stun > 0 || p.act || p.carry != null || p.vault) return;
    if (p.tele) return;
    if (p.char === 'granny') {
      // (Bat Rush is held and released: see 'in' aim and the 'rush' action)
    } else if (p.char === 'butcher') {
      if (p.ab === 0 && p.abCd <= 0 && p.charges > 0 && !p.atk) { p.charges--; p.ab = 1; p.abT = (p.reach || 22) / 8.6; this.ev({ k: 'rampage', id: p.id }); }
    } else if (p.char === 'wisp') {
      if (p.ab === 0 && p.abCd <= 0 && !p.atk) { p.ab = 2; p.abT = 0.7; this.ev({ k: 'fade', id: p.id, on: true }); }
      else if (p.ab === 1) { p.ab = 3; p.abT = 1.0; this.ev({ k: 'fade', id: p.id, on: false }); }
    } else if (p.char === 'slimer') {
      if (p.abCd > 0 || p.atk) return;
      if (this.S.slime.length >= KILLERS.slimer.ability.max) this.S.slime.shift();
      // the glob homes in on a survivor in front of him (lands ahead of where they are running)
      const f = fwd(p.yaw);
      let tx = p.x + f.x * 6, tz = p.z + f.z * 6, best = 14, hit = null;
      for (const s of this.S.players) { if (s.role !== 'survivor' || s.st !== 'ok') continue; const dx = s.x - p.x, dz = s.z - p.z, d = Math.hypot(dx, dz); if (d > best || d < 0.5 || (dx * f.x + dz * f.z) / d < 0.7 || losBlocked(this.M, p.x, p.z, s.x, s.z, 1.2)) continue; best = d; hit = s; tx = s.x; tz = s.z; }
      // a direct hit slimes them on the spot
      if (hit) { if (!(hit.slimed > 0)) this.ev({ k: 'slimed', id: hit.id, x: hit.x, z: hit.z }); hit.slimed = 3; }
      const spot = this.safeSpot(tx, tz, p.x, p.z);
      this.S.slime.push({ id: ++this.S.lid, x: spot.x, z: spot.z });
      p.abCd = KILLERS.slimer.ability.cooldown;
      this.ev({ k: 'slimespit', id: p.id, x: spot.x, z: spot.z });
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
    const spot = this.safeSpot(k.x - f.x * 0.9, k.z - f.z * 0.9, k.x, k.z, k.fl || 0);
    s.x = spot.x; s.z = spot.z; s.fl = k.fl || 0; s.sp = k.sp; s.tp++;
    if (escaped) {
      s.st = 'ok'; s.hp = 1; s.boost = 1.5; s.boostMul = SPEED.hitBoost;
      k.stun = Math.max(k.stun, 2.6);
      s.score.d += 400;
      this.ev({ k: 'wiggle-free', id: s.id, x: s.x, z: s.z });
    } else { // dropped on purpose: back on their feet, still injured
      s.st = 'ok'; s.hp = 1; s.healP = 0; s.bleed = 0; s.boost = 0.6; s.boostMul = SPEED.hitBoost;
      this.ev({ k: 'dropped', id: s.id, x: s.x, z: s.z });
    }
  }

  safeSpot(x, z, fx, fz, fl = 0) {
    // pick a reachable point near (x,z), falling back to (fx,fz) (on the given floor)
    const M = levelOf(this.M, fl);
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
    if (r === 'miss' && S.players.some(k => k.role === 'killer' && k.char === 'granny')) p.reveal = Math.max(p.reveal || 0, 4);
    // struggling against the Entity on the hook: a miss lets its legs get closer
    if (p.st === 'caged' && p.stage >= 2) { if (r === 'miss') { p.cageT -= RULES.struggleMiss; this.ev({ k: 'sc', id: p.id, r }); } return; }
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
    const Ks = killersOf(S);
    this.updateMode(dt);
    if (S.phase !== 'play') return;
    // short position history of every survivor, for lag-compensated hits
    this.hist ||= new Map();
    for (const p of S.players) if (p.role === 'survivor') {
      let h = this.hist.get(p.id); if (!h) this.hist.set(p.id, h = []);
      h.push({ t: S.t, x: p.x, z: p.z });
      while (h.length && h[0].t < S.t - 1.0) h.shift();
    }

    // emotes end when the survivor moves, acts, gets hurt, or after a while (one-shot ones sooner)
    for (const p of S.players) if (p.emote) {
      const at = this.emoteAt && this.emoteAt.get(p.id);
      if (p.role !== 'survivor' || p.st !== 'ok' || p.act || p.vault || p.flashOn || !at || Math.hypot(p.x - at.x, p.z - at.z) > 0.3 || S.t - at.t > (p.emote === 1 ? 30 : 4)) p.emote = 0;
    }
    for (const p of S.players) {
      p.boost = Math.max(0, p.boost - dt);
      p.reveal = Math.max(0, p.reveal - dt);
      if (p.stun > 0) p.stun = Math.max(0, p.stun - dt);
      if (p.zap > 0) p.zap = Math.max(0, p.zap - dt);
      if (p.spied > 0) p.spied = Math.max(0, p.spied - dt);
      if (p.heard > 0) { p.heard = Math.max(0, p.heard - dt); if (p.st !== 'ok') p.heard = 0; }
      if (p.webbed > 0) p.webbed = Math.max(0, p.webbed - dt);
      if (p.webK > 0) p.webK = Math.max(0, p.webK - dt);
      if (p.swapCd > 0) p.swapCd = Math.max(0, p.swapCd - dt);
      if (p.abCd > 0) p.abCd = Math.max(0, p.abCd - dt * (this.mode === 'adrenaline' ? 1.4 : 1));
      if (p.ab2Cd > 0) p.ab2Cd = Math.max(0, p.ab2Cd - dt);
      if (p.teleCd > 0) p.teleCd = Math.max(0, p.teleCd - dt);
      if (p.phase > 0) { p.phase = Math.max(0, p.phase - dt); if (p.phase === 0) this.endPhase(p); }
      if (p.ambush > 0) p.ambush = Math.max(0, p.ambush - dt);
      if (p.haste > 0) p.haste = Math.max(0, p.haste - dt);
      if (p.card > 0) { p.card = Math.max(0, p.card - dt); if (p.mv === 2) p.reveal = Math.max(p.reveal, 0.4); }
      if (p.possCd > 0) p.possCd = Math.max(0, p.possCd - dt);
      if (p.exposed > 0) p.exposed = Math.max(0, p.exposed - dt);
      if (p.mark > 0) p.mark = Math.max(0, p.mark - dt);
      if (p.char === 'butcher' && p.role === 'killer' && p.charges < KILLERS.butcher.ability.charges) { p.chargeT += dt; if (p.chargeT >= KILLERS.butcher.ability.cooldown) { p.chargeT = 0; p.charges++; } }
      if (p.char === 'harrower' && p.role === 'killer' && p.ammo < KILLERS.harrower.ability.ammo) { p.ammoT += dt; if (p.ammoT >= KILLERS.harrower.ability.reload) { p.ammoT = 0; p.ammo++; } }
    }

    // ---- slime puddles: slow and reveal survivors who run through them ----
    for (const p of S.players) if (p.role === 'survivor') {
      if (p.slimed > 0) { p.slimed = Math.max(0, p.slimed - dt); p.reveal = Math.max(p.reveal, 0.3); }
      if (p.st === 'ok' && S.slime.length && S.slime.some(sl => Math.hypot(sl.x - p.x, sl.z - p.z) < 2.1)) { if (!(p.slimed > 0)) this.ev({ k: 'slimed', id: p.id, x: p.x, z: p.z }); p.slimed = 3; }
    }
    // ---- flashlights & ghost traps ----
    this.updateFlashlights(Ks, dt);
    for (const K of Ks) if (S.traps.length && !K.vault && !K.disguise && !(K.act && K.act.k === 'execute')) {
      const hit = S.traps.find(t => Math.hypot(t.x - K.x, t.z - K.z) < 0.85);
      if (hit) { S.traps = S.traps.filter(t => t !== hit); const by = this.P(hit.by); this.stunKiller(K, by && has(by, 'containment') ? 4 : 2.6, false); if (by) by.score.d += 500; this.ev({ k: 'trapped', id: K.id, by: hit.by, x: hit.x, z: hit.z }); }
    }

    // ---- killer attack / abilities ----
    for (const K of Ks) this.updateKiller(K, dt);
    this.updateReels(dt);

    // ---- interactions (hold E) ----
    for (const p of S.players) this.updateAction(p, dt);

    // ---- spears, chainsaws ----
    this.updateSpears(dt);
    this.updateSaws(dt);
    this.updateGranny(dt);

    // ---- survivor states ----
    for (const p of S.players) {
      if (p.role !== 'survivor') continue;
      if (p.st === 'carried') {
        const k = this.P(p.carriedBy);
        if (k) { const f = fwd(k.yaw); p.x = k.x + f.x * 0.25; p.z = k.z + f.z * 0.25; p.yaw = k.yaw; p.fl = k.fl || 0; p.sp = k.sp; }
      } else if (p.st === 'caged') {
        const c = M.cages[p.cage];
        p.x = c.x; p.z = c.z;
        const rescuing = S.players.some(o => o.act && o.act.k === 'rescue' && o.act.id === p.cage);
        if (!rescuing) p.cageT -= dt * (anyKillerHas(S, 'rust') ? 1.2 : 1);
        // bots fight the Entity too, and now and then slip up
        if (p.bot && p.stage >= 2 && !rescuing && Math.random() < dt * 0.025) { p.cageT -= RULES.struggleMiss; this.ev({ k: 'sc', id: p.id, r: 'miss' }); }
        if (p.cageT <= 0) {
          if (p.stage === 1) { // the Entity arrives: struggle phase
            p.stage = 2; p.cageMax = p.cageT = RULES.cageStage[1];
            this.ev({ k: 'struggle', id: p.id, cage: p.cage });
            this.ev({ k: 'msg', text: 'The Entity is trying to claim ' + p.name + '!' });
          } else this.kill(p, 'sacrificed');
        }
      } else if (p.st === 'down') {
        const beingHelped = S.players.some(o => o.act && o.act.k === 'heal' && o.act.id === p.id);
        if (!beingHelped) p.bleed -= dt * (has(p, 'resolve') ? 0.66 : 1);
        if (p.bleed <= 0) this.kill(p, 'bled out');
        // Infection: a few seconds after going down, they rise as a killer
        else if (p.turn > 0) { p.turn = Math.max(0, p.turn - dt); if (p.turn === 0) this.infect(p); }
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
          let r = 1 / RULES.genCharges * (M.indoor ? 1.12 : 1) * (this.mode === 'rush' ? 2 : 1) * (this.mode === 'glass' ? 1.4 : this.mode === 'adrenaline' ? 1.25 : 1) * (p.st === 'ghost' ? 0.9 : 1); // tighter indoor maps favour the killer
          if (has(p, 'shared')) r *= 1 + 0.15 * (g.n - 1);
          if (Ks.some(K => has(K, 'dread') && dist(K, p) < terrorRadius(K))) r *= 0.9;
          rate += r;
          p.score.a += dt * 12;
        }
        g.p += rate * eff[Math.min(4, g.n)] * dt;
        if (g.p >= 1) this.completeGen(i);
      } else if (g.reg) {
        g.p -= dt * (0.25 / RULES.genCharges) * (anyKillerHas(S, 'overload') ? 1.5 : 1);
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
    // Infection: the last survivor standing makes a last stand: survive 45 seconds to win
    if (this.mode === 'infection' && S.infStart >= 2 && !S.lastStand && alive.length === 1 && alive[0].st === 'ok' && !S.players.some(p => p.role === 'survivor' && p.st === 'out')) {
      S.lastStand = true; S.timer = 45;
      const w = alive[0]; w.hp = 2; w.healP = 0; w.boost = 5; w.boostMul = 1.3;
      this.ev({ k: 'laststand', id: alive[0].id });
      this.ev({ k: 'msg', text: alive[0].name + ' is the last survivor standing! Survive 45 seconds to win.' });
    }
    if (alive.length === 0) this.endMatch();
  }

  // ---- mode rules that tick: the Survivor Rush clock ----
  updateMode(dt) {
    const S = this.S;
    // Chucky's time inside a survivor's body runs out after 1.1 minutes
    if (this.possession) {
      const P = this.possession, X = this.P(P.X); P.t += dt;
      if (X) X.possT = Math.max(0, POSSESS_MAX - P.t);
      if (P.t >= POSSESS_MAX && !(X && X.act && X.act.k === 'execute')) { this.ev({ k: 'msg', text: 'Chucky was forced out of the body!' }); this.release(); }
    }
    // Blood Moon: every 45s the killer sees every survivor for a moment
    if (this.mode === 'bloodmoon') {
      this.pulseT = (this.pulseT || 0) + dt;
      if (this.pulseT >= 45) { this.pulseT = 0; for (const p of S.players) if (p.role === 'survivor' && p.st === 'ok') p.reveal = Math.max(p.reveal, 4); this.ev({ k: 'pulse', moon: true }); }
    }
    // Infection: every 60s the infected sense every survivor for a moment (no endless hide-and-seek)
    if (this.mode === 'infection') {
      this.pulseT = (this.pulseT || 0) + dt;
      if (this.pulseT >= 60) {
        this.pulseT = 0;
        for (const p of S.players) if (p.role === 'survivor' && p.st === 'ok') p.reveal = Math.max(p.reveal, 4);
        this.ev({ k: 'pulse' });
      }
    }
    if (this.mode === 'infection' && S.lastStand && S.timer > 0) {
      S.timer = Math.max(0, S.timer - dt);
      if (S.timer === 0) {
        for (const w of S.players) if (w.role === 'survivor' && ['ok', 'down', 'carried', 'caged'].includes(w.st)) {
          w.st = 'out'; w.outcome = 'escaped'; w.act = null; w.turn = 0; w.score.c += 3000;
          this.ev({ k: 'escaped', id: w.id }); this.ev({ k: 'msg', text: w.name + ' survived the last stand!' });
        }
        this.endMatch();
      }
    }
    if (this.mode === 'rush' && S.timer > 0) {
      S.timer = Math.max(0, S.timer - dt);
      if (S.timer === 0) {
        // time is up: the gates power themselves and the night closes in fast
        if (!S.gatesPowered) {
          S.gatesPowered = true;
          for (const p of S.players) if (p.act && p.act.k === 'repair') { p.act = null; p.prog = 0; }
          this.ev({ k: 'powered' });
        }
        S.collapse = S.collapse > 0 ? Math.min(S.collapse, 40) : 40;
        this.ev({ k: 'msg', text: 'Time is up! The gates are powered. 40 seconds until the night takes everyone.' });
      }
    }
  }

  // ---- Infection: a downed survivor rises as a killer ----
  infect(p) {
    const S = this.S;
    if (p.st !== 'down' || p.role !== 'survivor') return;
    for (const o of S.players) if (o.act && (o.act.k === 'heal' || o.act.k === 'pickup') && o.act.id === p.id) this.cancelAct(o);
    const char = INFECT_POOL[Math.floor(Math.random() * INFECT_POOL.length)];
    Object.assign(p, {
      role: 'killer', char, skin: 'default', perks: [], st: 'ok', hp: 2, act: null, prog: 0, healP: 0, bleed: 0, turn: 0, boost: 0, slimed: 0, mark: 0, reveal: 0,
      carry: null, atk: 0, atkT: 0, atkHit: false, stun: 1.5, ab: 0, abT: 0, abCd: 0, ab2Cd: 0, aim: false, flash: 0, flashOn: false, traps: 0, glare: 0, blind: 0, blindImm: 6,
      charges: char === 'butcher' ? KILLERS.butcher.ability.charges : 0, chargeT: 0, ammo: char === 'harrower' ? KILLERS.harrower.ability.ammo : char === 'bateman' ? 1 : 0, ammoT: 0, card: 0,
      outcome: 'infected', diffMul: p.bot ? this.diff.killerSpeed : 1,
    });
    p.tp++;
    if (this.inputs.get(p.id)) Object.assign(this.inputs.get(p.id), { e: false, latch: false });
    this.ev({ k: 'infected', id: p.id, char, x: p.x, z: p.z });
    this.ev({ k: 'msg', text: p.name + ' has turned into ' + KILLERS[char].name + '!' });
  }

  // survivors shine their torch in the killer's eyes: hold the beam on his face to blind and stun him
  updateFlashlights(Ks, dt) {
    const S = this.S;
    const on = [];
    for (const s of S.players) {
      if (s.role !== 'survivor' || !s.flashOn) continue;
      if (s.st !== 'ok' || s.act || s.vault) { s.flashOn = false; continue; }
      s.flash = Math.max(0, s.flash - dt);
      if (s.flash <= 0) { s.flashOn = false; this.ev({ k: 'flashdead', id: s.id }); continue; }
      on.push(s);
    }
    for (const K of Ks) this.flashKiller(K, on, dt);
  }
  flashKiller(K, on, dt) {
    const S = this.S, M = this.M;
    let lit = null;
    for (const s of on) {
      const dx = K.x - s.x, dz = K.z - s.z, d = Math.hypot(dx, dz);
      if (d > RULES.flashRange || d < 0.3) continue;
      const f = fwd(s.yaw), kf = fwd(K.yaw);
      if ((dx * f.x + dz * f.z) / d < 0.95) continue;        // beam on the killer
      if (-(dx * kf.x + dz * kf.z) / d < 0.3) continue;      // and he is looking into it
      if (losBlocked(M, s.x, s.z, K.x, K.z, 1.2)) continue;
      lit = s;
    }
    K.blind = Math.max(0, K.blind - dt);
    K.blindImm = Math.max(0, K.blindImm - dt);
    const canBlind = K.blindImm <= 0 && !(K.act && K.act.k === 'execute') && !(K.char === 'wisp' && K.ab === 1);
    if (lit && canBlind) {
      K.glare = Math.min(1, K.glare + dt / RULES.flashTime);
      if (K.glare >= 1) {
        const save = K.carry != null || (K.act && K.act.k === 'pickup');
        K.glare = 0; K.blind = RULES.blindTime; K.blindImm = RULES.blindImmune;
        this.stunKiller(K, RULES.flashStun, false);
        lit.score.d += save ? 700 : 350;
        if (has(lit, 'exposure')) { K.exposed = 6; this.ev({ k: 'exposed', id: K.id, by: lit.id }); }
        this.ev({ k: 'blind', id: K.id, by: lit.id, save });
      }
    } else K.glare = Math.max(0, K.glare - dt * 1.5);
  }

  // a phase that ends inside a wall (or the void behind it) drops him on the nearest open ground
  endPhase(p) {
    const g = this.M.grid, N = g.N, cell = (x, z) => Math.max(0, Math.min(N - 1, Math.floor((z + g.ext) / 0.5))) * N + Math.max(0, Math.min(N - 1, Math.floor((x + g.ext) / 0.5)));
    if (g.type[cell(p.x, p.z)] !== 1) return;
    for (let r = 0.5; r < 14; r += 0.5) for (let a = 0; a < 16; a++) {
      const x = p.x + Math.cos(a / 16 * 6.283) * r, z = p.z + Math.sin(a / 16 * 6.283) * r;
      if (g.type[cell(x, z)] === 0) { p.x = x; p.z = z; p.tp++; return; }
    }
  }

  posAt(id, t) {
    const h = this.hist && this.hist.get(id);
    if (!h || !h.length) return null;
    for (let i = h.length - 1; i > 0; i--) if (h[i - 1].t <= t) {
      const a = h[i - 1], b = h[i], f = Math.max(0, Math.min(1, (t - a.t) / Math.max(1e-4, b.t - a.t)));
      return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
    }
    return h[0];
  }

  updateKiller(K, dt) {
    const S = this.S, M = this.M;
    // lunge / recovery
    if (K.atk === 1) {
      K.atkT -= dt;
      const range = RULES.hitRange * (has(K, 'stalker') ? 1.2 : 1) * (K.atkAmbush ? 1.6 : 1);
      const f = fwd(K.yaw);
      const inReach = (sx, sz) => {
        const dx = sx - K.x, dz = sz - K.z, d = Math.hypot(dx, dz);
        if (d > range) return false;
        const dot = d > 0.01 ? (dx * f.x + dz * f.z) / d : 1;
        if (dot < 0.62 && d > 0.9) return false;
        return !losL(M, K, { x: sx, z: sz, fl: cur.fl }, 1.0);
      };
      let cur = null;
      for (const s of S.players) {
        if (s.role !== 'survivor' || s.st !== 'ok') continue;
        if (!levelsMeet(K, s) || (M.stairs && Math.abs(heightAt(M, K) - heightAt(M, s)) > 1.7)) continue;
        cur = s;
        let ok = inReach(s.x, s.z);
        const rewind = (this.rw && this.rw.get(K.id)) || 0;
        if (!ok && rewind > 0) { const h = this.posAt(s.id, S.t - rewind); ok = !!h && inReach(h.x, h.z); }
        if (!ok) continue;
        this.damage(s, K, false);
        K.atk = 2; K.atkHit = true; K.atkT = RULES.hitCooldown * (has(K, 'relentless') ? 0.65 : 1);
        break;
      }
      if (K.atk === 1 && K.atkT <= 0) {
        K.atk = 2; K.atkHit = false; K.atkT = RULES.missCooldown; this.ev({ k: 'whiff', id: K.id });
      }
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
    } else if (K.char === 'foreman') {
      if (K.ab === 1) {
        K.abT -= dt; S.dark = Math.max(0, K.abT);
        // hunts by sound: running survivors nearby give themselves away
        for (const s of S.players) if (s.role === 'survivor' && s.st === 'ok' && s.mv === 2 && !s.cr && dist(s, K) < 24) s.reveal = Math.max(s.reveal, 0.5);
        if (K.abT <= 0) { K.ab = 0; K.ab2Cd = KILLERS.foreman.ability2.cooldown; S.dark = 0; this.ev({ k: 'lightsout', id: K.id, on: false }); }
      }
      // hunts by sound: running survivors ping their position
      K.soundT -= dt;
      if (K.soundT <= 0) {
        K.soundT = 2.2;
        for (const s of S.players) if (s.role === 'survivor' && s.st === 'ok' && s.mv === 2 && !s.cr && dist(s, K) < 22 && !has(s, 'hushed')) this.noise(s.x + (Math.random() - 0.5) * 2, s.z + (Math.random() - 0.5) * 2);
      }
      this.updateChains(K, dt);
    } else if (K.char === 'lamplighter') {
      if (K.tele) {
        K.tele.t += dt;
        const L = S.lanterns.find(l => l.id === K.tele.id);
        if (!L) K.tele = null;
        else if (K.tele.t >= RULES.teleTime) {
          const spot = this.safeSpot(L.x + 0.9, L.z, L.x, L.z);
          K.x = spot.x; K.z = spot.z; K.fl = 0; K.tp++;
          K.tele = null; K.teleCd = RULES.teleCd;
          this.ev({ k: 'tele-end', id: K.id, x: K.x, z: K.z });
        }
      }
      // lanterns reveal survivors around them
      for (const s of S.players) if (s.role === 'survivor' && s.st === 'ok')
        for (const L of S.lanterns) if (Math.hypot(s.x - L.x, s.z - L.z) < RULES.lanternRadius) { s.reveal = Math.max(s.reveal, 0.3); break; }
    }
    if (K.char === 'chucky' && K.leap) this.updateLeap(K, dt);
    // chase tracking for score
    let chasing = false;
    for (const s of S.players) if (s.role === 'survivor' && s.st === 'ok' && dist(s, K) < 12 && !losBlocked(M, K.x, K.z, s.x, s.z)) { chasing = true; s.score.d += dt * 6; }
    if (chasing) K.score.c += dt * 5;
  }

  damage(s, K, instantDown) {
    if (K && K.harmless) return;
    if (K && (!levelsMeet(K, s) || (this.M.stairs && Math.abs(heightAt(this.M, K) - heightAt(this.M, s)) > 1.7))) return; // a floor apart // Chucky's empty doll can chase, but not hurt
    if (s.st === 'ghost') return;
    if (K && K.char === 'foreman' && K.ab === 1 && !this.chainDmg) instantDown = true;
    // (slimed survivors are slowed and revealed, not one-shot: that made him unbeatable) // one strike from the hook, in the dark
    s.act = null; s.prog = 0;
    if (K && K.char === 'granny' && s.heard > 0) { instantDown = true; s.heard = 0; }
    if (this.mode === 'glass') instantDown = true; // Glass Bones: every hit downs
    if (K && K.disguise) (s.knows ||= {})[K.id] = true; // hit by the 'survivor' Chucky is wearing: now they know // I Hear You: she knew exactly where you were
    const wasHp = s.hp;
    s.hp = instantDown ? 0 : s.hp - 1;
    K.score.a += 300;
    // damage tally for the end screen: health states taken, hits, downs
    K.score.hits = (K.score.hits || 0) + 1; K.score.dmg = (K.score.dmg || 0) + Math.max(1, wasHp - s.hp);
    s.lastHitBy = K.id;
    if (this.mode === 'rush') K.haste = Math.max(K.haste || 0, 2.5);
    if (K.char === 'bateman') K.haste = Math.max(K.haste || 0, 4); // Morning Routine
    if (s.hp <= 0) {
      s.hp = 0; s.st = 'down'; s.bleed = RULES.bleedout; s.healP = 0; s.boost = 0;
      if (this.mode === 'infection') s.turn = 3;
      K.score.c += 500;
      K.score.downs = (K.score.downs || 0) + 1;
      if (K.disguise) K.pdowns++;
      this.ev({ k: 'hit', id: s.id, by: K.id, x: s.x, z: s.z, down: true });
      this.ev({ k: 'msg', text: s.name + ' is down!' });
    } else {
      s.boost = SPEED.hitBoostTime * (has(s, 'fleet') ? 1.5 : 1); s.boostMul = SPEED.hitBoost; s.healP = 0;
      this.ev({ k: 'hit', id: s.id, by: K.id, x: s.x, z: s.z, down: false });
    }
  }

  kill(p, how) {
    const S = this.S;
    const K = (p.st === 'carried' && this.P(p.carriedBy)) || (p.st === 'exec' && this.P(p.execBy)) || nearestKiller(S, p);
    if (p.st === 'caged') { S.cageBroken[p.cage] = true; S.cages[p.cage] = null; }
    if (p.st === 'carried' && K && K.carry === p.id) K.carry = null;
    // who gets the kill on the end screen: the executioner, whoever hooked them, or whoever downed them
    if (p.role === 'survivor') {
      const by = this.P(how === 'executed' ? (p.killedBy || p.execBy) : how === 'sacrificed' ? p.hookedBy : how === 'bled out' ? p.lastHitBy : null);
      if (by && by.role === 'killer') { by.score.kills = (by.score.kills || 0) + 1; if (how === 'executed') by.score.execs = (by.score.execs || 0) + 1; }
    }
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
    const k = nearestKiller(S, c);
    // step out on the rescuer's side (or away from the killer)
    let ox = 1, oz = 0;
    if (by) { ox = by.x - c.x; oz = by.z - c.z; } else if (k) { ox = c.x - k.x; oz = c.z - k.z; }
    const d = Math.hypot(ox, oz) || 1;
    const spot = this.safeSpot(c.x + ox / d * 1.25, c.z + oz / d * 1.25, by ? by.x : c.x + 1.3, by ? by.z : c.z);
    p.x = spot.x; p.z = spot.z; p.fl = 0; p.tp++;
    if (has(p, 'lastwind')) { p.boost = 5; p.boostMul = 1.4; }
    this.ev({ k: 'rescued', id: p.id, by: by ? by.id : -1 });
  }

  completeGen(i) {
    const S = this.S, M = this.M;
    const g = S.gens[i];
    g.p = 1; g.done = true; g.reg = false;
    S.gensDone++;
    const sentry = anyKillerHas(S, 'sentry');
    const boost = S.players.some(p => p.act && p.act.k === 'repair' && p.act.id === i && has(p, 'overclock'));
    for (const p of S.players) if (p.act && p.act.k === 'repair' && p.act.id === i) {
      p.act = null; p.prog = 0; p.score.a += 300;
      if (sentry) p.reveal = 6;
      this.inputs.get(p.id).latch = true;
    }
    // Overclock: the nearest unfinished generator jumps ahead
    if (boost) { let best = null, bd = 1e9; for (const g of M.gens) if (!S.gens[g.id].done && g.id !== i) { const d = Math.hypot(g.x - M.gens[i].x, g.z - M.gens[i].z); if (d < bd) { bd = d; best = g; } } if (best) { S.gens[best.id].p = Math.min(0.99, S.gens[best.id].p + 0.1); this.ev({ k: 'overclock', id: best.id, x: best.x, z: best.z }); } }
    this.ev({ k: 'gen', id: i, x: M.gens[i].x, z: M.gens[i].z, left: Math.max(0, S.gensNeeded - S.gensDone) });
    if (S.gensDone >= S.gensNeeded && !S.gatesPowered) {
      S.gatesPowered = true;
      S.collapse = RULES.collapse * (this.mode === 'rush' ? 0.5 : 1);
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
        if (v && v.st === 'exec') { p.score.d += 1500; v.killedBy = p.id; this.kill(v, 'executed'); }
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
    if ((it.k === 'kick' || it.k === 'break' || it.k === 'pickup' || it.k === 'cage') && p.bot) {
      // bots turn to face what they interact with; a human killer keeps control of their own view
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
    switch (a.k) {
      case 'repair': p.prog = S.gens[a.id].p; break;
      case 'heal': case 'self': {
        const t = a.k === 'self' ? p : this.P(a.id);
        if (!t) { this.cancelAct(p); return; }
        let rate = 1 / RULES.healTime;
        if (has(p, 'medic')) rate *= a.k === 'self' ? 0.5 : 1.3;
        if (has(p, 'triage') && t.st === 'down') rate *= 2;
        else if (a.k === 'self') rate *= 0.5;
        t.healP += rate * dt;
        p.prog = t.healP;
        p.score.b += dt * 15;
        if (t.healP >= 1) {
          t.healP = 0;
          t.shp = 100; // mended: the shotgun bar is full again
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
        s.cage = a.id; S.cages[a.id] = s.id; s.fl = 0;
        p.score.hooks = (p.score.hooks || 0) + 1; s.hookedBy = p.id;
        s.st = 'caged'; s.esc = 0; s.tp++;
        p.score.d += 500;
        if (p.disguise) p.pcages++;
        if (s.stage >= 3) { this.ev({ k: 'caged', id: s.id, cage: a.id, stage: s.stage }); this.kill(s, 'sacrificed'); }
        else {
          s.cageMax = s.cageT = RULES.cageStage[s.stage - 1];
          this.ev({ k: 'caged', id: s.id, cage: a.id, stage: s.stage });
          this.ev({ k: 'msg', text: s.name + ' has been hooked' + (s.stage === 2 ? ' again! The Entity is already here.' : '.') });
          if (s.stage === 2) this.ev({ k: 'struggle', id: s.id, cage: a.id });
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
      case 'chest': {
        // what's inside is rolled now: a Taser one time in five, otherwise a fresh flashlight or ghost traps
        const cs = S.chests[a.id]; if (!cs || cs.open) break;
        const r = Math.random();
        cs.open = true;
        cs.it = r < ITEMS.taser.chance ? { k: 'taser', n: ITEMS.taser.shots } : r < 0.6 ? { k: 'flashlight', n: RULES.flashBattery } : { k: 'trap', n: 2 };
        p.score.c += 150;
        this.ev({ k: 'chest', id: a.id, by: p.id, item: cs.it.k });
        break;
      }
      case 'swap': {
        // trade what you're holding (used up or not) for what's in the chest
        const cs = S.chests[a.id]; if (!cs || !cs.it) break;
        const mine = { k: p.item, n: p.item === 'trap' ? p.traps : p.item === 'taser' ? p.tasers : p.flash };
        const got = cs.it;
        p.item = got.k; p.flash = got.k === 'flashlight' ? got.n : 0; p.traps = got.k === 'trap' ? got.n : 0; p.tasers = got.k === 'taser' ? got.n : 0;
        p.flashOn = false;
        cs.it = mine;
        this.ev({ k: 'chestswap', id: a.id, by: p.id, item: got.k, left: mine.k });
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

  // ---- the Foreman's chain hook: fly, then either reel a survivor in or yank him to a wall ----
  updateChains(K, dt) {
    const S = this.S, M = this.M, range = K.reach || KILLERS.foreman.ability.range;
    // killer yanked to a wall
    if (K.pull) {
      K.pull.t += dt;
      const f = Math.min(1, K.pull.t / K.pull.d), e = f * f * (3 - 2 * f);
      K.x = K.pull.x0 + (K.pull.x1 - K.pull.x0) * e; K.z = K.pull.z0 + (K.pull.z1 - K.pull.z0) * e;
      if (f >= 1) { if (K.pull.h) this.ev({ k: 'chainland', id: K.id, x: K.x, z: K.z }); K.pull = null; K.tp++; }
    }
    for (let i = S.chains.length - 1; i >= 0; i--) {
      const c = S.chains[i];
      if (c.by !== K.id) continue;
      c.t += dt;
      if (c.st === 'fly') {
        const step = 34 * dt, n = 4;
        for (let k = 0; k < n && c.st === 'fly'; k++) {
          const px = c.x, pz = c.z, cp = c.cp ?? 1, sp = c.sp ?? 0;
          c.x += c.dx * cp * step / n; c.z += c.dz * cp * step / n; c.y = (c.y ?? 1.55) + sp * step / n; c.d += step / n;
          for (const s of S.players) {
            if (s.role !== 'survivor' || s.st !== 'ok' || s.reel || !levelsMeet(K, s)) continue;
            if (Math.hypot(s.x - c.x, s.z - c.z) < 0.45 && c.y > 0.1 && c.y < (s.cr ? 1.2 : 1.95)) {
              this.chainDmg = true; this.damage(s, K, false); this.chainDmg = false;
              if (s.st === 'ok') { const dd = Math.hypot(s.x - K.x, s.z - K.z) || 1, keep = Math.max(2.6, dd * 0.55); const tx = K.x + (s.x - K.x) / dd * keep, tz = K.z + (s.z - K.z) / dd * keep; const spot = this.safeSpot(tx, tz, s.x, s.z); s.reel = { t: 0, x0: s.x, z0: s.z, x1: spot.x, z1: spot.z }; s.act = null; s.tp++; }
              K.score.b += 300;
              c.st = 'reel'; c.tgt = s.id; c.t = 0;
              this.ev({ k: 'chainhit', id: s.id, x: s.x, z: s.z });
              break;
            }
          }
          if (c.st !== 'fly') break;
          const ground = c.y <= 0.05;
          if (ground || losBlocked(M, px, pz, c.x, c.z, Math.max(0.6, c.y))) {
            // caught a wall, a treetop or the ground: yank the Foreman across to it. Caught high
            // up, he is flung up to the hook and then drops down at the foot of what it bit into
            const back = ground ? 0 : 0.9, gx = c.x - c.dx * back, gz = c.z - c.dz * back, gy = Math.max(0, c.y);
            const dd = Math.hypot(gx - K.x, gz - K.z), h = gy > 2.2 ? gy : 0;
            if ((dd > 2.5 || h) && K.carry == null) {
              const spot = this.safeSpot(gx, gz, K.x, K.z);
              K.pull = { t: 0, d: Math.max(0.25, dd / 16) + (h ? 0.3 + Math.sqrt(h) * 0.12 : 0), x0: K.x, z0: K.z, x1: spot.x, z1: spot.z, h: h ? +h.toFixed(2) : 0 };
              K.atk = 0; this.ev({ k: 'chaingrab', id: K.id, x: c.x, z: c.z, y: gy });
            }
            c.st = 'back'; c.t = 0; c.x = gx; c.z = gz; c.y = gy;
            break;
          }
          if (c.y > 14) { c.st = 'back'; c.t = 0; }
          if (c.d > range) { c.st = 'back'; c.t = 0; }
        }
      } else if (c.st === 'reel') {
        const s = this.P(c.tgt);
        if (s) { c.x = s.x; c.z = s.z; }
        if (!s || !s.reel) S.chains.splice(i, 1);
      } else {
        // retract
        const dd = Math.hypot(c.x - K.x, c.z - K.z) || 1, step = 40 * dt;
        if (dd < step + 0.5 || c.t > 1.2) { S.chains.splice(i, 1); continue; }
        c.x += (K.x - c.x) / dd * step; c.z += (K.z - c.z) / dd * step; c.y = (c.y ?? 1.55) + (1.55 - (c.y ?? 1.55)) * Math.min(1, dt * 8);
      }
    }
  }

  soulSplit(C) {
    const S = this.S;
    const D = S.dolls.splice(Math.floor(Math.random() * S.dolls.length), 1)[0];
    const nid = C.id + '~soul';
    const N = this.makePlayer({ id: nid, name: C.name, role: 'killer', char: 'chucky', skin: C.skin, perks: C.perks, bot: C.bot }, { x: D.x, z: D.z });
    Object.assign(N, { yaw: D.yaw, split: true, possCd: C.possCd, stun: 0.8, score: { a: 0, b: 0, c: 0, d: 0 } });
    S.players.push(N); this.inputs.set(nid, { e: false, latch: false });
    // the body he leaves keeps hunting on its own: it can put survivors down, but never cage them
    Object.assign(C, { split: true, bot: true, noCage: true, aim: false, act: null, name: 'Chucky (bot)' });
    if (this.inputs.get(C.id)) Object.assign(this.inputs.get(C.id), { e: false, latch: false });
    this.ev({ k: 'swap', from: C.id, to: nid });
    this.ev({ k: 'split', id: C.id, to: nid, x: D.x, z: D.z, doll: D.id });
    this.ev({ k: 'msg', text: "Chucky's soul has split into another doll!" });
  }

  // ---- Chucky's Possession ----
  // The downed survivor gets up with Chucky inside; nobody is told. Chucky's player now controls that
  // body (it can strike, pick up and cage), his doll is left behind as a harmless bot that only chases,
  // and the survivor's player wanders the map as a ghost nobody else can see.
  possess(C, X) {
    const S = this.S;
    for (const o of S.players) if (o.act && (o.act.k === 'heal' || o.act.k === 'pickup') && o.act.id === X.id) this.cancelAct(o);
    const orig = { char: X.char, skin: X.skin, perks: X.perks, item: X.item, flash: X.flash, traps: X.traps, tasers: X.tasers, bot: X.bot };
    const gid = X.id + '~ghost';
    const G = this.makePlayer({ id: gid, name: X.name, role: 'survivor', char: X.char, skin: X.skin, perks: X.perks, item: X.item, bot: X.bot }, { x: X.x, z: X.z });
    Object.assign(G, { st: 'ghost', yaw: X.yaw, stage: X.stage, flash: 0, traps: 0, tasers: 0, score: X.score });
    X.score = { a: 0, b: 0, c: 0, d: 0 };
    S.players.push(G); this.inputs.set(gid, { e: false, latch: false });
    Object.assign(X, {
      role: 'killer', disguise: true, perks: [], st: 'ok', hp: 2, act: null, prog: 0, healP: 0, bleed: 0, turn: 0, boost: 0, flashOn: false,
      atk: 0, atkT: 0, atkHit: false, stun: 0, carry: null, aim: false, pdowns: 0, pcages: 0, bot: C.bot, reveal: 0, mark: 0, slimed: 0, card: 0,
    });
    X.tp++;
    const cBot = C.bot;
    Object.assign(C, { bot: true, harmless: true, act: null, aim: false, leap: null, possCd: 600 });
    if (this.inputs.get(C.id)) Object.assign(this.inputs.get(C.id), { e: false, latch: false });
    if (this.inputs.get(X.id)) Object.assign(this.inputs.get(X.id), { e: false, latch: false });
    this.possession = { C: C.id, X: X.id, G: gid, orig, cBot, t: 0 }; X.possT = POSSESS_MAX;
    // control moves silently: the survivor's player to the ghost, Chucky's player into the body
    this.ev({ k: 'swap', from: X.id, to: gid });
    this.ev({ k: 'swap', from: C.id, to: X.id });
    this.ev({ k: 'possessed', id: X.id, by: C.id, ghost: gid });
  }
  release() {
    const S = this.S, P = this.possession;
    if (!P) return;
    this.possession = null;
    const X = this.P(P.X), C = this.P(P.C), G = this.P(P.G);
    if (X) {
      if (X.carry != null) this.releaseCarry(X, false);
      Object.assign(X, { possT: 0, role: 'survivor', disguise: false, ...P.orig, bot: G ? G.bot : P.orig.bot, st: 'ok', hp: 1, act: null, prog: 0, atk: 0, atkT: 0, stun: 0, aim: false, pdowns: 0, pcages: 0 });
      if (G) for (const k in G.score) X.score[k] = (X.score[k] || 0) + G.score[k];
      X.tp++;
    }
    if (C) Object.assign(C, { bot: P.cBot, harmless: false, act: null });
    if (G) { S.players.splice(S.players.indexOf(G), 1); this.inputs.delete(G.id); }
    if (C) this.ev({ k: 'swap', from: P.X, to: P.C });
    this.ev({ k: 'swap', from: P.G, to: P.X });
    this.ev({ k: 'depossessed', id: P.X, by: P.C });
  }

  // Chucky's pounce: fly along the leap, strike the first survivor in reach, bounce off walls
  updateLeap(K, dt) {
    const L = K.leap, S = this.S, M = this.M, D = KILLERS.chucky.ability;
    L.t += dt;
    const f = Math.min(1, L.t / L.d);
    const tx = L.x0 + (L.x1 - L.x0) * f, tz = L.z0 + (L.z1 - L.z0) * f;
    const want = Math.hypot(tx - K.x, tz - K.z);
    // airborne: sails over fences, pallets, crates and rocks (anything under 1.6m); walls still stop him,
    // and Ghost Traps still catch him (they are checked against his position every tick)
    const r = moveCircle(levelOf(M, K.fl), K.fl ? null : S, K.x, K.z, tx - K.x, tz - K.z, 0.3, 1.6);
    const blocked = want > 0.05 && Math.hypot(r.x - K.x, r.z - K.z) < want * 0.4;
    K.x = r.x; K.z = r.z;
    for (const s of S.players) {
      if (s.role !== 'survivor' || s.st !== 'ok') continue;
      if (Math.hypot(s.x - K.x, s.z - K.z) < 1.2 && !K.harmless) {
        this.damage(s, K, false); K.score.b += 300;
        K.leap = null; K.tp++; K.abCd = D.cooldown; K.atk = 2; K.atkHit = true; K.atkT = RULES.hitCooldown * 0.8;
        this.ev({ k: 'pounce-hit', id: s.id, by: K.id, x: s.x, z: s.z });
        return;
      }
    }
    if (blocked && f > 0.15) {
      K.leap = null; K.tp++; K.abCd = D.cooldown;
      this.stunKiller(K, 1.4, false);
      this.ev({ k: 'pounce-wall', id: K.id, x: K.x, z: K.z });
      return;
    }
    if (f >= 1) { K.leap = null; K.tp++; K.abCd = D.cooldown; K.atk = 2; K.atkHit = false; K.atkT = 0.6; this.ev({ k: 'pounce-land', id: K.id, x: K.x, z: K.z }); }
  }

  // survivors being reeled in by a chain hook
  updateReels(dt) {
    for (const s of this.S.players) if (s.reel) {
      s.reel.t += dt;
      const f = Math.min(1, s.reel.t / 0.45), e = 1 - (1 - f) * (1 - f);
      s.x = s.reel.x0 + (s.reel.x1 - s.reel.x0) * e; s.z = s.reel.z0 + (s.reel.z1 - s.reel.z0) * e;
      if (f >= 1) { s.reel = null; s.tp++; }
    }
  }

  // Patrick Bateman's thrown chainsaw
  // ---------------- Granny: Bat Rush, listening, sharp ears, Spider Mom ----------------
  updateGranny(dt) {
    const S = this.S, M = this.M;
    const Gs = S.players.filter(p => p.role === 'killer' && p.char === 'granny');
    for (const p of S.players) if (p.snare > 0) { p.snare = Math.max(0, p.snare - dt); if (p.st !== 'ok') p.snare = 0; }
    if (!Gs.length && !S.spider) return;
    const D = KILLERS.granny.ability, T = KILLERS.granny.teleport;
    for (const K of Gs) {
      // listening (I Hear You): stands still for a moment
      if (K.ab === 1) { K.abT -= dt; if (K.abT <= 0) { K.ab = 0; K.abT = 0; } }
      // winding up the bat
      if (K.aim) { K.abT = Math.min(600, K.abT + dt); if (K.stun > 0 || K.carry != null || K.act) K.aim = false; }
      if (K.dash) this.updateRush(K, dt);
      // Creep: fade out, reappear by the chosen window, pallet, generator or hook
      if (K.tele && K.tele.g) {
        K.tele.t += dt;
        if (K.tele.t >= T.time) {
          const spot = this.safeSpot(K.tele.x + 1.1, K.tele.z, K.tele.x, K.tele.z);
          K.x = spot.x; K.z = spot.z; K.fl = 0; K.tp++; K.tele = null; K.teleCd = T.cooldown; K.haste = Math.max(K.haste || 0, T.haste);
          this.ev({ k: 'tele-end', id: K.id, x: K.x, z: K.z });
        }
      }
      // sharp ears: running near her gives you away
      for (const s of S.players) if (s.role === 'survivor' && s.st === 'ok' && s.mv === 2 && dist(s, K) < 22) s.reveal = Math.max(s.reveal || 0, 0.6);
    }
    this.updateSpiderMom(dt, Gs);
  }
  // Bat Rush in motion: steered by her aim, through windows and dropped pallets, into the first
  // survivor, or into a wall; fully wound up, it ends in a Ground Slam
  updateRush(K, dt) {
    const S = this.S, M = this.M, D = KILLERS.granny.ability, R = K.dash;
    if (K.stun > 0 || K.carry != null) { K.dash = null; return; }
    R.t += dt;
    // steering: turn toward where she is looking, at a limited rate
    const tr = K.og ? 2.4 : D.turn, want = Math.atan2(R.dx, R.dz) + Math.max(-tr * dt, Math.min(tr * dt, angDiff(Math.atan2(R.dx, R.dz), K.yaw)));
    R.dx = Math.sin(want); R.dz = Math.cos(want);
    const step = D.speed * dt;
    if (!K.fl) {
      // a dropped pallet in the way splinters, and carries her further
      for (const b of M.bars) if (S.bars[b.id] === 1 && Math.hypot(K.x + R.dx * 0.9 - b.x, K.z + R.dz * 0.9 - b.z) < b.half + 0.5) { S.bars[b.id] = 2; R.d += D.palletBonus / D.speed; this.ev({ k: 'break', id: b.id }); this.ev({ k: 'rushsmash', id: K.id, x: b.x, z: b.z }); }
      // a window in the way: straight through it
      for (const w of M.windows) {
        const cross = w.axis === 'x' ? K.x - w.x : K.z - w.z, lat = w.axis === 'x' ? K.z - w.z : K.x - w.x;
        const toward = (w.axis === 'x' ? R.dx : R.dz) * -Math.sign(cross);
        if (Math.abs(cross) < 0.95 && Math.abs(lat) < w.half - 0.15 && toward > 0.45) {
          const side = Math.sign(cross) || 1;
          if (w.axis === 'x') K.x = w.x - side * 0.85; else K.z = w.z - side * 0.85;
          K.tp++; this.ev({ k: 'rushvault', id: K.id, x: w.x, z: w.z });
          break;
        }
      }
    }
    const L = levelOf(M, K.fl), r = moveCircle(L, K.fl ? null : S, K.x, K.z, R.dx * step, R.dz * step, 0.45);
    const moved = Math.hypot(r.x - K.x, r.z - K.z);
    K.x = r.x; K.z = r.z;
    if (M.stairs) levelStep(M, K);
    // the first survivor in her way
    for (const s of S.players) {
      if (s.role !== 'survivor' || s.st !== 'ok' || !levelsMeet(K, s)) continue;
      if (M.stairs && Math.abs(heightAt(M, K) - heightAt(M, s)) > 1.7) continue;
      const dx = s.x - K.x, dz = s.z - K.z, d = Math.hypot(dx, dz);
      if (d < 1.25 && (d < 0.5 || (dx * R.dx + dz * R.dz) / d > 0.2) && !losL(M, K, s, 1.0)) {
        this.damage(s, K, false);
        if (R.full) this.groundSlam(K, s.id);
        K.dash = null; K.atk = 2; K.atkHit = true; K.atkT = RULES.hitCooldown; K.tp++;
        this.ev({ k: 'rushhit', id: K.id, to: s.id, x: s.x, z: s.z });
        return;
      }
    }
    // a wall stops her dead
    if (moved < step * 0.35 && R.t > 0.05) {
      K.dash = null; K.tp++; this.stunKiller(K, D.wallStun, false);
      this.ev({ k: 'rushwall', id: K.id, x: K.x, z: K.z });
      return;
    }
    if (R.t >= R.d) {
      K.dash = null; K.tp++;
      if (R.full) { this.groundSlam(K, null); K.atk = 2; K.atkHit = true; K.atkT = 0.9; }
      else { K.atk = 2; K.atkHit = false; K.atkT = 0.7; }
    }
  }
  // Grandpa's shotgun (god-tier outfit): a hitscan blast. Survivors carry a second health bar
  // against him (shp, 100): the farther the shot, the more it takes, and at 0 they go down.
  shotgun(K, m) {
    const S = this.S, M = this.M, G = KILLERS.granny.shotgun;
    const raised = K.aim && K.abT >= G.raise;
    K.aim = false; K.abT = 0;
    if (!raised || K.abCd > 0 || K.dash || K.stun > 0 || K.act || K.carry != null || K.tele) return;
    const yaw = num(m.yaw, K.yaw), f = fwd(yaw);
    K.yaw = yaw; K.abCd = G.cooldown;
    let best = null, bd = G.range;
    for (const s of S.players) {
      if (s.role !== 'survivor' || s.st !== 'ok' || !levelsMeet(K, s)) continue;
      if (M.stairs && Math.abs(heightAt(M, K) - heightAt(M, s)) > 1.7) continue;
      const dx = s.x - K.x, dz = s.z - K.z, d = Math.hypot(dx, dz);
      if (d > bd || d < 0.01) continue;
      const along = dx * f.x + dz * f.z, side = Math.abs(dx * f.z - dz * f.x);
      // the spread: about half a metre either side, a little wider up close
      if (along <= 0 || side > 0.5 + Math.min(0.5, 1.2 / d)) continue;
      if (losL(M, K, s, 1.1)) continue;
      best = s; bd = d;
    }
    // where the pellets stop (for the tracer): the survivor, or the first wall
    let ex = K.x + f.x * G.range, ez = K.z + f.z * G.range;
    if (best) { ex = best.x; ez = best.z; }
    else for (let t = 0.5; t < G.range; t += 0.5) { if (losL(M, K, { x: K.x + f.x * t, z: K.z + f.z * t, fl: K.fl }, 1.1)) { ex = K.x + f.x * t; ez = K.z + f.z * t; break; } }
    let dmg = 0;
    if (best) {
      const k = Math.max(0, Math.min(1, (bd - G.near) / (G.far - G.near)));
      dmg = Math.round(G.minDmg + (G.maxDmg - G.minDmg) * k);
      best.shp = Math.max(0, (best.shp ?? 100) - dmg);
      best.lastHitBy = K.id; K.score.a += 50 + dmg * 4;
      if (best.shp <= 0) { best.shp = 100; this.damage(best, K, true); }
      else { best.boost = 0.8; best.boostMul = SPEED.hitBoost; best.act = null; best.prog = 0; }
    }
    this.ev({ k: 'shot', id: K.id, x: K.x, z: K.z, ex: +ex.toFixed(2), ez: +ez.toFixed(2), to: best ? best.id : null, dmg, d: best ? +bd.toFixed(1) : 0 });
  }
  // the end of a fully wound-up Bat Rush: the bat comes down on the floor; everyone close is struck,
  // and a generator next to her loses some of its progress
  groundSlam(K, skip) {
    const S = this.S, M = this.M, D = KILLERS.granny.ability, hit = [];
    for (const s of S.players) {
      if (s.id === skip || s.role !== 'survivor' || s.st !== 'ok' || !levelsMeet(K, s)) continue;
      if (M.stairs && Math.abs(heightAt(M, K) - heightAt(M, s)) > 1.7) continue;
      if (Math.hypot(s.x - K.x, s.z - K.z) < D.slamRadius && !losL(M, K, s, 1.0)) { this.damage(s, K, false); hit.push(s.id); }
    }
    if (!K.fl) for (const g of M.gens) { const gs = S.gens[g.id]; if (!gs.done && gs.p > 0 && Math.hypot(g.x - K.x, g.z - K.z) < D.slamRadius + 0.8) { gs.p = Math.max(0, gs.p - D.slamGen); gs.reg = true; this.ev({ k: 'kick', id: g.id }); } }
    this.ev({ k: 'slam', id: K.id, x: K.x, z: K.z, hit });
  }
  // Spider Mom: crawls from generator to generator; anyone she finds repairing one is shown to Granny
  updateSpiderMom(dt, Gs) {
    const S = this.S, M = this.M;
    if (!Gs.length || !M.gens.length) { S.spider = null; return; }
    let sp = S.spider;
    if (!sp) { const g = M.gens[Math.floor(Math.random() * M.gens.length)]; const p0 = this.safeSpot(g.x + 2, g.z, g.x, g.z); sp = S.spider = { x: p0.x, z: p0.z, yaw: 0, st: 0 }; this.spiderPath = null; }
    const P = this.spiderState ||= { path: null, i: 0, goal: -1, wait: 0, seen: {} };
    if (sp.st === 2) { P.wait -= dt; if (P.wait <= 0) sp.st = 0; return; } // screeching
    if (P.wait > 0) { P.wait -= dt; sp.st = 1; return; }                    // sniffing around a generator
    // pick the next generator: one being repaired if she can smell it, otherwise any unfinished one
    if (!P.path || P.i >= P.path.length) {
      const busy = M.gens.filter((g, i) => !S.gens[i].done && S.gens[i].n > 0 && i !== P.goal);
      const open = M.gens.filter((g, i) => !S.gens[i].done && i !== P.goal);
      const pool = busy.length && Math.random() < 0.6 ? busy : open.length ? open : M.gens;
      const g = pool[Math.floor(Math.random() * pool.length)];
      P.goal = g.id; P.path = findPath(M, sp.x, sp.z, g.x + 1.6, g.z, t => t === 1 ? Infinity : 1, 30000) || []; P.i = 0;
      if (!P.path.length) { P.wait = 2; return; }
    }
    // crawl along the path
    let step = 3.4 * dt;
    while (step > 0 && P.i < P.path.length) {
      const c = cellPos(M, P.path[P.i]), dx = c.x - sp.x, dz = c.z - sp.z, d = Math.hypot(dx, dz);
      if (d <= step) { sp.x = c.x; sp.z = c.z; step -= d; P.i++; }
      else { sp.x += dx / d * step; sp.z += dz / d * step; sp.yaw = Math.atan2(dx, dz); step = 0; }
    }
    sp.st = 0;
    if (P.i >= P.path.length) P.wait = 2.5 + Math.random() * 2;
    // anyone repairing a generator within sight is reported
    for (const s of S.players) {
      if (s.role !== 'survivor' || s.st !== 'ok' || !s.act || s.act.k !== 'repair') continue;
      if (Math.hypot(s.x - sp.x, s.z - sp.z) > 14 || losBlocked(M, sp.x, sp.z, s.x, s.z) || S.t - (P.seen[s.id] ?? -99) < 12) continue;
      P.seen[s.id] = S.t; s.reveal = Math.max(s.reveal || 0, 7); s.spied = 7; s.webbed = 3;
      sp.st = 2; P.wait = 1.6; sp.yaw = Math.atan2(s.x - sp.x, s.z - sp.z);
      this.ev({ k: 'spidermom', id: s.id, x: sp.x, z: sp.z });
      break;
    }
  }


  updateSaws(dt) {
    const S = this.S, M = this.M;
    for (const p of S.players) if (p.role === 'killer' && (p.char === 'bateman' || p.char === 'chucky') && p.aim) p.abT += dt;
    for (let i = S.saws.length - 1; i >= 0; i--) {
      const sw = S.saws[i], K = this.P(sw.by);
      sw.t += dt;
      if (!K || K.role !== 'killer' || K.char !== 'bateman') { S.saws.splice(i, 1); continue; }
      if (sw.st === 'ground') {
        // he walks over to pick it back up (or it finds its own way back)
        if (Math.hypot(K.x - sw.x, K.z - sw.z) < 1.6 || sw.t > KILLERS.bateman.ability.back) {
          S.saws.splice(i, 1); K.ammo = 1; K.abCd = KILLERS.bateman.ability.cooldown;
          this.ev({ k: 'sawpickup', id: K.id, x: sw.x, z: sw.z, back: sw.t > KILLERS.bateman.ability.back });
        }
        continue;
      }
      let land = false;
      const steps = 4, h = dt / steps;
      for (let k = 0; k < steps && !land; k++) {
        const px = sw.x, pz = sw.z;
        sw.vy -= 9 * h;
        sw.x += sw.vx * h; sw.z += sw.vz * h; sw.y += sw.vy * h;
        for (const s of S.players) {
          if (s.role !== 'survivor' || s.st !== 'ok') continue;
          if (sw.y < (s.cr ? 1.15 : 1.85) && Math.hypot(sw.x - s.x, sw.z - s.z) < 0.65) {
            this.damage(s, K, true); K.score.b += 400;
            this.ev({ k: 'sawhit', id: s.id, by: K.id, x: s.x, z: s.z });
            land = true; break;
          }
        }
        if (land) break;
        if (sw.y <= 0.15 || Math.hypot(sw.x - K.x, sw.z - K.z) > KILLERS.bateman.ability.range) land = true;
        else if (losBlocked(M, px, pz, sw.x, sw.z, Math.min(1.2, sw.y))) { sw.x = px; sw.z = pz; land = true; }
      }
      if (land) {
        const spot = this.safeSpot(sw.x, sw.z, K.x, K.z);
        Object.assign(sw, { st: 'ground', x: spot.x, z: spot.z, y: 0.12, vx: 0, vy: 0, vz: 0, t: 0 });
        this.ev({ k: 'sawland', id: K.id, x: sw.x, z: sw.z });
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
        const bucket = M.hash.get(Math.floor((sp.x + (M.half || HALF) + 12) / 8) * 1000 + Math.floor((sp.z + (M.half || HALF) + 12) / 8)) || [];
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
    if (this.possession) this.release();
    S.phase = 'end';
    for (const p of S.players) if (p.role === 'survivor' && !p.outcome) p.outcome = p.st === 'out' ? 'escaped' : 'sacrificed';
    const victims = S.players.filter(p => p.role === 'survivor' || p.outcome === 'infected');
    const kills = victims.filter(p => p.outcome !== 'escaped').length;
    const grade = ['Brutal defeat', 'Entity displeased', 'Close call', 'Merciless victory', 'Merciless victory'][Math.min(4, Math.round(kills / Math.max(1, victims.length) * 4))];
    for (const K of S.players) if (K.role === 'killer' && K.outcome !== 'infected') K.outcome = grade;
    this.ev({ k: 'end' });
  }

  // used by bots and the local player to request a vault (validated & echoed as an event)
  canVault(p) { return findSpace(this.M, this.S, p); }
  vaultTime(p, kind, running) { return vaultDuration(p, kind, running); }
}

function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
