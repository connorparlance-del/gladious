/* =====================================================================
 *  GLADIADORES — CONFIGURACIÓN CENTRAL
 *  Todos los valores de equilibrio, red y contenido viven aquí.
 *  Modifica este archivo para ajustar dificultad, daño, precios o red.
 * ===================================================================== */
window.GL = window.GL || {};

/* ---------------------------------------------------------------------
 *  RED — cambia aquí el servidor de señalización y los servidores ICE.
 *  Por defecto usa PeerJS Cloud (gratuito, sin garantías de servicio).
 *  Para usar un servidor propio (network/signaling-server.js o PeerServer
 *  oficial) cambia host/port/path/secure/key.
 *  También puedes sobrescribirlo sin tocar este archivo creando
 *  js/network-config.local.js (ver README) o con parámetros de URL:
 *    ?sig=mi-servidor.com&sigport=443&sigpath=/&sigkey=peerjs
 * ------------------------------------------------------------------- */
GL.NETWORK_CONFIG = {
    signaling: {
        host: '0.peerjs.com',  // PeerJS Cloud (gratuito)
        port: 443,
        path: '/',
        secure: true,
        key: 'peerjs',
        heartbeatMs: 5000,
        connectTimeoutMs: 12000
    },
    // STUN: descubre la IP pública. TURN: retransmite cuando P2P directo falla
    // (NAT simétrico, firewalls corporativos). TURN requiere credenciales propias.
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
        // Ejemplo TURN (rellena con tu proveedor, ver README):
        // { urls: ['turn:turn.ejemplo.com:3478?transport=udp', 'turns:turn.ejemplo.com:5349'],
        //   username: 'usuario', credential: 'clave' }
    ],
    iceTransportPolicy: 'all',   // 'relay' fuerza TURN (útil para probar TURN)
    idPrefix: 'gladiadores-v1',  // prefijo de los IDs de sala en el servidor
    codeLength: 5,
    codeAlphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
    maxPlayersCoop: 4,
    maxPlayersDuel: 2,
    joinTimeoutMs: 15000,
    pingIntervalMs: 1000,
    linkTimeoutMs: 6000,          // sin mensajes => enlace perdido
    reconnectWindowMs: 25000,     // tiempo para reconectar
    reconnectRetryMs: 3000,
    snapshotHz: 15,               // estado de enemigos (host -> clientes)
    playerStateHz: 20,            // estado propio (cliente -> host)
    fullSyncMs: 2000,             // estado completo fiable
    interpDelayMs: 110,           // retardo de interpolación
    maxSpeedTolerance: 1.6,       // antitrampas: tolerancia de velocidad
    hitDistanceTolerance: 1.75    // antitrampas: tolerancia de distancia en golpes
};

/* ---------------------------------------------------------------------
 *  JUEGO GENERAL
 * ------------------------------------------------------------------- */
GL.GAME_CONFIG = {
    fixedDt: 1 / 60,
    gravity: 22,
    player: {
        radius: 0.36,
        height: 1.78,
        crouchHeight: 1.15,
        eyeOffset: 0.1,            // ojos por debajo de la parte superior
        walkSpeed: 4.6,
        sprintSpeed: 7.4,
        crouchSpeed: 2.3,
        accel: 42,
        airAccel: 9,
        jumpSpeed: 7.0,
        stepHeight: 0.42,
        maxHp: 150,
        maxStamina: 100,
        staminaRegen: 22,          // por segundo
        staminaRegenDelay: 0.7,
        sprintCost: 14,            // por segundo
        jumpCost: 12,
        dodgeCost: 26,
        dodgeSpeed: 13,
        dodgeTime: 0.22,
        dodgeIframes: 0.2,
        blockStaminaPerDamage: 0.55,
        blockAngleDeg: 75,
        parryWindow: 0.22,
        hpRegenDelay: 5,
        hpRegenPerSec: 6,
        mouseSensitivity: 0.0022,
        fov: 78
    },
    armor: {   // armadura del jugador (duelo y supervivencia)
        ligera: { label: 'Ligera', reduction: 0.08, speedMult: 1.06 },
        media:  { label: 'Media',  reduction: 0.18, speedMult: 1.0 },
        pesada: { label: 'Pesada', reduction: 0.30, speedMult: 0.9 }
    },
    zones: {   // multiplicadores por zona del cuerpo
        head:  { mult: 2.0, label: 'CABEZA' },
        torso: { mult: 1.0, label: 'TORSO' },
        armL:  { mult: 0.65, label: 'BRAZO' },
        armR:  { mult: 0.65, label: 'BRAZO' },
        legL:  { mult: 0.7, label: 'PIERNA' },
        legR:  { mult: 0.7, label: 'PIERNA' }
    },
    critChance: 0.08,
    critMult: 1.6,
    downedBleedout: 30,          // cooperativo: segundos antes de morir caído
    reviveTime: 3,
    duel: { roundsToWin: 3, roundStartDelay: 3, roundEndDelay: 4 },
    quality: {
        shadows: true,
        shadowMapSize: 2048,
        pixelRatioMax: 1.25,
        crowdCount: 1400,
        torchLights: false,       // luces puntuales reales en antorchas (caras en GPUs modestas)
        maxParticles: 500
    }
};

/* ---------------------------------------------------------------------
 *  ARMAS
 *  type: 'melee' | 'bow' | 'crossbow' | 'throw'
 *  dmgLight/dmgHeavy: daño base. reach: largo de hoja (m).
 *  windup/active/recovery: tiempos (s) del ataque ligero. heavyMult escala los
 *  tiempos del pesado. weight afecta coste de stamina y velocidad al atacar.
 *  arc: tipo de trayectoria ('slash' | 'thrust' | 'overhead').
 * ------------------------------------------------------------------- */
GL.WEAPON_CONFIG = {
    dagger: {
        name: 'Daga', type: 'melee', price: 250, slot: 'melee',
        dmgLight: 30, dmgHeavy: 58, reach: 0.42, handOffset: 0.48,
        windup: 0.07, active: 0.12, recovery: 0.14, heavyMult: 1.5,
        weight: 0.6, staminaLight: 7, staminaHeavy: 16, critBonus: 0.12,
        lightArc: 'thrust', heavyArc: 'slash', blockMult: 0.45,
        special: { name: 'Puñalada trasera', desc: 'x2.5 de daño por la espalda' }
    },
    gladius: {
        name: 'Gladius', type: 'melee', price: 500, slot: 'melee',
        dmgLight: 40, dmgHeavy: 75, reach: 0.7, handOffset: 0.48,
        windup: 0.1, active: 0.14, recovery: 0.2, heavyMult: 1.45,
        weight: 0.8, staminaLight: 9, staminaHeavy: 20, critBonus: 0.05,
        lightArc: 'thrust', heavyArc: 'slash', blockMult: 0.75,
        special: { name: 'Doble estocada', desc: 'Dos estocadas rápidas' }
    },
    longsword: {
        name: 'Espada larga', type: 'melee', price: 900, slot: 'melee',
        dmgLight: 50, dmgHeavy: 98, reach: 1.0, handOffset: 0.5,
        windup: 0.14, active: 0.16, recovery: 0.26, heavyMult: 1.5,
        weight: 1.1, staminaLight: 11, staminaHeavy: 24, critBonus: 0.03,
        lightArc: 'slash', heavyArc: 'overhead', blockMult: 0.85,
        special: { name: 'Corte giratorio', desc: 'Barrido de 360°' }
    },
    greatsword: {
        name: 'Espada pesada', type: 'melee', price: 1800, slot: 'melee',
        dmgLight: 78, dmgHeavy: 162, reach: 1.35, handOffset: 0.5,
        windup: 0.26, active: 0.2, recovery: 0.42, heavyMult: 1.45,
        weight: 1.8, staminaLight: 17, staminaHeavy: 34, critBonus: 0.0,
        lightArc: 'slash', heavyArc: 'overhead', blockMult: 0.9,
        special: { name: 'Onda de choque', desc: 'Golpe al suelo en área' }
    },
    axe: {
        name: 'Hacha', type: 'melee', price: 750, slot: 'melee',
        dmgLight: 55, dmgHeavy: 105, reach: 0.78, handOffset: 0.5,
        windup: 0.16, active: 0.15, recovery: 0.28, heavyMult: 1.45,
        weight: 1.2, staminaLight: 12, staminaHeavy: 25, critBonus: 0.05,
        lightArc: 'slash', heavyArc: 'overhead', blockMult: 0.6, shieldBreak: 1.6,
        special: { name: 'Torbellino', desc: 'Giro que golpea a todos' }
    },
    heavyaxe: {
        name: 'Hacha pesada', type: 'melee', price: 1600, slot: 'melee',
        dmgLight: 82, dmgHeavy: 175, reach: 1.1, handOffset: 0.5,
        windup: 0.3, active: 0.2, recovery: 0.45, heavyMult: 1.4,
        weight: 1.9, staminaLight: 18, staminaHeavy: 36, critBonus: 0.04,
        lightArc: 'slash', heavyArc: 'overhead', blockMult: 0.7, shieldBreak: 2.2,
        special: { name: 'Torbellino', desc: 'Giro que golpea a todos' }
    },
    mace: {
        name: 'Maza', type: 'melee', price: 800, slot: 'melee',
        dmgLight: 50, dmgHeavy: 100, reach: 0.72, handOffset: 0.5,
        windup: 0.15, active: 0.15, recovery: 0.26, heavyMult: 1.45,
        weight: 1.2, staminaLight: 12, staminaHeavy: 24, critBonus: 0.02,
        lightArc: 'slash', heavyArc: 'overhead', blockMult: 0.65, stagger: 1.6, armorPierce: 0.5,
        special: { name: 'Aturdir', desc: 'El próximo golpe aturde' }
    },
    hammer: {
        name: 'Martillo de guerra', type: 'melee', price: 1400, slot: 'melee',
        dmgLight: 70, dmgHeavy: 148, reach: 1.0, handOffset: 0.5,
        windup: 0.26, active: 0.18, recovery: 0.4, heavyMult: 1.4,
        weight: 1.7, staminaLight: 16, staminaHeavy: 32, critBonus: 0.0,
        lightArc: 'overhead', heavyArc: 'overhead', blockMult: 0.7, stagger: 2.2, armorPierce: 0.7, shieldBreak: 2.0,
        special: { name: 'Terremoto', desc: 'Golpe al suelo que aturde' }
    },
    spear: {
        name: 'Lanza', type: 'melee', price: 1000, slot: 'melee',
        dmgLight: 45, dmgHeavy: 88, reach: 1.75, handOffset: 0.35,
        windup: 0.13, active: 0.14, recovery: 0.24, heavyMult: 1.5,
        weight: 1.1, staminaLight: 10, staminaHeavy: 22, critBonus: 0.06,
        lightArc: 'thrust', heavyArc: 'thrust', blockMult: 0.55,
        special: { name: 'Embestida', desc: 'Carga hacia delante con la lanza' }
    },
    bow: {
        name: 'Arco', type: 'bow', price: 1200, slot: 'ranged',
        dmgLight: 38, dmgHeavy: 119, projectileSpeed: 48, drawTime: 0.85,
        ammo: 30, magazine: 1, reload: 0.35, weight: 0.7, critBonus: 0.08,
        projectile: 'arrow', gravityScale: 0.45, blockMult: 0.2,
        special: { name: 'Lluvia', desc: 'Tres flechas en abanico' }
    },
    crossbow: {
        name: 'Ballesta', type: 'crossbow', price: 1500, slot: 'ranged',
        dmgLight: 138, dmgHeavy: 138, projectileSpeed: 70, drawTime: 0,
        ammo: 20, magazine: 1, reload: 1.5, weight: 1.2, critBonus: 0.06,
        projectile: 'bolt', gravityScale: 0.2, blockMult: 0.25,
        special: { name: 'Virote perforante', desc: 'Atraviesa enemigos' }
    },
    javelin: {
        name: 'Jabalinas', type: 'throw', price: 1000, slot: 'ranged',
        dmgLight: 106, dmgHeavy: 106, projectileSpeed: 30, drawTime: 0.35,
        ammo: 8, magazine: 1, reload: 0.55, weight: 1.0, critBonus: 0.05,
        projectile: 'javelin', gravityScale: 0.8, blockMult: 0.3,
        special: { name: 'Lanzamiento potente', desc: 'Empala y empuja' }
    }
};
GL.WEAPON_ORDER = ['dagger', 'gladius', 'longsword', 'greatsword', 'axe', 'heavyaxe', 'mace', 'hammer', 'spear', 'bow', 'crossbow', 'javelin'];

/* ---------------------------------------------------------------------
 *  ENEMIGOS
 *  behavior: perfil de IA (ver js/ai/enemyAI.js)
 * ------------------------------------------------------------------- */
GL.ENEMY_CONFIG = {
    basic:    { name: 'Gladiador', hp: 90, dmg: 14, speed: 3.4, reach: 0.85, weapon: 'gladius', attackCd: 1.5, scale: 1.0, color: 0x9a3b2b, points: 60, behavior: 'melee', unlock: 1 },
    fast:     { name: 'Gladiador rápido', hp: 55, dmg: 10, speed: 5.8, reach: 0.6, weapon: 'dagger', attackCd: 0.95, scale: 0.92, color: 0x5d7a2a, points: 55, behavior: 'skirmish', unlock: 3 },
    shield:   { name: 'Escudero', hp: 120, dmg: 15, speed: 3.0, reach: 0.85, weapon: 'gladius', attackCd: 1.8, scale: 1.02, color: 0x34558a, points: 90, behavior: 'shield', shield: true, unlock: 4 },
    heavy:    { name: 'Gladiador pesado', hp: 260, dmg: 30, speed: 2.25, reach: 1.15, weapon: 'heavyaxe', attackCd: 2.6, scale: 1.2, color: 0x4a4a4a, points: 120, behavior: 'heavy', staggerResist: 0.75, unlock: 5 },
    archer:   { name: 'Arquero', hp: 65, dmg: 13, speed: 3.6, reach: 22, weapon: 'bow', attackCd: 2.3, scale: 0.97, color: 0x7a6224, points: 80, behavior: 'archer', ranged: true, unlock: 5 },
    spear:    { name: 'Lancero', hp: 95, dmg: 17, speed: 3.2, reach: 1.9, weapon: 'spear', attackCd: 1.7, scale: 1.0, color: 0x8a5a2a, points: 80, behavior: 'spear', unlock: 6 },
    berserker:{ name: 'Berserker', hp: 150, dmg: 22, speed: 4.8, reach: 0.9, weapon: 'axe', attackCd: 0.9, scale: 1.08, color: 0x6e1414, points: 110, behavior: 'berserk', unlock: 8 }
};
GL.ELITE_CONFIG = { hpMult: 2.4, dmgMult: 1.4, speedMult: 1.12, pointsMult: 2.5, scale: 1.1, emissive: 0xffaa22 };

/* ---------------------------------------------------------------------
 *  JEFES — añadir un jefe nuevo: crea una entrada aquí y su patrón de
 *  ataques en js/ai/bosses.js (BOSS_BEHAVIORS).
 * ------------------------------------------------------------------- */
GL.BOSS_CONFIG = {
    champion: {
        name: 'EL CAMPEÓN DEL COLISEO', hp: 2600, dmg: 28, speed: 3.6, reach: 1.25, weapon: 'longsword',
        scale: 1.45, color: 0xb08a2a, points: 2000, shield: true,
        phases: [1.0, 0.66, 0.33], intro: 'Invicto en cien combates. Hoy busca su victoria ciento uno.'
    },
    executioner: {
        name: 'EL VERDUGO', hp: 3400, dmg: 38, speed: 3.0, reach: 1.5, weapon: 'heavyaxe',
        scale: 1.55, color: 0x2b2b2b, points: 2500,
        phases: [1.0, 0.6, 0.3], intro: 'Su hacha nunca ha necesitado un segundo golpe.'
    }
};
GL.BOSS_ROTATION = ['champion', 'executioner'];

/* ---------------------------------------------------------------------
 *  RONDAS — la dificultad se calcula dinámicamente (rondas infinitas).
 * ------------------------------------------------------------------- */
GL.ROUND_CONFIG = {
    intermission: 9,          // segundos entre rondas
    firstDelay: 4,
    bossEvery: 10,
    baseCount: 5,
    countPerRound: 1.7,
    countQuad: 0.035,
    coopCountMult: 0.55,      // +55% de enemigos por jugador extra
    maxAliveBase: 7,
    maxAliveCap: 22,
    roundBonusPoints: 100
};

/**
 * Calcula la dificultad de una ronda cualquiera (1..∞).
 * Devuelve todos los parámetros que usa WaveManager.
 */
GL.calculateDifficulty = function (round, playerCount) {
    const r = Math.max(1, round | 0);
    const rc = GL.ROUND_CONFIG;
    const pc = Math.max(1, playerCount || 1);
    const k = r - 1;
    const isBoss = r % rc.bossEvery === 0;

    let enemyCount = Math.round((rc.baseCount + k * rc.countPerRound + k * k * rc.countQuad) * (1 + (pc - 1) * rc.coopCountMult));
    if (isBoss) enemyCount = Math.round(enemyCount * 0.45);

    // Curva suave: crecimiento lineal + término cuadrático pequeño, con tope razonable
    const enemyHealth = 1 + 0.11 * k + 0.0025 * k * k;
    const enemyDamage = Math.min(3.2, 1 + 0.055 * k + 0.0008 * k * k);
    const enemySpeed = 1 + Math.min(0.32, 0.018 * k);
    const enemyAttackSpeed = 1 + Math.min(0.55, 0.025 * k);
    const enemySpawnRate = Math.max(0.55, 2.3 - 0.075 * k); // segundos entre spawns
    const aggression = Math.min(1, 0.35 + 0.045 * k);
    const maxAlive = Math.min(rc.maxAliveCap, rc.maxAliveBase + Math.floor(r / 2) + (pc - 1) * 3);
    const eliteChance = r < 7 ? 0 : Math.min(0.35, 0.025 * (r - 6));
    const bossChance = isBoss ? 1 : (r > 15 ? Math.min(0.25, 0.015 * (r - 15)) : 0); // mini-jefe élite

    // Pesos de tipos: aparecen en su ronda de desbloqueo y crecen poco a poco
    const enemyTypes = {};
    for (const key in GL.ENEMY_CONFIG) {
        const u = GL.ENEMY_CONFIG[key].unlock;
        if (r < u) continue;
        let w = key === 'basic' ? Math.max(1.2, 4 - k * 0.12) : Math.min(2.2, 0.9 + (r - u) * 0.18);
        if (key === 'archer') w = Math.min(w, 1.3);
        enemyTypes[key] = w;
    }

    return { round: r, enemyCount, enemyHealth, enemyDamage, enemySpeed, enemyAttackSpeed, enemySpawnRate, aggression, maxAlive, eliteChance, bossChance, enemyTypes, isBossRound: isBoss };
};

/* ---------------------------------------------------------------------
 *  PUNTOS Y TIENDA
 * ------------------------------------------------------------------- */
GL.POINTS_CONFIG = {
    startPoints: 500,
    hit: 10,
    crit: 5,
    headshotKill: 50,
    streakWindow: 4,      // segundos para encadenar bajas
    streakBonus: 25,      // por baja encadenada (x nivel de racha, tope 8)
    revive: 150,
    sharedPoints: false   // true = un único fondo común de puntos para el equipo
};

// Altares de mejora (compras físicas en el coliseo)
GL.SHOP_CONFIG = {
    upgrades: {
        vitality:  { name: 'Altar del Toro', desc: '+60 de vida máxima', price: 2000, maxLevel: 2 },
        iron:      { name: 'Altar de Hierro', desc: '+12% reducción de daño', price: 2500, maxLevel: 2 },
        fury:      { name: 'Altar de la Furia', desc: '+20% daño cuerpo a cuerpo', price: 3000, maxLevel: 2 },
        wind:      { name: 'Altar del Viento', desc: '+10% velocidad y +35 stamina', price: 2000, maxLevel: 1 },
        heal:      { name: 'Fuente de Vida', desc: 'Cura toda la vida', price: 400, maxLevel: 999 }
    },
    ammoRefillFactor: 0.5,     // comprar munición = 50% del precio del arma
    gates: {
        east: { name: 'Galería Este', price: 1000 },
        west: { name: 'Galería Oeste', price: 1250 }
    }
};
