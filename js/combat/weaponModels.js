/* Modelos procedurales de armas. Convención: origen = empuñadura, hoja hacia +Y.
 * userData.blade = { base, tip, radius } (en Y local) se usa para las hitboxes. */
(function () {
    const M = {};
    let mats = null;
    const geoCache = {};

    function materials() {
        if (mats) return mats;
        mats = {
            steel: new THREE.MeshStandardMaterial({ color: 0xd9dde2, metalness: 0.9, roughness: 0.28, map: GL.Tex.metal() }),
            darkSteel: new THREE.MeshStandardMaterial({ color: 0x6d7177, metalness: 0.85, roughness: 0.4, map: GL.Tex.metal() }),
            bronze: new THREE.MeshStandardMaterial({ color: 0xc08a3e, metalness: 0.85, roughness: 0.35 }),
            gold: new THREE.MeshStandardMaterial({ color: 0xe0b44a, metalness: 0.95, roughness: 0.25 }),
            wood: new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.85, map: GL.Tex.wood() }),
            darkWood: new THREE.MeshStandardMaterial({ color: 0x4e311b, roughness: 0.85, map: GL.Tex.wood() }),
            leather: new THREE.MeshStandardMaterial({ color: 0x4a2e1a, roughness: 0.9 }),
            string: new THREE.LineBasicMaterial({ color: 0xe8dcc0 }),
            feather: new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 1, side: THREE.DoubleSide })
        };
        return mats;
    }
    M.materials = materials;

    function mesh(geo, mat, x, y, z, rx, ry, rz) {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x || 0, y || 0, z || 0);
        if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
        m.castShadow = true;
        return m;
    }
    function cyl(r0, r1, h, seg) { const k = 'c' + r0 + r1 + h + seg; return geoCache[k] || (geoCache[k] = new THREE.CylinderGeometry(r0, r1, h, seg || 8)); }
    function box(w, h, d) { const k = 'b' + w + h + d; return geoCache[k] || (geoCache[k] = new THREE.BoxGeometry(w, h, d)); }
    function sph(r, s) { const k = 's' + r + s; return geoCache[k] || (geoCache[k] = new THREE.SphereGeometry(r, s || 8, s || 6)); }
    function cone(r, h, s) { const k = 'k' + r + h + s; return geoCache[k] || (geoCache[k] = new THREE.ConeGeometry(r, h, s || 4)); }

    /** Hoja de espada: prisma afilado (sección rómbica) con punta */
    function bladeGeo(len, width, thick, tipLen) {
        const k = 'blade' + len + width + thick + tipLen;
        if (geoCache[k]) return geoCache[k];
        const hw = width / 2, ht = thick / 2, body = len - tipLen;
        const v = [];
        const ring = (y, w) => [[0, y, ht], [w, y, 0], [0, y, -ht], [-w, y, 0]];
        const r0 = ring(0, hw), r1 = ring(body, hw * 0.92);
        const tip = [0, len, 0];
        for (let i = 0; i < 4; i++) {
            const a = r0[i], b = r0[(i + 1) % 4], c = r1[(i + 1) % 4], d = r1[i];
            v.push(...a, ...b, ...c, ...a, ...c, ...d);
            v.push(...d, ...c, ...tip);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
        g.computeVertexNormals();
        return (geoCache[k] = g);
    }

    function axeHeadGeo(w, h, thick, double) {
        const k = 'axe' + w + h + thick + double;
        if (geoCache[k]) return geoCache[k];
        const s = new THREE.Shape();
        s.moveTo(0, -h * 0.25); s.lineTo(w * 0.35, -h * 0.2);
        s.quadraticCurveTo(w, -h * 0.75, w * 1.02, -h * 0.5);
        s.quadraticCurveTo(w * 1.12, 0, w * 1.02, h * 0.5);
        s.quadraticCurveTo(w, h * 0.75, w * 0.35, h * 0.2); s.lineTo(0, h * 0.25);
        if (double) {
            s.lineTo(-w * 0.35, h * 0.2); s.quadraticCurveTo(-w, h * 0.75, -w * 1.02, h * 0.5);
            s.quadraticCurveTo(-w * 1.12, 0, -w * 1.02, -h * 0.5); s.quadraticCurveTo(-w, -h * 0.75, -w * 0.35, -h * 0.2);
        }
        s.closePath();
        const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.4, bevelSize: 0.008, bevelSegments: 1 });
        g.translate(0, 0, -thick / 2);
        return (geoCache[k] = g);
    }

    M.build = function (id) {
        const m = materials();
        const g = new THREE.Group();
        g.name = 'weapon_' + id;
        let blade = { base: 0.1, tip: 0.6, radius: 0.05 };
        switch (id) {
            case 'dagger':
                g.add(mesh(bladeGeo(0.34, 0.05, 0.012, 0.1), m.steel, 0, 0.06));
                g.add(mesh(box(0.13, 0.025, 0.03), m.bronze, 0, 0.05));
                g.add(mesh(cyl(0.016, 0.018, 0.11), m.leather, 0, -0.01));
                g.add(mesh(sph(0.022), m.bronze, 0, -0.075));
                blade = { base: 0.08, tip: 0.4, radius: 0.04 };
                break;
            case 'gladius':
                g.add(mesh(bladeGeo(0.6, 0.065, 0.014, 0.12), m.steel, 0, 0.07));
                g.add(mesh(box(0.12, 0.035, 0.06), m.bronze, 0, 0.055));
                g.add(mesh(cyl(0.02, 0.022, 0.12, 8), m.darkWood, 0, -0.01));
                g.add(mesh(sph(0.035), m.bronze, 0, -0.085));
                blade = { base: 0.1, tip: 0.67, radius: 0.05 };
                break;
            case 'longsword':
                g.add(mesh(bladeGeo(0.92, 0.055, 0.012, 0.12), m.steel, 0, 0.07));
                g.add(mesh(box(0.26, 0.03, 0.03), m.darkSteel, 0, 0.055));
                g.add(mesh(cyl(0.018, 0.02, 0.22, 8), m.leather, 0, -0.06));
                g.add(mesh(sph(0.03), m.darkSteel, 0, -0.18));
                blade = { base: 0.12, tip: 0.98, radius: 0.05 };
                break;
            case 'greatsword':
                g.add(mesh(bladeGeo(1.22, 0.085, 0.016, 0.16), m.steel, 0, 0.09));
                g.add(mesh(box(0.42, 0.04, 0.045), m.darkSteel, 0, 0.07));
                g.add(mesh(box(0.1, 0.06, 0.02), m.darkSteel, 0, 0.16));
                g.add(mesh(cyl(0.02, 0.023, 0.36, 8), m.leather, 0, -0.13));
                g.add(mesh(sph(0.04), m.darkSteel, 0, -0.33));
                blade = { base: 0.15, tip: 1.3, radius: 0.06 };
                break;
            case 'axe':
                g.add(mesh(cyl(0.022, 0.026, 0.85, 8), m.wood, 0, 0.27));
                g.add(mesh(axeHeadGeo(0.17, 0.2, 0.012, false), m.darkSteel, 0.02, 0.6));
                g.add(mesh(box(0.06, 0.08, 0.05), m.darkSteel, 0, 0.6));
                blade = { base: 0.45, tip: 0.78, radius: 0.1 };
                break;
            case 'heavyaxe':
                g.add(mesh(cyl(0.026, 0.03, 1.25, 8), m.darkWood, 0, 0.3));
                g.add(mesh(axeHeadGeo(0.26, 0.32, 0.016, true), m.darkSteel, 0, 0.82));
                g.add(mesh(cone(0.03, 0.12, 4), m.darkSteel, 0, 1.0));
                g.add(mesh(box(0.08, 0.1, 0.07), m.darkSteel, 0, 0.82));
                blade = { base: 0.6, tip: 1.08, radius: 0.16 };
                break;
            case 'mace': {
                g.add(mesh(cyl(0.022, 0.025, 0.66, 8), m.darkWood, 0, 0.22));
                g.add(mesh(sph(0.075, 10), m.darkSteel, 0, 0.6));
                for (let i = 0; i < 6; i++) {
                    const a = i / 6 * Math.PI * 2;
                    g.add(mesh(box(0.012, 0.14, 0.07), m.darkSteel, Math.cos(a) * 0.07, 0.6, Math.sin(a) * 0.07, 0, -a, 0));
                }
                g.add(mesh(cone(0.025, 0.06, 6), m.darkSteel, 0, 0.7));
                blade = { base: 0.48, tip: 0.72, radius: 0.11 };
                break;
            }
            case 'hammer':
                g.add(mesh(cyl(0.024, 0.028, 1.15, 8), m.darkWood, 0, 0.28));
                g.add(mesh(box(0.28, 0.13, 0.13), m.darkSteel, 0, 0.84));
                g.add(mesh(box(0.06, 0.15, 0.15), m.steel, 0.15, 0.84));
                g.add(mesh(cone(0.04, 0.14, 4), m.darkSteel, -0.19, 0.84, 0, 0, 0, Math.PI / 2));
                blade = { base: 0.7, tip: 0.96, radius: 0.14 };
                break;
            case 'spear':
                g.add(mesh(cyl(0.02, 0.022, 2.3, 8), m.wood, 0, 0.45));
                g.add(mesh(bladeGeo(0.3, 0.07, 0.016, 0.14), m.steel, 0, 1.6));
                g.add(mesh(cyl(0.028, 0.022, 0.08, 8), m.bronze, 0, 1.6));
                g.add(mesh(cone(0.025, 0.06, 6), m.bronze, 0, -0.72, 0, Math.PI, 0, 0));
                blade = { base: 1.2, tip: 1.9, radius: 0.05 };
                break;
            case 'bow': {
                const pts = [];
                for (let i = 0; i <= 16; i++) {
                    const t = i / 16 * 2 - 1; // -1..1
                    pts.push(new THREE.Vector3(0, t * 0.72, -0.16 * (1 - t * t) + 0.02 * t * t * t * t));
                }
                const curve = new THREE.CatmullRomCurve3(pts);
                g.add(mesh(new THREE.TubeGeometry(curve, 24, 0.017, 6, false), m.darkWood));
                g.add(mesh(cyl(0.024, 0.024, 0.14, 8), m.leather, 0, 0, -0.16));
                const sg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.72, 0.02), new THREE.Vector3(0, 0, 0.02), new THREE.Vector3(0, -0.72, 0.02)]);
                const str = new THREE.Line(sg, m.string);
                g.add(str);
                g.userData.string = str;
                g.userData.setDraw = (d) => {
                    const p = str.geometry.attributes.position;
                    p.setZ(1, 0.02 + d * 0.5); p.needsUpdate = true;
                };
                blade = null;
                break;
            }
            case 'crossbow': {
                // culata a lo largo de -Z (apunta hacia delante)
                g.add(mesh(box(0.07, 0.07, 0.75), m.darkWood, 0, 0, -0.28));
                g.add(mesh(box(0.06, 0.16, 0.12), m.darkWood, 0, -0.08, 0.04));
                const prodPts = [];
                for (let i = 0; i <= 12; i++) { const t = i / 12 * 2 - 1; prodPts.push(new THREE.Vector3(t * 0.36, 0.02, -0.62 + 0.09 * (1 - t * t))); }
                g.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(prodPts), 16, 0.016, 6, false), m.darkSteel));
                const sg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.36, 0.02, -0.62), new THREE.Vector3(0, 0.03, -0.3), new THREE.Vector3(0.36, 0.02, -0.62)]);
                const str = new THREE.Line(sg, m.string); g.add(str);
                const bolt = mesh(cyl(0.008, 0.008, 0.36, 5), m.wood, 0, 0.05, -0.45, Math.PI / 2, 0, 0);
                g.add(bolt);
                g.userData.bolt = bolt;
                g.userData.string = str;
                g.userData.setLoaded = (l) => {
                    bolt.visible = l;
                    const p = str.geometry.attributes.position; p.setZ(1, l ? -0.3 : -0.55); p.needsUpdate = true;
                };
                blade = null;
                break;
            }
            case 'javelin':
                g.add(mesh(cyl(0.016, 0.018, 1.7, 7), m.wood, 0, 0.25));
                g.add(mesh(cone(0.03, 0.28, 4), m.steel, 0, 1.24));
                g.add(mesh(cyl(0.02, 0.02, 0.12, 7), m.leather, 0, 0));
                blade = { base: 1.0, tip: 1.38, radius: 0.04 };
                break;
            case 'shield': {
                const s = mesh(cyl(0.36, 0.36, 0.05, 20), m.wood, 0, 0, 0, Math.PI / 2, 0, 0);
                g.add(s);
                const rim = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.02, 6, 24), m.bronze);
                g.add(rim);
                g.add(mesh(sph(0.07, 10), m.bronze, 0, 0, -0.035));
                blade = null;
                break;
            }
            case 'scutum': {
                const s = mesh(box(0.62, 0.95, 0.06), new THREE.MeshStandardMaterial({ color: 0x8a1c1c, roughness: 0.8, map: GL.Tex.cloth('#8a1c1c', 'eagle') }), 0, 0, 0);
                g.add(s);
                g.add(mesh(box(0.66, 0.04, 0.07), m.bronze, 0, 0.47, 0));
                g.add(mesh(box(0.66, 0.04, 0.07), m.bronze, 0, -0.47, 0));
                g.add(mesh(sph(0.08, 10), m.bronze, 0, 0, -0.04));
                blade = null;
                break;
            }
            default:
                return M.build('gladius');
        }
        g.userData.blade = blade;
        g.userData.weaponId = id;
        return g;
    };

    /** Proyectiles (orientados a +Z, punta en +Z) */
    M.projectile = function (kind) {
        const m = materials();
        const g = new THREE.Group();
        if (kind === 'arrow' || kind === 'bolt') {
            const len = kind === 'arrow' ? 0.75 : 0.42;
            g.add(mesh(cyl(0.008, 0.008, len, 5), m.wood, 0, 0, 0, Math.PI / 2, 0, 0));
            g.add(mesh(cone(0.02, 0.07, 4), m.darkSteel, 0, 0, len / 2 + 0.03, Math.PI / 2, 0, 0));
            const f = new THREE.Mesh(box(0.003, 0.05, 0.1), m.feather); f.position.z = -len / 2 + 0.06; g.add(f);
            const f2 = new THREE.Mesh(box(0.05, 0.003, 0.1), m.feather); f2.position.z = -len / 2 + 0.06; g.add(f2);
        } else if (kind === 'javelin') {
            g.add(mesh(cyl(0.016, 0.018, 1.7, 7), m.wood, 0, 0, 0, Math.PI / 2, 0, 0));
            g.add(mesh(cone(0.03, 0.28, 4), m.steel, 0, 0, 0.99, Math.PI / 2, 0, 0));
        } else if (kind === 'axe') {
            const a = M.build('axe'); a.rotation.x = Math.PI / 2; g.add(a);
        }
        return g;
    };

    GL.WeaponModels = M;
})();
