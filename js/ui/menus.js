/* Menús: navegación, perfil del gladiador, lobby, ajustes. */
(function () {
    const U = GL.U;
    const $ = (id) => document.getElementById(id);
    const COLORS = [0x8e1f16, 0x2b4a8a, 0x2f7a3a, 0x6a2a8a, 0xb07a1a, 0x1a1a1a, 0x1f7a7a, 0xc0c0c0];
    const ERRORS = {
        SIGNAL_UNREACHABLE: 'No se pudo contactar con el servidor de señalización. Revisa tu conexión a Internet o la configuración de red (README).',
        SIGNAL_TIMEOUT: 'El servidor de señalización no responde. Inténtalo de nuevo en unos segundos.',
        ID_TAKEN: 'No se pudo reservar un código de sala. Inténtalo de nuevo.',
        ROOM_NOT_FOUND: 'No existe ninguna partida con ese código (o el anfitrión ya se fue).',
        JOIN_TIMEOUT: 'No se pudo conectar con el anfitrión (tiempo agotado). Si persiste, vuestras redes pueden necesitar un servidor TURN.',
        ICE_FAILED: 'La conexión directa entre equipos falló (NAT o firewall). Hace falta configurar un servidor TURN (ver README).',
        CONNECTION_FAILED: 'No se pudo establecer la conexión.',
        REJECT_FULL: 'La partida está llena.',
        REJECT_STARTED: 'Ese duelo ya ha comenzado.',
        REJECT_VERSION: 'El anfitrión usa otra versión del juego. Recargad ambos la página.',
        REJECT_ID: 'Identificador inválido. Recarga la página.'
    };

    class Menus {
        constructor(game) {
            this.game = game;
            this.current = 'main';
            this.backTarget = 'main';
            this.profile = Object.assign({ name: 'Gladiador' + U.randInt(10, 99), color: COLORS[0], armor: 'media', loadout: { primary: 'gladius', secondary: 'javelin' } }, U.storage.get('profile', {}));
            this._bind();
            this._renderProfile();
            this._renderLoadouts();
            this._renderSettings();
            this._best();
            if (location.protocol === 'file:') $('file-warning').classList.remove('hidden');
        }

        errorText(e) { const k = e && e.message ? e.message : String(e); return ERRORS[k] || ('Error de red: ' + k); }

        show(name) {
            document.querySelectorAll('.menu-screen').forEach((s) => s.classList.add('hidden'));
            const el = $('m-' + name);
            if (el) el.classList.remove('hidden');
            this.current = name;
            $('menus').classList.remove('hidden');
            if (name === 'join') setTimeout(() => $('join-code').focus(), 50);
            if (name === 'main') this._best();
        }
        hide() { $('menus').classList.add('hidden'); }
        visible() { return !$('menus').classList.contains('hidden'); }

        _bind() {
            document.addEventListener('click', (ev) => {
                const b = ev.target.closest('[data-go],[data-act]');
                if (!b) return;
                this.game.audio.init();
                this.game.audio.play('ui');
                if (b.dataset.back) this.backTarget = b.dataset.back;
                if (b.dataset.act) this._act(b.dataset.act, b);
                if (b.dataset.go) {
                    if (b.dataset.back === 'pause') { $('pause').classList.add('hidden'); this.fromPause = true; }
                    this.show(b.dataset.go);
                }
            });
            $('join-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
            $('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') this._act('join'); });
        }

        async _act(act, el) {
            const g = this.game;
            if (GL.ONLINE_DISABLED && ['create-coop', 'create-duel', 'join'].includes(act)) {
                this.netStatus(GL.ONLINE_DISABLED);
                const st = $('join-status'); if (st) { st.textContent = GL.ONLINE_DISABLED; st.className = 'status-line err'; }
                return;
            }
            switch (act) {
                case 'solo': g.startSolo(); break;
                case 'create-coop': return this._create('coop');
                case 'create-duel': return this._create('duel');
                case 'join': return this._join();
                case 'cancel-join': g.leaveRoom(); this.show('main'); break;
                case 'copy-code': this._copy(); break;
                case 'start': g.hostStart(); break;
                case 'leave-room': g.leaveRoom(); this.show('main'); break;
                case 'leave-match': g.leaveMatch(); break;
                case 'resume': g.resume(); break;
                case 'again': g.again(); break;
                case 'save-profile': this._saveProfile(); break;
                case 'back':
                    if (this.fromPause && g.match.inMatch) { this.fromPause = false; this.hide(); $('pause').classList.remove('hidden'); }
                    else this.show(this.backTarget || 'main');
                    break;
                default: break;
            }
        }

        async _create(mode) {
            this.show('lobby');
            $('lobby-title').textContent = 'CREANDO PARTIDA…';
            $('lobby-code').textContent = '-----';
            $('lobby-status').textContent = 'CONECTANDO CON EL SERVIDOR…';
            $('lobby-status').className = 'status-line';
            $('lobby-mode').textContent = mode === 'duel' ? 'DUELO 1V1' : 'SUPERVIVENCIA COOPERATIVA';
            $('lobby-players').innerHTML = '';
            $('btn-start').disabled = true;
            try {
                const code = await this.game.createRoom(mode);
                $('lobby-title').textContent = 'PARTIDA CREADA';
                $('lobby-code').textContent = code;
            } catch (e) {
                $('lobby-title').textContent = 'NO SE PUDO CREAR';
                $('lobby-status').textContent = this.errorText(e);
                $('lobby-status').className = 'status-line err';
            }
        }

        async _join() {
            const code = $('join-code').value.trim().toUpperCase();
            const st = $('join-status');
            if (code.length !== GL.NETWORK_CONFIG.codeLength) { st.textContent = 'El código tiene ' + GL.NETWORK_CONFIG.codeLength + ' caracteres.'; st.className = 'status-line err'; return; }
            st.textContent = 'CONECTANDO…'; st.className = 'status-line';
            try {
                await this.game.joinRoom(code);
                st.textContent = '';
                this.show('lobby');
                $('lobby-title').textContent = 'CONECTADO';
                $('lobby-code').textContent = code;
            } catch (e) {
                st.textContent = this.errorText(e); st.className = 'status-line err';
            }
        }

        _copy() {
            const code = $('lobby-code').textContent;
            const done = () => { $('btn-copy').textContent = '¡COPIADO!'; setTimeout(() => { $('btn-copy').textContent = 'COPIAR CÓDIGO'; }, 1500); };
            if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(code).then(done, () => this._copyFallback(code, done));
            else this._copyFallback(code, done);
        }
        _copyFallback(code, done) {
            const ta = document.createElement('textarea'); ta.value = code; document.body.appendChild(ta); ta.select();
            try { document.execCommand('copy'); done(); } catch (e) { /* sin portapapeles */ }
            ta.remove();
        }

        renderLobby(st) {
            if (this.current !== 'lobby') return;
            const s = this.game.session;
            $('lobby-mode').textContent = st.mode === 'duel' ? 'DUELO 1V1' : 'SUPERVIVENCIA COOPERATIVA';
            if (st.code) $('lobby-code').textContent = st.code;
            const max = st.mode === 'duel' ? GL.NETWORK_CONFIG.maxPlayersDuel : GL.NETWORK_CONFIG.maxPlayersCoop;
            const connected = st.players.filter((p) => p.connected || p.isHost).length;
            $('lobby-players').innerHTML = st.players.map((p) => {
                const c = '#' + (p.color >>> 0).toString(16).padStart(6, '0');
                return `<div class="lp ${p.connected || p.isHost ? '' : 'dc'}" style="border-left-color:${c}"><span>${GL.UI.escapeHtml(p.name)}${p.pid === st.localPid ? ' (tú)' : ''}</span><span class="meta">${p.isHost ? 'ANFITRIÓN' : (p.connected ? (p.rtt || 0) + ' ms' : 'desconectado')}${st.mode === 'duel' && p.loadout ? ' · ' + (GL.WEAPON_CONFIG[p.loadout.primary] || {}).name : ''}</span></div>`;
            }).join('');
            let status, cls = 'status-line';
            if (st.isHost) {
                const ready = st.mode === 'duel' ? connected === 2 : connected >= 1;
                status = connected < 2 ? 'ESPERANDO JUGADOR… (' + connected + '/' + max + ')' : 'JUGADORES: ' + connected + '/' + max + ' — ¡LISTOS!';
                if (st.mode === 'coop' && connected < 2) status += ' · Puedes empezar solo y otros se unirán';
                $('btn-start').disabled = !ready;
                $('btn-start').classList.remove('hidden');
                if (connected >= 2) cls += ' ok';
            } else {
                status = 'CONECTADO · JUGADORES: ' + connected + '/' + max + ' · Esperando a que el anfitrión inicie…';
                $('btn-start').classList.add('hidden');
                cls += ' ok';
            }
            $('lobby-status').textContent = status;
            $('lobby-status').className = cls;
            $('lobby-loadout').classList.toggle('hidden', st.mode !== 'duel');
            if (s.started && !st.isHost && !this.game.match.inMatch) $('lobby-status').textContent = 'La partida ya está en curso. Uniéndote…';
        }

        netStatus(text) { $('net-status').textContent = text || ''; }

        /* ---------- perfil ---------- */
        _renderProfile() {
            $('prof-name').value = this.profile.name;
            $('prof-colors').innerHTML = COLORS.map((c) => `<div class="sw ${c === this.profile.color ? 'on' : ''}" data-c="${c}" style="background:#${c.toString(16).padStart(6, '0')}"></div>`).join('');
            $('prof-colors').onclick = (e) => { const c = e.target.dataset.c; if (!c) return; this.profile.color = parseInt(c, 10); this._renderProfile(); };
            $('prof-armor').innerHTML = Object.keys(GL.GAME_CONFIG.armor).map((k) => `<button data-a="${k}" class="${k === this.profile.armor ? 'on' : ''}">${GL.GAME_CONFIG.armor[k].label.toUpperCase()}</button>`).join('');
            $('prof-armor').onclick = (e) => { const a = e.target.dataset.a; if (!a) return; this.profile.armor = a; this._renderProfile(); };
        }
        _saveProfile() {
            this.profile.name = U.sanitizeName($('prof-name').value);
            U.storage.set('profile', this.profile);
            this.game.session.active && this.game.session.updateProfile(this.profile);
            this.game.viewmodel.setColor(this.profile.color);
        }

        _renderLoadouts() {
            const melee = GL.WEAPON_ORDER.filter((w) => GL.WEAPON_CONFIG[w].type === 'melee');
            const html = () => `
                <label class="field">ARMA PRINCIPAL (DUELO)<select data-lo="primary">${melee.map((w) => `<option value="${w}" ${w === this.profile.loadout.primary ? 'selected' : ''}>${GL.WEAPON_CONFIG[w].name}</option>`).join('')}</select></label>
                <label class="field">ARMA SECUNDARIA<select data-lo="secondary"><option value="">— Ninguna —</option>${GL.WEAPON_ORDER.filter((w) => w !== this.profile.loadout.primary).map((w) => `<option value="${w}" ${w === this.profile.loadout.secondary ? 'selected' : ''}>${GL.WEAPON_CONFIG[w].name}</option>`).join('')}</select></label>
                <label class="field">ARMADURA<select data-lo="armor">${Object.keys(GL.GAME_CONFIG.armor).map((k) => `<option value="${k}" ${k === this.profile.armor ? 'selected' : ''}>${GL.GAME_CONFIG.armor[k].label}</option>`).join('')}</select></label>`;
            document.querySelectorAll('[data-loadout]').forEach((box) => {
                box.innerHTML = html();
                box.onchange = (e) => {
                    const k = e.target.dataset.lo;
                    if (k === 'armor') this.profile.armor = e.target.value;
                    else this.profile.loadout[k] = e.target.value || null;
                    if (this.profile.loadout.secondary === this.profile.loadout.primary) this.profile.loadout.secondary = null;
                    U.storage.set('profile', this.profile);
                    this._renderLoadouts(); this._renderProfile();
                    if (this.game.session.active) this.game.session.updateProfile(this.profile);
                };
            });
        }

        _renderSettings() {
            const g = this.game;
            const sens = $('set-sens'), vol = $('set-vol'), inv = $('set-inverty'), sh = $('set-shadows'), res = $('set-res');
            sens.value = g.input.sensitivity; vol.value = g.audio.volume; inv.checked = g.input.invertY;
            sh.checked = U.storage.get('shadows', true); res.value = U.storage.get('resScale', 1);
            sens.oninput = () => { g.input.sensitivity = parseFloat(sens.value); U.storage.set('sens', g.input.sensitivity); };
            vol.oninput = () => g.audio.setVolume(parseFloat(vol.value));
            inv.onchange = () => { g.input.invertY = inv.checked; U.storage.set('invertY', inv.checked); };
            sh.onchange = () => U.storage.set('shadows', sh.checked);
            res.oninput = () => { U.storage.set('resScale', parseFloat(res.value)); g.onResize(); };
        }

        _best() {
            const b = U.storage.get('bestRound', 0), w = U.storage.get('duelWins', 0);
            $('best-line').textContent = (b ? 'Mejor ronda en supervivencia: ' + b : 'Aún no has sobrevivido a ninguna ronda') + (w ? ' · Duelos ganados: ' + w : '');
        }
    }
    GL.Menus = Menus;
})();
