// Player progression: XP and level, a rank per role (survivor / killer) earned through match
// results, and the season pass. Everything lives in the local profile (localStorage).

// ---------- level ----------
export const xpToNext = lvl => 500 + lvl * 75;
export function levelOf(xp) {
  let lvl = 1, left = xp;
  while (left >= xpToNext(lvl) && lvl < 999) { left -= xpToNext(lvl); lvl++; }
  return { lvl, into: left, need: xpToNext(lvl) };
}

// ---------- ranks: 5 tiers x 4 grades, 4 pips per grade ----------
export const TIERS = [
  { id: 'ash', name: 'Ash', color: '#8a8580' },
  { id: 'bronze', name: 'Bronze', color: '#b07a4a' },
  { id: 'silver', name: 'Silver', color: '#c8ccd2' },
  { id: 'gold', name: 'Gold', color: '#e0b84a' },
  { id: 'iri', name: 'Iridescent', color: '#d070ff' },
];
export const PIPS_PER_GRADE = 4;
export const MAX_PIPS = TIERS.length * 4 * PIPS_PER_GRADE - 1;
const ROMAN = ['IV', 'III', 'II', 'I'];
export function rankOf(pips) {
  pips = Math.max(0, Math.min(MAX_PIPS, pips | 0));
  const g = Math.floor(pips / PIPS_PER_GRADE), tier = TIERS[Math.floor(g / 4)];
  return { pips, tier, grade: ROMAN[g % 4], name: `${tier.name} ${ROMAN[g % 4]}`, into: pips % PIPS_PER_GRADE, top: pips >= MAX_PIPS };
}
// pips from one match, by how well you did (-1 .. +2)
export function pipsFor(S, me) {
  const tot = me.score.a + me.score.b + me.score.c + me.score.d;
  if (me.role === 'survivor') {
    let p = me.outcome === 'escaped' ? 1 : 0;
    if (tot >= 6000) p++; else if (tot < 2000 && me.outcome !== 'escaped') p--;
    return Math.max(-1, Math.min(2, p));
  }
  const surv = S.players.filter(p => p.role === 'survivor'), killed = surv.filter(p => p.outcome !== 'escaped').length;
  const frac = surv.length ? killed / surv.length : 0;
  return frac >= 1 ? 2 : frac >= 0.74 ? 1 : frac >= 0.5 ? 0 : -1;
}

// ---------- season pass ----------
export const SEASON = {
  id: 's1', name: 'Season 1: The Long Night', start: Date.UTC(2026, 10, 1), days: 60, tierXp: 1200,
  // reward per tier (1-based). Embers on most, bigger bundles every 5th, a badge at 15 and 30
  tiers: Array.from({ length: 30 }, (_, i) => {
    const t = i + 1;
    if (t === 15) return { t, kind: 'badge', id: 's1-mid', label: 'Long Night badge' };
    if (t === 30) return { t, kind: 'badge', id: 's1-final', label: 'Dawn Survivor badge + 5,000 Embers', embers: 5000 };
    return { t, kind: 'embers', embers: t % 5 === 0 ? 1500 : 300 + Math.floor(t / 3) * 50, label: '' };
  }),
};
SEASON.tiers.forEach(r => { if (r.kind === 'embers') r.label = `${r.embers.toLocaleString()} Embers`; });
export const seasonEnds = () => SEASON.start + SEASON.days * 864e5;
export const seasonTier = xp => Math.min(SEASON.tiers.length, Math.floor(xp / SEASON.tierXp));

// ---------- applying a match ----------
// returns a summary for the results screen
export function applyMatch(profile, S, me) {
  const P = profile.prog ||= { xp: 0, ranks: { survivor: 0, killer: 0 }, season: { id: SEASON.id, xp: 0, claimed: {} }, badges: {} };
  if (!P.season || P.season.id !== SEASON.id) P.season = { id: SEASON.id, xp: 0, claimed: {} };
  const tot = me.score.a + me.score.b + me.score.c + me.score.d;
  const win = me.role === 'survivor' ? me.outcome === 'escaped' : S.players.filter(p => p.role === 'survivor' && p.outcome !== 'escaped').length >= 3;
  const xp = Math.round(150 + (me.role === 'killer' ? tot / 40 : tot / 10) + (win ? 200 : 0));
  const before = levelOf(P.xp).lvl, rankBefore = rankOf(P.ranks[me.role] || 0);
  P.xp += xp;
  if (Date.now() < seasonEnds()) P.season.xp += xp;
  const dp = pipsFor(S, me);
  P.ranks[me.role] = Math.max(0, Math.min(MAX_PIPS, (P.ranks[me.role] || 0) + dp));
  const after = levelOf(P.xp).lvl, rankAfter = rankOf(P.ranks[me.role]);
  return { xp, levelUp: after > before ? after : 0, level: after, pips: dp, rank: rankAfter, rankChanged: rankAfter.name !== rankBefore.name, role: me.role };
}

// small SVG rank emblem: a diamond in the tier colour with the grade
export function rankBadge(r, size = 34) {
  return `<svg class="rank-badge" width="${size}" height="${size}" viewBox="0 0 40 40" aria-label="${r.name}"><path d="M20 2 L38 20 L20 38 L2 20 Z" fill="#100c0c" stroke="${r.tier.color}" stroke-width="3"/><path d="M20 9 L31 20 L20 31 L9 20 Z" fill="${r.tier.color}" opacity=".35"/><text x="20" y="24.5" text-anchor="middle" font-size="11" font-family="Bebas Neue, Impact, sans-serif" fill="#fff">${r.grade}</text></svg>`;
}
