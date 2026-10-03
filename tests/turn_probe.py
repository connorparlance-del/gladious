import json
from playwright.sync_api import sync_playwright
CANDS = {
 'openrelay-udp80': {'urls': 'turn:openrelay.metered.ca:80', 'username': 'openrelayproject', 'credential': 'openrelayproject'},
 'openrelay-tcp443': {'urls': 'turn:openrelay.metered.ca:443?transport=tcp', 'username': 'openrelayproject', 'credential': 'openrelayproject'},
 'openrelay-tls443': {'urls': 'turns:openrelay.metered.ca:443?transport=tcp', 'username': 'openrelayproject', 'credential': 'openrelayproject'},
 'freestun-udp': {'urls': 'turn:freestun.net:3478', 'username': 'free', 'credential': 'free'},
 'freestun-tls': {'urls': 'turns:freestun.net:5350', 'username': 'free', 'credential': 'free'},
 'expressturn': {'urls': 'turn:relay1.expressturn.com:3478', 'username': 'efQUQ79N77B5BNVVKF', 'credential': 'N4EAUgpjMzPLrxSS'},
}
JS = r"""
async (srv) => {
  const pc = new RTCPeerConnection({ iceServers: [srv], iceTransportPolicy: 'relay' });
  pc.createDataChannel('x');
  const found = []; let err = [];
  pc.onicecandidate = (e) => { if (e.candidate) found.push(e.candidate.candidate.split(' ').slice(4, 8).join(' ')); };
  pc.onicecandidateerror = (e) => err.push(e.errorCode + ' ' + e.errorText);
  await pc.setLocalDescription(await pc.createOffer());
  await new Promise(r => setTimeout(r, 9000));
  pc.close();
  return { relay: found, errors: err.slice(0, 3) };
}
"""
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(); pg.goto('https://connorparlance-del.github.io/gladious/README.md')
    for k, v in CANDS.items():
        try: print(k, json.dumps(pg.evaluate(JS, v)), flush=True)
        except Exception as e: print(k, 'EXC', e, flush=True)
    b.close()
