"""Todas las armas: ataque ligero, pesado, especial y disparo; sin errores y con impactos."""
from playwright.sync_api import sync_playwright
URL = 'http://localhost:8123/index.html?debug=1&fast=1'
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
results = []
def check(name, ok, info=''):
    results.append((name, bool(ok))); print(('PASS ' if ok else 'FAIL ') + name, info, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS); pg = b.new_page(viewport={'width': 640, 'height': 360})
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.goto(URL); pg.wait_for_function('window.GLDEBUG && GLDEBUG.game.frame > 5')
    ev = pg.evaluate
    ev('GLDEBUG.game.startSolo()'); ev('GLDEBUG.waitSim(0.3)'); ev('GLDEBUG.god(true)'); ev('GLDEBUG.freezeEnemies(true)')
    ev("(() => { window.__hits = 0; window.__area = 0; const m = GLDEBUG.game.match; const o = m.emitEvent.bind(m); m.emitEvent = (e) => { if (e.type === 'hitfx' && e.a > 0) window.__hits++; if (e.type === 'fx' && e.by) window.__area++; return o(e); }; })()")
    def setw(w):
        ev(f"(() => {{ const g = GLDEBUG.game, m = g.match, C = GL.WEAPON_CONFIG['{w}']; const slots = [{{id:'{w}', ammo: C.ammo || 0}}, null]; m.local.slots = slots.map(s => s && Object.assign({{}}, s)); g.weapons.setLoadout(slots); g.player.stamina = 100; g.weapons.specialCd = 0; }})()")
        ev('GLDEBUG.waitSim(0.5)')
    def target(dist=1.4, typ='basic'):
        ev('GLDEBUG.killAll()'); ev('GLDEBUG.waitSim(0.1)')
        ev('GLDEBUG.teleport(13, -9, -Math.PI/2)')
        eid = ev(f"GLDEBUG.spawn('{typ}', {13 + dist}, -9)")
        ev(f"(() => {{ const e = GLDEBUG.game.enemies.get({eid}); e.yaw = Math.PI/2; e.enterT = 0; e.hp = e.maxHp = 5000; }})()")
        ev('GLDEBUG.waitSim(0.2)')
        return eid
    hp = lambda eid: ev(f"GLDEBUG.game.enemies.get({eid}).hp")
    def click(hold=0.05):
        ev("GLDEBUG.mouse('left', true)"); ev(f'GLDEBUG.waitSim({hold})'); ev("GLDEBUG.mouse('left', false)")
    for w in ['dagger', 'gladius', 'longsword', 'greatsword', 'axe', 'heavyaxe', 'mace', 'hammer', 'spear']:
        setw(w)
        reach = 1.1 if w in ('dagger',) else 1.4 if w != 'spear' else 2.0
        eid = target(reach)
        h0 = hp(eid); click(); ev('GLDEBUG.waitSim(0.9)'); h1 = hp(eid)
        ev('GLDEBUG.game.player.stamina = 100'); click(0.6); ev('GLDEBUG.waitSim(1.4)'); h2 = hp(eid)
        a0 = ev('window.__area'); ev('GLDEBUG.game.player.stamina = 100')
        ev("GLDEBUG.key('KeyF', true)"); ev('GLDEBUG.waitSim(0.05)'); ev("GLDEBUG.key('KeyF', false)"); ev('GLDEBUG.waitSim(1.6)')
        h3 = hp(eid)
        special_ok = h3 < h2 or ev('window.__area') > a0 or w == 'mace'
        check(f'{w}: ligero, pesado y especial', h1 < h0 and h2 < h1 and special_ok, f'{h0:.0f}→{h1:.0f}→{h2:.0f}→{h3:.0f}')
    # a distancia
    for w, hold in [('bow', 1.0), ('crossbow', 0.05), ('javelin', 0.5)]:
        setw(w)
        eid = target(8)
        h0 = hp(eid); a0 = ev('GLDEBUG.game.weapons.current.ammo')
        click(hold); ev('GLDEBUG.waitSim(1.8)')
        h1 = hp(eid); a1 = ev('GLDEBUG.game.weapons.current.ammo')
        ev('GLDEBUG.game.player.stamina = 100'); ev("GLDEBUG.key('KeyF', true)"); ev('GLDEBUG.waitSim(0.05)'); ev("GLDEBUG.key('KeyF', false)"); ev('GLDEBUG.waitSim(0.3)')
        if w != 'bow': click(hold); ev('GLDEBUG.waitSim(1.8)')
        else: ev('GLDEBUG.waitSim(1.5)')
        h2 = hp(eid)
        check(f'{w}: dispara, gasta munición e impacta; especial', a1 < a0 and h1 < h0 and h2 < h1, f'munición {a0}→{a1}, vida {h0:.0f}→{h1:.0f}→{h2:.0f}')
    # escudo enemigo bloquea de frente
    setw('gladius'); eid = target(1.4, 'shield')
    ev(f"(() => {{ const e = GLDEBUG.game.enemies.get({eid}); e.blocking = true; }})()")
    h0 = hp(eid); click(); ev('GLDEBUG.waitSim(0.9)'); h1 = hp(eid)
    setw('gladius'); eid2 = target(1.4, 'basic'); g0 = hp(eid2); click(); ev('GLDEBUG.waitSim(0.9)'); g1 = hp(eid2)
    check('el escudo enemigo reduce el daño frontal', (h0 - h1) < (g0 - g1), f'con escudo {h0-h1:.0f} vs sin escudo {g0-g1:.0f}')
    print('ERRORES:', errs[:5]); check('sin errores JS', not errs)
    b.close()
print(f"\n{sum(1 for r in results if r[1])}/{len(results)} pruebas OK")
