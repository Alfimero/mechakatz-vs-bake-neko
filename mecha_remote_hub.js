'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const PORT = parseInt(process.env.MECHA_REMOTE_PORT || '8765', 10);
const MAX_PLAYERS = 4;
const MOBILE_PATH = path.join(__dirname, 'mobile-controller.html');
const MOBILE_HTML = fs.readFileSync(MOBILE_PATH, 'utf8');

// Configuracion de WIFI para el QR de la red.
// La landing page muestra un QR que iOS/Android escanean para unirse a la red.
// Por defecto el hub AUTODETECTA la red WiFi a la que esta conectada esta PC
// (Windows, via netsh), asi no hay que reconfigurar nada al cambiar de venue.
// Para forzar valores manuales, define MECHA_WIFI_SSID (y opcionalmente
// MECHA_WIFI_PASS / MECHA_WIFI_AUTH). Para apagar la autodeteccion sin fijar
// una red, usa MECHA_WIFI_AUTODETECT=false.
// Formato del payload del QR: WIFI:T:WPA;S:<ssid>;P:<password>;H:<hidden>;;
// Auth values: WPA, WEP, nopass
const ENV_WIFI_SSID = process.env.MECHA_WIFI_SSID || '';
const ENV_WIFI_PASS = process.env.MECHA_WIFI_PASS || '';
const ENV_WIFI_AUTH = (process.env.MECHA_WIFI_AUTH || 'WPA').toUpperCase();
const ENV_WIFI_HIDDEN = (process.env.MECHA_WIFI_HIDDEN || 'false').toLowerCase() === 'true';
// Autodetecta salvo que se fije SSID manual o se desactive explicitamente.
const WIFI_AUTODETECT = !ENV_WIFI_SSID &&
  (process.env.MECHA_WIFI_AUTODETECT || 'true').toLowerCase() !== 'false';

// Estado vivo de la red WiFi mostrada en el QR: lo llena el modo manual
// (variables de entorno) o la autodeteccion (refreshWifiInfo).
let wifiInfo = {
  ssid: ENV_WIFI_SSID,
  pass: ENV_WIFI_PASS,
  auth: ENV_WIFI_AUTH,
  hidden: ENV_WIFI_HIDDEN,
  source: ENV_WIFI_SSID ? 'env' : (WIFI_AUTODETECT ? 'auto' : 'none')
};

function escapeWifiField(value){
  // Spec: backslash-escape los caracteres ; , : " \
  return String(value || '').replace(/([\\;,:"])/g, '\\$1');
}
function buildWifiQrPayload(){
  if(!wifiInfo.ssid) return '';
  const auth = (wifiInfo.auth || 'WPA').toUpperCase();
  const t = auth === 'NOPASS' || auth === 'NONE' ? 'nopass' : auth;
  const s = escapeWifiField(wifiInfo.ssid);
  const p = t === 'nopass' ? '' : escapeWifiField(wifiInfo.pass);
  const h = wifiInfo.hidden ? 'true' : 'false';
  return `WIFI:T:${t};S:${s};${p ? `P:${p};` : ''}H:${h};;`;
}

// --- Autodeteccion de la red WiFi conectada (solo Windows, via netsh) ---
function parseNetshSsid(text){
  // El nombre de campo "SSID" no se localiza; evita la linea "BSSID".
  const m = text.match(/^\s*SSID\s*:\s*(.+?)\s*$/m);
  return m ? m[1].trim() : '';
}
function parseNetshKey(text){
  // "Key Content" (EN) / "Contenido de la clave" (ES) en `show profile key=clear`.
  const m = text.match(/(?:Key Content|Contenido de la clave)\s*:\s*(.+?)\s*$/m);
  return m ? m[1].trim() : '';
}
function detectWindowsWifi(cb){
  if(process.platform !== 'win32') return cb(null);
  execFile('netsh', ['wlan', 'show', 'interfaces'], { windowsHide:true, timeout:4000 }, (err, stdout) => {
    if(err || !stdout) return cb(null);
    const ssid = parseNetshSsid(stdout.toString());
    if(!ssid) return cb(null);
    execFile('netsh', ['wlan', 'show', 'profile', `name=${ssid}`, 'key=clear'], { windowsHide:true, timeout:4000 }, (err2, stdout2) => {
      const pass = (!err2 && stdout2) ? parseNetshKey(stdout2.toString()) : '';
      cb({ ssid, pass, auth: pass ? 'WPA' : 'NOPASS', hidden:false });
    });
  });
}
function refreshWifiInfo(){
  if(!WIFI_AUTODETECT) return; // modo manual o autodeteccion apagada
  detectWindowsWifi(info => {
    const prevSsid = wifiInfo.ssid;
    if(info && info.ssid){
      wifiInfo = { ...info, source:'auto' };
      if(info.ssid !== prevSsid){
        console.log(`WiFi autodetectada: SSID="${info.ssid}"${info.pass ? '' : ' (red abierta)'}`);
      }
    } else if(prevSsid){
      // Se perdio la conexion WiFi: limpiamos para no mostrar un QR obsoleto.
      wifiInfo = { ssid:'', pass:'', auth:'WPA', hidden:false, source:'auto' };
      console.log('WiFi autodetectada: sin red conectada (QR de WiFi oculto).');
    }
  });
}

const clients = {
  host: null,
  controllers: Array.from({ length: MAX_PLAYERS }, () => null)
};
const SLOT_DENY_DELAY_MS = 120;

function getLanIp(){
  const nets = os.networkInterfaces();
  for(const group of Object.values(nets)){
    for(const entry of group || []){
      if(entry && entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return '127.0.0.1';
}

function controllerUrls(){
  const ip = getLanIp();
  const base = `http://${ip}:${PORT}`;
  return {
    roomUrl: `${base}/`,
    joinUrls: Array.from({ length: MAX_PLAYERS }, (_, idx) => `${base}/mobile-controller.html?player=${idx}`)
  };
}

function serverInfo(){
  const { roomUrl, joinUrls } = controllerUrls();
  return {
    type: 'server_info',
    roomUrl,
    joinUrls,
    controllers: clients.controllers.map(Boolean)
  };
}

function sendJson(client, payload){
  if(!client || client.closed) return;
  const text = JSON.stringify(payload);
  const data = Buffer.from(text, 'utf8');
  let header = null;
  if(data.length < 126){
    header = Buffer.from([0x81, data.length]);
  } else if(data.length < 65536){
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  client.socket.write(Buffer.concat([header, data]));
}
function sendPong(client, payload = Buffer.alloc(0)){
  if(!client || client.closed) return;
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let header = null;
  if(data.length < 126){
    header = Buffer.from([0x8a, data.length]);
  } else {
    header = Buffer.alloc(4);
    header[0] = 0x8a;
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
  }
  client.socket.write(Buffer.concat([header, data]));
}

function closeClient(client){
  if(!client || client.closed) return;
  client.closed = true;
  try { client.socket.end(); } catch(error){}
}

function notifyHost(payload){
  sendJson(clients.host, payload);
}

function broadcastControllers(payload){
  for(const controller of clients.controllers) sendJson(controller, payload);
}
function pumpClientBuffer(client){
  while(true){
    const frame = extractFrame(client.buffer);
    if(!frame) break;
    client.buffer = frame.rest;
    if(frame.opcode === 0x8){
      closeClient(client);
      return;
    }
    if(frame.opcode === 0x9){
      sendPong(client, frame.payload);
      continue;
    }
    if(frame.opcode !== 0x1) continue;
    handlePayload(client, frame.payload.toString('utf8'));
  }
}

function renderLandingPage(){
  const { roomUrl, joinUrls } = controllerUrls();
  const wifiPayload = buildWifiQrPayload();
  const wifiQrUrl = wifiPayload
    ? `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(wifiPayload)}`
    : '';
  const autoTag = wifiInfo.source === 'auto' ? ' <span style="opacity:.7">(autodetectada)</span>' : '';
  const wifiBlock = wifiPayload ? `
    <section class="wifi-card">
      <div class="step-tag">PASO 1</div>
      <h2>Conectarse a la red ${wifiInfo.ssid}${autoTag}</h2>
      <p class="wifi-hint">Apunta la camara del telefono a este QR. iPhone y la mayoria de Androids ofrecen "Unirse a la red" automaticamente.</p>
      <img class="wifi-qr" src="${wifiQrUrl}" alt="QR para unirse a ${wifiInfo.ssid}">
      <div class="wifi-meta">
        <div><strong>SSID:</strong> ${wifiInfo.ssid}</div>
        ${wifiInfo.pass ? `<div><strong>Password:</strong> <code class="inline">${wifiInfo.pass}</code></div>` : '<div><strong>Red abierta (sin password)</strong></div>'}
        <div><strong>Auth:</strong> ${wifiInfo.auth}</div>
      </div>
    </section>` : `
    <section class="wifi-card warn">
      <h2>Red WiFi no detectada</h2>
      <p class="wifi-hint">${WIFI_AUTODETECT
        ? 'Esta PC no parece estar conectada por WiFi, asi que no hay red que compartir por QR. Conecta el host a la WiFi del venue (o pasa <code class="inline">MECHA_WIFI_SSID</code> manualmente). El QR se actualiza solo al detectar la red.'
        : 'Inicia el hub con las variables de entorno <code class="inline">MECHA_WIFI_SSID</code>, <code class="inline">MECHA_WIFI_PASS</code> y opcionalmente <code class="inline">MECHA_WIFI_AUTH</code> (WPA / WEP / NOPASS).'}
      Mientras tanto, los celulares ya conectados a la misma red pueden usar los QR de cabina.</p>
    </section>`;

  const cards = joinUrls.map((url, idx) => {
    const qr = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(url)}`;
    return `<section class="card" data-player="${idx}">
        <h2>P${idx + 1} Cockpit</h2>
        <div class="qr-wrap">
          <img src="${qr}" alt="QR P${idx + 1}">
          <div class="qr-claimed-overlay">
            <div class="claimed-badge">CLAIMED</div>
            <div class="claimed-sub">P${idx + 1} ya esta conectado</div>
          </div>
        </div>
        <code>${url}</code>
      </section>`;
  }).join('');
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MechaKatz Remote Hub</title>
<style>
  :root{
    --bg:#07000d;
    --cyan:#00f0ff;
    --pink:#ff2e88;
    --yellow:#ffea00;
    --green:#00ff7f;
  }
  *{box-sizing:border-box}
  body{
    margin:0;
    min-height:100vh;
    background:
      radial-gradient(circle at top,rgba(255,46,136,.15),transparent 34%),
      radial-gradient(circle at bottom right,rgba(0,240,255,.14),transparent 32%),
      linear-gradient(180deg,#120022 0%,var(--bg) 100%);
    color:var(--cyan);
    font-family:Consolas,monospace;
  }
  .wrap{
    width:min(1100px,92vw);
    margin:0 auto;
    padding:32px 0 48px;
  }
  h1{
    margin:0 0 10px;
    color:var(--yellow);
    letter-spacing:.08em;
    text-transform:uppercase;
  }
  .lead{
    margin:0 0 22px;
    font-size:18px;
    line-height:1.45;
    color:#c5faff;
  }
  .step-tag{
    display:inline-block;
    background:var(--yellow);
    color:#000;
    padding:4px 12px;
    font-weight:700;
    letter-spacing:.16em;
    margin-bottom:10px;
    font-size:14px;
  }
  .wifi-card{
    margin:0 0 22px;
    padding:24px;
    border:2px solid var(--yellow);
    background:linear-gradient(135deg,rgba(255,234,0,.08),rgba(0,240,255,.04));
    box-shadow:0 0 30px rgba(255,234,0,.18);
    text-align:center;
  }
  .wifi-card.warn{
    border-color:rgba(255,80,80,.5);
    background:rgba(255,80,80,.06);
    text-align:left;
  }
  .wifi-card h2{
    color:var(--yellow);
    font-size:24px;
    margin:0 0 8px;
  }
  .wifi-card.warn h2{color:#ff8080}
  .wifi-hint{
    margin:0 0 14px;
    color:#fff6c0;
    font-size:16px;
    line-height:1.4;
  }
  .wifi-qr{
    display:block;
    margin:8px auto 14px;
    width:min(320px,80%);
    background:#fff;
    padding:12px;
  }
  .wifi-meta{
    display:flex;
    flex-wrap:wrap;
    gap:12px;
    justify-content:center;
    color:#fff;
    font-size:15px;
  }
  .wifi-meta strong{color:var(--green)}
  .inline{
    display:inline-block;
    padding:1px 6px;
    background:#030308;
    border:1px solid rgba(255,255,255,.1);
    color:#fff;
  }
  .step-divider{
    margin:28px 0 14px;
    text-align:center;
    color:var(--pink);
    letter-spacing:.18em;
    font-size:14px;
  }
  .grid{
    display:grid;
    grid-template-columns:repeat(auto-fit,minmax(280px,1fr));
    gap:20px;
  }
  .card{
    padding:18px;
    border:1px solid rgba(0,240,255,.34);
    background:rgba(0,0,0,.38);
    box-shadow:0 0 24px rgba(0,240,255,.08);
  }
  .card h2{
    margin:0 0 10px;
    color:var(--pink);
    font-size:24px;
  }
  img{
    display:block;
    width:100%;
    max-width:280px;
    margin:14px auto;
    background:#fff;
    padding:10px;
  }
  code{
    display:block;
    overflow-wrap:anywhere;
    padding:10px;
    background:#030308;
    border:1px solid rgba(255,255,255,.1);
    color:#fff;
  }
  .meta{
    margin-top:22px;
    padding:16px 18px;
    border:1px solid rgba(255,234,0,.24);
    background:rgba(255,234,0,.06);
    color:#fff6c0;
    line-height:1.55;
  }
  strong{color:var(--green)}
  .qr-wrap{position:relative}
  .qr-claimed-overlay{
    position:absolute;
    inset:14px auto auto 50%;
    transform:translateX(-50%);
    width:280px;
    height:280px;
    display:none;
    flex-direction:column;
    align-items:center;
    justify-content:center;
    background:rgba(7,0,13,.88);
    color:var(--green);
    text-align:center;
  }
  .card.claimed{opacity:.55}
  .card.claimed .qr-claimed-overlay{display:flex}
  .card.claimed h2{color:var(--green)}
  .claimed-badge{
    font-size:42px;
    letter-spacing:.16em;
    color:var(--green);
    font-weight:700;
    text-shadow:0 0 12px rgba(0,255,127,.55);
  }
  .claimed-sub{
    margin-top:14px;
    font-size:16px;
    color:#c5faff;
  }
</style>
</head>
<body>
  <div class="wrap">
    <h1>MechaKatz Remote Hub</h1>
    <p class="lead">Deja este servidor corriendo y abre el juego en el navegador del host. Los espectadores escanean primero el QR de WiFi (si existe) y despues uno de los cuatro QR de cabina para abrir su control.</p>
    ${wifiBlock}
    <div class="step-divider">${wifiPayload ? 'PASO 2 ' : ''}--- ELIGE TU CABINA ---</div>
    <div class="grid">
      ${cards}
    </div>
    <div class="meta">
      <div><strong>Room page:</strong> ${roomUrl}</div>
      <div><strong>WS host URL para el juego:</strong> ws://127.0.0.1:${PORT}/ws?role=host</div>
      <div>Si el QR no aparece por falta de internet, los enlaces directos siguen funcionando por LAN.</div>
    </div>
  </div>
<script>
(function pollClaimedSlots(){
  const cards = Array.from(document.querySelectorAll('.card[data-player]'));
  async function refresh(){
    try {
      const res = await fetch('/host-info', { cache:'no-store' });
      if(!res.ok) return;
      const info = await res.json();
      const controllers = Array.isArray(info.controllers) ? info.controllers : [];
      cards.forEach(card => {
        const p = parseInt(card.dataset.player, 10);
        const claimed = controllers[p] === true;
        card.classList.toggle('claimed', claimed);
      });
    } catch(_) { /* sin red local: no pasa nada, reintenta luego */ }
  }
  // Seed inicial: usar valores serializados con el HTML
  const initial = ${JSON.stringify(clients.controllers.map(Boolean))};
  cards.forEach(card => {
    const p = parseInt(card.dataset.player, 10);
    if(initial[p]) card.classList.add('claimed');
  });
  setInterval(refresh, 1500);
  refresh();
})();
</script>
</body>
</html>`;
}

function serve(req, res){
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if(parsed.pathname === '/' || parsed.pathname === '/index.html'){
    const html = renderLandingPage();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }
  if(parsed.pathname === '/mobile-controller.html'){
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(MOBILE_HTML);
    return;
  }
  if(parsed.pathname === '/host-info'){
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(serverInfo()));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

function acceptKey(key){
  return crypto.createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`, 'binary')
    .digest('base64');
}

function extractFrame(buffer){
  if(buffer.length < 2) return null;
  const first = buffer[0];
  const second = buffer[1];
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let offset = 2;
  let length = second & 0x7f;

  if(length === 126){
    if(buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if(length === 127){
    if(buffer.length < 10) return null;
    length = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }

  const maskBytes = masked ? 4 : 0;
  if(buffer.length < offset + maskBytes + length) return null;

  const mask = masked ? buffer.subarray(offset, offset + 4) : null;
  const rawPayload = buffer.subarray(offset + maskBytes, offset + maskBytes + length);
  const payload = masked ? Buffer.alloc(length) : rawPayload;
  if(masked){
    for(let i = 0; i < rawPayload.length; i++) payload[i] = rawPayload[i] ^ mask[i % 4];
  }

  return {
    opcode,
    payload,
    rest: buffer.subarray(offset + maskBytes + length)
  };
}

function releaseClient(client){
  if(!client) return;
  if(client.role === 'host' && clients.host === client){
    clients.host = null;
  }
  if(client.role === 'controller' && Number.isInteger(client.player) && clients.controllers[client.player] === client){
    clients.controllers[client.player] = null;
    notifyHost({ type:'controller_left', player:client.player });
  }
  client.closed = true;
}

function handlePayload(client, text){
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch(error){
    return;
  }
  if(!payload || !payload.type) return;

  if(client.role === 'host'){
    if(payload.type === 'host_hello'){
      sendJson(client, serverInfo());
      return;
    }
    if(payload.type === 'snapshot'){
      broadcastControllers(payload);
      return;
    }
    if(payload.type === 'toast'){
      broadcastControllers(payload);
      return;
    }
    return;
  }

  if(client.role === 'controller'){
    if(payload.type === 'input' && typeof payload.action === 'string'){
      notifyHost({
        type:'controller_input',
        player: client.player,
        action: payload.action,
        state: !!payload.state
      });
      return;
    }
    if(payload.type === 'request_snapshot'){
      notifyHost({ type:'request_snapshot' });
    }
  }
}

function registerSocket(req, socket, head){
  const headers = req && req.headers ? req.headers : {};
  const requestUrl = req && typeof req.url === 'string' ? req.url : '/';
  const host = typeof headers.host === 'string' && headers.host ? headers.host : 'localhost';
  const parsed = new URL(requestUrl, `http://${host}`);
  const role = parsed.searchParams.get('role');
  const player = parsed.searchParams.has('player') ? parseInt(parsed.searchParams.get('player'), 10) : null;
  const clientId = parsed.searchParams.get('client') || '';
  const wsKey = headers['sec-websocket-key'];

  if(!wsKey || parsed.pathname !== '/ws' || !['host', 'controller'].includes(role)){
    socket.destroy();
    return;
  }
  if(role === 'controller' && !(Number.isInteger(player) && player >= 0 && player < MAX_PLAYERS)){
    socket.destroy();
    return;
  }

  socket.setNoDelay(true);
  socket.setKeepAlive(true, 15000);

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${acceptKey(wsKey)}\r\n` +
    '\r\n'
  );

  const client = {
    socket,
    role,
    player,
    clientId,
    buffer: head && head.length ? Buffer.from(head) : Buffer.alloc(0),
    closed: false
  };

  if(role === 'host'){
    if(clients.host && clients.host !== client){
      // Ya habia un host: el nuevo toma el control (permite reload/recuperacion),
      // pero avisamos al viejo con host_superseded para que se quede quieto en
      // vez de reconectar en bucle. Sin esto, dos pestanas/instancias del juego
      // pelean por el slot de host y quedan conectando/desconectando sin parar.
      sendJson(clients.host, { type:'host_superseded' });
      closeClient(clients.host);
    }
    clients.host = client;
    sendJson(client, serverInfo());
  } else {
    const currentOwner = clients.controllers[player];
    if(currentOwner){
      const sameDevice = !!clientId && !!currentOwner.clientId && currentOwner.clientId === clientId;
      if(!sameDevice){
        sendJson(client, { type:'slot_denied', player, reason:'occupied' });
        setTimeout(() => closeClient(client), SLOT_DENY_DELAY_MS);
        return;
      }
      closeClient(currentOwner);
    }
    clients.controllers[player] = client;
    sendJson(client, { ...serverInfo(), player });
    notifyHost({ type:'controller_joined', player });
  }

  socket.on('data', chunk => {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    pumpClientBuffer(client);
  });

  socket.on('close', () => releaseClient(client));
  socket.on('end', () => releaseClient(client));
  socket.on('error', () => releaseClient(client));
  if(client.buffer.length) pumpClientBuffer(client);
}

function warnLoopbackHijacked(){
  console.error('');
  console.error('==================================================================');
  console.error(`  !! OTRO PROCESO YA RESPONDE EN 127.0.0.1:${PORT}`);
  console.error('  El juego se conecta a esa direccion (ws://127.0.0.1:' + PORT + '),');
  console.error('  asi que NO podra conectarse a este hub mientras ese proceso');
  console.error('  siga vivo (los celulares por la IP LAN si llegan, el juego no).');
  console.error('  Causa tipica: un "python -m http.server ' + PORT + '" u otro');
  console.error('  servidor ocupando el puerto. Cierralo y reinicia el hub, o usa');
  console.error('  otro puerto con la variable de entorno MECHA_REMOTE_PORT.');
  console.error('==================================================================');
  console.error('');
}

// Auto-diagnostico: en Windows un socket atado a 127.0.0.1 (p.ej. un python
// http.server) gana sobre nuestro wildcard 0.0.0.0 para las conexiones de
// loopback, sin disparar EADDRINUSE. El juego conecta por 127.0.0.1, asi que
// nos conectamos a nosotros mismos y confirmamos que quien responde somos
// nosotros; si no, avisamos fuerte en vez de fallar en silencio.
function verifyLoopbackOwnership(){
  let settled = false;
  const done = hijacked => {
    if(settled) return;
    settled = true;
    if(hijacked) warnLoopbackHijacked();
  };
  const req = http.get({ host:'127.0.0.1', port:PORT, path:'/host-info', timeout:2000 }, res => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', chunk => { if(body.length < 4096) body += chunk; });
    res.on('end', () => {
      let ok = false;
      try { const info = JSON.parse(body); ok = !!info && info.type === 'server_info'; } catch(error){ ok = false; }
      done(!ok);
    });
  });
  req.on('timeout', () => { req.destroy(); done(true); });
  req.on('error', () => done(true));
}

const server = http.createServer(serve);
server.keepAliveTimeout = 0;
server.headersTimeout = 65000;
server.on('upgrade', registerSocket);
server.on('error', err => {
  if(err && err.code === 'EADDRINUSE'){
    console.error('');
    console.error(`ERROR: el puerto ${PORT} ya esta en uso. Ya hay un hub (u otro`);
    console.error('proceso) escuchando ahi. Cierralo, o define otro puerto con la');
    console.error('variable de entorno MECHA_REMOTE_PORT y vuelve a intentar.');
    console.error('');
  } else {
    console.error('ERROR al iniciar el hub:', err && err.message ? err.message : err);
  }
  process.exit(1);
});
server.listen(PORT, () => {
  const { roomUrl, joinUrls } = controllerUrls();
  console.log(`Mecha remote hub online on http://0.0.0.0:${PORT}`);
  console.log(`Room page: ${roomUrl}`);
  if(wifiInfo.source === 'env'){
    console.log(`WiFi QR (manual): SSID="${wifiInfo.ssid}" auth=${wifiInfo.auth}${wifiInfo.pass ? '' : ' (no password)'}`);
  } else if(WIFI_AUTODETECT){
    console.log('WiFi QR: autodeteccion activa (se actualiza con la red conectada).');
  } else {
    console.log('WiFi QR disabled (set MECHA_WIFI_SSID o quita MECHA_WIFI_AUTODETECT=false).');
  }
  joinUrls.forEach((url, idx) => {
    console.log(`P${idx + 1}: ${url}`);
  });
  console.log(`Game WS: ws://127.0.0.1:${PORT}/ws?role=host`);
  verifyLoopbackOwnership();
  // Autodeteccion de WiFi: primer sondeo y refresco periodico por si cambia
  // de red sin reiniciar el hub. netsh es barato (~200ms).
  if(WIFI_AUTODETECT){
    refreshWifiInfo();
    setInterval(refreshWifiInfo, 20000).unref();
  }
});
