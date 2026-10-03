/* MatchManager — reglas de partida y AUTORIDAD.
 *
 *  Modos: 'solo' (supervivencia local), 'coop' (supervivencia online 1-4), 'duel' (1v1 online).
 *  El ANFITRIÓN (o el cliente en solitario) es la autoridad sobre:
 *    vida, daño, muertes, puntos, compras, rondas, enemigos, IA, jefes y resultado.
 *  Cada cliente simula su propio movimiento (validado por el host) y detecta sus golpes
 *  (favor-the-shooter); el host valida cada reclamación y calcula el daño real.
 */
(function () {
    const U = GL.U;
    const NET = GL.NETWORK_CONFIG;
    const START_KIT = [{ id: 'dagger', ammo: 0 }, { id: 'javelin', ammo: 4 }];
    const FLAG = { crouch: 1, block: 2, dodge: 4, aim: 8, sprint: 16, downed: 32, dead: 64 };

    class MatchManager {
        constructor(game) {
            this.game = game;
            this.inMatch = false;
            this.mode = null;
            this.players = new Map();
            this.outEvents = [];
            this.matchTime = 0;
            this.diff = null;
            this.waves = new GL.WaveManager(this);
            this.shop = new GL.Shop(game.arena);
            this.round = { r: 0, s: 'idle', t: 0, left: 0 };
            this.timers = { ps: 0, snap: 0, full: 0, fire: 0 };
            this.duel = null;
            this.stats = {};
            this.sharedPoints = 0;
            this.paused = false;
        }

        get session() { return this.game.session; }
        get localId() { return this.game.localId; }
        get isAuthority() { return this.mode === 'solo' || (this.session.active && this.session.isHost); }
        get online() { return this.mode === 'coop' || this.mode === 'duel'; }
        get local() { return this.players.get(this.localId); }

        /* ==================== CICLO DE VIDA ==================== */
        _newEntity(pid, info, isLocal) {
            const P = GL.GAME_CONFIG.player;
            const ent = {
                id: pid, name: info.name || 'Gladiador', color: info.color || 0x7a1414, armor: GL.GAME_CONFIG.armor[info.armor] ? info.armor : 'media',
                isLocal, pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0,
                crouch: false, sprint: false, blocking: false, blockStart: 0, dodge: false, aim: false, grounded: true,
                weapon: 'dagger', slots: [], upgrades: {}, points: 0, kills: 0, headshots: 0, damage: 0, downs: 0, revives: 0,
                hp: P.maxHp, maxHp: P.maxHp, alive: true, downed: false, bleed: 0, regenDelay: 0,
                attacks: new Map(), shots: new Map(), interp: [], hitboxes: [], lastPs: 0, allowTeleport: true,
                loadout: info.loadout, connected: true, speed: 0
            };
            if (!isLocal) {
                ent.char = new GL.Character({ color: ent.color, armor: ent.armor === 'pesada' ? 'pesada' : ent.armor, helmet: 'galea', weapon: 'gladius', cape: ent.color });
                this.game.scene.add(ent.char.root);
                ent.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: GL.Tex.nameTag(ent.name, '#' + ent.color.toString(16).padStart(6, '0')), transparent: true, depthTest: false }));
                ent.tag.scale.set(1.6, 0.4, 1); ent.tag.renderOrder = 10;
                this.game.scene.add(ent.tag);
            }
            this.players.set(pid, ent);
            return ent;
        }

        _clearEntities() {
            for (const e of this.players.values()) { if (e.char) e.char.dispose(); if (e.tag) { this.game.scene.remove(e.tag); e.tag.material.map.dispose(); e.tag.material.dispose(); } }
            this.players.clear();
        }

        /** Inicia una partida. roster: [{pid, name, color, armor, loadout}] */
        begin(mode, roster) {
            this.end(true);
            const g = this.game;
            this.mode = mode;
            this.inMatch = true;
            this.matchTime = 0;
            this.outEvents.length = 0;
            this.sharedPoints = GL.POINTS_CONFIG.startPoints;
            this.stats = { start: performance.now(), kills: 0 };
            for (const r of roster) this._newEntity(r.pid, r, r.pid === this.localId);
            g.enemies.clear();
            g.projectiles.clear();
            for (const id in g.arena.gates) g.arena.setGateOpen(id, false);
            g.nav.build();
            const pc = g.player;
            const me = this.local;
            pc.armor = me.armor;
            pc.alive = false; pc.downed = false; pc.frozen = false;   // 'pspawn' lo activa
            g.viewmodel.setColor(me.color);
            if (this.isAuthority) {
                if (mode === 'duel') this._hostStartDuel();
                else this._hostStartSurvival();
            }
            g.ui.onMatchBegin(mode);
            g.input.enabled = true;
        }

        end(silent) {
            if (!this.inMatch && silent) { this._clearEntities(); return; }
            this.inMatch = false;
            this._clearEntities();
            this.game.enemies.clear();
            this.game.projectiles.clear();
            this.waves.reset();
            this.duel = null;
            this.round = { r: 0, s: 'idle', t: 0, left: 0 };
            this.game.input.enabled = false;
            this.game.ui.bossBar(null);
        }

        /* ==================== SUPERVIVENCIA (host) ==================== */
        _hostStartSurvival() {
            const spawns = this.game.arena.playerSpawns;
            let i = 0;
            for (const ent of this.players.values()) {
                const sp = spawns[i++ % spawns.length];
                this._hostSpawnPlayer(ent, sp, START_KIT, true);
            }
            this.waves.start();
        }

        _hostSpawnPlayer(ent, pos, kit, resetPoints) {
            const P = GL.GAME_CONFIG.player;
            ent.pos.copy(pos); ent.vel.set(0, 0, 0);
            ent.alive = true; ent.downed = false; ent.bleed = 0;
            ent.slots = kit.map((s) => s ? Object.assign({}, s) : null);
            ent.weapon = ent.slots[0].id;
            if (resetPoints) { ent.points = GL.POINTS_CONFIG.startPoints; ent.upgrades = {}; }
            this._recomputeStats(ent);
            ent.hp = ent.maxHp;
            ent.allowTeleport = true; ent.teleportUntil = performance.now() + 1500;
            this.emitEvent({ type: 'pspawn', pid: ent.id, x: U.round(pos.x), y: U.round(pos.y), z: U.round(pos.z), yaw: U.round(Math.atan2(pos.x, pos.z), 2), slots: ent.slots, hp: ent.hp, mhp: ent.maxHp, up: ent.upgrades, pts: this.pointsOf(ent) });
        }

        _recomputeStats(ent) {
            const P = GL.GAME_CONFIG.player, up = ent.upgrades || {};
            const prevMax = ent.maxHp;
            ent.maxHp = P.maxHp + (up.vitality || 0) * 60;
            if (ent.maxHp > prevMax) ent.hp += ent.maxHp - prevMax;
            ent.armorRed = GL.GAME_CONFIG.armor[ent.armor].reduction + (up.iron || 0) * 0.12;
            ent.dmgMult = 1 + (up.fury || 0) * 0.2;
            ent.speedMult = 1 + (up.wind || 0) * 0.1;
            ent.staminaBonus = (up.wind || 0) * 35;
        }

        pointsOf(ent) { return GL.POINTS_CONFIG.sharedPoints && this.mode !== 'duel' ? this.sharedPoints : ent.points; }
        _wallet(ent) {
            const shared = GL.POINTS_CONFIG.sharedPoints && this.mode !== 'duel';
            return {
                get: () => shared ? this.sharedPoints : ent.points,
                spend: (n) => { if (shared) this.sharedPoints -= n; else ent.points -= n; }
            };
        }
        _addPoints(ent, n, reason) {
            if (!ent || this.mode === 'duel' || n <= 0) return;
            if (GL.POINTS_CONFIG.sharedPoints) this.sharedPoints += n; else ent.points += n;
            this.emitEvent({ type: 'pts', pid: ent.id, pts: this.pointsOf(ent), d: n, why: reason || '' });
        }

        alivePlayerCount(includeDowned) {
            let n = 0;
            for (const e of this.players.values()) if (e.connected !== false && e.alive && (includeDowned || !e.downed)) n++;
            return Math.max(1, n);
        }

        pickSpawnPoint(boss) {
            const arena = this.game.arena;
            const alive = Array.from(this.players.values()).filter((p) => p.alive);
            const cands = [];
            for (const sp of arena.spawnPoints) {
                if (!arena.isZoneOpen(sp.zone)) continue;
                let minD = Infinity;
                for (const p of alive) minD = Math.min(minD, Math.hypot(p.pos.x - sp.pos.x, p.pos.z - sp.pos.z));
                if (minD < 9) continue;
                let occupied = false;
                for (const e of this.game.enemies.map.values()) if (!e.dead && Math.hypot(e.pos.x - sp.pos.x, e.pos.z - sp.pos.z) < 1.4) { occupied = true; break; }
                if (occupied) continue;
                cands.push({ sp, d: minD });
            }
            if (!cands.length) return null;
            cands.sort((a, b) => a.d - b.d);
            if (boss) return cands[Math.floor(cands.length / 2)].sp;
            const pool = cands.slice(0, Math.max(2, Math.ceil(cands.length * 0.6)));
            const pick = U.pick(pool).sp;
            // pequeña variación para no apilar
            return { pos: pick.pos.clone().add(new THREE.Vector3(U.rand(-0.6, 0.6), 0, U.rand(-0.6, 0.6))), exit: pick.exit, zone: pick.zone };
        }

        onRoundStart(r, diff) {
            this.diff = diff;
            // los jugadores muertos reaparecen al comenzar la ronda
            for (const ent of this.players.values()) {
                if (!ent.alive && ent.connected !== false) {
                    const sp = U.pick(this.game.arena.playerSpawns);
                    this._hostSpawnPlayer(ent, sp, START_KIT, false);
                }
            }
            this.emitEvent({ type: 'round', r, s: 'active', boss: diff.isBossRound ? 1 : 0 });
        }
        onRoundEnd(r) {
            for (const ent of this.players.values()) if (ent.alive && !ent.downed) this._addPoints(ent, GL.ROUND_CONFIG.roundBonusPoints, 'Ronda superada');
            this.emitEvent({ type: 'round', r, s: 'end' });
        }
        onRoundState(st) { this.emitEvent(Object.assign({ type: 'rstate' }, st)); }
        onBossSpawn(e) { this.emitEvent({ type: 'boss', id: e.id, b: e.bossId }); }

        /* ==================== DUELO (host) ==================== */
        _hostStartDuel() {
            const ids = Array.from(this.players.keys());
            this.duel = { scores: {}, round: 0, state: 'countdown', timer: 0, order: ids };
            for (const id of ids) this.duel.scores[id] = 0;
            this._duelNextRound();
        }

        _duelLoadout(ent) {
            const lo = ent.loadout || {};
            const prim = GL.WEAPON_CONFIG[lo.primary] && GL.WEAPON_CONFIG[lo.primary].type === 'melee' ? lo.primary : 'gladius';
            const sec = GL.WEAPON_CONFIG[lo.secondary] && lo.secondary !== prim ? lo.secondary : null;
            return [{ id: prim, ammo: 0 }, sec ? { id: sec, ammo: GL.WEAPON_CONFIG[sec].ammo ? Math.ceil(GL.WEAPON_CONFIG[sec].ammo / 2) : 0 } : null];
        }

        _duelNextRound() {
            const d = this.duel;
            d.round++;
            d.state = 'countdown';
            d.timer = GL.GAME_CONFIG.duel.roundStartDelay;
            const sp = this.game.arena.duelSpawns;
            d.order.forEach((pid, i) => {
                const ent = this.players.get(pid);
                if (!ent) return;
                ent.upgrades = {};
                this._hostSpawnPlayer(ent, sp[i % 2], this._duelLoadout(ent), false);
            });
            this.game.projectiles.clear();
            this.emitEvent({ type: 'duel', s: 'countdown', r: d.round, t: d.timer, sc: d.scores });
        }

        _hostUpdateDuel(dt) {
            const d = this.duel;
            if (!d || this.paused) return;
            if (d.state === 'countdown') {
                d.timer -= dt;
                if (d.timer <= 0) { d.state = 'fight'; this.emitEvent({ type: 'duel', s: 'fight', r: d.round, sc: d.scores }); }
            } else if (d.state === 'fight') {
                const alive = d.order.filter((pid) => { const e = this.players.get(pid); return e && e.alive; });
                if (alive.length <= 1) {
                    const winner = alive[0] || null;
                    if (winner) d.scores[winner]++;
                    d.state = 'roundEnd'; d.timer = GL.GAME_CONFIG.duel.roundEndDelay;
                    const won = winner && d.scores[winner] >= GL.GAME_CONFIG.duel.roundsToWin;
                    this.emitEvent({ type: 'duel', s: won ? 'matchEnd' : 'roundEnd', r: d.round, w: winner, sc: d.scores });
                    if (won) d.state = 'matchEnd';
                }
            } else if (d.state === 'roundEnd') {
                d.timer -= dt;
                if (d.timer <= 0) this._duelNextRound();
            }
        }

        hostRematch() {
            if (!this.isAuthority || this.mode !== 'duel') return;
            this._hostStartDuel();
        }

        /* ==================== BUCLE ==================== */
        update(dt) {
            if (!this.inMatch) return;
            const g = this.game;
            this.matchTime += dt;
            const me = this.local;
            // sincronizar entidad local con el controlador
            if (me) {
                const pc = g.player;
                me.pos.copy(pc.pos); me.vel.copy(pc.vel); me.yaw = pc.yaw; me.pitch = pc.pitch;
                me.crouch = pc.crouch; me.sprint = pc.sprinting; me.dodge = pc.iframes > 0; me.aim = g.weapons.aiming;
                if (g.weapons.blocking && !me.blocking) me.blockStart = performance.now();
                me.blocking = g.weapons.blocking; me.weapon = g.weapons.currentId;
                me.grounded = pc.grounded;
            }
            // jugadores remotos: interpolación y animación
            const now = performance.now();
            for (const ent of this.players.values()) {
                if (ent.isLocal) continue;
                this._interpRemote(ent, now);
                this._animRemote(ent, dt);
            }
            // hitboxes estáticas (para golpes de enemigos y proyectiles enemigos)
            for (const ent of this.players.values()) GL.Hit.playerHitboxes(ent.hitboxes, ent.pos, ent.yaw, ent.crouch);

            if (this.isAuthority) this._hostUpdate(dt);
            else g.enemies.updateClient(dt, now);

            // proyectiles (todos los clientes; cada uno detecta los suyos)
            g.projectiles.update(dt, (team, owner) => this._projTargets(team, owner), (p, hit) => this._onProjectileHit(p, hit));

            this._updateLocalInteraction(dt);
            this._netTick(dt);
            this._updateHud();
        }

        _hostUpdate(dt) {
            const g = this.game;
            const players = [];
            for (const ent of this.players.values()) if (ent.connected !== false) players.push(ent);
            if (this.mode === 'duel') this._hostUpdateDuel(dt);
            else {
                this.waves.update(dt);
                g.enemies.updateHost(dt, players, this.diff || GL.calculateDifficulty(1, 1), this.matchTime);
                for (const ev of g.enemies.events) {
                    if (ev.type === 'edie') this._hostOnEnemyDied(ev.id);
                    this.outEvents.push(ev);
                    if (ev.type === 'fx' || ev.type === 'bossPhase') this.applyEvent(ev);
                }
                g.enemies.events.length = 0;
                this._hostSurvivalChecks(dt);
            }
            this._hostHazards(dt);
            this._hostRegen(dt);
        }

        _hostOnEnemyDied(eid) {
            const e = this.game.enemies.get(eid);
            if (!e) return;
            this.waves.onEnemyKilled(e);
            if (e.bossId) {
                for (const p of this.players.values()) if (p.alive) this._addPoints(p, GL.BOSS_CONFIG[e.bossId].points, 'Jefe derrotado');
                this.emitEvent({ type: 'bossdown', id: eid, b: e.bossId });
            }
        }

        _hostSurvivalChecks(dt) {
            // desangrado y reanimaciones
            for (const ent of this.players.values()) {
                if (!ent.downed) continue;
                if (ent.reviver) {
                    const r = this.players.get(ent.reviver);
                    if (!r || !r.alive || r.downed || r.pos.distanceTo(ent.pos) > 2.6) { ent.reviver = null; ent.reviveT = 0; }
                    else {
                        ent.reviveT += dt;
                        if (ent.reviveT >= GL.GAME_CONFIG.reviveTime) {
                            ent.downed = false; ent.reviver = null; ent.reviveT = 0;
                            ent.hp = Math.round(ent.maxHp * 0.5);
                            r.revives++;
                            this._addPoints(r, GL.POINTS_CONFIG.revive, 'Reanimación');
                            this.emitEvent({ type: 'prev', pid: ent.id, by: r.id, hp: ent.hp });
                        }
                        continue;
                    }
                }
                ent.bleed -= dt;
                if (ent.bleed <= 0) { ent.downed = false; this._hostKillPlayer(ent, 'bleed'); }
            }
            // fin de partida: nadie en pie
            if (this.waves.state !== 'over' && this.waves.state !== 'idle') {
                let standing = 0;
                for (const ent of this.players.values()) if (ent.connected !== false && ent.alive && !ent.downed) standing++;
                if (standing === 0) {
                    this.waves.state = 'over';
                    const list = Array.from(this.players.values()).map((p) => ({ pid: p.id, name: p.name, kills: p.kills, hs: p.headshots, pts: p.points, rev: p.revives, dmg: Math.round(p.damage) }));
                    this.emitEvent({ type: 'over', r: this.waves.round, list, time: Math.round(this.matchTime) });
                }
            }
        }

        _hostHazards(dt) {
            const traps = this.game.arena.fireTraps;
            this.timers.fire -= dt;
            if (this.timers.fire > 0) return;
            this.timers.fire = 0.25;
            for (const t of traps) {
                if (!t.active) continue;
                for (const ent of this.players.values()) {
                    if (!ent.alive || ent.downed || ent.pos.y > 0.6) continue;
                    if (Math.hypot(ent.pos.x - t.x, ent.pos.z - t.z) < t.radius + 0.25) this.hostDamagePlayer(ent.id, { base: 9, zone: 'legL', attacker: 'fire', area: true, noBlock: true });
                }
                for (const e of this.game.enemies.map.values()) {
                    if (e.dead || e.pos.y > 0.6) continue;
                    if (Math.hypot(e.pos.x - t.x, e.pos.z - t.z) < t.radius + 0.25) {
                        const r = this.game.enemies.damageEnemy(e.id, { amount: Math.round(14 * (this.diff ? this.diff.enemyHealth : 1)), stagger: 0 }, 'fire', null, null);
                        if (r && !r.immune) this.emitEvent({ type: 'hitfx', x: U.round(e.pos.x), y: U.round(e.pos.y + 1), z: U.round(e.pos.z), k: 'fire', t: 'e' + e.id });
                    }
                }
            }
        }

        _hostRegen(dt) {
            const P = GL.GAME_CONFIG.player;
            for (const ent of this.players.values()) {
                if (!ent.alive || ent.downed) continue;
                if (ent.regenDelay > 0) { ent.regenDelay -= dt; continue; }
                if (ent.hp < ent.maxHp) {
                    const before = Math.floor(ent.hp);
                    ent.hp = Math.min(ent.maxHp, ent.hp + P.hpRegenPerSec * dt);
                    if (Math.floor(ent.hp) !== before && Math.floor(ent.hp) % 5 === 0) this.emitEvent({ type: 'php', pid: ent.id, hp: Math.round(ent.hp), mhp: ent.maxHp });
                }
            }
        }

        /* ==================== DAÑO A JUGADORES (host) ==================== */
        /**
         * o: { base, zone, attacker ('e12' | pid | 'fire'), attackerPos, stagger, knock, dir, area, proj,
         *      weaponId, attackType, charge, noBlock, pvp, attackerEnt }
         */
        hostDamagePlayer(pid, o) {
            const ent = this.players.get(pid);
            if (!ent || !ent.alive || ent.downed) return null;
            if (this.mode === 'duel' && (!this.duel || this.duel.state !== 'fight')) return null;
            if (ent.dodge && !o.noBlock) return { dodged: true };
            const fwd = { x: -Math.sin(ent.yaw), z: -Math.cos(ent.yaw) };
            let facingDot = null;
            const ap = o.attackerPos;
            if (ap) { const dx = ap.x - ent.pos.x, dz = ap.z - ent.pos.z, l = Math.hypot(dx, dz) || 1; facingDot = (dx * fwd.x + dz * fwd.z) / l; }
            const latency = ent.isLocal ? 0 : (this.session.players.get(pid) || {}).rtt || 0;
            const blockAge = ent.blocking ? Math.max(0, (performance.now() - ent.blockStart - latency * 0.5) / 1000) : null;
            const res = GL.Damage.compute({
                weaponId: o.weaponId || 'gladius', attackType: o.attackType || (o.proj ? 'proj' : 'light'), zone: o.zone || 'torso',
                baseOverride: o.base != null ? o.base * (GL.GAME_CONFIG.zones[o.zone] ? 1 : 1) : undefined,
                charge: o.charge, attackerMult: o.attackerMult || 1,
                defender: { armorReduction: ent.armorRed || 0, blocking: ent.blocking && !o.noBlock && !o.area, blockStartAge: blockAge, hasShield: false, defWeapon: ent.weapon, facingDot },
                isBackstab: o.backstab
            });
            if (o.base != null && !GL.GAME_CONFIG.zones[o.zone]) res.amount = Math.round(o.base);
            return this._applyPlayerDamage(ent, res, o);
        }

        _applyPlayerDamage(ent, res, o) {
            ent.hp -= res.amount;
            ent.regenDelay = GL.GAME_CONFIG.player.hpRegenDelay;
            const atkEnt = this.players.get(o.attacker);
            if (atkEnt) atkEnt.damage += res.amount;
            let kx = 0, kz = 0;
            if (o.knock && !res.blocked && !res.parried) {
                const d = o.dir || (o.attackerPos ? new THREE.Vector3(ent.pos.x - o.attackerPos.x, 0, ent.pos.z - o.attackerPos.z).normalize() : null);
                if (d) { kx = d.x * o.knock; kz = d.z * o.knock; }
            }
            const ev = {
                type: 'pdmg', pid: ent.id, a: res.amount, hp: Math.max(0, Math.round(ent.hp)), z: res.zone,
                bl: res.blocked ? 1 : 0, pr: res.parried ? 1 : 0, cr: res.crit ? 1 : 0, sc: Math.round(res.staminaCost || 0),
                st: U.round(Math.max(res.stagger || 0, o.stagger && !res.blocked ? o.stagger : 0), 2),
                fx: o.attackerPos ? U.round(o.attackerPos.x) : null, fz: o.attackerPos ? U.round(o.attackerPos.z) : null,
                kx: U.round(kx), kz: U.round(kz), by: o.attacker, px: o.point ? U.round(o.point.x) : null, py: o.point ? U.round(o.point.y) : null, pz: o.point ? U.round(o.point.z) : null
            };
            this.emitEvent(ev);
            // una parada aturde al atacante
            if (res.parried) {
                if (o.attacker && String(o.attacker)[0] === 'e') { const e = this.game.enemies.get(parseInt(String(o.attacker).slice(1), 10)); if (e) this.game.enemies.stagger(e, 1.1); }
                else if (atkEnt) this.emitEvent({ type: 'pstag', pid: atkEnt.id, d: 0.8, parry: 1 });
            }
            if (ent.hp <= 0) {
                ent.hp = 0;
                const coopOthers = this.mode === 'coop' && Array.from(this.players.values()).some((p) => p !== ent && p.alive && !p.downed && p.connected !== false);
                if (coopOthers) {
                    ent.downed = true; ent.bleed = GL.GAME_CONFIG.downedBleedout; ent.downs++;
                    this.emitEvent({ type: 'pdown', pid: ent.id, t: ent.bleed });
                } else this._hostKillPlayer(ent, o.attacker);
            }
            return res;
        }

        _hostKillPlayer(ent, by) {
            ent.alive = false; ent.downed = false; ent.hp = 0;
            this.emitEvent({ type: 'pdead', pid: ent.id, by: by || null });
        }

        /* ==================== RECLAMACIONES DE CLIENTES (host) ==================== */
        _weaponReach(wid) {
            const W = GL.WEAPON_CONFIG[wid];
            if (!W) return 2;
            const bl = this.game.viewmodel.bladeLocal(wid);
            return (bl.tip || 0.7) + (W.handOffset || 0.5) + 0.6;
        }

        hostHandleAttack(pid, a) {
            const ent = this.players.get(pid);
            if (!ent || !ent.alive || ent.downed) return;
            if (!a || typeof a.id !== 'string' || a.id.length > 40) return;
            const owned = ent.slots.some((s) => s && s.id === a.weapon);
            if (!owned) return;
            const W = GL.WEAPON_CONFIG[a.weapon];
            const total = U.clamp(+a.windup || 0, 0, 3) + U.clamp(+a.active || 0, 0, 4) + U.clamp(+a.recovery || 0, 0, 3);
            ent.attacks.set(a.id, { weapon: a.weapon, type: ['light', 'heavy', 'special', 'draw'].includes(a.type) ? a.type : 'light', t0: performance.now(), s0: this.matchTime, total, hits: new Set(), area: false });
            if (ent.attacks.size > 24) ent.attacks.delete(ent.attacks.keys().next().value);
            ent.weapon = a.weapon;
            // retransmitir la animación a los demás
            this.emitEvent({ type: 'patk', pid, arc: a.arc, w: a.weapon, windup: U.round(a.windup, 2), active: U.round(a.active, 2), recovery: U.round(a.recovery, 2) });
        }

        hostHandleHit(pid, c) {
            const ent = this.players.get(pid);
            if (!ent || !ent.alive || ent.downed || !c) return;
            const atk = ent.attacks.get(c.aid);
            if (!atk || atk.type === 'draw') return;
            // edad del ataque: mínimo entre tiempo real y tiempo de simulación (tolera caídas de FPS del host)
            const age = Math.min((performance.now() - atk.t0) / 1000, this.matchTime - atk.s0);
            const rtt = ent.isLocal ? 0 : ((this.session.players.get(pid) || {}).rtt || 0) / 1000;
            if (age > atk.total + 0.6 + rtt) return;
            if (atk.hits.has(c.target)) return;
            if (!GL.GAME_CONFIG.zones[c.zone] && c.zone !== 'shield') return;
            const reach = this._weaponReach(atk.weapon) + NET.hitDistanceTolerance;
            atk.hits.add(c.target);
            const tgt = String(c.target);
            if (tgt[0] === 'e') {
                if (this.mode === 'duel') return;
                const e = this.game.enemies.get(parseInt(tgt.slice(1), 10));
                if (!e || e.dead) return;
                if (Math.hypot(e.pos.x - ent.pos.x, e.pos.z - ent.pos.z) > reach + e.radius) return;
                this._hostHitEnemy(ent, e, { weapon: atk.weapon, type: atk.type, zone: c.zone, point: c.p, empowered: !!c.emp });
            } else {
                if (this.mode !== 'duel') return; // sin fuego amigo en cooperativo
                const victim = this.players.get(tgt);
                if (!victim || victim === ent) return;
                if (Math.hypot(victim.pos.x - ent.pos.x, victim.pos.z - ent.pos.z) > reach + 0.4) return;
                const zone = c.zone === 'shield' ? 'torso' : c.zone;
                const back = this._isBehind(victim, ent.pos);
                this.hostDamagePlayer(victim.id, { weaponId: atk.weapon, attackType: atk.type, zone, attacker: pid, attackerPos: ent.pos, attackerMult: ent.dmgMult, backstab: back, point: c.p, knock: atk.type === 'heavy' ? 4 : 1.5 });
            }
        }

        _isBehind(victim, fromPos) {
            const fwd = { x: -Math.sin(victim.yaw), z: -Math.cos(victim.yaw) };
            const dx = fromPos.x - victim.pos.x, dz = fromPos.z - victim.pos.z, l = Math.hypot(dx, dz) || 1;
            return (dx * fwd.x + dz * fwd.z) / l < -0.5;
        }

        _hostHitEnemy(ent, e, h) {
            const enemyArmor = e.bossId ? 0.25 : e.type === 'heavy' ? 0.2 : e.elite ? 0.15 : 0.05;
            const fwd = { x: -Math.sin(e.yaw), z: -Math.cos(e.yaw) };
            const dx = ent.pos.x - e.pos.x, dz = ent.pos.z - e.pos.z, l = Math.hypot(dx, dz) || 1;
            const facingDot = (dx * fwd.x + dz * fwd.z) / l;
            const shieldHit = h.zone === 'shield';
            const res = GL.Damage.compute({
                weaponId: h.weapon, attackType: h.type, zone: shieldHit ? 'torso' : h.zone, charge: h.charge,
                attackerMult: (GL.WEAPON_CONFIG[h.weapon].type === 'melee' ? ent.dmgMult : 1) * (h.power ? 1.3 : 1),
                defender: { armorReduction: enemyArmor, blocking: shieldHit || e.blocking, hasShield: !!e.cfg.shield || shieldHit, facingDot: shieldHit ? 1 : facingDot, defWeapon: e.cfg.weapon },
                isBackstab: facingDot < -0.5
            });
            if (h.empowered && !res.blocked) res.stun = 1.6;
            if (res.blocked && shieldHit && h.type === 'heavy' && (GL.WEAPON_CONFIG[h.weapon].shieldBreak || 1) > 1.5) { res.stagger = 0.8; res.blocked = true; }
            const dir = new THREE.Vector3(e.pos.x - ent.pos.x, 0, e.pos.z - ent.pos.z).normalize();
            const out = this.game.enemies.damageEnemy(e.id, res, ent.id, h.point, dir);
            if (!out) return;
            if (!out.immune && !out.killed && !res.blocked && res.amount > 0 && !e.bossId && e.cfg.behavior !== 'heavy' && !e.action) {
                e.char.play('hit', { duration: 0.22 });
                e.staggerT = Math.max(e.staggerT, 0.14);                  // pequeño tambaleo: cada golpe se nota
                // reacción: a veces se aparta para no recibir el siguiente
                const dodgeChance = (e.behavior === 'skirmish' ? 0.5 : 0.28) * (this.diff ? 0.7 + this.diff.aggression * 0.5 : 1);
                if (Math.random() < dodgeChance) { e.evadeT = 0.45; e.evadeSide = Math.random() < 0.5 ? -1 : 1; }
            }
            if (e.cfg.shield && !out.killed) e.blockT = 1.4;
            if (out.immune) { this.emitEvent({ type: 'hitfx', k: 'immune', t: 'e' + e.id, by: ent.id, x: U.round(e.pos.x), y: U.round(e.pos.y + 1.4), z: U.round(e.pos.z) }); return; }
            ent.damage += res.amount;
            const p = h.point || { x: e.pos.x, y: e.pos.y + 1.2, z: e.pos.z };
            this.emitEvent({ type: 'hitfx', k: res.blocked ? (shieldHit ? 'shield' : 'block') : (h.zone === 'head' ? 'head' : 'flesh'), t: 'e' + e.id, by: ent.id, a: res.amount, cr: res.crit ? 1 : 0, z: h.zone, x: U.round(p.x), y: U.round(p.y), z2: U.round(p.z), dx: U.round(dir.x), dz: U.round(dir.z), kill: out.killed ? 1 : 0 });
            if (res.amount > 0 && !res.blocked) this._addPoints(ent, GL.POINTS_CONFIG.hit + (res.crit ? GL.POINTS_CONFIG.crit : 0), '');
            if (out.killed) {
                ent.kills++;
                const base = e.bossId ? 0 : Math.round(e.cfg.points * (e.elite ? GL.ELITE_CONFIG.pointsMult : 1));
                let bonus = h.zone === 'head' ? GL.POINTS_CONFIG.headshotKill : 0;
                if (h.zone === 'head') ent.headshots++;
                const now = this.matchTime;
                ent.streak = now - (ent.lastKillT || -99) < GL.POINTS_CONFIG.streakWindow ? (ent.streak || 0) + 1 : 0;
                ent.lastKillT = now;
                if (ent.streak > 0) bonus += Math.min(8, ent.streak) * GL.POINTS_CONFIG.streakBonus;
                this._addPoints(ent, base + bonus, h.zone === 'head' ? 'Decapitación' : ent.streak > 1 ? 'Racha x' + (ent.streak + 1) : 'Baja');
                this.emitEvent({ type: 'kill', by: ent.id, t: e.type, b: e.bossId, el: e.elite ? 1 : 0, hd: h.zone === 'head' ? 1 : 0, st: ent.streak || 0 });
            }
        }

        hostHandleArea(pid, c) {
            const ent = this.players.get(pid);
            if (!ent || !ent.alive || ent.downed || !c) return;
            const atk = ent.attacks.get(c.aid);
            if (!atk || atk.area || atk.type !== 'special') return;
            atk.area = true;
            const kind = c.kind === 'slam' ? 'slam' : 'spin';
            const center = kind === 'slam' ? new THREE.Vector3(ent.pos.x - Math.sin(ent.yaw) * 1.6, ent.pos.y, ent.pos.z - Math.cos(ent.yaw) * 1.6) : ent.pos.clone();
            const radius = kind === 'slam' ? 3.2 : this._weaponReach(atk.weapon) + 0.3;
            this.emitEvent({ type: 'fx', k: kind === 'slam' ? 'slam' : 'spin', x: U.round(center.x), y: U.round(center.y), z: U.round(center.z), r: radius, by: pid });
            if (this.mode === 'duel') {
                for (const v of this.players.values()) {
                    if (v === ent || !v.alive) continue;
                    if (Math.hypot(v.pos.x - center.x, v.pos.z - center.z) < radius + 0.3) this.hostDamagePlayer(v.id, { weaponId: atk.weapon, attackType: 'special', zone: 'torso', attacker: pid, attackerPos: ent.pos, attackerMult: ent.dmgMult, knock: 6, stagger: kind === 'slam' ? 0.7 : 0.3 });
                }
                return;
            }
            for (const e of Array.from(this.game.enemies.map.values())) {
                if (e.dead) continue;
                if (Math.hypot(e.pos.x - center.x, e.pos.z - center.z) > radius + e.radius) continue;
                this._hostHitEnemy(ent, e, { weapon: atk.weapon, type: 'special', zone: 'torso', point: { x: e.pos.x, y: e.pos.y + 1.2 * e.scale, z: e.pos.z } });
                if (kind === 'slam') this.game.enemies.stagger(e, 1.0);
            }
        }

        hostHandleFire(pid, s) {
            const ent = this.players.get(pid);
            if (!ent || !ent.alive || ent.downed || !s) return;
            const slot = ent.slots.find((x) => x && x.id === s.weapon);
            const W = GL.WEAPON_CONFIG[s.weapon];
            if (!slot || !W || W.type === 'melee') return;
            if (slot.ammo <= 0) { this._sendLoadout(ent); return; }
            slot.ammo--;
            const o = s.origin, d = s.dir;
            if (![o.x, o.y, o.z, d.x, d.y, d.z, s.speed].every(U.isNum)) return;
            // el origen debe estar cerca del jugador
            if (Math.hypot(o.x - ent.pos.x, o.z - ent.pos.z) > 2.5) return;
            const speed = Math.min(W.projectileSpeed * 1.4, Math.abs(s.speed));
            const id = String(s.id).slice(0, 40);
            ent.shots.set(id, { weapon: s.weapon, origin: new THREE.Vector3(o.x, o.y, o.z), dir: new THREE.Vector3(d.x, d.y, d.z).normalize(), speed, t0: performance.now(), s0: this.matchTime, charge: U.clamp(+s.charge || 0, 0, 1), pierce: Math.min(3, s.pierce | 0), hits: new Set(), power: s.power ? 1 : 0 });
            if (ent.shots.size > 30) ent.shots.delete(ent.shots.keys().next().value);
            // visual para los demás
            this.emitEvent({ type: 'proj', id, pid, kind: W.projectile, w: s.weapon, o: { x: U.round(o.x), y: U.round(o.y), z: U.round(o.z) }, d: { x: U.round(d.x, 3), y: U.round(d.y, 3), z: U.round(d.z, 3) }, sp: speed, gs: W.gravityScale });
        }

        hostHandleProjHit(pid, c) {
            const ent = this.players.get(pid);
            if (!ent || !c) return;
            const shot = ent.shots.get(c.id);
            if (!shot) return;
            if (shot.hits.has(c.target)) return;
            if (shot.hits.size > shot.pierce) return;
            const age = Math.min((performance.now() - shot.t0) / 1000, this.matchTime - shot.s0 + 0.2);
            if (age > 5) return;
            const tgt = String(c.target);
            let tpos;
            if (tgt[0] === 'e') { const e = this.game.enemies.get(parseInt(tgt.slice(1), 10)); if (!e || e.dead) return; tpos = e.pos; }
            else { const v = this.players.get(tgt); if (!v || v === ent) return; tpos = v.pos; }
            // validar que el objetivo está cerca de la trayectoria
            const to = new THREE.Vector3(tpos.x - shot.origin.x, (tpos.y + 1) - shot.origin.y, tpos.z - shot.origin.z);
            const along = to.dot(shot.dir);
            const rtt = ent.isLocal ? 0 : ((this.session.players.get(pid) || {}).rtt || 0) / 1000;
            if (along < -1 || along > shot.speed * (age + rtt + 0.3) + 3) return;
            const lateral = to.clone().sub(shot.dir.clone().multiplyScalar(along)).length();
            const drop = 0.5 * GL.GAME_CONFIG.gravity * (GL.WEAPON_CONFIG[shot.weapon].gravityScale || 0.5) * Math.pow(along / shot.speed, 2);
            if (lateral > 2.5 + drop + along * 0.05) return;
            shot.hits.add(c.target);
            const W = GL.WEAPON_CONFIG[shot.weapon];
            if (tgt[0] === 'e') {
                const e = this.game.enemies.get(parseInt(tgt.slice(1), 10));
                this._hostHitEnemy(ent, e, { weapon: shot.weapon, type: 'proj', zone: c.zone, point: c.p, charge: shot.charge, power: shot.power });
            } else if (this.mode === 'duel') {
                this.hostDamagePlayer(tgt, { weaponId: shot.weapon, attackType: 'proj', zone: c.zone === 'shield' ? 'torso' : c.zone, charge: shot.charge, attacker: pid, attackerPos: shot.origin, attackerMult: shot.power ? 1.3 : 1, point: c.p, knock: W.type === 'throw' ? 3 : 1 });
            }
            if (shot.hits.size > shot.pierce) this.emitEvent({ type: 'premove', id: c.id });
        }

        hostHandleBuy(pid, stationId) {
            const ent = this.players.get(pid);
            if (!ent || this.mode === 'duel') return;
            const r = this.shop.validate(String(stationId), ent, this._wallet(ent));
            if (!r.ok) { this.emitEvent({ type: 'buyno', pid, why: r.reason }); return; }
            const ap = r.apply;
            if (ap.kind === 'weapon') {
                const existing = ent.slots.findIndex((s) => s && s.id === ap.weapon);
                if (existing >= 0) ent.slots[existing].ammo = ap.ammo;
                else {
                    let idx = ent.slots.findIndex((s) => !s);
                    if (idx < 0) idx = Math.max(0, ent.slots.findIndex((s) => s && s.id === ent.weapon));
                    ent.slots[idx] = { id: ap.weapon, ammo: ap.ammo };
                }
                ent.weapon = ap.weapon;
            } else if (ap.kind === 'upgrade') {
                if (ap.upgrade === 'heal') ent.hp = ent.maxHp;
                else { ent.upgrades[ap.upgrade] = ap.level; this._recomputeStats(ent); }
            } else if (ap.kind === 'gate') {
                this.game.arena.setGateOpen(ap.gate, true);
                this.game.nav.build();
                this.emitEvent({ type: 'gate', id: ap.gate });
            }
            this.emitEvent({ type: 'buyok', pid, st: stationId, k: ap.kind, w: ap.weapon, up: ap.upgrade, lv: ap.level, slots: ent.slots, ups: ent.upgrades, hp: Math.round(ent.hp), mhp: ent.maxHp, pts: this.pointsOf(ent), price: r.price });
        }

        hostHandleRevive(pid, target, on) {
            const r = this.players.get(pid), t = this.players.get(target);
            if (!r || !t || !t.downed || !r.alive || r.downed) return;
            if (on) { if (r.pos.distanceTo(t.pos) < 2.6) { t.reviver = pid; t.reviveT = t.reviveT || 0; } }
            else if (t.reviver === pid) { t.reviver = null; t.reviveT = 0; }
        }

        hostHandlePs(pid, s) {
            const ent = this.players.get(pid);
            if (!ent || ent.isLocal || !s) return;
            if (![s.x, s.y, s.z, s.yaw].every(U.isNum)) return;
            const now = performance.now();
            const dt = Math.max(0.016, (now - (ent.lastPs || now)) / 1000);
            ent.lastPs = now;
            const dist = Math.hypot(s.x - ent.pos.x, s.z - ent.pos.z);
            const maxSpeed = GL.GAME_CONFIG.player.sprintSpeed * (ent.speedMult || 1) * NET.maxSpeedTolerance + 9;
            const physOk = this.game.physics.insideBounds(s.x, s.z, 0) && s.y > -2 && s.y < 8;
            // ventana de gracia tras aparecer/reconectar: los paquetes en vuelo con la posición
            // antigua no deben provocar correcciones (evita "rubber-banding" al reaparecer)
            const grace = ent.allowTeleport && now < (ent.teleportUntil || 0);
            if (!grace && (dist > maxSpeed * Math.min(dt, 0.5) + 0.6 || !physOk)) {
                this.session.sendTo(pid, { k: 'corr', x: ent.pos.x, y: ent.pos.y, z: ent.pos.z });
                return;
            }
            if (!grace) ent.allowTeleport = false;
            ent.interp.push({ t: now, x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch || 0 });
            if (ent.interp.length > 14) ent.interp.shift();
            ent.pos.set(s.x, s.y, s.z);
            ent.vel.set(s.vx || 0, 0, s.vz || 0);
            ent.yaw = s.yaw; ent.pitch = s.pitch || 0;
            ent.crouch = !!s.cr; ent.sprint = !!s.sp; ent.dodge = !!s.dg; ent.aim = !!s.aim;
            if (s.bl && !ent.blocking) ent.blockStart = now;
            ent.blocking = !!s.bl;
            if (typeof s.w === 'string' && ent.slots.some((x) => x && x.id === s.w)) ent.weapon = s.w;
        }

        /* ==================== ACCIONES DEL JUGADOR LOCAL ==================== */
        localAttack(a) {
            if (this.isAuthority) this.hostHandleAttack(this.localId, a);
            else this.session.sendHost({ k: 'atk', a });
        }

        localMeleeHit(h) {
            const hit = h.hit;
            const claim = { aid: h.attack.id, target: hit.id, zone: hit.zone, p: { x: U.round(hit.point.x), y: U.round(hit.point.y), z: U.round(hit.point.z) }, emp: h.attack.empowered ? 1 : 0 };
            // respuesta inmediata (predicción): efectos locales
            this._predictHitFx(hit);
            if (this.isAuthority) this.hostHandleHit(this.localId, claim);
            else this.session.sendHost({ k: 'hit', c: claim });
        }

        _predictHitFx(hit) {
            const g = this.game;
            if (hit.blockedByShield) { g.fx.sparks(hit.point, 12); g.audio.play('shieldHit', { pos: hit.point }); }
            else { g.fx.blood(hit.point, null, 0.8); g.audio.play(hit.zone === 'head' ? 'hitHead' : 'hitFlesh', { pos: hit.point }); }
            g.ui.hitmarker(hit.zone === 'head', false);
            const tgt = String(hit.id);
            if (tgt[0] === 'e') { const e = g.enemies.get(parseInt(tgt.slice(1), 10)); if (e) e.char.flash(0xff2200); }
            else { const p = this.players.get(tgt); if (p && p.char) p.char.flash(0xff2200); }
        }

        localAreaAttack(a, pc) {
            const claim = { aid: a.id, kind: a.area };
            if (this.isAuthority) this.hostHandleArea(this.localId, claim);
            else this.session.sendHost({ k: 'area', c: claim });
            this.game.fx.addShake(0.3);
        }

        localFire(shot) {
            const W = GL.WEAPON_CONFIG[shot.weapon];
            this.game.projectiles.spawn({ id: shot.id, kind: shot.kind, owner: this.localId, team: 'players', weaponId: shot.weapon, origin: shot.origin, dir: shot.dir, speed: shot.speed, gravityScale: W.gravityScale, charge: shot.charge, pierce: shot.pierce, detect: true });
            if (this.isAuthority) this.hostHandleFire(this.localId, shot);
            else this.session.sendHost({ k: 'fire', s: shot });
        }

        _onProjectileHit(p, hit) {
            if (p.team === 'players' && p.owner === this.localId) {
                this._predictHitFx(hit);
                const claim = { id: p.id, target: hit.id, zone: hit.zone, p: { x: U.round(hit.point.x), y: U.round(hit.point.y), z: U.round(hit.point.z) } };
                if (this.isAuthority) this.hostHandleProjHit(this.localId, claim);
                else this.session.sendHost({ k: 'phit', c: claim });
            } else if (p.team === 'enemies' && this.isAuthority) {
                const e = this.game.enemies.get(parseInt(String(p.owner).slice(1), 10));
                this.hostDamagePlayer(hit.id, { base: p.dmg, zone: hit.zone, attacker: p.owner, attackerPos: p.origin, proj: true, point: hit.point, knock: p.kind === 'axe' ? 4 : 0.5, stagger: p.kind === 'axe' ? 0.3 : 0 });
            }
        }

        hostEnemyProjectile(shot) {
            this.game.projectiles.spawn({ id: shot.id, kind: shot.kind, owner: shot.owner, team: 'enemies', origin: shot.origin, dir: shot.dir, speed: shot.speed, gravityScale: shot.gravityScale, detect: true, dmg: shot.dmg });
            this.outEvents.push({ type: 'proj', id: shot.id, pid: shot.owner, kind: shot.kind, o: { x: U.round(shot.origin.x), y: U.round(shot.origin.y), z: U.round(shot.origin.z) }, d: { x: U.round(shot.dir.x, 3), y: U.round(shot.dir.y, 3), z: U.round(shot.dir.z, 3) }, sp: shot.speed, gs: shot.gravityScale });
        }

        /** Objetivos que puede golpear el jugador local */
        meleeTargets() {
            if (this.mode === 'duel') {
                const out = [];
                for (const p of this.players.values()) if (!p.isLocal && p.alive && p.char) out.push({ id: p.id, hitboxes: p.char.hitboxes });
                return out;
            }
            return this.game.enemies.targets();
        }

        /** Objetivos de los ataques enemigos (host) */
        playerHitTargets() {
            const out = [];
            for (const p of this.players.values()) if (p.alive && !p.downed && !p.dodge && p.connected !== false) out.push({ id: p.id, hitboxes: p.hitboxes });
            return out;
        }

        _projTargets(team, owner) {
            if (team === 'enemies') return this.playerHitTargets();
            if (this.mode === 'duel') return this.meleeTargets().filter((t) => t.id !== owner);
            return this.game.enemies.targets();
        }

        /* ==================== INTERACCIÓN (E) ==================== */
        _updateLocalInteraction(dt) {
            const g = this.game, me = this.local;
            if (!me) return;
            const pc = g.player;
            let prompt = null;
            this.reviveTarget = null;
            if (this.mode !== 'duel' && me.alive && !pc.downed) {
                // reanimar compañero
                for (const p of this.players.values()) {
                    if (p.isLocal || !p.downed) continue;
                    if (p.pos.distanceTo(pc.pos) < 2.2) { this.reviveTarget = p; break; }
                }
                if (this.reviveTarget) {
                    const holding = g.input.down('KeyE');
                    prompt = { text: holding ? 'REANIMANDO A ' + this.reviveTarget.name.toUpperCase() + '…' : '[E] MANTÉN PARA REANIMAR A ' + this.reviveTarget.name.toUpperCase(), can: true };
                    if (holding && !this.reviving) { this.reviving = this.reviveTarget.id; this._sendRevive(this.reviving, true); this.reviveLocalT = 0; }
                    if (holding) this.reviveLocalT += dt;
                    g.ui.reviveProgress(holding ? this.reviveLocalT / GL.GAME_CONFIG.reviveTime : null);
                } else {
                    g.ui.reviveProgress(null);
                    const st = this.shop.nearest(pc.pos, pc.forward());
                    if (st) {
                        me.points = this.pointsOf(me);
                        prompt = this.shop.promptFor(st, Object.assign({}, me, { hp: me.hp, slots: g.weapons.slots }));
                        if (g.input.hit('KeyE')) {
                            if (prompt && prompt.can) this.requestBuy(st.id);
                            else { g.audio.play('denied'); if (prompt) g.ui.toast(prompt.text.indexOf('—') > 0 && !prompt.can ? 'PUNTOS INSUFICIENTES' : prompt.text, '#e74c3c'); }
                        }
                    }
                }
                if (this.reviving && (!g.input.down('KeyE') || !this.reviveTarget || this.reviveTarget.id !== this.reviving)) { this._sendRevive(this.reviving, false); this.reviving = null; g.ui.reviveProgress(null); }
            }
            g.ui.prompt(prompt);
        }

        _sendRevive(target, on) {
            if (this.isAuthority) this.hostHandleRevive(this.localId, target, on);
            else this.session.sendHost({ k: 'rev', t: target, on: on ? 1 : 0 });
        }

        requestBuy(stationId) {
            if (this.isAuthority) this.hostHandleBuy(this.localId, stationId);
            else this.session.sendHost({ k: 'buy', st: stationId });
        }

        /* ==================== EVENTOS (todos los clientes) ==================== */
        emitEvent(ev) {
            this.outEvents.push(ev);
            this.applyEvent(ev);
        }

        applyEvent(ev) {
            const g = this.game, me = this.local, U2 = U;
            switch (ev.type) {
                case 'pspawn': {
                    const ent = this.players.get(ev.pid);
                    if (!ent) return;
                    ent.pos.set(ev.x, ev.y, ev.z); ent.alive = true; ent.downed = false;
                    ent.slots = ev.slots; ent.hp = ev.hp; ent.maxHp = ev.mhp; ent.upgrades = ev.up || {};
                    ent.interp.length = 0;
                    if (ev.pts != null) ent.points = ev.pts;
                    if (ent.isLocal) {
                        g.player.reset(new THREE.Vector3(ev.x, ev.y, ev.z), ev.yaw || 0);
                        g.player.maxHp = ev.mhp; g.player.hp = ev.hp;
                        this._applyLocalStats(ent);
                        g.weapons.setLoadout(ev.slots);
                        g.ui.setDowned(null);
                        g.ui.setDead(false);
                    }
                    if (ent.char) { ent.char.setWeapon(ev.slots[0].id); ent.char.stopAction(); }
                    break;
                }
                case 'pdmg': {
                    const ent = this.players.get(ev.pid);
                    if (!ent) return;
                    ent.hp = ev.hp;
                    const pt = ev.px != null ? new THREE.Vector3(ev.px, ev.py, ev.pz) : ent.pos.clone().setY(ent.pos.y + 1.3);
                    if (ev.bl || ev.pr) { g.fx.sparks(pt, ev.pr ? 24 : 12); g.audio.play(ev.pr ? 'parry' : 'block', { pos: pt }); }
                    else if (ev.a > 0) { g.fx.blood(pt, null, 0.6); }
                    if (ent.isLocal) {
                        g.player.hp = ev.hp;
                        if (ev.sc) g.player.drainStamina(ev.sc);
                        if (ev.a > 0) {
                            g.audio.play('hurt', { pitch: U.rand(0.9, 1.1) });
                            g.ui.damageFlash(Math.min(1, ev.a / 40));
                            g.fx.addShake(Math.min(0.6, ev.a / 60));
                            g.player.addKick(0.03, (Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.06);
                            if (ev.fx != null) g.ui.damageDirection(ev.fx, ev.fz, g.player);
                        }
                        if (ev.pr) g.ui.toast('¡PARADA!', '#5dade2');
                        if (ev.st > 0.25) g.weapons.interrupt(ev.st * 0.6);
                        if (ev.kx || ev.kz) g.player.push = new THREE.Vector3(ev.kx, 0, ev.kz);
                    } else if (ent.char && ev.a > 0) { ent.char.flash(0xff2200); if (ev.st > 0.2) ent.char.play('hit', { duration: 0.3 }); }
                    // indicador de daño para el atacante
                    if (ev.by === this.localId && ev.a > 0) { g.ui.damageNumber(pt, ev.a, ev.cr, ev.z === 'head'); g.ui.hitmarker(ev.z === 'head', ev.hp <= 0); }
                    break;
                }
                case 'php': { const ent = this.players.get(ev.pid); if (ent) { ent.hp = ev.hp; ent.maxHp = ev.mhp; if (ent.isLocal) g.player.hp = ev.hp; } break; }
                case 'pdown': {
                    const ent = this.players.get(ev.pid);
                    if (!ent) return;
                    ent.downed = true; ent.hp = 0; ent.bleed = ev.t;
                    if (ent.isLocal) { g.player.downed = true; g.ui.setDowned(ev.t); g.audio.play('playerDeath'); }
                    else g.ui.killfeed(ent.name + ' ha caído — ¡reanímalo!', '#e67e22');
                    break;
                }
                case 'prev': {
                    const ent = this.players.get(ev.pid);
                    if (!ent) return;
                    ent.downed = false; ent.hp = ev.hp;
                    if (ent.isLocal) { g.player.downed = false; g.player.hp = ev.hp; g.ui.setDowned(null); g.audio.play('revive'); }
                    g.ui.killfeed((this.players.get(ev.by) || {}).name + ' reanimó a ' + ent.name, '#2ecc71');
                    break;
                }
                case 'pdead': {
                    const ent = this.players.get(ev.pid);
                    if (!ent) return;
                    ent.alive = false; ent.downed = false; ent.hp = 0;
                    if (ent.isLocal) {
                        g.player.alive = false; g.player.downed = false; g.player.hp = 0;
                        g.ui.setDowned(null); g.ui.setDead(true, this.mode);
                        g.audio.play('playerDeath');
                    } else if (ent.char) { ent.char.stopAction(); }
                    const killer = this.players.get(ev.by);
                    g.ui.killfeed(killer ? killer.name + ' derrotó a ' + ent.name : ent.name + ' ha muerto', '#e74c3c');
                    if (ent.char) g.fx.blood(ent.pos.clone().setY(ent.pos.y + 1.0), null, 2);
                    break;
                }
                case 'pstag': {
                    if (ev.pid === this.localId) { g.weapons.interrupt(ev.d); if (ev.parry) g.ui.toast('¡TU ATAQUE FUE PARADO!', '#e67e22'); g.player.addKick(-0.04, 0, 0.05); }
                    const ent = this.players.get(ev.pid); if (ent && ent.char) ent.char.play('stagger', { duration: ev.d });
                    break;
                }
                case 'patk': {
                    const ent = this.players.get(ev.pid);
                    if (!ent || ent.isLocal || !ent.char) return;
                    if (ent.char.weaponId !== ev.w) ent.char.setWeapon(ev.w);
                    if (ev.arc === 'shoot' || ev.arc === 'throw') ent.char.play('attack', { arc: ev.arc, windup: Math.min(1, ev.windup), active: 0.1, recovery: 0.3 });
                    else ent.char.play('attack', { arc: ev.arc, windup: ev.windup, active: ev.active, recovery: ev.recovery, spinTurns: ev.arc === 'slash' && ev.active > 0.3 ? 1 : 0 });
                    g.audio.play('swing', { pos: ent.pos, vol: 0.7 });
                    break;
                }
                case 'proj': {
                    if (this.game.projectiles.byId.has(ev.id)) return;
                    if (ev.pid === this.localId) return;
                    const isEnemy = String(ev.pid)[0] === 'e';
                    this.game.projectiles.spawn({ id: ev.id, kind: ev.kind, owner: ev.pid, team: isEnemy ? 'enemies' : 'players', origin: ev.o, dir: ev.d, speed: ev.sp, gravityScale: ev.gs, detect: false });
                    if (!isEnemy) g.audio.play(ev.kind === 'arrow' ? 'bowRelease' : ev.kind === 'bolt' ? 'crossbow' : 'throw', { pos: ev.o });
                    break;
                }
                case 'premove': this.game.projectiles.remove(ev.id); break;
                case 'hitfx': {
                    const p = new THREE.Vector3(ev.x, ev.y, ev.z2 != null ? ev.z2 : ev.z);
                    const mine = ev.by === this.localId;
                    if (ev.k === 'fire') { g.fx.fire(p, 4); break; }
                    if (ev.k === 'immune') { if (mine) g.ui.toast('¡INVULNERABLE!', '#aaa'); g.fx.sparks(p, 6); break; }
                    if (!mine) {
                        if (ev.k === 'shield' || ev.k === 'block') { g.fx.sparks(p, 10); g.audio.play('shieldHit', { pos: p }); }
                        else { g.fx.blood(p, ev.dx != null ? new THREE.Vector3(ev.dx, 0, ev.dz) : null, ev.k === 'head' ? 1.4 : 0.8); g.audio.play(ev.k === 'head' ? 'hitHead' : 'hitFlesh', { pos: p }); }
                        const e = g.enemies.get(parseInt(String(ev.t).slice(1), 10)); if (e) { e.char.flash(ev.k === 'shield' ? 0x8888ff : 0xff2200); if (ev.k === 'flesh' || ev.k === 'head') e.char.play('hit', { duration: 0.22 }); }
                    } else {
                        if (ev.a > 0) g.ui.damageNumber(p, ev.a, ev.cr, ev.z === 'head', ev.k === 'shield' || ev.k === 'block');
                        if (!this.isAuthority) { const e = g.enemies.get(parseInt(String(ev.t).slice(1), 10)); if (e && (ev.k === 'flesh' || ev.k === 'head')) e.char.play('hit', { duration: 0.22 }); }
                        if (ev.kill) g.ui.hitmarker(ev.z === 'head', true);
                        if (ev.k === 'shield') g.ui.toast('BLOQUEADO POR ESCUDO', '#8fa3b8');
                    }
                    if (ev.z === 'head' && ev.kill) g.fx.blood(p, null, 2.5);
                    break;
                }
                case 'pts': {
                    const ent = this.players.get(ev.pid);
                    if (ent) ent.points = ev.pts;
                    if (GL.POINTS_CONFIG.sharedPoints) { this.sharedPoints = ev.pts; for (const p of this.players.values()) p.points = ev.pts; }
                    if (ev.pid === this.localId && ev.d) g.ui.pointsPopup(ev.d, ev.why);
                    break;
                }
                case 'kill': {
                    if (ev.by === this.localId) {
                        if (ev.hd) g.ui.toast('¡DECAPITACIÓN!', '#f1c40f');
                        else if (ev.st >= 2) g.ui.toast('RACHA x' + (ev.st + 1), '#f39c12');
                    }
                    g.arena.cheer(ev.b ? 1.2 : ev.el ? 0.6 : 0.25);
                    if (ev.b) g.audio.play('victory');
                    else if (Math.random() < 0.3) g.audio.play('cheer');
                    break;
                }
                case 'round': {
                    if (ev.s === 'active') {
                        this.round.r = ev.r;
                        g.ui.banner('RONDA ' + ev.r, ev.boss ? '¡UN CAMPEÓN ENTRA EN LA ARENA!' : this._roundFlavor(ev.r), 3);
                        g.audio.play(ev.boss ? 'bossIntro' : 'horn');
                        g.audio.setCrowdLevel(Math.min(1, ev.r / 12));
                    } else if (ev.s === 'end') {
                        g.ui.banner('RONDA ' + ev.r + ' SUPERADA', 'Prepárate. Compra armas y mejoras.', 3);
                        g.audio.play('roundEnd');
                        g.arena.cheer(0.8);
                    }
                    break;
                }
                case 'rstate': this.round = { r: ev.r, s: ev.s, t: ev.t, left: ev.left, boss: ev.boss, at: performance.now() }; break;
                case 'boss': {
                    const def = GL.BOSS_CONFIG[ev.b];
                    g.ui.banner(def.name, def.intro, 4.5, true);
                    g.audio.play('bossIntro');
                    setTimeout(() => g.audio.play('bossRoar'), 1800);
                    g.arena.cheer(1.5);
                    this.bossId = ev.id;
                    break;
                }
                case 'bossdown': { g.ui.banner('¡' + GL.BOSS_CONFIG[ev.b].name + ' HA CAÍDO!', 'La multitud enloquece', 4); g.ui.bossBar(null); this.bossId = null; break; }
                case 'bossPhase': if (!this.isAuthority) g.enemies.applyEvent(ev); g.ui.toast(ev.phase >= 2 ? '¡EL JEFE ENFURECE!' : '¡NUEVA FASE DEL JEFE!', '#e74c3c'); g.audio.play('bossRoar'); break;
                case 'gate': g.arena.setGateOpen(ev.id, true); g.audio.play('gate', { pos: g.arena.gates[ev.id].pos }); if (!this.isAuthority) g.nav.build(); g.ui.toast(GL.SHOP_CONFIG.gates[ev.id].name.toUpperCase() + ' ABIERTA', '#f1c40f'); break;
                case 'buyok': {
                    const ent = this.players.get(ev.pid);
                    if (!ent) return;
                    ent.slots = ev.slots; ent.upgrades = ev.ups; ent.hp = ev.hp; ent.maxHp = ev.mhp; ent.points = ev.pts;
                    if (ent.isLocal) {
                        g.audio.play('buy');
                        if (ev.k === 'weapon') g.weapons.give(ev.w, ev.slots.find((s) => s && s.id === ev.w).ammo);
                        if (ev.k === 'upgrade') { g.ui.toast(GL.SHOP_CONFIG.upgrades[ev.up].name.toUpperCase(), '#2ecc71'); g.player.hp = ev.hp; g.player.maxHp = ev.mhp; this._applyLocalStats(ent); }
                        g.ui.pointsPopup(-ev.price, '');
                    } else if (ent.char && ev.k === 'weapon') ent.char.setWeapon(ev.w);
                    break;
                }
                case 'buyno': if (ev.pid === this.localId) { g.audio.play('denied'); g.ui.toast(String(ev.why).toUpperCase(), '#e74c3c'); } break;
                case 'loadout': {
                    const ent = this.players.get(ev.pid);
                    if (!ent) return;
                    ent.slots = ev.slots;
                    if (ent.isLocal) g.weapons.setLoadout(ev.slots, true);
                    break;
                }
                case 'duel': this._applyDuel(ev); break;
                case 'over': {
                    this.round.s = 'over';
                    g.ui.showGameOver(ev, this.isAuthority);
                    g.audio.play('hornLow');
                    break;
                }
                case 'fx': {
                    const p = new THREE.Vector3(ev.x, ev.y, ev.z);
                    if (ev.k === 'slam') { g.fx.shockwave(p, ev.r || 4, 0xffcc88); g.audio.play('slam', { pos: p }); const d = p.distanceTo(g.player.pos); if (d < 12) g.fx.addShake(0.8 * (1 - d / 12)); }
                    else if (ev.k === 'spin') { g.fx.shockwave(p, ev.r || 2, 0xffffff); g.audio.play('swingHeavy', { pos: p }); }
                    break;
                }
                default:
                    // eventos de enemigos (sólo clientes; el host ya los aplicó)
                    if (!this.isAuthority) {
                        if (ev.type === 'espawn' || ev.type === 'eatk' || ev.type === 'estag' || ev.type === 'edie' || ev.type === 'bossPhase' || ev.type === 'enrage') g.enemies.applyEvent(ev);
                        if (ev.type === 'eatk' && ev.arc !== 'shoot') { const e = g.enemies.get(ev.id); if (e) g.audio.play('swing', { pos: e.pos, vol: 0.8, pitch: 0.9 }); }
                    }
            }
        }

        _roundFlavor(r) {
            const f = ['El público ruge.', 'Más gladiadores cruzan las puertas.', 'Llegan los veloces.', 'Escudos en formación.', 'Arqueros y pesados se unen.', 'La arena huele a sangre.', 'Los élites observan.'];
            return f[Math.min(f.length - 1, r - 1)];
        }

        _applyLocalStats(ent) {
            const pc = this.game.player, up = ent.upgrades || {};
            pc.speedMult = 1 + (up.wind || 0) * 0.1;
            pc.maxStamina = GL.GAME_CONFIG.player.maxStamina + (up.wind || 0) * 35;
            pc.maxHp = ent.maxHp;
        }

        _applyDuel(ev) {
            const g = this.game;
            this.duelState = ev;
            g.ui.duelScore(ev.sc, this.players, this.localId);
            const pc = g.player;
            if (ev.s === 'countdown') { pc.frozen = true; g.ui.countdown(GL.GAME_CONFIG.duel.roundStartDelay, 'RONDA ' + ev.r); g.ui.hideResults(); }
            else if (ev.s === 'fight') { pc.frozen = false; g.ui.banner('¡LUCHAD!', '', 1.2); g.audio.play('horn'); g.arena.cheer(1); }
            else if (ev.s === 'roundEnd' || ev.s === 'matchEnd') {
                const w = this.players.get(ev.w);
                const iWon = ev.w === this.localId;
                if (ev.s === 'roundEnd') { g.ui.banner(w ? (iWon ? 'GANAS LA RONDA' : w.name.toUpperCase() + ' GANA LA RONDA') : 'EMPATE', '', 2.5); g.audio.play(iWon ? 'roundEnd' : 'hornLow'); }
                else { g.ui.showDuelResult(ev, this.players, this.localId, this.isAuthority); g.audio.play(iWon ? 'victory' : 'hornLow'); }
                g.arena.cheer(1.2);
            }
        }

        /* ==================== RED ==================== */
        _netTick(dt) {
            const s = this.session;
            this.timers.ps -= dt; this.timers.snap -= dt; this.timers.full -= dt;
            if (!this.online || !s.active) { this.outEvents.length = 0; return; }
            if (s.isHost) {
                if (this.outEvents.length) {
                    const batch = this.outEvents.splice(0, this.outEvents.length);
                    for (let i = 0; i < batch.length; i += 60) s.broadcast({ k: 'ev', l: batch.slice(i, i + 60) }, true);
                }
                if (this.timers.snap <= 0) { this.timers.snap = 1 / NET.snapshotHz; s.broadcast(this._snapshot(), false); }
                if (this.timers.full <= 0) { this.timers.full = NET.fullSyncMs / 1000; s.broadcast(this.fullState(), true); }
            } else {
                this.outEvents.length = 0;
                if (this.timers.ps <= 0) {
                    this.timers.ps = 1 / NET.playerStateHz;
                    const st = this.game.player.netState();
                    st.k = 'ps';
                    s.sendHost(st, false);
                }
            }
        }

        _snapshot() {
            const p = [];
            for (const e of this.players.values()) {
                const f = (e.crouch ? FLAG.crouch : 0) | (e.blocking ? FLAG.block : 0) | (e.dodge ? FLAG.dodge : 0) | (e.aim ? FLAG.aim : 0) | (e.sprint ? FLAG.sprint : 0) | (e.downed ? FLAG.downed : 0) | (!e.alive ? FLAG.dead : 0);
                p.push([e.id, U.round(e.pos.x, 2), U.round(e.pos.y, 2), U.round(e.pos.z, 2), U.round(e.yaw, 2), U.round(e.pitch, 2), f, e.weapon, Math.round(e.hp)]);
            }
            return { k: 'snap', t: U.round(this.matchTime, 2), p, e: this.mode === 'duel' ? [] : this.game.enemies.snapshot() };
        }

        fullState() {
            const players = [];
            for (const e of this.players.values()) players.push({ pid: e.id, hp: Math.round(e.hp), mhp: e.maxHp, pts: this.pointsOf(e), k: e.kills, hs: e.headshots, al: e.alive ? 1 : 0, dn: e.downed ? 1 : 0, sl: e.slots, up: e.upgrades, name: e.name, color: e.color, armor: e.armor });
            const gates = {};
            for (const id in this.game.arena.gates) gates[id] = this.game.arena.gates[id].open ? 1 : 0;
            return {
                k: 'full', mode: this.mode, t: this.matchTime, players, gates,
                round: this.round, waves: this.mode !== 'duel' ? this.waves.serialize() : null,
                enemies: this.mode !== 'duel' ? this.game.enemies.fullState() : [],
                duel: this.duel ? { s: this.duel.state, r: this.duel.round, sc: this.duel.scores } : null,
                boss: this.bossId || null
            };
        }

        /** Aplicar estado completo (cliente): corrige desincronizaciones */
        applyFull(m) {
            const g = this.game;
            if (Math.abs(this.matchTime - m.t) > 0.5) this.matchTime = m.t;
            for (const pl of m.players) {
                let ent = this.players.get(pl.pid);
                if (!ent) ent = this._newEntity(pl.pid, { name: pl.name, color: pl.color, armor: pl.armor }, pl.pid === this.localId);
                const wasAlive = ent.alive;
                ent.hp = pl.hp; ent.maxHp = pl.mhp; ent.points = pl.pts; ent.kills = pl.k; ent.headshots = pl.hs;
                ent.alive = !!pl.al; ent.downed = !!pl.dn; ent.upgrades = pl.up || {};
                if (ent.isLocal) {
                    const pc = g.player;
                    pc.hp = pl.hp; pc.maxHp = pl.mhp;
                    if (pc.alive !== ent.alive) { pc.alive = ent.alive; g.ui.setDead(!ent.alive, this.mode); }
                    if (pc.downed !== ent.downed) { pc.downed = ent.downed; if (!ent.downed) g.ui.setDowned(null); }
                    // munición/armas: el host manda; sólo corregimos si difiere el conjunto
                    const mine = g.weapons.slots.map((s) => s && s.id).join(',');
                    const theirs = (pl.sl || []).map((s) => s && s.id).join(',');
                    if (mine !== theirs && pl.sl && pl.sl.length) g.weapons.setLoadout(pl.sl, true);
                    else if (pl.sl) pl.sl.forEach((s, i) => { if (s && g.weapons.slots[i] && Math.abs(g.weapons.slots[i].ammo - s.ammo) > 1) g.weapons.slots[i].ammo = s.ammo; });
                    this._applyLocalStats(ent);
                } else if (!wasAlive && ent.alive && ent.char) ent.char.stopAction();
                ent.slots = pl.sl || ent.slots;
            }
            // jugadores que ya no están
            const ids = new Set(m.players.map((p) => p.pid));
            for (const [pid, ent] of Array.from(this.players.entries())) if (!ids.has(pid) && !ent.isLocal) { if (ent.char) ent.char.dispose(); if (ent.tag) g.scene.remove(ent.tag); this.players.delete(pid); }
            for (const id in m.gates) if (m.gates[id] && !g.arena.gates[id].open) { g.arena.setGateOpen(id, true); g.nav.build(); }
            if (m.round) this.round = Object.assign({}, m.round, { at: performance.now() });
            if (m.mode !== 'duel') g.enemies.applyFull(m.enemies);
            this.bossId = m.boss;
            if (m.duel && (!this.duelState || this.duelState.s !== m.duel.s)) {
                g.ui.duelScore(m.duel.sc, this.players, this.localId);
                if (m.duel.s === 'fight') g.player.frozen = false;
            }
        }

        _interpRemote(ent, now) {
            const b = ent.interp;
            if (!b.length) return;
            const rt = now - NET.interpDelayMs;
            let i = b.length - 1;
            while (i > 0 && b[i - 1].t > rt) i--;
            const s1 = b[i], s0 = i > 0 ? b[i - 1] : s1;
            const k = s1.t === s0.t ? 1 : U.clamp((rt - s0.t) / (s1.t - s0.t), 0, 1);
            const nx = U.lerp(s0.x, s1.x, k), nz = U.lerp(s0.z, s1.z, k);
            ent.renderSpeed = ent.lastRender ? Math.hypot(nx - ent.lastRender.x, nz - ent.lastRender.z) / Math.max(0.001, (now - ent.lastRender.t) / 1000) : 0;
            ent.lastRender = { x: nx, z: nz, t: now };
            ent.rpos = ent.rpos || new THREE.Vector3();
            ent.rpos.set(nx, U.lerp(s0.y, s1.y, k), nz);
            ent.ryaw = U.lerpAngle(s0.yaw, s1.yaw, k);
            ent.rpitch = U.lerp(s0.pitch || 0, s1.pitch || 0, k);
            while (b.length > 2 && b[1].t < rt) b.shift();
            if (!this.isAuthority) { ent.pos.copy(ent.rpos); ent.yaw = ent.ryaw; }
        }

        _animRemote(ent, dt) {
            const ch = ent.char;
            if (!ch) return;
            const p = ent.rpos || ent.pos;
            ch.root.position.copy(p);
            ch.root.rotation.y = ent.ryaw != null ? ent.ryaw : ent.yaw;
            if (ch.weaponId !== ent.weapon && ent.weapon) ch.setWeapon(ent.weapon);
            ch.animate(dt, { speed: Math.min(9, ent.renderSpeed || 0), blocking: ent.blocking, crouch: ent.crouch, state: !ent.alive ? 'dead' : ent.downed ? 'downed' : 'alive', aimPitch: ent.rpitch });
            ch.computeHitboxes();
            ent.tag.position.set(p.x, p.y + 2.25, p.z);
            ent.tag.visible = ent.alive;
        }

        /** Mensajes de red entrantes */
        onMessage(from, m) {
            const g = this.game;
            if (this.session.isHost) {
                if (!this.inMatch) return;
                const pid = from;
                switch (m.k) {
                    case 'ps': this.hostHandlePs(pid, m); break;
                    case 'atk': this.hostHandleAttack(pid, m.a); break;
                    case 'hit': this.hostHandleHit(pid, m.c); break;
                    case 'area': this.hostHandleArea(pid, m.c); break;
                    case 'fire': this.hostHandleFire(pid, m.s); break;
                    case 'phit': this.hostHandleProjHit(pid, m.c); break;
                    case 'buy': this.hostHandleBuy(pid, m.st); break;
                    case 'rev': this.hostHandleRevive(pid, m.t, !!m.on); break;
                    case 'needfull': this.session.sendTo(pid, this.fullState(), true); break;
                    default: break;
                }
                return;
            }
            // invitado
            switch (m.k) {
                case 'start': g.onNetStart(m); break;
                case 'ev': if (this.inMatch) for (const ev of m.l) this.applyEvent(ev); break;
                case 'snap': if (this.inMatch) this._applySnap(m); break;
                case 'full': if (this.inMatch) this.applyFull(m); break;
                case 'corr': if (this.inMatch) { g.player.pos.set(m.x, m.y, m.z); g.player.vel.set(0, 0, 0); } break;
                case 'end': g.onNetEnd(m); break;
                default: break;
            }
        }

        _applySnap(m) {
            const now = performance.now();
            // detección de desincronización: tiempo de partida
            if (Math.abs(this.matchTime - m.t) > 1.0) this.matchTime = m.t; else this.matchTime += (m.t - this.matchTime) * 0.1;
            for (const s of m.p) {
                const ent = this.players.get(s[0]);
                if (!ent) { this._missing = (this._missing || 0) + 1; if (this._missing > 10) { this._missing = 0; this.session.sendHost({ k: 'needfull' }); } continue; }
                if (ent.isLocal) continue;
                ent.interp.push({ t: now, x: s[1], y: s[2], z: s[3], yaw: s[4], pitch: s[5] });
                if (ent.interp.length > 14) ent.interp.shift();
                const f = s[6];
                ent.crouch = !!(f & FLAG.crouch); ent.blocking = !!(f & FLAG.block); ent.dodge = !!(f & FLAG.dodge);
                ent.downed = !!(f & FLAG.downed); ent.alive = !(f & FLAG.dead);
                ent.weapon = s[7]; ent.hp = s[8];
            }
            // enemigos desconocidos → pedir estado completo
            let unknown = 0;
            for (const s of m.e) if (!this.game.enemies.get(s[0])) unknown++;
            if (unknown) { this._unknownE = (this._unknownE || 0) + 1; if (this._unknownE > 8) { this._unknownE = 0; this.session.sendHost({ k: 'needfull' }); } }
            this.game.enemies.applySnapshot(m.e, now);
        }

        /** Un jugador se unió/reconectó con la partida en curso (host) */
        hostOnPlayerJoined(pid, info) {
            if (!this.inMatch || this.mode !== 'coop') return;
            let ent = this.players.get(pid);
            if (!ent) {
                ent = this._newEntity(pid, info, false);
                ent.points = GL.POINTS_CONFIG.startPoints;
                ent.alive = false;
                if (this.waves.state === 'intermission' || this.waves.state === 'pre') this._hostSpawnPlayer(ent, U.pick(this.game.arena.playerSpawns), START_KIT, true);
            }
            ent.connected = true;
            this.session.sendTo(pid, this.game.startMessage(), true);
            setTimeout(() => this.session.sendTo(pid, this.fullState(), true), 300);
        }

        hostOnPlayerDisconnected(pid) {
            const ent = this.players.get(pid);
            if (!ent) return;
            ent.connected = false;
            this.game.ui.killfeed(ent.name + ' perdió la conexión…', '#e67e22');
            if (this.mode === 'duel' && this.duel && this.duel.state !== 'matchEnd') { this.paused = true; this.game.ui.waitingOpponent(true); }
        }

        hostOnPlayerReconnected(pid) {
            const ent = this.players.get(pid);
            if (!ent) return;
            ent.connected = true; ent.allowTeleport = true; ent.teleportUntil = performance.now() + 3000;
            this.paused = false;
            this.game.ui.waitingOpponent(false);
            this.game.ui.killfeed(ent.name + ' se reconectó', '#2ecc71');
            this.session.sendTo(pid, this.game.startMessage(), true);
            setTimeout(() => this.session.sendTo(pid, this.fullState(), true), 300);
        }

        hostOnPlayerLeft(pid) {
            const ent = this.players.get(pid);
            if (!ent) return;
            this.game.ui.killfeed(ent.name + ' abandonó la partida', '#e74c3c');
            if (ent.char) ent.char.dispose();
            if (ent.tag) this.game.scene.remove(ent.tag);
            this.players.delete(pid);
            for (const e of this.game.enemies.map.values()) if (e.target === pid) e.target = null;
            if (this.mode === 'duel' && this.duel && this.duel.state !== 'matchEnd') {
                this.duel.state = 'matchEnd';
                this.game.ui.waitingOpponent(false);
                this.emitEvent({ type: 'duel', s: 'matchEnd', r: this.duel.round, w: this.localId, sc: this.duel.scores, forfeit: 1 });
            }
        }

        _sendLoadout(ent) { this.emitEvent({ type: 'loadout', pid: ent.id, slots: ent.slots }); }

        _updateHud() {
            const g = this.game, me = this.local, pc = g.player, ui = g.ui;
            if (!me) return;
            ui.setVitals(pc.hp, pc.maxHp, pc.stamina, pc.maxStamina);
            ui.setPoints(this.mode === 'duel' ? null : this.pointsOf(me));
            ui.setWeapon(GL.WEAPON_CONFIG[g.weapons.currentId].name, g.weapons.ammoText(), g.weapons.slots, g.weapons.cur, g.weapons.specialCd);
            if (this.mode !== 'duel') {
                const r = this.round;
                const left = this.isAuthority ? this.waves.remaining + (g.enemies.boss() ? 1 : 0) : Math.max(r.left || 0, g.enemies.aliveCount);
                let timer = null;
                if ((r.s === 'intermission' || r.s === 'pre') && r.at) timer = Math.max(0, (r.t || 0) - (performance.now() - r.at) / 1000);
                if (this.isAuthority && (this.waves.state === 'intermission' || this.waves.state === 'pre')) timer = this.waves.timer;
                ui.setRound(r.r || this.waves.round, this.isAuthority ? this.waves.remaining : left, timer);
                const boss = g.enemies.boss();
                ui.bossBar(boss ? GL.BOSS_CONFIG[boss.bossId].name : null, boss ? boss.hp / boss.maxHp : 0, boss ? (boss.bossState ? boss.bossState.phase : boss.bossPhase || 0) : 0);
                // compañeros
                const team = [];
                for (const p of this.players.values()) team.push({ name: p.name, hp: p.hp, maxHp: p.maxHp, downed: p.downed, alive: p.alive, isLocal: p.isLocal, color: p.color, pts: this.pointsOf(p), connected: p.connected !== false });
                ui.setTeam(team);
            } else {
                ui.setRound(null);
                const opp = Array.from(this.players.values()).find((p) => !p.isLocal);
                ui.setOpponent(opp ? { name: opp.name, hp: opp.hp, maxHp: opp.maxHp, color: opp.color } : null);
            }
            if (me.downed) ui.updateDowned(me);
        }
    }
    MatchManager.START_KIT = START_KIT;
    GL.MatchManager = MatchManager;
})();
