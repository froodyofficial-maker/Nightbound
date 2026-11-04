// Character movement: used for the local player (on any machine) and for bots (on the host).
import { moveCircle, levelOf, levelStep, spiralClamp } from './map.js';
import { speedOf, fwd, angDiff } from './rules.js';
import { HALF } from './config.js';

export function startVault(p, v, dur) {
  p.vault = { x0: p.x, z0: p.z, x1: v.x1, z1: v.z1, t: 0, d: dur, kind: v.kind, id: v.id };
  // survivors (third person) and bots turn toward the vault; a first-person killer keeps their view
  if (p.role === 'survivor' || p.bot) p.yaw = Math.atan2(v.x1 - p.x, v.z1 - p.z);
}

// intent: { mx, mz (world-space desired direction, |m|<=1), sprint, crouch }
export function stepMover(M, S, p, intent, dt) {
  if (p.vault) {
    const v = p.vault;
    v.t += dt;
    const f = Math.min(1, v.t / v.d);
    p.x = v.x0 + (v.x1 - v.x0) * f;
    p.z = v.z0 + (v.z1 - v.z0) * f;
    p.mv = 3;
    if (f >= 1) p.vault = null;
    return;
  }
  if (p.role === 'survivor' && p.st !== 'ok' && p.st !== 'down' && p.st !== 'ghost') { p.mv = 0; return; }
  // Chucky's jump: half a second in the air, clearing anything low
  let low = 0;
  if (p.hop) { p.hop.t += dt; low = 1.25; if (p.hop.t >= p.hop.d) p.hop = null; }
  const sp = speedOf(p, S, intent.sprint, intent.crouch && p.role === 'survivor');
  let mx = intent.mx, mz = intent.mz;
  if (p.role === 'killer' && p.char === 'butcher' && p.ab === 1) { const f = fwd(p.yaw); mx = f.x; mz = f.z; }
  let mag = Math.hypot(mx, mz);
  if (mag > 1) { mx /= mag; mz /= mag; mag = 1; }
  const r = p.role === 'killer' ? 0.45 : 0.36;
  const dx = mx * sp * dt, dz = mz * sp * dt;
  // Slimer's Ghost Phase: float straight through walls (still kept inside the map)
  const res = p.phase > 0 ? { x: Math.max(-(M.half || HALF) + 0.6, Math.min((M.half || HALF) - 0.6, p.x + dx * 1.1)), z: Math.max(-(M.half || HALF) + 0.6, Math.min((M.half || HALF) - 0.6, p.z + dz * 1.1)) } : moveCircle(levelOf(M, p.fl), p.fl ? null : S, p.x, p.z, dx, dz, r, low);
  // soft body-blocking between characters
  for (const o of S.players) {
    if (o === p || o.vault || p.st === 'ghost' || o.st === 'ghost' || (o.fl || 0) !== (p.fl || 0)) continue;
    if (o.role === 'survivor' && o.st !== 'ok' && o.st !== 'down') continue;
    if (p.role === 'survivor' && o.role === 'survivor') continue;
    const ox = res.x - o.x, oz = res.z - o.z, d = Math.hypot(ox, oz), min = r + 0.34;
    if (d < min && d > 1e-4) { res.x = o.x + ox / d * min; res.z = o.z + oz / d * min; }
  }
  if (p.role === 'killer') { // the killer can't walk out through the exit gates
    res.z = Math.max(-(M.half || HALF) + 0.4, Math.min((M.half || HALF) - 0.4, res.z));
  }
  const moved = Math.hypot(res.x - p.x, res.z - p.z);
  if (M.stairs && p.phase > 0) p.fl = 0; // phasing through the house drops you to the ground
  p.bump = sp > 6 && dt > 0 && moved < sp * dt * 0.3;
  const ox = p.x, oz = p.z;
  p.x = res.x; p.z = res.z;
  if (M.stairs) { if ((p.fl || 0) >= 10) spiralClamp(M, p, ox, oz); levelStep(M, p); }
  const v = dt > 0 ? moved / dt : 0;
  p.mv = v > 3.0 ? 2 : v > 0.25 ? 1 : 0;
  p.cr = intent.crouch && p.role === 'survivor' ? 1 : 0;
  if (p.role === 'survivor' && mag > 0.1) {
    const target = Math.atan2(mx, mz);
    p.yaw += angDiff(p.yaw, target) * (1 - Math.exp(-dt * 12));
  }
}
