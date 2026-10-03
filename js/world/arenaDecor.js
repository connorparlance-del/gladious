/* Contenido adicional del coliseo: estructuras jugables (ruinas, torre de asedio),
 * ambientación (palco imperial, braseros, jaulas, estatuas, escombros, horizonte, polvo). */
(function () {
    const U = GL.U;
    const P = GL.Arena.prototype;

    P._buildDecor = function () {
        this._buildPulvinar();
        this._buildRuins(1);
        this._buildRuins(-1);
        this._buildSiegeTower(1);
        this._buildSiegeTower(-1);
        this._buildBraziers();
        this._buildCages();
        this._buildWallStatues();
        this._buildDebris();
        this._buildHorizon();
        this._buildDust();
    };

    /* ---------- palco imperial (norte, sobre las gradas) ---------- */
    P._buildPulvinar = function () {
        const m = this.mats;
        const g = new THREE.Group();
        const z = -(this.B + 3.2), y0 = 4.6;
        const base = new THREE.Mesh(new THREE.BoxGeometry(9, 1.2, 4.5), m.stoneLight); base.position.set(0, y0 + 0.6, z); g.add(base);
        const front = new THREE.Mesh(new THREE.BoxGeometry(9.2, 1.0, 0.3), m.marble); front.position.set(0, y0 + 1.6, z + 2.2); g.add(front);
        for (const x of [-4.2, -1.4, 1.4, 4.2]) {
            const c = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 3.6, 12), m.marble); c.position.set(x, y0 + 3.0, z + 1.9); g.add(c);
        }
        const roof = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.35, 4.8), m.stoneLight); roof.position.set(0, y0 + 4.9, z); g.add(roof);
        const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 5.2, 1.4, 3, 1), m.stoneLight);
        ped.rotation.set(Math.PI / 2, 0, Math.PI / 2); ped.scale.set(1, 1, 0.35); ped.position.set(0, y0 + 5.6, z + 2.2); g.add(ped);
        const canopy = new THREE.Mesh(new THREE.PlaneGeometry(8.6, 3.6, 8, 1), m.purpleCloth);
        canopy.rotation.x = -Math.PI / 2 + 0.25; canopy.position.set(0, y0 + 4.5, z + 2.4); g.add(canopy);
        const throne = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.9), m.bronze); throne.position.set(0, y0 + 2.3, z - 0.6); g.add(throne);
        for (const x of [-3, 3]) {
            const b = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 3.4), m.redCloth); b.position.set(x, y0 + 0.4, z + 2.4); g.add(b);
        }
        this.add(g);
    };

    /* ---------- ruinas: muros rotos de distintas alturas (cobertura y saltos) ---------- */
    P._buildRuins = function (s) {
        const m = this.mats;
        const cx = s * 18.6, cz = -s * 16.2;
        // muro largo con remate irregular (bloques de alturas distintas)
        const heights = [2.8, 2.4, 1.9, 1.0, 0.0, 1.1, 2.2, 2.9];
        for (let i = 0; i < heights.length; i++) {
            const h = heights[i];
            if (!h) continue;
            const x0 = cx - 2.4 + i * 0.6;
            this.boxMesh(Math.min(x0, x0 + 0.6), 0, cz - s * 0.35 - 0.0001, Math.max(x0, x0 + 0.6), h, cz + s * 0.35, m.stone, true, h > 1.15 ? { walkable: true } : {});
        }
        // muro bajo perpendicular (salto + cobertura a media altura)
        this.boxMesh(cx - 2.6 - 0.35, 0, Math.min(cz, cz + s * 3.2), cx - 2.6 + 0.35, 1.05, Math.max(cz, cz + s * 3.2), m.stoneDark, true);
        // arco en pie
        const ax = cx + 2.2, az = cz + s * 2.8;
        this.boxMesh(ax - 0.4, 0, az - 1.6, ax + 0.4, 3.4, az - 0.9, m.stoneLight, true);
        this.boxMesh(ax - 0.4, 0, az + 0.9, ax + 0.4, 3.4, az + 1.6, m.stoneLight, true);
        const arch = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.32, 6, 12, Math.PI), m.stoneLight);
        arch.rotation.y = Math.PI / 2; arch.position.set(ax, 3.3, az); this.add(arch);
        this.physics.box(ax - 0.4, 3.4, az - 1.6, ax + 0.4, 4.2, az + 1.6, { walkable: true });
        // escombros grandes (bloques caídos sobre los que se puede subir)
        const rocks = [[cx - 1.0, cz + s * 1.4, 0.7], [cx + 0.5, cz + s * 2.1, 0.5], [cx + 1.4, cz - s * 1.2, 0.6]];
        for (const [x, z, r] of rocks) {
            const rk = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), m.stoneDark);
            rk.position.set(x, r * 0.55, z); rk.rotation.set(Math.random(), Math.random(), Math.random()); this.add(rk);
            this.physics.cyl(x, z, r * 0.85, 0, r * 1.05, { walkable: true });
        }
    };

    /* ---------- torre de asedio de madera con rampa (zona elevada) ---------- */
    P._buildSiegeTower = function (s) {
        const m = this.mats;
        const cx = s * 21.5, cz = s * 10.5;   // SE y NO
        const top = 3.0, half = 1.6;
        // plataforma superior
        this.boxMesh(cx - half, top - 0.2, cz - half, cx + half, top, cz + half, m.wood, true);
        // postes
        for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
            const px = cx + dx * (half - 0.15), pz = cz + dz * (half - 0.15);
            const p = new THREE.Mesh(new THREE.BoxGeometry(0.28, top + 1.3, 0.28), m.woodDark); p.position.set(px, (top + 1.3) / 2, pz); this.add(p);
            this.physics.box(px - 0.14, 0, pz - 0.14, px + 0.14, top + 1.3, pz + 0.14, { walkable: false });
        }
        // parapeto con almenas
        for (const side of [-1, 1]) {
            this.boxMesh(cx - half, top, cz + side * half - 0.1, cx + half, top + 0.9, cz + side * half + 0.1, m.woodDark, true, { walkable: false });
        }
        this.boxMesh(cx + s * half - 0.1, top, cz - half, cx + s * half + 0.1, top + 0.9, cz + half, m.woodDark, true, { walkable: false });
        // tirantes en X decorativos
        for (const side of [-1, 1]) {
            const br = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.6, 0.12), m.woodDark);
            br.position.set(cx, top / 2, cz + side * (half - 0.05)); br.rotation.x = 0; br.rotation.z = 0.75; this.add(br);
            const br2 = br.clone(); br2.rotation.z = -0.75; this.add(br2);
        }
        // rampa escalonada hacia el centro (cada escalón 0,3 m)
        const steps = 10;
        for (let i = 0; i < steps; i++) {
            const h = top - (top / steps) * (i + 1) + 0.0;
            if (h <= 0.02) continue;
            const x0 = cx - s * (half + i * 0.45), x1 = cx - s * (half + (i + 1) * 0.45);
            this.boxMesh(Math.min(x0, x1), 0, cz - 0.8, Math.max(x0, x1), h, cz + 0.8, m.wood, true);
        }
        // estandarte
        const ban = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.0), m.redCloth);
        ban.position.set(cx, top + 2.2, cz); ban.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2; this.add(ban);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 6), m.woodDark); pole.position.set(cx, top + 1.6, cz); this.add(pole);
    };

    /* ---------- braseros encendidos ---------- */
    P._buildBraziers = function () {
        const m = this.mats;
        const pts = [[-16, -4], [16, 4], [-11.8, 12.6], [11.8, -12.6], [-23, -3.5], [23, 3.5]];
        for (const [x, z] of pts) {
            const g = new THREE.Group();
            for (let i = 0; i < 3; i++) {
                const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.3, 5), m.iron);
                const a = i / 3 * Math.PI * 2;
                leg.position.set(Math.cos(a) * 0.3, 0.6, Math.sin(a) * 0.3); leg.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25); g.add(leg);
            }
            const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.3, 0.35, 12, 1, true), m.bronze); bowl.material.side = THREE.DoubleSide; bowl.position.y = 1.3; g.add(bowl);
            const coals = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 12), new THREE.MeshBasicMaterial({ color: 0xff5a10 })); coals.position.y = 1.4; g.add(coals);
            g.position.set(x, 0, z); this.add(g);
            this.physics.cyl(x, z, 0.5, 0, 1.5, { walkable: false });
            this._torch(new THREE.Vector3(x, 1.2, z), false);
            const fl = this.flames[this.flames.length - 1];
            fl.flame.scale.set(2.6, 2.6, 2.6); fl.glow.scale.set(3.2, 3.2, 1);
            this.flames[this.flames.length - 1].big = true;
        }
    };

    /* ---------- jaulas de fieras junto a los túneles centrales ---------- */
    P._buildCages = function () {
        const m = this.mats;
        for (const side of [-1, 1]) for (const sx of [-1, 1]) {
            const x = sx * 4.6, z = side * (this.B - 1.4);
            const g = new THREE.Group();
            const floor = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.2, 1.6), m.woodDark); floor.position.y = 0.1; g.add(floor);
            const roof = floor.clone(); roof.position.y = 1.9; g.add(roof);
            for (let i = 0; i <= 8; i++) {
                const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.7, 5), m.iron);
                bar.position.set(-1.05 + i * 0.2625, 1.0, 0.75); g.add(bar);
                const bar2 = bar.clone(); bar2.position.z = -0.75; g.add(bar2);
            }
            const shadow = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.6, 1.4), new THREE.MeshStandardMaterial({ color: 0x140c08, roughness: 1 }));
            shadow.position.y = 1.0; g.add(shadow);
            // ojos en la oscuridad
            const eyes = new THREE.MeshBasicMaterial({ color: 0xffb020 });
            for (const ex of [-0.12, 0.12]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), eyes); e.position.set(ex + sx * 0.3, 0.75, -0.71); g.add(e); }
            g.position.set(x, 0, z); g.rotation.y = side > 0 ? 0 : Math.PI;
            this.add(g);
            this.physics.box(x - 1.15, 0, z - 0.85, x + 1.15, 2.0, z + 0.85, { walkable: true });
        }
    };

    /* ---------- estatuas sobre el muro del podio ---------- */
    P._buildWallStatues = function () {
        const m = this.mats;
        const geoBody = new THREE.CylinderGeometry(0.28, 0.22, 1.4, 8);
        const geoHead = new THREE.SphereGeometry(0.2, 8, 6);
        const geoBase = new THREE.BoxGeometry(1.0, 0.5, 1.0);
        for (let k = 0; k < 12; k++) {
            const th = (k + 0.25) / 12 * Math.PI * 2;
            const p = this.ellipsePoint(th, 1.03);
            if (this._isTunnelGap(p.x, p.z) || (Math.abs(p.z) < 8 && Math.abs(p.x) > 24) || (p.z < -20 && Math.abs(p.x) < 6)) continue;
            const g = new THREE.Group();
            const base = new THREE.Mesh(geoBase, m.stoneLight); base.position.y = 0.25; g.add(base);
            const body = new THREE.Mesh(geoBody, m.marble); body.position.y = 1.2; g.add(body);
            const head = new THREE.Mesh(geoHead, m.marble); head.position.y = 2.1; g.add(head);
            const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.9, 6), m.marble); arm.position.set(0.35, 1.9, 0); arm.rotation.z = -2.6 + (k % 3) * 0.4; g.add(arm);
            const spear = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.8, 5), m.bronze); spear.position.set(-0.4, 1.6, 0); g.add(spear);
            g.position.set(p.x, 4.35, p.z);
            g.lookAt(0, 4.35, 0);
            this.add(g);
        }
    };

    /* ---------- escombros de combate esparcidos por la arena ---------- */
    P._buildDebris = function () {
        const m = this.mats;
        const rng = mulberry(7);
        const avoid = (x, z) => {
            if (Math.hypot(x, z) < 6) return true;
            if (!this.physics.insideBounds(x, z, 2)) return true;
            return this.physics.near(x - 0.6, z - 0.6, x + 0.6, z + 0.6).length > 0;
        };
        const place = (fn, n) => {
            let placed = 0, tries = 0;
            while (placed < n && tries < n * 20) {
                tries++;
                const a = rng() * Math.PI * 2, r = 0.25 + rng() * 0.7;
                const x = Math.cos(a) * this.A * r, z = Math.sin(a) * this.B * r;
                if (avoid(x, z)) continue;
                fn(x, z, rng); placed++;
            }
        };
        // escudos caídos
        const shieldGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.05, 14);
        place((x, z, r) => { const s = new THREE.Mesh(shieldGeo, r() < 0.5 ? m.bronze : m.woodDark); s.position.set(x, 0.04, z); s.rotation.set(r() * 0.2, r() * 6, r() * 0.25); this.add(s); }, 8);
        // cascos
        const helmGeo = new THREE.SphereGeometry(0.16, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
        place((x, z, r) => { const h = new THREE.Mesh(helmGeo, m.bronze); h.position.set(x, 0.05, z); h.rotation.set(Math.PI * (0.4 + r() * 0.3), r() * 6, 0); this.add(h); }, 6);
        // espadas clavadas en la arena
        place((x, z, r) => { const w = GL.WeaponModels.build(r() < 0.5 ? 'gladius' : 'longsword'); w.rotation.set(Math.PI + (r() - 0.5) * 0.5, r() * 6, (r() - 0.5) * 0.5); w.position.set(x, 0.65, z); w.traverse((o) => { o.castShadow = true; }); this.add(w); }, 7);
        // lanzas tiradas
        place((x, z, r) => { const w = GL.WeaponModels.build('spear'); w.rotation.set(Math.PI / 2, 0, r() * 6); w.position.set(x, 0.05, z); this.add(w); }, 4);
        // huesos y calaveras
        const boneMat = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.8 });
        const boneGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.45, 5);
        const skullGeo = new THREE.SphereGeometry(0.11, 8, 6);
        place((x, z, r) => { for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(boneGeo, boneMat); b.position.set(x + (r() - 0.5) * 0.5, 0.03, z + (r() - 0.5) * 0.5); b.rotation.set(Math.PI / 2, 0, r() * 6); this.add(b); } const s = new THREE.Mesh(skullGeo, boneMat); s.position.set(x, 0.09, z); s.scale.set(1, 0.85, 1.15); this.add(s); }, 5);
        // piedras sueltas
        place((x, z, r) => { const s = 0.12 + r() * 0.25; const rk = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), m.stoneDark); rk.position.set(x, s * 0.4, z); rk.rotation.set(r() * 3, r() * 3, r() * 3); this.add(rk); }, 22);
    };

    /* ---------- horizonte: montañas, colinas y cipreses tras el coliseo ---------- */
    P._buildHorizon = function () {
        const rng = mulberry(11);
        const hillMat = new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 1, flatShading: true, fog: true });
        const mountMat = new THREE.MeshStandardMaterial({ color: 0x6f7a62, roughness: 1, flatShading: true, fog: true });
        const treeMat = new THREE.MeshStandardMaterial({ color: 0x2f4a26, roughness: 1, flatShading: true });
        for (let i = 0; i < 26; i++) {
            const a = i / 26 * Math.PI * 2 + rng() * 0.2, r = 230 + rng() * 120;
            const h = 40 + rng() * 85, w = 60 + rng() * 80;
            const m = new THREE.Mesh(new THREE.SphereGeometry(w, 9, 6, 0, Math.PI * 2, 0, Math.PI / 2), mountMat);
            m.scale.set(1.4, h / w, 1); m.position.set(Math.cos(a) * r, -4, Math.sin(a) * r); m.rotation.y = rng() * 6;
            this.root.add(m);
        }
        for (let i = 0; i < 30; i++) {
            const a = rng() * Math.PI * 2, r = 85 + rng() * 60;
            const m = new THREE.Mesh(new THREE.SphereGeometry(12 + rng() * 18, 7, 5), hillMat);
            m.scale.y = 0.35; m.position.set(Math.cos(a) * r, -2, Math.sin(a) * r);
            this.root.add(m);
        }
        const coneGeo = new THREE.ConeGeometry(1.0, 7, 6);
        const trees = new THREE.InstancedMesh(coneGeo, treeMat, 90);
        const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
        for (let i = 0; i < 90; i++) {
            const a = rng() * Math.PI * 2, r = 62 + rng() * 50;
            const s = 0.7 + rng() * 0.9;
            sc.set(s, s * (0.9 + rng() * 0.5), s);
            mm.compose(new THREE.Vector3(Math.cos(a) * r, 3.2 * sc.y, Math.sin(a) * r), q, sc);
            trees.setMatrixAt(i, mm);
        }
        this.root.add(trees);
    };

    /* ---------- polvo flotando en la luz ---------- */
    P._buildDust = function () {
        const n = 260;
        const pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 60; pos[i * 3 + 1] = Math.random() * 7; pos[i * 3 + 2] = (Math.random() - 0.5) * 46; }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const mat = new THREE.PointsMaterial({ color: 0xffe2b0, size: 0.06, transparent: true, opacity: 0.5, depthWrite: false, map: GL.Tex.radial(), blending: THREE.AdditiveBlending });
        const pts = new THREE.Points(g, mat);
        pts.userData.dynamic = true; pts.frustumCulled = false;
        this.root.add(pts);
        this.dust = pts;
    };

    P._updateDecor = function (dt) {
        if (this.dust) {
            const a = this.dust.geometry.attributes.position, t = this.time;
            for (let i = 0; i < a.count; i++) {
                let y = a.getY(i) + dt * 0.12;
                if (y > 7) y = 0;
                a.setY(i, y);
                a.setX(i, a.getX(i) + Math.sin(t * 0.3 + i) * dt * 0.08);
            }
            a.needsUpdate = true;
        }
    };

    function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
})();
