/* Física del mundo: colisionadores AABB/cilindro, suelo, raycast y línea de visión */
(function () {
    const U = GL.U;
    const CELL = 4;

    class Physics {
        constructor() {
            this.colliders = [];
            this.grid = new Map();
            this.bounds = { A: 34, B: 25 };   // elipse de la arena
            this.tunnels = [];                 // zonas fuera de la elipse permitidas
            this._query = [];
            this._stamp = 0;
        }

        _key(ix, iz) { return ix * 73856093 ^ iz * 19349663; }

        add(c) {
            c.enabled = c.enabled !== false;
            c._stamp = 0;
            this.colliders.push(c);
            let x0, x1, z0, z1;
            if (c.type === 'box') { x0 = c.min.x; x1 = c.max.x; z0 = c.min.z; z1 = c.max.z; }
            else { x0 = c.x - c.r; x1 = c.x + c.r; z0 = c.z - c.r; z1 = c.z + c.r; }
            for (let ix = Math.floor(x0 / CELL); ix <= Math.floor(x1 / CELL); ix++)
                for (let iz = Math.floor(z0 / CELL); iz <= Math.floor(z1 / CELL); iz++) {
                    const k = this._key(ix, iz);
                    if (!this.grid.has(k)) this.grid.set(k, []);
                    this.grid.get(k).push(c);
                }
            return c;
        }

        box(x0, y0, z0, x1, y1, z1, opts) {
            return this.add(Object.assign({ type: 'box', min: { x: Math.min(x0, x1), y: Math.min(y0, y1), z: Math.min(z0, z1) }, max: { x: Math.max(x0, x1), y: Math.max(y0, y1), z: Math.max(z0, z1) }, walkable: true, blocksLOS: true }, opts || {}));
        }
        cyl(x, z, r, y0, y1, opts) {
            return this.add(Object.assign({ type: 'cyl', x, z, r, y0, y1, walkable: true, blocksLOS: true }, opts || {}));
        }

        /** Colisionadores cerca de un rectángulo (sin duplicados) */
        near(x0, z0, x1, z1) {
            this._stamp++;
            const out = this._query; out.length = 0;
            for (let ix = Math.floor(x0 / CELL); ix <= Math.floor(x1 / CELL); ix++)
                for (let iz = Math.floor(z0 / CELL); iz <= Math.floor(z1 / CELL); iz++) {
                    const l = this.grid.get(this._key(ix, iz));
                    if (!l) continue;
                    for (let i = 0; i < l.length; i++) {
                        const c = l[i];
                        if (c.enabled && c._stamp !== this._stamp) { c._stamp = this._stamp; out.push(c); }
                    }
                }
            return out;
        }

        _top(c) { return c.type === 'box' ? c.max.y : c.y1; }
        _bottom(c) { return c.type === 'box' ? c.min.y : c.y0; }

        _overlapCircle(c, x, z, r) {
            if (c.type === 'box') {
                const cx = U.clamp(x, c.min.x, c.max.x), cz = U.clamp(z, c.min.z, c.max.z);
                const dx = x - cx, dz = z - cz;
                return dx * dx + dz * dz < r * r;
            }
            const d = Math.hypot(x - c.x, z - c.z);
            return d < r + c.r;
        }

        /** Altura del suelo bajo un círculo, considerando superficies alcanzables desde footY */
        groundHeight(x, z, footY, r, step) {
            let h = 0;
            const list = this.near(x - r, z - r, x + r, z + r);
            const lim = footY + (step == null ? GL.GAME_CONFIG.player.stepHeight : step);
            for (let i = 0; i < list.length; i++) {
                const c = list[i];
                if (!c.walkable) continue;
                const top = this._top(c);
                if (top > lim || top <= h) continue;
                if (this._overlapCircle(c, x, z, r * 0.6)) h = top;
            }
            return h;
        }

        /** ¿Está dentro de la zona jugable (elipse o túneles)? */
        insideBounds(x, z, margin) {
            const m = margin || 0;
            const A = this.bounds.A - m, B = this.bounds.B - m;
            if ((x * x) / (A * A) + (z * z) / (B * B) <= 1) return true;
            for (const t of this.tunnels) if (x > t.x0 && x < t.x1 && z > t.z0 && z < t.z1) return true;
            return false;
        }

        /**
         * Resuelve colisión horizontal de un círculo (radio r) con pies en y y altura h.
         * Modifica pos (x,z). Devuelve true si hubo colisión.
         */
        resolve(pos, r, h, step) {
            let hit = false;
            const st = step == null ? GL.GAME_CONFIG.player.stepHeight : step;
            for (let pass = 0; pass < 3; pass++) {
                const list = this.near(pos.x - r - 0.5, pos.z - r - 0.5, pos.x + r + 0.5, pos.z + r + 0.5);
                let moved = false;
                for (let i = 0; i < list.length; i++) {
                    const c = list[i];
                    const top = this._top(c), bot = this._bottom(c);
                    if (top <= pos.y + st || bot >= pos.y + h) continue;
                    if (c.type === 'box') {
                        const cx = U.clamp(pos.x, c.min.x, c.max.x), cz = U.clamp(pos.z, c.min.z, c.max.z);
                        let dx = pos.x - cx, dz = pos.z - cz;
                        const d2 = dx * dx + dz * dz;
                        if (d2 >= r * r) continue;
                        if (d2 < 1e-9) {
                            // centro dentro de la caja: empujar por el eje de menor penetración
                            const px0 = pos.x - c.min.x, px1 = c.max.x - pos.x, pz0 = pos.z - c.min.z, pz1 = c.max.z - pos.z;
                            const m = Math.min(px0, px1, pz0, pz1);
                            if (m === px0) pos.x = c.min.x - r; else if (m === px1) pos.x = c.max.x + r;
                            else if (m === pz0) pos.z = c.min.z - r; else pos.z = c.max.z + r;
                        } else {
                            const d = Math.sqrt(d2), push = (r - d) / d;
                            pos.x += dx * push; pos.z += dz * push;
                        }
                    } else {
                        const dx = pos.x - c.x, dz = pos.z - c.z, d = Math.hypot(dx, dz), min = r + c.r;
                        if (d >= min) continue;
                        if (d < 1e-6) { pos.x += min; continue; }
                        pos.x = c.x + dx / d * min; pos.z = c.z + dz / d * min;
                    }
                    hit = moved = true;
                }
                if (!moved) break;
            }
            // límite de la arena (elipse) salvo dentro de túneles
            if (!this.insideBounds(pos.x, pos.z, r)) {
                let inTunnel = false;
                for (const t of this.tunnels) if (pos.x > t.x0 - r && pos.x < t.x1 + r && pos.z > t.z0 - 2 && pos.z < t.z1 + 2) { inTunnel = true; break; }
                if (!inTunnel) {
                    const A = this.bounds.A - r, B = this.bounds.B - r;
                    const k = Math.sqrt((pos.x * pos.x) / (A * A) + (pos.z * pos.z) / (B * B));
                    if (k > 1) { pos.x /= k; pos.z /= k; hit = true; }
                }
            }
            return hit;
        }

        /** Raycast contra colisionadores, suelo y muro exterior. Devuelve {dist, point, normal, collider} o null */
        raycast(o, d, maxDist, opts) {
            let best = maxDist, bestN = null, bestC = null;
            const losOnly = opts && opts.losOnly;
            // suelo y=0
            if (d.y < -1e-6) {
                const t = -o.y / d.y;
                if (t > 0 && t < best) { best = t; bestN = { x: 0, y: 1, z: 0 }; bestC = 'floor'; }
            }
            const ex = o.x + d.x * maxDist, ez = o.z + d.z * maxDist;
            const list = this.near(Math.min(o.x, ex) - 1, Math.min(o.z, ez) - 1, Math.max(o.x, ex) + 1, Math.max(o.z, ez) + 1);
            for (let i = 0; i < list.length; i++) {
                const c = list[i];
                if (losOnly && !c.blocksLOS) continue;
                if (c.type === 'box') {
                    let tmin = 0, tmax = best, nAxis = -1, nSign = 0;
                    const mins = [c.min.x, c.min.y, c.min.z], maxs = [c.max.x, c.max.y, c.max.z];
                    const os = [o.x, o.y, o.z], ds = [d.x, d.y, d.z];
                    let ok = true;
                    for (let a = 0; a < 3; a++) {
                        if (Math.abs(ds[a]) < 1e-9) { if (os[a] < mins[a] || os[a] > maxs[a]) { ok = false; break; } continue; }
                        let t1 = (mins[a] - os[a]) / ds[a], t2 = (maxs[a] - os[a]) / ds[a], s = -1;
                        if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
                        if (t1 > tmin) { tmin = t1; nAxis = a; nSign = s; }
                        if (t2 < tmax) tmax = t2;
                        if (tmin > tmax) { ok = false; break; }
                    }
                    if (ok && nAxis >= 0 && tmin < best) {
                        best = tmin; bestC = c;
                        bestN = { x: nAxis === 0 ? nSign : 0, y: nAxis === 1 ? nSign : 0, z: nAxis === 2 ? nSign : 0 };
                    }
                } else {
                    // cilindro vertical: intersección en XZ + rango Y
                    const ox = o.x - c.x, oz = o.z - c.z;
                    const a = d.x * d.x + d.z * d.z;
                    if (a < 1e-9) continue;
                    const b = 2 * (ox * d.x + oz * d.z), cc = ox * ox + oz * oz - c.r * c.r;
                    const disc = b * b - 4 * a * cc;
                    if (disc < 0) continue;
                    const t = (-b - Math.sqrt(disc)) / (2 * a);
                    if (t < 0 || t >= best) continue;
                    const y = o.y + d.y * t;
                    if (y < c.y0 || y > c.y1) continue;
                    best = t; bestC = c;
                    const hx = ox + d.x * t, hz = oz + d.z * t, l = Math.hypot(hx, hz) || 1;
                    bestN = { x: hx / l, y: 0, z: hz / l };
                }
            }
            // muro exterior (elipse) — sólo si no estamos en un túnel
            const ell = this._rayEllipse(o, d, best);
            if (ell && ell.t < best) { best = ell.t; bestN = ell.n; bestC = 'wall'; }
            if (!bestN) return null;
            return { dist: best, point: { x: o.x + d.x * best, y: o.y + d.y * best, z: o.z + d.z * best }, normal: bestN, collider: bestC };
        }

        _rayEllipse(o, d, maxT) {
            const A = this.bounds.A, B = this.bounds.B;
            if ((o.x * o.x) / (A * A) + (o.z * o.z) / (B * B) > 1) return null; // fuera (túnel)
            const a = (d.x * d.x) / (A * A) + (d.z * d.z) / (B * B);
            if (a < 1e-12) return null;
            const b = 2 * ((o.x * d.x) / (A * A) + (o.z * d.z) / (B * B));
            const c = (o.x * o.x) / (A * A) + (o.z * o.z) / (B * B) - 1;
            const disc = b * b - 4 * a * c;
            if (disc < 0) return null;
            const t = (-b + Math.sqrt(disc)) / (2 * a);
            if (t < 0 || t > maxT) return null;
            const px = o.x + d.x * t, pz = o.z + d.z * t, py = o.y + d.y * t;
            if (py > 4.2) return null;   // por encima del muro del podio
            for (const tn of this.tunnels) if (px > tn.x0 && px < tn.x1 && Math.abs(pz - (tn.z0 + tn.z1) / 2) < 6 && py < 3.2) return null;
            const nx = -px / (A * A), nz = -pz / (B * B), l = Math.hypot(nx, nz);
            return { t, n: { x: nx / l, y: 0, z: nz / l } };
        }

        /** Línea de visión entre dos puntos */
        los(a, b) {
            const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
            const len = Math.hypot(dx, dy, dz);
            if (len < 1e-4) return true;
            const d = { x: dx / len, y: dy / len, z: dz / len };
            const hit = this.raycast(a, d, len, { losOnly: true });
            return !hit || hit.dist >= len - 0.05;
        }
    }
    GL.Physics = Physics;
})();
