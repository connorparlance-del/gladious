/* Entrada: teclado, ratón, pointer lock */
(function () {
    class Input {
        constructor(canvas) {
            this.canvas = canvas;
            this.keys = new Set();
            this.pressed = new Set();     // pulsado en este frame (se consume)
            this.released = new Set();
            this.mouse = { dx: 0, dy: 0, left: false, right: false, wheel: 0 };
            this.mousePressed = { left: false, right: false };
            this.mouseReleased = { left: false, right: false };
            this.locked = false;
            this.forceActive = false;      // pruebas automáticas / sin pointer lock
            this.enabled = false;          // true mientras se juega
            this.sensitivity = GL.U.storage.get('sens', 1.0);
            this.invertY = GL.U.storage.get('invertY', false);
            this._bind();
        }

        get active() { return this.enabled && (this.locked || this.forceActive); }

        _bind() {
            const typingTarget = (e) => {
                const t = e.target;
                return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
            };
            window.addEventListener('keydown', (e) => {
                if (typingTarget(e)) return;
                if (this.enabled && ['Space', 'Tab', 'ControlLeft', 'KeyQ', 'KeyF', 'KeyE', 'KeyR'].includes(e.code)) e.preventDefault();
                if (!this.keys.has(e.code)) this.pressed.add(e.code);
                this.keys.add(e.code);
            });
            window.addEventListener('keyup', (e) => {
                this.keys.delete(e.code);
                this.released.add(e.code);
            });
            window.addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
            document.addEventListener('mousemove', (e) => {
                if (!this.active) return;
                this.mouse.dx += e.movementX || 0;
                this.mouse.dy += e.movementY || 0;
            });
            document.addEventListener('mousedown', (e) => {
                if (!this.active) return;
                if (e.button === 0) { this.mouse.left = true; this.mousePressed.left = true; }
                if (e.button === 2) { this.mouse.right = true; this.mousePressed.right = true; }
            });
            document.addEventListener('mouseup', (e) => {
                if (e.button === 0) { if (this.mouse.left) this.mouseReleased.left = true; this.mouse.left = false; }
                if (e.button === 2) { if (this.mouse.right) this.mouseReleased.right = true; this.mouse.right = false; }
            });
            document.addEventListener('contextmenu', (e) => { if (this.enabled) e.preventDefault(); });
            document.addEventListener('wheel', (e) => { if (this.active) this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
            document.addEventListener('pointerlockchange', () => {
                this.locked = document.pointerLockElement === this.canvas;
                if (!this.locked) { this.mouse.left = false; this.mouse.right = false; }
                GL.events && GL.events.emit('pointerlock', this.locked);
            });
            document.addEventListener('pointerlockerror', () => {
                GL.events && GL.events.emit('pointerlockerror');
            });
        }

        requestLock() {
            if (this.forceActive) return;
            try {
                const p = this.canvas.requestPointerLock();
                if (p && p.catch) p.catch(() => GL.events.emit('pointerlockerror'));
            } catch (e) { GL.events.emit('pointerlockerror'); }
        }
        exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

        down(code) { return this.active && this.keys.has(code); }
        hit(code) { return this.active && this.pressed.has(code); }

        consumeLook() {
            const s = GL.GAME_CONFIG.player.mouseSensitivity * this.sensitivity;
            const r = { yaw: -this.mouse.dx * s, pitch: -this.mouse.dy * s * (this.invertY ? -1 : 1) };
            this.mouse.dx = 0; this.mouse.dy = 0;
            return r;
        }

        endFrame() {
            this.pressed.clear(); this.released.clear();
            this.mousePressed.left = this.mousePressed.right = false;
            this.mouseReleased.left = this.mouseReleased.right = false;
            this.mouse.wheel = 0;
        }

        /* Inyección para pruebas automáticas (?debug=1) */
        simKey(code, isDown) { if (isDown) { if (!this.keys.has(code)) this.pressed.add(code); this.keys.add(code); } else { this.keys.delete(code); this.released.add(code); } }
        simMouse(btn, isDown) {
            if (isDown) { this.mouse[btn] = true; this.mousePressed[btn] = true; }
            else { if (this.mouse[btn]) this.mouseReleased[btn] = true; this.mouse[btn] = false; }
        }
        simLook(dx, dy) { this.mouse.dx += dx; this.mouse.dy += dy; }
    }
    GL.Input = Input;
})();
