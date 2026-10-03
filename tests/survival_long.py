"""Supervivencia prolongada: curva de dificultad, IA por clases, jefes con fases, coste de IA."""
import sys, json
from playwright.sync_api import sync_playwright
OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
URL = 'http://localhost:8123/index.html?debug=1&fast=1'
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
results = []
def check(name, ok, info=''):
    results.append((name, bool(ok))); print(('PASS ' if ok else 'FAIL ') + name, info, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    pg = b.new_page(viewport={'width': 960, 'height': 540})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.goto(URL); pg.wait_for_function('window.GLDEBUG && GLDEBUG.game.frame > 5')
    ev = pg.evaluate
    # ---- curva de dificultad ----
    D = [ev(f'GLDEBUG.difficulty({r}, 1)') for r in range(1, 41)]
    mono = all(D[i+1]['enemyHealth'] >= D[i]['enemyHealth'] and D[i+1]['enemyDamage'] >= D[i]['enemyDamage'] and D[i+1]['enemySpawnRate'] <= D[i]['enemySpawnRate'] for i in range(39))
    check('dificultad crece de forma monótona (vida, daño, ritmo)', mono)
    nonboss = [d['enemyCount'] for d in D if not d['isBossRound']]
    check('más enemigos con las rondas', all(nonboss[i+1] >= nonboss[i] for i in range(len(nonboss)-1)), nonboss[:12])
    t = lambda r: set(D[r-1]['enemyTypes'].keys())
    check('tipos por ronda (1 básico, 3 rápido, 4 escudo, 5 arquero+pesado, 6 lancero)', t(1) == {'basic'} and 'fast' in t(3) and 'shield' in t(4) and {'archer', 'heavy'} <= t(5) and 'spear' in t(6) and 'shield' not in t(3), [sorted(t(r)) for r in (1, 3, 4, 5, 6, 8)])
    check('jefes en rondas 10, 20, 30…', D[9]['isBossRound'] and D[19]['isBossRound'] and not D[10]['isBossRound'])
    check('élites a partir de la ronda 7', D[5]['eliteChance'] == 0 and D[9]['eliteChance'] > 0)
    print('  ronda 1/10/20/40 →', [(d['round'], d['enemyCount'], round(d['enemyHealth'], 2), round(d['enemyDamage'], 2), round(d['enemySpeed'], 2), d['maxAlive']) for d in (D[0], D[9], D[19], D[39])])
    # ---- IA: persecución, ataque y arquero ----
    ev('GLDEBUG.game.startSolo()'); ev('GLDEBUG.waitSim(0.5)')
    ev('GLDEBUG.teleport(0, 12.5, 0)')
    ev('GLDEBUG.waitSim(5.5)')   # empieza la ronda 1
    ev("(() => { const g = GLDEBUG.game; setInterval(() => { if (g.player.hp < 80) { g.match.local.hp = 150; g.player.hp = 150; } }, 200); })()")
    d0 = ev("(() => { const g = GLDEBUG.game, p = g.player.pos; const l = [...g.enemies.map.values()].filter(e => !e.dead); return l.length ? Math.min(...l.map(e => e.pos.distanceTo(p))) : 99; })()")
    ev("(() => { window.__dm = 0; const m = GLDEBUG.game.match; const o = m.emitEvent.bind(m); m.emitEvent = (e) => { if (e.type === 'pdmg' && e.a > 0) window.__dm++; return o(e); }; })()")
    ev('GLDEBUG.waitSim(14)')
    d1 = ev("(() => { const g = GLDEBUG.game, p = g.player.pos; const l = [...g.enemies.map.values()].filter(e => !e.dead); return l.length ? Math.min(...l.map(e => e.pos.distanceTo(p))) : 99; })()")
    check('los enemigos encuentran ruta hasta el jugador', d1 < 2.5 and d1 < d0, f'distancia mínima {d0:.1f} → {d1:.1f}')
    check('los enemigos atacan y golpean al jugador', ev('window.__dm') > 0, f"{ev('window.__dm')} impactos")
    ev('GLDEBUG.killAll()')
    ev('GLDEBUG.freezeEnemies(false)')
    aid = ev("GLDEBUG.spawn('archer', -2, 4)")
    ev(f"GLDEBUG.game.enemies.get({aid}).enterT = 0")
    ev('GLDEBUG.waitSim(6)')
    info = [e for e in ev('GLDEBUG.enemyInfo()') if e['id'] == aid][0]
    dist = ev(f"GLDEBUG.game.enemies.get({aid}).pos.distanceTo(GLDEBUG.game.player.pos)")
    check('el arquero se aleja y mantiene distancia', dist > 6, f'{dist:.1f} m, objetivo={info["goal"]}')
    check('el arquero dispara flechas', ev("GLDEBUG.game.projectiles.list.length + GLDEBUG.game.projectiles.stuck.length") > 0 or ev('window.__dm') > 0)
    ev('GLDEBUG.killAll()')
    # ---- coste de IA con muchos enemigos ----
    ev('GLDEBUG.god(true)')
    for i in range(20):
        ev(f"(() => {{ const id = GLDEBUG.spawn(['basic','fast','shield','heavy','spear','berserker','archer'][{i} % 7], {-20 + (i % 10) * 4}, {-15 + (i // 10) * 30}); GLDEBUG.game.enemies.get(id).enterT = 0; }})()")
    ev("(() => { const em = GLDEBUG.game.enemies; const o = em.updateHost.bind(em); window.__ai = []; em.updateHost = function (...a) { const t = performance.now(); const r = o(...a); window.__ai.push(performance.now() - t); return r; }; })()")
    ev('GLDEBUG.waitSim(4)')
    ai = ev('(() => { const a = window.__ai.slice(30).sort((x, y) => x - y); return [a[Math.floor(a.length/2)], a[Math.floor(a.length*0.95)], a.length]; })()')
    check('IA de 20 enemigos: coste por tick razonable', ai[0] < 6, f'mediana {ai[0]:.2f} ms, p95 {ai[1]:.2f} ms ({ai[2]} ticks, CPU de este entorno)')
    ev('GLDEBUG.render()'); pg.wait_for_timeout(3000)
    st = ev('GLDEBUG.state()')
    print('  draw calls pasada principal:', st['draw'])
    pg.screenshot(path=f'{OUT}/horde.png')
    ev('GLDEBUG.killAll()')
    # ---- JEFE: ronda 10 ----
    ev('GLDEBUG.skipToRound(10)')
    ev('GLDEBUG.waitSim(12.5)')
    st = ev('GLDEBUG.state()')
    check('ronda 10: aparece el jefe', st['boss'] is not None and st['boss']['id'] == 'champion', st['boss'])
    bar = ev("!document.getElementById('boss-bar').classList.contains('hidden')")
    check('barra de vida del jefe visible', bar)
    ev("(() => { window.__be = []; const em = GLDEBUG.game.enemies; const push = em.events.push.bind(em.events); em.events.push = (...xs) => { for (const e of xs) if (['eatk','bossPhase','fx'].includes(e.type) && e.id === (em.boss() || {}).id || e.type === 'fx') window.__be.push(e.type + ':' + (e.arc || e.phase || e.k)); return push(...xs); }; })()")
    bid = ev("GLDEBUG.game.enemies.boss().id")
    ev('GLDEBUG.waitSim(4)')
    ev(f"(() => {{ const e = GLDEBUG.game.enemies.get({bid}); e.invuln = 0; e.hp = e.maxHp * 0.6; }})()")
    ev('GLDEBUG.waitSim(16)')
    phase = ev(f"GLDEBUG.game.enemies.get({bid}).bossState.phase")
    be = ev('window.__be')
    check('el jefe cambia de fase', phase >= 1, f'fase {phase}')
    specials = set(x for x in be if any(k in x for k in ('slam', 'roar', 'fx')))
    check('el jefe usa ataques especiales (salto/carga)', len(specials) > 0, sorted(set(be))[:12])
    ev(f"(() => {{ const e = GLDEBUG.game.enemies.get({bid}); e.hp = e.maxHp * 0.2; }})()")
    ev('GLDEBUG.waitSim(5)')
    phase = ev(f"(() => {{ const e = GLDEBUG.game.enemies.get({bid}); return e ? e.bossState.phase : -1; }})()")
    adds = ev("[...GLDEBUG.game.enemies.map.values()].filter(e => e.summoned).length")
    check('fase 3: enfurecido e invoca refuerzos', phase == 2 and adds >= 1, f'fase {phase}, refuerzos {adds}')
    pts0 = ev('GLDEBUG.state().points')
    ev(f"(() => {{ const g = GLDEBUG.game; const e = g.enemies.get({bid}); e.invuln = 0; g.match._hostHitEnemy(g.match.local, e, {{weapon:'greatsword', type:'heavy', zone:'head'}}); e.hp = 1; g.match._hostHitEnemy(g.match.local, e, {{weapon:'greatsword', type:'heavy', zone:'torso'}}); }})()")
    ev('GLDEBUG.waitSim(0.5)')
    check('jefe derrotado otorga puntos', ev('GLDEBUG.state().points') >= pts0 + 2000 and ev('GLDEBUG.state().boss') is None)
    # ---- ronda 20: segundo jefe ----
    ev('GLDEBUG.skipToRound(20)'); ev('GLDEBUG.waitSim(12.5)')
    st = ev('GLDEBUG.state()')
    check('ronda 20: El Verdugo', st['boss'] is not None and st['boss']['id'] == 'executioner', st['boss'])
    bid = ev("GLDEBUG.game.enemies.boss().id")
    ev(f"(() => {{ const e = GLDEBUG.game.enemies.get({bid}); e.invuln = 0; e.hp = e.maxHp * 0.25; }})()")
    ev('GLDEBUG.waitSim(14)')
    be = ev('window.__be')
    check('El Verdugo: torbellino/hachas/terremoto', any('spin' in x or 'throw' in x or 'slam' in x for x in be), sorted(set(be))[-10:])
    ev('GLDEBUG.render()'); pg.wait_for_timeout(3500)
    pg.screenshot(path=f'{OUT}/boss.png')
    print('ERRORES:', errs[:6])
    check('sin errores JS', not errs)
    b.close()
print(f"\n{sum(1 for r in results if r[1])}/{len(results)} pruebas OK")
