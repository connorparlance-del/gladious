/* Proyectiles (flechas, virotes, jabalinas, hachas lanzadas) con pooling.
 * Cada proyectil tiene un "detector" (el cliente que decide impactos):
 *  - proyectiles de jugadores: el cliente del tirador (favor-the-shooter) y el host valida;
 *  - proyectiles de enemigos: el host. */
(function () {
    const U = GL.U;
    const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), dir = new THREE.Vector3();

    class Projectiles {
        constructor(scene, physics, fx) {
            this.scene = scene; this.physics = physics; this.fx = fx;
            this.list = [];
            this.stuck = [];
            this.pools = {};
            this.byId = new Map();
        }

        _mesh(kind) {
            const pool = this.pools[kind] || (this.pools[kind] = []);
            const m = pool.pop() || GL.WeaponModels.projectile(kind);
            m.visible = true;
            this.scene.add(m);
            return m;
        }
        _release(kind, m) { this.scene.remove(m); (this.pools[kind] = this.pools[kind] || []).push(m); }

        /**
         * o: { id, kind, owner, team ('players'|'enemies'), weaponId, origin, dir, speed, gravityScale,
         *      charge, pierce, detect (bool), dmgOverride }
         */
        spawn(o) {
            if (this.byId.has(o.id)) return null;
            const p = Object.assign({ life: 4, pierceLeft: o.pierce || 0, hitIds: new Set(), radius: o.kind === 'javelin' ? 0.07 : o.kind === 'axe' ? 0.18 : 0.04 }, o);
            p.pos = new THREE.Vector3(o.origin.x, o.origin.y, o.origin.z);
            p.vel = new THREE.Vector3(o.dir.x, o.dir.y, o.dir.z).normalize().multiplyScalar(o.speed);
            p.mesh = this._mesh(o.kind);
            p.mesh.position.copy(p.pos);
            p.mesh.lookAt(p.pos.clone().add(p.vel));
            this.list.push(p);
            this.byId.set(p.id, p);
            return p;
        }

        remove(id, stickAt) {
            const p = this.byId.get(id);
            if (!p) return;
            p.dead = true;
            if (stickAt) p.mesh.position.copy(stickAt);
        }

        /**
         * update(dt, targetsFor(team) => [{id, hitboxes}], onHit(p, hit), onWorld(p, point))
         */
        update(dt, targetsFor, onHit) {
            const G = GL.GAME_CONFIG.gravity;
            for (let i = this.list.length - 1; i >= 0; i--) {
                const p = this.list[i];
                if (p.dead) { this._finish(i, p, false); continue; }
                p.life -= dt;
                if (p.life <= 0) { this._finish(i, p, false); continue; }
                p0.copy(p.pos);
                p.vel.y -= G * (p.gravityScale || 0.5) * dt;
                p1.copy(p.pos).addScaledVector(p.vel, dt);
                // impacto con el mundo
                dir.subVectors(p1, p0); const len = dir.length();
                let worldHit = null;
                if (len > 1e-5) { dir.divideScalar(len); worldHit = this.physics.raycast(p0, dir, len); }
                const segEnd = worldHit ? new THREE.Vector3(worldHit.point.x, worldHit.point.y, worldHit.point.z) : p1;
                // impacto con objetivos (sólo si este cliente es el detector)
                let hit = null;
                if (p.detect && targetsFor) {
                    const targets = targetsFor(p.team, p.owner);
                    hit = GL.Hit.segmentVsTargets(p0, segEnd, p.radius, targets, p.hitIds);
                }
                if (hit) {
                    p.hitIds.add(hit.id);
                    if (onHit) onHit(p, hit);
                    if (hit.blockedByShield) { this.fx.sparks(hit.point, 10); p.dead = true; p.pos.copy(hit.point); this._finish(i, p, false); continue; }
                    if (p.pierceLeft > 0) { p.pierceLeft--; }
                    else { p.pos.copy(hit.point); this._finish(i, p, false); continue; }
                }
                if (worldHit) {
                    p.pos.copy(segEnd);
                    this.fx.dust(segEnd, 4, 0.3);
                    if (GL.game && GL.game.audio) GL.game.audio.play('arrowHit', { pos: segEnd, vol: 0.6 });
                    this._finish(i, p, true);
                    continue;
                }
                p.pos.copy(p1);
                p.mesh.position.copy(p.pos);
                p.mesh.lookAt(p.pos.x + p.vel.x, p.pos.y + p.vel.y, p.pos.z + p.vel.z);
            }
            for (let i = this.stuck.length - 1; i >= 0; i--) {
                const s = this.stuck[i]; s.t -= dt;
                if (s.t <= 0) { this._release(s.kind, s.mesh); this.stuck.splice(i, 1); }
            }
        }

        _finish(i, p, stick) {
            this.list.splice(i, 1);
            this.byId.delete(p.id);
            if (stick && p.kind !== 'axe') {
                p.mesh.position.copy(p.pos);
                this.stuck.push({ mesh: p.mesh, kind: p.kind, t: 8 });
                if (this.stuck.length > 40) { const s = this.stuck.shift(); this._release(s.kind, s.mesh); }
            } else this._release(p.kind, p.mesh);
        }

        clear() {
            for (const p of this.list) this._release(p.kind, p.mesh);
            for (const s of this.stuck) this._release(s.kind, s.mesh);
            this.list.length = 0; this.stuck.length = 0; this.byId.clear();
        }
    }
    GL.Projectiles = Projectiles;
})();
