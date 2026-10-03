/* Character — gladiador procedural articulado con animación procedural determinista
 * y hitboxes por zona (cabeza, torso, brazos, piernas, escudo) ancladas a los huesos.
 * Lo usan enemigos, jefes, jugadores remotos y (invisible) el jugador local. */
(function () {
    const U = GL.U;
    const tmpV = new THREE.Vector3();

    const geo = {};
    function G(key, make) { return geo[key] || (geo[key] = make()); }

    const ZONES = ['head', 'torso', 'armL', 'armR', 'legL', 'legR'];

    /* ---------------- Poses base ---------------- */
    function basePose() {
        return {
            pelvisY: 0, pelvisX: 0, spineX: 0, spineY: 0, spineZ: 0, headX: 0, headY: 0,
            shRx: 0.15, shRy: 0, shRz: 0.12, elR: 0.25, haR: 0, haRz: 0,
            shLx: 0.15, shLy: 0, shLz: -0.12, elL: 0.25, haL: 0,
            hipRx: 0, hipRz: 0, knR: 0, hipLx: 0, hipLz: 0, knL: 0,
            spin: 0, fall: 0, fallSide: 0, crouch: 0, kneel: 0
        };
    }
    const KEYS = Object.keys(basePose());

    function lerpPose(out, a, b, t) { for (const k of KEYS) out[k] = a[k] + (b[k] - a[k]) * t; return out; }

    /* Posturas de guardia según tipo de arma */
    function guardPose(p, weapon, hasShield) {
        const cfg = GL.WEAPON_CONFIG[weapon] || {};
        if (cfg.type === 'bow') {
            p.shRx = 0.2; p.elR = 0.3; p.shLx = 0.35; p.elL = 0.5; p.shLz = -0.2;
        } else if (cfg.type === 'crossbow') {
            p.shRx = 0.9; p.elR = 1.2; p.haR = -0.6; p.shLx = 1.0; p.elL = 1.1; p.shLy = -0.5;
        } else if (weapon === 'spear' || weapon === 'javelin') {
            p.shRx = 0.25; p.shRy = 0.1; p.elR = 1.35; p.haR = -1.55; p.shLx = 0.9; p.elL = 0.9; p.shLy = -0.4;
        } else if (weapon === 'greatsword' || weapon === 'heavyaxe' || weapon === 'hammer') {
            p.shRx = 0.6; p.shRy = 0.3; p.elR = 1.0; p.haR = -0.3; p.shLx = 0.7; p.shLy = -0.5; p.elL = 1.1;
        } else {
            p.shRx = 0.55; p.shRy = -0.15; p.elR = 1.05; p.haR = -0.45;
            if (hasShield) { p.shLx = 0.95; p.shLy = 0.35; p.elL = 1.45; p.haL = 0; }
            else { p.shLx = 0.35; p.elL = 0.6; p.shLz = -0.25; }
        }
        return p;
    }

    /* Fotogramas clave de ataques: [preparación, impacto inicio, impacto fin] */
    const ARCS = {
        slash: [
            { spineY: -0.55, shRx: 1.35, shRy: -1.35, shRz: 0, elR: 0.35, haR: -1.25 },
            { spineY: -0.3, shRx: 1.45, shRy: -0.9, shRz: 0, elR: 0.15, haR: -1.35 },
            { spineY: 0.55, shRx: 1.45, shRy: 1.0, shRz: 0, elR: 0.15, haR: -1.35 }
        ],
        overhead: [
            { spineX: -0.15, shRx: 2.9, shRy: 0, shRz: 0.1, elR: 1.1, haR: -0.4 },
            { spineX: 0.0, shRx: 2.4, shRy: 0, shRz: 0.05, elR: 0.4, haR: -0.9 },
            { spineX: 0.45, shRx: 0.75, shRy: 0, shRz: 0, elR: 0.05, haR: -1.45 }
        ],
        thrust: [
            { spineY: -0.35, shRx: 1.1, shRy: -0.2, elR: 1.9, haR: -1.55 },
            { spineY: -0.2, shRx: 1.3, shRy: -0.1, elR: 1.2, haR: -1.55 },
            { spineY: 0.2, spineX: 0.2, shRx: 1.55, shRy: 0.05, elR: 0.02, haR: -1.55 }
        ],
        spin: [
            { spineY: -0.5, shRx: 1.5, shRy: -1.4, elR: 0.1, haR: -1.45 },
            { spineY: 0, shRx: 1.5, shRy: -1.4, elR: 0.1, haR: -1.45 },
            { spineY: 0, shRx: 1.5, shRy: -1.4, elR: 0.1, haR: -1.45 }
        ],
        shoot: [
            { shLx: 1.57, shLy: 0, elL: 0, shRx: 1.5, shRy: 0.35, elR: 2.2, haR: 0, spineY: 0.3 },
            { shLx: 1.57, shLy: 0, elL: 0, shRx: 1.5, shRy: 0.35, elR: 2.4, haR: 0, spineY: 0.35 },
            { shLx: 1.57, shLy: 0, elL: 0, shRx: 1.3, shRy: 0.1, elR: 0.6, haR: 0, spineY: 0.3 }
        ],
        throw: [
            { spineY: -0.6, shRx: 2.6, shRy: -0.4, elR: 1.0, haR: -1.2 },
            { spineY: -0.5, shRx: 2.7, shRy: -0.3, elR: 0.8, haR: -1.3 },
            { spineY: 0.4, spineX: 0.3, shRx: 1.2, shRy: 0.1, elR: 0.1, haR: -1.4 }
        ],
        slam: [
            { spineX: -0.3, shRx: 3.0, shLx: 3.0, elR: 0.6, elL: 0.6, haR: -0.3, pelvisY: 0.0 },
            { spineX: -0.2, shRx: 3.0, shLx: 3.0, elR: 0.3, elL: 0.3, haR: -0.5, pelvisY: 0.0 },
            { spineX: 0.6, shRx: 0.9, shLx: 0.9, elR: 0, elL: 0, haR: -1.5, pelvisY: -0.25, knR: 0.8, knL: 0.8, hipRx: 0.6, hipLx: 0.6 }
        ]
    };

    class Character {
        constructor(opts) {
            this.opts = Object.assign({ scale: 1, color: 0x9a3b2b, armor: 'media', helmet: 'galea', shield: null, weapon: 'gladius', cape: null, elite: false, boss: false, skin: 0xc99a72 }, opts || {});
            this.scale = this.opts.scale;
            this.root = new THREE.Group();
            this.body = new THREE.Group();      // para caídas
            this.root.add(this.body);
            this.pose = basePose();
            this.target = basePose();
            this.tmpPose = basePose();
            this.state = 'idle';
            this.locoPhase = 0;
            this.speed = 0;
            this.action = null;              // { kind, arc, windup, active, recovery, t }
            this.hitboxes = [];
            this.flashT = 0;
            this.mats = [];
            this._build();
            this._mergeStatic();
            this.setWeapon(this.opts.weapon);
            this.root.scale.setScalar(this.scale);
            for (const z of ZONES) this.hitboxes.push({ zone: z, a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0.1, owner: this });
            // 2ª cápsula para brazos y piernas (antebrazo / espinilla)
            for (const z of ['armL', 'armR', 'legL', 'legR']) this.hitboxes.push({ zone: z, a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0.08, owner: this });
            if (this.opts.shield) this.hitboxes.push({ zone: 'shield', a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0.3, owner: this });
        }

        _mat(color, rough, metal, map) {
            const m = new THREE.MeshStandardMaterial({ color, roughness: rough == null ? 0.8 : rough, metalness: metal || 0, map: map || null });
            this.mats.push(m);
            return m;
        }

        _mesh(geom, mat, parent, x, y, z, rx, ry, rz) {
            const m = new THREE.Mesh(geom, mat);
            m.position.set(x || 0, y || 0, z || 0);
            if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
            m.castShadow = true;
            parent.add(m);
            return m;
        }

        _build() {
            const o = this.opts;
            const skin = this._mat(o.skin, 0.75, 0, GL.Tex.skin());
            const cloth = this._mat(o.color, 0.9);
            const leather = this._mat(0x4a2e1a, 0.85);
            const armorColor = o.elite ? 0xe0b44a : o.armor === 'pesada' ? 0x8c9096 : o.armor === 'gold' ? 0xd8a840 : 0xb98a3e;
            const metal = this._mat(armorColor, 0.35, 0.85);
            if (o.elite) { metal.emissive = new THREE.Color(0x553300); metal.emissiveIntensity = 0.6; }
            this.matsByRole = { skin, cloth, leather, metal };

            const P = new THREE.Object3D(); P.position.y = 0.95; this.body.add(P); this.pelvis = P;
            const S = new THREE.Object3D(); P.add(S); this.spine = S;
            // torso
            this._mesh(G('torso', () => new THREE.CylinderGeometry(0.2, 0.16, 0.55, 10)), cloth, S, 0, 0.3, 0);
            this._mesh(G('belt', () => new THREE.CylinderGeometry(0.175, 0.175, 0.09, 10)), leather, S, 0, 0.04, 0);
            this._mesh(G('skirt', () => new THREE.CylinderGeometry(0.18, 0.27, 0.3, 10, 1, true)), cloth, P, 0, -0.14, 0).material.side = THREE.DoubleSide;
            if (o.armor !== 'ligera') {
                const chest = this._mesh(G('chest', () => new THREE.CylinderGeometry(0.215, 0.18, 0.36, 10)), metal, S, 0, 0.37, 0);
                chest.scale.z = 0.95;
                if (o.armor === 'pesada' || o.boss || o.elite) {
                    for (let i = 0; i < 3; i++) this._mesh(G('band', () => new THREE.TorusGeometry(0.2, 0.018, 4, 14)), metal, S, 0, 0.17 + i * 0.07, 0, Math.PI / 2, 0, 0);
                }
            }
            // cuello y cabeza
            const N = new THREE.Object3D(); N.position.y = 0.6; S.add(N); this.neck = N;
            const H = new THREE.Object3D(); H.position.y = 0.13; N.add(H); this.head = H;
            this._mesh(G('head', () => new THREE.SphereGeometry(0.12, 12, 10)), skin, H, 0, 0, 0);
            this._buildHelmet(H, metal, cloth);
            // hombros/brazos
            this.shR = new THREE.Object3D(); this.shR.position.set(0.25, 0.5, 0); this.shR.rotation.order = 'YXZ'; S.add(this.shR);
            this.shL = new THREE.Object3D(); this.shL.position.set(-0.25, 0.5, 0); this.shL.rotation.order = 'YXZ'; S.add(this.shL);
            const upper = G('upper', () => new THREE.CylinderGeometry(0.06, 0.055, 0.3, 8).translate(0, -0.15, 0));
            const fore = G('fore', () => new THREE.CylinderGeometry(0.055, 0.045, 0.28, 8).translate(0, -0.14, 0));
            const bracer = G('bracer', () => new THREE.CylinderGeometry(0.062, 0.055, 0.16, 8).translate(0, -0.16, 0));
            this._mesh(upper, skin, this.shR); this._mesh(upper, skin, this.shL);
            if (o.armor !== 'ligera' || o.boss) {
                const pad = this._mesh(G('pad', () => new THREE.SphereGeometry(0.09, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2)), metal, this.shR, 0, 0.02, 0);
                pad.scale.set(1.2, 0.9, 1.1);
            }
            this.elR = new THREE.Object3D(); this.elR.position.y = -0.3; this.shR.add(this.elR);
            this.elL = new THREE.Object3D(); this.elL.position.y = -0.3; this.shL.add(this.elL);
            this._mesh(fore, skin, this.elR); this._mesh(fore, skin, this.elL);
            this._mesh(bracer, leather, this.elR); this._mesh(bracer, leather, this.elL);
            this.haR = new THREE.Object3D(); this.haR.position.y = -0.29; this.elR.add(this.haR);
            this.haL = new THREE.Object3D(); this.haL.position.y = -0.29; this.elL.add(this.haL);
            this._mesh(G('hand', () => new THREE.SphereGeometry(0.05, 6, 5)), skin, this.haR);
            this._mesh(G('hand', null), skin, this.haL);
            this.sockR = new THREE.Object3D(); this.sockR.rotation.x = -Math.PI / 2; this.haR.add(this.sockR);
            this.sockL = new THREE.Object3D(); this.sockL.rotation.x = -Math.PI / 2; this.haL.add(this.sockL);
            // escudo
            if (o.shield) {
                const sh = GL.WeaponModels.build(o.shield === 'scutum' ? 'scutum' : 'shield');
                sh.position.set(-0.03, -0.02, -0.08);
                sh.rotation.set(0, 0, 0);
                this.shieldHolder = new THREE.Object3D();
                this.shieldHolder.position.set(-0.05, -0.12, 0);
                this.shieldHolder.rotation.set(Math.PI / 2, 0, Math.PI / 2);
                this.elL.add(this.shieldHolder);
                this.shieldHolder.add(sh);
                this.shieldMesh = sh;
                this.shieldTop = new THREE.Object3D(); this.shieldBot = new THREE.Object3D();
                const half = o.shield === 'scutum' ? 0.38 : 0.12;
                this.shieldTop.position.set(0, half, -0.05); this.shieldBot.position.set(0, -half, -0.05);
                sh.add(this.shieldTop); sh.add(this.shieldBot);
            }
            // piernas
            const thigh = G('thigh', () => new THREE.CylinderGeometry(0.085, 0.07, 0.45, 8).translate(0, -0.225, 0));
            const shin = G('shin', () => new THREE.CylinderGeometry(0.065, 0.05, 0.45, 8).translate(0, -0.225, 0));
            const greave = G('greave', () => new THREE.CylinderGeometry(0.072, 0.062, 0.3, 8).translate(0, -0.18, 0.012));
            const foot = G('foot', () => new THREE.BoxGeometry(0.1, 0.06, 0.22).translate(0, -0.03, -0.04));
            this.hipR = new THREE.Object3D(); this.hipR.position.set(0.11, -0.03, 0); P.add(this.hipR);
            this.hipL = new THREE.Object3D(); this.hipL.position.set(-0.11, -0.03, 0); P.add(this.hipL);
            this._mesh(thigh, skin, this.hipR); this._mesh(thigh, skin, this.hipL);
            this.knR = new THREE.Object3D(); this.knR.position.y = -0.45; this.hipR.add(this.knR);
            this.knL = new THREE.Object3D(); this.knL.position.y = -0.45; this.hipL.add(this.knL);
            this._mesh(shin, skin, this.knR); this._mesh(shin, skin, this.knL);
            this._mesh(greave, o.armor === 'ligera' ? leather : metal, this.knR); this._mesh(greave, o.armor === 'ligera' ? leather : metal, this.knL);
            this.ftR = new THREE.Object3D(); this.ftR.position.y = -0.45; this.knR.add(this.ftR);
            this.ftL = new THREE.Object3D(); this.ftL.position.y = -0.45; this.knL.add(this.ftL);
            this._mesh(foot, leather, this.ftR); this._mesh(foot, leather, this.ftL);
            // capa
            if (o.cape) {
                const capeMat = this._mat(o.cape, 0.95); capeMat.side = THREE.DoubleSide;
                const cape = this._mesh(G('cape', () => new THREE.PlaneGeometry(0.5, 0.95, 1, 4).translate(0, -0.475, 0)), capeMat, S, 0, 0.58, 0.19, 0.12, 0, 0);
                this.cape = cape;
            }
            if (o.elite || o.boss) {
                const aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: GL.Tex.radial(), color: o.boss ? 0xff5522 : 0xffbb33, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
                aura.scale.set(2.2, 2.6, 1); aura.position.y = 1.0;
                this.root.add(aura); this.aura = aura;
            }
        }

        /** Fusiona las mallas que comparten hueso y material (menos draw calls por personaje) */
        _mergeStatic() {
            const skip = new Set([this.cape, ...(this.eyeGlow || [])]);
            const parents = [];
            this.body.traverse((o) => { if (!o.isMesh && o.children.length) parents.push(o); });
            for (const parent of parents) {
                const groups = new Map();
                for (const c of parent.children) {
                    if (!c.isMesh || skip.has(c) || c.children.length) continue;
                    const k = c.material.uuid;
                    if (!groups.has(k)) groups.set(k, []);
                    groups.get(k).push(c);
                }
                for (const list of groups.values()) {
                    if (list.length < 2) continue;
                    const parts = list.map((m) => { m.updateMatrix(); const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()); g.applyMatrix4(m.matrix); if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; });
                    let n = 0; parts.forEach((g) => { n += g.attributes.position.count; });
                    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
                    let o = 0;
                    for (const g of parts) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); uv.set(g.attributes.uv.array, o * 2); o += g.attributes.position.count; g.dispose(); }
                    const geo = new THREE.BufferGeometry();
                    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
                    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
                    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
                    geo.computeBoundingSphere();
                    const merged = new THREE.Mesh(geo, list[0].material);
                    merged.castShadow = true;
                    for (const m of list) parent.remove(m);
                    parent.add(merged);
                    (this.ownGeos = this.ownGeos || []).push(geo);
                }
            }
        }

        _buildHelmet(H, metal, cloth) {
            const o = this.opts;
            const hm = o.helmet;
            if (hm === 'none') return;
            if (hm === 'hood') {
                const hood = this._mesh(G('hood', () => new THREE.ConeGeometry(0.16, 0.3, 10, 1, true)), cloth, H, 0, 0.08, 0.02);
                hood.material = cloth; return;
            }
            const dome = this._mesh(G('dome', () => new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62)), metal, H, 0, 0.01, 0);
            if (hm === 'galea' || hm === 'crest' || o.boss) {
                const brim = this._mesh(G('brim', () => new THREE.CylinderGeometry(0.19, 0.2, 0.02, 14)), metal, H, 0, -0.02, 0);
                brim.scale.z = 1.05;
                const crestMat = this._mat(o.boss ? 0xb01010 : o.color, 0.9);
                const crest = this._mesh(G('crest', () => new THREE.BoxGeometry(0.04, 0.12, 0.3)), crestMat, H, 0, 0.17, 0.02);
                if (o.boss) crest.scale.set(1.4, 1.6, 1.3);
            }
            if (hm === 'visor' || o.boss) {
                // rejilla frontal
                const vmat = this._mat(0x222222, 0.6, 0.8);
                for (let i = -2; i <= 2; i++) this._mesh(G('vbar', () => new THREE.BoxGeometry(0.012, 0.13, 0.012)), vmat, H, i * 0.035, -0.02, -0.125);
            }
            if (hm === 'horned') {
                for (const s of [-1, 1]) this._mesh(G('horn', () => new THREE.ConeGeometry(0.03, 0.2, 6)), this._mat(0xe8dcc0, 0.6), H, s * 0.13, 0.1, 0, 0, 0, -s * 0.6);
            }
            this.eyeGlow = null;
            if (o.boss) {
                const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3300 });
                const e1 = this._mesh(G('eye', () => new THREE.SphereGeometry(0.018, 6, 4)), eyeMat, H, -0.04, 0.0, -0.11);
                const e2 = this._mesh(G('eye', null), eyeMat, H, 0.04, 0.0, -0.11);
                e1.visible = e2.visible = false;
                this.eyeGlow = [e1, e2];
            }
        }

        setWeapon(id) {
            if (this.weaponMesh) { this.sockR.remove(this.weaponMesh); this.weaponMesh = null; }
            this.weaponId = id;
            if (!id) return;
            const w = GL.WeaponModels.build(id);
            const cfg = GL.WEAPON_CONFIG[id] || {};
            if (cfg.type === 'crossbow') { w.rotation.set(Math.PI / 2, 0, 0); w.position.set(0, -0.05, 0.1); }
            if (cfg.type === 'bow') {
                // el arco lo sostiene la mano izquierda
                this.sockL.add(w); w.rotation.set(0, 0, 0); w.position.set(0, 0, 0);
                this.weaponMesh = w; this.weaponInLeft = true;
                this.blade = null;
                return;
            }
            this.weaponInLeft = false;
            this.sockR.add(w);
            this.weaponMesh = w;
            this.blade = w.userData.blade;
            this.bladeBase = new THREE.Object3D(); this.bladeTip = new THREE.Object3D();
            if (this.blade) { this.bladeBase.position.y = this.blade.base; this.bladeTip.position.y = this.blade.tip; }
            w.add(this.bladeBase); w.add(this.bladeTip);
        }

        /** Inicia una acción animada (ataque, bloqueo, golpe recibido…) */
        play(kind, opts) {
            const o = opts || {};
            this.action = {
                kind, arc: o.arc || 'slash', t: o.t || 0,
                windup: o.windup || 0.2, active: o.active || 0.15, recovery: o.recovery || 0.25,
                duration: o.duration || ((o.windup || 0.2) + (o.active || 0.15) + (o.recovery || 0.25)),
                spinTurns: o.spinTurns || 0
            };
        }
        stopAction() { this.action = null; }

        /** Fase del ataque actual: 'windup' | 'active' | 'recovery' | null */
        attackPhase() {
            const a = this.action;
            if (!a || (a.kind !== 'attack')) return null;
            if (a.t < a.windup) return 'windup';
            if (a.t < a.windup + a.active) return 'active';
            if (a.t < a.duration) return 'recovery';
            return null;
        }

        /**
         * Actualiza animación.
         * params: { speed (m/s), dt, blocking, state ('alive'|'dead'|'downed'|'stagger'), crouch, aimPitch }
         */
        animate(dt, params) {
            const p = params || {};
            const base = this.target;
            Object.assign(base, basePose());
            const sp = p.speed || 0;
            this.speed = U.damp(this.speed, sp, 10, dt);
            const s = this.speed;
            // locomoción
            this.locoPhase += dt * (2.2 + s * 1.35);
            const amp = Math.min(1, s / 5) * 0.75;
            const ph = this.locoPhase;
            base.hipRx = Math.sin(ph) * amp; base.hipLx = -Math.sin(ph) * amp;
            base.knR = Math.max(0, -Math.sin(ph - 0.6)) * amp * 1.4 + 0.05;
            base.knL = Math.max(0, Math.sin(ph - 0.6)) * amp * 1.4 + 0.05;
            base.pelvisY = -Math.abs(Math.sin(ph)) * 0.04 * Math.min(1, s / 3);
            base.spineX = Math.min(0.25, s * 0.03);
            base.spineY = Math.sin(ph) * 0.08 * amp;
            guardPose(base, this.weaponId, !!this.opts.shield);
            base.shLx += -Math.sin(ph) * amp * 0.3;
            if (!sp) { base.spineX += Math.sin(this.locoPhase * 0.6) * 0.015; }
            if (p.crouch) { base.crouch = 1; base.pelvisY -= 0.32; base.hipRx += 0.9; base.hipLx += 0.9; base.knR += 1.6; base.knL += 1.6; base.spineX += 0.25; }
            if (p.blocking) {
                if (this.opts.shield) { base.shLx = 1.35; base.shLy = 0.55; base.elL = 1.35; }
                else { base.shRx = 1.25; base.shRy = 0.75; base.elR = 0.9; base.haR = -1.2; base.haRz = 0; base.spineY = -0.2; }
            }
            if (p.aimPitch && this.weaponId && GL.WEAPON_CONFIG[this.weaponId] && GL.WEAPON_CONFIG[this.weaponId].slot === 'ranged') base.spineX -= p.aimPitch * 0.6;

            // acción superpuesta
            const a = this.action;
            if (a) {
                a.t += dt;
                if (a.kind === 'attack') this._applyAttack(base, a);
                else if (a.kind === 'hit') { const k = 1 - a.t / a.duration; base.spineX -= 0.35 * k; base.headX -= 0.3 * k; base.shRz += 0.4 * k; }
                else if (a.kind === 'stagger') { const k = Math.sin(Math.min(1, a.t / a.duration) * Math.PI); base.spineX -= 0.55 * k; base.headX -= 0.4 * k; base.shRz += 0.9 * k; base.shLz -= 0.9 * k; base.knR += 0.4 * k; base.hipRx -= 0.3 * k; }
                else if (a.kind === 'roar') { const k = Math.sin(Math.min(1, a.t / a.duration) * Math.PI); base.spineX -= 0.5 * k; base.headX -= 0.6 * k; base.shRz += 1.2 * k; base.shLz -= 1.2 * k; base.shRx += 1.0 * k; base.shLx += 1.0 * k; }
                else if (a.kind === 'equip') { const k = Math.sin(Math.min(1, a.t / a.duration) * Math.PI); base.shRx -= 0.6 * k; base.elR += 0.5 * k; }
                if (a.t >= a.duration) this.action = null;
            }
            if (p.state === 'dead') { base.fall = 1; }
            if (p.state === 'downed') { base.kneel = 1; base.pelvisY = -0.55; base.hipRx = 1.4; base.knR = 2.2; base.hipLx = -0.2; base.knL = 1.7; base.spineX = 0.3; base.shLx = 0.6; base.elL = 0.3; }

            // mezcla suave hacia la pose objetivo
            const k = 1 - Math.exp(-(a && a.kind === 'attack' ? 40 : 14) * dt);
            lerpPose(this.pose, this.pose, base, k);
            this.pose.spin = base.spin;   // el giro no se mezcla (vueltas completas)
            if (p.state === 'dead') this.pose.fall = Math.min(1, this.pose.fall + dt * 2.2);
            this._applyPose();
            if (this.flashT > 0) {
                this.flashT -= dt;
                const v = Math.max(0, this.flashT) * 4;
                for (const m of this.mats) { if (m.emissive) { m.emissive.setRGB(v * this.flashColor.r, v * this.flashColor.g, v * this.flashColor.b); } }
                if (this.flashT <= 0) this._restoreEmissive();
            }
            if (this.cape) this.cape.rotation.x = 0.12 + Math.min(0.9, s * 0.12) + Math.sin(ph * 0.5) * 0.05;
            if (this.aura) this.aura.material.opacity = 0.25 + Math.sin(this.locoPhase * 2) * 0.08;
        }

        _applyAttack(base, a) {
            const keys = ARCS[a.arc] || ARCS.slash;
            let from, to, t;
            if (a.t < a.windup) { from = null; to = keys[0]; t = U.easeOut(a.t / a.windup); }
            else if (a.t < a.windup + a.active) { from = keys[1]; to = keys[2]; t = U.smooth((a.t - a.windup) / a.active); }
            else { from = keys[2]; to = null; t = U.easeIn(Math.min(1, (a.t - a.windup - a.active) / Math.max(0.01, a.recovery))); }
            const tp = this.tmpPose; Object.assign(tp, base);
            const A = from ? Object.assign({}, base, from) : base;
            const Bp = to ? Object.assign({}, base, to) : base;
            if (a.t >= a.windup && a.t < a.windup + a.active && a.t - a.windup < 0.001) { /* inicio activo */ }
            // durante la preparación partimos de la pose base, en impacto de keys[1]->keys[2]
            for (const k of KEYS) base[k] = A[k] + (Bp[k] - A[k]) * t;
            if (a.arc === 'spin' || a.spinTurns) {
                const turns = a.spinTurns || 1;
                const st = U.clamp((a.t - a.windup) / (a.active), 0, 1);
                base.spin = -st * Math.PI * 2 * turns;
            }
        }

        _applyPose() {
            const p = this.pose;
            this.pelvis.position.y = 0.95 + p.pelvisY;
            this.pelvis.rotation.set(p.pelvisX, p.spin, 0);
            this.spine.rotation.set(p.spineX, p.spineY, p.spineZ);
            this.head.rotation.set(p.headX, p.headY, 0);
            this.shR.rotation.set(p.shRx, p.shRy, p.shRz);
            this.shL.rotation.set(p.shLx, p.shLy, p.shLz);
            this.elR.rotation.x = p.elR; this.elL.rotation.x = p.elL;
            this.haR.rotation.set(p.haR, 0, p.haRz); this.haL.rotation.x = p.haL;
            this.hipR.rotation.set(p.hipRx, 0, p.hipRz); this.hipL.rotation.set(p.hipLx, 0, p.hipLz);
            this.knR.rotation.x = -p.knR; this.knL.rotation.x = -p.knL;
            // caída (muerte)
            const f = U.smooth(U.clamp(p.fall, 0, 1));
            this.body.rotation.x = -f * 1.45;
            this.body.position.y = f * 0.12;
            this.body.position.z = f * 0.35;
        }

        flash(color) {
            this.flashColor = new THREE.Color(color || 0xff2200);
            this.flashT = 0.18;
        }
        _restoreEmissive() {
            for (const m of this.mats) if (m.emissive) m.emissive.setRGB(0, 0, 0);
            if (this.opts.elite) { this.matsByRole.metal.emissive.setHex(0x553300); }
        }

        setEnraged(on) {
            if (this.eyeGlow) this.eyeGlow.forEach((e) => { e.visible = on; });
            if (this.aura) this.aura.material.color.setHex(on ? 0xff1100 : 0xff5522);
        }

        /** Recalcula hitboxes en coordenadas de mundo (llamar tras animate y posicionar root) */
        computeHitboxes() {
            this.root.updateMatrixWorld(true);
            const s = this.scale;
            const hb = this.hitboxes;
            const wp = (obj, out) => obj.getWorldPosition(out);
            // cabeza
            wp(this.head, hb[0].a); hb[0].b.copy(hb[0].a); hb[0].a.y -= 0.03 * s; hb[0].b.y += 0.04 * s; hb[0].r = 0.13 * s;
            // torso: pelvis -> cuello
            wp(this.pelvis, hb[1].a); hb[1].a.y += 0.05 * s; wp(this.neck, hb[1].b); hb[1].b.y -= 0.05 * s; hb[1].r = 0.2 * s;
            // brazos (superior)
            wp(this.shL, hb[2].a); wp(this.elL, hb[2].b); hb[2].r = 0.075 * s;
            wp(this.shR, hb[3].a); wp(this.elR, hb[3].b); hb[3].r = 0.075 * s;
            // piernas (muslo)
            wp(this.hipL, hb[4].a); wp(this.knL, hb[4].b); hb[4].r = 0.1 * s;
            wp(this.hipR, hb[5].a); wp(this.knR, hb[5].b); hb[5].r = 0.1 * s;
            // antebrazos y espinillas
            wp(this.elL, hb[6].a); wp(this.haL, hb[6].b); hb[6].r = 0.065 * s;
            wp(this.elR, hb[7].a); wp(this.haR, hb[7].b); hb[7].r = 0.065 * s;
            wp(this.knL, hb[8].a); wp(this.ftL, hb[8].b); hb[8].r = 0.075 * s;
            wp(this.knR, hb[9].a); wp(this.ftR, hb[9].b); hb[9].r = 0.075 * s;
            if (this.opts.shield) {
                const h = hb[10];
                wp(this.shieldTop, h.a); wp(this.shieldBot, h.b);
                h.r = (this.opts.shield === 'scutum' ? 0.3 : 0.34) * s;
            }
            return hb;
        }

        /** Segmento de la hoja del arma en mundo. Devuelve false si no hay arma cuerpo a cuerpo */
        bladeSegment(outA, outB) {
            if (!this.blade || !this.weaponMesh) return false;
            this.bladeBase.getWorldPosition(outA);
            this.bladeTip.getWorldPosition(outB);
            return true;
        }

        handWorld(out) { return this.haR.getWorldPosition(out); }
        headWorld(out) { return this.head.getWorldPosition(out); }

        setVisible(v) { this.root.visible = v; }

        dispose() {
            if (this.root.parent) this.root.parent.remove(this.root);
            for (const m of this.mats) m.dispose();
            if (this.ownGeos) for (const g of this.ownGeos) g.dispose();
        }
    }

    Character.ZONES = ZONES;
    Character.ARCS = ARCS;
    GL.Character = Character;
})();
