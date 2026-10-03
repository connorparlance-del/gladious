/* PeerLink — conexión WebRTC con otro jugador.
 * Dos DataChannels negociados:
 *   'r' ordenado y fiable  (eventos: ataques, daño, compras, rondas…)
 *   'u' no ordenado, sin retransmisión (snapshots de posición: lo viejo no sirve)
 * La señalización (SDP/ICE) viaja por Signaling; ICE usa STUN y TURN si se configura. */
(function () {
    class PeerLink extends GL.U.Emitter {
        constructor(o) {
            super();
            this.sig = o.signaling;
            this.remoteId = o.remoteId;
            this.connectionId = o.connectionId || ('c' + GL.U.uid(10));
            this.initiator = !!o.initiator;
            this.state = 'connecting';
            this.pendingCandidates = [];
            this.remoteSet = false;
            this.rel = null; this.unrel = null;
            this.lastRecv = performance.now();
            this.stats = { sent: 0, recv: 0, bytesIn: 0, bytesOut: 0 };
            this.relayUsed = null;
            const net = GL.NETWORK_CONFIG;
            this.pc = new RTCPeerConnection({ iceServers: net.iceServers, iceTransportPolicy: net.iceTransportPolicy || 'all' });
            this._setupPc();
            this.timeout = setTimeout(() => { if (this.state === 'connecting') this.close('timeout'); }, net.joinTimeoutMs || 15000);
        }

        _setupPc() {
            const pc = this.pc;
            this.rel = pc.createDataChannel('r', { negotiated: true, id: 0, ordered: true });
            this.unrel = pc.createDataChannel('u', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 });
            for (const ch of [this.rel, this.unrel]) {
                ch.onopen = () => this._checkOpen();
                ch.onclose = () => { if (this.state === 'open') this.close('channel-closed'); };
                ch.onmessage = (ev) => this._onData(ev.data);
            }
            pc.onicecandidate = (ev) => {
                if (ev.candidate) this.sig.send('CANDIDATE', this.remoteId, { kind: 'gladiadores', connectionId: this.connectionId, candidate: ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate });
            };
            pc.oniceconnectionstatechange = () => {
                const s = pc.iceConnectionState;
                if (s === 'failed') this.close('ice-failed');
                if (s === 'disconnected') this.emit('unstable');
                if (s === 'connected' || s === 'completed') { this.emit('stable'); this._detectRelay(); }
            };
            pc.onconnectionstatechange = () => {
                if (pc.connectionState === 'failed') this.close('ice-failed');
                if (pc.connectionState === 'closed' && this.state !== 'closed') this.close('closed');
            };
        }

        async _detectRelay() {
            try {
                const st = await this.pc.getStats();
                st.forEach((r) => {
                    if (r.type === 'candidate-pair' && r.state === 'succeeded' && (r.nominated || r.selected)) {
                        const lc = st.get(r.localCandidateId);
                        if (lc) this.relayUsed = lc.candidateType === 'relay';
                    }
                });
            } catch (e) { /* estadísticas no disponibles */ }
        }

        async start() {
            const offer = await this.pc.createOffer();
            await this.pc.setLocalDescription(offer);
            this.sig.send('OFFER', this.remoteId, { kind: 'gladiadores', connectionId: this.connectionId, sdp: this.pc.localDescription.toJSON ? this.pc.localDescription.toJSON() : { type: offer.type, sdp: offer.sdp } });
        }

        async handleSignal(msg) {
            const p = msg.payload || {};
            try {
                if (msg.type === 'OFFER' && !this.initiator) {
                    await this.pc.setRemoteDescription(p.sdp);
                    this.remoteSet = true; this._drain();
                    const ans = await this.pc.createAnswer();
                    await this.pc.setLocalDescription(ans);
                    this.sig.send('ANSWER', this.remoteId, { kind: 'gladiadores', connectionId: this.connectionId, sdp: this.pc.localDescription.toJSON ? this.pc.localDescription.toJSON() : { type: ans.type, sdp: ans.sdp } });
                } else if (msg.type === 'ANSWER' && this.initiator) {
                    if (this.pc.signalingState !== 'have-local-offer') return;
                    await this.pc.setRemoteDescription(p.sdp);
                    this.remoteSet = true; this._drain();
                } else if (msg.type === 'CANDIDATE' && p.candidate) {
                    if (!this.remoteSet) this.pendingCandidates.push(p.candidate);
                    else await this.pc.addIceCandidate(p.candidate);
                }
            } catch (e) {
                console.warn('[red] error de señalización', e);
                this.emit('signalError', e);
            }
        }

        async _drain() {
            const list = this.pendingCandidates; this.pendingCandidates = [];
            for (const c of list) { try { await this.pc.addIceCandidate(c); } catch (e) { /* candidato inválido */ } }
        }

        _checkOpen() {
            if (this.state !== 'connecting') return;
            if (this.rel.readyState === 'open' && this.unrel.readyState === 'open') {
                this.state = 'open';
                clearTimeout(this.timeout);
                this.lastRecv = performance.now();
                this.emit('open');
            }
        }

        _onData(data) {
            this.lastRecv = performance.now();
            this.stats.recv++;
            if (typeof data !== 'string' || data.length > 65536) return;
            this.stats.bytesIn += data.length;
            let msg;
            try { msg = JSON.parse(data); } catch (e) { return; }
            if (!msg || typeof msg !== 'object' || typeof msg.k !== 'string') return;
            this.emit('message', msg);
        }

        send(msg, reliable) {
            if (this.state !== 'open') return false;
            const ch = reliable === false ? this.unrel : this.rel;
            if (ch.readyState !== 'open') return false;
            // si el canal no fiable está saturado, descartamos (el siguiente snapshot lo sustituye)
            if (reliable === false && ch.bufferedAmount > 64 * 1024) return false;
            const s = JSON.stringify(msg);
            try { ch.send(s); this.stats.sent++; this.stats.bytesOut += s.length; return true; }
            catch (e) { return false; }
        }

        close(reason) {
            if (this.state === 'closed') return;
            const was = this.state;
            this.state = 'closed';
            clearTimeout(this.timeout);
            try { this.rel && this.rel.close(); } catch (e) { /* nada */ }
            try { this.unrel && this.unrel.close(); } catch (e) { /* nada */ }
            try { this.pc.close(); } catch (e) { /* nada */ }
            this.emit('close', reason || 'closed', was);
        }
    }
    GL.PeerLink = PeerLink;
})();
