/* Cliente de señalización compatible con el protocolo de PeerServer (PeerJS).
 * Funciona con PeerJS Cloud (0.peerjs.com) o con cualquier PeerServer propio,
 * incluido network/signaling-server.js de este proyecto.
 * Sólo se usa para que dos navegadores se encuentren e intercambien SDP/ICE;
 * el juego viaja después por WebRTC DataChannel directamente entre jugadores. */
(function () {
    class Signaling extends GL.U.Emitter {
        constructor(cfg) {
            super();
            this.cfg = cfg;
            this.ws = null;
            this.id = null;
            this.token = GL.U.uid(14);
            this.open = false;
            this.closedByUser = false;
            this.hbTimer = null;
            this.reconnectTimer = null;
            this.queue = [];
        }

        url(id) {
            const c = this.cfg;
            const proto = c.secure ? 'wss://' : 'ws://';
            return `${proto}${c.host}:${c.port}${c.path}peerjs?key=${encodeURIComponent(c.key)}&id=${encodeURIComponent(id)}&token=${this.token}&version=1.5.4`;
        }

        /** Conecta con un ID concreto. Resuelve al recibir OPEN. */
        connect(id) {
            this.id = id;
            this.closedByUser = false;
            return new Promise((resolve, reject) => {
                let settled = false;
                const done = (err) => {
                    if (settled) return; settled = true;
                    clearTimeout(to);
                    if (err) reject(err); else resolve();
                };
                const to = setTimeout(() => { done(new Error('SIGNAL_TIMEOUT')); this._closeSocket(); }, this.cfg.connectTimeoutMs || 12000);
                this._openSocket(done);
            });
        }

        _openSocket(onFirstResult) {
            let ws;
            try { ws = new WebSocket(this.url(this.id)); }
            catch (e) { if (onFirstResult) onFirstResult(new Error('SIGNAL_UNREACHABLE')); return; }
            this.ws = ws;
            ws.onopen = () => { this._heartbeat(); };
            ws.onmessage = (ev) => {
                let msg;
                try { msg = JSON.parse(ev.data); } catch (e) { return; }
                if (!msg || !msg.type) return;
                switch (msg.type) {
                    case 'OPEN':
                        this.open = true;
                        if (onFirstResult) { onFirstResult(null); onFirstResult = null; }
                        else this.emit('reconnected');
                        this._flush();
                        break;
                    case 'ID-TAKEN':
                        if (onFirstResult) { onFirstResult(new Error('ID_TAKEN')); onFirstResult = null; }
                        this._closeSocket();
                        break;
                    case 'ERROR':
                        if (onFirstResult) { onFirstResult(new Error('SIGNAL_ERROR: ' + (msg.payload && msg.payload.msg || ''))); onFirstResult = null; }
                        this.emit('error', msg.payload && msg.payload.msg);
                        break;
                    case 'HEARTBEAT': break;
                    default:
                        this.emit('message', msg);
                }
            };
            ws.onerror = () => { /* el cierre posterior informa */ };
            ws.onclose = () => {
                const wasOpen = this.open;
                this.open = false;
                clearInterval(this.hbTimer);
                if (onFirstResult) { onFirstResult(new Error('SIGNAL_UNREACHABLE')); onFirstResult = null; return; }
                if (this.closedByUser) return;
                if (wasOpen) this.emit('disconnected');
                // reconexión automática con el mismo id y token
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = setTimeout(() => { if (!this.closedByUser) this._openSocket(null); }, 2500);
            };
        }

        _heartbeat() {
            clearInterval(this.hbTimer);
            this.hbTimer = setInterval(() => {
                if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ type: 'HEARTBEAT' }));
            }, this.cfg.heartbeatMs || 5000);
        }

        send(type, dst, payload) {
            const m = { type, dst, payload };
            if (!this.open || !this.ws || this.ws.readyState !== 1) { this.queue.push(m); if (this.queue.length > 200) this.queue.shift(); return; }
            this.ws.send(JSON.stringify(m));
        }

        _flush() {
            const q = this.queue; this.queue = [];
            for (const m of q) this.send(m.type, m.dst, m.payload);
        }

        _closeSocket() {
            if (this.ws) { try { this.ws.onclose = null; this.ws.close(); } catch (e) { /* ya cerrado */ } }
            this.ws = null; this.open = false;
            clearInterval(this.hbTimer);
        }

        close() {
            this.closedByUser = true;
            clearTimeout(this.reconnectTimer);
            if (this.ws && this.ws.readyState === 1) { try { this.ws.send(JSON.stringify({ type: 'LEAVE', dst: undefined })); } catch (e) { /* nada */ } }
            this._closeSocket();
        }
    }
    GL.Signaling = Signaling;
})();
