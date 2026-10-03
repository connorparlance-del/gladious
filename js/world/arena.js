/* ArenaManager — construye el coliseo: arena, podio, gradas, público, plataformas,
 * galerías con puertas, columnas, barricadas, trampas de fuego, estaciones de compra.
 * Registra colisionadores en Physics y expone puntos de spawn/compra. */
(function () {
    const U = GL.U;
    const A = 34, B = 25;          // semiejes de la elipse de arena
    const WALL_H = 4.2;

    class Arena {
        constructor(scene, physics) {
            this.scene = scene;
            this.physics = physics;
            this.root = new THREE.Group();
            this.root.name = 'arena';
            scene.add(this.root);
            this.A = A; this.B = B;
            this.spawnPoints = [];      // { pos, zone, gate? }
            this.playerSpawns = [];
            this.duelSpawns = [];
            this.wallBuys = [];         // { id, weapon, pos, normal, label }
            this.altars = [];           // { id, upgrade, pos, label }
            this.gates = {};            // id -> { collider, mesh, open, pos, label }
            this.fireTraps = [];
            this.torchLights = [];
            this.flames = [];
            this.crowdMat = null;
            this.time = 0;
            this.excite = 0.2;
            physics.bounds.A = A; physics.bounds.B = B;
            this.mats = this._materials();
            this._build();
        }

        _materials() {
            const sand = GL.Tex.sandDetail();
            const stone = GL.Tex.stone(); stone.repeat.set(2, 1);
            const stoneDark = GL.Tex.stone('dark');
            const stoneLight = GL.Tex.stone('light');
            const wood = GL.Tex.wood();
            const N = (t, k) => GL.Tex.normalFrom(t, k);
            const ns = (v) => new THREE.Vector2(v, v);
            return {
                sand: new THREE.MeshStandardMaterial({ map: sand, normalMap: N(sand, 3.5), normalScale: ns(0.8), roughness: 1, color: 0xe2c08a }),
                stone: new THREE.MeshStandardMaterial({ map: stone, normalMap: N(stone, 5), normalScale: ns(1.0), roughness: 0.92, color: 0xd8c8aa }),
                stoneDark: new THREE.MeshStandardMaterial({ map: stoneDark, normalMap: N(stoneDark, 5), normalScale: ns(1.0), roughness: 0.95, color: 0xb0a090 }),
                stoneLight: new THREE.MeshStandardMaterial({ map: stoneLight, normalMap: N(stoneLight, 4), normalScale: ns(0.8), roughness: 0.85, color: 0xffffff }),
                marble: new THREE.MeshStandardMaterial({ color: 0xece4d6, roughness: 0.45, metalness: 0.05 }),
                wood: new THREE.MeshStandardMaterial({ map: wood, normalMap: GL.Tex.normalFrom(wood, 3), roughness: 0.85, color: 0xc9a27a }),
                woodDark: new THREE.MeshStandardMaterial({ map: wood, roughness: 0.9, color: 0x7d5a3a }),
                iron: new THREE.MeshStandardMaterial({ color: 0x3a3a3c, metalness: 0.8, roughness: 0.5 }),
                bronze: new THREE.MeshStandardMaterial({ color: 0xb98a3e, metalness: 0.85, roughness: 0.35 }),
                tunnel: new THREE.MeshStandardMaterial({ color: 0x2a221c, roughness: 1 }),
                redCloth: new THREE.MeshStandardMaterial({ map: GL.Tex.cloth('#7a1414', 'eagle'), roughness: 0.95, side: THREE.DoubleSide }),
                purpleCloth: new THREE.MeshStandardMaterial({ map: GL.Tex.cloth('#3e1a52', 'laurel'), roughness: 0.95, side: THREE.DoubleSide }),
                pennantRed: new THREE.MeshStandardMaterial({ color: 0x9a1a14, roughness: 0.9, side: THREE.DoubleSide }),
                pennantGold: new THREE.MeshStandardMaterial({ color: 0xd4a53a, roughness: 0.8, side: THREE.DoubleSide }),
                pennantPurple: new THREE.MeshStandardMaterial({ color: 0x4a1d66, roughness: 0.9, side: THREE.DoubleSide }),
                flame: new THREE.MeshBasicMaterial({ color: 0xffa040 }),
                water: new THREE.MeshStandardMaterial({ color: 0x3a7a9a, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.85 })
            };
        }

        ellipsePoint(theta, scale) {
            const s = scale || 1;
            return new THREE.Vector3(Math.cos(theta) * A * s, 0, Math.sin(theta) * B * s);
        }
        inwardNormal(p) { const n = new THREE.Vector3(-p.x / (A * A), 0, -p.z / (B * B)); return n.normalize(); }

        add(obj, cast, receive) {
            obj.traverse((o) => { if (o.isMesh) { o.castShadow = cast !== false; o.receiveShadow = receive !== false; } });
            this.root.add(obj);
            return obj;
        }

        boxMesh(x0, y0, z0, x1, y1, z1, mat, collide, opts) {
            const w = x1 - x0, h = y1 - y0, d = z1 - z0;
            const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
            m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
            this.add(m);
            let c = null;
            if (collide !== false) c = this.physics.box(x0, y0, z0, x1, y1, z1, opts);
            return { mesh: m, collider: c };
        }

        _build() {
            this._buildSkyAndLights();
            this._buildFloor();
            this._buildTunnelsDefs();
            this._buildPodiumWall();
            this._buildStands();
            this._buildOuterFacade();
            this._buildTunnels();
            this._buildGalleries();
            this._buildPlatforms();
            this._buildCenter();
            this._buildColumns();
            this._buildCover();
            this._buildFireTraps();
            this._buildDecor();
            this._buildStations();
            this._buildSpawns();
            this._batchStatic();
        }

        /** Fusiona la geometría estática por material: cientos de draw calls → unas decenas */
        _batchStatic() {
            this.root.updateMatrixWorld(true);
            const groups = new Map();
            const isDynamic = (o) => { for (let a = o; a && a !== this.root; a = a.parent) if (a.userData.dynamic) return true; return false; };
            this.root.traverse((o) => {
                if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || o.material.transparent || !o.visible) return;
                if (isDynamic(o)) return;
                const key = o.material.uuid + (o.castShadow ? 'c' : '') + (o.receiveShadow ? 'r' : '');
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(o);
            });
            let merged = 0;
            for (const list of groups.values()) {
                if (list.length < 2) continue;
                const parts = [];
                let count = 0;
                for (const m of list) {
                    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
                    g.applyMatrix4(m.matrixWorld);
                    if (!g.attributes.normal) g.computeVertexNormals();
                    parts.push(g); count += g.attributes.position.count;
                }
                const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uv = new Float32Array(count * 2);
                let off = 0;
                for (const g of parts) {
                    const n = g.attributes.position.count;
                    pos.set(g.attributes.position.array, off * 3);
                    nor.set(g.attributes.normal.array, off * 3);
                    if (g.attributes.uv) uv.set(g.attributes.uv.array, off * 2);
                    off += n; g.dispose();
                }
                const geo = new THREE.BufferGeometry();
                geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
                geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
                geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
                geo.computeBoundingSphere();
                const mesh = new THREE.Mesh(geo, list[0].material);
                mesh.castShadow = list[0].castShadow; mesh.receiveShadow = list[0].receiveShadow;
                mesh.matrixAutoUpdate = false;
                this.root.add(mesh);
                for (const m of list) m.parent.remove(m);
                merged += list.length;
            }
            this.batchedMeshes = merged;
        }

        /* ---------------- Cielo y luces ---------------- */
        _buildSkyAndLights() {
            const s = this.scene;
            s.background = new THREE.Color(0xd9a66b);
            s.fog = new THREE.Fog(0xcf9a62, 90, 420);
            const skyGeo = new THREE.SphereGeometry(400, 24, 12);
            const skyMat = new THREE.ShaderMaterial({
                side: THREE.BackSide, depthWrite: false, fog: false,
                uniforms: { top: { value: new THREE.Color(0x3d6a9e) }, mid: { value: new THREE.Color(0xe7b479) }, bot: { value: new THREE.Color(0xc98a52) }, sunDir: { value: new THREE.Vector3(0.55, 0.32, -0.77).normalize() } },
                vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
                fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; uniform vec3 sunDir; varying vec3 vP; void main(){ float h=vP.y; vec3 c = h>0.0 ? mix(mid, top, pow(clamp(h*1.6,0.0,1.0),0.7)) : mix(mid, bot, clamp(-h*4.0,0.0,1.0)); float s=max(dot(vP,sunDir),0.0); c += vec3(1.0,0.75,0.45)*pow(s,40.0)*1.2 + vec3(1.0,0.6,0.3)*pow(s,6.0)*0.25; if (h > 0.02) { vec2 uv = vP.xz / (h + 0.25) * 1.6; float n = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { n += a * (sin(uv.x * 1.7 + sin(uv.y * 2.3)) * 0.5 + 0.5) * (sin(uv.y * 1.9 + sin(uv.x * 1.3)) * 0.5 + 0.5); uv = uv * 2.03 + vec2(1.7, 9.2); a *= 0.5; } float cl = smoothstep(0.42, 0.75, n) * smoothstep(0.02, 0.25, h); vec3 cc = mix(vec3(1.0, 0.86, 0.72), vec3(1.0,0.95,0.85), s); c = mix(c, cc, cl * 0.75); } gl_FragColor=vec4(c,1.0);} '
            });
            const sky = new THREE.Mesh(skyGeo, skyMat);
            sky.renderOrder = -1;
            s.add(sky);
            this.skyMesh = sky;

            const hemi = new THREE.HemisphereLight(0xffe2b8, 0x8a6a48, 0.7);
            s.add(hemi);
            const sun = new THREE.DirectionalLight(0xffd29a, 2.1);
            sun.position.set(28, 38, -40);
            sun.target.position.set(0, 0, 0);
            const q = GL.GAME_CONFIG.quality;
            sun.castShadow = q.shadows;
            sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
            const sc = sun.shadow.camera;
            sc.left = -42; sc.right = 42; sc.top = 36; sc.bottom = -36; sc.near = 10; sc.far = 120;
            sun.shadow.bias = -0.0006;
            sun.shadow.normalBias = 0.03;
            s.add(sun); s.add(sun.target);
            this.sun = sun;
        }

        /* ---------------- Suelo ---------------- */
        _buildFloor() {
            const g = new THREE.CircleGeometry(1, 96);
            g.rotateX(-Math.PI / 2);
            const floor = new THREE.Mesh(g, this.mats.sand);
            floor.scale.set(A + 1.2, 1, B + 1.2);
            floor.receiveShadow = true;
            // ajustar UV para que la escala no estire la textura
            const uv = g.attributes.uv;
            for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (A / 30), uv.getY(i) * (B / 30));
            this.root.add(floor);
            // suelo exterior bajo gradas y túneles
            const out = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), this.mats.stoneDark);
            out.position.y = -0.02; out.receiveShadow = true;
            const outMat = this.mats.stoneDark.clone();
            outMat.map = this.mats.stoneDark.map.clone(); outMat.map.repeat.set(20, 20); outMat.map.needsUpdate = true;
            outMat.normalMap = this.mats.stoneDark.normalMap.clone(); outMat.normalMap.repeat.set(20, 20); outMat.normalMap.needsUpdate = true;
            out.material = outMat;
            this.root.add(out);
            // anillos marcados en la arena
            for (const s of [0.35, 0.62]) {
                const ring = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x8a6438, transparent: true, opacity: 0.35, depthWrite: false }));
                ring.scale.set(A * s, 1, B * s); ring.position.y = 0.012;
                this.root.add(ring);
            }
        }

        _buildTunnelsDefs() {
            this.tunnelDefs = [];
            for (const cx of [-14, 0, 14]) {
                for (const side of [-1, 1]) {
                    const zE = side * B * Math.sqrt(1 - (cx / A) * (cx / A));
                    const def = { cx, side, zE };
                    // región transitable (fuera de la elipse)
                    const zIn = zE - side * 0.8, zOut = zE + side * 7;
                    def.region = { x0: cx - 1.45, x1: cx + 1.45, z0: Math.min(zIn, zOut), z1: Math.max(zIn, zOut) };
                    this.physics.tunnels.push(def.region);
                    this.tunnelDefs.push(def);
                }
            }
        }

        _isTunnelGap(x, z) {
            for (const t of this.tunnelDefs) if (Math.sign(z) === t.side && Math.abs(x - t.cx) < 2.0) return true;
            return false;
        }

        /* ---------------- Muro del podio (instanciado) ---------------- */
        _buildPodiumWall() {
            const N = 150;
            const segs = [];
            for (let i = 0; i < N; i++) {
                const t0 = i / N * Math.PI * 2, t1 = (i + 1) / N * Math.PI * 2;
                const p0 = this.ellipsePoint(t0), p1 = this.ellipsePoint(t1);
                const mid = p0.clone().add(p1).multiplyScalar(0.5);
                if (this._isTunnelGap(mid.x, mid.z)) continue;
                // galerías E/O: el muro sigue igual (las galerías están dentro)
                segs.push({ p0, p1, mid });
            }
            const geo = new THREE.BoxGeometry(1, WALL_H, 1.4);
            const inst = new THREE.InstancedMesh(geo, this.mats.stone, segs.length);
            const capGeo = new THREE.BoxGeometry(1, 0.3, 1.8);
            const cap = new THREE.InstancedMesh(capGeo, this.mats.stoneLight, segs.length);
            const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
            segs.forEach((s, i) => {
                const dir = s.p1.clone().sub(s.p0);
                const len = dir.length() * 1.04;
                const n = this.inwardNormal(s.mid);
                const ang = Math.atan2(dir.x, dir.z) - Math.PI / 2;
                q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang);
                const pos = s.mid.clone().addScaledVector(n, -0.7); pos.y = WALL_H / 2;
                sc.set(len, 1, 1);
                m.compose(pos, q, sc); inst.setMatrixAt(i, m);
                const cp = s.mid.clone().addScaledVector(n, -0.6); cp.y = WALL_H + 0.15;
                m.compose(cp, q, sc); cap.setMatrixAt(i, m);
            });
            inst.castShadow = inst.receiveShadow = true;
            cap.castShadow = cap.receiveShadow = true;
            this.root.add(inst); this.root.add(cap);

            // pilastras y estandartes
            const pil = [];
            for (let k = 0; k < 28; k++) {
                const th = k / 28 * Math.PI * 2;
                const p = this.ellipsePoint(th);
                if (this._isTunnelGap(p.x, p.z) || Math.abs(p.z) < 7.5 && Math.abs(p.x) > 25) continue;
                pil.push(p);
            }
            const pgeo = new THREE.BoxGeometry(0.7, WALL_H + 0.4, 0.4);
            const pinst = new THREE.InstancedMesh(pgeo, this.mats.stoneLight, pil.length);
            pil.forEach((p, i) => {
                const n = this.inwardNormal(p);
                const pos = p.clone().addScaledVector(n, 0.12); pos.y = (WALL_H + 0.4) / 2;
                q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(n.x, n.z));
                m.compose(pos, q, new THREE.Vector3(1, 1, 1)); pinst.setMatrixAt(i, m);
                if (i % 2 === 0) {
                    const ban = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 2.6), i % 4 === 0 ? this.mats.redCloth : this.mats.purpleCloth);
                    const bp = p.clone().addScaledVector(n, 0.4); bp.y = 2.6;
                    ban.position.copy(bp); ban.lookAt(bp.clone().add(n));
                    // desplazar a un lado de la pilastra
                    const side = new THREE.Vector3(n.z, 0, -n.x);
                    ban.position.addScaledVector(side, 1.3);
                    ban.castShadow = true;
                    this.root.add(ban);
                }
            });
            pinst.castShadow = pinst.receiveShadow = true;
            this.root.add(pinst);

            // antorchas (pocas luces reales, el resto emisivas)
            const lightAngles = [0.25, 0.75, 1.25, 1.75].map((v) => v * Math.PI);
            const allTorch = [];
            for (let k = 0; k < 16; k++) allTorch.push((k + 0.5) / 16 * Math.PI * 2);
            allTorch.forEach((th) => {
                const p = this.ellipsePoint(th);
                if (this._isTunnelGap(p.x, p.z)) return;
                const n = this.inwardNormal(p);
                const real = lightAngles.some((a) => Math.abs(U.angleDiff(a, th)) < 0.2);
                this._torch(p.clone().addScaledVector(n, 0.35).setY(3.1), real);
            });
        }

        _torch(pos, withLight) {
            const g = new THREE.Group();
            const holder = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.5, 6), this.mats.iron);
            holder.position.y = -0.15;
            g.add(holder);
            const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.08, 0.16, 8), this.mats.iron);
            bowl.position.y = 0.12; g.add(bowl);
            const flame = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.42, 7), this.mats.flame);
            flame.position.y = 0.38; g.add(flame);
            const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GL.Tex.radial(), color: 0xff9a40, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
            glow.scale.set(1.6, 1.6, 1); glow.position.y = 0.4; g.add(glow);
            g.position.copy(pos);
            g.userData.dynamic = true;
            this.root.add(g);
            this.flames.push({ flame, glow, phase: Math.random() * 10 });
            if (withLight && GL.GAME_CONFIG.quality.torchLights) {
                const l = new THREE.PointLight(0xff8a3a, 14, 16, 1.6);
                l.position.copy(pos).y += 0.5;
                this.root.add(l);
                this.torchLights.push({ light: l, base: 14, phase: Math.random() * 10 });
            }
        }

        /* ---------------- Gradas (lathe escalonado escalado a elipse) ---------------- */
        _buildStands() {
            const tiers = 10, step = 1.25, rise = 0.95;
            const r0 = B + 1.4, y0 = WALL_H + 0.3;
            const pts = [new THREE.Vector2(r0, y0 - 0.3)];
            for (let i = 0; i < tiers; i++) {
                const r = r0 + i * step, y = y0 + i * rise;
                pts.push(new THREE.Vector2(r, y), new THREE.Vector2(r + step, y), new THREE.Vector2(r + step, y + rise));
            }
            pts.push(new THREE.Vector2(r0 + tiers * step, 0));
            const geo = new THREE.LatheGeometry(pts, 96);
            const mesh = new THREE.Mesh(geo, this.mats.stone);
            mesh.scale.set(A / B, 1, 1);
            mesh.receiveShadow = true; mesh.castShadow = false;
            this.mats.stone.side = THREE.DoubleSide;
            this.root.add(mesh);
            this.standsInfo = { tiers, step, rise, r0, y0 };
            this._buildCrowd();
        }

        _buildCrowd() {
            const info = this.standsInfo;
            const count = GL.GAME_CONFIG.quality.crowdCount;
            // persona: torso + cabeza en una geometría
            const body = new THREE.BoxGeometry(0.42, 0.6, 0.3); body.translate(0, 0.3, 0);
            const head = new THREE.SphereGeometry(0.14, 6, 5); head.translate(0, 0.76, 0);
            const geo = mergeGeos([body, head]);
            const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
            const uniforms = { uTime: { value: 0 }, uExcite: { value: 0.2 } };
            mat.onBeforeCompile = (sh) => {
                sh.uniforms.uTime = uniforms.uTime; sh.uniforms.uExcite = uniforms.uExcite;
                sh.vertexShader = 'uniform float uTime; uniform float uExcite;\n' + sh.vertexShader.replace('#include <begin_vertex>',
                    '#include <begin_vertex>\n float ph = float(gl_InstanceID) * 1.731; float jump = max(0.0, sin(uTime * (3.0 + mod(ph, 2.0)) + ph)); transformed.y += jump * 0.28 * uExcite + sin(uTime*1.3+ph)*0.02;');
            };
            const inst = new THREE.InstancedMesh(geo, mat, count);
            const m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
            const palette = [0x8a2b20, 0x2b4a7a, 0xd8cdb0, 0x6a4a2a, 0x3d6a3a, 0x7a6a9a, 0xb08030, 0x553322, 0xeee0c0];
            let i = 0, tries = 0;
            while (i < count && tries < count * 4) {
                tries++;
                const tier = Math.floor(Math.random() * info.tiers);
                const th = Math.random() * Math.PI * 2;
                const r = info.r0 + tier * info.step + info.step * 0.5;
                const x = Math.cos(th) * r * (A / B), z = Math.sin(th) * r;
                // dejar huecos sobre los túneles norte/sur centrales (palco)
                if (Math.abs(x) < 3 && tier < 3) continue;
                const y = info.y0 + tier * info.rise;
                q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-x, -z));
                const s = 0.85 + Math.random() * 0.3;
                m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s));
                inst.setMatrixAt(i, m);
                inst.setColorAt(i, col.setHex(U.pick(palette)).offsetHSL(0, 0, (Math.random() - 0.5) * 0.1));
                i++;
            }
            inst.count = i;
            inst.frustumCulled = false;
            this.root.add(inst);
            this.crowdUniforms = uniforms;
        }

        /* ---------------- Fachada exterior con arcos ---------------- */
        _buildOuterFacade() {
            const info = this.standsInfo;
            const R = info.r0 + info.tiers * info.step + 0.4;
            const H = info.y0 + info.tiers * info.rise + 3.5;
            const N = 64;
            const pierGeo = new THREE.BoxGeometry(1.1, H, 1.6);
            const piers = new THREE.InstancedMesh(pierGeo, this.mats.stone, N);
            const archGeo = new THREE.TorusGeometry(1.3, 0.35, 6, 10, Math.PI);
            const arches = new THREE.InstancedMesh(archGeo, this.mats.stoneLight, N * 3);
            const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
            let ai = 0;
            for (let i = 0; i < N; i++) {
                const th = i / N * Math.PI * 2;
                const x = Math.cos(th) * R * (A / B), z = Math.sin(th) * R;
                q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -th + Math.PI / 2);
                m.compose(new THREE.Vector3(x, H / 2, z), q, one); piers.setMatrixAt(i, m);
                const th2 = (i + 0.5) / N * Math.PI * 2;
                const x2 = Math.cos(th2) * R * (A / B), z2 = Math.sin(th2) * R;
                const tq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -th2 + Math.PI / 2);
                for (let lvl = 0; lvl < 3; lvl++) {
                    m.compose(new THREE.Vector3(x2, H * (0.3 + lvl * 0.28), z2), tq, one);
                    arches.setMatrixAt(ai++, m);
                }
            }
            arches.count = ai;
            piers.castShadow = true; arches.castShadow = true;
            this.root.add(piers); this.root.add(arches);
            // cornisas
            for (const f of [0.18, 0.46, 0.74, 1.0]) {
                const ring = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.3, R + 0.3, 0.6, 64, 1, true), this.mats.stoneLight);
                ring.scale.set(A / B, 1, 1); ring.position.y = H * f;
                this.mats.stoneLight.side = THREE.DoubleSide;
                this.root.add(ring);
            }
            // mástiles y toldo (velarium) parcial
            for (let i = 0; i < 24; i++) {
                const th = i / 24 * Math.PI * 2;
                const x = Math.cos(th) * (R + 0.5) * (A / B), z = Math.sin(th) * (R + 0.5);
                const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 5, 6), this.mats.woodDark);
                mast.position.set(x, H + 2.2, z); this.root.add(mast);
                // gallardete
                const pen = new THREE.Mesh(this._pennantGeo || (this._pennantGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -1.1, 0), new THREE.Vector3(2.4, -0.55, 0)])), i % 3 === 0 ? this.mats.pennantGold : i % 3 === 1 ? this.mats.pennantRed : this.mats.pennantPurple);
                if (!this._pennantGeo.attributes.normal) this._pennantGeo.computeVertexNormals();
                pen.position.set(x, H + 4.6, z);
                pen.rotation.y = -th + Math.PI;
                pen.userData.dynamic = true;
                this.root.add(pen);
                (this.pennants = this.pennants || []).push({ mesh: pen, base: pen.rotation.y, ph: i });
            }
            this.facade = { R, H };
        }

        /* ---------------- Túneles de entrada (spawn) ---------------- */
        _buildTunnels() {
            for (const t of this.tunnelDefs) {
                const { cx, side, zE } = t;
                const zIn = zE - side * 0.2, zOut = zE + side * 7.6;
                const zMin = Math.min(zIn, zOut), zMax = Math.max(zIn, zOut);
                // paredes laterales y fondo
                this.boxMesh(cx - 2.2, 0, zMin, cx - 1.45, WALL_H, zMax, this.mats.stoneDark, true);
                this.boxMesh(cx + 1.45, 0, zMin, cx + 2.2, WALL_H, zMax, this.mats.stoneDark, true);
                const endZ0 = side > 0 ? zE + 7 : zE - 7.6, endZ1 = side > 0 ? zE + 7.6 : zE - 7;
                this.boxMesh(cx - 2.2, 0, endZ0, cx + 2.2, WALL_H, endZ1, this.mats.stoneDark, true);
                // techo
                const roof = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.5, zMax - zMin), this.mats.stoneDark);
                roof.position.set(cx, WALL_H + 0.25, (zMin + zMax) / 2); this.add(roof);
                // dintel del arco y rastrillo levantado
                const lint = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.0, 1.6), this.mats.stoneLight);
                lint.position.set(cx, 3.7, zE + side * 0.1); this.add(lint);
                const arch = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.18, 6, 12, Math.PI), this.mats.stoneLight);
                arch.position.set(cx, 3.1, zE - side * 0.68); this.add(arch);
                const grille = this._grille(2.9, 1.2);
                grille.position.set(cx, 3.3, zE - side * 0.35); this.add(grille);
                // suelo oscuro interior
                const floor = new THREE.Mesh(new THREE.PlaneGeometry(2.9, zMax - zMin).rotateX(-Math.PI / 2), this.mats.tunnel);
                floor.position.set(cx, 0.01, (zMin + zMax) / 2); this.add(floor);
                // antorcha interior (sin luz real)
                this._torch(new THREE.Vector3(cx - 1.3, 2.6, zE + side * 4), false);
                t.spawn = new THREE.Vector3(cx, 0, zE + side * 4.5);
            }
        }

        _grille(w, h) {
            const g = new THREE.Group();
            const bars = Math.round(w / 0.28);
            for (let i = 0; i <= bars; i++) {
                const b = new THREE.Mesh(new THREE.BoxGeometry(0.05, h, 0.05), this.mats.iron);
                b.position.x = -w / 2 + i * (w / bars); g.add(b);
            }
            for (let j = 0; j < 3; j++) {
                const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, 0.05), this.mats.iron);
                b.position.y = -h / 2 + (j + 0.5) * (h / 3); g.add(b);
            }
            return g;
        }

        /* ---------------- Galerías laterales con puerta comprable ---------------- */
        _buildGalleries() {
            for (const side of [1, -1]) {
                const id = side > 0 ? 'east' : 'west';
                const xi0 = side * 25.8, xi1 = side * 26.4;           // muro interior
                const xb0 = side * 31.6, xb1 = side * 33.8;           // muro trasero
                const lo = (a, b) => Math.min(a, b), hi = (a, b) => Math.max(a, b);
                // muro interior con hueco central
                this.boxMesh(lo(xi0, xi1), 0, -6.6, hi(xi0, xi1), WALL_H, -1.6, this.mats.stone, true);
                this.boxMesh(lo(xi0, xi1), 0, 1.6, hi(xi0, xi1), WALL_H, 6.6, this.mats.stone, true);
                this.boxMesh(lo(xi0, xi1), 3.2, -1.6, hi(xi0, xi1), WALL_H, 1.6, this.mats.stoneLight, true);
                // trasero y extremos
                this.boxMesh(lo(xb0, xb1), 0, -6.6, hi(xb0, xb1), WALL_H, 6.6, this.mats.stoneDark, true);
                this.boxMesh(lo(xi1, xb0), 0, -6.6, hi(xi1, xb0), WALL_H, -6.0, this.mats.stoneDark, true);
                this.boxMesh(lo(xi1, xb0), 0, 6.0, hi(xi1, xb0), WALL_H, 6.6, this.mats.stoneDark, true);
                // techo
                const roof = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(xb1 - xi0), 0.4, 13.2), this.mats.stoneDark);
                roof.position.set((xi0 + xb1) / 2, WALL_H + 0.2, 0); this.add(roof);
                // suelo de losas
                const fl = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 12).rotateX(-Math.PI / 2), this.mats.stoneLight);
                fl.position.set(side * 29, 0.015, 0); fl.receiveShadow = true; this.root.add(fl);
                // puerta (rastrillo)
                const grille = this._grille(3.2, 3.2);
                grille.rotation.y = Math.PI / 2;
                grille.position.set(side * 26.1, 1.6, 0);
                grille.userData.dynamic = true;
                this.add(grille);
                const coll = this.physics.box(lo(xi0, xi1), 0, -1.6, hi(xi0, xi1), 3.2, 1.6, { walkable: false, blocksLOS: false });
                const cfg = GL.SHOP_CONFIG.gates[id];
                const label = this._label([cfg.name, cfg.price + ' puntos', '[E] ABRIR'], new THREE.Vector3(side * 25.4, 3.9, 0), side > 0 ? -Math.PI / 2 : Math.PI / 2, 2.2);
                this.gates[id] = { id, collider: coll, mesh: grille, open: false, pos: new THREE.Vector3(side * 25.3, 0, 0), label, anim: 0 };
                // luz interior
                if (GL.GAME_CONFIG.quality.torchLights) {
                    const l = new THREE.PointLight(0xff8a3a, 10, 12, 1.6);
                    l.position.set(side * 29, 3, 0); this.root.add(l);
                    this.torchLights.push({ light: l, base: 10, phase: Math.random() * 9 });
                }
                this._torch(new THREE.Vector3(side * 31.3, 2.8, -3), false);
                this._torch(new THREE.Vector3(side * 31.3, 2.8, 3), false);
            }
        }

        /* ---------------- Plataformas de madera N/S con escaleras ---------------- */
        _buildPlatforms() {
            for (const side of [-1, 1]) {
                const zFront = side * 14.5, zBack = side * 18.5;
                const z0 = Math.min(zFront, zBack), z1 = Math.max(zFront, zBack);
                const top = 2.4;
                // cubierta
                this.boxMesh(-8, 2.2, z0, 8, top, z1, this.mats.wood, true);
                // postes
                for (const x of [-7.8, -4, 0, 4, 7.8]) for (const z of [z0 + 0.2, z1 - 0.2]) {
                    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 2.2, 8), this.mats.woodDark);
                    p.position.set(x, 1.1, z); this.add(p);
                    this.physics.cyl(x, z, 0.17, 0, 2.2, { walkable: false });
                }
                // vigas cruzadas decorativas
                for (const x of [-6, -2, 2, 6]) {
                    const beam = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.14, 0.14), this.mats.woodDark);
                    beam.position.set(x, 1.2, z1 - 0.2); beam.rotation.z = (x % 4 === 0 ? 1 : -1) * 0.45; this.add(beam);
                }
                // escaleras en ambos extremos
                for (const dir of [-1, 1]) {
                    for (let i = 0; i < 7; i++) {
                        const xa = dir * (8 + i * 0.5), xb = dir * (8 + (i + 1) * 0.5);
                        const h = top - 0.3 * (i + 1);
                        this.boxMesh(Math.min(xa, xb), 0, side > 0 ? 15.5 : -17.5, Math.max(xa, xb), h, side > 0 ? 17.5 : -15.5, this.mats.wood, true);
                    }
                }
                // baranda trasera y frontal parcial
                const zr = side > 0 ? [18.35, 18.5] : [-18.5, -18.35];
                this.boxMesh(-8, top, zr[0], 8, top + 1.0, zr[1], this.mats.woodDark, true, { walkable: false });
                const zf = side > 0 ? [14.5, 14.65] : [-14.65, -14.5];
                this.boxMesh(-8, top, zf[0], -3, top + 1.0, zf[1], this.mats.woodDark, true, { walkable: false });
                this.boxMesh(3, top, zf[0], 8, top + 1.0, zf[1], this.mats.woodDark, true, { walkable: false });
                // cajas de cobertura arriba
                this.boxMesh(-1.0, top, side * 16.0 - 0.5, 1.0, top + 1.0, side * 16.0 + 0.5, this.mats.woodDark, true);
                // estandarte
                const ban = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3.2), this.mats.redCloth);
                ban.position.set(0, 4.4, zr[side > 0 ? 1 : 0] + side * 0.05);
                ban.rotation.y = side > 0 ? Math.PI : 0;
                this.add(ban);
                const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4, 6), this.mats.woodDark);
                pole.position.set(-1.2, 4.0, zr[0] + 0.07); this.add(pole);
                const pole2 = pole.clone(); pole2.position.x = 1.2; this.add(pole2);
            }
        }

        /* ---------------- Estrado central con estatua ---------------- */
        _buildCenter() {
            const t1 = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.2, 0.3, 40), this.mats.stoneLight);
            t1.position.y = 0.15; this.add(t1);
            this.physics.cyl(0, 0, 5, 0, 0.3);
            const t2 = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.7, 0.6, 40), this.mats.stoneLight);
            t2.position.y = 0.3; this.add(t2);
            this.physics.cyl(0, 0, 3.6, 0, 0.6);
            const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 1.6, 12), this.mats.marble);
            base.position.y = 1.4; this.add(base);
            this.physics.cyl(0, 0, 1.2, 0, 4.8, { walkable: false });
            // estatua estilizada de un gladiador
            const statue = new THREE.Group();
            const marb = this.mats.marble;
            const part = (geo, x, y, z, rx, rz) => { const m = new THREE.Mesh(geo, marb); m.position.set(x, y, z); m.rotation.set(rx || 0, 0, rz || 0); statue.add(m); return m; };
            part(new THREE.CylinderGeometry(0.32, 0.26, 0.85, 10), 0, 1.1, 0);
            part(new THREE.SphereGeometry(0.2, 10, 8), 0, 1.72, 0);
            part(new THREE.SphereGeometry(0.23, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), 0, 1.76, 0);
            part(new THREE.CylinderGeometry(0.11, 0.09, 0.85, 8), -0.16, 0.42, 0, 0, 0.08);
            part(new THREE.CylinderGeometry(0.11, 0.09, 0.85, 8), 0.16, 0.42, 0, 0, -0.08);
            part(new THREE.CylinderGeometry(0.08, 0.07, 0.7, 8), 0.45, 1.55, 0, 0, -2.5);
            part(new THREE.CylinderGeometry(0.08, 0.07, 0.6, 8), -0.42, 1.15, 0.1, 0.3, 0.4);
            const sword = part(new THREE.BoxGeometry(0.08, 1.0, 0.02), 0.72, 2.25, 0, 0, -0.1);
            sword.material = this.mats.bronze;
            const sh = part(new THREE.CylinderGeometry(0.38, 0.38, 0.06, 18), -0.6, 1.15, 0.15, Math.PI / 2, 0.2);
            sh.material = this.mats.bronze;
            statue.position.y = 2.2; statue.rotation.y = Math.PI * 0.15;
            this.add(statue);
        }

        /* ---------------- Columnas rotas ---------------- */
        _buildColumns() {
            const angles = [30, 90, 150, 210, 270, 330];
            angles.forEach((deg, i) => {
                const th = deg * Math.PI / 180;
                const x = Math.cos(th) * 12.5, z = Math.sin(th) * 9.5;
                const h = [4.2, 2.4, 3.6, 4.6, 2.0, 3.2][i];
                const base = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.4, 1.5), this.mats.stoneLight);
                base.position.set(x, 0.2, z); this.add(base);
                const col = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, h, 16), this.mats.marble);
                col.position.set(x, 0.4 + h / 2, z); this.add(col);
                if (h > 3.5) {
                    const capi = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.35, 1.3), this.mats.stoneLight);
                    capi.position.set(x, 0.4 + h + 0.17, z); this.add(capi);
                } else {
                    // fragmento caído
                    const frag = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.6, 14), this.mats.marble);
                    frag.rotation.z = Math.PI / 2; frag.rotation.y = th;
                    frag.position.set(x + Math.cos(th + 1.2) * 1.6, 0.5, z + Math.sin(th + 1.2) * 1.6); this.add(frag);
                    this.physics.cyl(frag.position.x, frag.position.z, 0.75, 0, 1.0, { walkable: true });
                }
                this.physics.box(x - 0.75, 0, z - 0.75, x + 0.75, 0.4, z + 0.75);
                this.physics.cyl(x, z, 0.58, 0, 0.4 + h + 0.4, { walkable: false });
            });
        }

        /* ---------------- Coberturas: barricadas, cajas, carros ---------------- */
        _buildCover() {
            for (const s of [1, -1]) {
                // barricada de estacas
                this._barricade(s * 17.2, 0, true);
                this._barricade(s * 20.5, s * -9.5, false);
                this._barricade(s * 9.5, s * 6.0, false);
                // cajas apiladas
                this._crate(s * 20.6, -6.4, 1.0); this._crate(s * 20.6, -6.4, 1.0, 1.0);
                this._crate(s * 21.9, -6.2, 1.0);
                this._crate(s * 21.5, 5.6, 1.0);
                this._crate(s * 14.0, s * 14.5, 0.9);
                // carro
                this._cart(s * 19.5, 3.0, s);
                // estante de armas (decorativo)
                this._weaponRack(s * 23.3, s * -13.5, s);
            }
        }

        _barricade(x, z, alongZ) {
            const g = new THREE.Group();
            const len = 3.2;
            const bar = new THREE.Mesh(new THREE.BoxGeometry(len, 0.18, 0.18), this.mats.woodDark);
            bar.position.y = 0.6; g.add(bar);
            for (let i = 0; i < 5; i++) {
                const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.09, 1.7, 6), this.mats.wood);
                sp.position.set(-len / 2 + 0.3 + i * (len - 0.6) / 4, 0.6, 0);
                sp.rotation.x = (i % 2 ? 1 : -1) * 0.75;
                g.add(sp);
            }
            const plank = new THREE.Mesh(new THREE.BoxGeometry(len, 1.1, 0.12), this.mats.wood);
            plank.position.y = 0.55; g.add(plank);
            g.position.set(x, 0, z);
            if (alongZ) g.rotation.y = Math.PI / 2;
            this.add(g);
            const hx = alongZ ? 0.35 : len / 2, hz = alongZ ? len / 2 : 0.35;
            this.physics.box(x - hx, 0, z - hz, x + hx, 1.15, z + hz, { walkable: false });
        }

        _crate(x, z, size, y0) {
            const b = y0 || 0;
            const m = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), this.mats.woodDark);
            m.position.set(x, b + size / 2, z); m.rotation.y = (Math.random() - 0.5) * 0.15; this.add(m);
            const band = new THREE.Mesh(new THREE.BoxGeometry(size * 1.02, 0.08, size * 1.02), this.mats.iron);
            band.position.copy(m.position); this.add(band);
            this.physics.box(x - size / 2, b, z - size / 2, x + size / 2, b + size, z + size / 2);
        }

        _cart(x, z, s) {
            const g = new THREE.Group();
            const bed = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.6, 1.4), this.mats.wood); bed.position.y = 0.9; g.add(bed);
            for (const wx of [-0.8, 0.8]) for (const wz of [-0.75, 0.75]) {
                const w = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.12, 12), this.mats.woodDark);
                w.rotation.x = Math.PI / 2; w.position.set(wx, 0.45, wz); g.add(w);
            }
            const shaft = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 0.1), this.mats.woodDark); shaft.position.set(-s * 2.0, 0.6, 0); shaft.rotation.z = s * 0.25; g.add(shaft);
            g.position.set(x, 0, z); this.add(g);
            this.physics.box(x - 1.2, 0, z - 0.75, x + 1.2, 1.2, z + 0.75);
        }

        _weaponRack(x, z, s) {
            const g = new THREE.Group();
            const frame = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.1, 0.1), this.mats.woodDark); frame.position.y = 1.4; g.add(frame);
            const frame2 = frame.clone(); frame2.position.y = 0.3; g.add(frame2);
            for (const px of [-0.95, 0.95]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.6, 0.1), this.mats.woodDark); p.position.set(px, 0.8, 0); g.add(p); }
            ['spear', 'javelin', 'spear', 'javelin'].forEach((w, i) => {
                const wm = GL.WeaponModels.build(w); wm.position.set(-0.6 + i * 0.4, 0.2, 0.05); wm.rotation.z = 0.08; g.add(wm);
            });
            g.position.set(x, 0, z); g.rotation.y = s > 0 ? -0.6 : 0.6 + Math.PI; this.add(g);
            this.physics.box(x - 1.0, 0, z - 0.4, x + 1.0, 1.6, z + 0.4, { walkable: false });
        }

        /* ---------------- Trampas de fuego ---------------- */
        _buildFireTraps() {
            const pos = [[-7, -12], [7, 12], [-7, 12], [7, -12]];
            pos.forEach(([x, z], i) => {
                const grate = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.06, 20), this.mats.iron.clone());
                grate.position.set(x, 0.03, z); grate.receiveShadow = true; this.root.add(grate);
                for (let k = -3; k <= 3; k++) {
                    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.05, 0.06), new THREE.MeshStandardMaterial({ color: 0x1a1a1a }));
                    bar.position.set(x, 0.07, z + k * 0.25); this.root.add(bar);
                }
                const fire = new THREE.Group();
                const fmat = new THREE.MeshBasicMaterial({ color: 0xff6a1a, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
                for (let k = 0; k < 6; k++) {
                    const c = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.6 + Math.random(), 6), fmat);
                    c.position.set((Math.random() - 0.5) * 1.1, 0.8, (Math.random() - 0.5) * 1.1); fire.add(c);
                }
                fire.position.set(x, 0, z); fire.visible = false; fire.userData.dynamic = true; this.root.add(fire);
                this.fireTraps.push({ x, z, radius: 1.05, fire, active: false, warn: false, offset: i * 2.2, grate });
            });
        }

        /** Estado de las trampas determinista a partir del tiempo de partida (sincronizado). */
        updateFire(matchTime) {
            for (const t of this.fireTraps) {
                const ph = (matchTime + t.offset) % 11;
                t.warn = ph > 7.5 && ph < 8.5;
                t.active = ph >= 8.5 && ph < 10.5;
                t.fire.visible = t.active;
                t.grate.material.emissive.setHex(t.active ? 0xff4400 : t.warn ? 0x882200 : 0x000000);
                if (t.active) t.fire.children.forEach((c, k) => { c.scale.y = 0.8 + Math.sin(this.time * 18 + k) * 0.25; });
            }
        }

        /* ---------------- Estaciones de compra ---------------- */
        _label(lines, pos, rotY, width) {
            const lab = GL.Tex.label(512, 256);
            lab.draw(lines);
            const w = width || 1.8;
            const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 2), new THREE.MeshBasicMaterial({ map: lab.texture, transparent: true, depthWrite: false, fog: false }));
            mesh.position.copy(pos); mesh.rotation.y = rotY;
            this.root.add(mesh);
            return { lab, mesh };
        }

        _buildStations() {
            const wallBuyAngles = { dagger: 20, gladius: 45, axe: 135, mace: 160, longsword: 200, spear: 225, bow: 315, javelin: 340 };
            for (const w in wallBuyAngles) {
                const th = wallBuyAngles[w] * Math.PI / 180;
                const p = this.ellipsePoint(th);
                const n = this.inwardNormal(p);
                this._wallBuy(w, p.clone().addScaledVector(n, 0.02), n);
            }
            // galerías: armas pesadas
            this._wallBuy('greatsword', new THREE.Vector3(31.55, 0, -2.8), new THREE.Vector3(-1, 0, 0));
            this._wallBuy('crossbow', new THREE.Vector3(31.55, 0, 2.8), new THREE.Vector3(-1, 0, 0));
            this._wallBuy('heavyaxe', new THREE.Vector3(-31.55, 0, -2.8), new THREE.Vector3(1, 0, 0));
            this._wallBuy('hammer', new THREE.Vector3(-31.55, 0, 2.8), new THREE.Vector3(1, 0, 0));
            // altares
            this._altar('iron', new THREE.Vector3(28.8, 0, 4.6), 0x8fa3b8);
            this._altar('vitality', new THREE.Vector3(-28.8, 0, 4.6), 0xc0392b);
            this._altar('fury', new THREE.Vector3(-5.5, 2.4, -16.6), 0xe67e22);
            this._altar('wind', new THREE.Vector3(5.5, 2.4, 16.6), 0x7fd1c0);
            this._fountain(new THREE.Vector3(-4.5, 0, 7.5));
        }

        _wallBuy(weapon, pos, normal) {
            const cfg = GL.WEAPON_CONFIG[weapon];
            const g = new THREE.Group();
            const board = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.0, 0.1), this.mats.woodDark);
            g.add(board);
            const frame = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.1, 0.06), this.mats.bronze); frame.position.z = -0.03; g.add(frame);
            const wm = GL.WeaponModels.build(weapon);
            // tumbar el arma sobre el tablero
            if (weapon === 'crossbow') { wm.rotation.set(0, Math.PI / 2, 0); wm.position.set(0.3, 0, 0.12); }
            else {
                wm.rotation.z = -Math.PI / 2;
                const blade = wm.userData.blade;
                const len = blade ? blade.tip : 0.7;
                const s = Math.min(1, 1.6 / Math.max(0.6, len + 0.4));
                wm.scale.setScalar(s);
                wm.position.set(-len * s / 2, 0, 0.1);
                if (weapon === 'bow') { wm.rotation.set(0, 0, -Math.PI / 2); wm.position.set(0, 0, 0.18); wm.scale.setScalar(1.1); }
            }
            g.add(wm);
            g.position.copy(pos).setY(1.5);
            g.lookAt(pos.clone().add(normal).setY(1.5));
            this.add(g);
            const lp = pos.clone().addScaledVector(normal, 0.08); lp.y = 2.45;
            const rotY = Math.atan2(normal.x, normal.z);
            const label = this._label([cfg.name.toUpperCase(), cfg.price + ' pts'], lp, rotY, 1.7);
            this.wallBuys.push({ id: 'wb_' + weapon, weapon, pos: pos.clone().addScaledVector(normal, 1.0).setY(0), normal: normal.clone(), label });
        }

        _altar(id, pos, color) {
            const cfg = GL.SHOP_CONFIG.upgrades[id];
            const g = new THREE.Group();
            const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.65, 1.0, 10), this.mats.stoneLight); ped.position.y = 0.5; g.add(ped);
            const top = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.12, 10), this.mats.bronze); top.position.y = 1.06; g.add(top);
            const orbMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4, roughness: 0.2 });
            const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 1), orbMat); orb.position.y = 1.5; orb.userData.dynamic = true; g.add(orb);
            const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GL.Tex.radial(), color, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
            glow.scale.set(1.6, 1.6, 1); glow.position.y = 1.5; g.add(glow);
            g.position.copy(pos); this.add(g);
            this.physics.cyl(pos.x, pos.z, 0.6, pos.y, pos.y + 1.1, { walkable: false });
            const label = this._labelSprite([cfg.name.toUpperCase(), cfg.desc, cfg.price + ' pts'], pos.clone().setY(pos.y + 2.4));
            this.altars.push({ id: 'alt_' + id, upgrade: id, pos: pos.clone(), orb, label });
        }

        _fountain(pos) {
            const g = new THREE.Group();
            const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.15, 0.7, 20), this.mats.marble); basin.position.y = 0.35; g.add(basin);
            const water = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 0.88, 0.05, 20), this.mats.water); water.position.y = 0.68; g.add(water);
            const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 1.2, 10), this.mats.marble); spout.position.y = 1.1; g.add(spout);
            g.position.copy(pos); this.add(g);
            this.physics.cyl(pos.x, pos.z, 1.1, 0, 0.75, { walkable: false });
            const cfg = GL.SHOP_CONFIG.upgrades.heal;
            const label = this._labelSprite([cfg.name.toUpperCase(), cfg.desc, cfg.price + ' pts'], pos.clone().setY(2.3));
            this.altars.push({ id: 'alt_heal', upgrade: 'heal', pos: pos.clone(), label });
        }

        _labelSprite(lines, pos) {
            const lab = GL.Tex.label(512, 256);
            lab.draw(lines);
            const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: lab.texture, transparent: true, depthWrite: false, fog: false }));
            sp.scale.set(1.9, 0.95, 1); sp.position.copy(pos);
            this.root.add(sp);
            return { lab, mesh: sp };
        }

        /* ---------------- Spawns ---------------- */
        _buildSpawns() {
            for (const t of this.tunnelDefs) this.spawnPoints.push({ pos: t.spawn.clone(), zone: 'main', exit: new THREE.Vector3(t.cx, 0, t.zE - t.side * 2) });
            for (const side of [1, -1]) {
                const id = side > 0 ? 'east' : 'west';
                this.spawnPoints.push({ pos: new THREE.Vector3(side * 30.3, 0, -4.8), zone: id });
                this.spawnPoints.push({ pos: new THREE.Vector3(side * 30.3, 0, 4.8), zone: id });
            }
            for (let i = 0; i < 4; i++) {
                const th = i / 4 * Math.PI * 2 + Math.PI / 4;
                this.playerSpawns.push(new THREE.Vector3(Math.cos(th) * 7.5, 0, Math.sin(th) * 6));
            }
            this.duelSpawns = [new THREE.Vector3(-13.5, 0, 0), new THREE.Vector3(13.5, 0, 0)];
        }

        setGateOpen(id, open) {
            const g = this.gates[id];
            if (!g || g.open === open) return;
            g.open = open;
            g.collider.enabled = !open;
            if (open) g.label.mesh.visible = false;
            else { g.label.mesh.visible = true; g.mesh.position.y = 1.6; }
        }

        isZoneOpen(zone) { return zone === 'main' || (this.gates[zone] && this.gates[zone].open); }

        update(dt, matchTime) {
            this.time += dt;
            for (const f of this.flames) {
                const k = 0.85 + Math.sin(this.time * 13 + f.phase) * 0.1 + Math.sin(this.time * 31 + f.phase * 2) * 0.05;
                const b = f.big ? 2.6 : 1;
                f.flame.scale.set(b, k * 1.1 * b, b); f.glow.material.opacity = 0.5 + k * 0.25;
            }
            for (const t of this.torchLights) t.light.intensity = t.base * (0.85 + Math.sin(this.time * 9 + t.phase) * 0.08 + Math.sin(this.time * 23 + t.phase) * 0.05);
            if (this.pennants) for (const p of this.pennants) p.mesh.rotation.y = p.base + Math.sin(this.time * 1.7 + p.ph) * 0.18;
            for (const a of this.altars) if (a.orb) { a.orb.rotation.y += dt; a.orb.position.y = 1.5 + Math.sin(this.time * 2 + a.pos.x) * 0.06; }
            for (const id in this.gates) {
                const g = this.gates[id];
                const target = g.open ? 4.6 : 1.6;
                g.mesh.position.y += (target - g.mesh.position.y) * Math.min(1, dt * 2.5);
            }
            if (this.crowdUniforms) {
                this.excite += (0.2 - this.excite) * Math.min(1, dt * 0.4);
                this.crowdUniforms.uTime.value = this.time;
                this.crowdUniforms.uExcite.value = this.excite;
            }
            this.updateFire(matchTime || 0);
            this._updateDecor(dt);
        }

        cheer(amount) { this.excite = Math.min(1.5, this.excite + amount); }

        /** Mapa de entorno (reflejos en metales) generado a partir del cielo procedural */
        buildEnvironment(renderer) {
            const pm = new THREE.PMREMGenerator(renderer);
            const envScene = new THREE.Scene();
            const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 24, 12), this.skyMesh.material);
            envScene.add(sky);
            const ground = new THREE.Mesh(new THREE.CircleGeometry(45, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x8a6a46 }));
            ground.position.y = -6; envScene.add(ground);
            const ring = new THREE.Mesh(new THREE.CylinderGeometry(40, 40, 18, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x6e5a44, side: THREE.BackSide }));
            ring.position.y = 3; envScene.add(ring);
            const env = pm.fromScene(envScene, 0.035, 0.1, 200).texture;
            pm.dispose();
            this.scene.environment = env;
            return env;
        }
    }

    function mergeGeos(geos) {
        // fusión simple de geometrías no indexadas (posición/normal)
        const parts = geos.map((g) => g.index ? g.toNonIndexed() : g);
        let n = 0; parts.forEach((g) => { n += g.attributes.position.count; });
        const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
        let o = 0;
        parts.forEach((g) => { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; });
        const out = new THREE.BufferGeometry();
        out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        return out;
    }
    GL.mergeGeos = mergeGeos;

    GL.Arena = Arena;
})();
