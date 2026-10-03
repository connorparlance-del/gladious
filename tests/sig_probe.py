import sys, json
from playwright.sync_api import sync_playwright
JS = r"""
async (variant) => {
  const log = [];
  const rnd = () => Math.random().toString(36).slice(2, 10);
  const open = (id) => new Promise((res) => {
    const ws = new WebSocket(`wss://0.peerjs.com:443/peerjs?key=peerjs&id=${id}&token=${rnd()}&version=1.5.4`);
    ws.msgs = []; ws.closed = false;
    ws.onmessage = (e) => { ws.msgs.push(e.data); if (e.data.includes('OPEN')) res(ws); };
    ws.onclose = (e) => { ws.closed = true; log.push(id + ' CLOSE code=' + e.code + ' reason=' + e.reason); };
  });
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const hid = 'probe-h-' + rnd(), gid = 'probe-g-' + rnd();
  const h = await open(hid); const g = await open(gid);
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  pc.createDataChannel('x');
  const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
  const sdp = { type: 'offer', sdp: offer.sdp };
  const msgs = {
    ours: [{ type: 'OFFER', dst: hid, payload: { kind: 'gladiadores', connectionId: 'cabc', sdp } }],
    peerjs: [{ type: 'OFFER', dst: hid, payload: { sdp, type: 'data', connectionId: 'dc_abc', label: 'dc_abc', reliable: true, serialization: 'binary', metadata: undefined, browser: 'chrome' } }],
    small: [{ type: 'OFFER', dst: hid, payload: { kind: 'x', connectionId: 'c', sdp: { type: 'offer', sdp: 'hello' } } }],
    cand: [{ type: 'CANDIDATE', dst: hid, payload: { candidate: { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: '0', sdpMLineIndex: 0 }, type: 'data', connectionId: 'dc_abc' } }],
  }[variant];
  for (const m of msgs) { g.send(JSON.stringify(m)); log.push('sent ' + m.type + ' len=' + JSON.stringify(m).length); await sleep(300); }
  await sleep(3000);
  log.push('host got: ' + h.msgs.map(x => x.slice(0, 80)).join(' | '));
  log.push('guest got: ' + g.msgs.map(x => x.slice(0, 80)).join(' | '));
  log.push('guest closed=' + g.closed + ' host closed=' + h.closed);
  h.close(); g.close();
  return log;
}
"""
JS2 = r"""
async () => {
  const log = [];
  await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  const id = 'probe-pj-' + Math.random().toString(36).slice(2, 10);
  const a = new Peer(id);
  await new Promise(r => a.on('open', r));
  const b = new Peer();
  await new Promise(r => b.on('open', r));
  const got = new Promise((res) => a.on('connection', (c) => c.on('data', (d) => res(d))));
  const c = b.connect(id, { reliable: true });
  c.on('open', () => c.send('hola'));
  const r = await Promise.race([got, new Promise(r => setTimeout(() => r('TIMEOUT'), 15000))]);
  log.push('peerjs oficial: ' + r);
  a.destroy(); b.destroy();
  return log;
}
"""
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(); pg.goto('https://connorparlance-del.github.io/gladious/README.md')
    for v in ['small', 'cand', 'peerjs', 'ours']:
        try: print(v, json.dumps(pg.evaluate(JS, v), ensure_ascii=False, indent=1), flush=True)
        except Exception as e: print(v, 'EXC', e, flush=True)
    try: print(pg.evaluate(JS2), flush=True)
    except Exception as e: print('peerjs EXC', e, flush=True)
    b.close()
