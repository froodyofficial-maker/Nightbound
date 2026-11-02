// Character movement: used for the local player (on any machine) and for bots (on the host).
import { moveCircle } from './map.js';
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
  if (p.role === 'survivor' && p.st !== 'ok' && p.st !== 'down') { p.mv = 0; return; }
  const sp = speedOf(p, S, intent.sprint, intent.crouch && p.role === 'survivor');
  let mx = intent.mx, mz = intent.mz;
  if (p.role === 'killer' && p.char === 'butcher' && p.ab === 1) { const f = fwd(p.yaw); mx = f.x; mz = f.z; }
  let mag = Math.hypot(mx, mz);
  if (mag > 1) { mx /= mag; mz /= mag; mag = 1; }
  const r = p.role === 'killer' ? 0.45 : 0.36;
  const dx = mx * sp * dt, dz = mz * sp * dt;
  const res = moveCircle(M, S, p.x, p.z, dx, dz, r);
  // soft body-blocking between characters
  for (const o of S.players) {
    if (o === p || o.vault) continue;
    if (o.role === 'survivor' && o.st !== 'ok' && o.st !== 'down') continue;
    if (p.role === 'survivor' && o.role === 'survivor') continue;
    const ox = res.x - o.x, oz = res.z - o.z, d = Math.hypot(ox, oz), min = r + 0.34;
    if (d < min && d > 1e-4) { res.x = o.x + ox / d * min; res.z = o.z + oz / d * min; }
  }
  if (p.role === 'killer') { // the killer can't walk out through the exit gates
    res.z = Math.max(-HALF + 0.4, Math.min(HALF - 0.4, res.z));
  }
  const moved = Math.hypot(res.x - p.x, res.z - p.z);
  p.bump = sp > 6 && dt > 0 && moved < sp * dt * 0.3;
  p.x = res.x; p.z = res.z;
  const v = dt > 0 ? moved / dt : 0;
  p.mv = v > 3.0 ? 2 : v > 0.25 ? 1 : 0;
  p.cr = intent.crouch && p.role === 'survivor' ? 1 : 0;
  if (p.role === 'survivor' && mag > 0.1) {
    const target = Math.atan2(mx, mz);
    p.yaw += angDiff(p.yaw, target) * (1 - Math.exp(-dt * 12));
  }
}
