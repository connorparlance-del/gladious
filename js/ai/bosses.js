/* BossSystem — jefes con fases y ataques especiales (host).
 * Para añadir un jefe: define su entrada en GL.BOSS_CONFIG (config.js) y aquí un
 * objeto en BOSS_BEHAVIORS con `phaseEnter(e, phase, mgr)` y `specials` (lista de ataques). */
(function () {
    const U = GL.U;

    /* Utilidades de movimientos especiales */
    function faceTarget(e, t, rate, dt) {
        const want = Math.atan2(-(t.pos.x - e.pos.x), -(t.pos.z - e.pos.z));
        e.yaw += U.clamp(U.angleDiff(e.yaw, want), -rate * dt, rate * dt);
    }

    const BOSS_BEHAVIORS = {
        champion: {
            phaseEnter(e, phase, mgr) {
                if (phase === 2) { e.speedMult *= 1.3; e.cdMult *= 0.7; e.windupMult = 0.75; e.char.setEnraged(true); mgr.summonAdds(e, 'basic', 2); }
            },
            specials: [
                {   // salto con impacto en área
                    name: 'leap', minPhase: 1, cd: 7, range: [4, 16],
                    start(e, t) { e.special = { kind: 'leap', t: 0, from: e.pos.clone(), to: t.pos.clone(), dur: 1.0, hit: false }; e.char.play('attack', { arc: 'slam', windup: 0.45, active: 0.3, recovery: 0.6 }); return { arc: 'slam', windup: 0.45, active: 0.3, recovery: 0.6 }; },
                    update(e, dt, ctx, mgr) {
                        const s = e.special; s.t += dt;
                        const k = U.clamp((s.t - 0.35) / 0.65, 0, 1);
                        if (s.t > 0.35 && s.t < 1.0) {
                            e.pos.x = U.lerp(s.from.x, s.to.x, U.smooth(k));
                            e.pos.z = U.lerp(s.from.z, s.to.z, U.smooth(k));
                            e.airY = Math.sin(k * Math.PI) * 3.2;
                        }
                        if (s.t >= 1.0 && !s.hit) {
                            s.hit = true; e.airY = 0;
                            mgr.areaDamage(e, e.pos, 3.6, e.dmg * 1.4, { stagger: 0.6, knock: 8, fx: 'slam' });
                        }
                        return s.t < 1.6;
                    }
                },
                {   // carga en línea recta
                    name: 'charge', minPhase: 1, cd: 9, range: [5, 20],
                    start(e, t) { const d = new THREE.Vector3(t.pos.x - e.pos.x, 0, t.pos.z - e.pos.z).normalize(); e.special = { kind: 'charge', t: 0, dir: d, hitIds: new Set() }; e.char.play('roar', { duration: 0.5 }); return { arc: 'roar', windup: 0.5, active: 0, recovery: 0 }; },
                    update(e, dt, ctx, mgr) {
                        const s = e.special; s.t += dt;
                        if (s.t < 0.55) return true;
                        const sp = 13;
                        e.pos.x += s.dir.x * sp * dt; e.pos.z += s.dir.z * sp * dt;
                        e.yaw = Math.atan2(-s.dir.x, -s.dir.z);
                        e.moveSpeed = sp;
                        const blocked = ctx.physics.resolve(e.pos, e.radius, 2.5, 0.4);
                        for (const p of ctx.players) {
                            if (!p.alive || p.downed || s.hitIds.has(p.id)) continue;
                            if (Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z) < 1.4) { s.hitIds.add(p.id); mgr.damagePlayer(p.id, e.dmg * 1.2, e, { zone: 'torso', stagger: 0.5, knock: 10, dir: s.dir }); }
                        }
                        if (s.t > 0.55 + 1.2 || (blocked && s.t > 0.7)) { if (blocked) { ctx.fx.dust(e.pos, 25, 1.5); mgr.stagger(e, 1.2); } return false; }
                        return true;
                    }
                },
                {   // combo de tres golpes
                    name: 'combo', minPhase: 0, cd: 5, range: [0, 2.6],
                    start(e) { e.comboLeft = 2; return null; }
                }
            ]
        },
        executioner: {
            phaseEnter(e, phase) {
                if (phase === 2) { e.speedMult *= 1.25; e.cdMult *= 0.75; e.windupMult = 0.8; e.char.setEnraged(true); }
            },
            specials: [
                {   // torbellino
                    name: 'whirl', minPhase: 1, cd: 9, range: [0, 10],
                    start(e) { e.special = { kind: 'whirl', t: 0, tick: 0 }; e.char.play('attack', { arc: 'spin', windup: 0.4, active: 3.2, recovery: 0.6, spinTurns: 7 }); return { arc: 'spin', windup: 0.4, active: 3.2, recovery: 0.6, spinTurns: 7 }; },
                    update(e, dt, ctx, mgr) {
                        const s = e.special; s.t += dt;
                        if (s.t > 0.4 && s.t < 3.6) {
                            const t = ctx.playerMap.get(e.target);
                            if (t) { const d = new THREE.Vector3(t.pos.x - e.pos.x, 0, t.pos.z - e.pos.z); const l = d.length(); if (l > 0.5) { e.pos.addScaledVector(d.divideScalar(l), 3.4 * dt); e.moveSpeed = 3.4; } }
                            ctx.physics.resolve(e.pos, e.radius, 2.5, 0.4);
                            s.tick -= dt;
                            if (s.tick <= 0) { s.tick = 0.35; mgr.areaDamage(e, e.pos, 2.4, e.dmg * 0.45, { stagger: 0.15, knock: 4, noFx: true }); }
                        }
                        return s.t < 4.2;
                    }
                },
                {   // lanzamiento de hachas
                    name: 'axes', minPhase: 2, cd: 7, range: [4, 22],
                    start(e) { e.special = { kind: 'axes', t: 0, thrown: 0 }; return null; },
                    update(e, dt, ctx, mgr) {
                        const s = e.special; s.t += dt;
                        const t = ctx.playerMap.get(e.target);
                        if (t) faceTarget(e, t, 6, dt);
                        const want = Math.floor(s.t / 0.6);
                        if (want > s.thrown && s.thrown < 3 && t) {
                            s.thrown++;
                            e.char.play('attack', { arc: 'throw', windup: 0.25, active: 0.1, recovery: 0.2 });
                            mgr.events.push({ type: 'eatk', id: e.id, arc: 'throw', windup: 0.25, active: 0.1, recovery: 0.2 });
                            mgr.fireEnemyProjectile(e, t, 'axe', 26, e.dmg * 0.7);
                        }
                        return s.t < 2.2;
                    }
                },
                {   // golpe al suelo con onda
                    name: 'quake', minPhase: 1, cd: 8, range: [0, 4.5],
                    start(e) { e.special = { kind: 'quake', t: 0, hit: false }; e.char.play('attack', { arc: 'slam', windup: 0.7, active: 0.25, recovery: 0.8 }); return { arc: 'slam', windup: 0.7, active: 0.25, recovery: 0.8 }; },
                    update(e, dt, ctx, mgr) {
                        const s = e.special; s.t += dt;
                        if (s.t > 0.85 && !s.hit) { s.hit = true; mgr.areaDamage(e, e.pos, 5.0, e.dmg * 1.1, { stagger: 0.7, knock: 9, fx: 'slam' }); }
                        return s.t < 1.75;
                    }
                }
            ]
        }
    };

    const BossSystem = {
        BEHAVIORS: BOSS_BEHAVIORS,

        init(e) {
            e.bossState = { phase: 0, cds: {}, introT: 3.2 };
            e.windupMult = 1;
            e.invuln = 3.2;
        },

        /** Devuelve true si el jefe está ejecutando un especial (la IA normal se suspende) */
        update(e, dt, ctx, mgr) {
            const def = GL.BOSS_CONFIG[e.bossId];
            const beh = BOSS_BEHAVIORS[e.bossId];
            const bs = e.bossState;
            if (bs.introT > 0) { bs.introT -= dt; return true; }
            // fases
            const frac = e.hp / e.maxHp;
            let ph = 0;
            for (let i = 0; i < def.phases.length; i++) if (frac <= def.phases[i]) ph = i;
            if (ph > bs.phase) {
                bs.phase = ph;
                e.special = null; e.action = null;
                e.invuln = 1.6;
                e.char.play('roar', { duration: 1.5 });
                mgr.events.push({ type: 'bossPhase', id: e.id, phase: ph });
                if (beh.phaseEnter) beh.phaseEnter(e, ph, mgr);
                bs.roarT = 1.5;
            }
            if (bs.roarT > 0) { bs.roarT -= dt; return true; }
            for (const k in bs.cds) bs.cds[k] -= dt;
            if (e.special) {
                const sp = beh.specials.find((s) => s.name === e.special.kind);
                const cont = sp && sp.update ? sp.update(e, dt, ctx, mgr) : false;
                if (!cont) { e.special = null; e.airY = 0; }
                return true;
            }
            if (e.action || e.staggerT > 0) return false;
            const t = ctx.playerMap.get(e.target);
            if (!t) return false;
            const dist = Math.hypot(t.pos.x - e.pos.x, t.pos.z - e.pos.z);
            for (const sp of beh.specials) {
                if (sp.minPhase > bs.phase || (bs.cds[sp.name] || 0) > 0) continue;
                if (dist < sp.range[0] || dist > sp.range[1]) continue;
                if (Math.random() > 0.04 + bs.phase * 0.02) continue;
                bs.cds[sp.name] = sp.cd * (bs.phase === 2 ? 0.7 : 1);
                const anim = sp.start(e, t, mgr);
                if (anim) mgr.events.push(Object.assign({ type: 'eatk', id: e.id }, anim));
                return !!e.special;
            }
            return false;
        }
    };
    GL.BossSystem = BossSystem;
})();
