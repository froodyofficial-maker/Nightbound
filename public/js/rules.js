// Rules shared by host simulation, client prediction and bots.
import { SPEED, RULES, KILLERS, HALF } from './config.js';
import { barBox } from './map.js';

export const has = (p, perk) => p.perks && p.perks.includes(perk);
export const fwd = yaw => ({ x: Math.sin(yaw), z: Math.cos(yaw) });
export const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

export function killerOf(S) { return S.players.find(p => p.role === 'killer'); }
export function survivorsOf(S) { return S.players.filter(p => p.role === 'survivor'); }
export function playerById(S, id) { return S.players.find(p => p.id === id); }

export function terrorRadius(p) {
  if (!p || p.role !== 'killer') return 0;
  if (p.char === 'wisp' && p.ab === 1) return 0;
  if (p.char === 'foreman' && p.ab === 1) return 0;
  let r = KILLERS[p.char].terror;
  if (has(p, 'dread')) r += 8;
  if (has(p, 'stalker')) r -= 14;
  return Math.max(6, r);
}

// Max movement speed given the synced state + local intent (sprint/crouch).
export function speedOf(p, S, sprint, crouch) {
  if (p.act || p.stun > 0 || p.vault || p.tele || p.reel || p.pull) return 0;
  if (p.role === 'survivor') {
    if (p.st === 'down') {
      // can't crawl away while being picked up or helped up
      if (S && S.players.some(o => o.act && (o.act.k === 'pickup' || o.act.k === 'heal') && o.act.id === p.id)) return 0;
      return SPEED.crawl * (has(p, 'resolve') ? 1.3 : 1);
    }
    if (p.st !== 'ok') return 0;
    let s = crouch ? SPEED.crouch * (has(p, 'hushed') ? 1.25 : 1) : sprint ? SPEED.run : SPEED.walk;
    if (!crouch && sprint && p.hp === 1 && has(p, 'fleet')) s *= 1.07;
    if (p.boost > 0) s *= p.boostMul || SPEED.hitBoost;
    return s;
  }
  const K = KILLERS[p.char];
  let s = K.speed;
  if (p.carry != null) s = SPEED.carry;
  if (S.gatesPowered && has(p, 'fury')) s *= 1.08;
  if (p.atk === 1) s *= RULES.lungeMul;
  else if (p.atk === 2) s *= p.atkHit ? 0.22 : 0.5;
  if (p.char === 'butcher' && p.ab === 1) s = 8.6;
  if (p.char === 'wisp') { if (p.ab === 1) s *= 1.15; else if (p.ab === 2 || p.ab === 3) s *= 0.4; }
  if ((p.char === 'harrower' || p.char === 'foreman') && p.aim) s *= p.char === 'foreman' ? 0.75 : SPEED.aimSlow;
  if (p.diffMul) s *= p.diffMul;
  return s;
}

// What can this player interact with (hold E)?
export function findInteraction(M, S, p) {
  if (p.role === 'survivor') {
    if (p.st !== 'ok' || p.vault) return null;
    let best = null, bp = -1, bd = 1e9;
    const consider = (k, id, label, prio, d) => { if (prio > bp || (prio === bp && d < bd)) { best = { k, id, label }; bp = prio; bd = d; } };
    for (const c of M.cages) {
      const who = S.cages[c.id];
      if (who != null) { const d = dist(p, c); if (d < 1.9) consider('rescue', c.id, 'Free ' + playerById(S, who).name, 5, d); }
    }
    for (const o of S.players) {
      if (o === p || o.role !== 'survivor') continue;
      const d = dist(p, o);
      if (d > 1.7) continue;
      if (o.st === 'down') consider('heal', o.id, 'Help up ' + o.name, 4, d);
      else if (o.st === 'ok' && o.hp === 1 && !o.vault) consider('heal', o.id, 'Heal ' + o.name, 2, d);
    }
    if (S.gatesPowered) for (const g of M.gates) {
      const gs = S.gates[g.id];
      if (!gs.open && Math.hypot(p.x - g.sx, p.z - g.sz) < 1.5) consider('gate', g.id, 'Open exit gate', 3, 0);
    }
    for (const g of M.gens) {
      const gs = S.gens[g.id];
      const d = dist(p, g);
      if (!gs.done && d < 1.75) consider('repair', g.id, 'Repair generator', 3, d);
    }
    for (const L of S.lanterns || []) { const d = Math.hypot(p.x - L.x, p.z - L.z); if (d < 1.5) consider('snuff', L.id, 'Snuff the lantern', 1, d); }
    if (!best && p.hp === 1 && has(p, 'medic')) return { k: 'self', id: p.id, label: 'Heal yourself' };
    return best;
  }
  // killer
  if (p.stun > 0 || p.atk || p.vault || p.tele || (p.char === 'butcher' && p.ab === 1)) return null;
  if (p.carry != null) {
    let best = null, bd = 2.4;
    for (const c of M.cages) if (S.cages[c.id] == null && !S.cageBroken[c.id]) { const d = dist(p, c); if (d < bd) { bd = d; best = { k: 'cage', id: c.id, label: 'Lock in cage' }; } }
    return best;
  }
  let best = null, bd = 1e9;
  for (const o of S.players) if (o.role === 'survivor' && o.st === 'down') { const d = dist(p, o); if (d < 1.9 && d < bd) { bd = d; best = { k: 'pickup', id: o.id, label: 'Pick up ' + o.name }; } }
  if (best) return best;
  for (const b of M.bars) if (S.bars[b.id] === 1) { const bb = barBox(b); const d = Math.hypot(Math.max(0, Math.abs(p.x - bb.x) - bb.hx), Math.max(0, Math.abs(p.z - bb.z) - bb.hz)); if (d < 1.2 && d < bd) { bd = d; best = { k: 'break', id: b.id, label: 'Break barricade' }; } }
  if (best) return best;
  for (const g of M.gens) { const gs = S.gens[g.id]; const d = dist(p, g); if (!gs.done && !gs.reg && gs.p > 0 && d < 1.9 && d < bd) { bd = d; best = { k: 'kick', id: g.id, label: 'Damage generator' }; } }
  return best;
}

// Executions: a killer can finish a downed survivor who has already been caged twice,
// the last survivor standing, or anyone with the Death Warrant perk.
export function canExecuteTarget(S, k, s) {
  if (s.role !== 'survivor' || s.st !== 'down') return false;
  if (has(k, 'warrant') || s.stage >= 2) return true;
  const alive = S.players.filter(o => o.role === 'survivor' && ['ok', 'down', 'carried', 'caged', 'exec'].includes(o.st));
  return alive.length === 1;
}
export function findExecute(M, S, p) {
  if (p.role !== 'killer' || p.act || p.stun > 0 || p.atk || p.vault || p.tele || p.carry != null) return null;
  if ((p.char === 'butcher' && p.ab === 1) || (p.char === 'wisp' && p.ab !== 0)) return null;
  let best = null, bd = 2.0;
  for (const o of S.players) if (canExecuteTarget(S, p, o)) { const d = dist(p, o); if (d < bd) { bd = d; best = { id: o.id, label: 'Execute ' + o.name }; } }
  return best;
}

export function actionTime(k, p, S) {
  switch (k) {
    case 'pickup': return RULES.pickupTime;
    case 'execute': return RULES.execTime;
    case 'snuff': return RULES.snuffTime;
    case 'cage': return RULES.cageTime;
    case 'kick': return RULES.kickTime * (has(p, 'brute') ? 0.65 : 1);
    case 'break': return RULES.breakTime * (has(p, 'brute') ? 0.65 : 1);
    case 'rescue': { const k = S && killerOf(S); return RULES.rescueTime * (has(p, 'lockpick') ? 0.5 : 1) * (k && has(k, 'rust') ? 2 : 1); }
    case 'gate': return RULES.gateTime * (has(p, 'lockpick') ? 0.7 : 1);
    default: return 0;
  }
}

// Space bar context: barricade drop (survivor) or vault. Returns {k:'drop'|'vault', ...}
export function findSpace(M, S, p) {
  if (p.act || p.vault || p.stun > 0) return null;
  if (p.role === 'survivor' && p.st !== 'ok') return null;
  if (p.role === 'killer' && (p.atk || p.ab === 1 && p.char === 'butcher')) return null;
  const f = fwd(p.yaw);
  if (p.role === 'survivor') {
    for (const b of M.bars) {
      if (S.bars[b.id] !== 0) continue;
      const along = b.axis === 'x' ? p.z - b.z : p.x - b.x, cross = b.axis === 'x' ? p.x - b.x : p.z - b.z;
      if (Math.abs(along) < b.half + 0.15 && Math.abs(cross) < 1.25) return { k: 'drop', id: b.id };
    }
  }
  let best = null, bd = 1e9;
  const tryV = (o, kind, half) => {
    const cross = o.axis === 'x' ? p.x - o.x : p.z - o.z, lat = o.axis === 'x' ? p.z - o.z : p.x - o.x;
    if (Math.abs(lat) > half - 0.1 || Math.abs(cross) > 1.35 || Math.abs(cross) < 0.05) return;
    // must face roughly toward the obstacle
    const facing = (o.axis === 'x' ? f.x : f.z) * -Math.sign(cross);
    if (facing < 0.2) return;
    const d = Math.abs(cross);
    if (d < bd) {
      bd = d;
      const side = Math.sign(cross), ex = 0.75;
      const lx = Math.max(-half + 0.35, Math.min(half - 0.35, lat));
      best = {
        k: 'vault', kind, id: o.id,
        x1: o.axis === 'x' ? o.x - side * ex : o.x + lx,
        z1: o.axis === 'x' ? o.z + lx : o.z - side * ex,
        x0: o.axis === 'x' ? o.x + side * Math.max(0.55, d) : o.x + lx,
        z0: o.axis === 'x' ? o.z + lx : o.z + side * Math.max(0.55, d),
      };
    }
  };
  for (const w of M.windows) tryV(w, 'win', w.half);
  if (p.role === 'survivor') for (const b of M.bars) if (S.bars[b.id] === 1) tryV(b, 'bar', b.half);
  return best;
}

export function vaultDuration(p, kind, running) {
  if (p.role === 'killer') return 1.7;
  let d = running ? 0.62 : 1.15;
  if (kind === 'bar') d = running ? 0.7 : 1.2;
  if (has(p, 'acrobat')) d *= 0.7;
  return d;
}

export function inExit(M, p) {
  for (const g of M.gates) if ((p.z - g.z) * g.dir > 2.2 && Math.abs(p.x - g.x) < 2.6) return g.id;
  return -1;
}

export function gensNeeded(S) { return S.gensNeeded; }
export { HALF };
