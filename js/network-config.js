/* =====================================================================
 *  CONFIGURACIÓN DE RED DE PRODUCCIÓN (opcional)
 *  Este archivo se carga después de config.js. Descomenta y edita lo que
 *  necesites para usar tu propio servidor de señalización o tu TURN.
 *  NO pongas aquí claves privadas de pago: este archivo es público.
 *  Para TURN usa credenciales temporales o de bajo privilegio (ver README).
 * ===================================================================== */

// --- Servidor de señalización propio (network/signaling-server.js o PeerServer) ---
// GL.NETWORK_CONFIG.signaling.host = 'senal.midominio.com';
// GL.NETWORK_CONFIG.signaling.port = 443;
// GL.NETWORK_CONFIG.signaling.path = '/';
// GL.NETWORK_CONFIG.signaling.secure = true;
// GL.NETWORK_CONFIG.signaling.key = 'peerjs';

// --- Servidor TURN (necesario para algunos jugadores tras NAT simétrico/firewall) ---
// GL.NETWORK_CONFIG.iceServers.push({
//     urls: ['turn:turn.midominio.com:3478?transport=udp', 'turn:turn.midominio.com:3478?transport=tcp', 'turns:turn.midominio.com:5349'],
//     username: 'usuario',
//     credential: 'clave'
// });
