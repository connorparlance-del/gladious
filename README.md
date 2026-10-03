# GLADIADORES

Juego de gladiadores en **primera persona** para navegador (HTML5 + JavaScript + WebGL/Three.js), con:

- **1V1 ONLINE**: duelo entre dos jugadores reales, al mejor de 5 rondas (gana quien vence 3).
- **SUPERVIVENCIA**: rondas infinitas en solitario o **cooperativo online de 2 a 4 jugadores**, con puntos, compras en las paredes, altares de mejora, galerías que se abren pagando, élites y jefes con fases.
- **Multijugador real por Internet** con salas por código (`K7X4P`): WebRTC entre navegadores + un servidor de señalización.

No hay que instalar nada para jugar: es una web estática.

---

## 1. Para el jugador (lo único que hay que saber)

```
1. Abre la página del juego.
2. Selecciona CREAR PARTIDA (o 1V1 ONLINE / SUPERVIVENCIA → crear).
3. Pulsa COPIAR CÓDIGO.
4. Comparte el código con tu amigo.
5. Tu amigo entra en la página, pulsa UNIRSE A PARTIDA y escribe el código.
6. Cuando aparezca "JUGADORES: 2/2 — ¡LISTOS!", pulsa INICIAR. A jugar.
```

Controles: **WASD** mover · **ratón** mirar · **Shift** correr · **Espacio** saltar · **Ctrl/C** agacharse · **Q** esquivar ·
**clic izq.** ataque (mantener = ataque fuerte; arco: tensar y soltar) · **clic der.** bloquear (justo a tiempo = PARADA) / apuntar ·
**F** especial del arma · **E** comprar / abrir / reanimar · **R** recargar ballesta · **1/2/rueda** cambiar arma · **Tab** marcador · **Esc** pausa.

---

## 2. Probar en local

| Forma | Qué funciona |
|---|---|
| Doble clic en `index.html` (`file://`) | Menús y **supervivencia en solitario**. El juego muestra un aviso. **No es el modo previsto para jugar online.** |
| Servidor local: `python -m http.server 8000` en la carpeta y abrir `http://localhost:8000` | Todo, incluido el online (los dos jugadores pueden ser dos pestañas o dos equipos de tu red). |

`file://` sirve para probar partes del juego, pero el método de producción es **HTTPS**:
los navegadores restringen funciones (portapapeles, algunos permisos) fuera de un contexto seguro, y tus amigos no pueden abrir un archivo de tu disco.

---

## 3. Publicar en Internet (HTTPS)

Sube **el contenido de la carpeta** (no hace falta compilar nada) a cualquier hosting estático con HTTPS:

- **GitHub Pages**: crea un repositorio, sube los archivos, *Settings → Pages → Deploy from branch*.
- **Netlify / Cloudflare Pages / Vercel**: arrastra la carpeta al panel ("deploy manual") o conecta el repositorio. Sin comando de build; directorio de publicación = raíz.
- **Tu propio hosting**: copia los archivos a `public_html` de un dominio con certificado (Let's Encrypt).

Resultado: `https://midominio.com/` → los jugadores sólo necesitan esa URL y un código de sala.

Three.js va **incluido** en `lib/` (no depende de ningún CDN).

---

## 4. Cómo funciona el multijugador

```
                    INTERNET
              ┌──────────────────┐
              │ Hosting estático │   index.html, js/, css/, lib/
              │  (HTTPS)         │
              └────────┬─────────┘
                       │ descarga del juego
              ┌────────▼─────────┐
              │ Señalización     │   PeerJS Cloud (por defecto) o tu servidor
              │ (WebSocket)      │   sólo para "presentar" a los navegadores
              │ + STUN / TURN    │
              └────────┬─────────┘
                ┌──────┴──────┐
                ▼             ▼
          PC 1 (anfitrión) ◄──WebRTC DataChannel──► PC 2 (invitado)
```

- **Señalización**: el anfitrión se registra con el ID `gladiadores-v1-<CÓDIGO>`. El invitado envía su oferta WebRTC a ese ID. Nadie introduce IPs, puertos ni IDs.
- **Partida**: viaja **directamente** entre navegadores por dos canales WebRTC: uno fiable y ordenado (eventos: ataques, daño, compras, rondas) y otro no fiable (posiciones a 15–20 Hz, donde un paquete viejo no sirve).
- El servidor de señalización **no ejecuta el juego** ni retransmite la partida.
- `js/net/signaling.js` implementa el **protocolo de PeerServer** sin la librería PeerJS, así que funciona con **PeerJS Cloud**, con el **PeerServer oficial** o con `network/signaling-server.js` (incluido, sin dependencias).

### Autoridad (anti-desincronización y anti-trampas)

El **anfitrión es la autoridad** de la partida:

| Lo decide el anfitrión | Lo decide cada cliente |
|---|---|
| Vida, daño, muertes, caídos/reanimación | Su propio movimiento (validado: velocidad máxima y límites; si no cuadra, el host lo corrige) |
| Puntos y compras (valida distancia, precio y saldo) | Detección de sus golpes ("a favor del atacante") |
| Rondas, spawn, IA, jefes, puertas, resultado del duelo | |

- El cliente **nunca envía cantidades de daño ni puntos**: envía "golpeé al objetivo X en la zona Y con el ataque Z". El host comprueba que el ataque existe, que el arma es suya, que el tiempo y la **distancia** son plausibles (con tolerancia de latencia) y que no golpea dos veces con el mismo ataque; después **calcula él el daño**.
- Proyectiles: el host registra cada disparo (gasta munición del inventario autoritativo) y comprueba que el objetivo está cerca de la trayectoria.
- Mensajes de puntos o eventos falsificados por un invitado se ignoran. Hay límite de mensajes por segundo.
- **Sincronización completa cada 2 s** (vida, puntos, armas, enemigos, ronda, puertas) y petición de estado completo si un cliente detecta que le falta información.
- **Límite honesto de P2P**: el anfitrión es un navegador más; quien hospeda podría hacer trampas en su propia máquina. Para eliminarlo haría falta un servidor de juego dedicado.

### Desconexiones

- **Invitado pierde conexión**: ve *CONEXIÓN PERDIDA — Intentando reconectar…* y se reconecta solo (25 s de margen). El anfitrión le guarda su puesto, puntos y armas.
- **Duelo**: si el rival no vuelve en 25 s, victoria por abandono.
- **El anfitrión se cae**: los invitados intentan reconectar 25 s; si no vuelve, la partida termina de forma controlada con un mensaje claro. **No hay migración de anfitrión**: el estado autoritativo (enemigos, IA, rondas) vive en su navegador y no se transfiere. Es una mejora posible pero no está implementada.
- Si se cae el WebSocket de señalización, la partida en curso **sigue** (WebRTC es independiente) y se reconecta en segundo plano.

---

## 5. Configurar la red (producción)

Toda la configuración está en `js/config.js` → `GL.NETWORK_CONFIG`. Para no tocarlo, puedes sobrescribir en **`js/network-config.js`** (ya incluido, todo comentado) o por URL: `?sig=host&sigport=443&sigpath=/&sigkey=peerjs&sigsecure=1`.

### 5.1 Señalización

**Por defecto: PeerJS Cloud** (`0.peerjs.com`, gratuito). Dependencia externa a tener en cuenta:
es un servicio público **sin garantías de disponibilidad**; el propio proyecto PeerJS recomienda un servidor propio para producción. Si un día deja de responder, crear/unirse fallará con un mensaje claro ("No se pudo contactar con el servidor de señalización").

**Recomendado para producción: tu propio servidor** (cualquiera de los dos):

- `network/signaling-server.js` (incluido, **cero dependencias**, Node ≥ 16):
  ```
  cd network
  node signaling-server.js          # puerto 9000 (o PORT=xxxx)
  ```
  Despliégalo en un servicio con HTTPS (Render, Fly.io, Railway, un VPS con Caddy/Nginx). Hay `package.json` (comando `npm start`) y `Dockerfile`. Variables: `PORT`, `KEY` (por defecto `peerjs`), `BASE_PATH` (por defecto `/`), `MAX_CLIENTS`.
- PeerServer oficial: `npx peer --port 9000` (requiere npm en *ese* servidor, no en los jugadores).

Luego en `js/network-config.js`:
```js
GL.NETWORK_CONFIG.signaling.host = 'senal.midominio.com';
GL.NETWORK_CONFIG.signaling.port = 443;
GL.NETWORK_CONFIG.signaling.secure = true;   // wss:// (obligatorio si la web es https)
```

### 5.2 STUN y TURN

- **STUN** (incluido: servidores públicos de Google y Twilio) permite descubrir la IP pública. Basta para la mayoría de conexiones domésticas.
- **TURN** retransmite el tráfico cuando la conexión directa es imposible (NAT simétrico, redes corporativas/universitarias, algunas redes móviles). **Sin TURN, esos jugadores no podrán conectarse** y verán: *"La conexión directa entre equipos falló (NAT o firewall). Hace falta configurar un servidor TURN"*.
- TURN consume ancho de banda del proveedor, por eso no hay uno gratuito incluido. Opciones: un proveedor comercial (Cloudflare Calls TURN, Twilio Network Traversal, Metered…) o **coturn** propio (ejemplo en `network/turnserver.conf.example`).
- Añádelo en `js/network-config.js`:
  ```js
  GL.NETWORK_CONFIG.iceServers.push({
      urls: ['turn:turn.midominio.com:3478?transport=udp', 'turns:turn.midominio.com:5349'],
      username: 'usuario', credential: 'clave'
  });
  ```
- **Credenciales**: este archivo es público (lo descarga cualquier jugador). No pongas claves de cuentas de pago. Usa credenciales TURN temporales o de bajo privilegio (coturn `use-auth-secret`, o la API de credenciales efímeras de tu proveedor).
- Para probar que tu TURN funciona: `GL.NETWORK_CONFIG.iceTransportPolicy = 'relay'` fuerza a usarlo.

---

## 6. Contenido del juego

**Coliseo**: arena elíptica con gradas animadas (público que reacciona), fachada con arcos, 6 túneles de entrada (spawn), 2 **galerías laterales** cerradas por rastrillo (se abren con puntos y contienen armas pesadas y altares), plataformas de madera elevadas con escaleras y paso por debajo, estrado central con estatua, columnas rotas, barricadas, cajas, carros, **trampas de fuego** periódicas (dañan también a los enemigos), antorchas, estandartes. Todo con colisiones; la IA navega por suelo y plataformas.

**Combate**: hitboxes independientes por zona (**cabeza ×2, torso ×1, brazos ×0.65, piernas ×0.7**) ancladas a los huesos animados; detección de golpes por **barrido** entre la posición anterior y la actual de la hoja (sin atravesar enemigos con golpes rápidos); críticos; armadura; escudos (bloquean de frente; armas pesadas rompen la guardia); bloqueo con coste de resistencia; **parada** (bloquear justo antes del impacto aturde al atacante); aturdimiento; esquiva con invulnerabilidad breve; ataques por la espalda; búfer de entrada.

**Armas (12)**: daga, gladius, espada larga, espada pesada, hacha, hacha pesada, maza, martillo de guerra, lanza, arco, ballesta, jabalinas. Cada una con daño, alcance, peso, tiempos de preparación/impacto/recuperación, coste de resistencia y **ataque especial** (doble estocada, corte giratorio, torbellino, onda de choque, aturdir, embestida, tres flechas, virote perforante, lanzamiento potente).

**Enemigos (7 + élite)**: gladiador básico, rápido (golpea y huye en zigzag), escudero (avanza cubierto y baja el escudo para atacar), pesado (lento, golpes que se anuncian), lancero (mantiene distancia), arquero (se aleja, busca línea de visión y predice tu movimiento), berserker (se enfurece con poca vida); **élites** dorados más fuertes. IA con campos de flujo multinivel (sube escaleras y plataformas), flanqueo cuando son muchos, retirada, reposicionamiento y actualización escalonada.

**Jefes** (cada 10 rondas, alternando): **El Campeón del Coliseo** (combos, salto con onda expansiva, carga; fase 3 enfurecido e invoca refuerzos) y **El Verdugo** (golpes demoledores, torbellino, terremoto, lanzamiento de hachas). Entrada especial, barra de vida con fases, sonidos propios. Para añadir uno: entrada en `GL.BOSS_CONFIG` + comportamiento en `js/ai/bosses.js`.

**Rondas infinitas**: `GL.calculateDifficulty(round, players)` en `js/config.js` calcula cantidad, vida, daño, velocidad, velocidad de ataque, ritmo de aparición, agresividad, tipos disponibles (ronda 3 rápidos, 4 escuderos, 5 arqueros y pesados, 6 lanceros, 8 berserkers), probabilidad de élite (desde la 7) y jefes/mini-jefes. Escala con el número de jugadores.

**Puntos**: por golpe, crítico, decapitación, baja (más por élites), rachas, ronda superada, reanimar y jefes. Se gastan en armas de pared (la munición se repone a mitad de precio), altares (vida, armadura, furia, velocidad/resistencia), fuente de curación y puertas de galería. Opción `sharedPoints` para un fondo común del equipo.

**Audio**: todo sintetizado en tiempo real (ambiente del público, pasos, armas, impactos según superficie, bloqueos, paradas, cuernos de ronda, tambores y rugidos de jefe). Sin archivos con copyright.

---

## 7. Estructura del proyecto

```
index.html                 menús, HUD y carga de scripts
css/style.css
lib/three.min.js           Three.js r160 (MIT) incluido
js/config.js               CONFIGURACIÓN CENTRAL: red, juego, armas, enemigos, jefes, rondas, tienda
js/network-config.js       sobrescrituras de red para producción (opcional)
js/core/                   util, input, audio (sintetizado), texturas procedurales
js/world/                  physics (colisiones/raycast), arena (coliseo), nav (rejilla + campos de flujo)
js/combat/                 character (esqueleto, animación, hitboxes), hitbox (barridos), damage, projectiles, weaponModels
js/player/                 playerController (FPS), weaponSystem (ataques), viewmodel (brazos y arma)
js/ai/                     enemyAI (comportamientos), enemies (host/cliente), bosses (fases y especiales)
js/game/                   match (reglas y autoridad), waveManager (rondas), shop (compras)
js/net/                    signaling (protocolo PeerServer), peerLink (WebRTC), session (salas, reconexión)
js/ui/                     ui (HUD), menus
js/main.js                 bucle principal (paso fijo de 60 Hz)
network/                   servidor de señalización opcional, Dockerfile, ejemplo de coturn
tests/                     pruebas automáticas (sólo desarrollo)
```

Se usan scripts clásicos (no módulos ES) a propósito: así el modo solitario también funciona con `file://`.

---

## 8. Qué se ha probado y qué no

Pruebas automáticas en `tests/` (Chromium sin interfaz + renderizado por CPU; `tests/run_all.sh`). Las pruebas online usan **dos (o tres) procesos de navegador independientes**, conexiones **WebRTC reales** y el servidor de señalización `network/signaling-server.js` en la misma máquina.

**Verificado:**
- Solitario (14/14): inicio, WASD, ratón, golpes por barrido con zonas (torso/cabeza), muerte de enemigos, puntos, daño enemigo al jugador, compra en pared, jabalina.
- Armas (14/14): las 12 armas con ataque ligero, fuerte y especial; disparo, munición e impacto a distancia; el escudo enemigo reduce el daño frontal (2 frente a 30).
- Supervivencia (19/19): curva de dificultad monótona y tipos por ronda; la IA llega hasta el jugador y le golpea; el arquero mantiene distancia y dispara; coste de IA con 20 enemigos ≈ 0,8 ms/tick (mediana); jefe en ronda 10 y 20, cambios de fase, especiales y refuerzos, puntos por jefe.
- Duelo online (22/22): crear sala y código, unirse (≈ 0,2–2 s), código inexistente y sala llena con mensaje claro, inicio y cuenta atrás sincronizados, armas del lobby, movimiento y rotación en ambos sentidos, daño en ambos sentidos validado por el host, bloqueo, rechazo de golpes imposibles, fin de ronda y reaparición, detección de abandono y victoria por abandono.
- Cooperativo online (20/20): mismos enemigos (mismos IDs, error de posición 0,000 m con IA quieta), golpes del invitado validados por el host, puntos otorgados por el host, puntos falsificados ignorados, compra del invitado, puerta de galería, cambio de ronda, caído y reanimación, **reconexión automática del invitado** conservando puntos y ronda, caída del anfitrión con final controlado.
- 3 jugadores (8/8): un tercero se une a una partida ya en curso, recibe el estado completo y aparece en la siguiente ronda.
- Carga desde `file://` (solitario) sin errores.
- Nota de transparencia: una vez, con la máquina muy cargada, la prueba de duelo falló porque el invitado atacó antes de recibir la nueva posición del rival tras un teletransporte de prueba. No se reprodujo en 5 repeticiones posteriores; la prueba ahora espera a que la vista del invitado converja (como ocurre jugando).

**NO verificado (limitaciones del entorno de desarrollo; no lo presento como comprobado):**
- **Dos ordenadores en redes distintas a través de Internet.** Las pruebas WebRTC fueron entre procesos de la misma máquina.
- **PeerJS Cloud** (`0.peerjs.com`): el entorno no tenía acceso a ese servidor. El cliente implementa el mismo protocolo (verificado contra el código fuente de PeerServer y contra el servidor incluido), pero la conexión real con PeerJS Cloud está sin probar.
- **TURN**: no había un servidor TURN disponible. La configuración está preparada pero sin probar.
- **Rendimiento con GPU real**: las pruebas usan renderizado por CPU (muy lento). Datos útiles: ~105 *draw calls* en la pasada principal con la arena vacía (geometría estática fusionada) y ~470 con 20 enemigos en pantalla. Firefox, Edge y Safari no se probaron (sólo Chromium).

**Primera prueba real recomendada**: publica la web en HTTPS, abre la página en dos equipos de redes distintas (por ejemplo, uno con datos móviles) y crea/une una partida. Si falla con el mensaje de NAT/firewall, configura TURN (apartado 5.2). Si falla la señalización, despliega tu propio servidor (5.1).

---

## 9. Limitaciones conocidas

- Sin migración de anfitrión (ver apartado 4).
- Las animaciones son **procedurales** (no hay modelos animados en el proyecto; no se han inventado archivos). Incluyen reposo, caminar, correr, ataques ligero/fuerte/especial, bloqueo, golpe recibido, aturdimiento, caída, muerte, equipar y cambiar arma.
- No hay LOD por distancia en los personajes; se usa *frustum culling*, geometría estática fusionada, partículas en un solo *draw call*, *pooling* de proyectiles/manchas y IA escalonada.
- En P2P el anfitrión podría hacer trampas en su propia máquina.
- Optimizado para escritorio con ratón y teclado.

---

## 10. Desarrollo

- Ajustes de equilibrio: `js/config.js` (armas, enemigos, jefes, rondas, puntos, precios, red).
- Modo depuración: `?debug=1` expone `window.GLDEBUG` (estado, teletransporte, generar enemigos, saltar rondas). `&fast=1` sólo renderiza bajo demanda (para pruebas).
- Pruebas: `pip install playwright && playwright install chromium`, luego `tests/run_all.sh`.

Licencias: código del juego propio; Three.js © autores de Three.js, licencia MIT (`lib/LICENSE-three.txt`).
