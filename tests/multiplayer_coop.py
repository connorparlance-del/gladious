"""Prueba REAL de supervivencia cooperativa online: dos navegadores, WebRTC, host autoritativo."""
import sys, time
from playwright.sync_api import sync_playwright
OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
SIG = 'sig=localhost&sigport=9000&sigsecure=0'
URL = f'http://localhost:8123/index.html?debug=1&fast=1&{SIG}'
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
results = []
def check(name, ok, info=''):
    results.append((name, bool(ok))); print(('PASS ' if ok else 'FAIL ') + name, info, flush=True)
def until(fn, timeout=8.0, step=0.25):
    t = time.time()
    while time.time() - t < timeout:
        v = fn()
        if v: return v
        time.sleep(step)
    return fn()

with sync_playwright() as p:
    bh = p.chromium.launch(args=ARGS); bg = p.chromium.launch(args=ARGS)
    H = bh.new_page(viewport={'width': 800, 'height': 450}); G = bg.new_page(viewport={'width': 800, 'height': 450})
    errs = []
    for name, pg in (('H', H), ('G', G)):
        pg.on('pageerror', lambda e, n=name: errs.append(n + ': ' + str(e)))
        pg.on('console', lambda m, n=name: errs.append(n + ': ' + m.text) if m.type == 'error' else None)
        pg.goto(URL); pg.wait_for_function('window.GLDEBUG && GLDEBUG.game.frame > 5')
    h = H.evaluate; g = G.evaluate
    hs = lambda: h('GLDEBUG.state()'); gs = lambda: g('GLDEBUG.state()')
    code = h("GLDEBUG.game.createRoom('coop')")
    g(f"GLDEBUG.game.joinRoom('{code}')")
    check('sala cooperativa creada y unida', until(lambda: hs()['session']['players'] == 2), code)
    h('GLDEBUG.game.hostStart()')
    G.wait_for_function('GLDEBUG.state().inMatch', timeout=15000)
    check('ambos en la partida cooperativa', hs()['mode'] == 'coop' and gs()['mode'] == 'coop')
    gid = g('GLDEBUG.game.localId'); hid = h('GLDEBUG.game.localId')
    until(lambda: gs()['slots'][0].startswith('dagger'))
    check('equipo inicial en ambos', gs()['slots'][0].startswith('dagger') and hs()['slots'][0].startswith('dagger'), (hs()['slots'], gs()['slots']))
    # esperar a que empiece la ronda 1 y aparezcan enemigos
    h('GLDEBUG.waitSim(6.5)')
    check('ronda 1 activa en ambos', until(lambda: hs()['round'] == 1 and gs()['round'] == 1 and hs()['roundState'] == 'active'), (hs()['roundState'], gs()['roundState']))
    h('GLDEBUG.waitSim(3)')
    he = {e['id'] for e in h('GLDEBUG.enemyInfo()') if not e['dead']}
    ok = until(lambda: {e['id'] for e in g('GLDEBUG.enemyInfo()') if not e['dead']} >= he and len(he) > 0)
    ge = {e['id'] for e in g('GLDEBUG.enemyInfo()') if not e['dead']}
    check('enemigos sincronizados (mismos IDs)', ok, f'host {sorted(he)} invitado {sorted(ge)}')
    # posiciones de enemigos coinciden (interpolación)
    h('GLDEBUG.freezeEnemies(true)'); h('GLDEBUG.waitSim(1.0)'); G.wait_for_timeout(1500)
    hm = {e['id']: e['pos'] for e in h('GLDEBUG.enemyInfo()')}
    gm = {e['id']: e['pos'] for e in g('GLDEBUG.enemyInfo()')}
    diffs = [abs(hm[i][0]-gm[i][0]) + abs(hm[i][2]-gm[i][2]) for i in hm if i in gm]
    check('posiciones de enemigos coinciden', diffs and max(diffs) < 0.3, f'max error {max(diffs) if diffs else None:.3f} m')
    # el invitado ataca a un enemigo (validación en host, puntos al invitado)
    eid = h("GLDEBUG.spawn('basic', 13, -10.35)")
    h(f"(() => {{ const e = GLDEBUG.game.enemies.get({eid}); e.yaw = Math.PI; e.enterT = 0; }})()")
    h(f"(() => {{ const e = GLDEBUG.game.match.players.get('{gid}'); e.allowTeleport = true; e.teleportUntil = performance.now() + 4000; }})()")
    until(lambda: any(e['id'] == eid for e in g('GLDEBUG.enemyInfo()')))
    g('GLDEBUG.teleport(13, -9.2, 0)'); g('GLDEBUG.waitSim(0.6)'); H.wait_for_timeout(1000)
    hp0 = [e for e in h('GLDEBUG.enemyInfo()') if e['id'] == eid][0]['hp']
    h("(() => { const m = GLDEBUG.game.match; window.__log = []; for (const k of ['hostHandleAttack','hostHandleHit']) { const o = m[k].bind(m); m[k] = (pid, x) => { window.__log.push(k.slice(10) + ' ' + JSON.stringify(x).slice(0,90)); return o(pid, x); }; } })()")
    print('  invitado en', gs()['pos'], 'arma', gs()['weapon'], '| enemigo (host)', [e['pos'] for e in h('GLDEBUG.enemyInfo()') if e['id'] == eid], '(invitado)', [e['pos'] for e in g('GLDEBUG.enemyInfo()') if e['id'] == eid])
    print('  host ve al invitado en', [p_['pos'] for p_ in hs()['players'] if p_['id'] == gid])
    pts0 = gs()['points']
    for i in range(4):
        g("GLDEBUG.mouse('left', true)"); g('GLDEBUG.waitSim(0.05)'); g("GLDEBUG.mouse('left', false)"); g('GLDEBUG.waitSim(0.45)')
    H.wait_for_timeout(1500)
    info = [e for e in h('GLDEBUG.enemyInfo()') if e['id'] == eid]
    hp1 = info[0]['hp'] if info else 0
    print('  host recibió:', h('window.__log'))
    check('golpes del invitado dañan enemigos (autoridad del host)', hp1 < hp0, f'{hp0} -> {hp1}')
    pts1 = until(lambda: gs()['points'] if gs()['points'] > pts0 else 0)
    check('puntos del invitado otorgados por el host', (pts1 or 0) > pts0, f'{pts0} -> {gs()["points"]}')
    # intento de trampa: puntos falsos enviados por el invitado no tienen efecto
    g("GLDEBUG.game.session.sendHost({k:'pts', pid: GLDEBUG.game.localId, pts: 999999})")
    g("GLDEBUG.game.session.sendHost({k:'ev', l:[{type:'pts', pid: GLDEBUG.game.localId, pts: 999999}]})")
    H.wait_for_timeout(800)
    check('el host ignora puntos falsificados por un cliente', h(f"GLDEBUG.game.match.players.get('{gid}').points") < 100000)
    # compra sincronizada: el host da puntos al invitado y éste compra el gladius
    h(f"(() => {{ const m = GLDEBUG.game.match, e = m.players.get('{gid}'); e.points += 1500; m.emitEvent({{type:'pts', pid: e.id, pts: e.points, d: 1500}}); }})()")
    until(lambda: gs()['points'] >= 1500)
    wb = h("(() => { const w = GLDEBUG.game.arena.wallBuys.find(x => x.weapon==='gladius'); return [w.pos.x, w.pos.z, Math.atan2(w.normal.x, w.normal.z)]; })()")
    h(f"(() => {{ const e = GLDEBUG.game.match.players.get('{gid}'); e.allowTeleport = true; e.teleportUntil = performance.now() + 4000; }})()")
    g(f'GLDEBUG.teleport({wb[0]}, {wb[1]}, {wb[2]})'); g('GLDEBUG.waitSim(0.6)'); H.wait_for_timeout(1000)
    ptsb = gs()['points']
    g("GLDEBUG.key('KeyE', true)"); g('GLDEBUG.waitSim(0.08)'); g("GLDEBUG.key('KeyE', false)")
    okb = until(lambda: gs()['weapon'] == 'gladius')
    host_slots = h(f"JSON.stringify(GLDEBUG.game.match.players.get('{gid}').slots)")
    check('compra del invitado validada y sincronizada', okb and 'gladius' in host_slots and gs()['points'] == ptsb - 500, f"{gs()['weapon']} pts {ptsb}->{gs()['points']} host:{host_slots}")
    # puerta comprada por el host → abierta en ambos
    h("(() => { const m = GLDEBUG.game.match; m.local.points += 2000; })()")
    h("GLDEBUG.teleport(24.2, 0, -Math.PI/2)"); h('GLDEBUG.waitSim(0.3)')
    h("GLDEBUG.key('KeyE', true)"); h('GLDEBUG.waitSim(0.08)'); h("GLDEBUG.key('KeyE', false)"); h('GLDEBUG.waitSim(0.3)')
    gate_g = until(lambda: g("GLDEBUG.game.arena.gates.east.open"))
    check('puerta de galería abierta y sincronizada', h("GLDEBUG.game.arena.gates.east.open") and gate_g)
    # rondas sincronizadas
    h('GLDEBUG.freezeEnemies(false)')
    h('GLDEBUG.skipToRound(4)'); h('GLDEBUG.waitSim(10.5)')
    ok = until(lambda: hs()['round'] == 4 and gs()['round'] == 4, 10)
    check('cambio de ronda sincronizado', ok, (hs()['round'], gs()['round']))
    # caído y reanimación
    h(f"GLDEBUG.game.match.hostDamagePlayer('{gid}', {{base: 999, zone: 'torso', attacker: 'test', noBlock: true}})")
    okd = until(lambda: gs()['downed'])
    check('el invitado queda caído (cooperativo)', okd, gs()['hp'])
    gp = gs()['pos']
    h(f"GLDEBUG.teleport({gp[0]}, {gp[2] + 1.0}, Math.PI)"); h('GLDEBUG.waitSim(0.3)')
    h("GLDEBUG.key('KeyE', true)"); h('GLDEBUG.waitSim(3.6)'); h("GLDEBUG.key('KeyE', false)")
    okr = until(lambda: not gs()['downed'] and gs()['alive'])
    check('reanimación por el compañero', okr, (gs()['downed'], gs()['hp']))
    H.screenshot(path=f'{OUT}/coop_host.png'); G.screenshot(path=f'{OUT}/coop_guest.png')
    # pérdida de conexión del INVITADO a mitad de partida → reconexión automática
    pts_before = gs()['points']
    g("GLDEBUG.game.session.hostLink.close('prueba')")
    lost_g = until(lambda: g("!document.getElementById('conn-lost').classList.contains('hidden')"), 5)
    dc_h = until(lambda: h(f"GLDEBUG.game.match.players.get('{gid}').connected === false || GLDEBUG.game.session.players.get('{gid}').connected === false"), 8)
    back = until(lambda: g("GLDEBUG.game.session.status") == 'connected' and g("document.getElementById('conn-lost').classList.contains('hidden')"), 20)
    check('reconexión automática del invitado', lost_g and back, f'overlay={lost_g} host_vio_desconexion={dc_h}')
    h('GLDEBUG.waitSim(2.5)')
    ok_state = until(lambda: gs()['inMatch'] and gs()['round'] == hs()['round'] and gs()['points'] == pts_before, 8)
    check('tras reconectar conserva puntos y ronda', ok_state, (gs()['round'], hs()['round'], pts_before, gs()['points']))
    g("GLDEBUG.key('KeyW', true)"); g('GLDEBUG.waitSim(0.6)'); g("GLDEBUG.key('KeyW', false)")
    G.wait_for_timeout(800)
    gp_local = gs()['pos']; gp_host = [p_['pos'] for p_ in hs()['players'] if p_['id'] == gid][0]
    check('el movimiento vuelve a sincronizar tras reconectar', abs(gp_local[0] - gp_host[0]) + abs(gp_local[2] - gp_host[1]) < 0.8, f'{gp_local} vs {gp_host}')
    # desconexión del ANFITRIÓN → el invitado ve conexión perdida y luego final controlado
    g('GL.NETWORK_CONFIG.reconnectWindowMs = 5000')
    bh.close()
    lost = until(lambda: g("!document.getElementById('conn-lost').classList.contains('hidden')"), 15)
    check('invitado detecta conexión perdida con el anfitrión', lost, g("document.getElementById('conn-lost-msg').textContent"))
    ended = until(lambda: not gs()['inMatch'], 25)
    check('final controlado si el anfitrión no vuelve', ended, g("document.getElementById('conn-lost-msg').textContent"))
    print('ERRORES:', errs[:8])
    check('sin errores JS', not errs)
    bg.close()
print(f"\n{sum(1 for r in results if r[1])}/{len(results)} pruebas OK")
