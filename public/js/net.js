// Networking. All transports expose the same small API to the game.
//  - "relay": WebSocket to the bundled Node server (node server.js): LAN or any hosted server.
//  - "online": no server of your own needed. The host listens on BOTH
//      * WebRTC (PeerJS broker + STUN/TURN), a direct, low-latency connection, and
//      * an MQTT-over-WebSocket relay through public brokers, which works on almost any network.
//    Joining players try WebRTC first and fall back to the relay automatically.
const PEER_PREFIX = 'nightbound-v2-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MQTT_BROKERS = (typeof window !== 'undefined' && window.__nbMqtt) || [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];
const ICE = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'turn:eu-0.turn.peerjs.com:3478', username: 'peerjs', credential: 'peerjsp' },
  { urls: 'turn:us-0.turn.peerjs.com:3478', username: 'peerjs', credential: 'peerjsp' },
  { urls: 'turn:eu-0.turn.peerjs.com:443?transport=tcp', username: 'peerjs', credential: 'peerjsp' },
  { urls: 'turn:us-0.turn.peerjs.com:443?transport=tcp', username: 'peerjs', credential: 'peerjsp' },
  // Open Relay (public TURN): UDP 80, TCP 443 and TLS 443, for networks that block everything else
  { urls: 'stun:stun.relay.metered.ca:80' },
  { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp', 'turns:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
];
const peerOpts = () => Object.assign({ debug: 0, config: { iceServers: ICE } }, (typeof window !== 'undefined' && window.__nbPeerServer) || {});

function wsURL() { return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'; }
const rid = n => { let s = ''; for (let i = 0; i < n; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return s; };
const timeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);

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

let peerLib = null;
async function loadPeer() {
  if (peerLib) return peerLib;
  if (window.Peer) return (peerLib = window.Peer);
  for (const src of ['vendor/peerjs.min.js', 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js']) {
    try {
      await new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
      if (window.Peer) return (peerLib = window.Peer);
    } catch {}
  }
  throw new Error('WebRTC library unavailable');
}

// Second WebRTC data channel for high-frequency state (snapshots, positions): unordered and
// never retransmitted. On the default reliable+ordered channel one lost packet stalls every
// later message until it is resent (head-of-line blocking), which is what made online matches
// freeze and then jump. A lost snapshot here is simply replaced by the next one.
// "negotiated" channels need no extra signalling: both ends open id FAST_ID on the same connection.
const FAST_ID = 42;
const FAST_MAX_BUFFER = 64 * 1024; // skip a state update rather than queue latency behind it
function openFast(conn, onMsg) {
  try {
    const pc = conn.peerConnection;
    if (!pc || !pc.createDataChannel) return null;
    const ch = pc.createDataChannel('nb-fast', { negotiated: true, id: FAST_ID, ordered: false, maxRetransmits: 0 });
    // `heard`: the other end has this channel too (an older host doesn't; clients wait for it)
    ch.heard = false;
    ch.onmessage = e => { ch.heard = true; let m; try { m = JSON.parse(e.data); } catch { return; } onMsg(m); };
    ch.onerror = () => {};
    return ch;
  } catch (e) { console.warn('Fast channel unavailable', e); return null; }
}
// returns true when the message went out (or was deliberately dropped because the link is backed up)
function sendFast(ch, str, needHeard) {
  if (!ch || ch.readyState !== 'open' || (needHeard && !ch.heard)) return false;
  if (ch.bufferedAmount < FAST_MAX_BUFFER) { try { ch.send(str); } catch { return false; } }
  return true;
}
// reliable PeerJS connection: drop state updates while it is backed up instead of piling them up
function relBacked(conn) {
  const dc = conn.dataChannel;
  return (dc && dc.bufferedAmount > FAST_MAX_BUFFER) || (conn.bufferSize || 0) > 8;
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
async function connectAnyBroker(preferred) {
  const order = preferred != null ? [preferred, ...MQTT_BROKERS.keys()].filter((v, i, a) => a.indexOf(v) === i) : [...MQTT_BROKERS.keys()];
  let lastErr;
  for (const i of order) {
    if (!MQTT_BROKERS[i]) continue;
    try { const m = new Mqtt(MQTT_BROKERS[i]); await m.connect(); m.index = i; return m; } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('No relay reachable');
}
const topicBase = code => 'nightbound/v2/' + code + '/';

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

  // "online": WebRTC + MQTT relay, at the same time
  const route = new Map(); // peerId -> 'rtc' | 'mq'
  const conns = new Map();
  const fast = new Map();  // peerId -> unreliable RTCDataChannel
  let mq = null, peer = null;
  try { mq = await connectAnyBroker(); } catch (e) { console.warn('MQTT relay unavailable', e); }
  // the last code character tells joiners which relay broker the host is on
  const code = rid(4) + (mq ? CODE_CHARS[24 + mq.index] : CODE_CHARS[31]);
  H.code = code;
  try {
    const Peer = await loadPeer();
    peer = new Peer(PEER_PREFIX + code, peerOpts());
    await timeout(new Promise((res, rej) => { peer.on('open', res); peer.on('error', rej); }), 8000, 'WebRTC broker timed out');
    peer.on('connection', conn => {
      // a player already in through the relay who has now managed a direct link keeps their id
      const mig = conn.metadata && typeof conn.metadata.mq === 'string' ? 'mq:' + conn.metadata.mq : null;
      const id = mig || conn.peer;
      conn.on('open', () => {
        if (mig) { if (route.get(id) !== 'mq') { try { conn.close(); } catch {} return; } }
        else if (route.get(id) === 'mq') return;
        conns.set(id, conn); route.set(id, 'rtc');
        const ch = openFast(conn, m => { if (conns.get(id) === conn) H.emit('msg', id, m); });
        if (ch) fast.set(id, ch);
        if (!mig) H.emit('join', id);
        else conn.send({ t: 'net-upgraded' });
      });
      conn.on('data', d => { if (conns.get(id) === conn) H.emit('msg', id, d); });
      conn.on('close', () => {
        if (conns.get(id) !== conn) return;
        conns.delete(id);
        const ch = fast.get(id); fast.delete(id); try { ch && ch.close(); } catch {}
        if (route.get(id) === 'rtc') { route.delete(id); H.emit('leave', id); }
      });
      conn.on('error', () => {});
    });
    peer.on('disconnected', () => { try { peer.reconnect(); } catch {} });
    peer.on('error', () => {});
  } catch (e) { console.warn('WebRTC hosting unavailable', e); try { peer && peer.destroy(); } catch {} peer = null; }
  if (!mq && !peer) throw new Error('Could not open an online room. Check your internet connection (or run node server.js for LAN play).');

  if (mq) {
    const base = topicBase(code), seen = new Map();
    mq.subscribe(base + 'h');
    mq.on('message', (topic, text) => {
      if (topic !== base + 'h') return;
      let m; try { m = JSON.parse(text); } catch { return; }
      const id = 'mq:' + m.f;
      if (m.op === 'join') { if (!route.has(id)) { route.set(id, 'mq'); seen.set(id, Date.now()); mq.publish(base + 'c/' + m.f, JSON.stringify({ op: 'welcome' })); H.emit('join', id); } return; }
      if (m.op === 'leave') { if (route.delete(id)) H.emit('leave', id); return; }
      if (route.get(id) !== 'mq') return;
      seen.set(id, Date.now());
      if (m.op === 'd') H.emit('msg', id, m.d);
    });
    H.mqTimer = setInterval(() => { const now = Date.now(); for (const [id, t] of seen) if (now - t > 15000 && route.get(id) === 'mq') { seen.delete(id); route.delete(id); H.emit('leave', id); } }, 3000);
    mq.on('closed', () => H.emit('closed', 'Lost the connection to the online relay'));
  }
  // fast = true: high-frequency state that may be dropped (newer data follows right behind)
  const rtcSend = (id, c, d, str, isFast) => {
    if (!c || !c.open) return;
    if (isFast) {
      if (sendFast(fast.get(id), str || (str = JSON.stringify(d)))) return;
      if (relBacked(c)) return;
    }
    c.send(d);
  };
  H.send = (to, d, isFast) => {
    if (to === '*') { H.broadcast(d, isFast); return; }
    if (route.get(to) === 'rtc') rtcSend(to, conns.get(to), d, null, isFast);
    else if (route.get(to) === 'mq' && mq) mq.publish(topicBase(code) + 'c/' + to.slice(3), JSON.stringify({ op: 'd', d }), isFast);
  };
  let mqLast = 0;
  H.broadcast = (d, isFast) => {
    const str = isFast ? JSON.stringify(d) : null;
    for (const [id, c] of conns) rtcSend(id, c, d, str, isFast);
    if (mq && [...route.values()].includes('mq')) {
      // the public relay adds latency per message and may throttle: cap state updates at ~15/s
      const now = performance.now();
      if (isFast && now - mqLast < 60 && !(d.s && d.s.kf)) return;
      if (isFast) mqLast = now;
      mq.publish(topicBase(code) + 'all', str || JSON.stringify(d), isFast);
    }
  };
  H.close = () => { clearInterval(H.mqTimer); for (const ch of fast.values()) try { ch.close(); } catch {} try { peer && peer.destroy(); } catch {} try { mq && mq.close(); } catch {} };
  H.mode = 'online'; H.label = (peer ? 'direct (WebRTC)' : '') + (peer && mq ? ' + ' : '') + (mq ? 'relay' : '');
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
  // 1) try a direct WebRTC connection
  // (a direct or TURN-relayed WebRTC link is far quicker than the MQTT relay: give it time)
  try { return await timeout(joinRTC(code, C), 15000, 'WebRTC timed out'); }
  catch (e) { console.warn('WebRTC join failed, using relay:', e.message); C.whyErr = e; try { C.peer && C.peer.destroy(); } catch {} }
  // 2) fall back to the MQTT relay, and keep trying for a direct link in the background
  const why = C.why = String((C.whyErr && C.whyErr.message) || 'WebRTC failed');
  const R = await joinMQ(code, new Emitter());
  R.why = why;
  upgradeLater(code, R);
  return R;
}

// A player on the relay keeps trying to reach the host directly (networks often allow it on a
// second try, once a TURN server answers). On success every message switches over, the player keeps
// their id and the relay is dropped without a goodbye.
function upgradeLater(code, C) {
  let tries = 0, stop = false;
  const prevClose = C.close;
  C.close = () => { stop = true; prevClose(); };
  const attempt = async () => {
    if (stop || C.mode !== 'online' || !C.mqId) return;
    tries++;
    let peer = null;
    try {
      const Peer = await loadPeer();
      peer = new Peer(peerOpts());
      await timeout(new Promise((res, rej) => { peer.on('open', res); peer.on('error', e => rej(new Error('P2P: ' + (e.type || e)))); }), 10000, 'broker timeout');
      const conn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json', metadata: { mq: C.mqId } });
      await timeout(new Promise((res, rej) => { conn.on('open', res); peer.on('error', e => rej(new Error('P2P: ' + (e.type || e)))); }), 20000, 'ICE timeout');
      // the host confirms it moved us over
      await timeout(new Promise(res => conn.on('data', d => { if (d && d.t === 'net-upgraded') res(); })), 5000, 'host did not confirm');
      if (stop) { peer.destroy(); return; }
      const ch = openFast(conn, m => C.emit('msg', m));
      conn.on('data', d => { if (!(d && d.t === 'net-upgraded')) C.emit('msg', d); });
      let closed = false;
      conn.on('close', () => { if (!closed) { closed = true; C.emit('closed', 'The host left the game'); } });
      C.dropRelay && C.dropRelay();
      C.send = (d, fast) => {
        if (!conn.open) return;
        if (fast) { if (sendFast(ch, JSON.stringify(d), true)) return; if (relBacked(conn)) return; }
        conn.send(d);
      };
      C.close = () => { closed = true; stop = true; try { ch && ch.close(); } catch {} try { peer.destroy(); } catch {} };
      C.label = 'direct (WebRTC)'; C.why = '';
      C.emit('upgraded');
    } catch (e) {
      try { peer && peer.destroy(); } catch {}
      if (!stop && tries < 6) setTimeout(attempt, 8000 + tries * 4000);
    }
  };
  setTimeout(attempt, 3000);
}

async function joinRTC(code, C) {
  const Peer = await loadPeer();
  const peer = C.peer = new Peer(peerOpts());
  await new Promise((res, rej) => { peer.on('open', res); peer.on('error', e => rej(new Error('P2P: ' + (e.type || e)))); });
  const conn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
  await new Promise((res, rej) => {
    conn.on('open', res);
    peer.on('error', e => rej(new Error(e.type === 'peer-unavailable' ? 'Room not found' : 'P2P: ' + (e.type || e))));
  });
  C.id = peer.id;
  let closed = false;
  const ch = openFast(conn, m => C.emit('msg', m));
  conn.on('data', d => C.emit('msg', d));
  conn.on('close', () => { if (!closed) { closed = true; C.emit('closed', 'The host left the game'); } });
  C.send = (d, fast) => {
    if (!conn.open) return;
    if (fast) { if (sendFast(ch, JSON.stringify(d), true)) return; if (relBacked(conn)) return; }
    conn.send(d);
  };
  C.close = () => { closed = true; try { ch && ch.close(); } catch {} try { peer.destroy(); } catch {} };
  C.mode = 'online'; C.label = 'direct (WebRTC)';
  return C;
}

async function joinMQ(code, C) {
  const bi = CODE_CHARS.indexOf(code[4]) - 24;
  if (bi === 31 - 24) throw new Error('Could not connect to the host. They may be behind a strict firewall: try the game server option instead.');
  const mq = await connectAnyBroker(bi >= 0 && bi < MQTT_BROKERS.length ? bi : 0).catch(() => { throw new Error('Could not reach the online relay. Check your internet connection.'); });
  const me = rid(10), base = topicBase(code);
  mq.subscribe(base + 'c/' + me); mq.subscribe(base + 'all');
  const welcomed = new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('Room not found (or the host is offline)')), 8000);
    mq.on('message', (topic, text) => { if (topic === base + 'c/' + me) { try { if (JSON.parse(text).op === 'welcome') { clearTimeout(t); res(); } } catch {} } });
  });
  // resend the join request until the host answers (subscriptions may take a moment)
  const hello = () => mq.publish(base + 'h', JSON.stringify({ op: 'join', f: me }));
  hello(); const iv = setInterval(hello, 1200);
  try { await welcomed; } finally { clearInterval(iv); }
  let closed = false;
  mq.on('message', (topic, text) => {
    if (C.mqDropped) return;
    if (topic !== base + 'all' && topic !== base + 'c/' + me) return;
    let m; try { m = JSON.parse(text); } catch { return; }
    if (topic === base + 'all') C.emit('msg', m); else if (m.op === 'd') C.emit('msg', m.d);
  });
  const keep = setInterval(() => mq.publish(base + 'h', JSON.stringify({ op: 'd', f: me, d: { t: 'ping' } })), 4000);
  mq.on('closed', () => { if (!closed) { closed = true; clearInterval(keep); C.emit('closed', 'Lost the connection to the online relay'); } });
  C.id = 'mq:' + me; C.mqId = me;
  // switched to a direct link: stop listening to the relay (no 'leave': the host keeps us)
  C.dropRelay = () => { closed = true; clearInterval(keep); C.mqDropped = true; setTimeout(() => { try { mq.close(); } catch {} }, 1500); };
  let last = 0;
  C.send = (d, fast) => {
    if (fast) { const now = performance.now(); if (now - last < 60) return; last = now; }
    mq.publish(base + 'h', JSON.stringify({ op: 'd', f: me, d }), fast);
  };
  C.close = () => { closed = true; clearInterval(keep); mq.publish(base + 'h', JSON.stringify({ op: 'leave', f: me })); setTimeout(() => mq.close(), 100); };
  C.mode = 'online'; C.label = 'relay';
  return C;
}
