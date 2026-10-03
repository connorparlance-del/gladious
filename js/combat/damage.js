/* DamageSystem — cálculo de daño autoritativo (lo ejecuta el host).
 * El cliente nunca envía cantidades de daño: sólo qué arma, qué tipo de ataque y qué zona. */
(function () {
    const U = GL.U;

    const Damage = {
        /**
         * @param o {
         *   weaponId, attackType: 'light'|'heavy'|'special'|'proj', zone, charge (0..1, arco),
         *   attackerMult (mejoras de daño), defender: { armorReduction, blocking, blockStartAge, hasShield,
         *   defWeapon, facingDot, stamina }, isBackstab, forceCrit, rng
         * }
         */
        compute(o) {
            const W = GL.WEAPON_CONFIG[o.weaponId] || { dmgLight: 10, dmgHeavy: 20, critBonus: 0 };
            const G = GL.GAME_CONFIG;
            const rng = o.rng || Math.random;
            let base;
            if (o.attackType === 'heavy') base = W.dmgHeavy;
            else if (o.attackType === 'special') base = W.dmgHeavy * 0.9;
            else if (o.attackType === 'proj') base = W.type === 'bow' ? U.lerp(W.dmgLight, W.dmgHeavy, U.clamp(o.charge || 0, 0, 1)) : W.dmgLight;
            else base = W.dmgLight;
            if (o.baseOverride != null) base = o.baseOverride;

            const zoneCfg = G.zones[o.zone] || G.zones.torso;
            let dmg = base * zoneCfg.mult * (o.attackerMult || 1);
            const crit = o.forceCrit || rng() < (G.critChance + (W.critBonus || 0) + (o.zone === 'head' ? 0.05 : 0));
            if (crit) dmg *= G.critMult;
            if (o.isBackstab) dmg *= o.weaponId === 'dagger' ? 2.5 : 1.3;

            // armadura (la maza y el martillo la atraviesan parcialmente)
            const d = o.defender || {};
            const armorRed = (d.armorReduction || 0) * (1 - (W.armorPierce || 0));
            dmg *= (1 - armorRed);

            // bloqueo / parada
            let blocked = false, parried = false, staminaCost = 0, blockedAmount = 0;
            const blockCos = Math.cos(G.player.blockAngleDeg * Math.PI / 180);
            if (d.blocking && (d.facingDot == null || d.facingDot > blockCos)) {
                if (o.attackType !== 'proj' && d.blockStartAge != null && d.blockStartAge < G.player.parryWindow) {
                    parried = true; blockedAmount = dmg; dmg = 0;
                } else {
                    const defW = GL.WEAPON_CONFIG[d.defWeapon] || {};
                    let eff = d.hasShield ? (o.attackType === 'proj' ? 0.9 : 0.95) : (defW.blockMult || 0.5);
                    if (o.attackType === 'proj' && !d.hasShield) eff *= 0.4;
                    eff /= (W.shieldBreak || 1);
                    eff = U.clamp(eff, 0, 0.95);
                    blockedAmount = dmg * eff;
                    staminaCost = blockedAmount * G.player.blockStaminaPerDamage;
                    // sin stamina el bloqueo se rompe
                    if (d.stamina != null && d.stamina < staminaCost) { eff *= 0.3; blockedAmount = dmg * eff; staminaCost = d.stamina; }
                    dmg -= blockedAmount; blocked = true;
                }
            }

            let stagger = 0;
            if (!blocked && !parried) {
                if (o.attackType === 'heavy' || o.attackType === 'special') stagger = 0.45 * (W.stagger || 1);
                else if (W.stagger) stagger = 0.2 * W.stagger;
                if (o.zone === 'head') stagger += 0.15;
            } else if (blocked && (W.shieldBreak || 1) > 1.5 && o.attackType === 'heavy') stagger = 0.35;

            return { amount: Math.max(0, Math.round(dmg)), crit, blocked, parried, staminaCost, stagger, zone: o.zone };
        }
    };
    GL.Damage = Damage;
})();
