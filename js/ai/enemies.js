/* EnemySystem — gestión de enemigos.
 *  HOST: spawn, IA, locomoción, ataques (barrido de hoja contra hitboxes de jugadores),
 *        daño autoritativo, muertes. Genera eventos y snapshots para la red.
 *  CLIENTE: recrea los enemigos a partir de eventos/snapshots e interpola. */
(function () {
    const U = GL.U;
    const steerV = new THREE.Vector3(), sepV = new THREE.Vector3();
    const bA = new THREE.Vector3(), bB = new THREE.Vector3();

    const LOOK = {
        basic:     { helmet: 'galea', armor: 'media', weapon: 'gladius' },
        fast:      { helmet: 'hood', armor: 'ligera', weapon: 'dagger' },
        shield:    { helmet: 'visor', armor: 'media', weapon: 'gladius', shield: 'scutum' },
        heavy:     { helmet: 'visor', armor: 'pesada', weapon: 'heavyaxe' },
        archer:    { helmet: 'hood', armor: 'ligera', weapon: 'bow' },
        spear:     { helmet: 'galea', armor: 'media', weapon: 'spear', shield: 'round' },
        berserker: { helmet: 'horned', armor: 'ligera', weapon: 'axe', cape: 0x3a0a0a }
    };
    const BOSS_LOOK = {
        champion: { helmet: 'crest', armor: 'gold', weapon: 'longsword', shield: 'round', cape: 0x8a1010 },
        executioner: { helmet: 'visor', armor: 'pesada', weapon: 'heavyaxe', cape: 0x111111 }
    };

    class EnemyManager {
        constructor(game) {
            this.game = game;
            this.map = new Map();
            this.nextId = 1;
            this.events = [];
            this.aiCursor = 0;
            this.ctx = null;
            this.fieldTimer = 0;
            this.targetCounts = new Map();
        }

        get aliveCount() { let n = 0; for (const e of this.map.values()) if (!e.dead) n++; return n; }

        _makeCharacter(e) {
            const look = e.bossId ? BOSS_LOOK[e.bossId] : LOOK[e.type];
            const color = e.bossId ? GL.BOSS_CONFIG[e.bossId].color : GL.ENEMY_CONFIG[e.type].color;
            const ch = new GL.Character({
                scale: e.scale, color, armor: look.armor, helmet: look.helmet, shield: look.shield || null,
                weapon: look.weapon, cape: look.cape || null, elite: e.elite, boss: !!e.bossId
            });
            this.game.scene.add(ch.root);
            ch.root.position.copy(e.pos);
            return ch;
        }

        _baseEntity(id, type, pos, opts) {
            const cfg = opts.bossId ? GL.BOSS_CONFIG[opts.bossId] : GL.ENEMY_CONFIG[type];
            const scale = (cfg.scale || 1) * (opts.elite ? GL.ELITE_CONFIG.scale : 1);
            return {
                id, type, bossId: opts.bossId || null, elite: !!opts.elite, cfg,
                pos: pos.clone(), vel: new THREE.Vector3(), yaw: opts.yaw || 0, airY: 0,
                hp: opts.hp, maxHp: opts.maxHp, scale, radius: 0.38 * scale,
                behavior: opts.bossId ? 'melee' : cfg.behavior,
                dead: false, deathT: 0, staggerT: 0, invuln: 0, blocking: false,
                seed: Math.random() * 100, flankSide: Math.random() < 0.5 ? -1 : 1,
                interp: [], moveSpeed: 0, enraged: false
            };
        }

        /* ===================== HOST ===================== */
        spawn(type, point, diff, opts) {
            const o = opts || {};
            const id = this.nextId++;
            let hp, dmg, speed;
            if (o.bossId) {
                const b = GL.BOSS_CONFIG[o.bossId];
                const pc = Math.max(1, o.playerCount || 1);
                hp = b.hp * (0.6 + 0.4 * diff.enemyHealth) * (1 + (pc - 1) * 0.6);
                dmg = b.dmg * diff.enemyDamage; speed = b.speed;
            } else {
                const c = GL.ENEMY_CONFIG[type];
                hp = c.hp * diff.enemyHealth * (o.elite ? GL.ELITE_CONFIG.hpMult : 1);
                dmg = c.dmg * diff.enemyDamage * (o.elite ? GL.ELITE_CONFIG.dmgMult : 1);
                speed = c.speed * diff.enemySpeed * (o.elite ? GL.ELITE_CONFIG.speedMult : 1);
            }
            const e = this._baseEntity(id, type, point.pos, { bossId: o.bossId, elite: o.elite, hp: Math.round(hp), maxHp: Math.round(hp), yaw: 0 });
            e.dmg = dmg; e.baseSpeed = speed; e.speedMult = 1; e.cdMult = 1 / diff.enemyAttackSpeed; e.windupMult = 1;
            e.attackCd = 1 + Math.random(); e.retargetT = 0; e.aiT = Math.random() * 0.12;
            e.attackReach = (e.cfg.ranged ? e.cfg.reach : (e.cfg.reach + 0.5)) * (e.bossId ? 1.25 : 1) * (e.scale > 1 ? 1 + (e.scale - 1) * 0.6 : 1);
            e.parryChance = e.elite ? 0.25 : 0;
            e.exit = point.exit ? point.exit.clone() : null;
            e.enterT = point.exit ? 1.8 : 0;
            e.stuckT = 0; e.lastProgressPos = e.pos.clone();
            e.retreatT = 0;
            e.char = this._makeCharacter(e);
            if (e.bossId) GL.BossSystem.init(e);
            this.map.set(id, e);
            this.events.push({ type: 'espawn', id, t: type, b: e.bossId, el: e.elite ? 1 : 0, x: U.round(e.pos.x), y: U.round(e.pos.y), z: U.round(e.pos.z), hp: e.maxHp });
            return e;
        }

        summonAdds(boss, type, n) {
            const diff = this.game.match.diff || GL.calculateDifficulty(1, 1);
            for (let i = 0; i < n; i++) {
                const a = i / n * Math.PI * 2;
                const pos = boss.pos.clone().add(new THREE.Vector3(Math.cos(a) * 2.5, 0, Math.sin(a) * 2.5));
                this.game.physics.resolve(pos, 0.4, 1.8, 0.4);
                const e = this.spawn(type, { pos }, diff, {});
                e.summoned = true;
                this.game.fx.dust(pos, 20, 1);
            }
            this.game.match.onAddsSummoned && this.game.match.onAddsSummoned(n);
        }

        stagger(e, t) {
            if (e.dead) return;
            const resist = e.cfg.staggerResist || (e.bossId ? 0.85 : 0);
            const st = t * (1 - resist);
            if (st < 0.12) return;
            e.staggerT = Math.max(e.staggerT, st);
            e.action = null;
            e.char.play('stagger', { duration: st });
            this.events.push({ type: 'estag', id: e.id, d: U.round(st, 2) });
        }

        /** Contexto de IA reconstruido cada tick a partir del estado de jugadores (host) */
        buildCtx(players, diff, time) {
            if (!this.ctx) this.ctx = { playerMap: new Map(), fields: new Map(), events: this.events };
            const c = this.ctx;
            c.players = players; c.diff = diff; c.time = time;
            c.nav = this.game.nav; c.physics = this.game.physics; c.fx = this.game.fx;
            c.playerMap.clear();
            for (const p of players) c.playerMap.set(p.id, p);
            c.fields = this._fields;
            c.targetCounts = this.targetCounts;
            c.enemyList = Array.from(this.map.values());
            c.traps = this.game.arena.fireTraps;
            return c;
        }

        updateHost(dt, players, diff, time) {
            const ctx = this.buildCtx(players, diff, time);
            // campos de flujo: uno por jugador, recalculo escalonado
            if (!this._fields) this._fields = new Map();
            ctx.fields = this._fields;
            this.fieldTimer -= dt;
            if (this.fieldTimer <= 0 && players.length) {
                this.fieldIdx = ((this.fieldIdx || 0) + 1) % players.length;
                const p = players[this.fieldIdx];
                if (p && p.alive) this._fields.set(p.id, this.game.nav.computeField(p.id, p.pos.x, p.pos.y, p.pos.z));
                this.fieldTimer = 0.35 / Math.max(1, players.length);
            }
            for (const p of players) if (!this._fields.has(p.id) && p.alive) this._fields.set(p.id, this.game.nav.computeField(p.id, p.pos.x, p.pos.y, p.pos.z));
            // conteo de enemigos por objetivo (para flanqueo)
            this.targetCounts.clear();
            for (const e of this.map.values()) if (!e.dead && e.target) this.targetCounts.set(e.target, (this.targetCounts.get(e.target) || 0) + 1);
            // turnos de ataque: sólo los N más cercanos a cada jugador pueden atacar a la vez
            this.tokenT = (this.tokenT || 0) - dt;
            if (this.tokenT <= 0) {
                this.tokenT = 0.3;
                const maxTok = Math.min(5, 2 + Math.floor(((diff && diff.round) || 1) / 6));
                const byTarget = new Map();
                for (const e of this.map.values()) {
                    if (e.dead || e.enterT > 0 || !e.target) continue;
                    e.hasToken = e.behavior === 'archer' || !!e.bossId;
                    if (e.hasToken) continue;
                    if (!byTarget.has(e.target)) byTarget.set(e.target, []);
                    byTarget.get(e.target).push(e);
                }
                for (const list of byTarget.values()) {
                    list.sort((a, b) => (b.action ? 1 : 0) - (a.action ? 1 : 0) || (a.distToTarget || 99) - (b.distToTarget || 99));
                    list.forEach((e, i) => { e.hasToken = i < maxTok; });
                }
            }
            // pensar escalonado: ~8 Hz por enemigo
            const all = Array.from(this.map.values());
            for (const e of all) {
                if (e.dead) { this._updateDead(e, dt); continue; }
                e.aiT -= dt; e.retargetT -= dt;
                if (e.aiT <= 0 && !e.enterT) { e.aiT = 0.12 + Math.random() * 0.04; GL.EnemyAI.think(e, ctx); }
                this._updateHostEntity(e, dt, ctx);
            }
            this._separate();
            for (const e of this.map.values()) this._syncVisual(e, dt);
        }

        _updateHostEntity(e, dt, ctx) {
            if (e.invuln > 0) e.invuln -= dt;
            if (e.retreatT > 0) e.retreatT -= dt;
            if (e.evadeT > 0) e.evadeT -= dt;
            if (e.blockT > 0) e.blockT -= dt;
            e.attackCd -= dt;
            e.moveSpeed = 0;
            // entrada por el túnel
            if (e.enterT > 0) {
                e.enterT -= dt;
                const dx = e.exit.x - e.pos.x, dz = e.exit.z - e.pos.z, d = Math.hypot(dx, dz);
                if (d > 0.3) { const sp = Math.min(e.baseSpeed, 3.2); e.pos.x += dx / d * sp * dt; e.pos.z += dz / d * sp * dt; e.yaw = Math.atan2(-dx, -dz); e.moveSpeed = sp; }
                else e.enterT = 0;
                if (e.enterT <= 0) { e.enterT = 0; GL.EnemyAI.think(e, ctx); }
                return;
            }
            if (e.staggerT > 0) { e.staggerT -= dt; return; }
            // jefe
            if (e.bossId && GL.BossSystem.update(e, dt, ctx, this)) return;

            const t = ctx.playerMap.get(e.target);
            // acción de ataque en curso
            if (e.action) { this._updateAttack(e, dt, ctx, t); return; }

            // bloqueo
            e.blocking = !!e.wantBlock && !!e.cfg.shield || (e.wantBlock && e.parryChance > 0);
            // iniciar ataque
            if (t && e.wantAttack && e.attackCd <= 0) {
                const want = Math.atan2(-(t.pos.x - e.pos.x), -(t.pos.z - e.pos.z));
                if (Math.abs(U.angleDiff(e.yaw, want)) < 0.6) {
                    if (e.comboLeft > 0) e.comboLeft--;
                    this._startAttack(e, GL.EnemyAI.chooseAttack(e));
                    return;
                }
            }
            // locomoción
            GL.EnemyAI.steer(e, ctx, steerV);
            let speed = e.baseSpeed * e.speedMult;
            if (e.blocking) speed *= 0.55;
            if (e.goal === 'strafe' || e.goal === 'backoff' || e.goal === 'circle') speed *= 0.6;
            if (e.goal === 'evade') speed *= 1.25;
            const tvx = steerV.x * speed, tvz = steerV.z * speed;
            e.vel.x = U.damp(e.vel.x, tvx, 8, dt); e.vel.z = U.damp(e.vel.z, tvz, 8, dt);
            this._integrate(e, dt);
            // orientación: hacia el objetivo si está cerca, si no hacia el movimiento
            let want = e.yaw;
            if (t && (e.distToTarget < 6 || e.goal === 'strafe' || e.goal === 'hold' || e.goal === 'backoff' || e.goal === 'circle' || e.goal === 'evade')) want = Math.atan2(-(t.pos.x - e.pos.x), -(t.pos.z - e.pos.z));
            else if (Math.hypot(e.vel.x, e.vel.z) > 0.3) want = Math.atan2(-e.vel.x, -e.vel.z);
            e.yaw += U.clamp(U.angleDiff(e.yaw, want), -9.5 * dt, 9.5 * dt);
            // atasco
            e.stuckT += dt;
            if (e.stuckT > 2.5) {
                const moved = e.pos.distanceTo(e.lastProgressPos);
                if (moved < 0.6 && e.goal !== 'hold' && e.goal !== 'strafe') { e.flankSide = -e.flankSide; e.vel.x += (Math.random() - 0.5) * 6; e.vel.z += (Math.random() - 0.5) * 6; e.stuckCount = (e.stuckCount || 0) + 1; }
                else e.stuckCount = 0;
                if (e.stuckCount > 6) this._unstick(e);
                e.stuckT = 0; e.lastProgressPos.copy(e.pos);
            }
        }

        _unstick(e) {
            const sp = this.game.match.pickSpawnPoint && this.game.match.pickSpawnPoint();
            if (sp) { e.pos.copy(sp.pos); e.exit = sp.exit ? sp.exit.clone() : null; e.enterT = sp.exit ? 1.8 : 0; }
            e.stuckCount = 0;
        }

        _integrate(e, dt) {
            const phys = this.game.physics;
            e.pos.x += e.vel.x * dt; e.pos.z += e.vel.z * dt;
            phys.resolve(e.pos, e.radius, 1.75 * e.scale, 0.45);
            const gh = phys.groundHeight(e.pos.x, e.pos.z, e.pos.y, e.radius, 0.45);
            if (e.pos.y > gh + 0.05) { e.vy = (e.vy || 0) - GL.GAME_CONFIG.gravity * dt; e.pos.y = Math.max(gh, e.pos.y + e.vy * dt); }
            else { e.pos.y = gh; e.vy = 0; }
            e.moveSpeed = Math.hypot(e.vel.x, e.vel.z);
        }

        _separate() {
            const list = [];
            for (const e of this.map.values()) if (!e.dead) list.push(e);
            for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
                const a = list[i], b = list[j];
                const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz), min = a.radius + b.radius + 0.1;
                if (d < min && d > 1e-4 && Math.abs(a.pos.y - b.pos.y) < 1) {
                    const push = (min - d) * 0.5, nx = dx / d, nz = dz / d;
                    a.pos.x -= nx * push; a.pos.z -= nz * push; b.pos.x += nx * push; b.pos.z += nz * push;
                }
            }
            // no atravesar jugadores
            if (this.ctx) for (const e of list) for (const p of this.ctx.players) {
                if (!p.alive) continue;
                const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z, d = Math.hypot(dx, dz), min = e.radius + 0.36;
                if (d < min && d > 1e-4 && Math.abs(e.pos.y - p.pos.y) < 1.2) { e.pos.x = p.pos.x + dx / d * min; e.pos.z = p.pos.z + dz / d * min; }
            }
        }

        _startAttack(e, prof) {
            const wm = e.windupMult || 1;
            const k = e.cdMult;
            const a = { arc: prof.arc, windup: prof.windup * wm * (e.elite ? 0.85 : 1), active: prof.active, recovery: prof.recovery * k, t: 0, hitIds: new Set(), ranged: !!prof.ranged, heavy: !!prof.heavy, hasPrev: false };
            e.action = a;
            e.blocking = false;
            e.attackCd = (e.cfg.attackCd || 1.5) * k * (0.8 + Math.random() * 0.4) + (e.comboLeft > 0 ? -10 : 0);
            e.char.play('attack', { arc: a.arc, windup: a.windup, active: a.active, recovery: a.recovery });
            this.events.push({ type: 'eatk', id: e.id, arc: a.arc, windup: U.round(a.windup, 2), active: U.round(a.active, 2), recovery: U.round(a.recovery, 2) });
            if (!a.ranged) this.game.audio.play(a.heavy ? 'swingHeavy' : 'swing', { pos: e.pos, vol: 0.8, pitch: 0.9 });
        }

        _updateAttack(e, dt, ctx, t) {
            const a = e.action;
            a.t += dt;
            // girar hacia el objetivo durante la preparación (más lento al final: permite esquivar)
            if (t && a.t < a.windup) {
                const want = Math.atan2(-(t.pos.x - e.pos.x), -(t.pos.z - e.pos.z));
                const rate = a.t < a.windup * 0.6 ? 6 : 2;
                e.yaw += U.clamp(U.angleDiff(e.yaw, want), -rate * dt, rate * dt);
                // avance ligero al atacar
                const dx = t.pos.x - e.pos.x, dz = t.pos.z - e.pos.z, d = Math.hypot(dx, dz) || 1;
                if (a.t > a.windup * 0.3 && d > e.attackReach * 0.72 && !a.ranged) {
                    const sp = Math.min(5.0, e.baseSpeed * 1.35);
                    e.vel.x = dx / d * sp; e.vel.z = dz / d * sp;
                    this._integrate(e, dt);
                }
            }
            const activeStart = a.windup, activeEnd = a.windup + a.active;
            if (a.ranged) {
                if (!a.fired && a.t >= activeStart && t) { a.fired = true; this.fireEnemyProjectile(e, t, 'arrow', 38, e.dmg); }
            } else if (a.t >= activeStart && a.t <= activeEnd + 0.02) {
                // barrido de hoja contra jugadores
                if (e.char.bladeSegment(bA, bB)) {
                    if (a.hasPrev) {
                        const targets = this.game.match.playerHitTargets();
                        const hits = GL.Hit.sweepBlade(a.prevA, a.prevB, bA, bB, 0.06 * e.scale, targets, a.hitIds);
                        for (const h of hits) {
                            a.hitIds.add(h.id);
                            this.damagePlayer(h.id, e.dmg * (a.heavy ? 1.4 : 1), e, { zone: h.zone, point: h.point, stagger: a.heavy ? 0.4 : 0.1, knock: a.heavy ? 5 : 2 });
                        }
                    } else { a.prevA = new THREE.Vector3(); a.prevB = new THREE.Vector3(); }
                    a.prevA.copy(bA); a.prevB.copy(bB); a.hasPrev = true;
                }
                if (a.heavy && !a.slamFx && a.t >= activeEnd - 0.05 && a.arc === 'overhead') { a.slamFx = true; this.game.fx.dust(bB, 10, 0.6); }
            }
            if (a.t >= a.windup + a.active + a.recovery) {
                e.action = null;
                if (e.behavior === 'skirmish') e.retreatT = 1.0 + Math.random() * 0.6;
                if (e.comboLeft > 0) e.attackCd = 0;
                else if (!a.ranged && (e.behavior === 'melee' || e.behavior === 'berserk') && Math.random() < 0.18 + (ctx.diff ? ctx.diff.aggression * 0.25 : 0)) { e.comboLeft = 1; e.attackCd = 0.05; }
            }
        }

        /** Daño de un enemigo a un jugador (el match aplica bloqueo/armadura y lo sincroniza) */
        damagePlayer(pid, amount, e, opts) {
            const o = opts || {};
            this.game.match.hostDamagePlayer(pid, {
                base: amount, zone: o.zone || 'torso', attacker: 'e' + e.id,
                attackerPos: e.pos, point: o.point, stagger: o.stagger || 0, knock: o.knock || 0, dir: o.dir, area: !!o.area, proj: !!o.proj
            });
        }

        areaDamage(e, center, radius, dmg, opts) {
            const o = opts || {};
            if (!o.noFx) this.events.push({ type: 'fx', k: o.fx || 'slam', x: U.round(center.x), y: U.round(center.y), z: U.round(center.z), r: radius });
            for (const p of this.ctx.players) {
                if (!p.alive || p.downed) continue;
                const d = Math.hypot(p.pos.x - center.x, p.pos.z - center.z);
                if (d > radius || Math.abs(p.pos.y - center.y) > 2.2) continue;
                const dir = new THREE.Vector3(p.pos.x - center.x, 0, p.pos.z - center.z).normalize();
                this.damagePlayer(p.id, dmg * (1 - d / radius * 0.4), e, { zone: 'torso', stagger: o.stagger, knock: o.knock, dir, area: true });
            }
        }

        fireEnemyProjectile(e, t, kind, speed, dmg) {
            const origin = e.pos.clone(); origin.y += 1.45 * e.scale;
            const fwd = new THREE.Vector3(-Math.sin(e.yaw), 0, -Math.cos(e.yaw));
            origin.addScaledVector(fwd, 0.5);
            // predicción simple de la posición del jugador
            const target = new THREE.Vector3(t.pos.x, t.pos.y + 1.2, t.pos.z);
            const dist = origin.distanceTo(target);
            const tof = dist / speed;
            if (t.vel) target.addScaledVector(t.vel, tof * 0.7);
            const gs = kind === 'axe' ? 0.6 : 0.45;
            target.y += 0.5 * GL.GAME_CONFIG.gravity * gs * tof * tof;
            const diff = this.game.match.diff || { round: 1 };
            const spread = Math.max(0.012, 0.06 - (diff.round || 1) * 0.002);
            const dir = target.sub(origin).normalize();
            dir.x += (Math.random() - 0.5) * spread; dir.y += (Math.random() - 0.5) * spread; dir.z += (Math.random() - 0.5) * spread;
            dir.normalize();
            const id = 'e' + e.id + ':' + (this.projSeq = (this.projSeq || 0) + 1);
            this.game.match.hostEnemyProjectile({ id, kind, owner: 'e' + e.id, origin: { x: origin.x, y: origin.y, z: origin.z }, dir: { x: dir.x, y: dir.y, z: dir.z }, speed, gravityScale: gs, dmg });
            this.game.audio.play(kind === 'axe' ? 'throw' : 'bowRelease', { pos: e.pos });
        }

        /** Daño autoritativo a un enemigo (host). Devuelve info para puntos/efectos */
        damageEnemy(id, res, attackerId, point, dir) {
            const e = this.map.get(id);
            if (!e || e.dead) return null;
            if (e.invuln > 0 || e.enterT > 0 && e.bossId) return { immune: true, e };
            e.hp -= res.amount;
            if (res.stagger && !res.blocked) this.stagger(e, res.stagger);
            if (res.stun) this.stagger(e, res.stun);
            if (res.parried) { this.stagger(e, 0.4); }
            if (dir && !e.bossId && res.amount > 0) { e.vel.x += dir.x * 2; e.vel.z += dir.z * 2; }
            // un enemigo golpeado suele centrarse en su atacante
            if (attackerId && !String(attackerId).startsWith('e') && Math.random() < 0.4) { e.target = attackerId; e.retargetT = 2; }
            const killed = e.hp <= 0;
            if (killed) this.kill(e, dir);
            return { e, killed };
        }

        kill(e, dir) {
            if (e.dead) return;
            e.dead = true; e.hp = 0; e.deathT = 0; e.action = null; e.special = null;
            this.events.push({ type: 'edie', id: e.id, dx: dir ? U.round(dir.x) : 0, dz: dir ? U.round(dir.z) : 0 });
            this._deathFx(e, dir);
        }

        _deathFx(e, dir) {
            e.fling = dir ? { x: dir.x * 4.5, z: dir.z * 4.5, y: 2.2 } : { x: 0, z: 0, y: 1 };
            if (dir) e.yaw = Math.atan2(dir.x, dir.z);   // cae hacia atrás, alejándose del golpe
            const p = e.pos.clone(); p.y += 1.0 * e.scale;
            this.game.fx.blood(p, dir, 2.2);
            this.game.audio.play('enemyDeath', { pos: e.pos, pitch: e.bossId ? 0.6 : U.rand(0.85, 1.15) });
            if (e.char.weaponMesh) e.char.weaponMesh.visible = false;
            this.game.arena.cheer(e.bossId ? 1.2 : 0.35);
        }

        _updateDead(e, dt) {
            e.deathT += dt;
            if (e.deathT > (e.bossId ? 8 : 4.5)) this._remove(e);
        }

        _remove(e) {
            e.char.dispose();
            this.map.delete(e.id);
        }

        _syncVisual(e, dt) {
            const ch = e.char;
            ch.root.position.set(e.pos.x, e.pos.y + (e.airY || 0), e.pos.z);
            ch.root.rotation.y = e.yaw;
            if (e.dead && e.fling && e.deathT < 0.6) {
                const k = 1 - e.deathT / 0.6;
                e.pos.x += e.fling.x * k * dt; e.pos.z += e.fling.z * k * dt;
                if (!e.remote) this.game.physics.resolve(e.pos, e.radius, 1.6, 0.4);
                ch.root.position.set(e.pos.x, e.pos.y + Math.max(0, Math.sin(e.deathT / 0.6 * Math.PI)) * 0.45, e.pos.z);
            }
            if (e.dead && e.deathT > 3) ch.root.position.y -= (e.deathT - 3) * 0.3;
            ch.animate(dt, { speed: e.moveSpeed, blocking: e.blocking, state: e.dead ? 'dead' : 'alive' });
            if (!e.dead) ch.computeHitboxes();
        }

        snapshot() {
            const out = [];
            for (const e of this.map.values()) {
                if (e.dead) continue;
                const flags = (e.blocking ? 1 : 0) | (e.enraged ? 2 : 0) | (e.staggerT > 0 ? 4 : 0) | (e.invuln > 0 ? 8 : 0);
                out.push([e.id, U.round(e.pos.x, 2), U.round(e.pos.y + (e.airY || 0), 2), U.round(e.pos.z, 2), U.round(e.yaw, 2), U.round(e.moveSpeed, 1), flags, e.hp]);
            }
            return out;
        }

        fullState() {
            const out = [];
            for (const e of this.map.values()) if (!e.dead) out.push({ id: e.id, t: e.type, b: e.bossId, el: e.elite ? 1 : 0, x: e.pos.x, y: e.pos.y, z: e.pos.z, yaw: e.yaw, hp: e.hp, mhp: e.maxHp, ph: e.bossState ? e.bossState.phase : 0 });
            return out;
        }

        /* ===================== CLIENTE ===================== */
        applySpawn(m) {
            if (this.map.has(m.id)) return;
            const pos = new THREE.Vector3(m.x, m.y, m.z);
            const e = this._baseEntity(m.id, m.t, pos, { bossId: m.b, elite: !!m.el, hp: m.hp, maxHp: m.mhp || m.hp, yaw: m.yaw || 0 });
            e.char = this._makeCharacter(e);
            e.remote = true;
            if (m.b) e.bossPhase = m.ph || 0;
            this.map.set(e.id, e);
            return e;
        }

        /** Sincronización completa (lista autoritativa de enemigos vivos) */
        applyFull(list) {
            const ids = new Set(list.map((m) => m.id));
            for (const e of Array.from(this.map.values())) if (!ids.has(e.id) && !e.dead) this._remove(e);
            for (const m of list) {
                const e = this.map.get(m.id) || this.applySpawn(m);
                if (!e) continue;
                e.hp = m.hp; e.maxHp = m.mhp;
                if (m.b) e.bossPhase = m.ph || 0;
            }
        }

        applySnapshot(arr, now) {
            const seen = new Set();
            for (const s of arr) {
                const e = this.map.get(s[0]);
                seen.add(s[0]);
                if (!e || e.dead) continue;
                e.interp.push({ t: now, x: s[1], y: s[2], z: s[3], yaw: s[4] });
                if (e.interp.length > 12) e.interp.shift();
                e.moveSpeed = s[5];
                e.blocking = !!(s[6] & 1);
                if ((s[6] & 2) && !e.enraged) { e.enraged = true; e.char.flash(0xff0000); }
                e.hp = s[7];
            }
        }

        applyEvent(ev) {
            const e = this.map.get(ev.id);
            if (ev.type === 'espawn') { this.applySpawn({ id: ev.id, t: ev.t, b: ev.b, el: ev.el, x: ev.x, y: ev.y, z: ev.z, hp: ev.hp, mhp: ev.hp }); return; }
            if (!e) return;
            if (ev.type === 'eatk') {
                if (ev.arc === 'roar') e.char.play('roar', { duration: ev.windup || 1 });
                else e.char.play('attack', { arc: ev.arc, windup: ev.windup, active: ev.active, recovery: ev.recovery, spinTurns: ev.spinTurns });
            } else if (ev.type === 'estag') e.char.play('stagger', { duration: ev.d });
            else if (ev.type === 'edie') {
                if (e.dead) return;
                e.dead = true; e.deathT = 0; e.hp = 0;
                this._deathFx(e, ev.dx || ev.dz ? new THREE.Vector3(ev.dx, 0, ev.dz) : null);
            } else if (ev.type === 'bossPhase') { e.bossPhase = ev.phase; e.char.play('roar', { duration: 1.5 }); if (ev.phase >= 2) e.char.setEnraged(true); }
            else if (ev.type === 'enrage') { e.enraged = true; e.char.flash(0xff0000); }
        }

        updateClient(dt, now) {
            const delay = GL.NETWORK_CONFIG.interpDelayMs;
            const rt = now - delay;
            for (const e of Array.from(this.map.values())) {
                if (e.dead) { e.deathT += dt; if (e.deathT > (e.bossId ? 8 : 4.5)) { this._remove(e); continue; } }
                else {
                    const b = e.interp;
                    if (b.length) {
                        let i = b.length - 1;
                        while (i > 0 && b[i - 1].t > rt) i--;
                        const s1 = b[i], s0 = i > 0 ? b[i - 1] : s1;
                        let k = s1.t === s0.t ? 1 : U.clamp((rt - s0.t) / (s1.t - s0.t), 0, 1);
                        if (rt > s1.t) { // extrapolación breve
                            k = 1;
                        }
                        e.pos.set(U.lerp(s0.x, s1.x, k), U.lerp(s0.y, s1.y, k), U.lerp(s0.z, s1.z, k));
                        e.yaw = U.lerpAngle(s0.yaw, s1.yaw, k);
                        // descartar muestras viejas
                        while (b.length > 2 && b[1].t < rt) b.shift();
                    }
                }
                this._syncVisual(e, dt);
            }
        }

        /* ===================== COMÚN ===================== */
        /** Objetivos para golpes de jugadores: [{id, hitboxes}] */
        targets() {
            const out = [];
            for (const e of this.map.values()) if (!e.dead) out.push({ id: 'e' + e.id, eid: e.id, hitboxes: e.char.hitboxes });
            return out;
        }

        get(id) { return this.map.get(id); }

        boss() { for (const e of this.map.values()) if (e.bossId && !e.dead) return e; return null; }

        clear() {
            for (const e of this.map.values()) e.char.dispose();
            this.map.clear();
            this.events.length = 0;
            if (this._fields) this._fields.clear();
        }
    }
    GL.EnemyManager = EnemyManager;
})();
