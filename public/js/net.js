// Networking. All transports expose the same small API to the game.
//  - "relay": WebSocket to the bundled Node server (node server.js): LAN or any hosted server.
//  - "online": no server of your own needed.
//      Everyone first meets on an MQTT-over-WebSocket relay (public brokers): joining takes a second
//      and works on almost any network. Over that same relay the two ends then set up a direct
//      WebRTC link themselves (no third-party signalling server to fail) and switch to it, usually
//      within a couple of seconds. If the direct link ever drops, play carries on over the relay;
//      if the relay drops, it reconnects by itself.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MQTT_BROKERS = (typeof window !== 'undefined' && window.__nbMqtt) || [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];
const ICE = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'turn:eu-0.turn.peerjs.com:3478', username: 'peerjs', credential: 'peerjsp' },
  { urls: 'turn:us-0.turn.peerjs.com:3478', username: 'peerjs', credential: 'peerjsp' },
  { urls: 'turn:eu-0.turn.peerjs.com:443?transport=tcp', username: 'peerjs', credential: 'peerjsp' },
  { urls: 'turn:us-0.turn.peerjs.com:443?transport=tcp', username: 'peerjs', credential: 'peerjsp' },
  { urls: 'stun:stun.relay.metered.ca:80' },
  { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp', 'turns:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
];
const FAST_MAX_BUFFER = 64 * 1024; // skip a state update rather than queue latency behind it
const rtcOK = () => typeof RTCPeerConnection !== 'undefined' && !(typeof window !== 'undefined' && window.__nbNoRTC);

function wsURL() { return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'; }
const rid = n => { let s = ''; for (let i = 0; i < n; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return s; };
const timeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
const parse = t => { try { return JSON.parse(t); } catch { return null; } };

export async function relayAvailable(ms = 1500) {
  if (location.protocol === 'file:') return false;
  return new Promise(res => {
    let done = false, ws;
    try { ws = new WebSocket(wsURL()); } catch { res(false); return; }
    const fin = v => { if (done) return; done = true; try { ws.close(); } catch {} res(v); };
    ws.onopen = () => fin(true); ws.onerror = () => fin(false);
    setTimeout(() => fin(false), ms);
  });
}

class Emitter {
  constructor() { this.h = {}; }
  on(k, f) { (this.h[k] ||= []).push(f); return this; }
  emit(k, ...a) { for (const f of this.h[k] || []) try { f(...a); } catch (e) { console.error(e); } }
}

// ---------------- minimal MQTT 3.1.1 client over WebSocket ----------------
const enc = new TextEncoder(), dec = new TextDecoder();
function mqttStr(s) { const b = enc.encode(s); return [b.length >> 8, b.length & 255, ...b]; }
function mqttLen(n) { const out = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; out.push(d); } while (n > 0); return out; }
export class Mqtt extends Emitter {
  constructor(url) { super(); this.url = url; this.buf = new Uint8Array(0); this.pid = 1; this.ok = false; }
  connect(ms = 6000) {
    return timeout(new Promise((res, rej) => {
      const ws = this.ws = new WebSocket(this.url, ['mqtt']);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        const body = [...mqttStr('MQTT'), 4, 0x02, 0, 60, ...mqttStr('nb' + rid(10))];
        ws.send(new Uint8Array([0x10, ...mqttLen(body.length), ...body]));
      };
      ws.onerror = () => rej(new Error('Relay unreachable'));
      ws.onclose = () => { const was = this.ok; this.ok = false; clearInterval(this.ping); if (was) this.emit('closed'); else rej(new Error('Relay closed the connection')); };
      ws.onmessage = e => this.data(new Uint8Array(e.data), res, rej);
    }), ms, 'Relay timed out');
  }
  data(chunk, res, rej) {
    const b = new Uint8Array(this.buf.length + chunk.length); b.set(this.buf); b.set(chunk, this.buf.length); this.buf = b;
    for (;;) {
      if (this.buf.length < 2) return;
      let len = 0, mul = 1, i = 1, byte;
      do { if (i >= this.buf.length) return; byte = this.buf[i++]; len += (byte & 127) * mul; mul *= 128; } while (byte & 128);
      if (this.buf.length < i + len) return;
      const type = this.buf[0] >> 4, body = this.buf.subarray(i, i + len);
      this.buf = this.buf.slice(i + len);
      if (type === 2) { // CONNACK
        if (body[1] === 0) { this.ok = true; this.ping = setInterval(() => this.raw([0xc0, 0]), 25000); res && res(this); }
        else rej && rej(new Error('Relay refused the connection'));
      } else if (type === 3) { // PUBLISH (QoS 0)
        const tl = (body[0] << 8) | body[1];
        const topic = dec.decode(body.subarray(2, 2 + tl));
        this.emit('message', topic, dec.decode(body.subarray(2 + tl)));
      }
    }
  }
  raw(bytes) { if (this.ws && this.ws.readyState === 1) this.ws.send(new Uint8Array(bytes)); }
  subscribe(topic) { const id = this.pid++; const body = [id >> 8, id & 255, ...mqttStr(topic), 0]; this.raw([0x82, ...mqttLen(body.length), ...body]); }
  publish(topic, str, fast) {
    if (!this.ws || this.ws.readyState !== 1) return;
    if (fast && this.ws.bufferedAmount > FAST_MAX_BUFFER) return;
    const t = mqttStr(topic), p = enc.encode(str);
    const head = [0x30, ...mqttLen(t.length + p.length), ...t];
    const out = new Uint8Array(head.length + p.length); out.set(head); out.set(p, head.length);
    this.ws.send(out);
  }
  close() { try { this.raw([0xe0, 0]); this.ws.close(); } catch {} }
}

// ---------------- the relay connection: reconnects and resubscribes by itself ----------------
// 'down' / 'up' while it recovers; 'closed' only if it can't get back within 30s.
class Relay extends Emitter {
  constructor(index) { super(); this.index = index; this.subs = new Set(); this.alive = true; this.m = null; this.backoff = 400; }
  async open() { this.m = await this.make(); return this; }
  async make() {
    const m = new Mqtt(MQTT_BROKERS[this.index]); await m.connect();
    m.on('message', (t, x) => this.emit('message', t, x));
    m.on('closed', () => { if (this.alive && this.m === m) { this.m = null; this.retry(); } });
    for (const t of this.subs) m.subscribe(t);
    return m;
  }
  async retry() {
    const since = Date.now(); this.emit('down');
    while (this.alive) {
      await new Promise(r => setTimeout(r, this.backoff)); this.backoff = Math.min(4000, this.backoff * 1.6);
      if (!this.alive) return;
      try { this.m = await this.make(); this.backoff = 400; this.emit('up'); return; } catch {}
      if (Date.now() - since > 30000) { this.alive = false; this.emit('closed'); return; }
    }
  }
  get up() { return !!this.m; }
  subscribe(t) { this.subs.add(t); if (this.m) this.m.subscribe(t); }
  publish(t, s, fast) { if (this.m) this.m.publish(t, s, fast); }
  close() { this.alive = false; try { this.m && this.m.close(); } catch {} this.m = null; }
}
async function openRelay(preferred) {
  const order = preferred != null ? [preferred, ...MQTT_BROKERS.keys()].filter((v, i, a) => a.indexOf(v) === i) : [...MQTT_BROKERS.keys()];
  let lastErr;
  for (const i of order) {
    if (!MQTT_BROKERS[i]) continue;
    try { return await new Relay(i).open(); } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('No relay reachable');
}
const topicBase = code => 'nightbound/v3/' + code + '/';

// ---------------- the direct link: one RTCPeerConnection, two channels ----------------
// 'rel': reliable and ordered (lobby, events, chat). 'fast': unordered, never retransmitted
// (snapshots, positions): a lost update is simply replaced by the next one, so one dropped packet
// never stalls the rest (head-of-line blocking is what made online matches freeze, then jump).
function makeLink(signal, onMsg) {
  const pc = new RTCPeerConnection({ iceServers: ICE, iceCandidatePoolSize: 2 });
  const rel = pc.createDataChannel('rel', { negotiated: true, id: 1, ordered: true });
  const fast = pc.createDataChannel('fast', { negotiated: true, id: 2, ordered: false, maxRetransmits: 0 });
  const L = new Emitter(); Object.assign(L, { pc, rel, fast, open: false, q: [] });
  const recv = e => { const d = parse(e.data); if (d) onMsg(d); };
  rel.onmessage = recv; fast.onmessage = recv;
  pc.onicecandidate = e => { if (e.candidate) signal({ ice: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
  rel.onopen = () => { L.open = true; L.emit('open'); };
  let gone = false;
  const down = () => { if (gone) return; gone = true; L.open = false; try { pc.close(); } catch {} L.emit('down'); };
  rel.onclose = down;
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') down(); };
  L.send = (str, isFast) => {
    if (!L.open) return false;
    if (isFast) { if (fast.readyState === 'open') { if (fast.bufferedAmount < FAST_MAX_BUFFER) try { fast.send(str); } catch { return false; } return true; } }
    if (rel.readyState !== 'open') return false;
    if (isFast && rel.bufferedAmount > FAST_MAX_BUFFER) return true; // backed up: drop this state update
    try { rel.send(str); } catch { return false; }
    return true;
  };
  L.addIce = async c => { if (L.q) L.q.push(c); else try { await pc.addIceCandidate(c); } catch {} };
  L.flushIce = async () => { const q = L.q || []; L.q = null; for (const c of q) try { await pc.addIceCandidate(c); } catch {} };
  L.close = down;
  return L;
}

// ---------------- HOST ----------------
export async function hostRoom(mode) {
  const H = new Emitter();
  if (mode === 'relay') {
    const ws = new WebSocket(wsURL());
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('Could not reach the game server')); });
    ws.send(JSON.stringify({ op: 'host' }));
    H.code = await timeout(new Promise((res, rej) => {
      ws.onmessage = e => { const m = JSON.parse(e.data); if (m.op === 'hosted') res(m.code); else if (m.op === 'error') rej(new Error(m.msg)); };
    }), 5000, 'Server did not respond');
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.op === 'peer-join') H.emit('join', m.id);
      else if (m.op === 'peer-leave') H.emit('leave', m.id);
      else if (m.op === 'data') H.emit('msg', m.from, m.d);
    };
    ws.onclose = () => H.emit('closed', 'Connection to the server was lost');
    H.send = (to, d, fast) => {
      if (ws.readyState !== 1 || (fast && ws.bufferedAmount > FAST_MAX_BUFFER)) return;
      ws.send(JSON.stringify(fast ? { op: 'data', to, d, f: 1 } : { op: 'data', to, d }));
    };
    H.broadcast = (d, fast) => H.send('*', d, fast);
    H.close = () => { try { ws.close(); } catch {} };
    H.mode = 'relay'; H.label = 'game server';
    return H;
  }

  // "online": everyone joins over the relay, then moves to a direct link
  const mq = await openRelay().catch(() => null);
  if (!mq) throw new Error('Could not open an online room. Check your internet connection (or run node server.js for LAN play).');
  const code = rid(4) + CODE_CHARS[24 + mq.index]; // the last character tells joiners which relay broker the host is on
  const base = topicBase(code);
  H.code = code;
  const route = new Map(); // player id -> 'mq' | 'rtc'
  const links = new Map(); // player id -> direct link
  const seen = new Map();  // player id -> last time we heard from them on the relay
  mq.subscribe(base + 'h'); mq.subscribe(base + 'sig/h');
  const dropLink = id => { const L = links.get(id); if (L) { links.delete(id); L.close(); } };
  const toRelay = id => { if (route.get(id) === 'rtc') route.set(id, 'mq'); seen.set(id, Date.now()); };
  const signalTo = f => d => mq.publish(base + 'sig/c/' + f, JSON.stringify(d));
  async function onSignal(m) {
    if (!m || typeof m.f !== 'string' || !rtcOK()) return;
    const id = 'mq:' + m.f;
    if (!route.has(id)) return; // only players who joined through the relay
    if (m.sdp && m.sdp.type === 'offer') {
      dropLink(id);
      const L = makeLink(signalTo(m.f), d => { if (links.get(id) === L && d.t !== 'net-hello') H.emit('msg', id, d); });
      links.set(id, L);
      L.on('open', () => { if (links.get(id) === L && route.has(id)) { route.set(id, 'rtc'); L.send(JSON.stringify({ t: 'net-upgraded' })); } });
      L.on('down', () => { if (links.get(id) === L) { links.delete(id); toRelay(id); } });
      try {
        await L.pc.setRemoteDescription(m.sdp); await L.flushIce();
        await L.pc.setLocalDescription(await L.pc.createAnswer());
        signalTo(m.f)({ sdp: L.pc.localDescription.toJSON ? L.pc.localDescription.toJSON() : L.pc.localDescription });
      } catch (e) { console.warn('direct link setup failed', e); dropLink(id); }
    } else if (m.ice) { const L = links.get(id); if (L) L.addIce(m.ice); }
  }
  mq.on('message', (topic, text) => {
    const m = parse(text); if (!m) return;
    if (topic === base + 'sig/h') { onSignal(m); return; }
    if (topic !== base + 'h' || typeof m.f !== 'string') return;
    const id = 'mq:' + m.f;
    if (m.op === 'join') {
      mq.publish(base + 'c/' + m.f, JSON.stringify({ op: 'welcome' })); // (again, if our first welcome was lost)
      if (!route.has(id)) { route.set(id, 'mq'); seen.set(id, Date.now()); H.emit('join', id); }
      return;
    }
    if (m.op === 'leave') { dropLink(id); if (route.delete(id)) { seen.delete(id); H.emit('leave', id); } return; }
    if (!route.has(id)) return;
    seen.set(id, Date.now());
    if (m.op === 'd' && route.get(id) === 'mq' && m.d && m.d.t !== 'ping-relay') H.emit('msg', id, m.d);
  });
  // players heard from nowhere for 15s are gone (a live direct link counts as hearing from them)
  H.timer = setInterval(() => {
    const now = Date.now();
    for (const [id, r] of route) {
      if (r === 'rtc' && links.get(id) && links.get(id).open) { seen.set(id, now); continue; }
      if (now - (seen.get(id) || 0) > 15000) { dropLink(id); route.delete(id); seen.delete(id); H.emit('leave', id); }
    }
  }, 3000);
  mq.on('closed', () => { if (![...links.values()].some(L => L.open)) H.emit('closed', 'Lost the connection to the online relay'); });
  // fast = true: high-frequency state that may be dropped (newer data follows right behind)
  let mqLast = 0;
  const viaRelay = (id, d, str, isFast) => mq.publish(base + 'c/' + id.slice(3), str ? '{"op":"d","d":' + str + '}' : JSON.stringify({ op: 'd', d }), isFast);
  H.send = (to, d, isFast) => {
    if (to === '*') { H.broadcast(d, isFast); return; }
    if (!route.has(to)) return;
    const L = links.get(to), str = JSON.stringify(d);
    if (route.get(to) === 'rtc' && L && L.send(str, isFast)) return;
    viaRelay(to, d, str, isFast);
  };
  H.broadcast = (d, isFast) => {
    const str = JSON.stringify(d);
    let relayNeeded = false;
    for (const [id, r] of route) {
      const L = links.get(id);
      if (r === 'rtc' && L && L.send(str, isFast)) continue;
      relayNeeded = true;
    }
    if (!relayNeeded) return;
    // the public relay adds latency per message and may throttle: cap state updates at ~15/s
    const now = performance.now();
    if (isFast && now - mqLast < 60 && !(d.s && d.s.kf)) return;
    if (isFast) mqLast = now;
    mq.publish(base + 'all', str, isFast);
  };
  H.close = () => { clearInterval(H.timer); for (const id of [...links.keys()]) dropLink(id); mq.close(); };
  H.mode = 'online';
  Object.defineProperty(H, 'label', { get: () => { const n = [...route.values()]; const d = n.filter(r => r === 'rtc').length; return n.length ? (d === n.length ? 'direct (WebRTC)' : d ? 'direct + relay' : 'relay') : 'direct (WebRTC) + relay'; } });
  return H;
}

// ---------------- CLIENT ----------------
export async function joinRoom(mode, code) {
  code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const C = new Emitter();
  if (mode === 'relay') {
    const ws = new WebSocket(wsURL());
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('Could not reach the game server')); });
    ws.send(JSON.stringify({ op: 'join', code }));
    C.id = await timeout(new Promise((res, rej) => {
      ws.onmessage = e => { const m = JSON.parse(e.data); if (m.op === 'joined') res(m.id); else if (m.op === 'error') rej(new Error(m.msg)); };
    }), 5000, 'Server did not respond');
    let closed = false;
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.op === 'data') C.emit('msg', m.d);
      else if (m.op === 'host-left' && !closed) { closed = true; C.emit('closed', 'The host left the game'); }
    };
    ws.onclose = () => { if (!closed) { closed = true; C.emit('closed', 'Disconnected from the server'); } };
    C.send = (d, fast) => {
      if (ws.readyState !== 1 || (fast && ws.bufferedAmount > FAST_MAX_BUFFER)) return;
      ws.send(JSON.stringify(fast ? { op: 'data', d, f: 1 } : { op: 'data', d }));
    };
    C.close = () => { closed = true; try { ws.close(); } catch {} };
    C.mode = 'relay';
    return C;
  }
  if (code.length !== 5) throw new Error('Room codes are 5 letters.');
  const bi = CODE_CHARS.indexOf(code[4]) - 24;
  const mq = await openRelay(bi >= 0 && bi < MQTT_BROKERS.length ? bi : 0).catch(() => { throw new Error('Could not reach the online relay. Check your internet connection.'); });
  const me = rid(10), base = topicBase(code);
  mq.subscribe(base + 'c/' + me); mq.subscribe(base + 'all'); mq.subscribe(base + 'sig/c/' + me);
  let link = null, closed = false;
  const direct = () => !!(link && link.open);
  const welcomed = new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('Room not found (or the host is offline)')), 9000);
    mq.on('message', (topic, text) => { if (topic === base + 'c/' + me && (parse(text) || {}).op === 'welcome') { clearTimeout(t); res(); } });
  });
  // send the join request until the host answers (subscriptions may take a moment)
  const hello = () => mq.publish(base + 'h', JSON.stringify({ op: 'join', f: me }));
  hello(); const iv = setInterval(hello, 1000);
  try { await welcomed; } catch (e) { clearInterval(iv); mq.close(); throw e; } finally { clearInterval(iv); }
  const finish = why => { if (closed) return; closed = true; clearInterval(keep); try { link && link.close(); } catch {} mq.close(); C.emit('closed', why); };
  mq.on('message', (topic, text) => {
    if (topic === base + 'sig/c/' + me) { onSignal(parse(text)); return; }
    if (direct()) return; // the direct link is carrying everything
    const m = parse(text); if (!m) return;
    if (topic === base + 'all') C.emit('msg', m);
    else if (topic === base + 'c/' + me && m.op === 'd') C.emit('msg', m.d);
  });
  // tell the host we're still here (also while on the direct link: the relay is our fallback)
  const keep = setInterval(() => mq.publish(base + 'h', JSON.stringify({ op: 'd', f: me, d: { t: 'ping-relay' } })), 4000);
  mq.on('closed', () => { if (!direct()) finish('Lost the connection to the online relay'); });
  C.id = 'mq:' + me; C.mqId = me; C.mode = 'online';
  Object.defineProperty(C, 'label', { get: () => direct() ? 'direct (WebRTC)' : 'relay' });
  let last = 0;
  C.send = (d, fast) => {
    const str = JSON.stringify(d);
    if (direct() && link.send(str, fast)) return;
    if (fast) { const now = performance.now(); if (now - last < 60) return; last = now; }
    mq.publish(base + 'h', '{"op":"d","f":"' + me + '","d":' + str + '}', fast);
  };
  C.close = () => { if (closed) return; closed = true; clearInterval(keep); mq.publish(base + 'h', JSON.stringify({ op: 'leave', f: me })); try { link && link.close(); } catch {} setTimeout(() => mq.close(), 150); };

  // the direct link: set up over the relay; retried if it fails or drops
  let tries = 0;
  async function onSignal(m) {
    if (!m || !link) return;
    if (m.sdp && m.sdp.type === 'answer') { try { await link.pc.setRemoteDescription(m.sdp); await link.flushIce(); } catch (e) { console.warn(e); } }
    else if (m.ice) link.addIce(m.ice);
  }
  function tryDirect() {
    if (closed || !rtcOK() || direct()) return;
    tries++;
    const L = link = makeLink(d => mq.publish(base + 'sig/h', JSON.stringify({ f: me, ...d })), d => { if (link === L && d.t !== 'net-upgraded') C.emit('msg', d); });
    const giveUp = setTimeout(() => { if (link === L && !L.open) { L.close(); } }, 12000);
    L.on('open', () => { clearTimeout(giveUp); tries = 0; C.why = ''; C.emit('upgraded'); });
    L.on('down', () => {
      clearTimeout(giveUp);
      if (link !== L) return;
      link = null;
      if (!closed && !mq.up) { finish('Lost the connection to the host'); return; }
      if (!closed && tries < 8) setTimeout(tryDirect, Math.min(20000, 2000 * tries));
    });
    (async () => {
      try { await L.pc.setLocalDescription(await L.pc.createOffer()); mq.publish(base + 'sig/h', JSON.stringify({ f: me, sdp: L.pc.localDescription.toJSON ? L.pc.localDescription.toJSON() : L.pc.localDescription })); }
      catch (e) { console.warn('direct link offer failed', e); L.close(); }
    })();
  }
  tryDirect();
  C._dropDirect = () => { if (link) link.close(); }; // (tests: cut the direct link)
  // a short wait for the direct link, so most players start the lobby already on it
  if (rtcOK()) await Promise.race([new Promise(r => C.on('upgraded', r)), new Promise(r => setTimeout(r, 3000))]);
  return C;
}
