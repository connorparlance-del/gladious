/* WeaponSystem — armas del jugador local.
 * Las trayectorias de las hojas se definen en espacio de cámara y se usan TANTO para
 * dibujar el arma en primera persona COMO para la detección de impactos (alineación exacta). */
(function () {
    const U = GL.U;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);

    const IDLE = { p: V(0.3, -0.33, -0.42), d: V(0.08, 0.9, -0.42).normalize() };
    const IDLE_POLE = { p: V(0.26, -0.3, -0.3), d: V(-0.02, 0.05, -1).normalize() };
    const IDLE_HEAVY = { p: V(0.28, -0.42, -0.4), d: V(-0.25, 0.85, -0.45).normalize() };
    const BLOCK = { p: V(0.06, -0.14, -0.46), d: V(-1, 0.28, -0.12).normalize() };

    function arcPose(arc, u, mirror, out) {
        const o = out || { p: new THREE.Vector3(), d: new THREE.Vector3() };
        const m = mirror ? -1 : 1;
        if (arc === 'slash') {
            const phi = U.lerp(1.3, -1.3, u) * m;
            const x = U.lerp(0.44, -0.4, u) * m;
            o.p.set(x, -0.2 + 0.05 * Math.sin(Math.PI * u), -0.42 - 0.24 * Math.sin(Math.PI * u));
            o.d.set(Math.sin(phi), -0.12, -Math.cos(phi)).normalize();
        } else if (arc === 'overhead') {
            const a = U.lerp(1.95, -0.7, u);
            o.p.set(U.lerp(0.14, 0.06, u), U.lerp(0.06, -0.42, u), U.lerp(-0.22, -0.58, u));
            o.d.set(-0.04, Math.sin(a), -Math.cos(a)).normalize();
        } else { // thrust
            o.p.set(U.lerp(0.3, 0.14, u), U.lerp(-0.26, -0.16, u), U.lerp(-0.2, -1.0, u));
            o.d.set(-0.05, 0.02, -1).normalize();
        }
        return o;
    }

    function blendPose(a, b, t, out) {
        out.p.lerpVectors(a.p, b.p, t);
        out.d.lerpVectors(a.d, b.d, t).normalize();
        return out;
    }

    class WeaponSystem {
        constructor(game) {
            this.game = game;
            this.slots = [{ id: 'gladius', ammo: 0 }, null];
            this.cur = 0;
            this.state = 'idle';
            this.t = 0;
            this.attack = null;
            this.blocking = false; this.blockStart = 0;
            this.aiming = false; this.aimZoom = 14;
            this.charge = 0;
            this.loaded = true;
            this.reloadT = 0;
            this.equipT = 0;
            this.specialCd = 0;
            this.comboMirror = false;
            this.empowered = false;
            this.pierceNext = false;
            this.pose = { p: IDLE.p.clone(), d: IDLE.d.clone() };
            this.prevA = new THREE.Vector3(); this.prevB = new THREE.Vector3();
            this.curA = new THREE.Vector3(); this.curB = new THREE.Vector3();
            this.hasPrev = false;
            this.attackSeq = 0;
            this.hitstop = 0;
            this.recoil = 0;
            this.drawSoundT = 0;
        }

        get current() { return this.slots[this.cur]; }
        get currentId() { return this.current ? this.current.id : 'gladius'; }
        get cfg() { return GL.WEAPON_CONFIG[this.currentId]; }
        isRanged() { return this.cfg.type !== 'melee'; }
        isAttacking() { return this.state === 'windup' || this.state === 'active' || this.state === 'recovery' || this.state === 'charge' || this.state === 'draw'; }

        setLoadout(slots, keepCurrent) {
            this.slots = [slots[0] ? Object.assign({}, slots[0]) : null, slots[1] ? Object.assign({}, slots[1]) : null];
            if (!keepCurrent || !this.slots[this.cur]) this.cur = this.slots[0] ? 0 : 1;
            this._resetState();
            this.game.events.emit('weaponChanged', this.currentId);
        }

        /** Dar arma (compra). Sustituye el hueco del arma actual si no hay hueco libre */
        give(id, ammo) {
            const cfg = GL.WEAPON_CONFIG[id];
            const existing = this.slots.findIndex((s) => s && s.id === id);
            if (existing >= 0) { this.slots[existing].ammo = ammo != null ? ammo : (cfg.ammo || 0); this.cur = existing; }
            else {
                let idx = this.slots.findIndex((s) => !s);
                if (idx < 0) idx = this.cur;
                this.slots[idx] = { id, ammo: ammo != null ? ammo : (cfg.ammo || 0) };
                this.cur = idx;
            }
            this._resetState();
            this.equipT = 0.45; this.state = 'equip';
            this.loaded = true;
            this.game.audio.play('equip');
            this.game.events.emit('weaponChanged', this.currentId);
        }

        _resetState() {
            this.state = 'idle'; this.attack = null; this.blocking = false; this.aiming = false; this.charge = 0; this.hasPrev = false; this.reloadT = 0;
        }

        switchTo(i) {
            if (i === this.cur || !this.slots[i] || this.state === 'active') return;
            this.cur = i; this._resetState(); this.state = 'equip'; this.equipT = 0.35;
            this.loaded = true;
            this.game.audio.play('equip');
            this.game.events.emit('weaponChanged', this.currentId);
        }

        update(dt, input, pc) {
            const cfg = this.cfg;
            const canAct = pc.alive && !pc.downed && !pc.frozen;
            if (this.specialCd > 0) this.specialCd -= dt;
            if (this.hitstop > 0) { this.hitstop -= dt; dt *= 0.15; }
            this.recoil = U.damp(this.recoil, 0, 12, dt);

            // cambio de arma
            if (canAct && this.state !== 'active') {
                if (input.hit('Digit1')) this.switchTo(0);
                if (input.hit('Digit2')) this.switchTo(1);
                if (input.mouse.wheel) this.switchTo(this.cur === 0 ? 1 : 0);
            }
            if (this.state === 'equip') { this.equipT -= dt; if (this.equipT <= 0) this.state = 'idle'; }

            if (!canAct) { this.blocking = false; this.aiming = false; if (this.state !== 'idle' && this.state !== 'equip') this._resetState(); this._updatePose(dt); return; }

            if (cfg.type === 'melee') this._updateMelee(dt, input, pc, cfg);
            else this._updateRanged(dt, input, pc, cfg);

            // especial
            if (input.hit('KeyF')) this.special(pc);
            if (input.hit('KeyR') && cfg.type === 'crossbow' && !this.loaded) this.reloadT = cfg.reload;

            this._updatePose(dt);
            this._sweep(pc);
        }

        _updateMelee(dt, input, pc, cfg) {
            const m = input.mouse;
            // bloqueo
            const wantBlock = m.right && (this.state === 'idle' || this.state === 'block');
            if (wantBlock && !this.blocking) { this.blocking = true; this.blockStart = performance.now(); this.state = 'block'; this.game.events.emit('localBlock', true); }
            if (!m.right && this.blocking) { this.blocking = false; if (this.state === 'block') this.state = 'idle'; this.game.events.emit('localBlock', false); }
            if (this.blocking) return;

            // búfer de entrada: un clic durante la recuperación se ejecuta al terminar
            if (input.mousePressed.left && this.state !== 'idle') this.bufferT = 0.35;
            if (this.bufferT > 0) this.bufferT -= dt;
            // el golpe sale AL PULSAR (sin esperar a soltar); mantener lo convierte en ataque fuerte
            if (this.state === 'idle' && (input.mousePressed.left || this.bufferT > 0)) {
                this.bufferT = 0;
                if (this.startAttack('light', pc)) this.attack.canCharge = true;
            }
            if (this.attack) this._maybeCharge(dt, m, pc, cfg);
            if (this.attack) this._advanceAttack(dt);
        }

        startAttack(type, pc, arcOverride) {
            const cfg = this.cfg;
            const cost = type === 'heavy' ? cfg.staminaHeavy : type === 'special' ? 28 : cfg.staminaLight;
            if (!pc.spendStamina(cost)) {
                if (pc.stamina < 3) { this.state = 'idle'; this.game.ui.flashStamina(); return false; }
                pc.drainStamina(cost);
            }
            const hm = type === 'heavy' ? cfg.heavyMult : 1;
            const arc = arcOverride || (type === 'heavy' ? cfg.heavyArc : cfg.lightArc);
            if (type === 'light') this.comboMirror = !this.comboMirror;
            const windup = type === 'heavy' ? cfg.windup * hm * 0.6 : cfg.windup * 0.85;
            this.attack = {
                id: this.game.localId + ':' + (++this.attackSeq),
                type, arc, mirror: arc === 'slash' && type === 'light' ? this.comboMirror : false,
                windup, active: cfg.active * hm, recovery: cfg.recovery * hm * 0.75, t: 0,
                hitIds: new Set(), startPose: { p: this.pose.p.clone(), d: this.pose.d.clone() },
                empowered: this.empowered
            };
            this.empowered = false;
            this.state = 'windup';
            this.hasPrev = false;
            return true;
        }

        /** Si se mantiene el botón al final de la preparación, el ligero pasa a ser fuerte */
        _maybeCharge(dt, m, pc, cfg) {
            const a = this.attack;
            if (!a.canCharge || a.announced) return;
            const HOLD = 0.17;   // un clic normal (~0,1 s) es ataque ligero; mantener ≥0,17 s = fuerte
            if (!m.left) { if (a.charging) { a.windup = a.t + 0.02; a.charging = false; } a.canCharge = false; return; }
            if (a.type === 'light' && a.t < HOLD) { if (a.t + 0.05 >= a.windup) a.windup = a.t + 0.05; return; }
            if (a.type === 'light') {
                // convertir en ataque fuerte
                const extra = Math.max(0, cfg.staminaHeavy - cfg.staminaLight);
                if (pc.stamina < extra) { a.canCharge = false; return; }
                pc.drainStamina(extra);
                const hm = cfg.heavyMult;
                a.type = 'heavy'; a.arc = cfg.heavyArc; a.mirror = false;
                a.active = cfg.active * hm; a.recovery = cfg.recovery * hm * 0.8;
                a.charging = true;
                a.startPose = { p: this.pose.p.clone(), d: this.pose.d.clone() };
                a.chargeStart = a.t;
                a.windup = a.t + cfg.windup * hm * 0.6;
                this.game.audio.play('swingHeavy', { vol: 0.4, pitch: 0.7 });
            }
            if (a.charging) {
                // mantener la pose cargada mientras se sostenga (máx. 0,8 s)
                const min = a.chargeStart + cfg.windup * cfg.heavyMult * 0.6;
                if (a.t >= min - 0.01) {
                    if (a.t - a.chargeStart < 0.8) a.windup = Math.max(a.windup, a.t + 0.05);
                    else { a.charging = false; a.canCharge = false; }
                }
            }
        }

        _advanceAttack(dt) {
            const a = this.attack;
            // anunciar al host al entrar en la fase de impacto (con el tipo definitivo)
            if (!a.announced && a.t >= a.windup - 0.001 && !a.charging) {
                a.announced = true;
                this.game.match.localAttack({ id: a.id, weapon: this.currentId, type: a.type, arc: a.arc, windup: 0.08, active: a.active, recovery: a.recovery });
                this.game.audio.play(a.type === 'heavy' || this.cfg.weight > 1.5 ? 'swingHeavy' : 'swing', { pitch: 1.2 - this.cfg.weight * 0.2 });
                this.game.player.addKick(0, a.type === 'heavy' ? 0.015 : 0.006, a.mirror ? 0.012 : -0.012);
            }
            a.t += dt;
            if (a.t < a.windup || !a.announced) { this.state = 'windup'; if (a.t > a.windup) a.t = a.windup; }
            else if (a.t < a.windup + a.active) {
                if (this.state !== 'active') this.hasPrev = false;
                this.state = 'active';
            } else if (a.t < a.windup + a.active + a.recovery) this.state = 'recovery';
            else {
                this.attack = null; this.state = 'idle';
                if (this.pendingSecond) { const s = this.pendingSecond; this.pendingSecond = null; this.startAttack(s.type, this.game.player, s.arc); }
            }
        }

        _updateRanged(dt, input, pc, cfg) {
            const m = input.mouse;
            const slot = this.current;
            this.aiming = m.right;
            if (cfg.type === 'crossbow') {
                if (this.reloadT > 0) {
                    this.reloadT -= dt; this.state = 'reload';
                    if (this.reloadT <= 0) { if (slot.ammo > 0) { this.loaded = true; } this.state = 'idle'; this.game.audio.play('reload', { vol: 0.6 }); }
                    return;
                }
                if (input.mousePressed.left && this.state === 'idle') {
                    if (this.loaded) { this._fire(pc, cfg, 1, this.pierceNext ? 3 : 0); this.pierceNext = false; this.loaded = false; this.recoil = 1; pc.addKick(0.05, 0, 0); if (slot.ammo > 0) this.reloadT = cfg.reload; }
                    else this.game.audio.play('denied', { vol: 0.4 });
                }
                return;
            }
            // arco y jabalina: mantener para tensar/preparar
            if (this.reloadT > 0) { this.reloadT -= dt; this.state = 'reload'; if (this.reloadT <= 0) this.state = 'idle'; return; }
            if (this.state === 'idle' && m.left && slot.ammo > 0) {
                this.state = 'draw'; this.charge = 0;
                this.game.audio.play(cfg.type === 'bow' ? 'bowDraw' : 'swing', { vol: 0.6 });
                this.game.match.localAttack({ id: this.game.localId + ':' + (++this.attackSeq), weapon: this.currentId, type: 'draw', arc: cfg.type === 'bow' ? 'shoot' : 'throw', windup: cfg.drawTime, active: 0.1, recovery: 0.2 });
            }
            if (this.state === 'idle' && input.mousePressed.left && slot.ammo <= 0) this.game.audio.play('denied', { vol: 0.4 });
            if (this.state === 'draw') {
                this.charge = Math.min(1, this.charge + dt / Math.max(0.05, cfg.drawTime));
                if (cfg.type === 'bow' && this.charge >= 1) pc.drainStamina(4 * dt);
                if (!m.left) {
                    if (this.charge > 0.18) {
                        this._fire(pc, cfg, this.charge, 0);
                        this.reloadT = cfg.reload; this.state = 'reload';
                        pc.addKick(0.025, 0, 0);
                    } else this.state = 'idle';
                    this.charge = 0;
                }
            }
        }

        _fire(pc, cfg, charge, pierce, spreadAngle) {
            const slot = this.current;
            if (slot.ammo <= 0) return;
            slot.ammo--;
            const cam = this.game.camera;
            const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
            const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
            const origin = cam.position.clone().addScaledVector(fwd, 0.4).addScaledVector(right, 0.08);
            origin.y -= 0.06;
            const spread = (1 - charge) * 0.03 * (this.aiming ? 0.3 : 1);
            const dir = fwd.clone();
            if (spreadAngle) dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), spreadAngle);
            dir.x += (Math.random() - 0.5) * spread; dir.y += (Math.random() - 0.5) * spread; dir.z += (Math.random() - 0.5) * spread;
            dir.normalize();
            const kind = cfg.projectile;
            const speed = cfg.projectileSpeed * (cfg.type === 'bow' ? (0.45 + 0.55 * charge) : 1) * (this.powerThrow ? 1.35 : 1);
            const shot = { id: this.game.localId + ':p' + (++this.attackSeq), kind, weapon: this.currentId, origin: { x: origin.x, y: origin.y, z: origin.z }, dir: { x: dir.x, y: dir.y, z: dir.z }, speed, charge, pierce: pierce || 0, gravityScale: cfg.gravityScale, power: this.powerThrow ? 1 : 0 };
            this.powerThrow = false;
            this.game.audio.play(cfg.type === 'bow' ? 'bowRelease' : cfg.type === 'crossbow' ? 'crossbow' : 'throw');
            this.game.match.localFire(shot);
            this.game.events.emit('ammoChanged');
        }

        special(pc) {
            if (this.specialCd > 0 || this.state !== 'idle') return;
            const cfg = this.cfg, id = this.currentId;
            if (pc.stamina < 25) { this.game.ui.flashStamina(); return; }
            this.specialCd = 7;
            this.game.ui.toast(cfg.special.name.toUpperCase(), '#f1c40f');
            if (cfg.type === 'bow') {
                if (this.current.ammo < 3) { this.specialCd = 0; return; }
                pc.drainStamina(25);
                for (const a of [-0.07, 0, 0.07]) this._fire(pc, cfg, 0.9, 0, a);
                this.reloadT = cfg.reload * 2; this.state = 'reload';
                return;
            }
            if (cfg.type === 'crossbow') { this.pierceNext = true; pc.drainStamina(20); return; }
            if (cfg.type === 'throw') { this.powerThrow = true; pc.drainStamina(20); return; }
            if (id === 'mace') { this.empowered = true; pc.drainStamina(20); this.game.audio.play('equip'); return; }
            if (id === 'gladius' || id === 'dagger') {
                if (this.startAttack('special', pc, 'thrust')) this.pendingSecond = { type: 'special', arc: 'thrust' };
                return;
            }
            if (id === 'spear') {
                if (this.startAttack('special', pc, 'thrust')) {
                    const f = pc.forward(); f.y = 0; f.normalize();
                    pc.push = f.multiplyScalar(9);
                }
                return;
            }
            if (id === 'longsword' || id === 'axe' || id === 'heavyaxe') {
                if (this.startAttack('special', pc, 'slash')) { this.attack.area = 'spin'; this.attack.active *= 1.6; }
                return;
            }
            if (id === 'greatsword' || id === 'hammer') {
                if (this.startAttack('special', pc, 'overhead')) this.attack.area = 'slam';
                return;
            }
        }

        _updatePose(dt) {
            const cfg = this.cfg;
            const target = { p: new THREE.Vector3(), d: new THREE.Vector3() };
            const idle = cfg.type !== 'melee' ? IDLE : (this.currentId === 'spear' ? IDLE_POLE : cfg.weight >= 1.6 ? IDLE_HEAVY : IDLE);
            if (cfg.type === 'melee') {
                if (this.state === 'block') blendPose(target, BLOCK, 1, target), target.p.copy(BLOCK.p), target.d.copy(BLOCK.d);
                else if (this.state === 'charge') {
                    const k = U.smooth(U.clamp((this.t - 0.1) / 0.25, 0, 1));
                    arcPose(cfg.heavyArc, 0, false, target);
                    blendPose(idle, target, k * 0.85, target);
                } else if (this.attack) {
                    const a = this.attack;
                    if (a.t < a.windup) {
                        arcPose(a.arc, 0, a.mirror, target);
                        blendPose(a.startPose, target, U.easeOut(a.t / a.windup), target);
                    } else if (a.t < a.windup + a.active) {
                        arcPose(a.arc, U.smooth((a.t - a.windup) / a.active), a.mirror, target);
                    } else {
                        arcPose(a.arc, 1, a.mirror, target);
                        blendPose(target, idle, U.easeIn(Math.min(1, (a.t - a.windup - a.active) / Math.max(0.01, a.recovery))), target);
                    }
                    this.pose.p.copy(target.p); this.pose.d.copy(target.d);
                    return;
                } else { target.p.copy(idle.p); target.d.copy(idle.d); }
                if (this.state === 'equip') target.p.y -= this.equipT * 0.8;
            } else { target.p.copy(IDLE.p); target.d.copy(IDLE.d); }
            const k = 1 - Math.exp(-16 * dt);
            this.pose.p.lerp(target.p, k);
            this.pose.d.lerp(target.d, k).normalize();
        }

        /** Barrido de la hoja durante la fase activa → impactos */
        _sweep(pc) {
            const a = this.attack;
            if (!a || this.state !== 'active') { this.hasPrev = false; return; }
            const cfg = this.cfg;
            const cam = this.game.camera;
            cam.updateMatrixWorld();
            const blade = this.game.viewmodel.bladeLocal(this.currentId);
            const base = this.pose.p.clone().addScaledVector(this.pose.d, blade.base);
            const tip = this.pose.p.clone().addScaledVector(this.pose.d, blade.tip);
            this.curA.copy(base).applyMatrix4(cam.matrixWorld);
            this.curB.copy(tip).applyMatrix4(cam.matrixWorld);
            const match = this.game.match;
            if (a.area && !a.areaDone && a.t > a.windup + a.active * 0.4) {
                a.areaDone = true;
                match.localAreaAttack(a, pc);
            }
            if (this.hasPrev && !a.area) {
                const targets = match.meleeTargets();
                const hits = GL.Hit.sweepBlade(this.prevA, this.prevB, this.curA, this.curB, blade.radius, targets, a.hitIds);
                for (const h of hits) {
                    a.hitIds.add(h.id);
                    match.localMeleeHit({ attack: a, weapon: this.currentId, hit: h });
                    this.hitstop = h.blockedByShield ? 0.06 : a.type === 'heavy' ? 0.11 : 0.075;
                    pc.addKick(-0.018 * (a.type === 'heavy' ? 1.8 : 1), (Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.04);
                    this.game.fx.addShake(a.type === 'heavy' ? 0.35 : 0.15);
                    this.recoil = Math.max(this.recoil, 0.6);
                    if (cfg.weight < 1.5 && !h.blockedByShield && a.type === 'light') { /* atravesar varios */ }
                }
            }
            this.prevA.copy(this.curA); this.prevB.copy(this.curB); this.hasPrev = true;
        }

        /** Llamado por el host/match si el golpe fue parado: interrumpe el ataque */
        interrupt(stagger) {
            if (this.attack) { this.attack = null; this.state = 'idle'; this.pendingSecond = null; }
            if (stagger) { this.state = 'equip'; this.equipT = stagger; }
        }

        ammoText() {
            const cfg = this.cfg;
            if (cfg.type === 'melee') return '∞';
            return (cfg.type === 'crossbow' ? (this.loaded ? 1 : 0) + ' / ' : '') + this.current.ammo;
        }
    }
    WeaponSystem.arcPose = arcPose;
    GL.WeaponSystem = WeaponSystem;
})();
