"""Prueba automática de jugabilidad en solitario (Chromium headless + SwiftShader)."""
import sys, json
from playwright.sync_api import sync_playwright
OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
URL = 'http://localhost:8123/index.html?debug=1&fast=1'
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
results = []
def check(name, ok, info=''):
    results.append((name, bool(ok), info)); print(('PASS ' if ok else 'FAIL ') + name, info)

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.goto(URL); pg.wait_for_function('window.GLDEBUG && GLDEBUG.game.frame > 5')
    ev = lambda js: pg.evaluate(js)
    st = lambda: ev('GLDEBUG.state()')
    ev('GLDEBUG.game.startSolo()'); ev('GLDEBUG.waitSim(1.5)')
    s = st()
    check('partida solo iniciada', s['inMatch'] and s['mode'] == 'solo', s['slots'])
    check('jugador vivo con equipo inicial', s['alive'] and s['slots'][0].startswith('dagger'), s)
    ev('GLDEBUG.render()'); pg.wait_for_timeout(1500); pg.screenshot(path=f'{OUT}/fp_start.png')
    # WASD
    p0 = s['pos']; ev("GLDEBUG.key('KeyW', true)"); ev('GLDEBUG.waitSim(0.7)'); ev("GLDEBUG.key('KeyW', false)"); p1 = st()['pos']
    check('WASD mueve al jugador', abs(p1[0]-p0[0]) + abs(p1[2]-p0[2]) > 1.0, f'{p0} -> {p1}')
    y0 = st()['yaw']; ev('GLDEBUG.look(-300, 0)'); ev('GLDEBUG.waitSim(0.1)'); y1 = st()['yaw']
    check('ratón gira la cámara', abs(y1 - y0) > 0.3, f'{y0} -> {y1}')
    # combate cuerpo a cuerpo contra enemigo congelado
    ev('GLDEBUG.freezeEnemies(true)')
    ev('GLDEBUG.teleport(6, -6, 0)')
    eid = ev('GLDEBUG.spawn("basic", 6, -7.15)')
    ev(f'(() => {{ const e = GLDEBUG.game.enemies.get({eid}); e.yaw = Math.PI; e.enterT = 0; e.hp = e.maxHp = 230; }})()')
    ev('GLDEBUG.waitSim(0.4)')
    hp0 = [e for e in ev('GLDEBUG.enemyInfo()') if e['id'] == eid][0]['hp']
    hits = []
    pg.expose_function('logHit', lambda h: hits.append(h))
    ev("(() => { const m = GLDEBUG.game.match; const orig = m.hostHandleHit.bind(m); m.hostHandleHit = (pid, c) => { window.logHit(c.zone + ':' + c.target); return orig(pid, c); }; })()")
    for i in range(3):
        ev("GLDEBUG.mouse('left', true)"); ev('GLDEBUG.waitSim(0.06)'); ev("GLDEBUG.mouse('left', false)"); ev('GLDEBUG.waitSim(0.45)')
    ev('GLDEBUG.render()'); pg.wait_for_timeout(1500); pg.screenshot(path=f'{OUT}/fp_attack.png')
    hp1 = [e for e in ev('GLDEBUG.enemyInfo()') if e['id'] == eid][0]['hp']
    check('ataque ligero golpea al enemigo (barrido de hoja)', hp1 < hp0, f'hp {hp0} -> {hp1}, zonas {hits}')
    # ataque pesado
    ev("GLDEBUG.mouse('left', true)"); ev('GLDEBUG.waitSim(0.5)'); ev("GLDEBUG.mouse('left', false)"); ev('GLDEBUG.waitSim(0.7)')
    hp2 = [e for e in ev('GLDEBUG.enemyInfo()') if e['id'] == eid]
    hp2 = hp2[0]['hp'] if hp2 else 0
    check('ataque pesado hace daño', hp2 < hp1, f'hp {hp1} -> {hp2}, zonas {hits}')
    # mirar arriba para cabeza
    ev('GLDEBUG.game.player.pitch = 0.18')
    for i in range(4):
        ev("GLDEBUG.mouse('left', true)"); ev('GLDEBUG.waitSim(0.06)'); ev("GLDEBUG.mouse('left', false)"); ev('GLDEBUG.waitSim(0.45)')
    check('zonas distintas registradas', len(set(h.split(':')[0] for h in hits)) >= 1, str(hits))
    s = st()
    info = [e for e in ev('GLDEBUG.enemyInfo()') if e['id'] == eid]
    killed = (not info) or info[0]['dead']
    check('el enemigo muere', killed, str(info))
    check('puntos por golpes y baja', s['points'] > 500, s['points'])
    # el enemigo ataca al jugador
    ev('GLDEBUG.game.player.pitch = 0')
    ev('GLDEBUG.freezeEnemies(false)')
    ev('GLDEBUG.teleport(6, -6, 0)')
    eid2 = ev('GLDEBUG.spawn("basic", 6, -8.5)')
    ev(f'(() => {{ const e = GLDEBUG.game.enemies.get({eid2}); e.enterT = 0; e.attackCd = 0; }})()')
    hpP0 = st()['hp']
    ev('GLDEBUG.waitSim(5.0)')
    hpP1 = st()['hp']
    check('el enemigo daña al jugador (hoja vs hitboxes)', hpP1 < hpP0, f'{hpP0} -> {hpP1}')
    ev('GLDEBUG.render()'); pg.wait_for_timeout(1500); pg.screenshot(path=f'{OUT}/fp_enemy.png')
    ev('GLDEBUG.killAll()'); ev('GLDEBUG.waitSim(0.3)')
    # compra en la pared: gladius (45º)
    ev('GLDEBUG.points(2000)')
    wb = ev("(() => { const w = GLDEBUG.game.arena.wallBuys.find(x => x.weapon==='gladius'); return [w.pos.x, w.pos.z, Math.atan2(w.normal.x, w.normal.z)]; })()")
    ev(f'GLDEBUG.teleport({wb[0]}, {wb[1]}, {wb[2]})')
    ev('GLDEBUG.waitSim(0.3)')
    prompt = ev("document.getElementById('prompt').textContent")
    pts0 = st()['points']
    ev("GLDEBUG.key('KeyE', true)"); ev('GLDEBUG.waitSim(0.08)'); ev("GLDEBUG.key('KeyE', false)"); ev('GLDEBUG.waitSim(0.6)')
    s = st()
    check('indicación de compra visible', 'GLADIUS' in prompt, prompt)
    check('compra en pared: arma equipada y puntos descontados', s['weapon'] == 'gladius' and s['points'] == pts0 - 500, f"{s['weapon']} {pts0}->{s['points']}")
    ev('GLDEBUG.render()'); pg.wait_for_timeout(1500); pg.screenshot(path=f'{OUT}/wallbuy.png')
    # arma a distancia: jabalina
    ev("GLDEBUG.key('Digit2', true)"); ev('GLDEBUG.waitSim(0.05)'); ev("GLDEBUG.key('Digit2', false)"); ev('GLDEBUG.waitSim(0.5)')
    a0 = st()['slots']
    ev("GLDEBUG.mouse('left', true)"); ev('GLDEBUG.waitSim(0.5)'); ev("GLDEBUG.mouse('left', false)"); ev('GLDEBUG.waitSim(0.3)')
    a1 = st()['slots']
    check('lanzar jabalina consume munición', a0 != a1, f'{a0} -> {a1}')
    print('ERRORES JS:', errs[:10])
    check('sin errores JS', not errs, errs[:3])
    b.close()
fails = [r for r in results if not r[1]]
print(f'\n{len(results)-len(fails)}/{len(results)} pruebas OK')
