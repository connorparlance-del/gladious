"""Prueba REAL de duelo online: dos procesos de navegador independientes,
señalización por WebSocket (servidor local compatible PeerServer) y WebRTC DataChannels."""
import sys, json, time
from playwright.sync_api import sync_playwright
OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
SIG = 'sig=localhost&sigport=9000&sigsecure=0'
URL = f'http://localhost:8123/index.html?debug=1&fast=1&{SIG}'
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
results = []
def check(name, ok, info=''):
    results.append((name, bool(ok))); print(('PASS ' if ok else 'FAIL ') + name, info, flush=True)

with sync_playwright() as p:
    bh = p.chromium.launch(args=ARGS)      # proceso 1: anfitrión
    bg = p.chromium.launch(args=ARGS)      # proceso 2: invitado
    H = bh.new_page(viewport={'width': 800, 'height': 450}); G = bg.new_page(viewport={'width': 800, 'height': 450})
    errs = []
    for name, pg in (('H', H), ('G', G)):
        pg.on('pageerror', lambda e, n=name: errs.append(n + ': ' + str(e)))
        pg.on('console', lambda m, n=name: errs.append(n + ': ' + m.text) if m.type == 'error' else None)
        pg.goto(URL); pg.wait_for_function('window.GLDEBUG && GLDEBUG.game.frame > 5')
    h = lambda js: H.evaluate(js); g = lambda js: G.evaluate(js)
    hs = lambda: h('GLDEBUG.state()'); gs = lambda: g('GLDEBUG.state()')
    h("(() => { const p = GLDEBUG.game.menus.profile; p.name = 'Anfitrion'; p.loadout = {primary:'gladius', secondary:null}; })()")
    g("(() => { const p = GLDEBUG.game.menus.profile; p.name = 'Invitado'; p.loadout = {primary:'longsword', secondary:'bow'}; })()")
    code = h("GLDEBUG.game.createRoom('duel')")
    check('crear sala genera código', isinstance(code, str) and len(code) == 5, code)
    t0 = time.time()
    try:
        g(f"GLDEBUG.game.joinRoom('{code}')")
        check('invitado se une con el código', True, f'{time.time()-t0:.1f}s')
    except Exception as e:
        check('invitado se une con el código', False, str(e)[:200])
    H.wait_for_timeout(1500)
    check('anfitrión ve 2/2 jugadores', hs()['session']['players'] == 2, hs()['session'])
    lob = h("document.getElementById('lobby-status').textContent")
    print('lobby:', lob)
    # código incorrecto
    try:
        bx = p.chromium.launch(args=ARGS); X = bx.new_page(); X.goto(URL); X.wait_for_function('window.GLDEBUG && GLDEBUG.game.frame > 5')
        r = X.evaluate("GLDEBUG.game.joinRoom('ZZZZZ').then(() => 'ok', (e) => e.message)")
        check('código inexistente da error claro', r in ('ROOM_NOT_FOUND', 'JOIN_TIMEOUT'), r)
        r2 = X.evaluate(f"GLDEBUG.game.joinRoom('{code}').then(() => 'ok', (e) => e.message)")
        check('sala de duelo llena rechaza 3er jugador', r2 == 'REJECT_FULL', r2)
        bx.close()
    except Exception as e:
        check('casos de error de unión', False, str(e)[:200])
    # iniciar
    h('GLDEBUG.game.hostStart()')
    G.wait_for_function('GLDEBUG.state().inMatch', timeout=15000)
    check('ambos entran al duelo', hs()['inMatch'] and gs()['inMatch'], (hs()['mode'], gs()['mode']))
    h('GLDEBUG.waitSim(4.0)')
    g('GLDEBUG.waitSim(0.5)')
    s1, s2 = hs(), gs()
    check('cuenta atrás → combate', (s1['duel'] or {}).get('s') == 'fight' and (s2['duel'] or {}).get('s') == 'fight', (s1['duel'], s2['duel']))
    check('ambos jugadores aparecen en el mundo del otro', len(s1['players']) == 2 and len(s2['players']) == 2)
    check('armas del lobby aplicadas al invitado', gs()['slots'][0].startswith('longsword') and gs()['slots'][1].startswith('bow'), gs()['slots'])
    gid = gs()['players'][[p_['name'] for p_ in gs()['players']].index('Invitado')]['id']
    hid = hs()['players'][[p_['name'] for p_ in hs()['players']].index('Anfitrion')]['id']
    # movimiento del invitado visto por el anfitrión
    gpos0 = [p_ for p_ in hs()['players'] if p_['id'] == gid][0]['pos']
    g("GLDEBUG.key('KeyW', true)"); g('GLDEBUG.waitSim(1.0)'); g("GLDEBUG.key('KeyW', false)"); g('GLDEBUG.waitSim(0.3)')
    H.wait_for_timeout(800)
    gpos1 = [p_ for p_ in hs()['players'] if p_['id'] == gid][0]['pos']
    gown = gs()['pos']
    check('movimiento sincronizado (invitado → anfitrión)', abs(gpos1[0]-gpos0[0]) + abs(gpos1[1]-gpos0[1]) > 1.5 and abs(gpos1[0]-gown[0]) < 0.6 and abs(gpos1[1]-gown[2]) < 0.6, f'{gpos0} -> {gpos1} (local {gown})')
    hpos0 = [p_ for p_ in gs()['players'] if p_['id'] == hid][0]['pos']
    h("GLDEBUG.key('KeyD', true)"); h('GLDEBUG.waitSim(1.0)'); h("GLDEBUG.key('KeyD', false)"); h('GLDEBUG.waitSim(0.3)')
    G.wait_for_timeout(800)
    hpos1 = [p_ for p_ in gs()['players'] if p_['id'] == hid][0]['pos']
    check('movimiento sincronizado (anfitrión → invitado)', abs(hpos1[0]-hpos0[0]) + abs(hpos1[1]-hpos0[1]) > 1.5, f'{hpos0} -> {hpos1}')
    # rotación
    g('GLDEBUG.look(-400, 0)'); g('GLDEBUG.waitSim(0.3)'); H.wait_for_timeout(600)
    gyaw_local = gs()['yaw']; gyaw_host = h(f"GLDEBUG.game.match.players.get('{gid}').yaw")
    check('rotación sincronizada', abs(gyaw_local - gyaw_host) < 0.15, f'{gyaw_local} vs {gyaw_host}')
    # colocar frente a frente (el host autoriza el teletransporte)
    h(f"(() => {{ const e = GLDEBUG.game.match.players.get('{gid}'); e.allowTeleport = true; e.teleportUntil = performance.now() + 4000; }})()")
    h('GLDEBUG.teleport(13, -9, -Math.PI/2)')     # anfitrión mira hacia +X
    g('GLDEBUG.teleport(14.25, -9, Math.PI/2)')   # invitado mira hacia -X
    g('GLDEBUG.waitSim(0.5)'); H.wait_for_timeout(1200); G.wait_for_timeout(600)
    # esperar a que la vista del invitado converja con la posición real del anfitrión
    for _ in range(40):
        seen = [p_ for p_ in gs()['players'] if p_['id'] == hid][0]['pos']
        if abs(seen[0] - 13) < 0.5 and abs(seen[1] + 9) < 0.5: break
        G.wait_for_timeout(250)
    hp0 = hs()['hp']
    hits = []
    for i in range(3):
        g("GLDEBUG.mouse('left', true)"); g('GLDEBUG.waitSim(0.05)'); g("GLDEBUG.mouse('left', false)"); g('GLDEBUG.waitSim(0.6)')
    H.wait_for_timeout(1200); G.wait_for_timeout(300)
    hp1 = hs()['hp']
    opp_hp_seen = -1
    for _ in range(20):   # convergencia: el invitado aplica el evento cuando su página procesa el siguiente frame
        opp_hp_seen = [p_ for p_ in gs()['players'] if p_['id'] == hid][0]['hp']
        if abs(opp_hp_seen - hp1) <= 2: break
        G.wait_for_timeout(250)
    check('ataque del invitado daña al anfitrión (validado por el host)', hp1 < hp0, f'{hp0} -> {hp1}')
    check('el invitado ve la vida actualizada del rival', abs(opp_hp_seen - hp1) <= 2, f'{opp_hp_seen} vs {hp1}')
    # bloqueo del anfitrión
    h("(() => { const m = GLDEBUG.game.match; window.__pd = []; const o = m.emitEvent.bind(m); m.emitEvent = (e) => { if (e.type === 'pdmg') window.__pd.push(e); return o(e); }; })()")
    h("GLDEBUG.mouse('right', true)"); h('GLDEBUG.waitSim(0.6)'); H.wait_for_timeout(500)
    g("GLDEBUG.mouse('left', true)"); g('GLDEBUG.waitSim(0.05)'); g("GLDEBUG.mouse('left', false)"); g('GLDEBUG.waitSim(0.8)')
    H.wait_for_timeout(1200)
    pd = h('window.__pd')
    h("GLDEBUG.mouse('right', false)")
    blocked = [e for e in pd if e.get('bl') or e.get('pr')]
    check('el bloqueo frontal reduce el daño', len(blocked) > 0 and blocked[0]['a'] < (hp0 - hp1) / 3, f'sin bloqueo ~{(hp0-hp1)/3:.0f}/golpe, con bloqueo {[(e["a"], e.get("bl"), e.get("pr")) for e in pd]}')
    # ataque del anfitrión al invitado
    ghp0 = gs()['hp']
    for i in range(2):
        h("GLDEBUG.mouse('left', true)"); h('GLDEBUG.waitSim(0.05)'); h("GLDEBUG.mouse('left', false)"); h('GLDEBUG.waitSim(0.6)')
    G.wait_for_timeout(1200)
    ghp1 = gs()['hp']
    check('ataque del anfitrión daña al invitado', ghp1 < ghp0, f'{ghp0} -> {ghp1}')
    # antitrampas: reclamación de golpe a distancia imposible
    h("GLDEBUG.waitSim(0.2)")
    g(f"(() => {{ const s = GLDEBUG.game.session; s.sendHost({{k:'atk', a:{{id:'cheat1', weapon:'longsword', type:'heavy', arc:'slash', windup:.1, active:.1, recovery:.1}}}}); }})()")
    h(f"GLDEBUG.game.match.players.get('{gid}').pos.set(15, 0, 15)")
    hpc0 = hs()['hp']
    g(f"GLDEBUG.game.session.sendHost({{k:'hit', c:{{aid:'cheat1', target:'{hid}', zone:'head', p:{{x:0,y:1,z:0}}}}}})")
    g("GLDEBUG.game.session.sendHost({k:'hit', c:{aid:'nope', target:'" + hid + "', zone:'head'}})")
    H.wait_for_timeout(1500)
    check('el host rechaza golpes imposibles (distancia / ataque inexistente)', hs()['hp'] >= hpc0, f'{hpc0} -> {hs()["hp"]} (la regeneración puede sumar)')
    # matar al anfitrión → ronda para el invitado
    h(f"(() => {{ const e = GLDEBUG.game.match.players.get('{gid}'); e.allowTeleport = true; e.teleportUntil = performance.now() + 4000; }})()")
    g('GLDEBUG.teleport(14.25, -9, Math.PI/2)'); g('GLDEBUG.waitSim(0.4)'); H.wait_for_timeout(800)
    h("GLDEBUG.game.match.hostDamagePlayer(GLDEBUG.game.localId, {base: 999, zone: 'torso', attacker: '" + gid + "', noBlock: true})")
    h('GLDEBUG.waitSim(0.5)'); G.wait_for_timeout(1500)
    d1, d2 = hs()['duel'], gs()['duel']
    check('muerte y fin de ronda sincronizados', d1['s'] == 'roundEnd' and d2['s'] == 'roundEnd' and d2['sc'].get(gid) == 1, (d1, d2))
    h('GLDEBUG.waitSim(4.5)'); G.wait_for_timeout(1500)
    check('nueva ronda: ambos reaparecen con vida completa', hs()['alive'] and gs()['alive'] and hs()['hp'] == 150 and gs()['hp'] == 150, (hs()['hp'], gs()['hp'], hs()['duel']))
    H.screenshot(path=f'{OUT}/duel_host.png'); G.screenshot(path=f'{OUT}/duel_guest.png')
    # desconexión del invitado → el host espera y luego gana por abandono
    h('GL.NETWORK_CONFIG.reconnectWindowMs = 4000')
    bg.close()
    waiting = False
    for _ in range(40):   # cierre abrupto del proceso: se detecta por cierre del canal o por timeout de ping (6 s)
        waiting = h("!document.getElementById('waiting-opp').classList.contains('hidden')")
        if waiting or hs()['duel']['s'] == 'matchEnd': break
        H.wait_for_timeout(250)
    check('host detecta la desconexión del rival', waiting or hs()['duel']['s'] == 'matchEnd', hs()['duel'])
    H.wait_for_timeout(9000)
    d = hs()['duel']
    res = h("document.getElementById('results-sub').textContent")
    check('victoria por abandono tras la ventana de reconexión', d and d['s'] == 'matchEnd', f'{d} · {res}')
    print('ERRORES:', errs[:8])
    check('sin errores JS', not [e for e in errs if 'favicon' not in e])
    bh.close()
print(f"\n{sum(1 for r in results if r[1])}/{len(results)} pruebas OK")
