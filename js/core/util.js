/* Utilidades matemáticas, RNG, pools y eventos */
(function () {
    const U = {};

    U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    U.lerp = (a, b, t) => a + (b - a) * t;
    U.damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
    U.smooth = (t) => t * t * (3 - 2 * t);
    U.easeOut = (t) => 1 - (1 - t) * (1 - t);
    U.easeIn = (t) => t * t;
    U.rand = (a, b) => a + Math.random() * (b - a);
    U.randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
    U.pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    U.angleDiff = (a, b) => {
        let d = (b - a) % (Math.PI * 2);
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        return d;
    };
    U.lerpAngle = (a, b, t) => a + U.angleDiff(a, b) * t;
    U.dist2D = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
    U.round = (v, p) => { const m = Math.pow(10, p || 2); return Math.round(v * m) / m; };
    U.isNum = (v) => typeof v === 'number' && isFinite(v);

    U.weightedPick = (weights) => {
        let total = 0;
        for (const k in weights) total += weights[k];
        let r = Math.random() * total;
        for (const k in weights) { r -= weights[k]; if (r <= 0) return k; }
        return Object.keys(weights)[0];
    };

    U.uid = (len) => {
        const a = 'abcdefghijkmnopqrstuvwxyz23456789';
        let s = '';
        const arr = new Uint32Array(len || 10);
        (window.crypto || window.msCrypto).getRandomValues(arr);
        for (let i = 0; i < arr.length; i++) s += a[arr[i] % a.length];
        return s;
    };

    U.randomCode = () => {
        const cfg = GL.NETWORK_CONFIG;
        const arr = new Uint32Array(cfg.codeLength);
        window.crypto.getRandomValues(arr);
        let s = '';
        for (let i = 0; i < arr.length; i++) s += cfg.codeAlphabet[arr[i] % cfg.codeAlphabet.length];
        return s;
    };

    U.sanitizeName = (s) => String(s || '').replace(/[^\p{L}\p{N} _\-]/gu, '').trim().slice(0, 16) || 'Gladiador';

    /** Emisor de eventos mínimo */
    class Emitter {
        constructor() { this._h = {}; }
        on(ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); return () => this.off(ev, fn); }
        off(ev, fn) { const l = this._h[ev]; if (!l) return; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }
        emit(ev, ...args) { const l = this._h[ev]; if (!l) return; for (const fn of l.slice()) { try { fn(...args); } catch (e) { console.error('[evento ' + ev + ']', e); } } }
    }
    U.Emitter = Emitter;

    /** Pool genérico de objetos */
    class Pool {
        constructor(factory, reset) { this.factory = factory; this.reset = reset; this.free = []; }
        get() { return this.free.length ? this.free.pop() : this.factory(); }
        release(o) { if (this.reset) this.reset(o); this.free.push(o); }
    }
    U.Pool = Pool;

    /* --- Geometría: distancia segmento-segmento (para hitboxes cápsula) --- */
    // Devuelve distancia^2 y params s,t de los puntos más cercanos.
    const d1 = { x: 0, y: 0, z: 0 }, d2 = { x: 0, y: 0, z: 0 }, r = { x: 0, y: 0, z: 0 };
    U.segSegDist2 = function (p1, q1, p2, q2, out) {
        d1.x = q1.x - p1.x; d1.y = q1.y - p1.y; d1.z = q1.z - p1.z;
        d2.x = q2.x - p2.x; d2.y = q2.y - p2.y; d2.z = q2.z - p2.z;
        r.x = p1.x - p2.x; r.y = p1.y - p2.y; r.z = p1.z - p2.z;
        const a = d1.x * d1.x + d1.y * d1.y + d1.z * d1.z;
        const e = d2.x * d2.x + d2.y * d2.y + d2.z * d2.z;
        const f = d2.x * r.x + d2.y * r.y + d2.z * r.z;
        let s, t;
        const EPS = 1e-8;
        if (a <= EPS && e <= EPS) { s = t = 0; }
        else if (a <= EPS) { s = 0; t = U.clamp(f / e, 0, 1); }
        else {
            const c = d1.x * r.x + d1.y * r.y + d1.z * r.z;
            if (e <= EPS) { t = 0; s = U.clamp(-c / a, 0, 1); }
            else {
                const b = d1.x * d2.x + d1.y * d2.y + d1.z * d2.z;
                const denom = a * e - b * b;
                s = denom !== 0 ? U.clamp((b * f - c * e) / denom, 0, 1) : 0;
                t = (b * s + f) / e;
                if (t < 0) { t = 0; s = U.clamp(-c / a, 0, 1); }
                else if (t > 1) { t = 1; s = U.clamp((b - c) / a, 0, 1); }
            }
        }
        const cx = p1.x + d1.x * s - (p2.x + d2.x * t);
        const cy = p1.y + d1.y * s - (p2.y + d2.y * t);
        const cz = p1.z + d1.z * s - (p2.z + d2.z * t);
        if (out) { out.s = s; out.t = t; }
        return cx * cx + cy * cy + cz * cz;
    };

    U.formatPts = (n) => Math.floor(n).toLocaleString('es-ES');

    U.storage = {
        get(k, def) { try { const v = localStorage.getItem('gladiadores.' + k); return v === null ? def : JSON.parse(v); } catch (e) { return def; } },
        set(k, v) { try { localStorage.setItem('gladiadores.' + k, JSON.stringify(v)); } catch (e) { /* almacenamiento no disponible */ } }
    };

    GL.U = U;
})();
