/* Navegación: rejilla de 2 capas (suelo + superficies elevadas) y campos de flujo
 * (Dijkstra multi-objetivo) para que la IA encuentre rutas, suba escaleras y
 * rodee obstáculos. Se recalcula de forma escalonada. */
(function () {
    const CELL = 0.5, X0 = -36, Z0 = -34, NX = 144, NZ = 136, LAYERS = 2;
    const STEP_UP = 0.46, DROP = 3.0, CLEAR = 1.7, AGENT_R = 0.38;

    class MinHeap {
        constructor(cap) { this.k = new Int32Array(cap); this.v = new Float32Array(cap); this.n = 0; }
        clear() { this.n = 0; }
        push(key, val) {
            let i = this.n++;
            if (i >= this.k.length) { const nk = new Int32Array(this.k.length * 2); nk.set(this.k); this.k = nk; const nv = new Float32Array(this.v.length * 2); nv.set(this.v); this.v = nv; }
            while (i > 0) { const p = (i - 1) >> 1; if (this.v[p] <= val) break; this.k[i] = this.k[p]; this.v[i] = this.v[p]; i = p; }
            this.k[i] = key; this.v[i] = val;
        }
        pop() {
            const top = this.k[0]; const lastK = this.k[--this.n], lastV = this.v[this.n];
            let i = 0;
            while (true) {
                let c = 2 * i + 1; if (c >= this.n) break;
                if (c + 1 < this.n && this.v[c + 1] < this.v[c]) c++;
                if (this.v[c] >= lastV) break;
                this.k[i] = this.k[c]; this.v[i] = this.v[c]; i = c;
            }
            this.k[i] = lastK; this.v[i] = lastV;
            return top;
        }
        topVal() { return this.v[0]; }
    }

    class Nav {
        constructor(physics) {
            this.physics = physics;
            this.h = new Float32Array(NX * NZ * LAYERS).fill(NaN);
            this.heap = new MinHeap(8192);
            this.fields = new Map();
            this.built = false;
        }

        cellIndex(x, z) {
            const ix = Math.floor((x - X0) / CELL), iz = Math.floor((z - Z0) / CELL);
            if (ix < 0 || iz < 0 || ix >= NX || iz >= NZ) return -1;
            return iz * NX + ix;
        }
        cellCenter(cell) { return { x: X0 + (cell % NX + 0.5) * CELL, z: Z0 + (Math.floor(cell / NX) + 0.5) * CELL }; }

        build() {
            const P = this.physics;
            this.h.fill(NaN);
            for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < NX; ix++) {
                const x = X0 + (ix + 0.5) * CELL, z = Z0 + (iz + 0.5) * CELL;
                if (!P.insideBounds(x, z, AGENT_R * 0.5)) continue;
                const cands = [0];
                const list = P.near(x - 0.3, z - 0.3, x + 0.3, z + 0.3);
                for (const c of list) {
                    if (!c.walkable) continue;
                    const top = c.type === 'box' ? c.max.y : c.y1;
                    if (top > 0.05 && P._overlapCircle(c, x, z, 0.12)) cands.push(top);
                }
                cands.sort((a, b) => a - b);
                const ok = [];
                for (const h of cands) {
                    if (ok.length && Math.abs(ok[ok.length - 1] - h) < 0.05) continue;
                    if (this._clear(x, z, h)) ok.push(h);
                }
                // nos quedamos con la superficie más baja y la más alta separadas > 1 m
                const cell = iz * NX + ix;
                if (!ok.length) continue;
                // si hay escalón continuo (escalera) usamos la superficie de apoyo real más alta bajo 0.5
                let low = ok[0];
                for (const h of ok) if (h <= low + STEP_UP && h > low) low = h;
                this.h[cell * 2] = low;
                const high = ok[ok.length - 1];
                if (high - low > 1.0) this.h[cell * 2 + 1] = high;
            }
            this.fields.clear();
            this.built = true;
        }

        _clear(x, z, h) {
            const P = this.physics;
            const list = P.near(x - AGENT_R, z - AGENT_R, x + AGENT_R, z + AGENT_R);
            for (const c of list) {
                const top = c.type === 'box' ? c.max.y : c.y1, bot = c.type === 'box' ? c.min.y : c.y0;
                if (top <= h + STEP_UP || bot >= h + CLEAR) continue;
                if (P._overlapCircle(c, x, z, AGENT_R)) return false;
            }
            return true;
        }

        /** Nodo más adecuado para una posición (x, y pies, z) */
        nodeAt(x, y, z) {
            const cell = this.cellIndex(x, z);
            if (cell < 0) return -1;
            let best = -1, bd = 1e9;
            for (let l = 0; l < LAYERS; l++) {
                const h = this.h[cell * 2 + l];
                if (h !== h) continue;
                if (h > y + 0.6) continue;
                const d = Math.abs(y - h);
                if (d < bd) { bd = d; best = cell * 2 + l; }
            }
            if (best >= 0) return best;
            // buscar vecino válido más cercano
            const ix = cell % NX, iz = Math.floor(cell / NX);
            for (let r = 1; r <= 3; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
                const nx = ix + dx, nz = iz + dz;
                if (nx < 0 || nz < 0 || nx >= NX || nz >= NZ) continue;
                const c2 = nz * NX + nx;
                for (let l = 0; l < LAYERS; l++) { const h = this.h[c2 * 2 + l]; if (h === h && Math.abs(h - y) < 1.0) return c2 * 2 + l; }
            }
            return -1;
        }

        /** Campo de distancias hacia un objetivo (clave = id del objetivo) */
        computeField(key, x, y, z) {
            let f = this.fields.get(key);
            if (!f) { f = { dist: new Float32Array(NX * NZ * LAYERS), time: 0 }; this.fields.set(key, f); }
            const dist = f.dist; dist.fill(Infinity);
            const start = this.nodeAt(x, y, z);
            f.valid = start >= 0;
            if (start < 0) return f;
            const heap = this.heap; heap.clear();
            dist[start] = 0; heap.push(start, 0);
            const H = this.h;
            while (heap.n > 0) {
                const d0 = heap.topVal();
                const m = heap.pop();
                if (d0 > dist[m]) continue;
                const cell = m >> 1, hm = H[m];
                const ix = cell % NX, iz = (cell - ix) / NX;
                for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
                    if (!dx && !dz) continue;
                    const nx = ix + dx, nz = iz + dz;
                    if (nx < 0 || nz < 0 || nx >= NX || nz >= NZ) continue;
                    const c2 = nz * NX + nx;
                    if (dx && dz) { // sin cortar esquinas
                        if (!this._hasNear(iz * NX + nx, hm) || !this._hasNear(nz * NX + ix, hm)) continue;
                    }
                    const cost = d0 + (dx && dz ? 1.4142 : 1);
                    for (let l = 0; l < LAYERS; l++) {
                        const n = c2 * 2 + l, hn = H[n];
                        if (hn !== hn) continue;
                        // moverse de n -> m: subir <= STEP_UP o caer <= DROP
                        if (hm - hn > STEP_UP || hn - hm > DROP) continue;
                        const c = cost + (hn - hm > STEP_UP ? 2 : 0);
                        if (c < dist[n]) { dist[n] = c; heap.push(n, c); }
                    }
                }
            }
            return f;
        }

        _hasNear(cell, h) {
            for (let l = 0; l < LAYERS; l++) { const v = this.h[cell * 2 + l]; if (v === v && Math.abs(v - h) <= DROP) return true; }
            return false;
        }

        /** Siguiente punto hacia el objetivo según el campo. dir=1 acercarse, -1 alejarse */
        nextStep(field, x, y, z, dirSign) {
            if (!field || !field.valid) return null;
            const n0 = this.nodeAt(x, y, z);
            if (n0 < 0) return null;
            const dist = field.dist, H = this.h;
            const cell = n0 >> 1, ix = cell % NX, iz = (cell - ix) / NX;
            let best = -1, bv = dist[n0], sgn = dirSign || 1;
            if (sgn < 0) bv = -bv;
            for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
                if (!dx && !dz) continue;
                const nx = ix + dx, nz = iz + dz;
                if (nx < 0 || nz < 0 || nx >= NX || nz >= NZ) continue;
                const c2 = nz * NX + nx;
                if (dx && dz && (!this._hasNear(iz * NX + nx, H[n0]) || !this._hasNear(nz * NX + ix, H[n0]))) continue;
                for (let l = 0; l < LAYERS; l++) {
                    const n = c2 * 2 + l, hn = H[n];
                    if (hn !== hn) continue;
                    if (hn - H[n0] > STEP_UP || H[n0] - hn > DROP) continue;
                    let v = dist[n]; if (!isFinite(v)) continue;
                    if (sgn < 0) v = -v;
                    if (v < bv) { bv = v; best = n; }
                }
            }
            if (best < 0) return null;
            const c = this.cellCenter(best >> 1);
            return { x: c.x, z: c.z, h: H[best], d: dist[best] };
        }

        distanceAt(field, x, y, z) {
            if (!field || !field.valid) return Infinity;
            const n = this.nodeAt(x, y, z);
            return n < 0 ? Infinity : field.dist[n];
        }

        walkable(x, z) {
            const c = this.cellIndex(x, z);
            return c >= 0 && this.h[c * 2] === this.h[c * 2];
        }
    }
    GL.Nav = Nav;
})();
