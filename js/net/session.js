/* MultiplayerManager (Session) — salas por código, lobby, latencia, desconexiones y
 * reconexión. Topología en estrella: el ANFITRIÓN es la autoridad de la partida y todos
 * los invitados se conectan a él por WebRTC.
 *
 *   Invitado ──WebRTC──► Anfitrión ◄──WebRTC── Invitado
 *                 (señalización inicial vía PeerServer)
 */
(function () {
    const U = GL.U;
    const PROTO = 'gl1';
    const SESSION_KINDS = new Set(['hello', 'welcome', 'reject', 'lobby', 'ping', 'pong', 'bye', 'profile']);
    const MAX_MSG_PER_SEC = 160;

    function sigConfig() {
        const base = Object.assign({}, GL.NETWORK_CONFIG.signaling);
        const q = new URLSearchParams(location.search);
        if (q.get('sig')) base.host = q.get('sig');
        if (q.get('sigport')) base.port = parseInt(q.get('sigport'), 10);
        if (q.get('sigpath')) base.path = q.get('sigpath');
        if (q.get('sigkey')) base.key = q.get('sigkey');
        if (q.get('sigsecure')) base.secure = q.get('sigsecure') !== '0';
        return base;
    }

    class Session extends U.Emitter {
        constructor() {
            super();
            this.reset();
        }

        reset() {
            this.active = false;
            this.isHost = false;
            this.code = null;
            this.mode = null;
            this.sig = null;
            this.links = new Map();        // connectionId -> PeerLink (anfitrión)
            this.players = new Map();      // pid -> info
            this.hostLink = null;          // invitado
            this.localPid = U.storage.get('pid', null) || U.uid(10);
            U.storage.set('pid', this.localPid);
            this.status = 'idle';
            this.rtt = 0;
            this.started = false;
            clearInterval(this.pingTimer);
            clearTimeout(this.reconnectTimer);
            this.reconnecting = false;
        }

        get playerCount() { let n = 0; for (const p of this.players.values()) if (p.connected || p.isHost) n++; return n; }
        get maxPlayers() { return this.mode === 'duel' ? GL.NETWORK_CONFIG.maxPlayersDuel : GL.NETWORK_CONFIG.maxPlayersCoop; }

        _setStatus(s, detail) { this.status = s; this.emit('status', s, detail); }

        _hostPeerId(code) { return GL.NETWORK_CONFIG.idPrefix + '-' + code; }

        /* ===================== ANFITRIÓN ===================== */
        async createRoom(mode, profile) {
            this.reset();
            this.mode = mode; this.isHost = true; this.active = true;
            this.profile = profile;
            this.players.set(this.localPid, { pid: this.localPid, name: profile.name, color: profile.color, isHost: true, connected: true, rtt: 0, ready: true, loadout: profile.loadout, armor: profile.armor });
            this._setStatus('connecting');
            let lastErr = null;
            for (let attempt = 0; attempt < 5; attempt++) {
                const code = U.randomCode();
                this.sig = new GL.Signaling(sigConfig());
                try {
                    await this.sig.connect(this._hostPeerId(code));
                    this.code = code;
                    this._bindSignalingHost();
                    this._setStatus('hosting');
                    this._startPing();
                    this.emit('lobby', this.lobbyState());
                    return code;
                } catch (e) {
                    lastErr = e;
                    this.sig.close();
                    if (e.message !== 'ID_TAKEN') break;
                }
            }
            this.active = false;
            this._setStatus('error', lastErr ? lastErr.message : 'unknown');
            throw lastErr || new Error('SIGNAL_ERROR');
        }

        _bindSignalingHost() {
            this.sig.on('message', (msg) => {
                const p = msg.payload || {};
                if (!GL.PeerLink.isOurs(p)) return;
                const cid = p.connectionId;
                if (!cid) return;
                let link = this.links.get(cid);
                if (msg.type === 'OFFER') {
                    if (link) return;
                    link = new GL.PeerLink({ signaling: this.sig, remoteId: msg.src, connectionId: cid, initiator: false });
                    this.links.set(cid, link);
                    link.rate = { n: 0, t: performance.now() };
                    link.on('open', () => { /* esperamos 'hello' */ });
                    link.on('message', (m) => this._hostOnMessage(link, m));
                    link.on('close', (reason) => this._hostOnLinkClose(link, reason));
                }
                if (link) link.handleSignal(msg);
            });
            this.sig.on('disconnected', () => this.emit('sigStatus', 'reconnecting'));
            this.sig.on('reconnected', () => this.emit('sigStatus', 'ok'));
        }

        _hostOnMessage(link, m) {
            // límite de mensajes por segundo (anti-flood)
            const r = link.rate, now = performance.now();
            if (now - r.t > 1000) { r.t = now; r.n = 0; }
            if (++r.n > MAX_MSG_PER_SEC) return;
            if (m.k === 'hello') return this._hostOnHello(link, m);
            const pid = link.pid;
            if (!pid) return;
            const pl = this.players.get(pid);
            if (!pl) return;
            pl.lastSeen = now;
            if (m.k === 'pong') { pl.rtt = Math.round(now - m.t); return; }
            if (m.k === 'ping') { link.send({ k: 'pong', t: m.t }); return; }
            if (m.k === 'bye') { this._removePlayer(pid, 'left'); link.close('bye'); return; }
            if (m.k === 'profile') {
                pl.name = U.sanitizeName(m.name); pl.color = (m.color >>> 0) & 0xffffff;
                if (m.loadout) pl.loadout = m.loadout; if (m.armor) pl.armor = m.armor;
                this.broadcastLobby(); return;
            }
            if (SESSION_KINDS.has(m.k)) return;
            this.emit('message', pid, m);
        }

        _hostOnHello(link, m) {
            if (m.proto !== PROTO) { link.send({ k: 'reject', reason: 'version' }); setTimeout(() => link.close('reject'), 300); return; }
            const pid = String(m.pid || '').slice(0, 20);
            if (!pid || pid === this.localPid) { link.send({ k: 'reject', reason: 'id' }); setTimeout(() => link.close('reject'), 300); return; }
            const existing = this.players.get(pid);
            if (existing) {
                // reconexión de un jugador conocido
                if (existing.link && existing.link !== link) existing.link.close('replaced');
                existing.link = link; existing.connected = true; existing.disconnectedAt = 0; existing.lastSeen = performance.now();
                link.pid = pid;
                link.send({ k: 'welcome', pid, code: this.code, mode: this.mode, players: this._playerList(), started: this.started, rejoin: true });
                this.emit('playerReconnected', pid);
                this.broadcastLobby();
                return;
            }
            if (this.playerCount >= this.maxPlayers) { link.send({ k: 'reject', reason: 'full' }); setTimeout(() => link.close('reject'), 300); return; }
            if (this.started && this.mode === 'duel') { link.send({ k: 'reject', reason: 'started' }); setTimeout(() => link.close('reject'), 300); return; }
            link.pid = pid;
            const info = { pid, name: U.sanitizeName(m.name), color: (m.color >>> 0) & 0xffffff, isHost: false, connected: true, link, rtt: 0, lastSeen: performance.now(), loadout: m.loadout, armor: m.armor };
            this.players.set(pid, info);
            link.send({ k: 'welcome', pid, code: this.code, mode: this.mode, players: this._playerList(), started: this.started });
            this.emit('playerJoined', pid, info);
            this.broadcastLobby();
        }

        _hostOnLinkClose(link, reason) {
            this.links.delete(link.connectionId);
            const pid = link.pid;
            if (!pid) return;
            const pl = this.players.get(pid);
            if (!pl || pl.link !== link) return;
            if (reason === 'bye') return;
            pl.connected = false; pl.disconnectedAt = performance.now();
            this.emit('playerDisconnected', pid, reason);
            this.broadcastLobby();
            setTimeout(() => {
                const p2 = this.players.get(pid);
                if (p2 && !p2.connected) this._removePlayer(pid, 'timeout');
            }, GL.NETWORK_CONFIG.reconnectWindowMs);
        }

        _removePlayer(pid, reason) {
            const pl = this.players.get(pid);
            if (!pl) return;
            this.players.delete(pid);
            this.emit('playerLeft', pid, reason, pl);
            this.broadcastLobby();
        }

        _playerList() {
            return Array.from(this.players.values()).map((p) => ({ pid: p.pid, name: p.name, color: p.color, isHost: p.isHost, connected: p.connected, rtt: p.rtt, loadout: p.loadout, armor: p.armor }));
        }

        lobbyState() { return { code: this.code, mode: this.mode, players: this._playerList(), isHost: this.isHost, started: this.started, localPid: this.localPid }; }

        broadcastLobby() {
            if (!this.isHost) return;
            const st = this.lobbyState();
            this.broadcast({ k: 'lobby', code: st.code, mode: st.mode, players: st.players, started: st.started });
            this.emit('lobby', st);
        }

        /** Enviar a todos los invitados (anfitrión) */
        broadcast(msg, reliable, exceptPid) {
            for (const p of this.players.values()) {
                if (p.isHost || !p.connected || !p.link || p.pid === exceptPid) continue;
                p.link.send(msg, reliable);
            }
        }
        sendTo(pid, msg, reliable) {
            if (pid === this.localPid) return;
            const p = this.players.get(pid);
            if (p && p.link && p.connected) p.link.send(msg, reliable);
        }

        /* ===================== INVITADO ===================== */
        async joinRoom(code, profile) {
            this.reset();
            this.isHost = false; this.active = true; this.profile = profile;
            this.code = code.toUpperCase().trim();
            this._setStatus('connecting');
            this.sig = new GL.Signaling(sigConfig());
            try { await this.sig.connect(GL.NETWORK_CONFIG.idPrefix + '-g' + U.uid(12)); }
            catch (e) { this.active = false; this._setStatus('error', e.message); throw e; }
            this.sig.on('message', (msg) => {
                const p = msg.payload || {};
                if (msg.type === 'EXPIRE' && this.hostLink && this.hostLink.state === 'connecting') { this.hostLink.close('not-found'); return; }
                if (msg.type === 'LEAVE' && msg.src === this._hostPeerId(this.code)) { if (this.hostLink && this.hostLink.state === 'connecting') this.hostLink.close('not-found'); return; }
                if (!GL.PeerLink.isOurs(p)) return;
                if (this.hostLink && p.connectionId === this.hostLink.connectionId) this.hostLink.handleSignal(msg);
            });
            return new Promise((resolve, reject) => {
                this._joinResolve = resolve; this._joinReject = reject;
                this._connectToHost(false);
            });
        }

        _connectToHost(rejoin) {
            const link = new GL.PeerLink({ signaling: this.sig, remoteId: this._hostPeerId(this.code), initiator: true });
            this.hostLink = link;
            link.on('open', () => {
                const pr = this.profile;
                link.send({ k: 'hello', proto: PROTO, pid: this.localPid, name: pr.name, color: pr.color, loadout: pr.loadout, armor: pr.armor, rejoin: !!rejoin });
            });
            link.on('message', (m) => this._guestOnMessage(link, m));
            link.on('close', (reason) => this._guestOnClose(link, reason));
            link.start().catch((e) => { console.warn(e); link.close('offer-failed'); });
        }

        _guestOnMessage(link, m) {
            if (m.k === 'welcome') {
                this.localPid = m.pid;
                this.mode = m.mode;
                this.players.clear();
                for (const p of m.players) this.players.set(p.pid, p);
                this.started = m.started;
                this._setStatus('connected');
                if (!this._pinging) this._startPing();
                if (this._joinResolve) { this._joinResolve(m); this._joinResolve = null; this._joinReject = null; }
                if (m.rejoin || this.reconnecting) { this.reconnecting = false; clearTimeout(this.reconnectTimer); this.emit('reconnected', m); }
                this.emit('lobby', this.lobbyState());
                return;
            }
            if (m.k === 'reject') {
                const err = new Error('REJECT_' + String(m.reason).toUpperCase());
                if (this._joinReject) { this._joinReject(err); this._joinResolve = this._joinReject = null; }
                this.emit('rejected', m.reason);
                return;
            }
            if (m.k === 'lobby') {
                this.mode = m.mode; this.started = m.started;
                this.players.clear();
                for (const p of m.players) this.players.set(p.pid, p);
                this.emit('lobby', this.lobbyState());
                return;
            }
            if (m.k === 'ping') { link.send({ k: 'pong', t: m.t }); return; }
            if (m.k === 'pong') { this.rtt = Math.round(performance.now() - m.t); return; }
            if (m.k === 'bye') { this.emit('hostLeft'); this.leave(true); return; }
            if (SESSION_KINDS.has(m.k)) return;
            this.emit('message', 'host', m);
        }

        _guestOnClose(link, reason) {
            if (link !== this.hostLink || !this.active) return;
            if (this._joinReject) {
                const map = { 'not-found': 'ROOM_NOT_FOUND', 'timeout': 'JOIN_TIMEOUT', 'ice-failed': 'ICE_FAILED' };
                this._joinReject(new Error(map[reason] || 'CONNECTION_FAILED'));
                this._joinResolve = this._joinReject = null;
                return;
            }
            // conexión perdida durante la partida → intentar reconectar
            this._beginReconnect(reason);
        }

        _beginReconnect(reason) {
            if (this.reconnecting) return;
            this.reconnecting = true;
            const start = performance.now();
            this.emit('connectionLost', reason);
            this._setStatus('reconnecting');
            const tryOnce = () => {
                if (!this.active || !this.reconnecting) return;
                if (performance.now() - start > GL.NETWORK_CONFIG.reconnectWindowMs) {
                    this.reconnecting = false;
                    this.emit('hostLost', reason);
                    this.leave(true);
                    return;
                }
                this._connectToHost(true);
                this.reconnectTimer = setTimeout(() => {
                    if (this.reconnecting && (!this.hostLink || this.hostLink.state !== 'open')) {
                        if (this.hostLink && this.hostLink.state === 'connecting') this.hostLink.close('retry');
                        tryOnce();
                    }
                }, GL.NETWORK_CONFIG.reconnectRetryMs + 2000);
            };
            tryOnce();
        }

        /** Enviar al anfitrión (invitado) */
        sendHost(msg, reliable) { if (this.hostLink) return this.hostLink.send(msg, reliable); return false; }

        /** Enviar sin importar el rol: el anfitrión difunde, el invitado envía al anfitrión */
        send(msg, reliable) { if (this.isHost) this.broadcast(msg, reliable); else this.sendHost(msg, reliable); }

        updateProfile(profile) {
            this.profile = profile;
            if (this.isHost) {
                const me = this.players.get(this.localPid);
                if (me) { me.name = profile.name; me.color = profile.color; me.loadout = profile.loadout; me.armor = profile.armor; }
                this.broadcastLobby();
            } else this.sendHost({ k: 'profile', name: profile.name, color: profile.color, loadout: profile.loadout, armor: profile.armor });
        }

        _startPing() {
            this._pinging = true;
            clearInterval(this.pingTimer);
            this.pingTimer = setInterval(() => {
                const now = performance.now();
                const timeout = GL.NETWORK_CONFIG.linkTimeoutMs;
                if (this.isHost) {
                    for (const p of this.players.values()) {
                        if (p.isHost || !p.connected || !p.link) continue;
                        p.link.send({ k: 'ping', t: now });
                        if (now - p.link.lastRecv > timeout) p.link.close('timeout');
                    }
                    if (this._lobbyTick = (this._lobbyTick || 0) + 1, this._lobbyTick % 3 === 0) this.broadcastLobby();
                } else if (this.hostLink && this.hostLink.state === 'open') {
                    this.hostLink.send({ k: 'ping', t: now });
                    if (now - this.hostLink.lastRecv > timeout) this.hostLink.close('timeout');
                }
            }, GL.NETWORK_CONFIG.pingIntervalMs);
        }

        setStarted(v) { this.started = v; if (this.isHost) this.broadcastLobby(); }

        leave(silent) {
            if (!this.active && !this.sig) return;
            try {
                if (this.isHost) { this.broadcast({ k: 'bye' }); }
                else if (this.hostLink && !silent) this.hostLink.send({ k: 'bye' });
            } catch (e) { /* nada */ }
            const links = [];
            for (const l of this.links.values()) links.push(l);
            if (this.hostLink) links.push(this.hostLink);
            setTimeout(() => { for (const l of links) l.close('bye'); }, 150);
            if (this.sig) this.sig.close();
            this.sig = null;
            this.active = false;
            this.reconnecting = false;
            clearInterval(this.pingTimer);
            clearTimeout(this.reconnectTimer);
            this._pinging = false;
            this._setStatus('idle');
            this.emit('left');
        }

        diagnostics() {
            const out = [];
            const add = (l) => out.push({ state: l.state, relay: l.relayUsed, sent: l.stats.sent, recv: l.stats.recv });
            for (const l of this.links.values()) add(l);
            if (this.hostLink) add(this.hostLink);
            return out;
        }
    }
    Session.PROTO = PROTO;
    GL.Session = Session;
})();
