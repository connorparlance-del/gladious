#!/usr/bin/env node
/* =====================================================================
 *  Servidor de señalización de GLADIADORES — SIN DEPENDENCIAS (Node >= 16)
 *
 *  Compatible con el protocolo de PeerServer (PeerJS): el juego puede usar
 *  indistintamente PeerJS Cloud, el PeerServer oficial o este servidor.
 *  Sólo intercambia mensajes de señalización (SDP/ICE) para que dos
 *  navegadores establezcan una conexión WebRTC directa. NO ejecuta el juego
 *  ni retransmite el tráfico de la partida.
 *
 *  Uso:   node signaling-server.js            (puerto 9000)
 *         PORT=8080 KEY=peerjs node signaling-server.js
 *  En producción ponlo detrás de HTTPS (Render, Fly.io, Railway, un VPS con
 *  Caddy/Nginx…) para obtener wss:// — ver README.
 * ===================================================================== */
'use strict';
const http = require('http');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || process.argv[2] || '9000', 10);
const KEY = process.env.KEY || 'peerjs';
const BASE = (process.env.BASE_PATH || '/').replace(/\/?$/, '/');
const ALIVE_TIMEOUT = 60000;
const EXPIRE_TIMEOUT = 5000;
const MAX_CLIENTS = parseInt(process.env.MAX_CLIENTS || '5000', 10);
const ID_RE = /^[A-Za-z0-9]+(?:[ _-][A-Za-z0-9]+)*$/;

const clients = new Map();   // id -> { token, socket, lastSeen }
const queues = new Map();    // id -> [{ msg, t }]

function log(...a) { if (!process.env.QUIET) console.log(new Date().toISOString(), ...a); }

/* ---------------- WebSocket mínimo (RFC 6455) ---------------- */
function wsAccept(key) { return crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64'); }

function wsSend(sock, text) {
    if (sock.destroyed) return;
    const payload = Buffer.from(text);
    let header;
    if (payload.length < 126) header = Buffer.from([0x81, payload.length]);
    else if (payload.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(payload.length, 2); }
    else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2); }
    sock.write(Buffer.concat([header, payload]));
}
function wsControl(sock, op, data) { if (!sock.destroyed) sock.write(Buffer.concat([Buffer.from([0x80 | op, data ? data.length : 0]), data || Buffer.alloc(0)])); }

function wsReader(sock, onText, onClose) {
    let buf = Buffer.alloc(0);
    let frag = null;
    sock.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        if (buf.length > 1 << 20) { sock.destroy(); return; }
        while (buf.length >= 2) {
            const fin = (buf[0] & 0x80) !== 0, op = buf[0] & 0x0f, masked = (buf[1] & 0x80) !== 0;
            let len = buf[1] & 0x7f, off = 2;
            if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
            else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
            const need = off + (masked ? 4 : 0) + len;
            if (buf.length < need) return;
            let data = buf.slice(off + (masked ? 4 : 0), need);
            if (masked) { const m = buf.slice(off, off + 4); data = Buffer.from(data); for (let i = 0; i < data.length; i++) data[i] ^= m[i & 3]; }
            buf = buf.slice(need);
            if (op === 0x8) { wsControl(sock, 0x8); sock.end(); return; }
            if (op === 0x9) { wsControl(sock, 0xA, data); continue; }
            if (op === 0xA) continue;
            if (op === 0x1 || op === 0x0) {
                frag = frag ? Buffer.concat([frag, data]) : data;
                if (fin) { const t = frag.toString('utf8'); frag = null; onText(t); }
            }
        }
    });
    sock.on('close', onClose);
    sock.on('error', () => sock.destroy());
}

/* ---------------- Lógica de PeerServer ---------------- */
function send(id, msg) { const c = clients.get(id); if (c && c.socket) wsSend(c.socket, JSON.stringify(msg)); }

function relay(srcId, msg) {
    const type = msg.type, dst = msg.dst;
    const out = { type, src: srcId, dst, payload: msg.payload };
    const dest = clients.get(dst);
    if (dest && dest.socket && !dest.socket.destroyed) { wsSend(dest.socket, JSON.stringify(out)); return; }
    if (type === 'LEAVE' && !dst) { removeClient(srcId); return; }
    if (type === 'LEAVE' || type === 'EXPIRE' || !dst) return;
    if (!queues.has(dst)) queues.set(dst, []);
    const q = queues.get(dst);
    if (q.length < 50) q.push({ msg: out, t: Date.now() });
}

function removeClient(id) {
    const c = clients.get(id);
    if (!c) return;
    clients.delete(id);
    try { c.socket && c.socket.destroy(); } catch (e) { /* nada */ }
    log('salida', id, '· clientes:', clients.size);
}

function onConnection(sock, query) {
    const id = query.get('id'), token = query.get('token'), key = query.get('key');
    if (!id || !token || !key) { wsSend(sock, JSON.stringify({ type: 'ERROR', payload: { msg: 'No id, token, or key supplied to websocket server' } })); sock.end(); return; }
    if (key !== KEY) { wsSend(sock, JSON.stringify({ type: 'ERROR', payload: { msg: 'Invalid key provided' } })); sock.end(); return; }
    if (!ID_RE.test(id) || id.length > 64) { wsSend(sock, JSON.stringify({ type: 'ERROR', payload: { msg: 'Invalid id' } })); sock.end(); return; }
    const existing = clients.get(id);
    if (existing) {
        if (existing.token !== token) { wsSend(sock, JSON.stringify({ type: 'ID-TAKEN', payload: { msg: 'ID is taken' } })); sock.end(); return; }
        try { existing.socket && existing.socket !== sock && existing.socket.destroy(); } catch (e) { /* nada */ }
        existing.socket = sock; existing.lastSeen = Date.now();
    } else {
        if (clients.size >= MAX_CLIENTS) { wsSend(sock, JSON.stringify({ type: 'ERROR', payload: { msg: 'Server has reached its concurrent user limit' } })); sock.end(); return; }
        clients.set(id, { token, socket: sock, lastSeen: Date.now() });
    }
    log('entrada', id, '· clientes:', clients.size);
    wsSend(sock, JSON.stringify({ type: 'OPEN' }));
    // mensajes en cola
    const q = queues.get(id);
    if (q) { queues.delete(id); for (const it of q) wsSend(sock, JSON.stringify(it.msg)); }
    wsReader(sock, (text) => {
        let msg; try { msg = JSON.parse(text); } catch (e) { return; }
        const c = clients.get(id);
        if (!c || c.socket !== sock) return;
        c.lastSeen = Date.now();
        if (!msg || typeof msg.type !== 'string') return;
        if (msg.type === 'HEARTBEAT') return;
        if (['OFFER', 'ANSWER', 'CANDIDATE', 'LEAVE', 'EXPIRE'].includes(msg.type)) relay(id, msg);
    }, () => {
        const c = clients.get(id);
        if (c && c.socket === sock) { clients.delete(id); log('cierre', id, '· clientes:', clients.size); }
    });
}

// limpieza: clientes inactivos y colas caducadas (con aviso EXPIRE al emisor)
setInterval(() => {
    const now = Date.now();
    for (const [id, c] of clients) if (now - c.lastSeen > ALIVE_TIMEOUT) removeClient(id);
    for (const [dst, q] of queues) {
        const keep = [];
        for (const it of q) {
            if (now - it.t > EXPIRE_TIMEOUT) send(it.msg.src, { type: 'EXPIRE', src: dst, dst: it.msg.src });
            else keep.push(it);
        }
        if (keep.length) queues.set(dst, keep); else queues.delete(dst);
    }
}, 1000).unref();

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const url = new URL(req.url, 'http://x');
    if (url.pathname === BASE + KEY + '/id') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(crypto.randomUUID()); return; }
    if (url.pathname === BASE || url.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ name: 'gladiadores-signaling', protocol: 'peerserver', clients: clients.size })); return; }
    res.writeHead(404); res.end();
});

server.on('upgrade', (req, sock) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== BASE + 'peerjs' || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { sock.destroy(); return; }
    const key = req.headers['sec-websocket-key'];
    if (!key) { sock.destroy(); return; }
    sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + wsAccept(key) + '\r\n\r\n');
    sock.setNoDelay(true);
    onConnection(sock, url.searchParams);
});

server.listen(PORT, () => log(`Señalización de Gladiadores escuchando en :${PORT}${BASE}peerjs (key="${KEY}")`));
