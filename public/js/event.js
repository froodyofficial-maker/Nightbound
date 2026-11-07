// The Fortnight event: five days of battle royale on Nightfall Isle.
// Every player's event record (wins, eliminations, matches) sits on the public relay as one small
// retained message, like the weekly awards. When the event ends the first client to look adds them
// up and pins the result, so everyone sees the same champion; the champion's own game pays out.
//   nightbound/v2/ev/<event>/<friend code>  { n, w, k, m }   a player's record
//   nightbound/v2/evres/<event>             { fid, n, w, k } the pinned champion
// Matchmaking rides on the same relay: open lobbies advertise themselves (retained) until they start.
//   nightbound/v3/fnq/<room code>           { code, h, n, at, v, t }
export const FN = {
  id: 'fn1', name: 'Fortnight',
  start: Date.UTC(2026, 10, 7, 12, 0),
  end: Date.UTC(2026, 10, 12, 12, 0), // five days
  prize: 500000,
};
export const fnActive = (t = Date.now()) => t >= FN.start && t < FN.end;
export const fnLeft = (t = Date.now()) => Math.max(0, FN.end - t);
export function fmtLeft(ms) {
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}
const LB = `nightbound/v2/ev/${FN.id}/`, RES = `nightbound/v2/evres/${FN.id}`, Q = 'nightbound/v3/fnq/';
const AD_FRESH = 15000; // a lobby that hasn't refreshed its ad in this long is gone

export class FnEvent {
  constructor(profile, save, friends) {
    this.p = profile; this.save = save; this.f = friends; this.rows = new Map(); this.ads = new Map(); this.handlers = {};
    profile.fn ||= {};
    this.me = profile.fn[FN.id] ||= { w: 0, k: 0, m: 0, best: 0 };
    friends.on('raw', (t, x) => this.onMessage(t, x));
    friends.on('connected', () => { friends.watch(LB + '+'); friends.watch(RES); friends.watch(Q + '+'); this.publish(); this.checkReveal(); });
    setInterval(() => this.checkReveal(), 60000);
  }
  on(k, f) { (this.handlers[k] ||= []).push(f); }
  emit(k, ...a) { for (const f of this.handlers[k] || []) try { f(...a); } catch (e) { console.error(e); } }
  record(me, S) {
    if (!fnActive()) return { w: this.me.w, rank: this.rank() };
    this.me.m++; this.me.k += me.kills || 0;
    if (me.outcome === 'win') this.me.w++;
    if (me.place && (!this.me.best || me.place < this.me.best)) this.me.best = me.place;
    this.save(); this.publish();
    return { w: this.me.w, rank: this.rank() };
  }
  publish() {
    if (!this.f.mq || !this.me.m) return;
    const row = { n: String(this.f.getName() || 'Player').slice(0, 24), w: this.me.w, k: this.me.k, m: this.me.m };
    this.rows.set(this.f.id, { fid: this.f.id, ...row });
    this.f.publish(LB + this.f.id, JSON.stringify(row), true);
    this.emit('board');
  }
  onMessage(topic, text) {
    let m = null; try { m = text ? JSON.parse(text) : null; } catch { return; }
    if (topic.startsWith(LB)) {
      const fid = topic.slice(LB.length).toUpperCase();
      if (m) this.rows.set(fid, { fid, n: String(m.n || 'Player').slice(0, 24), w: Math.max(0, +m.w || 0), k: Math.max(0, +m.k || 0), m: Math.max(0, +m.m || 0) }); else this.rows.delete(fid);
      this.emit('board'); return;
    }
    if (topic === RES) { if (m && m.fid) { this.result = m; if (this.pending) this.pending.result = m; } return; }
    if (topic.startsWith(Q)) {
      const code = topic.slice(Q.length);
      if (m && m.code === code) this.ads.set(code, { ...m, seen: Date.now() }); else this.ads.delete(code);
      this.emit('ads');
    }
  }
  board() {
    const rows = [...this.rows.values()];
    if (this.me.m && !this.rows.has(this.f.id)) rows.push({ fid: this.f.id, n: this.f.getName(), w: this.me.w, k: this.me.k, m: this.me.m });
    return rows.sort((a, b) => b.w - a.w || b.k - a.k || a.m - b.m);
  }
  rank() { const i = this.board().findIndex(r => r.fid === this.f.id); return i >= 0 ? i + 1 : 0; }
  // ---- matchmaking ----
  openLobbies(proto) {
    const now = Date.now();
    return [...this.ads.values()].filter(a => a.v === proto && now - (a.t || 0) < AD_FRESH && a.at - now > 5000).sort((a, b) => b.n - a.n || a.at - b.at);
  }
  advertise(ad) { this.f.publish(Q + ad.code, JSON.stringify({ ...ad, t: Date.now() }), true); }
  unadvertise(code) { if (code) this.f.publish(Q + code, '', true); }
  // ---- the end: find (or settle) the champion, pay them ----
  async checkReveal() {
    if (Date.now() < FN.end || !this.f.mq || this.pending) return;
    const P = this.p.fn;
    if (P.done && P.done[FN.id]) return;
    this.pending = { result: this.result || null };
    this.f.watch(RES); this.f.watch(LB + '+');
    await new Promise(r => setTimeout(r, 7000));
    const pend = this.pending; this.pending = null;
    let res = pend.result && pend.result.fid ? pend.result : null;
    if (!res) {
      const top = this.board().filter(r => r.w > 0)[0];
      res = top ? { fid: top.fid, n: top.n, w: top.w, k: top.k } : { none: true };
      this.f.publish(RES, JSON.stringify(res), true);
    }
    (P.done ||= {})[FN.id] = { ...res, at: Date.now() };
    const mine = !!res.fid && res.fid === this.f.id;
    if (mine) this.p.stats.embers += FN.prize;
    this.save();
    this.emit('reveal', res, mine);
  }
}
