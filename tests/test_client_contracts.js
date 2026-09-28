'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const game = fs.readFileSync(path.join(root, 'mechakatz_vs_kaiju_V9.html'), 'utf8');
const mobile = fs.readFileSync(path.join(root, 'mobile-controller.html'), 'utf8');
const generatedEditor = fs.readFileSync(path.join(root, 'mechakatz_config.html'), 'utf8');
const config = JSON.parse(fs.readFileSync(path.join(root, 'MECHAKATZ.json'), 'utf8'));

function inlineScripts(html, filename) {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .filter(source => source.trim());
  assert.ok(scripts.length > 0, `${filename}: no inline scripts found`);
  return scripts;
}

function assertScriptsCompile(html, filename) {
  for (const source of inlineScripts(html, filename)) {
    assert.doesNotThrow(() => new Function(source), `${filename}: invalid JavaScript`);
  }
}

assertScriptsCompile(game, 'mechakatz_vs_kaiju_V9.html');
assertScriptsCompile(mobile, 'mobile-controller.html');
assertScriptsCompile(generatedEditor, 'mechakatz_config.html');

assert.match(game, /serviceHttpUrl:\s*'http:\/\/127\.0\.0\.1:8787'/);
assert.ok(game.includes("['mecha.v1', `ticket.${REMOTE_STATE.hostTicket}`]"));
assert.ok(game.includes("payload.type === 'controller_input_state'"));
assert.ok(game.includes("sendRemotePacket({ type:'webrtc_offer', player, negotiationId, sdp:pc.localDescription.sdp })"));
assert.ok(game.includes("typeof payload.sdp !== 'string'"));

assert.ok(mobile.includes("'/ws?role=controller&player='"));
assert.ok(mobile.includes("'ticket.' + onlineBootstrap.ticket"));
assert.ok(mobile.includes("'device.' + deviceSecret"));
assert.ok(mobile.includes("send({ type:'input_state', actions, seq:nextSequence() })"));
assert.match(mobile, /up:\s*dy\s*<\s*-deadZone/);
assert.match(mobile, /down:\s*dy\s*>\s*deadZone/);
assert.ok(mobile.includes("typeof offerSdp !== 'string'"));
assert.ok(mobile.includes("setRemoteDescription({ type:'offer', sdp:offerSdp })"));
assert.ok(mobile.includes("sdp:peer.localDescription.sdp"));
assert.ok(mobile.includes("if(!event.candidate) return"));
assert.ok(!/onlineUrl[^\n]*(ticket|onlineBootstrap)/.test(mobile));
assert.match(mobile, /<video[^>]*autoplay[^>]*playsinline[^>]*muted/i);

// Cabina de los operadores: el snapshot del juego manda la personalidad y los
// contadores de eventos que el mando convierte en animaciones.
assert.ok(game.includes('operator: resolveOperatorPersona(preview, charIdx)'));
assert.ok(game.includes('pilotGender: resolveOperatorGender(preview, charIdx)'));
for (const field of ['hurt: player.hurtCount', 'hurtDmg: player.lastHurt', 'block: player.blockCount', 'heal: player.healCount', 'sosCount: player.sosCount']) {
  assert.ok(game.includes(field), `snapshot sin ${field}`);
}
assert.ok(game.includes('(input.lightPress || input.specialPress) && player.sosTimer'), 'el mecha caido debe poder pedir ayuda');
assert.match(mobile, /<canvas id="cockpitView"/);
assert.match(mobile, /<canvas id="doorView"/);
assert.ok(mobile.includes('opRenderFigure(scanPilot'), 'el escaner debe mostrar al operador de cuerpo completo');
for (const field of ['pilot.hurt', 'pilot.heal', 'pilot.block', 'pilot.sosCount', 'entry.operator', 'entry.pilotGender']) {
  assert.ok(mobile.includes(field), `el mando no lee ${field}`);
}

// Video del juego en el mando: apagado por defecto (el "view" del enlace se
// ignora), boton VIDEO junto a ESTADO y ofertas rechazadas mientras este apagado.
assert.match(mobile, /id="statusToggle"[^\n]*\n\s*<button id="videoToggle"/, 'VIDEO debe ir junto a ESTADO');
assert.ok(mobile.includes('let videoWanted = onlineMode && onlineBootstrap.video;'));
assert.ok(!mobile.includes("fragmentParams.get('view')"), 'el enlace no debe encender el video');
assert.ok(mobile.includes('if(!videoActive() || closedNegotiations.includes(negotiationId))'), 'con el video apagado se rechaza la oferta');
assert.ok(!game.includes('VIDEO URL'), 'los enlaces de video separados ya no existen');

// Decor: el picking del editor codifica cada clave de color como
// rgb(40, 10 + idx * 24, 250), asi que una capa admite como maximo 11 colores.
{
  const start = game.indexOf('const DECOR_TYPES = {');
  const end = game.indexOf('\n};', start);
  assert.ok(start >= 0 && end > start, 'no se encontro DECOR_TYPES');
  const block = game.slice(start, end);
  const labelMaps = [...block.matchAll(/\bcolors:\{([^}]*)\}/g)]
    .map(match => match[1])
    .filter(body => !/'#[0-9a-fA-F]{3,8}'/.test(body));
  assert.ok(labelMaps.length > 30, 'se esperaban los mapas de etiquetas de colores de DECOR_TYPES');
  for (const body of labelMaps) {
    const keys = [...body.matchAll(/(\w+):'/g)].map(match => match[1]);
    assert.ok(keys.length <= 11, `capa con ${keys.length} colores (maximo 11 para el picking): ${keys.join(', ')}`);
  }
  assert.ok(block.includes("{ key:'mount'") && block.includes("{ key:'dock'") && block.includes("{ key:'cabins'"), 'el lago debe traer montaña, muelle y cabañas');
}
assert.ok(game.includes('  warmStageDecor();'), 'setupStage debe precalentar los sprites del lago');

assert.equal(config.remote.mode, 'lan');
assert.equal(config.remote.serviceHttpUrl, 'http://127.0.0.1:8787');
assert.equal(config.remote.sessionMode, 'mixed');

console.log('Client contract checks: PASS');
