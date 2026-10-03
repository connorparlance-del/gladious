/* WaveManager — rondas infinitas para Supervivencia (sólo en el host).
 * Usa GL.calculateDifficulty(round) para todo: cantidad, vida, daño, velocidad, ritmo de
 * aparición, tipos, élites y jefes. */
(function () {
    const U = GL.U;

    class WaveManager {
        constructor(match) {
            this.match = match;
            this.reset();
        }

        reset() {
            this.round = 0;
            this.state = 'idle';       // 'pre' | 'active' | 'intermission' | 'over'
            this.timer = 0;
            this.toSpawn = 0; this.spawned = 0; this.killed = 0;
            this.spawnTimer = 0;
            this.diff = null;
            this.bossPending = false;
            this.miniBossDone = false;
        }

        start() {
            this.reset();
            this.state = 'pre';
            this.timer = GL.ROUND_CONFIG.firstDelay;
            this.round = 1;
            this._prepare();
            this.match.onRoundState(this.publicState());
        }

        _prepare() {
            const pc = this.match.alivePlayerCount(true);
            this.diff = GL.calculateDifficulty(this.round, pc);
            this.toSpawn = this.diff.enemyCount;
            this.spawned = 0; this.killed = 0;
            this.spawnTimer = 0.5;
            this.bossPending = this.diff.isBossRound;
            this.miniBossDone = !(this.diff.bossChance > 0 && !this.diff.isBossRound && Math.random() < this.diff.bossChance);
        }

        /** Enemigos que faltan: por aparecer + vivos + jefe pendiente */
        get remaining() { return Math.max(0, this.toSpawn - this.spawned) + this.match.game.enemies.aliveCount + (this.bossPending ? 1 : 0); }

        publicState() {
            return { r: this.round, s: this.state, t: U.round(this.timer, 1), left: this.remaining, boss: this.diff && this.diff.isBossRound ? 1 : 0 };
        }

        bossAlive() { return !!this.match.game.enemies.boss(); }

        update(dt) {
            const m = this.match, em = m.game.enemies;
            if (this.state === 'pre' || this.state === 'intermission') {
                this.timer -= dt;
                if (this.timer <= 0) {
                    if (this.state === 'intermission') { this.round++; this._prepare(); }
                    this.state = 'active';
                    m.onRoundStart(this.round, this.diff);
                    m.onRoundState(this.publicState());
                }
                return;
            }
            if (this.state !== 'active') return;
            // jefe al inicio de su ronda
            if (this.bossPending && this.spawned >= Math.min(2, this.toSpawn)) {
                const bossId = GL.BOSS_ROTATION[(Math.floor(this.round / GL.ROUND_CONFIG.bossEvery) - 1) % GL.BOSS_ROTATION.length];
                const sp = m.pickSpawnPoint(true);
                if (sp) {
                    this.bossPending = false;
                    const e = em.spawn(null, sp, this.diff, { bossId, playerCount: m.alivePlayerCount(true) });
                    m.onBossSpawn(e);
                }
            }
            // generar enemigos respetando máximo simultáneo
            this.spawnTimer -= dt;
            if (this.spawned < this.toSpawn && this.spawnTimer <= 0 && em.aliveCount < this.diff.maxAlive) {
                const sp = m.pickSpawnPoint(false);
                if (sp) {
                    let type = U.weightedPick(this.diff.enemyTypes);
                    let elite = Math.random() < this.diff.eliteChance;
                    // mini-jefe: un élite pesado o berserker en rondas altas
                    if (!this.miniBossDone && this.spawned === Math.floor(this.toSpawn / 2)) { type = Math.random() < 0.5 ? 'heavy' : 'berserker'; elite = true; this.miniBossDone = true; }
                    em.spawn(type, sp, this.diff, { elite });
                    this.spawned++;
                    this.spawnTimer = this.diff.enemySpawnRate * U.rand(0.7, 1.3);
                } else this.spawnTimer = 0.4;
            }
            // fin de ronda
            if (this.spawned >= this.toSpawn && !this.bossPending && em.aliveCount === 0) {
                this.state = 'intermission';
                this.timer = GL.ROUND_CONFIG.intermission;
                m.onRoundEnd(this.round);
                m.onRoundState(this.publicState());
            }
        }

        onEnemyKilled(e) { if (!e.summoned && !e.bossId) this.killed++; }

        serialize() { return { round: this.round, state: this.state, timer: this.timer, toSpawn: this.toSpawn, spawned: this.spawned, killed: this.killed }; }
    }
    GL.WaveManager = WaveManager;
})();
