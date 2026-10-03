"""3 jugadores: un tercero se une a una partida cooperativa YA EN CURSO."""
import time
from playwright.sync_api import sync_playwright
SIG = 'sig=localhost&sigport=9000&sigsecure=0'
URL = f'http://localhost:8123/index.html?debug=1&fast=1&{SIG}'
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
results = []
def check(name, ok, info=''):
    results.append((name, bool(ok))); print(('PASS ' if ok else 'FAIL ') + name, info, flush=True)
def until(fn, timeout=10.0):
    t = time.time()
    while time.time() - t < timeout:
        v = fn()
        if v: return v
        time.sleep(0.25)
    return fn()
with sync_playwright() as p:
    bs = [p.chromium.launch(args=ARGS) for _ in range(3)]
    P = [b.new_page(viewport={'width': 640, 'height': 360}) for b in bs]
    errs = []
    for i, pg in enumerate(P):
        pg.on('pageerror', lambda e, i=i: errs.append(f'{i}: {e}'))
        pg.goto(URL); pg.wait_for_function('window.GLDEBUG && GLDEBUG.game.frame > 5')
    H, A, B = P
    code = H.evaluate("GLDEBUG.game.createRoom('coop')")
    A.evaluate(f"GLDEBUG.game.joinRoom('{code}')")
    until(lambda: H.evaluate('GLDEBUG.state().session.players') == 2)
    H.evaluate('GLDEBUG.game.hostStart()')
    A.wait_for_function('GLDEBUG.state().inMatch', timeout=15000)
    H.evaluate('GLDEBUG.waitSim(7)')
    check('ronda 1 en curso con 2 jugadores', H.evaluate('GLDEBUG.state().roundState') == 'active')
    # tercer jugador se une a mitad de ronda
    B.evaluate(f"GLDEBUG.game.joinRoom('{code}')")
    ok = until(lambda: B.evaluate('GLDEBUG.state().inMatch'), 15)
    check('el 3er jugador entra en la partida en curso', ok)
    check('el host ve 3 jugadores', until(lambda: len(H.evaluate('GLDEBUG.state().players')) == 3), len(H.evaluate('GLDEBUG.state().players')))
    he = {e['id'] for e in H.evaluate('GLDEBUG.enemyInfo()') if not e['dead']}
    okE = until(lambda: he <= {e['id'] for e in B.evaluate('GLDEBUG.enemyInfo()')}, 10)
    check('el recién llegado recibe los enemigos actuales (sincronización completa)', okE, f"host {sorted(he)} nuevo {sorted(e['id'] for e in B.evaluate('GLDEBUG.enemyInfo()'))}")
    check('el recién llegado ve a los otros 2 jugadores', until(lambda: len(B.evaluate('GLDEBUG.state().players')) == 3))
    # siguiente ronda → todos vivos en la misma ronda
    H.evaluate('GLDEBUG.skipToRound(2)'); H.evaluate('GLDEBUG.waitSim(10.5)')
    ok = until(lambda: all(pg.evaluate('GLDEBUG.state().round') == 2 for pg in P) and B.evaluate('GLDEBUG.state().alive'), 12)
    check('ronda 2 sincronizada en los 3 y el nuevo jugador aparece vivo', ok, [pg.evaluate('GLDEBUG.state().round') for pg in P])
    # movimiento del 3º visto por el 2º (a través del host)
    bid = B.evaluate('GLDEBUG.game.localId')
    p0 = [x['pos'] for x in A.evaluate('GLDEBUG.state().players') if x['id'] == bid][0]
    B.evaluate("GLDEBUG.key('KeyW', true)"); B.evaluate('GLDEBUG.waitSim(1.0)'); B.evaluate("GLDEBUG.key('KeyW', false)")
    moved = until(lambda: (lambda q: abs(q[0]-p0[0]) + abs(q[1]-p0[1]) > 1.5)([x['pos'] for x in A.evaluate('GLDEBUG.state().players') if x['id'] == bid][0]), 6)
    check('movimiento del jugador 3 visible para el jugador 2 (retransmisión del host)', moved)
    print('ERRORES:', errs[:5]); check('sin errores JS', not errs)
    for b in bs: b.close()
print(f"\n{sum(1 for r in results if r[1])}/{len(results)} pruebas OK")
