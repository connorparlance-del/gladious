/* UIManager — HUD, indicadores de combate, avisos, barras de jefe, resultados. */
(function () {
    const U = GL.U;
    const $ = (id) => document.getElementById(id);

    class UI {
        constructor(game) {
            this.game = game;
            this.el = {};
            ['hud', 'hp-fill', 'hp-text', 'st-fill', 'points-num', 'points-box', 'points-pop', 'weapon-name', 'weapon-ammo', 'weapon-slots', 'special-fill',
                'round-box', 'round-num', 'round-sub', 'duel-box', 'duel-names', 'duel-score', 'boss-bar', 'boss-name', 'boss-fill', 'opponent-box', 'opp-name', 'opp-fill',
                'team-box', 'killfeed', 'prompt', 'revive-bar', 'revive-fill', 'banner', 'banner-title', 'banner-sub', 'toast', 'countdown', 'dmg-numbers',
                'downed', 'downed-timer', 'dead', 'dead-sub', 'waiting-opp', 'scoreboard', 'damage-flash', 'damage-dirs', 'lowhp', 'hitmarker', 'crosshair',
                'results', 'results-title', 'results-sub', 'results-table', 'btn-again'].forEach((id) => { this.el[id] = $(id); });
            this.cache = {};
            this.bannerT = null;
            this.toastT = null;
            this._teamKey = '';
        }

        _set(key, el, prop, val) {
            if (this.cache[key] === val) return;
            this.cache[key] = val;
            el[prop] = val;
        }

        onMatchBegin(mode) {
            this.el.hud.classList.remove('hidden');
            this.el['round-box'].classList.toggle('hidden', mode === 'duel');
            this.el['duel-box'].classList.toggle('hidden', mode !== 'duel');
            this.el['points-box'].classList.toggle('hidden', mode === 'duel');
            this.el['opponent-box'].classList.toggle('hidden', mode !== 'duel');
            this.el['team-box'].innerHTML = ''; this._teamKey = '';
            this.el['killfeed'].innerHTML = '';
            this.hideResults(); this.setDead(false); this.setDowned(null); this.waitingOpponent(false);
            this.bossBar(null);
            this.cache = {};
        }
        hideHud() { this.el.hud.classList.add('hidden'); }

        setVitals(hp, maxHp, st, maxSt) {
            const h = U.clamp(hp / maxHp, 0, 1);
            this._set('hp', this.el['hp-fill'].style, 'width', (h * 100).toFixed(1) + '%');
            this._set('hpt', this.el['hp-text'], 'textContent', Math.ceil(Math.max(0, hp)) + ' / ' + maxHp);
            this._set('st', this.el['st-fill'].style, 'width', (U.clamp(st / maxSt, 0, 1) * 100).toFixed(1) + '%');
            const low = h < 0.3 && hp > 0;
            if (this.cache.low !== low) { this.cache.low = low; this.el.lowhp.classList.toggle('on', low); }
        }
        flashStamina() { const f = this.el['st-fill']; f.classList.remove('flash'); void f.offsetWidth; f.classList.add('flash'); }

        setPoints(n) {
            if (n == null) return;
            this._set('pts', this.el['points-num'], 'textContent', U.formatPts(n));
        }
        pointsPopup(delta, why) {
            if (!delta) return;
            const d = document.createElement('div');
            d.className = 'pp' + (delta < 0 ? ' neg' : '');
            d.innerHTML = (delta > 0 ? '+' : '') + delta + (why ? '<small>' + why + '</small>' : '');
            const box = this.el['points-pop'];
            box.appendChild(d);
            while (box.children.length > 4) box.firstChild.remove();
            setTimeout(() => d.remove(), 1500);
        }

        setWeapon(name, ammo, slots, cur, specialCd) {
            this._set('wn', this.el['weapon-name'], 'textContent', name);
            this._set('wa', this.el['weapon-ammo'], 'textContent', ammo);
            const key = slots.map((s) => s ? s.id : '-').join(',') + cur;
            if (this.cache.slots !== key) {
                this.cache.slots = key;
                this.el['weapon-slots'].innerHTML = slots.map((s, i) => s ? `<span class="wslot ${i === cur ? 'on' : ''}">${i + 1} ${GL.WEAPON_CONFIG[s.id].name}</span>` : `<span class="wslot">${i + 1} —</span>`).join('');
                const ranged = slots[cur] && GL.WEAPON_CONFIG[slots[cur].id].type !== 'melee';
                this.el.crosshair.classList.toggle('ranged', !!ranged);
            }
            this._set('sp', this.el['special-fill'].style, 'width', (100 - U.clamp(specialCd / 7, 0, 1) * 100).toFixed(0) + '%');
        }

        setRound(r, left, timer) {
            if (r == null) return;
            this._set('rn', this.el['round-num'], 'textContent', r);
            let sub = '';
            if (timer != null && timer > 0) sub = 'Siguiente ronda en ' + Math.ceil(timer) + ' s';
            else sub = 'Enemigos restantes: ' + Math.max(0, left | 0);
            this._set('rs', this.el['round-sub'], 'textContent', sub);
        }

        setTeam(list) {
            if (list.length <= 1) { if (this._teamKey) { this.el['team-box'].innerHTML = ''; this._teamKey = ''; } return; }
            const key = list.map((p) => p.name + Math.round(p.hp) + p.maxHp + p.downed + p.alive + p.pts + p.connected).join('|');
            if (key === this._teamKey) return;
            this._teamKey = key;
            this.el['team-box'].innerHTML = list.map((p) => {
                const c = '#' + (p.color >>> 0).toString(16).padStart(6, '0');
                const cls = !p.connected ? 'dc' : !p.alive ? 'dead' : p.downed ? 'down' : '';
                const st = !p.connected ? ' (desconectado)' : !p.alive ? ' (muerto)' : p.downed ? ' (CAÍDO)' : '';
                return `<div class="tm ${cls}" style="border-left-color:${c}">${escapeHtml(p.name)}${p.isLocal ? ' (tú)' : ''}${st}<span class="pts">${U.formatPts(p.pts)}</span><div class="bar"><div class="fill hp" style="width:${U.clamp(p.hp / p.maxHp, 0, 1) * 100}%"></div></div></div>`;
            }).join('');
        }

        setOpponent(o) {
            this.el['opponent-box'].classList.toggle('hidden', !o);
            if (!o) return;
            this._set('on', this.el['opp-name'], 'textContent', o.name);
            this._set('oh', this.el['opp-fill'].style, 'width', (U.clamp(o.hp / o.maxHp, 0, 1) * 100).toFixed(1) + '%');
        }

        duelScore(sc, players, localId) {
            const ids = Object.keys(sc || {});
            const me = ids.find((i) => i === localId), op = ids.find((i) => i !== localId);
            const meName = (players.get(me) || {}).name || 'Tú', opName = (players.get(op) || {}).name || 'Rival';
            this.el['duel-names'].textContent = meName.toUpperCase() + '  ·  ' + opName.toUpperCase();
            this.el['duel-score'].textContent = (sc[me] || 0) + ' — ' + (sc[op] || 0);
        }

        bossBar(name, frac, phase) {
            const show = !!name;
            if (this.cache.bossShow !== show) { this.cache.bossShow = show; this.el['boss-bar'].classList.toggle('hidden', !show); }
            if (!show) return;
            this._set('bn', this.el['boss-name'], 'textContent', name + (phase ? '  —  FASE ' + (phase + 1) : ''));
            this._set('bf', this.el['boss-fill'].style, 'width', (U.clamp(frac, 0, 1) * 100).toFixed(1) + '%');
        }

        prompt(p) {
            const el = this.el.prompt;
            const txt = p ? p.text : '';
            if (this.cache.prompt === txt + (p && p.can)) return;
            this.cache.prompt = txt + (p && p.can);
            el.classList.toggle('hidden', !p);
            if (p) { el.textContent = p.text; el.classList.toggle('no', !p.can); }
        }

        reviveProgress(f) {
            this.el['revive-bar'].classList.toggle('hidden', f == null);
            if (f != null) this.el['revive-fill'].style.width = (U.clamp(f, 0, 1) * 100) + '%';
        }

        banner(title, sub, dur, big) {
            const b = this.el.banner;
            this.el['banner-title'].textContent = title;
            this.el['banner-sub'].textContent = sub || '';
            b.classList.toggle('big', !!big);
            b.classList.remove('hidden');
            b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
            clearTimeout(this.bannerT);
            this.bannerT = setTimeout(() => b.classList.add('hidden'), (dur || 3) * 1000);
        }

        toast(text, color) {
            const d = document.createElement('div');
            d.className = 'toast-item';
            d.textContent = text;
            d.style.color = color || '#f6dfa0';
            this.el.toast.innerHTML = '';
            this.el.toast.appendChild(d);
        }

        countdown(n, label) {
            const el = this.el.countdown;
            let t = n;
            clearInterval(this.cdT);
            const tick = () => {
                if (t <= 0) { el.classList.add('hidden'); clearInterval(this.cdT); return; }
                el.innerHTML = '<small>' + (label || '') + '</small>' + t;
                el.classList.remove('hidden');
                this.game.audio.play('drum', { vol: 0.7 });
                t--;
            };
            tick();
            this.cdT = setInterval(tick, 1000);
        }

        killfeed(text, color) {
            const d = document.createElement('div');
            d.className = 'kf'; d.textContent = text; d.style.color = color || '#efe5d2';
            this.el.killfeed.appendChild(d);
            while (this.el.killfeed.children.length > 5) this.el.killfeed.firstChild.remove();
            setTimeout(() => d.remove(), 5000);
        }

        hitmarker(head, kill) {
            const h = this.el.hitmarker;
            h.className = '';
            void h.offsetWidth;
            h.className = 'show' + (head ? ' head' : '') + (kill ? ' kill' : '');
            this.game.audio.play('hitmarker', { vol: kill ? 1 : 0.6 });
        }

        damageNumber(pos, amount, crit, head, blocked) {
            const cam = this.game.camera;
            const v = new THREE.Vector3(pos.x, pos.y + 0.3, pos.z).project(cam);
            if (v.z > 1) return;
            const d = document.createElement('div');
            d.className = 'dn' + (head ? ' head' : crit ? ' crit' : '') + (blocked ? ' blk' : '');
            d.textContent = blocked && !amount ? 'BLOQUEADO' : (head ? '☠ ' : '') + amount;
            d.style.left = ((v.x * 0.5 + 0.5) * 100 + (Math.random() - 0.5) * 3) + '%';
            d.style.top = ((-v.y * 0.5 + 0.5) * 100) + '%';
            this.el['dmg-numbers'].appendChild(d);
            setTimeout(() => d.remove(), 950);
        }

        damageFlash(k) {
            const f = this.el['damage-flash'];
            f.style.transition = 'none'; f.style.opacity = String(0.35 + k * 0.6);
            void f.offsetWidth;
            f.style.transition = 'opacity 0.5s'; f.style.opacity = '0';
        }

        damageDirection(fx, fz, pc) {
            const dx = fx - pc.pos.x, dz = fz - pc.pos.z;
            const ang = Math.atan2(dx, -dz) + pc.yaw;   // 0 = delante
            const d = document.createElement('div');
            d.className = 'dmg-dir';
            const r = Math.min(window.innerWidth, window.innerHeight) * 0.22;
            d.style.transform = `rotate(${ang}rad) translateY(${-r}px)`;
            this.el['damage-dirs'].appendChild(d);
            requestAnimationFrame(() => { d.style.opacity = '0'; });
            setTimeout(() => d.remove(), 1000);
        }

        setDowned(t) {
            this.el.downed.classList.toggle('hidden', t == null);
            this.downedEnd = t != null ? performance.now() + t * 1000 : 0;
        }
        updateDowned() {
            if (!this.downedEnd) return;
            this.el['downed-timer'].textContent = Math.max(0, Math.ceil((this.downedEnd - performance.now()) / 1000)) + ' s';
        }
        setDead(on, mode) {
            this.el.dead.classList.toggle('hidden', !on);
            if (on) this.el['dead-sub'].textContent = mode === 'coop' ? 'Reaparecerás al comenzar la siguiente ronda' : mode === 'duel' ? '' : '';
        }
        waitingOpponent(on) { this.el['waiting-opp'].classList.toggle('hidden', !on); }

        showScoreboard(on) {
            const sb = this.el.scoreboard;
            sb.classList.toggle('hidden', !on);
            if (!on) return;
            const m = this.game.match;
            const rows = Array.from(m.players.values()).map((p) => `<tr><td>${escapeHtml(p.name)}${p.isLocal ? ' (tú)' : ''}</td><td>${p.kills || 0}</td><td>${p.headshots || 0}</td><td>${m.mode === 'duel' ? '-' : U.formatPts(m.pointsOf(p))}</td><td>${p.isLocal ? '-' : ((this.game.session.players.get(p.id) || {}).rtt || this.game.session.rtt || 0) + ' ms'}</td></tr>`).join('');
            const r = m.mode === 'duel' ? 'DUELO' : 'RONDA ' + (m.round.r || 1);
            sb.innerHTML = `<div class="lbl" style="margin-bottom:8px">${r}${m.online ? ' · SALA ' + (this.game.session.code || '') : ''}</div><table><tr><th>GLADIADOR</th><th>BAJAS</th><th>CABEZAS</th><th>PUNTOS</th><th>PING</th></tr>${rows}</table>`;
        }

        showGameOver(ev, isHost) {
            this.game.releaseMouse();
            const el = this.el;
            el['results-title'].textContent = 'EL COLISEO HA HABLADO';
            const mins = Math.floor(ev.time / 60), secs = ev.time % 60;
            el['results-sub'].textContent = 'Sobrevivisteis hasta la ronda ' + ev.r + ' · ' + mins + ':' + String(secs).padStart(2, '0');
            el['results-table'].innerHTML = '<table><tr><th>GLADIADOR</th><th>BAJAS</th><th>CABEZAS</th><th>REANIM.</th><th>DAÑO</th><th>PUNTOS</th></tr>' +
                ev.list.map((p) => `<tr><td>${escapeHtml(p.name)}</td><td>${p.kills}</td><td>${p.hs}</td><td>${p.rev}</td><td>${p.dmg}</td><td>${U.formatPts(p.pts)}</td></tr>`).join('') + '</table>';
            el['btn-again'].textContent = 'JUGAR DE NUEVO';
            el['btn-again'].classList.toggle('hidden', !isHost);
            el.results.classList.remove('hidden');
            const best = U.storage.get('bestRound', 0);
            if (ev.r > best) U.storage.set('bestRound', ev.r);
        }

        showDuelResult(ev, players, localId, isHost) {
            this.game.releaseMouse();
            const el = this.el;
            const iWon = ev.w === localId;
            el['results-title'].textContent = iWon ? '¡VICTORIA!' : 'DERROTA';
            const w = players.get(ev.w);
            el['results-sub'].textContent = ev.forfeit ? 'Tu rival abandonó el duelo.' : (w ? w.name + ' gana el duelo' : '');
            el['results-table'].innerHTML = '<table><tr><th>GLADIADOR</th><th>RONDAS</th></tr>' +
                Object.keys(ev.sc).map((pid) => `<tr><td>${escapeHtml((players.get(pid) || { name: '—' }).name)}${pid === localId ? ' (tú)' : ''}</td><td>${ev.sc[pid]}</td></tr>`).join('') + '</table>';
            el['btn-again'].textContent = 'REVANCHA';
            el['btn-again'].classList.toggle('hidden', !isHost || !!ev.forfeit);
            el.results.classList.remove('hidden');
            if (iWon) U.storage.set('duelWins', U.storage.get('duelWins', 0) + 1);
        }

        hideResults() { this.el.results.classList.add('hidden'); }
    }

    function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
    UI.escapeHtml = escapeHtml;
    GL.UI = UI;
})();
