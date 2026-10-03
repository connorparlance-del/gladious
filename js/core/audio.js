/* AudioManager — todos los sonidos son sintetizados (sin archivos con copyright) */
(function () {
    class AudioManager {
        constructor() {
            this.ctx = null;
            this.master = null;
            this.volume = GL.U.storage.get('volume', 0.7);
            this.listener = { pos: new THREE.Vector3(), yaw: 0 };
            this.lastPlay = {};
            this.crowd = null;
        }

        init() {
            if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            this.ctx = new AC();
            this.master = this.ctx.createGain();
            this.master.gain.value = this.volume;
            const comp = this.ctx.createDynamicsCompressor();
            comp.threshold.value = -14; comp.ratio.value = 4;
            this.master.connect(comp); comp.connect(this.ctx.destination);
            // buffers de ruido reutilizables
            this.noise = this._noiseBuffer(2.0, 'white');
            this.brown = this._noiseBuffer(4.0, 'brown');
            this._startCrowd();
        }

        setVolume(v) {
            this.volume = v; GL.U.storage.set('volume', v);
            if (this.master) this.master.gain.value = v;
        }

        _noiseBuffer(sec, kind) {
            const len = Math.floor(this.ctx.sampleRate * sec);
            const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
            const d = buf.getChannelData(0);
            let last = 0;
            for (let i = 0; i < len; i++) {
                const w = Math.random() * 2 - 1;
                if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
                else d[i] = w;
            }
            return buf;
        }

        setListener(pos, yaw) { this.listener.pos.copy(pos); this.listener.yaw = yaw; }

        /* volumen y paneo según posición 3D */
        _spatial(pos, maxDist) {
            if (!pos) return { gain: 1, pan: 0 };
            const dx = pos.x - this.listener.pos.x, dz = pos.z - this.listener.pos.z;
            const d = Math.hypot(dx, dz);
            const md = maxDist || 40;
            const gain = Math.max(0, 1 - d / md) ** 1.6;
            // proyección sobre el vector "derecha" de la cámara (yaw 0 mira a -Z)
            const yaw = this.listener.yaw;
            const right = d > 0.001 ? (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / d : 0;
            const pan = Math.max(-1, Math.min(1, right)) * Math.min(1, d / 2) * 0.85;
            return { gain, pan };
        }

        _out(opts) {
            const g = this.ctx.createGain();
            const sp = this._spatial(opts.pos, opts.maxDist);
            g.gain.value = (opts.vol == null ? 1 : opts.vol) * sp.gain;
            if (this.ctx.createStereoPanner) {
                const p = this.ctx.createStereoPanner();
                p.pan.value = sp.pan;
                g.connect(p); p.connect(this.master);
            } else g.connect(this.master);
            return { node: g, gain: sp.gain };
        }

        _osc(type, f0, f1, dur, vol, dest, t0, attack) {
            const c = this.ctx, t = t0 || c.currentTime;
            const o = c.createOscillator(), g = c.createGain();
            o.type = type;
            o.frequency.setValueAtTime(f0, t);
            if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(vol, t + (attack || 0.005));
            g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            o.connect(g); g.connect(dest);
            o.start(t); o.stop(t + dur + 0.05);
            return o;
        }

        _noise(dur, vol, filterType, f0, f1, dest, t0, q, buf) {
            const c = this.ctx, t = t0 || c.currentTime;
            const s = c.createBufferSource(); s.buffer = buf || this.noise;
            s.playbackRate.value = 0.8 + Math.random() * 0.4;
            const f = c.createBiquadFilter(); f.type = filterType || 'lowpass';
            f.frequency.setValueAtTime(f0, t);
            if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
            f.Q.value = q || 1;
            const g = c.createGain();
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
            g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            s.connect(f); f.connect(g); g.connect(dest);
            s.start(t, Math.random() * 1.0); s.stop(t + dur + 0.05);
        }

        play(name, opts) {
            if (!this.ctx || this.ctx.state !== 'running') return;
            opts = opts || {};
            // limitar repeticiones idénticas en el mismo instante
            const now = performance.now();
            const key = name + (opts.pos ? Math.round(opts.pos.x) + ',' + Math.round(opts.pos.z) : '');
            if (this.lastPlay[key] && now - this.lastPlay[key] < 35) return;
            this.lastPlay[key] = now;
            const out = this._out(opts);
            if (out.gain < 0.01) return;
            const d = out.node, t = this.ctx.currentTime, p = opts.pitch || 1;
            switch (name) {
                case 'swing':
                    this._noise(0.22, 0.35, 'bandpass', 900 * p, 2600 * p, d, t, 1.4); break;
                case 'swingHeavy':
                    this._noise(0.4, 0.45, 'bandpass', 400 * p, 1500 * p, d, t, 1.2); break;
                case 'hitFlesh':
                    this._noise(0.16, 0.7, 'lowpass', 1400, 200, d, t, 1);
                    this._osc('sine', 140, 55, 0.14, 0.5, d, t); break;
                case 'hitHead':
                    this._noise(0.18, 0.8, 'lowpass', 2600, 300, d, t, 2);
                    this._osc('square', 220, 70, 0.1, 0.25, d, t);
                    this._osc('sine', 90, 40, 0.2, 0.5, d, t); break;
                case 'hitMetal':
                case 'block':
                    this._osc('triangle', 1250 * p, 1100 * p, 0.35, 0.35, d, t);
                    this._osc('sine', 2730 * p, 2600 * p, 0.25, 0.18, d, t);
                    this._osc('sine', 3910 * p, 3800 * p, 0.18, 0.1, d, t);
                    this._noise(0.08, 0.5, 'highpass', 3000, 3000, d, t, 1); break;
                case 'parry':
                    this._osc('triangle', 1800, 1700, 0.6, 0.4, d, t);
                    this._osc('sine', 3600, 3500, 0.5, 0.2, d, t);
                    this._noise(0.1, 0.5, 'highpass', 4000, 4000, d, t, 1); break;
                case 'shieldHit':
                    this._noise(0.2, 0.8, 'lowpass', 900, 200, d, t, 2);
                    this._osc('sine', 180, 120, 0.2, 0.5, d, t); break;
                case 'bowDraw':
                    this._noise(0.5, 0.12, 'bandpass', 300, 700, d, t, 6); break;
                case 'bowRelease':
                    this._osc('triangle', 180, 90, 0.18, 0.5, d, t);
                    this._noise(0.25, 0.3, 'bandpass', 2400, 900, d, t, 2); break;
                case 'crossbow':
                    this._osc('square', 120, 60, 0.12, 0.35, d, t);
                    this._noise(0.12, 0.6, 'lowpass', 2500, 300, d, t, 1); break;
                case 'reload':
                    this._noise(0.08, 0.3, 'bandpass', 1800, 1800, d, t, 4);
                    this._noise(0.08, 0.3, 'bandpass', 2400, 2400, d, t + 0.25, 4); break;
                case 'throw':
                    this._noise(0.3, 0.4, 'bandpass', 600, 1800, d, t, 1); break;
                case 'arrowHit':
                    this._noise(0.1, 0.5, 'lowpass', 1500, 300, d, t, 1);
                    this._osc('triangle', 400, 200, 0.08, 0.2, d, t); break;
                case 'step':
                    this._noise(0.09, 0.18 * (opts.vol2 || 1), 'lowpass', 700 * p, 300, d, t, 1, this.brown); break;
                case 'jump':
                    this._noise(0.12, 0.25, 'lowpass', 600, 300, d, t, 1, this.brown); break;
                case 'land':
                    this._noise(0.16, 0.45, 'lowpass', 500, 120, d, t, 1, this.brown);
                    this._osc('sine', 90, 50, 0.12, 0.3, d, t); break;
                case 'hurt':
                    this._osc('sawtooth', 210 * p, 130 * p, 0.25, 0.18, d, t, 0.02);
                    this._noise(0.2, 0.25, 'bandpass', 700, 500, d, t, 3); break;
                case 'enemyHurt':
                    this._osc('sawtooth', 160 * p, 95 * p, 0.22, 0.14, d, t, 0.02);
                    this._noise(0.15, 0.2, 'bandpass', 600, 400, d, t, 3); break;
                case 'enemyDeath':
                    this._osc('sawtooth', 190 * p, 60 * p, 0.7, 0.18, d, t, 0.02);
                    this._noise(0.5, 0.25, 'bandpass', 500, 200, d, t, 2); break;
                case 'playerDeath':
                    this._osc('sawtooth', 160, 40, 1.4, 0.25, d, t, 0.05);
                    this._osc('sine', 80, 30, 1.6, 0.4, d, t); break;
                case 'buy':
                    this._osc('triangle', 988, 988, 0.12, 0.3, d, t);
                    this._osc('triangle', 1319, 1319, 0.25, 0.3, d, t + 0.09);
                    this._osc('sine', 1976, 1976, 0.3, 0.12, d, t + 0.09); break;
                case 'denied':
                    this._osc('square', 140, 130, 0.25, 0.15, d, t); break;
                case 'equip':
                    this._noise(0.12, 0.3, 'bandpass', 3000, 2000, d, t, 3);
                    this._osc('triangle', 700, 650, 0.1, 0.12, d, t + 0.05); break;
                case 'horn': this._horn(d, t, [196, 196, 262], 0.5); break;
                case 'hornLow': this._horn(d, t, [262, 196, 131], 0.6); break;
                case 'bossIntro':
                    this._horn(d, t, [98, 98, 147, 131], 0.9);
                    for (let i = 0; i < 6; i++) this._drum(d, t + 0.35 * i, i % 2 ? 0.5 : 0.9); break;
                case 'bossRoar':
                    this._osc('sawtooth', 110, 55, 1.2, 0.35, d, t, 0.08);
                    this._osc('sawtooth', 113, 57, 1.2, 0.25, d, t, 0.08);
                    this._noise(1.1, 0.5, 'lowpass', 900, 200, d, t, 2); break;
                case 'slam':
                    this._drum(d, t, 1.2);
                    this._noise(0.7, 0.8, 'lowpass', 600, 60, d, t, 1, this.brown); break;
                case 'drum': this._drum(d, t, opts.vol || 0.8); break;
                case 'gate':
                    for (let i = 0; i < 8; i++) this._noise(0.06, 0.25, 'bandpass', 1200 + Math.random() * 800, 900, d, t + i * 0.09, 6);
                    this._osc('sine', 70, 50, 0.9, 0.3, d, t); break;
                case 'cheer': this._cheer(1.0); break;
                case 'fire':
                    this._noise(0.5, 0.25, 'lowpass', 1200, 400, d, t, 1, this.brown); break;
                case 'ui':
                    this._osc('triangle', 660, 660, 0.06, 0.12, d, t); break;
                case 'hitmarker':
                    this._osc('square', 1600, 1600, 0.03, 0.06, d, t); break;
                case 'revive':
                    [523, 659, 784].forEach((f, i) => this._osc('triangle', f, f, 0.25, 0.2, d, t + i * 0.08)); break;
                case 'roundEnd':
                    this._horn(d, t, [262, 330, 392], 0.5); this._cheer(1.2); break;
                case 'victory':
                    this._horn(d, t, [262, 330, 392, 523], 0.7); this._cheer(1.5); break;
                default: break;
            }
        }

        _horn(dest, t, notes, vol) {
            const c = this.ctx;
            const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400; f.Q.value = 2;
            f.connect(dest);
            let tt = t;
            notes.forEach((n, i) => {
                const dur = i === notes.length - 1 ? 1.1 : 0.32;
                [1, 1.005, 0.997].forEach((det) => {
                    const o = c.createOscillator(); o.type = 'sawtooth';
                    o.frequency.setValueAtTime(n * det, tt);
                    const g = c.createGain();
                    g.gain.setValueAtTime(0.0001, tt);
                    g.gain.exponentialRampToValueAtTime(vol * 0.18, tt + 0.06);
                    g.gain.setValueAtTime(vol * 0.18, tt + dur - 0.08);
                    g.gain.exponentialRampToValueAtTime(0.0001, tt + dur);
                    o.connect(g); g.connect(f); o.start(tt); o.stop(tt + dur + 0.05);
                });
                tt += dur * 0.92;
            });
        }

        _drum(dest, t, vol) {
            this._osc('sine', 110, 40, 0.45, vol, dest, t);
            this._noise(0.12, vol * 0.4, 'lowpass', 800, 100, dest, t, 1, this.brown);
        }

        /* Ambiente del público: ruido marrón filtrado con modulación lenta */
        _startCrowd() {
            const c = this.ctx;
            const src = c.createBufferSource(); src.buffer = this.brown; src.loop = true;
            const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.7;
            const g = c.createGain(); g.gain.value = 0.0;
            const lfo = c.createOscillator(); lfo.frequency.value = 0.13;
            const lfoG = c.createGain(); lfoG.gain.value = 0.03;
            lfo.connect(lfoG); lfoG.connect(g.gain);
            src.connect(bp); bp.connect(g); g.connect(this.master);
            src.start(); lfo.start();
            this.crowd = { gain: g, filter: bp, base: 0.09 };
            g.gain.setTargetAtTime(this.crowd.base, c.currentTime, 2);
        }

        setCrowdLevel(level) {
            if (!this.crowd) return;
            this.crowd.base = 0.06 + level * 0.1;
            this.crowd.gain.gain.setTargetAtTime(this.crowd.base, this.ctx.currentTime, 1.5);
        }

        _cheer(amount) {
            if (!this.crowd) return;
            const g = this.crowd.gain.gain, t = this.ctx.currentTime;
            g.cancelScheduledValues(t);
            g.setTargetAtTime(this.crowd.base + 0.22 * amount, t, 0.15);
            g.setTargetAtTime(this.crowd.base, t + 1.4, 1.2);
            this.crowd.filter.frequency.setTargetAtTime(900, t, 0.2);
            this.crowd.filter.frequency.setTargetAtTime(520, t + 1.2, 1);
        }
    }
    GL.AudioManager = AudioManager;
})();
