// Friends: friend codes, requests, online presence and lobby invites, carried over the same public
// MQTT relays the online mode uses (no server of our own).
//   nightbound/v2/u/<id>/st          retained presence: { name, t, state, code }
//   nightbound/v2/u/<id>/req/<from>  retained friend request (cleared when answered)
//   nightbound/v2/u/<id>/acc/<from>  retained acceptance (cleared once seen)
//   nightbound/v2/u/<id>/inv         live lobby invites
//   nightbound/v2/u/<id>/msg         live chat messages from friends
//   nightbound/v2/u/<id>/gift/<gid>  retained Ember gifts (delivered even while offline, cleared once received)
import { Mqtt, MQTT_BROKERS } from './net.js';

const CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const T = id => 'nightbound/v2/u/' + id.toLowerCase();
const enc = new TextEncoder();
const str = s => { const b = enc.encode(s); return [b.length >> 8, b.length & 255, ...b]; };
const len = n => { const o = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; o.push(d); } while (n > 0); return o; };
export const fmtCode = c => (c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.+)$/, '$1-$2');
export const cleanCode = c => (c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const ONLINE_MS = 45000;
export const GIFT_MAX = 50000;

export class Friends {
  constructor(profile, save, getName) {
    this.p = profile; this.save = save; this.getName = getName;
    profile.fid ||= Array.from({ length: 8 }, () => CH[Math.floor(Math.random() * CH.length)]).join('');
    profile.friends ||= []; profile.outgoing ||= []; profile.giftsGot ||= {};
    this.requests = new Map(); // from id -> name
    this.chats = new Map();    // friend id -> [{ me, text, t }]
    this.unread = new Map();   // friend id -> count
    this.status = new Map();   // friend id -> { name, t, state, code }
    this.handlers = {}; this.mq = null; this.state = { state: 'menu', code: null };
  }
  get id() { return this.p.fid; }
  on(k, f) { (this.handlers[k] ||= []).push(f); }
  emit(k, ...a) { for (const f of this.handlers[k] || []) try { f(...a); } catch (e) { console.error(e); } }
  online(id) { const s = this.status.get(id); return !!s && Date.now() - s.t < ONLINE_MS && s.state !== 'offline'; }
  onlineCount() { return this.p.friends.filter(f => this.online(f.id)).length; }

  async connect() {
    if (this.mq || this.connecting) return;
    this.connecting = true;
    for (const url of MQTT_BROKERS) {
      try { const m = new Mqtt(url); await m.connect(6000); this.mq = m; break; } catch {}
    }
    this.connecting = false;
    if (!this.mq) { this.emit('change'); setTimeout(() => this.connect(), 8000); return; }
    const me = T(this.id);
    this.mq.on('message', (topic, text) => this.onMessage(topic, text));
    this.mq.on('closed', () => { this.mq = null; clearInterval(this.beat); setTimeout(() => this.connect(), 5000); this.emit('change'); });
    for (const t of [me + '/req/+', me + '/acc/+', me + '/inv', me + '/msg', me + '/gift/+']) this.mq.subscribe(t);
    for (const f of this.p.friends) this.mq.subscribe(T(f.id) + '/st');
    for (const t of this.extra || []) this.mq.subscribe(t);
    this.heartbeat(); clearInterval(this.beat); this.beat = setInterval(() => this.heartbeat(), 15000);
    this.ticker ||= setInterval(() => this.emit('change'), 10000);
    addEventListener('beforeunload', () => this.publish(T(this.id) + '/st', JSON.stringify({ name: this.getName(), t: Date.now(), state: 'offline' }), true));
    this.emit('change'); this.emit('connected');
  }
  // other modules (weekly awards) listen on extra topics through this connection
  watch(topic) { (this.extra ||= new Set()).add(topic); if (this.mq) this.mq.subscribe(topic); }
  // publish with an optional MQTT "retain" flag (Mqtt.publish has no retain option)
  publish(topic, text, retain) {
    if (!this.mq || !this.mq.ws || this.mq.ws.readyState !== 1) return;
    const t = str(topic), p = enc.encode(text), head = [retain ? 0x31 : 0x30, ...len(t.length + p.length), ...t];
    const out = new Uint8Array(head.length + p.length); out.set(head); out.set(p, head.length); this.mq.ws.send(out);
  }
  setState(state, code = null) { this.state = { state, code }; this.heartbeat(); }
  heartbeat() { const s = this.stateFn ? this.stateFn() : this.state; this.publish(T(this.id) + '/st', JSON.stringify({ name: this.getName(), t: Date.now(), state: s.state, code: s.code || null }), true); }

  onMessage(topic, text) {
    const me = T(this.id);
    if (!topic.startsWith('nightbound/v2/u/')) { this.emit('raw', topic, text); return; }
    const from = topic.split('/').pop().toUpperCase();
    let m = null; if (text) try { m = JSON.parse(text); } catch { return; }
    if (topic.startsWith(me + '/req/')) {
      if (!m) { this.requests.delete(from); this.emit('change'); return; }
      if (this.p.friends.some(f => f.id === from)) { this.accept(from); return; } // already friends: just confirm
      this.requests.set(from, String(m.name || 'Someone').slice(0, 24)); this.emit('change'); this.emit('request', from, m.name);
    } else if (topic.startsWith(me + '/acc/')) {
      if (!m) return;
      this.addLocal(from, m.name);
      this.p.outgoing = this.p.outgoing.filter(x => x.id !== from); this.save();
      this.publish(me + '/acc/' + from, '', true);
      this.emit('accepted', from, m.name);
    } else if (topic.startsWith(me + '/gift/')) {
      // an Ember gift: count it once, then clear it from the relay
      const gid = topic.split('/').pop();
      if (!m) return;
      this.publish(topic, '', true);
      if (this.p.giftsGot[gid] || !m.from || !this.p.friends.some(f => f.id === m.from)) return;
      const amount = Math.max(1, Math.min(GIFT_MAX, Math.floor(+m.amount || 0)));
      this.p.giftsGot[gid] = Date.now(); this.save();
      this.log(m.from, { me: false, text: `🎁 sent you ${amount.toLocaleString()} Embers`, t: Date.now() });
      this.emit('gift', m.from, String(m.name || 'A friend').slice(0, 24), amount);
    } else if (topic === me + '/inv') {
      if (m && m.from && m.code && this.p.friends.some(f => f.id === m.from)) this.emit('invite', m.from, m.name, m.code);
    } else if (topic === me + '/msg') {
      if (!m || !m.from || !this.p.friends.some(f => f.id === m.from)) return;
      this.log(m.from, { me: false, text: String(m.text || '').slice(0, 300), t: Date.now() });
      this.unread.set(m.from, (this.unread.get(m.from) || 0) + 1);
      this.emit('chat', m.from, m.name, m.text); this.emit('change');
    } else if (topic.endsWith('/st')) {
      const id = topic.split('/')[3].toUpperCase();
      if (m) { this.status.set(id, m); const f = this.p.friends.find(x => x.id === id); if (f && m.name && f.name !== m.name) { f.name = String(m.name).slice(0, 24); this.save(); } }
      this.emit('change');
    }
  }
  addLocal(id, name) {
    if (!this.p.friends.some(f => f.id === id)) { this.p.friends.push({ id, name: String(name || 'Friend').slice(0, 24) }); this.save(); }
    if (this.mq) this.mq.subscribe(T(id) + '/st');
    this.emit('change');
  }
  request(code) {
    const id = cleanCode(code);
    if (id.length !== 8) return 'Friend codes are 8 characters, like ABCD-2345.';
    if (id === this.id) return 'That is your own code.';
    if (this.p.friends.some(f => f.id === id)) return 'You are already friends.';
    if (!this.mq) return 'Not connected to the online relay yet. Try again in a moment.';
    this.publish(T(id) + '/req/' + this.id, JSON.stringify({ name: this.getName(), t: Date.now() }), true);
    if (!this.p.outgoing.some(x => x.id === id)) this.p.outgoing.push({ id, t: Date.now() });
    this.save(); this.emit('change');
    return '';
  }
  accept(id) {
    const name = this.requests.get(id) || (this.p.friends.find(f => f.id === id) || {}).name;
    this.addLocal(id, name);
    this.publish(T(id) + '/acc/' + this.id, JSON.stringify({ name: this.getName() }), true);
    this.publish(T(this.id) + '/req/' + id, '', true);
    this.requests.delete(id); this.emit('change');
  }
  decline(id) { this.publish(T(this.id) + '/req/' + id, '', true); this.requests.delete(id); this.emit('change'); }
  cancel(id) { this.publish(T(id) + '/req/' + this.id, '', true); this.p.outgoing = this.p.outgoing.filter(x => x.id !== id); this.save(); this.emit('change'); }
  remove(id) { this.p.friends = this.p.friends.filter(f => f.id !== id); this.save(); this.emit('change'); }
  log(id, msg) { const l = this.chats.get(id) || []; l.push(msg); while (l.length > 60) l.shift(); this.chats.set(id, l); }
  say(id, text) {
    text = String(text || '').trim().slice(0, 300); if (!text) return false;
    if (!this.mq) return false;
    this.publish(T(id) + '/msg', JSON.stringify({ from: this.id, name: this.getName(), text }));
    this.log(id, { me: true, text, t: Date.now() }); this.emit('change'); return true;
  }
  // send Embers: the caller takes them off this profile; the gift waits on the relay until they're online
  gift(id, amount) {
    amount = Math.floor(+amount || 0);
    if (!this.mq) return 'Not connected to the online relay yet. Try again in a moment.';
    if (!this.p.friends.some(f => f.id === id)) return 'You can only gift Embers to friends.';
    if (amount < 1 || amount > GIFT_MAX) return `Gifts are 1 to ${GIFT_MAX.toLocaleString()} Embers.`;
    const gid = this.id + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    this.publish(T(id) + '/gift/' + gid, JSON.stringify({ from: this.id, name: this.getName(), amount, t: Date.now() }), true);
    this.log(id, { me: true, text: `🎁 gifted ${amount.toLocaleString()} Embers`, t: Date.now() }); this.emit('change');
    return '';
  }
  invite(id, code) { this.publish(T(id) + '/inv', JSON.stringify({ from: this.id, name: this.getName(), code })); }
}
