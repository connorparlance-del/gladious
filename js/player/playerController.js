/* PlayerController — movimiento en primera persona: WASD, sprint, salto, agacharse,
 * esquiva, stamina, colisiones, cámara con head-bob, retroceso y efectos de daño. */
(function () {
    const U = GL.U;

    class PlayerController {
        constructor(game, camera) {
            this.game = game;
            this.camera = camera;
            const P = GL.GAME_CONFIG.player;
            this.cfg = P;
            this.pos = new THREE.Vector3(0, 0, 8);
            this.vel = new THREE.Vector3();
            this.yaw = 0; this.pitch = 0;
            this.grounded = true;
            this.crouch = false; this.crouchT = 0;
            this.sprinting = false;
            this.stamina = P.maxStamina; this.maxStamina = P.maxStamina;
            this.staminaDelay = 0;
            this.hp = P.maxHp; this.maxHp = P.maxHp;
            this.alive = true; this.downed = false;
            this.armor = 'media';
            this.speedMult = 1;
            this.dodgeT = 0; this.dodgeDir = new THREE.Vector3(); this.iframes = 0;
            this.bobPhase = 0; this.bobAmt = 0;
            this.kick = { pitch: 0, yaw: 0, roll: 0 };
            this.landT = 0;
            this.stepDist = 0;
            this.frozen = false;          // durante cuentas atrás
            this.lastHurt = 0;
            this.fovBase = P.fov; this.fovCur = P.fov;
            this.moveInput = new THREE.Vector2();
            this.speedNow = 0;
        }

        reset(pos, yaw) {
            this.pos.copy(pos); this.vel.set(0, 0, 0);
            this.yaw = yaw || 0; this.pitch = 0;
            this.stamina = this.maxStamina; this.alive = true; this.downed = false;
            this.dodgeT = 0; this.iframes = 0; this.crouch = false; this.crouchT = 0;
        }

        get height() { return U.lerp(this.cfg.height, this.cfg.crouchHeight, this.crouchT); }
        get eyeHeight() { return this.height - this.cfg.eyeOffset; }

        spendStamina(v) {
            if (this.stamina < v) return false;
            this.stamina -= v; this.staminaDelay = this.cfg.staminaRegenDelay;
            return true;
        }
        drainStamina(v) { this.stamina = Math.max(0, this.stamina - v); this.staminaDelay = this.cfg.staminaRegenDelay; }

        update(dt, input) {
            const P = this.cfg, phys = this.game.physics;
            // mirar
            const look = input.consumeLook();
            if (this.alive) {
                this.yaw += look.yaw;
                this.pitch = U.clamp(this.pitch + look.pitch, -1.45, 1.45);
            }
            const canAct = this.alive && !this.downed && !this.frozen;
            // dirección deseada
            let ix = 0, iz = 0;
            if (canAct) {
                if (input.down('KeyW')) iz -= 1;
                if (input.down('KeyS')) iz += 1;
                if (input.down('KeyA')) ix -= 1;
                if (input.down('KeyD')) ix += 1;
            }
            this.moveInput.set(ix, iz);
            const len = Math.hypot(ix, iz);
            if (len > 0) { ix /= len; iz /= len; }
            const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
            const wx = ix * cy + iz * sy, wz = -ix * sy + iz * cy;

            // agacharse
            const wantCrouch = canAct && (input.down('ControlLeft') || input.down('KeyC'));
            if (wantCrouch) this.crouch = true;
            else if (this.crouch) {
                // levantarse sólo si hay espacio
                const head = phys.raycast({ x: this.pos.x, y: this.pos.y + this.cfg.crouchHeight, z: this.pos.z }, { x: 0, y: 1, z: 0 }, this.cfg.height - this.cfg.crouchHeight + 0.05);
                if (!head) this.crouch = false;
            }
            this.crouchT = U.damp(this.crouchT, this.crouch ? 1 : 0, 14, dt);

            // sprint
            const ws = this.game.weapons;
            const busy = ws && ws.isAttacking();
            const blocking = ws && ws.blocking;
            this.sprinting = canAct && input.down('ShiftLeft') && iz < 0 && this.stamina > 2 && !this.crouch && !blocking && !(ws && ws.aiming);
            let speed = this.crouch ? P.crouchSpeed : this.sprinting ? P.sprintSpeed : P.walkSpeed;
            speed *= this.speedMult * (GL.GAME_CONFIG.armor[this.armor] || { speedMult: 1 }).speedMult;
            if (blocking) speed *= 0.6;
            if (busy) speed *= 0.75;
            if (ws && ws.aiming) speed *= 0.65;
            if (this.downed) speed = 0.6;
            if (this.sprinting && len > 0) this.drainStamina(P.sprintCost * dt);

            // esquiva
            if (canAct && input.hit('KeyQ') && this.dodgeT <= 0 && this.grounded && this.spendStamina(P.dodgeCost)) {
                const d = len > 0 ? new THREE.Vector3(wx, 0, wz) : new THREE.Vector3(sy, 0, cy);
                this.dodgeDir.copy(d).normalize();
                this.dodgeT = P.dodgeTime; this.iframes = P.dodgeIframes;
                this.game.audio.play('jump', { vol: 0.7 });
                this.game.fx.dust(this.pos, 8);
                this.game.events.emit('localDodge');
            }
            if (this.iframes > 0) this.iframes -= dt;

            // velocidad horizontal
            const accel = this.grounded ? P.accel : P.airAccel;
            const tx = wx * speed, tz = wz * speed;
            if (this.dodgeT > 0) {
                this.dodgeT -= dt;
                this.vel.x = this.dodgeDir.x * P.dodgeSpeed; this.vel.z = this.dodgeDir.z * P.dodgeSpeed;
            } else {
                const k = Math.min(1, accel * dt / Math.max(1, speed));
                this.vel.x += (tx - this.vel.x) * Math.min(1, accel * dt * 0.25 + k);
                this.vel.z += (tz - this.vel.z) * Math.min(1, accel * dt * 0.25 + k);
            }
            // empuje externo (golpes)
            if (this.push) { this.vel.x += this.push.x; this.vel.z += this.push.z; this.push = null; }

            // salto
            if (canAct && input.hit('Space') && this.grounded && !this.crouch && this.spendStamina(P.jumpCost)) {
                this.vel.y = P.jumpSpeed; this.grounded = false;
                this.game.audio.play('jump', { vol: 0.5 });
            }
            this.vel.y -= GL.GAME_CONFIG.gravity * dt;

            // integrar y colisionar
            const prevY = this.pos.y;
            this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
            phys.resolve(this.pos, P.radius, this.height, this.grounded ? P.stepHeight : 0.1);
            this.pos.y += this.vel.y * dt;
            // techo
            if (this.vel.y > 0) {
                const hit = phys.raycast({ x: this.pos.x, y: prevY + this.height - 0.05, z: this.pos.z }, { x: 0, y: 1, z: 0 }, this.vel.y * dt + 0.1);
                if (hit) { this.vel.y = 0; this.pos.y = prevY; }
            }
            const gh = phys.groundHeight(this.pos.x, this.pos.z, Math.max(prevY, this.pos.y), P.radius, this.grounded ? P.stepHeight : 0.05);
            const wasGrounded = this.grounded;
            if (this.pos.y <= gh + 0.001) {
                if (!wasGrounded && this.vel.y < -6) { this.landT = Math.min(1, -this.vel.y / 14); this.game.audio.play('land', { vol: 0.6 }); }
                this.pos.y = gh; this.vel.y = 0; this.grounded = true;
            } else if (this.grounded && this.pos.y - gh < P.stepHeight + 0.05 && this.vel.y <= 0) {
                this.pos.y = gh; this.vel.y = 0; // pegarse a escalones al bajar
            } else this.grounded = false;
            // seguridad: si caemos fuera
            if (this.pos.y < -5) { this.pos.set(0, 0, 8); this.vel.set(0, 0, 0); }

            // stamina
            if (this.staminaDelay > 0) this.staminaDelay -= dt;
            else if (!this.sprinting || len === 0) this.stamina = Math.min(this.maxStamina, this.stamina + P.staminaRegen * dt);

            // pasos
            const hs = Math.hypot(this.vel.x, this.vel.z);
            this.speedNow = hs;
            if (this.grounded && hs > 0.5) {
                this.stepDist += hs * dt;
                const stride = this.sprinting ? 2.2 : 1.7;
                if (this.stepDist > stride) { this.stepDist = 0; this.game.audio.play('step', { vol: this.crouch ? 0.4 : 1, vol2: this.sprinting ? 1.4 : 1, pitch: U.rand(0.9, 1.1) }); }
                this.bobPhase += dt * hs * (this.sprinting ? 1.45 : 1.8);
            }
            this.bobAmt = U.damp(this.bobAmt, this.grounded ? Math.min(1, hs / P.walkSpeed) : 0, 8, dt);
            this.landT = Math.max(0, this.landT - dt * 3);

            // retroceso de cámara
            this.kick.pitch = U.damp(this.kick.pitch, 0, 10, dt);
            this.kick.yaw = U.damp(this.kick.yaw, 0, 10, dt);
            this.kick.roll = U.damp(this.kick.roll, 0, 8, dt);
            this.updateCamera(dt);
        }

        addKick(pitch, yaw, roll) { this.kick.pitch += pitch || 0; this.kick.yaw += yaw || 0; this.kick.roll += roll || 0; }

        updateCamera(dt) {
            const cam = this.camera;
            const bobY = Math.sin(this.bobPhase * 2) * 0.035 * this.bobAmt;
            const bobX = Math.cos(this.bobPhase) * 0.025 * this.bobAmt;
            const shake = this.game.fx.shake;
            const sx = (Math.random() - 0.5) * shake * 0.12, sy = (Math.random() - 0.5) * shake * 0.12;
            let eye = this.eyeHeight;
            if (this.downed) eye = 0.7;
            if (!this.alive) eye = 0.35;
            eye -= this.landT * 0.12;
            const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
            cam.position.set(this.pos.x, this.pos.y + eye + bobY + sy, this.pos.z).addScaledVector(right, bobX + sx);
            cam.rotation.order = 'YXZ';
            const deadRoll = this.alive ? 0 : 0.6;
            cam.rotation.set(this.pitch + this.kick.pitch, this.yaw + this.kick.yaw, this.kick.roll + Math.sin(this.bobPhase) * 0.004 * this.bobAmt + deadRoll);
            // FOV
            const ws = this.game.weapons;
            let fov = this.fovBase + (this.sprinting && this.speedNow > 3 ? 6 : 0);
            if (ws && ws.aiming) fov -= ws.aimZoom || 14;
            this.fovCur = U.damp(this.fovCur, fov, 10, dt);
            if (Math.abs(cam.fov - this.fovCur) > 0.01) { cam.fov = this.fovCur; cam.updateProjectionMatrix(); }
        }

        forward(out) {
            const v = out || new THREE.Vector3();
            return v.set(0, 0, -1).applyEuler(this.camera.rotation);
        }

        /** Estado compacto para red */
        netState() {
            const ws = this.game.weapons;
            return {
                x: U.round(this.pos.x, 2), y: U.round(this.pos.y, 2), z: U.round(this.pos.z, 2),
                yaw: U.round(this.yaw, 3), pitch: U.round(this.pitch, 2),
                vx: U.round(this.vel.x, 1), vz: U.round(this.vel.z, 1),
                cr: this.crouch ? 1 : 0, sp: this.sprinting ? 1 : 0, gr: this.grounded ? 1 : 0,
                bl: ws && ws.blocking ? 1 : 0, w: ws ? ws.currentId : 'gladius',
                dg: this.iframes > 0 ? 1 : 0, aim: ws && ws.aiming ? 1 : 0
            };
        }
    }
    GL.PlayerController = PlayerController;
})();
