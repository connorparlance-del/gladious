/* Viewmodel — brazos y arma en primera persona, dibujados en una pasada aparte
 * (sin atravesar paredes). Usa exactamente la misma pose que la detección de impactos. */
(function () {
    const U = GL.U;
    const UP = new THREE.Vector3(0, 1, 0);

    class Viewmodel {
        constructor(game) {
            this.game = game;
            this.scene = new THREE.Scene();
            this.camera = new THREE.PerspectiveCamera(GL.GAME_CONFIG.player.fov, 1, 0.02, 10);
            this.scene.add(this.camera);
            this.root = new THREE.Group();
            this.scene.add(this.root);
            this.scene.add(new THREE.HemisphereLight(0xffe2b8, 0x6a4a30, 1.3));
            const d = new THREE.DirectionalLight(0xffd29a, 1.8); d.position.set(0.5, 1, 0.4); this.scene.add(d);
            this.models = {};
            this.blades = {};
            this.weapon = null; this.weaponId = null;
            const skinMat = new THREE.MeshStandardMaterial({ color: 0xc99a72, roughness: 0.75, map: GL.Tex.skin() });
            const bracerMat = new THREE.MeshStandardMaterial({ color: 0x4a2e1a, roughness: 0.85 });
            const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x7a1414, roughness: 0.9 });
            this.skinMat = skinMat;
            const fore = new THREE.CylinderGeometry(0.045, 0.038, 1, 10).translate(0, 0.5, 0).rotateX(Math.PI / 2);
            const mkArm = () => {
                const g = new THREE.Group();
                const f = new THREE.Mesh(fore, skinMat); g.add(f);
                const b = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.046, 0.16, 10).rotateX(Math.PI / 2), bracerMat);
                b.position.z = 0.1; g.add(b);
                const s = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.2, 10).rotateX(Math.PI / 2), sleeveMat);
                s.position.z = 0.36; g.add(s);
                const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), skinMat);
                hand.scale.set(1, 0.85, 1.15); g.add(hand);
                g.userData.forearm = f;
                this.root.add(g);
                return g;
            };
            this.armR = mkArm(); this.armL = mkArm();
            this.sleeveMat = sleeveMat;
            this.nocked = GL.WeaponModels.projectile('arrow'); this.nocked.visible = false; this.root.add(this.nocked);
            this.javelinHeld = null;
            this.sway = new THREE.Vector2(); this.swayV = new THREE.Vector2();
            this.lastYaw = 0; this.lastPitch = 0;
            this.tmpQ = new THREE.Quaternion();
            // estela del arma (cinta de los últimos N segmentos de hoja)
            this.trailN = 14;
            const tg = new THREE.BufferGeometry();
            tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.trailN * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
            const al = new Float32Array(this.trailN * 2);
            for (let i = 0; i < this.trailN; i++) { al[i * 2] = al[i * 2 + 1] = i / (this.trailN - 1); }
            tg.setAttribute('alpha', new THREE.BufferAttribute(al, 1));
            const idx = [];
            for (let i = 0; i < this.trailN - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
            tg.setIndex(idx);
            this.trail = new THREE.Mesh(tg, new THREE.ShaderMaterial({
                transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
                uniforms: { uFade: { value: 0 } },
                vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
                fragmentShader: 'uniform float uFade; varying float vA; void main(){ gl_FragColor = vec4(1.0, 0.92, 0.78, vA * vA * 0.55 * uFade); }'
            }));
            this.trail.frustumCulled = false;
            this.scene.add(this.trail);
            this.trailPts = [];
        }

        _updateTrail(ws) {
            const active = ws.state === 'active' && ws.attack;
            const u = this.trail.material.uniforms.uFade;
            if (active) {
                const bl = this.bladeLocal(ws.currentId);
                const base = ws.pose.p.clone().addScaledVector(ws.pose.d, bl.base + (bl.tip - bl.base) * 0.35).add(this.root.position);
                const tip = ws.pose.p.clone().addScaledVector(ws.pose.d, bl.tip).add(this.root.position);
                this.trailPts.push([base, tip]);
                if (this.trailPts.length > this.trailN) this.trailPts.shift();
                u.value = 1;
            } else {
                u.value = Math.max(0, u.value - 0.12);
                if (u.value <= 0) this.trailPts.length = 0;
            }
            const pos = this.trail.geometry.attributes.position;
            const pts = this.trailPts;
            for (let i = 0; i < this.trailN; i++) {
                const pr = pts.length ? pts[Math.max(0, pts.length - this.trailN + i)] || pts[0] : null;
                if (!pr) { pos.setXYZ(i * 2, 0, 0, 0); pos.setXYZ(i * 2 + 1, 0, 0, 0); continue; }
                pos.setXYZ(i * 2, pr[0].x, pr[0].y, pr[0].z); pos.setXYZ(i * 2 + 1, pr[1].x, pr[1].y, pr[1].z);
            }
            pos.needsUpdate = true;
            this.trail.visible = pts.length > 1 && u.value > 0;
        }

        setColor(hex) { this.sleeveMat.color.setHex(hex); }

        bladeLocal(id) {
            if (!this.blades[id]) { const m = this._model(id); this.blades[id] = m.userData.blade || { base: 0.1, tip: 0.6, radius: 0.05 }; }
            return this.blades[id];
        }

        _model(id) {
            if (!this.models[id]) {
                const m = GL.WeaponModels.build(id);
                m.traverse((o) => { if (o.isMesh) o.castShadow = false; });
                m.visible = false;
                this.root.add(m);
                this.models[id] = m;
            }
            return this.models[id];
        }

        setWeapon(id) {
            if (this.weaponId === id) return;
            if (this.weapon) this.weapon.visible = false;
            this.weapon = this._model(id);
            this.weapon.visible = true;
            this.weaponId = id;
        }

        resize(aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }

        /** Coloca un antebrazo desde la mano hacia el codo */
        _placeArm(arm, hand, elbow) {
            arm.position.copy(hand);
            const dir = elbow.clone().sub(hand);
            const len = dir.length();
            arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
            arm.userData.forearm.scale.z = len;
        }

        update(dt, ws, pc) {
            const cam = this.game.camera;
            if (Math.abs(this.camera.fov - cam.fov) > 0.01) { this.camera.fov = cam.fov; this.camera.updateProjectionMatrix(); }
            const visible = pc.alive && !pc.downed && this.game.match && this.game.match.inMatch;
            this.root.visible = visible;
            if (!visible) return;
            const id = ws.currentId;
            this.setWeapon(id);
            const cfg = GL.WEAPON_CONFIG[id];
            // balanceo por movimiento de ratón
            const dyaw = U.angleDiff(this.lastYaw, pc.yaw), dp = pc.pitch - this.lastPitch;
            this.lastYaw = pc.yaw; this.lastPitch = pc.pitch;
            this.swayV.x += -dyaw * 0.6 - this.sway.x * 60 * dt; this.swayV.y += dp * 0.6 - this.sway.y * 60 * dt;
            this.swayV.multiplyScalar(Math.exp(-12 * dt));
            this.sway.x = U.clamp(this.sway.x + this.swayV.x * dt * 10, -0.06, 0.06);
            this.sway.y = U.clamp(this.sway.y + this.swayV.y * dt * 10, -0.05, 0.05);
            const bob = pc.bobAmt;
            const bx = Math.cos(pc.bobPhase) * 0.012 * bob + this.sway.x;
            const by = -Math.abs(Math.sin(pc.bobPhase)) * 0.016 * bob - this.sway.y + (pc.sprinting ? -0.04 : 0);
            this.root.position.set(bx, by - pc.landT * 0.04, ws.recoil * 0.06);
            this.root.rotation.set(0, 0, pc.sprinting ? 0.15 * bob : 0);

            this.nocked.visible = false;
            const w = this.weapon;
            if (cfg.type === 'melee') {
                const p = ws.pose.p, d = ws.pose.d;
                w.position.copy(p);
                w.quaternion.setFromUnitVectors(UP, d);
                // mano derecha en la empuñadura
                const elbowR = p.clone().add(new THREE.Vector3(0.12, -0.24, 0.3));
                this._placeArm(this.armR, p, elbowR);
                const twoHanded = ['greatsword', 'heavyaxe', 'hammer', 'spear'].includes(id);
                this.armL.visible = twoHanded;
                if (twoHanded) {
                    const lh = id === 'spear' ? p.clone().addScaledVector(d, 0.45) : p.clone().addScaledVector(d, -0.17);
                    this._placeArm(this.armL, lh, lh.clone().add(new THREE.Vector3(-0.2, -0.25, 0.28)));
                }
            } else if (cfg.type === 'bow') {
                const aim = ws.aiming ? 1 : 0;
                const L = new THREE.Vector3(U.lerp(-0.1, -0.03, aim), U.lerp(-0.12, -0.06, aim), -0.5);
                w.position.copy(L);
                w.rotation.set(0, 0, U.lerp(0.25, 0.08, aim));
                if (w.userData.setDraw) w.userData.setDraw(ws.state === 'draw' ? ws.charge : 0);
                this._placeArm(this.armL, L.clone().add(new THREE.Vector3(0, 0, -0.16).applyEuler(w.rotation)), L.clone().add(new THREE.Vector3(-0.18, -0.25, 0.35)));
                this.armL.visible = true;
                const draw = ws.state === 'draw' ? ws.charge : 0;
                const nock = new THREE.Vector3(0, 0, 0.02 + draw * 0.5).applyEuler(w.rotation).add(L);
                const hasArrow = ws.current.ammo > 0 && ws.state !== 'reload';
                this._placeArm(this.armR, hasArrow ? nock : L.clone().add(new THREE.Vector3(0.25, -0.15, 0.2)), nock.clone().add(new THREE.Vector3(0.15, -0.2, 0.32)));
                if (hasArrow) {
                    this.nocked.visible = true;
                    this.nocked.position.copy(nock).add(new THREE.Vector3(0, 0, -0.37).applyEuler(w.rotation));
                    this.nocked.quaternion.setFromEuler(w.rotation);
                    this.nocked.rotateY(Math.PI);
                }
            } else if (cfg.type === 'crossbow') {
                const aim = ws.aiming ? 1 : 0;
                const P = new THREE.Vector3(U.lerp(0.17, 0.0, aim), U.lerp(-0.2, -0.13, aim), -0.28 + ws.recoil * 0.08);
                w.position.copy(P);
                const reloadTilt = ws.state === 'reload' ? Math.sin(Math.min(1, 1 - ws.reloadT / cfg.reload) * Math.PI) * 0.7 : 0;
                w.rotation.set(-reloadTilt + ws.recoil * 0.15, 0, 0);
                if (w.userData.setLoaded) w.userData.setLoaded(ws.loaded);
                this._placeArm(this.armR, P.clone().add(new THREE.Vector3(0, -0.1, 0.04)), P.clone().add(new THREE.Vector3(0.14, -0.28, 0.3)));
                this._placeArm(this.armL, P.clone().add(new THREE.Vector3(0, -0.05, -0.38).applyEuler(w.rotation)), P.clone().add(new THREE.Vector3(-0.22, -0.3, -0.05)));
                this.armL.visible = true;
            } else { // jabalina
                const draw = ws.state === 'draw' ? U.smooth(ws.charge) : 0;
                const has = ws.current.ammo > 0 && ws.state !== 'reload';
                w.visible = has;
                const P = new THREE.Vector3(U.lerp(0.3, 0.36, draw), U.lerp(-0.2, 0.0, draw), U.lerp(-0.3, 0.05, draw));
                w.position.copy(P);
                w.quaternion.setFromUnitVectors(UP, new THREE.Vector3(-0.08, U.lerp(0.05, 0.12, draw), -1).normalize());
                this._placeArm(this.armR, P, P.clone().add(new THREE.Vector3(0.1, -0.25, 0.3)));
                this.armL.visible = false;
            }
            if (cfg.type !== 'throw') w.visible = true;
            this._updateTrail(ws);
        }

        render(renderer) {
            if (!this.root.visible) return;
            renderer.autoClear = false;
            renderer.clearDepth();
            renderer.render(this.scene, this.camera);
        }
    }
    GL.Viewmodel = Viewmodel;
})();
