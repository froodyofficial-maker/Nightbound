// Nightbound server: static file host + tiny WebSocket room relay.
// Zero dependencies. Run:  node server.js [port]   then open http://localhost:8090
// Friends on your network join via http://<your-ip>:8090 ; for internet play,
// port-forward the port or deploy this folder to any Node host (Render, Fly, Railway...).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), 'public');
const port = +(process.argv[2] || process.env.PORT || 8090);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain',
};

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/health') { res.writeHead(200); res.end('ok'); return; }
    if (p.endsWith('/')) p += 'index.html';
    const f = normalize(join(root, p));
    if (!f.startsWith(root)) throw 0;
    const s = await stat(f);
    if (s.isDirectory()) throw 0;
    res.writeHead(200, { 'Content-Type': types[extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(await readFile(f));
  } catch { res.writeHead(404); res.end('not found'); }
});

// ---------- minimal RFC6455 WebSocket ----------
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
let nextId = 1;
class Sock {
  constructor(socket) {
    this.s = socket; this.id = 'p' + (nextId++); this.buf = Buffer.alloc(0); this.frag = []; this.open = true;
    this.onmessage = null; this.onclose = null;
    socket.on('data', d => { this.buf = Buffer.concat([this.buf, d]); this.parse(); });
    socket.on('close', () => this.closed());
    socket.on('error', () => this.closed());
  }
  parse() {
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (len > 4 * 1024 * 1024) { this.close(); return; }
      const mOff = off; if (masked) off += 4;
      if (b.length < off + len) return;
      let payload = Buffer.from(b.subarray(off, off + len));
      if (masked) { const m = b.subarray(mOff, mOff + 4); for (let i = 0; i < payload.length; i++) payload[i] ^= m[i & 3]; }
      this.buf = b.subarray(off + len);
      if (op === 8) { this.close(); return; }
      if (op === 9) { this.frame(10, payload); continue; }
      if (op === 10) continue;
      if (op === 1 || op === 2 || op === 0) {
        this.frag.push(payload);
        if (fin) { const msg = Buffer.concat(this.frag).toString('utf8'); this.frag = []; this.onmessage && this.onmessage(msg); }
      }
    }
  }
  frame(op, payload) {
    if (!this.open) return;
    const len = payload.length; let head;
    if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
    else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    head[0] = 0x80 | op;
    try { this.s.write(Buffer.concat([head, payload])); } catch { this.closed(); }
  }
  send(obj) { this.frame(1, Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8')); }
  close() { if (this.open) { this.frame(8, Buffer.alloc(0)); try { this.s.end(); } catch {} } this.closed(); }
  closed() { if (!this.open) return; this.open = false; try { this.s.destroy(); } catch {} this.onclose && this.onclose(); }
}

// ---------- rooms ----------
const rooms = new Map(); // code -> { host: Sock, peers: Map<id,Sock> }
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  for (;;) { let c = ''; for (let i = 0; i < 5; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; if (!rooms.has(c)) return c; }
}

server.on('upgrade', (req, socket) => {
  if (!req.url.startsWith('/ws') || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true);
  const ws = new Sock(socket);
  let room = null, isHost = false;
  ws.onmessage = raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.op === 'host' && !room) {
      const code = newCode(); room = { code, host: ws, peers: new Map() }; rooms.set(code, room); isHost = true;
      ws.send({ op: 'hosted', code });
    } else if (m.op === 'join' && !room) {
      const r = rooms.get(String(m.code || '').toUpperCase().trim());
      if (!r) { ws.send({ op: 'error', msg: 'Room not found' }); return; }
      if (r.peers.size >= 8) { ws.send({ op: 'error', msg: 'Room is full' }); return; }
      room = r; r.peers.set(ws.id, ws);
      ws.send({ op: 'joined', id: ws.id, code: r.code });
      r.host.send({ op: 'peer-join', id: ws.id });
    } else if (m.op === 'data' && room) {
      if (isHost) {
        const payload = JSON.stringify({ op: 'data', d: m.d });
        if (m.to === '*') for (const p of room.peers.values()) p.send(payload);
        else { const p = room.peers.get(m.to); p && p.send(payload); }
      } else room.host.send({ op: 'data', from: ws.id, d: m.d });
    } else if (m.op === 'ping') ws.send({ op: 'pong', t: m.t });
  };
  ws.onclose = () => {
    if (!room) return;
    if (isHost) { for (const p of room.peers.values()) { p.send({ op: 'host-left' }); p.close(); } rooms.delete(room.code); }
    else { room.peers.delete(ws.id); room.host.open && room.host.send({ op: 'peer-leave', id: ws.id }); }
    room = null;
  };
});

server.listen(port, () => {
  console.log(`\n  NIGHTBOUND is running:  http://localhost:${port}`);
  for (const list of Object.values(networkInterfaces())) for (const n of list || [])
    if (n.family === 'IPv4' && !n.internal) console.log(`  On your network:        http://${n.address}:${port}`);
  console.log('');
});
