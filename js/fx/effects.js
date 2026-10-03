/* Efectos: partículas en un único draw call (Points), manchas en el suelo, sacudidas. */
(function () {
    const U = GL.U;

    class Effects {
        constructor(scene) {
            this.scene = scene;
            const max = GL.GAME_CONFIG.quality.maxParticles;
            this.max = max;
            this.pos = new Float32Array(max * 3);
            this.col = new Float32Array(max * 3);
            this.size = new Float32Array(max);
            this.alpha = new Float32Array(max);
            this.vel = new Float32Array(max * 3);
            this.life = new Float32Array(max);
            this.maxLife = new Float32Array(max);
            this.grav = new Float32Array(max);
            this.drag = new Float32Array(max);
            this.cursor = 0;
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
            g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
            g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
            g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
            const mat = new THREE.ShaderMaterial({
                transparent: true, depthWrite: false,
                uniforms: { scale: { value: 600 } },
                vertexShader: 'attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float scale; void main(){ vC=color; vA=alpha; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = size * scale / max(0.5, -mv.z); gl_Position = projectionMatrix*mv; }',
                fragmentShader: 'varying vec3 vC; varying float vA; void main(){ vec2 c = gl_PointCoord-0.5; float d = dot(c,c); if(d>0.25) discard; gl_FragColor = vec4(vC, vA*(1.0-d*3.2)); }'
            });
            this.points = new THREE.Points(g, mat);
            this.points.frustumCulled = false;
            scene.add(this.points);
            this.mat = mat;

            // manchas de sangre en el suelo (pool)
            this.decals = [];
            const dg = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
            for (let i = 0; i < 40; i++) {
                const m = new THREE.Mesh(dg, new THREE.MeshBasicMaterial({ map: GL.Tex.bloodDecal(), transparent: true, depthWrite: false, opacity: 0 }));
                m.visible = false; m.renderOrder = 1;
                scene.add(m);
                this.decals.push({ mesh: m, life: 0 });
            }
            this.decalCursor = 0;
            this.shake = 0;
            this.rings = [];
        }

        setViewport(h) { this.mat.uniforms.scale.value = h * 0.6; }

        spawn(x, y, z, vx, vy, vz, r, g, b, size, life, grav, drag) {
            const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
            this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
            this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
            this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
            this.size[i] = size; this.life[i] = life; this.maxLife[i] = life; this.alpha[i] = 1;
            this.grav[i] = grav == null ? 9 : grav; this.drag[i] = drag || 0;
        }

        blood(p, dir, amount) {
            const n = Math.round(10 * (amount || 1));
            for (let k = 0; k < n; k++) {
                const s = U.rand(1.5, 4.5);
                this.spawn(p.x, p.y, p.z,
                    (dir ? dir.x * s : 0) + U.rand(-1.5, 1.5), U.rand(0.5, 3.5), (dir ? dir.z * s : 0) + U.rand(-1.5, 1.5),
                    U.rand(0.35, 0.6), 0.02, 0.02, U.rand(0.03, 0.07), U.rand(0.4, 0.9), 12, 0.5);
            }
            if (Math.random() < 0.7) this.decal(p.x + U.rand(-0.4, 0.4), p.z + U.rand(-0.4, 0.4), U.rand(0.5, 1.2) * (amount || 1));
        }

        sparks(p, n) {
            for (let k = 0; k < (n || 14); k++) {
                this.spawn(p.x, p.y, p.z, U.rand(-4, 4), U.rand(0, 5), U.rand(-4, 4), 1, U.rand(0.6, 0.9), 0.3, U.rand(0.02, 0.04), U.rand(0.2, 0.45), 14, 1);
            }
        }

        dust(p, n, spread) {
            const sp = spread || 1;
            for (let k = 0; k < (n || 10); k++) {
                this.spawn(p.x + U.rand(-0.3, 0.3) * sp, p.y + 0.05, p.z + U.rand(-0.3, 0.3) * sp, U.rand(-1.2, 1.2) * sp, U.rand(0.3, 1.5), U.rand(-1.2, 1.2) * sp, 0.75, 0.62, 0.45, U.rand(0.12, 0.28), U.rand(0.5, 1.1), -0.5, 2.5);
            }
        }

        fire(p, n) {
            for (let k = 0; k < (n || 6); k++) {
                this.spawn(p.x + U.rand(-0.5, 0.5), p.y + 0.2, p.z + U.rand(-0.5, 0.5), U.rand(-0.3, 0.3), U.rand(1.5, 3.5), U.rand(-0.3, 0.3), 1, U.rand(0.3, 0.6), 0.05, U.rand(0.1, 0.2), U.rand(0.3, 0.6), -2, 1);
            }
        }

        burst(p, color, n, speed) {
            const c = new THREE.Color(color);
            for (let k = 0; k < (n || 20); k++) {
                const a = Math.random() * Math.PI * 2, s = (speed || 4) * U.rand(0.5, 1);
                this.spawn(p.x, p.y, p.z, Math.cos(a) * s, U.rand(0.5, 3), Math.sin(a) * s, c.r, c.g, c.b, U.rand(0.05, 0.12), U.rand(0.4, 0.9), 4, 1.5);
            }
        }

        /** Onda expansiva en el suelo */
        shockwave(p, radius, color) {
            const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: color || 0xffd28a, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
            m.position.set(p.x, (p.y || 0) + 0.05, p.z);
            this.scene.add(m);
            this.rings.push({ mesh: m, t: 0, dur: 0.45, radius: radius || 4 });
            this.dust(p, 30, radius / 2);
        }

        decal(x, z, size) {
            const d = this.decals[this.decalCursor]; this.decalCursor = (this.decalCursor + 1) % this.decals.length;
            d.mesh.visible = true; d.mesh.position.set(x, 0.02 + Math.random() * 0.01, z);
            d.mesh.scale.set(size, 1, size); d.mesh.rotation.y = Math.random() * 6.28;
            d.life = 20; d.mesh.material.opacity = 0.85;
        }

        addShake(v) { this.shake = Math.min(1.2, this.shake + v); }

        update(dt) {
            for (let i = 0; i < this.max; i++) {
                if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
                this.life[i] -= dt;
                const i3 = i * 3;
                const dr = Math.max(0, 1 - this.drag[i] * dt);
                this.vel[i3] *= dr; this.vel[i3 + 2] *= dr;
                this.vel[i3 + 1] -= this.grav[i] * dt;
                this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
                if (this.pos[i3 + 1] < 0.02) { this.pos[i3 + 1] = 0.02; this.vel[i3 + 1] *= -0.2; this.vel[i3] *= 0.6; this.vel[i3 + 2] *= 0.6; }
                this.alpha[i] = Math.min(1, this.life[i] / this.maxLife[i] * 2);
            }
            const g = this.points.geometry;
            g.attributes.position.needsUpdate = true; g.attributes.alpha.needsUpdate = true;
            g.attributes.color.needsUpdate = true; g.attributes.size.needsUpdate = true;
            for (const d of this.decals) {
                if (d.life <= 0) continue;
                d.life -= dt;
                if (d.life < 4) d.mesh.material.opacity = Math.max(0, d.life / 4) * 0.85;
                if (d.life <= 0) d.mesh.visible = false;
            }
            for (let i = this.rings.length - 1; i >= 0; i--) {
                const r = this.rings[i]; r.t += dt;
                const k = r.t / r.dur;
                r.mesh.scale.setScalar(0.3 + k * r.radius);
                r.mesh.material.opacity = 0.85 * (1 - k);
                if (k >= 1) { this.scene.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); this.rings.splice(i, 1); }
            }
            this.shake = Math.max(0, this.shake - dt * 2.5);
        }
    }
    GL.Effects = Effects;
})();
