/* Texturas procedurales generadas en canvas (no requieren archivos externos) */
(function () {
    const T = {};
    const cache = {};

    function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

    function noiseFill(ctx, w, h, base, variance, count, sizeMin, sizeMax, alpha) {
        for (let i = 0; i < count; i++) {
            const v = (Math.random() - 0.5) * variance;
            ctx.fillStyle = `rgba(${base[0] + v | 0},${base[1] + v | 0},${base[2] + v | 0},${alpha})`;
            const s = sizeMin + Math.random() * (sizeMax - sizeMin);
            ctx.fillRect(Math.random() * w, Math.random() * h, s, s);
        }
    }

    function tex(c, repeatX, repeatY, srgb) {
        const t = new THREE.CanvasTexture(c);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(repeatX || 1, repeatY || 1);
        t.anisotropy = 4;
        if (srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
        return t;
    }

    T.sand = function () {
        if (cache.sand) return cache.sand;
        const c = canvas(512, 512), x = c.getContext('2d');
        x.fillStyle = '#c9a66b'; x.fillRect(0, 0, 512, 512);
        noiseFill(x, 512, 512, [200, 165, 105], 50, 9000, 1, 3, 0.5);
        noiseFill(x, 512, 512, [150, 115, 70], 40, 1200, 2, 5, 0.25);
        // manchas y huellas
        for (let i = 0; i < 40; i++) {
            const g = x.createRadialGradient(0, 0, 0, 0, 0, 30 + Math.random() * 60);
            g.addColorStop(0, 'rgba(120,85,45,0.18)'); g.addColorStop(1, 'rgba(120,85,45,0)');
            x.save(); x.translate(Math.random() * 512, Math.random() * 512); x.fillStyle = g; x.fillRect(-90, -90, 180, 180); x.restore();
        }
        return (cache.sand = tex(c, 14, 14));
    };

    T.stone = function (tint) {
        const key = 'stone' + (tint || '');
        if (cache[key]) return cache[key];
        const c = canvas(512, 512), x = c.getContext('2d');
        const base = tint === 'dark' ? [96, 86, 74] : tint === 'light' ? [196, 184, 160] : [160, 146, 122];
        x.fillStyle = `rgb(${base})`; x.fillRect(0, 0, 512, 512);
        const rows = 8, bh = 512 / rows;
        for (let r = 0; r < rows; r++) {
            let xx = (r % 2) * -40;
            while (xx < 512) {
                const bw = 70 + Math.random() * 60;
                const v = (Math.random() - 0.5) * 34;
                x.fillStyle = `rgb(${base[0] + v | 0},${base[1] + v | 0},${base[2] + v | 0})`;
                x.fillRect(xx + 2, r * bh + 2, bw - 4, bh - 4);
                xx += bw;
            }
        }
        noiseFill(x, 512, 512, base, 60, 7000, 1, 2, 0.35);
        x.strokeStyle = 'rgba(40,32,24,0.55)'; x.lineWidth = 3;
        for (let r = 0; r <= rows; r++) { x.beginPath(); x.moveTo(0, r * bh); x.lineTo(512, r * bh); x.stroke(); }
        // grietas
        x.strokeStyle = 'rgba(30,25,20,0.4)'; x.lineWidth = 1;
        for (let i = 0; i < 25; i++) {
            x.beginPath(); let px = Math.random() * 512, py = Math.random() * 512; x.moveTo(px, py);
            for (let k = 0; k < 5; k++) { px += (Math.random() - 0.5) * 30; py += Math.random() * 20; x.lineTo(px, py); }
            x.stroke();
        }
        return (cache[key] = tex(c, 1, 1));
    };

    T.wood = function () {
        if (cache.wood) return cache.wood;
        const c = canvas(256, 512), x = c.getContext('2d');
        const planks = 4, pw = 256 / planks;
        for (let p = 0; p < planks; p++) {
            const v = (Math.random() - 0.5) * 30;
            x.fillStyle = `rgb(${110 + v | 0},${72 + v | 0},${40 + v | 0})`;
            x.fillRect(p * pw, 0, pw, 512);
            for (let i = 0; i < 40; i++) {
                x.strokeStyle = `rgba(60,35,15,${0.15 + Math.random() * 0.2})`;
                x.lineWidth = 1 + Math.random();
                const off = p * pw + Math.random() * pw;
                x.beginPath(); x.moveTo(off, 0);
                x.bezierCurveTo(off + (Math.random() - 0.5) * 10, 170, off + (Math.random() - 0.5) * 10, 340, off + (Math.random() - 0.5) * 6, 512);
                x.stroke();
            }
            x.fillStyle = 'rgba(30,18,8,0.8)'; x.fillRect(p * pw, 0, 2, 512);
            // clavos
            x.fillStyle = '#2b2b2b';
            x.fillRect(p * pw + pw / 2 - 2, 20, 4, 4); x.fillRect(p * pw + pw / 2 - 2, 488, 4, 4);
        }
        return (cache.wood = tex(c, 1, 1));
    };

    T.metal = function () {
        if (cache.metal) return cache.metal;
        const c = canvas(256, 256), x = c.getContext('2d');
        x.fillStyle = '#9a9a9a'; x.fillRect(0, 0, 256, 256);
        for (let i = 0; i < 300; i++) {
            x.strokeStyle = `rgba(${Math.random() < 0.5 ? 255 : 40},${Math.random() < 0.5 ? 255 : 40},${Math.random() < 0.5 ? 255 : 40},0.06)`;
            const y = Math.random() * 256; x.beginPath(); x.moveTo(0, y); x.lineTo(256, y + (Math.random() - 0.5) * 6); x.stroke();
        }
        return (cache.metal = tex(c, 1, 1));
    };

    T.cloth = function (color, pattern) {
        const key = 'cloth' + color + pattern;
        if (cache[key]) return cache[key];
        const c = canvas(256, 512), x = c.getContext('2d');
        x.fillStyle = color; x.fillRect(0, 0, 256, 512);
        x.fillStyle = 'rgba(212,175,55,0.9)';
        x.fillRect(0, 0, 256, 18); x.fillRect(0, 494, 256, 18);
        if (pattern === 'eagle') {
            x.fillStyle = 'rgba(230,190,70,0.95)';
            x.beginPath(); x.moveTo(128, 120); x.lineTo(60, 200); x.lineTo(110, 195); x.lineTo(128, 300); x.lineTo(146, 195); x.lineTo(196, 200); x.closePath(); x.fill();
            x.beginPath(); x.arc(128, 115, 18, 0, Math.PI * 2); x.fill();
        } else if (pattern === 'laurel') {
            x.strokeStyle = 'rgba(230,190,70,0.95)'; x.lineWidth = 8;
            x.beginPath(); x.arc(128, 240, 70, Math.PI * 0.6, Math.PI * 2.4); x.stroke();
            x.font = 'bold 60px Georgia'; x.fillStyle = 'rgba(230,190,70,0.95)'; x.textAlign = 'center'; x.fillText('SPQG', 128, 262);
        }
        noiseFill(x, 256, 512, [0, 0, 0], 0, 1500, 1, 2, 0.06);
        return (cache[key] = tex(c, 1, 1));
    };

    T.skin = function () {
        if (cache.skin) return cache.skin;
        const c = canvas(64, 64), x = c.getContext('2d');
        x.fillStyle = '#c99a72'; x.fillRect(0, 0, 64, 64);
        noiseFill(x, 64, 64, [190, 140, 100], 30, 400, 1, 2, 0.3);
        return (cache.skin = tex(c, 1, 1));
    };

    /** Cartel con texto (para estaciones de compra). Devuelve {texture, canvas, draw(lines)} */
    T.label = function (w, h) {
        const c = canvas(w || 512, h || 256), x = c.getContext('2d');
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        return {
            texture: t, canvas: c,
            draw(lines, accent) {
                x.clearRect(0, 0, c.width, c.height);
                x.fillStyle = 'rgba(18,10,4,0.82)';
                roundRect(x, 6, 6, c.width - 12, c.height - 12, 18); x.fill();
                x.strokeStyle = accent || '#d4af37'; x.lineWidth = 6; roundRect(x, 6, 6, c.width - 12, c.height - 12, 18); x.stroke();
                x.textAlign = 'center'; x.textBaseline = 'middle';
                const n = lines.length;
                lines.forEach((ln, i) => {
                    x.font = (i === 0 ? 'bold 64px ' : '44px ') + 'Georgia, serif';
                    x.fillStyle = i === 0 ? '#f6dfa0' : (ln.color || '#ffffff');
                    const txt = typeof ln === 'string' ? ln : ln.text;
                    x.fillText(txt, c.width / 2, c.height * (i + 1) / (n + 1));
                });
                t.needsUpdate = true;
            }
        };
    };

    function roundRect(x, X, Y, W, H, r) {
        x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + W, Y, X + W, Y + H, r); x.arcTo(X + W, Y + H, X, Y + H, r);
        x.arcTo(X, Y + H, X, Y, r); x.arcTo(X, Y, X + W, Y, r); x.closePath();
    }

    T.nameTag = function (text, color) {
        const c = canvas(256, 64), x = c.getContext('2d');
        x.font = 'bold 34px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
        x.lineWidth = 6; x.strokeStyle = 'rgba(0,0,0,0.85)'; x.strokeText(text, 128, 32);
        x.fillStyle = color || '#ffffff'; x.fillText(text, 128, 32);
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
        return t;
    };

    T.radial = function () {
        if (cache.radial) return cache.radial;
        const c = canvas(64, 64), x = c.getContext('2d');
        const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.fillRect(0, 0, 64, 64);
        const t = new THREE.CanvasTexture(c);
        return (cache.radial = t);
    };

    T.bloodDecal = function () {
        if (cache.blood) return cache.blood;
        const c = canvas(128, 128), x = c.getContext('2d');
        x.fillStyle = 'rgba(90,6,6,0.9)';
        for (let i = 0; i < 14; i++) {
            x.beginPath();
            x.arc(64 + (Math.random() - 0.5) * 60, 64 + (Math.random() - 0.5) * 60, 4 + Math.random() * 18, 0, Math.PI * 2);
            x.fill();
        }
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
        return (cache.blood = t);
    };

    /** Mapa de normales a partir de la luminancia de una textura de canvas (relieve barato) */
    T.normalFrom = function (srcTex, strength, invert) {
        const key = 'n' + srcTex.uuid + strength;
        if (cache[key]) return cache[key];
        const src = srcTex.image, w = src.width, h = src.height;
        const sctx = src.getContext('2d');
        const d = sctx.getImageData(0, 0, w, h).data;
        const lum = new Float32Array(w * h);
        for (let i = 0; i < w * h; i++) lum[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) / 255;
        const c = canvas(w, h), x = c.getContext('2d');
        const out = x.createImageData(w, h);
        const st = strength || 2, sg = invert ? -1 : 1;
        for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
            const l = lum[yy * w + ((xx - 1 + w) % w)], r = lum[yy * w + ((xx + 1) % w)];
            const u = lum[((yy - 1 + h) % h) * w + xx], dn = lum[((yy + 1) % h) * w + xx];
            let nx = (l - r) * st * sg, ny = (u - dn) * st * sg, nz = 1;
            const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
            const o = (yy * w + xx) * 4;
            out.data[o] = (nx * 0.5 + 0.5) * 255; out.data[o + 1] = (ny * 0.5 + 0.5) * 255; out.data[o + 2] = (nz * 0.5 + 0.5) * 255; out.data[o + 3] = 255;
        }
        x.putImageData(out, 0, 0);
        const t = new THREE.CanvasTexture(c);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.copy(srcTex.repeat);
        t.anisotropy = 4;
        return (cache[key] = t);
    };

    /** Arena con huellas, surcos de rastrillo y manchas oscuras */
    T.sandDetail = function () {
        if (cache.sandDetail) return cache.sandDetail;
        const base = T.sand();
        const x = base.image.getContext('2d');
        // surcos
        x.strokeStyle = 'rgba(120,85,45,0.16)'; x.lineWidth = 2;
        for (let i = 0; i < 24; i++) {
            const y0 = Math.random() * 512;
            x.beginPath(); x.moveTo(0, y0);
            for (let k = 1; k <= 8; k++) x.lineTo(k * 64, y0 + Math.sin(k + i) * 6);
            x.stroke();
        }
        // huellas
        x.fillStyle = 'rgba(105,72,38,0.22)';
        for (let i = 0; i < 60; i++) {
            const px = Math.random() * 512, py = Math.random() * 512, a = Math.random() * 6.28;
            x.save(); x.translate(px, py); x.rotate(a);
            x.beginPath(); x.ellipse(0, 0, 4, 9, 0, 0, Math.PI * 2); x.fill();
            x.beginPath(); x.ellipse(9, 14, 4, 9, 0, 0, Math.PI * 2); x.fill();
            x.restore();
        }
        base.needsUpdate = true;
        return (cache.sandDetail = base);
    };

    GL.Tex = T;
})();
