// Weekly awards: Best Survivor and Best Killer of the whole player base. Every player's stats for
// the week sit on the public relay (retained, one small message per player); when the week ends,
// the first client to look adds them up and pins the result, so everyone sees the same winners.
// Each winner gets 100,000 Embers (one player can take both titles).
//   nightbound/v2/lb/w<week>/<friend code>  { n, se, sp, kk, kp }   a player's week
//   nightbound/v2/awards/w<week>                { s, k }               the pinned result
export const AWARD = { first: Date.UTC(2026, 10, 5, 18, 0), period: 7 * 864e5, prize: 100000 };
export const weekOf = t => Math.max(0, Math.floor((t - AWARD.first) / AWARD.period) + 1); // week 0 ends at the first reveal
export const revealOf = w => AWARD.first + w * AWARD.period;
const LB = w => `nightbound/v2/lb/w${w}/`, RES = w => `nightbound/v2/awards/w${w}`;

// best of a set of player weeks
export function pick(rows) {
  const best = (score, tie) => rows.filter(r => score(r) > 0).sort((a, b) => score(b) - score(a) || tie(b) - tie(a))[0] || null;
  const s = best(r => r.se || 0, r => r.sp || 0), k = best(r => r.kk || 0, r => r.kp || 0);
  return { s: s && { fid: s.fid, n: s.n, se: s.se, sp: Math.round(s.sp || 0) }, k: k && { fid: k.fid, n: k.n, kk: k.kk, kp: Math.round(k.kp || 0) } };
}

export class Awards {
  constructor(profile, save, friends) {
    this.p = profile; this.save = save; this.f = friends; this.live = new Map(); this.handlers = {};
    profile.awards ||= {};
    this.ensureWeek();
    friends.on('raw', (topic, text) => this.onMessage(topic, text));
    friends.on('connected', () => { this.watchLive(); this.publish(); this.checkReveal(); });
    setInterval(() => this.checkReveal(), 60000);
  }
  on(k, f) { (this.handlers[k] ||= []).push(f); }
  emit(k, ...a) { for (const f of this.handlers[k] || []) try { f(...a); } catch (e) { console.error(e); } }
  // this week's tally (the very first week also counts everything played before awards existed)
  ensureWeek() {
    const w = weekOf(Date.now()), W = this.p.week;
    if (!W || W.w !== w) {
      if (W && W.w < w) this.p.lastWeek = W; // still published until its reveal is settled
      const seed = w === 0 && !W ? { se: this.p.stats.escapes || 0, kk: this.p.stats.kills || 0 } : {};
      this.p.week = { w, se: seed.se || 0, sp: 0, kk: seed.kk || 0, kp: 0, ms: 0, mk: 0 };
      this.save();
    }
    return this.p.week;
  }
  record(me, S) {
    const W = this.ensureWeek(), tot = me.score.a + me.score.b + me.score.c + me.score.d;
    if (me.role === 'survivor') { W.ms++; W.sp += tot; if (me.outcome === 'escaped') W.se++; }
    else { W.mk++; W.kp += tot; W.kk += S.players.filter(p => p.role === 'survivor' && p.outcome !== 'escaped').length; }
    this.save(); this.publish();
  }
  publish() {
    const W = this.ensureWeek(), name = this.f.getName();
    if (!this.f.mq || !(W.se || W.kk || W.ms || W.mk)) return;
    this.f.publish(LB(W.w) + this.f.id, JSON.stringify({ n: name, se: W.se, sp: Math.round(W.sp), kk: W.kk, kp: Math.round(W.kp) }), true);
  }
  watchLive() { const w = weekOf(Date.now()); if (this.liveW === w) return; this.liveW = w; this.live.clear(); this.f.watch(LB(w) + '+'); }
  onMessage(topic, text) {
    let m = null; try { m = text ? JSON.parse(text) : null; } catch { return; }
    const lb = topic.match(/^nightbound\/v2\/lb\/w(\d+)\/([A-Z0-9]+)$/i);
    if (lb) {
      const w = +lb[1], fid = lb[2].toUpperCase(), row = m && { fid, n: String(m.n || 'Player').slice(0, 24), se: +m.se || 0, sp: +m.sp || 0, kk: +m.kk || 0, kp: +m.kp || 0 };
      if (w === this.liveW) { if (row) this.live.set(fid, row); else this.live.delete(fid); this.emit('live'); }
      if (this.pending && this.pending.w === w && row) this.pending.rows.set(fid, row);
      return;
    }
    const res = topic.match(/^nightbound\/v2\/awards\/w(\d+)$/);
    if (res && m && this.pending && this.pending.w === +res[1]) this.pending.result = m;
  }
  top(n = 3) { const rows = [...this.live.values()]; return { s: rows.filter(r => r.se > 0).sort((a, b) => b.se - a.se || b.sp - a.sp).slice(0, n), k: rows.filter(r => r.kk > 0).sort((a, b) => b.kk - a.kk || b.kp - a.kp).slice(0, n) }; }
  // a week has ended: read (or settle) its winners, pay out, announce
  async checkReveal() {
    if (!this.f.mq || this.pending) return;
    this.watchLive();
    const now = weekOf(Date.now()), w = now - 1;
    if (w < 0 || this.p.awards[w]) return;
    this.pending = { w, rows: new Map(), result: null };
    this.f.watch(RES(w)); this.f.watch(LB(w) + '+');
    await new Promise(r => setTimeout(r, 7000));
    const P = this.pending; this.pending = null;
    let result = P.result && (P.result.s || P.result.k) ? P.result : null;
    if (!result) {
      const rows = [...P.rows.values()];
      result = pick(rows);
      if (!result.s && !result.k) result.none = true;
      this.f.publish(RES(w), JSON.stringify(result), true); // pin it for everyone else
    }
    const mine = { s: !!(result.s && result.s.fid === this.f.id), k: !!(result.k && result.k.fid === this.f.id) };
    const prize = (mine.s ? AWARD.prize : 0) + (mine.k ? AWARD.prize : 0);
    this.p.awards[w] = { ...result, mine, prize, at: Date.now() };
    if (prize) this.p.stats.embers += prize;
    this.save();
    this.emit('reveal', w, this.p.awards[w]);
  }
}
