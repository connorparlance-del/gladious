/* HitboxSystem — detección de impactos con barrido (swept) entre la posición anterior
 * y actual de la hoja, contra cápsulas por zona. Evita el "tunneling" de golpes rápidos. */
(function () {
    const U = GL.U;
    const sa = new THREE.Vector3(), sb = new THREE.Vector3(), tmp = { s: 0, t: 0 };

    const ZONE_PRIORITY = { head: 3, torso: 2, armL: 1, armR: 1, legL: 1, legR: 1, shield: 4 };

    const Hit = {
        /**
         * Barrido de una hoja (segmento con radio) desde (pA,pB) hasta (cA,cB).
         * targets: array de { id, hitboxes:[{zone,a,b,r}] }
         * exclude: Set de ids ya golpeados en este ataque.
         * Devuelve array de { id, zone, point, step, blockedByShield }
         */
        sweepBlade(pA, pB, cA, cB, bladeR, targets, exclude) {
            const moveA = pA.distanceTo(cA), moveB = pB.distanceTo(cB);
            const steps = Math.min(16, Math.max(1, Math.ceil(Math.max(moveA, moveB) / 0.06)));
            const results = [];
            for (let ti = 0; ti < targets.length; ti++) {
                const tg = targets[ti];
                if (exclude && exclude.has(tg.id)) continue;
                const hbs = tg.hitboxes;
                if (!hbs || !hbs.length) continue;
                let found = null;
                for (let i = 0; i <= steps && !found; i++) {
                    const f = i / steps;
                    sa.lerpVectors(pA, cA, f); sb.lerpVectors(pB, cB, f);
                    let best = null, bestScore = -1;
                    for (let h = 0; h < hbs.length; h++) {
                        const hb = hbs[h];
                        const rr = hb.r + bladeR;
                        const d2 = U.segSegDist2(sa, sb, hb.a, hb.b, tmp);
                        if (d2 > rr * rr) continue;
                        // la zona más "relevante": escudo > cabeza > torso > extremidades, desempate por distancia
                        const score = ZONE_PRIORITY[hb.zone] * 10 - Math.sqrt(d2);
                        if (score > bestScore) {
                            bestScore = score;
                            best = { id: tg.id, zone: hb.zone, point: new THREE.Vector3().lerpVectors(sa, sb, tmp.s), step: f };
                        }
                    }
                    if (best) found = best;
                }
                if (found) {
                    found.blockedByShield = found.zone === 'shield';
                    results.push(found);
                }
            }
            results.sort((x, y) => x.step - y.step);
            return results;
        },

        /** Segmento de proyectil (p0->p1, radio pr) contra hitboxes. Devuelve primer impacto o null */
        segmentVsTargets(p0, p1, pr, targets, exclude) {
            let best = null;
            for (const tg of targets) {
                if (exclude && exclude.has(tg.id)) continue;
                for (const hb of tg.hitboxes) {
                    const rr = hb.r + pr;
                    const d2 = U.segSegDist2(p0, p1, hb.a, hb.b, tmp);
                    if (d2 > rr * rr) continue;
                    const s = tmp.s;
                    const score = s - (hb.zone === 'shield' ? 0.02 : 0) - (hb.zone === 'head' ? 0.005 : 0);
                    if (!best || score < best.score) best = { id: tg.id, zone: hb.zone, point: new THREE.Vector3().lerpVectors(p0, p1, s), s, score, blockedByShield: hb.zone === 'shield' };
                }
            }
            return best;
        },

        /** Esfera (área) contra objetivos: devuelve ids dentro del radio (centro del torso) */
        sphere(center, radius, targets) {
            const out = [];
            for (const tg of targets) {
                const t = tg.hitboxes && tg.hitboxes[1];
                if (!t) continue;
                const mx = (t.a.x + t.b.x) / 2, my = (t.a.y + t.b.y) / 2, mz = (t.a.z + t.b.z) / 2;
                const d = Math.hypot(mx - center.x, (my - center.y) * 0.6, mz - center.z);
                if (d < radius + t.r) out.push({ id: tg.id, zone: 'torso', dist: d });
            }
            return out;
        }
    };

    /** Hitboxes para un jugador a partir de su estado (sin modelo animado). Para el host y el jugador local. */
    Hit.playerHitboxes = function (out, pos, yaw, crouch, scale) {
        const s = scale || 1;
        const h = crouch ? 0.68 : 1;
        if (!out.length) for (const z of ['head', 'torso', 'armL', 'armR', 'legL', 'legR']) out.push({ zone: z, a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0.1 });
        const cy = Math.cos(yaw), sy = Math.sin(yaw);
        const rx = cy, rz = -sy;           // vector derecha
        const set = (hb, x0, y0, x1, y1, r) => {
            hb.a.set(pos.x + rx * x0, pos.y + y0 * h * s, pos.z + rz * x0);
            hb.b.set(pos.x + rx * x1, pos.y + y1 * h * s, pos.z + rz * x1);
            hb.r = r * s;
        };
        set(out[0], 0, 1.62, 0, 1.69, 0.13);
        set(out[1], 0, 1.0, 0, 1.45, 0.21);
        set(out[2], -0.27, 1.43, -0.3, 0.95, 0.075);
        set(out[3], 0.27, 1.43, 0.3, 0.95, 0.075);
        set(out[4], -0.11, 0.92, -0.12, 0.08, 0.1);
        set(out[5], 0.11, 0.92, 0.12, 0.08, 0.1);
        return out;
    };

    GL.Hit = Hit;
})();
