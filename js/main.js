/* =====================================================================
 *  GLADIADORES — arranque y bucle principal
 * ===================================================================== */
(function () {
    const U = GL.U;
    const $ = (id) => document.getElementById(id);

    class Game {
        constructor() {
            GL.game = this;
            this.events = new U.Emitter();
            GL.events = this.events;
            const canvas = $('game-canvas');
            this.canvas = canvas;
            const q = GL.GAME_CONFIG.quality;
            q.shadows = U.storage.get('shadows', true);
            this.renderer = new THREE.WebGLRenderer({ canvas, antialias: (window.devicePixelRatio || 1) < 1.5, powerPreference: 'high-performance', stencil: false });
            this.renderer.outputColorSpace = THREE.SRGBColorSpace;
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            this.renderer.toneMappingExposure = 1.05;
            this.renderer.shadowMap.enabled = q.shadows;
            this.renderer.shadowMap.type = THREE.PCFShadowMap;
            this.scene = new THREE.Scene();
            this.camera = new THREE.PerspectiveCamera(GL.GAME_CONFIG.player.fov, 1, 0.05, 600);
            this.camera.rotation.order = 'YXZ';
            this.scene.add(this.camera);

            this.audio = new GL.AudioManager();
            this.input = new GL.Input(canvas);
            this.physics = new GL.Physics();
            this.arena = new GL.Arena(this.scene, this.physics);
            this.nav = new GL.Nav(this.physics);
            this.fx = new GL.Effects(this.scene);
            this.projectiles = new GL.Projectiles(this.scene, this.physics, this.fx);
            this.enemies = new GL.EnemyManager(this);
            this.player = new GL.PlayerController(this, this.camera);
            this.weapons = new GL.WeaponSystem(this);
            this.viewmodel = new GL.Viewmodel(this);
            try { this.viewmodel.scene.environment = this.arena.buildEnvironment(this.renderer); this.scene.environmentIntensity = 0.8; }
            catch (e) { console.warn('Sin mapa de entorno', e); }
            this.ui = new GL.UI(this);
            this.session = new GL.Session();
            this.match = new GL.MatchManager(this);
            this.menus = new GL.Menus(this);
            this.debug = new URLSearchParams(location.search).has('debug');
            this.fastTest = this.debug && new URLSearchParams(location.search).has('fast');
            this.paused = false;
            this.acc = 0;
            this.last = performance.now();
            this.menuCamT = 0;
            this.frame = 0;
            this.fps = 0; this._fpsT = 0; this._fpsN = 0;

            this._bindSession();
            this._bindWindow();
            this.onResize();
            this.nav.build();
            if (this.debug) this._installDebug();
            $('loading').classList.add('hidden');
            this.menus.show('main');
            requestAnimationFrame((t) => this.loop(t));
        }

        get localId() { return this.session.localPid; }
        get profile() { return this.menus.profile; }

        /* ---------------- modos ---------------- */
        _roster() {
            const p = this.profile;
            return [{ pid: this.localId, name: p.name, color: p.color, armor: p.armor, loadout: p.loadout }];
        }

        startSolo() {
            this.audio.init();
            if (this.session.active) this.session.leave();
            this.match.begin('solo', this._roster());
            this.enterGame(true);
        }

        async createRoom(mode) {
            this.audio.init();
            if (this.session.active) this.session.leave();
            const code = await this.session.createRoom(mode, this.profile);
            this._updateNetStatus();
            return code;
        }

        async joinRoom(code) {
            this.audio.init();
            if (this.session.active) this.session.leave();
            const w = await this.session.joinRoom(code, this.profile);
            this._updateNetStatus();
            return w;
        }

        leaveRoom() { if (this.session.active) this.session.leave(); this._updateNetStatus(); }

        startMessage() {
            const roster = [];
            for (const p of this.session.players.values()) if (p.connected || p.isHost) roster.push({ pid: p.pid, name: p.name, color: p.color, armor: p.armor, loadout: p.loadout });
            return { k: 'start', mode: this.session.mode, roster };
        }

        hostStart() {
            const s = this.session;
            if (!s.active || !s.isHost) return;
            const msg = this.startMessage();
            if (s.mode === 'duel' && msg.roster.length !== 2) return;
            s.setStarted(true);
            s.broadcast(msg, true);
            this.match.begin(s.mode, msg.roster);
            this.enterGame(true);
        }

        onNetStart(m) {
            if (!Array.isArray(m.roster) || !m.roster.some((r) => r.pid === this.localId)) return;
            if (this.match.inMatch && this.match.mode === m.mode) {
                // re-sincronización tras reconexión: no reiniciamos la escena
                return;
            }
            this.match.begin(m.mode, m.roster);
            this.enterGame(false);
        }

        onNetEnd() { this.leaveMatch(); }

        enterGame(fromClick) {
            this.menus.hide();
            $('pause').classList.add('hidden');
            this.ui.hideResults();
            this.paused = false;
            this.input.enabled = true;
            if (fromClick && !this.input.forceActive) this.input.requestLock();
            else if (!this.input.forceActive) $('click-to-play').classList.remove('hidden');
        }

        leaveMatch() {
            const wasOnline = this.match.online;
            this.match.end();
            if (wasOnline || this.session.active) this.session.leave();
            this.ui.hideHud();
            this.ui.hideResults();
            $('pause').classList.add('hidden');
            $('conn-lost').classList.add('hidden');
            $('click-to-play').classList.add('hidden');
            this.releaseMouse();
            this.paused = false;
            this.menus.show('main');
            this._updateNetStatus();
        }

        again() {
            const m = this.match;
            this.ui.hideResults();
            if (m.mode === 'solo') { this.startSolo(); return; }
            if (!this.session.isHost) return;
            if (m.mode === 'duel') { m.hostRematch(); this.input.requestLock(); return; }
            // reinicio de la supervivencia: los invitados reconstruyen la partida
            const msg = Object.assign(this.startMessage(), { restart: 1 });
            this.session.broadcast(msg, true);
            m.begin('coop', msg.roster);
            this.enterGame(true);
        }

        resume() {
            $('pause').classList.add('hidden');
            this.paused = false;
            this.input.requestLock();
        }

        releaseMouse() { this.input.exitLock(); }

        /* ---------------- sesión / red ---------------- */
        _bindSession() {
            const s = this.session;
            s.on('lobby', (st) => { this.menus.renderLobby(st); this._updateNetStatus(); });
            s.on('status', () => this._updateNetStatus());
            s.on('message', (from, m) => {
                if (m.k === 'start' && m.restart) { this.match.end(true); this.match.begin(m.mode, m.roster); this.enterGame(false); return; }
                this.match.onMessage(from, m);
            });
            s.on('playerJoined', (pid, info) => { if (this.match.inMatch) this.match.hostOnPlayerJoined(pid, info); this.audio.play('ui'); });
            s.on('playerDisconnected', (pid) => { if (this.match.inMatch) this.match.hostOnPlayerDisconnected(pid); });
            s.on('playerReconnected', (pid) => { if (this.match.inMatch) this.match.hostOnPlayerReconnected(pid); });
            s.on('playerLeft', (pid) => { if (this.match.inMatch) this.match.hostOnPlayerLeft(pid); });
            s.on('connectionLost', () => {
                if (!this.match.inMatch) { this.menus.show('main'); this.menus.netStatus('Conexión con el anfitrión perdida.'); return; }
                $('conn-lost-msg').textContent = 'Intentando reconectar con el anfitrión…';
                $('conn-lost').classList.remove('hidden');
            });
            s.on('reconnected', () => { $('conn-lost').classList.add('hidden'); this.session.sendHost({ k: 'needfull' }); this.ui.toast('RECONECTADO', '#2ecc71'); });
            const hostGone = (txt) => {
                if (this.match.inMatch) {
                    this.match.end();
                    this.ui.hideHud();
                    this.releaseMouse();
                    $('conn-lost').classList.remove('hidden');
                    $('conn-lost-msg').textContent = txt;
                    document.querySelector('#conn-lost .spinner').classList.add('hidden');
                } else { this.menus.show('main'); this.menus.netStatus(txt); }
            };
            s.on('hostLost', () => hostGone('No se pudo recuperar la conexión con el anfitrión. La partida ha terminado.'));
            s.on('hostLeft', () => hostGone('El anfitrión cerró la partida.'));
            s.on('rejected', (r) => this.menus.netStatus('Rechazado: ' + r));
            s.on('sigStatus', (st) => { if (st === 'reconnecting') this.menus.netStatus('Reconectando con el servidor de señalización… (las partidas en curso continúan)'); else this._updateNetStatus(); });
        }

        _updateNetStatus() {
            const s = this.session;
            let t = '';
            if (s.status === 'connecting') t = 'CONECTANDO…';
            else if (s.status === 'hosting' || s.status === 'connected') t = 'CONECTADO · SALA: ' + s.code + ' · JUGADORES: ' + s.playerCount + '/' + s.maxPlayers;
            else if (s.status === 'reconnecting') t = 'RECONECTANDO…';
            else if (s.status === 'error') t = 'SIN CONEXIÓN';
            this.menus.netStatus(t);
        }

        _bindWindow() {
            window.addEventListener('resize', () => this.onResize());
            this.events.on('pointerlock', (locked) => {
                $('click-to-play').classList.add('hidden');
                if (!locked && this.match.inMatch && $('results').classList.contains('hidden') && $('conn-lost').classList.contains('hidden')) {
                    $('pause').classList.remove('hidden');
                    $('pause-info').textContent = this.match.online ? 'La partida online sigue en curso.' : '';
                    this.paused = this.match.mode === 'solo';
                }
            });
            this.events.on('pointerlockerror', () => { if (this.match.inMatch) $('click-to-play').classList.remove('hidden'); });
            $('click-to-play').addEventListener('click', () => { this.audio.init(); this.input.requestLock(); });
            this.canvas.addEventListener('click', () => { if (this.match.inMatch && !this.input.locked && $('pause').classList.contains('hidden')) this.input.requestLock(); });
            window.addEventListener('keydown', (e) => { if (e.code === 'Tab' && this.match.inMatch) { e.preventDefault(); this.ui.showScoreboard(true); } });
            window.addEventListener('keyup', (e) => { if (e.code === 'Tab') this.ui.showScoreboard(false); });
            window.addEventListener('beforeunload', () => { if (this.session.active) this.session.leave(true); });
        }

        onResize() {
            const w = window.innerWidth, h = window.innerHeight;
            const scale = U.storage.get('resScale', 1);
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, GL.GAME_CONFIG.quality.pixelRatioMax) * scale);
            this.renderer.setSize(w, h, false);
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
            this.viewmodel.resize(w / h);
            this.fx.setViewport(h * this.renderer.getPixelRatio());
        }

        /* ---------------- bucle ---------------- */
        loop(t) {
            requestAnimationFrame((tt) => this.loop(tt));
            let dt = (t - this.last) / 1000;
            this.last = t;
            if (!(dt > 0)) dt = 0;
            dt = Math.min(dt, 0.1);
            this._fpsT += dt; this._fpsN++;
            if (this._fpsT > 1) { this.fps = Math.round(this._fpsN / this._fpsT); this._fpsT = 0; this._fpsN = 0; }
            // Paso variable: una actualización por fotograma (subdividida si el fotograma es largo).
            // Así la cámara y el ratón van al ritmo real del monitor (60/120/144 Hz) sin tirones.
            const maxStep = GL.GAME_CONFIG.fixedDt;
            const n = Math.max(1, Math.ceil(dt / maxStep - 1e-6));
            const sub = dt / n;
            for (let i = 0; i < n && sub > 0; i++) this.update(sub);
            this._autoResolution(dt);
            this.render(dt);
        }

        /** Resolución dinámica: baja la resolución interna si el equipo no llega a ~60 FPS */
        _autoResolution(dt) {
            if (!this.match.inMatch || this.fastTest) return;
            this._frT = (this._frT || 0) + dt; this._frN = (this._frN || 0) + 1;
            if (this._frT < 1.5) return;
            const ms = this._frT / this._frN * 1000;
            this._frT = 0; this._frN = 0;
            const max = Math.min(window.devicePixelRatio || 1, GL.GAME_CONFIG.quality.pixelRatioMax) * GL.U.storage.get('resScale', 1);
            let pr = this.renderer.getPixelRatio();
            if (ms > 19 && pr > 0.55) pr = Math.max(0.55, pr - 0.15);
            else if (ms < 13 && pr < max) pr = Math.min(max, pr + 0.1);
            else return;
            this.renderer.setPixelRatio(pr);
            this.renderer.setSize(window.innerWidth, window.innerHeight, false);
            this.fx.setViewport(window.innerHeight * pr);
        }

        update(dt) {
            this.frame++;
            this.simTime = (this.simTime || 0) + dt;
            const inMatch = this.match.inMatch;
            const frozen = this.paused && this.match.mode === 'solo';
            if (inMatch && !frozen) {
                this.player.update(dt, this.input);
                this.weapons.update(dt, this.input, this.player);
                this.match.update(dt);
                this.audio.setListener(this.player.pos, this.player.yaw);
            } else if (!inMatch) this._menuCamera(dt);
            if (!frozen) {
                this.arena.update(dt, this.match.matchTime);
                this.fx.update(dt);
            }
            this.input.endFrame();
        }

        _menuCamera(dt) {
            this.menuCamT += dt * 0.05;
            const a = this.menuCamT;
            this.camera.position.set(Math.cos(a) * 22, 7 + Math.sin(a * 0.7) * 1.5, Math.sin(a) * 16);
            this.camera.lookAt(0, 2, 0);
            if (this.camera.fov !== 62) { this.camera.fov = 62; this.camera.updateProjectionMatrix(); }
            this.arena.cheer(0);
        }

        render() {
            const r = this.renderer;
            // modo de pruebas automáticas (?debug=1&fast=1): renderizar poco para no frenar la lógica
            if (this.fastTest && !this.forceRender) return;
            this.forceRender = false;
            r.autoClear = true;
            r.render(this.scene, this.camera);
            this.mainInfo = { calls: r.info.render.calls, triangles: r.info.render.triangles };
            if (this.match.inMatch) {
                this.viewmodel.update(1 / 60, this.weapons, this.player);
                this.viewmodel.render(r);
            }
        }

        /* ---------------- depuración / pruebas automáticas ---------------- */
        _installDebug() {
            const g = this;
            this.input.forceActive = true;
            window.GLDEBUG = {
                game: g,
                key: (c, d) => g.input.simKey(c, d),
                mouse: (b, d) => g.input.simMouse(b, d),
                look: (dx, dy) => g.input.simLook(dx, dy),
                state() {
                    const m = g.match, me = m.local;
                    return {
                        inMatch: m.inMatch, mode: m.mode, authority: m.isAuthority, fps: g.fps, draw: g.mainInfo,
                        pos: me ? [U.round(g.player.pos.x), U.round(g.player.pos.y), U.round(g.player.pos.z)] : null,
                        yaw: U.round(g.player.yaw, 2), hp: Math.round(g.player.hp), alive: g.player.alive, downed: g.player.downed, stamina: Math.round(g.player.stamina),
                        points: me ? m.pointsOf(me) : null, round: m.round.r || m.waves.round, roundState: m.round.s || m.waves.state, enemies: g.enemies.aliveCount,
                        weapon: g.weapons.currentId, slots: g.weapons.slots.map((s) => s && s.id + ':' + s.ammo), players: Array.from(m.players.values()).map((p) => ({ id: p.id, name: p.name, hp: Math.round(p.hp), alive: p.alive, downed: p.downed, pos: [U.round(p.pos.x), U.round(p.pos.z)], pts: m.pointsOf(p), kills: p.kills })),
                        session: { active: g.session.active, host: g.session.isHost, code: g.session.code, status: g.session.status, players: g.session.playerCount, rtt: g.session.rtt },
                        duel: m.duelState ? { s: m.duelState.s, sc: m.duelState.sc } : null,
                        boss: g.enemies.boss() ? { hp: Math.round(g.enemies.boss().hp), id: g.enemies.boss().bossId } : null
                    };
                },
                teleport(x, z, yaw) { g.player.pos.set(x, g.physics.groundHeight(x, z, 10, 0.3, 20), z); g.player.vel.set(0, 0, 0); if (yaw != null) g.player.yaw = yaw; },
                points(n) { const me = g.match.local; if (me && g.match.isAuthority) { me.points += n; g.match.emitEvent({ type: 'pts', pid: me.id, pts: me.points, d: n }); } },
                spawn(type, x, z, opts) {
                    if (!g.match.isAuthority) return null;
                    const e = g.enemies.spawn(type, { pos: new THREE.Vector3(x, 0, z) }, g.match.diff || GL.calculateDifficulty(1, 1), opts || {});
                    return e.id;
                },
                freezeEnemies(on) { g._freezeAI = on; },
                killAll() { for (const e of g.enemies.map.values()) if (!e.dead) { g.enemies.kill(e); g.match._hostOnEnemyDied(e.id); } },
                skipToRound(r) { const w = g.match.waves; w.round = r - 1; w.state = 'intermission'; w.timer = 0.05; for (const e of g.enemies.map.values()) if (!e.dead) g.enemies.kill(e); },
                enemyInfo() { return Array.from(g.enemies.map.values()).map((e) => ({ id: e.id, type: e.type, boss: e.bossId, hp: Math.round(e.hp), dead: e.dead, pos: [U.round(e.pos.x), U.round(e.pos.y), U.round(e.pos.z)], goal: e.goal, target: e.target, elite: e.elite })); },
                difficulty: (r, p) => GL.calculateDifficulty(r, p),
                screenshotReady: () => g.frame,
                render() { g.forceRender = true; },
                /** Espera a que avance la SIMULACIÓN (no el reloj real): pruebas deterministas aunque el render sea lento */
                waitSim(sec) {
                    const target = g.simTime + sec;
                    return new Promise((res) => { const chk = () => (g.simTime >= target ? res(g.simTime) : setTimeout(chk, 16)); chk(); });
                }
            };
            // modo dios (sólo pruebas): el jugador local no recibe daño
            window.GLDEBUG.god = (on) => { g._god = on; };
            const hd = this.match.hostDamagePlayer.bind(this.match);
            this.match.hostDamagePlayer = (pid, o) => (g._god && pid === g.localId ? null : hd(pid, o));
            // congelar IA en pruebas
            const orig = this.enemies.updateHost.bind(this.enemies);
            this.enemies.updateHost = function (dt, players, diff, time) {
                if (g._freezeAI) { for (const e of this.map.values()) { e.moveSpeed = 0; this._syncVisual(e, dt); } return; }
                return orig(dt, players, diff, time);
            };
        }
    }

    function boot() {
        try { new Game(); }
        catch (e) {
            console.error(e);
            const l = $('loading');
            l.innerHTML = '<div class="box"><h2>NO SE PUDO INICIAR</h2><p>' + (e && e.message ? e.message : e) + '</p><p>Este juego necesita WebGL y un navegador moderno (Chrome, Edge o Firefox).</p></div>';
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
