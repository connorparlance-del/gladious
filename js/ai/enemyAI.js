/* EnemyAI — comportamientos por clase. Se ejecuta SÓLO en el host (autoridad).
 * think() se llama a ~8 Hz por enemigo (escalonado); decide objetivo, punto de destino,
 * bloqueo, retirada, flanqueo y cuándo atacar. La locomoción se integra cada tick. */
(function () {
    const U = GL.U;
    const tmp = new THREE.Vector3();

    /* Perfiles de ataque por comportamiento: arcos y tiempos base (s) */
    const ATTACKS = {
        melee:    [{ arc: 'slash', windup: 0.5, active: 0.2, recovery: 0.55 }, { arc: 'thrust', windup: 0.45, active: 0.18, recovery: 0.5 }],
        skirmish: [{ arc: 'thrust', windup: 0.3, active: 0.15, recovery: 0.35 }, { arc: 'slash', windup: 0.32, active: 0.16, recovery: 0.35 }],
        shield:   [{ arc: 'thrust', windup: 0.5, active: 0.18, recovery: 0.55 }],
        heavy:    [{ arc: 'overhead', windup: 0.95, active: 0.24, recovery: 0.8, heavy: true }, { arc: 'slash', windup: 0.8, active: 0.26, recovery: 0.75, heavy: true }],
        spear:    [{ arc: 'thrust', windup: 0.5, active: 0.2, recovery: 0.55 }],
        berserk:  [{ arc: 'slash', windup: 0.32, active: 0.18, recovery: 0.3 }, { arc: 'overhead', windup: 0.4, active: 0.2, recovery: 0.35 }],
        archer:   [{ arc: 'shoot', windup: 1.0, active: 0.1, recovery: 0.6, ranged: true }]
    };

    const AI = {
        ATTACKS,

        /** Elegir objetivo: el jugador vivo más cercano por distancia de navegación */
        pickTarget(e, ctx) {
            let best = null, bd = Infinity;
            for (const p of ctx.players) {
                if (!p.alive || p.downed) continue;
                const f = ctx.fields.get(p.id);
                let d = f ? ctx.nav.distanceAt(f, e.pos.x, e.pos.y, e.pos.z) * 0.5 : Infinity;
                if (!isFinite(d)) d = e.pos.distanceTo(p.pos) * 1.5 + 20;
                // ligera preferencia por mantener el objetivo actual
                if (e.target === p.id) d *= 0.8;
                if (d < bd) { bd = d; best = p; }
            }
            e.target = best ? best.id : null;
            return best;
        },

        think(e, ctx) {
            AI._think(e, ctx);
            if (e.behavior === 'archer' || !e.target) return;
            const t = ctx.playerMap.get(e.target);
            if (!t) return;
            const dist = e.distToTarget;
            // reacción tras recibir golpes: paso atrás / lateral
            if (e.evadeT > 0) { e.goal = 'evade'; e.wantAttack = false; return; }
            // sin turno de ataque: rodear al objetivo a media distancia en vez de amontonarse
            if (!e.hasToken && !e.action && dist < 5.5 && e.los) {
                e.goal = dist < 2.4 ? 'backoff' : 'circle';
                e.wantAttack = false;
                if (e.cfg.shield) e.wantBlock = true;
            }
        },

        _think(e, ctx) {
            const tp = ctx.playerMap.get(e.target);
            if (!tp || !tp.alive || tp.downed || e.retargetT <= 0) { AI.pickTarget(e, ctx); e.retargetT = 1.2 + Math.random() * 0.6; }
            const t = ctx.playerMap.get(e.target);
            e.goal = null; e.directGoal = false;
            if (!t) { e.wantBlock = false; return; }
            const dx = t.pos.x - e.pos.x, dz = t.pos.z - e.pos.z;
            const dist = Math.hypot(dx, dz);
            e.distToTarget = dist;
            const sameLevel = Math.abs(t.pos.y - e.pos.y) < 0.7;
            tmp.set(e.pos.x, e.pos.y + 1.5 * e.scale, e.pos.z);
            const los = dist < 30 && ctx.physics.los(tmp, { x: t.pos.x, y: t.pos.y + 1.4, z: t.pos.z });
            e.los = los;
            const beh = e.behavior;
            const reach = e.attackReach;
            const ag = ctx.diff.aggression;

            // --- arquero: mantener distancia, buscar línea de visión ---
            if (beh === 'archer') {
                e.wantBlock = false;
                if (dist < 7) { e.goal = 'flee'; }
                else if (!los || dist > 20) { e.goal = 'path'; }
                else { e.goal = 'strafe'; e.strafeT = e.strafeT || (Math.random() < 0.5 ? 1 : -1); }
                e.wantAttack = los && dist > 4 && dist < 24;
                return;
            }
            // --- lancero: mantiene 1.8-2.5 m ---
            if (beh === 'spear') {
                e.wantBlock = false;
                if (los && sameLevel && dist < 1.5) e.goal = 'backoff';
                else if (los && sameLevel && dist < 2.6) e.goal = 'hold';
                else e.goal = los && sameLevel && dist < 9 ? 'direct' : 'path';
                e.wantAttack = dist < reach + 0.15 && sameLevel;
                return;
            }
            // --- escudero: avanza cubierto, baja el escudo para atacar ---
            if (beh === 'shield') {
                e.wantBlock = (dist < 7 || e.blockT > 0) && !e.action;
                e.goal = los && sameLevel && dist < 10 ? 'direct' : 'path';
                if (dist < reach * 0.8) e.goal = 'hold';
                e.wantAttack = dist < reach + 0.1 && sameLevel && Math.random() < 0.55 + ag * 0.4;
                return;
            }
            // --- rápido: golpear y huir, zigzag ---
            if (beh === 'skirmish') {
                e.wantBlock = false;
                if (e.retreatT > 0) { e.goal = 'flee'; e.wantAttack = false; return; }
                e.goal = los && sameLevel && dist < 10 ? 'zigzag' : 'path';
                e.wantAttack = dist < reach + 0.5 && sameLevel;
                return;
            }
            // --- berserker: directo, enfurece con poca vida ---
            if (beh === 'berserk') {
                e.wantBlock = false;
                if (!e.enraged && e.hp < e.maxHp * 0.5) { e.enraged = true; e.speedMult *= 1.35; e.cdMult *= 0.6; e.char && e.char.flash(0xff0000); ctx.events.push({ type: 'enrage', id: e.id }); }
                e.goal = los && sameLevel && dist < 14 ? 'direct' : 'path';
                if (dist < reach * 0.7) e.goal = 'hold';
                e.wantAttack = dist < reach + 0.6 && sameLevel;
                return;
            }
            // --- básico / pesado: flanqueo cuando hay varios sobre el mismo objetivo ---
            e.wantBlock = beh === 'melee' && e.parryChance > 0 && t.attacking && dist < 3 && Math.random() < e.parryChance;
            const crowd = ctx.targetCounts.get(e.target) || 0;
            if (los && sameLevel && dist < 14) {
                e.goal = crowd >= 3 && dist > reach + 0.6 && beh === 'melee' ? 'flank' : 'direct';
            } else e.goal = 'path';
            if (dist < reach * 0.75) e.goal = 'hold';
            e.wantAttack = dist < reach + 0.55 && sameLevel;   // la embestida cierra la distancia
        },

        /** Velocidad deseada (dirección unitaria * factor) según el objetivo actual */
        steer(e, ctx, out) {
            out.set(0, 0, 0);
            const t = ctx.playerMap.get(e.target);
            if (!t) return out;
            const dx = t.pos.x - e.pos.x, dz = t.pos.z - e.pos.z;
            const dist = Math.hypot(dx, dz) || 1;
            const fx = dx / dist, fz = dz / dist;
            const field = ctx.fields.get(e.target);
            switch (e.goal) {
                case 'direct': out.set(fx, 0, fz); break;
                case 'hold': out.set(0, 0, 0); break;
                case 'circle': {
                    // orbitar a ~3 m mirando al objetivo; cambia de sentido de vez en cuando
                    if (Math.random() < 0.006) e.flankSide = -e.flankSide;
                    const radial = (dist - 3.1) * 0.6;
                    out.set(fx * radial - fz * e.flankSide * 0.75, 0, fz * radial + fx * e.flankSide * 0.75);
                    const l = out.length(); if (l > 1) out.divideScalar(l);
                    out.multiplyScalar(0.7);
                    break;
                }
                case 'evade': {
                    const side = e.evadeSide || 1;
                    out.set(-fx * 0.8 - fz * side * 0.7, 0, -fz * 0.8 + fx * side * 0.7).normalize();
                    break;
                }
                case 'backoff': out.set(-fx * 0.7, 0, -fz * 0.7); break;
                case 'flank': {
                    const a = e.flankSide * 1.1;
                    const px = t.pos.x - (fx * Math.cos(a) - fz * Math.sin(a)) * 2.2;
                    const pz = t.pos.z - (fx * Math.sin(a) + fz * Math.cos(a)) * 2.2;
                    const gx = px - e.pos.x, gz = pz - e.pos.z, gl = Math.hypot(gx, gz) || 1;
                    out.set(gx / gl, 0, gz / gl);
                    break;
                }
                case 'zigzag': {
                    const z = Math.sin(ctx.time * 4 + e.seed) * 0.8;
                    out.set(fx - fz * z, 0, fz + fx * z).normalize();
                    break;
                }
                case 'strafe': {
                    if (Math.random() < 0.01) e.strafeT = -e.strafeT;
                    out.set(-fz * e.strafeT * 0.6, 0, fx * e.strafeT * 0.6);
                    break;
                }
                case 'flee': {
                    const st = ctx.nav.nextStep(field, e.pos.x, e.pos.y, e.pos.z, -1);
                    if (st) { const gx = st.x - e.pos.x, gz = st.z - e.pos.z, gl = Math.hypot(gx, gz) || 1; out.set(gx / gl, 0, gz / gl); }
                    else out.set(-fx, 0, -fz);
                    break;
                }
                default: { // path
                    const st = ctx.nav.nextStep(field, e.pos.x, e.pos.y, e.pos.z, 1);
                    if (st) { const gx = st.x - e.pos.x, gz = st.z - e.pos.z, gl = Math.hypot(gx, gz) || 1; out.set(gx / gl, 0, gz / gl); }
                    else out.set(fx, 0, fz);
                }
            }
            AI._avoid(e, ctx, out);
            return out;
        },

        /** Repulsión suave entre enemigos y de las trampas de fuego activas */
        _avoid(e, ctx, out) {
            let ax = 0, az = 0;
            for (const o of ctx.enemyList) {
                if (o === e || o.dead) continue;
                const dx = e.pos.x - o.pos.x, dz = e.pos.z - o.pos.z, d2 = dx * dx + dz * dz;
                if (d2 > 2.2 || d2 < 1e-4) continue;
                const d = Math.sqrt(d2), k = (1.48 - d) / 1.48;
                ax += dx / d * k; az += dz / d * k;
            }
            for (const tr of ctx.traps) {
                if (!tr.active && !tr.warn) continue;
                const dx = e.pos.x - tr.x, dz = e.pos.z - tr.z, d = Math.hypot(dx, dz);
                if (d < tr.radius + 1.6 && d > 1e-3) { const k = (tr.radius + 1.6 - d) * 1.2; ax += dx / d * k; az += dz / d * k; }
            }
            if (ax || az) { out.x += ax * 0.9; out.z += az * 0.9; const l = Math.hypot(out.x, out.z); if (l > 1) { out.x /= l; out.z /= l; } }
        },

        chooseAttack(e) {
            const list = ATTACKS[e.behavior] || ATTACKS.melee;
            e.attackIndex = (e.attackIndex || 0) + 1;
            return list[e.attackIndex % list.length];
        }
    };
    GL.EnemyAI = AI;
})();
