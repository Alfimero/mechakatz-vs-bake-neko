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

assert.equal(config.remote.mode, 'lan');
assert.equal(config.remote.serviceHttpUrl, 'http://127.0.0.1:8787');
assert.equal(config.remote.sessionMode, 'mixed');

console.log('Client contract checks: PASS');
