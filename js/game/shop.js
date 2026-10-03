/* ShopSystem — compras físicas en el coliseo: armas en las paredes, altares de mejora,
 * fuente de curación y puertas de las galerías. El cliente sólo SOLICITA la compra;
 * el host valida distancia, puntos y estado, y aplica el resultado. */
(function () {
    const U = GL.U;

    class Shop {
        constructor(arena) {
            this.arena = arena;
            this.stations = [];
            for (const w of arena.wallBuys) this.stations.push({ id: w.id, kind: 'weapon', weapon: w.weapon, pos: w.pos, normal: w.normal, zone: w.pos.x > 26 ? 'east' : w.pos.x < -26 ? 'west' : 'main' });
            for (const a of arena.altars) this.stations.push({ id: a.id, kind: 'upgrade', upgrade: a.upgrade, pos: a.pos.clone(), zone: a.pos.x > 26 ? 'east' : a.pos.x < -26 ? 'west' : 'main' });
            for (const id in arena.gates) this.stations.push({ id: 'gate_' + id, kind: 'gate', gate: id, pos: arena.gates[id].pos.clone(), zone: 'main' });
            this.byId = new Map(this.stations.map((s) => [s.id, s]));
        }

        /** Estación más cercana interactuable desde pos (con altura) */
        nearest(pos, fwd) {
            let best = null, bd = 2.4;
            for (const s of this.stations) {
                if (s.kind === 'gate' && this.arena.gates[s.gate].open) continue;
                const dy = Math.abs((s.pos.y || 0) - pos.y);
                if (dy > 1.2) continue;
                const d = Math.hypot(s.pos.x - pos.x, s.pos.z - pos.z);
                const lim = s.kind === 'weapon' ? 1.9 : s.kind === 'gate' ? 2.4 : 2.1;
                if (d > lim || d > bd) continue;
                if (fwd && s.kind !== 'weapon') {
                    const dx = s.pos.x - pos.x, dz = s.pos.z - pos.z, l = Math.hypot(dx, dz) || 1;
                    if ((dx * fwd.x + dz * fwd.z) / l < -0.2 && d > 0.9) continue;
                }
                bd = d; best = s;
            }
            return best;
        }

        price(s, ent) {
            if (s.kind === 'weapon') {
                const cfg = GL.WEAPON_CONFIG[s.weapon];
                const owned = ent.slots && ent.slots.some((x) => x && x.id === s.weapon);
                if (owned) return cfg.type === 'melee' ? 0 : Math.round(cfg.price * GL.SHOP_CONFIG.ammoRefillFactor);
                return cfg.price;
            }
            if (s.kind === 'upgrade') return GL.SHOP_CONFIG.upgrades[s.upgrade].price;
            if (s.kind === 'gate') return GL.SHOP_CONFIG.gates[s.gate].price;
            return 0;
        }

        /** Texto de la indicación en pantalla */
        promptFor(s, ent) {
            const p = this.price(s, ent);
            if (s.kind === 'weapon') {
                const cfg = GL.WEAPON_CONFIG[s.weapon];
                const owned = ent.slots && ent.slots.some((x) => x && x.id === s.weapon);
                if (owned && cfg.type === 'melee') return { text: cfg.name.toUpperCase() + ' — YA EQUIPADA', can: false };
                if (owned) return { text: '[E] MUNICIÓN ' + cfg.name.toUpperCase() + ' — ' + p, can: ent.points >= p };
                return { text: '[E] COMPRAR ' + cfg.name.toUpperCase() + ' — ' + p, can: ent.points >= p };
            }
            if (s.kind === 'upgrade') {
                const u = GL.SHOP_CONFIG.upgrades[s.upgrade];
                const lvl = (ent.upgrades && ent.upgrades[s.upgrade]) || 0;
                if (s.upgrade === 'heal' && ent.hp >= ent.maxHp) return { text: u.name.toUpperCase() + ' — VIDA LLENA', can: false };
                if (lvl >= u.maxLevel) return { text: u.name.toUpperCase() + ' — MÁXIMO', can: false };
                return { text: '[E] ' + u.name.toUpperCase() + ' (' + u.desc + ') — ' + p, can: ent.points >= p };
            }
            if (s.kind === 'gate') return { text: '[E] ABRIR ' + GL.SHOP_CONFIG.gates[s.gate].name.toUpperCase() + ' — ' + p, can: ent.points >= p };
            return null;
        }

        /**
         * Validación y aplicación en el HOST.
         * ent: entidad autoritativa del jugador; wallet: { get(), spend(n) }
         * Devuelve { ok, reason, apply: {...} }
         */
        validate(stationId, ent, wallet) {
            const s = this.byId.get(stationId);
            if (!s) return { ok: false, reason: 'Estación desconocida' };
            if (!ent.alive || ent.downed) return { ok: false, reason: 'No disponible' };
            const d = Math.hypot(s.pos.x - ent.pos.x, s.pos.z - ent.pos.z);
            if (d > 3.2 || Math.abs((s.pos.y || 0) - ent.pos.y) > 1.6) return { ok: false, reason: 'Demasiado lejos' };
            if (s.zone !== 'main' && !this.arena.isZoneOpen(s.zone)) return { ok: false, reason: 'Zona cerrada' };
            const price = this.price(s, ent);
            if (s.kind === 'weapon') {
                const cfg = GL.WEAPON_CONFIG[s.weapon];
                const owned = ent.slots.some((x) => x && x.id === s.weapon);
                if (owned && cfg.type === 'melee') return { ok: false, reason: 'Ya la tienes' };
                if (wallet.get() < price) return { ok: false, reason: 'Puntos insuficientes' };
                wallet.spend(price);
                return { ok: true, price, apply: { kind: 'weapon', weapon: s.weapon, ammo: cfg.ammo || 0 } };
            }
            if (s.kind === 'upgrade') {
                const u = GL.SHOP_CONFIG.upgrades[s.upgrade];
                const lvl = ent.upgrades[s.upgrade] || 0;
                if (lvl >= u.maxLevel) return { ok: false, reason: 'Nivel máximo' };
                if (s.upgrade === 'heal' && ent.hp >= ent.maxHp) return { ok: false, reason: 'Vida llena' };
                if (wallet.get() < price) return { ok: false, reason: 'Puntos insuficientes' };
                wallet.spend(price);
                return { ok: true, price, apply: { kind: 'upgrade', upgrade: s.upgrade, level: lvl + 1 } };
            }
            if (s.kind === 'gate') {
                if (this.arena.gates[s.gate].open) return { ok: false, reason: 'Ya abierta' };
                if (wallet.get() < price) return { ok: false, reason: 'Puntos insuficientes' };
                wallet.spend(price);
                return { ok: true, price, apply: { kind: 'gate', gate: s.gate } };
            }
            return { ok: false, reason: '?' };
        }
    }
    GL.Shop = Shop;
})();
