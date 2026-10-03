"""Prueba online REAL contra la web publicada (se ejecuta en GitHub Actions, con Internet)."""
import sys, time, json
from playwright.sync_api import sync_playwright
URL = (sys.argv[1] if len(sys.argv) > 1 else 'https://connorparlance-del.github.io/gladious/') + '?debug=1&fast=1'
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
def log(*a): print(*a, flush=True)
with sync_playwright() as p:
    bh = p.chromium.launch(args=ARGS); bg = p.chromium.launch(args=ARGS)
    H = bh.new_page(); G = bg.new_page()
    for n, pg in (('HOST', H), ('GUEST', G)):
        pg.on('console', lambda m, n=n: log(f'[{n} {m.type}] {m.text}'[:400]))
        pg.on('pageerror', lambda e, n=n: log(f'[{n} pageerror] {e}'))
        def onws(ws, n=n):
            log(f'[{n} websocket] {ws.url[:120]}')
            ws.on('framesent', lambda d, n=n: log(f'[{n} ws>] {str(d)[:300]}') if 'HEARTBEAT' not in str(d) else None)
            ws.on('framereceived', lambda d, n=n: log(f'[{n} ws<] {str(d)[:300]}'))
            ws.on('close', lambda w, n=n: log(f'[{n} ws CLOSE]'))
            ws.on('socketerror', lambda e, n=n: log(f'[{n} ws ERROR] {e}'))
        pg.on('websocket', onws)
        pg.goto(URL); pg.wait_for_function('window.GLDEBUG && GLDEBUG.game.frame > 5', timeout=90000)
    log('cargado. señalización =', H.evaluate('JSON.stringify(GL.NETWORK_CONFIG.signaling)'))
    t = time.time()
    try:
        code = H.evaluate("GLDEBUG.game.createRoom('duel').then(c => c, e => 'ERROR:' + e.message)")
    except Exception as e:
        code = 'EXC:' + str(e)
    log(f'crear sala → {code} ({time.time()-t:.1f}s)')
    if code.startswith('ERROR') or code.startswith('EXC'):
        log('RESULTADO: FALLO AL CREAR SALA'); sys.exit(1)
    t = time.time()
    r = G.evaluate(f"GLDEBUG.game.joinRoom('{code}').then(() => 'OK', e => 'ERROR:' + e.message)")
    log(f'unirse → {r} ({time.time()-t:.1f}s)')
    log('diag host', H.evaluate('JSON.stringify(GLDEBUG.game.session.diagnostics())'), 'guest', G.evaluate('JSON.stringify(GLDEBUG.game.session.diagnostics())'))
    if r != 'OK': log('RESULTADO: FALLO AL UNIRSE'); sys.exit(1)
    H.wait_for_timeout(1500)
    log('jugadores host', H.evaluate('GLDEBUG.state().session.players'))
    H.evaluate('GLDEBUG.game.hostStart()')
    G.wait_for_function('GLDEBUG.state().inMatch', timeout=20000)
    H.evaluate('GLDEBUG.waitSim(4)')
    log('duelo host', H.evaluate('JSON.stringify(GLDEBUG.state().duel)'), 'guest', G.evaluate('JSON.stringify(GLDEBUG.state().duel)'))
    p0 = H.evaluate('JSON.stringify(GLDEBUG.state().players)')
    G.evaluate("GLDEBUG.key('KeyW', true)"); G.evaluate('GLDEBUG.waitSim(1)'); G.evaluate("GLDEBUG.key('KeyW', false)"); H.wait_for_timeout(1500)
    log('antes', p0); log('después', H.evaluate('JSON.stringify(GLDEBUG.state().players)'))
    log('RESULTADO: OK')
    bh.close(); bg.close()
