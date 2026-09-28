#!/usr/bin/env node
'use strict';
// ============================================================
// GENERADOR DE mechakatz_config.html (+ arte del mando del celular)
// Extrae literalmente los bloques del panel CONFIG desde
// mechakatz_vs_kaiju_V9.html y ensambla el editor dedicado. Ademas copia el
// arte HD de los mechas al bloque <mecha-art> de mobile-controller.html
// (escaner 360° de la seleccion). Correr despues de tocar el panel o el arte:
//   node build_config_editor.js
// Sin dependencias. Ver README.md ("Editor de configuracion").
// ============================================================
const fs = require('fs');
const path = require('path');

const GAME_FILE = path.join(__dirname, 'mechakatz_vs_kaiju_V9.html');
const OUT_FILE = path.join(__dirname, 'mechakatz_config.html');
const source = fs.readFileSync(GAME_FILE, 'utf8');

function extract(name, startAnchor, endAnchor){
  const start = source.indexOf(startAnchor);
  if(start === -1) throw new Error(`[${name}] ancla inicial no encontrada: ${startAnchor}`);
  if(source.indexOf(startAnchor, start + 1) !== -1) throw new Error(`[${name}] ancla inicial ambigua: ${startAnchor}`);
  const end = source.indexOf(endAnchor, start);
  if(end === -1) throw new Error(`[${name}] ancla final no encontrada: ${endAnchor}`);
  return source.slice(start, end).replace(/\s+$/, '') + '\n';
}
// Funcion completa desde su firma, cerrando llaves (los template strings
// con ${} quedan balanceados).
function extractFunction(name, startAnchor){
  const start = source.indexOf(startAnchor);
  if(start === -1) throw new Error(`[${name}] funcion no encontrada: ${startAnchor}`);
  if(source.indexOf(startAnchor, start + 1) !== -1) throw new Error(`[${name}] funcion ambigua: ${startAnchor}`);
  let depth = 0;
  for(let i = source.indexOf('{', start); i < source.length; i++){
    if(source[i] === '{') depth++;
    else if(source[i] === '}' && --depth === 0) return source.slice(start, i + 1) + '\n';
  }
  throw new Error(`[${name}] llaves sin cerrar`);
}

// ---- Bloques JS extraidos del juego (en orden de ensamblado) ----
const jsBlocks = [
  extract('consts', 'const W = 480;', 'const SCORE_VALUES'),
  extract('decor-data', 'const DECOR_TYPES = {', 'const DEFAULT_CONFIG = {'),
  extract('default-config', 'const DEFAULT_CONFIG = {', 'function deepClone'),
  extract('helpers', 'function deepClone(obj){', 'function reviveWindowFramesFor'),
  extract('config-persist', 'let CONFIG = deepClone(DEFAULT_CONFIG);', 'function stageScoreMultiplier'),
  extract('config-tabs-list', 'const CONFIG_TABS = [', 'let nextId = 1;'),
  extract('stage-groups', 'function runStageCount(){', 'function slotColor'),
  extract('stage-geometry', 'let decorPreviewStage = null;', 'function worldToScreenX'),
  extract('toast', 'function showToast(message){', 'function initAudio')
];
const glueVars = [
  '// ==== STUBS DE RUNTIME (esta pagina no corre el juego) ====',
  "const game = { state:'title', stage:0, stageOrder:null, stageSetName:'', cameraX:0, time:0, players:[], enemies:[], items:[], projs:[], parts:[], boss:null };",
  'let toastEl = null;',
  'let midiAccess = null;',
  'const midiDevices = new Map();',
  'let midiLearnTarget = null;',
  'let keyLearnTarget = null;',
  "const NET_MIDI_STATE = { ws:null, connected:false, room:'', url:'', clients:0, retryTimer:0, lastMessage:'' };",
  "const REMOTE_STATE = { ws:null, connected:false, connecting:false, superseded:false, roomUrl:'', joinUrls:Array.from({ length: MAX_PLAYERS }, function(){ return ''; }), controllers:Array.from({ length: MAX_PLAYERS }, function(){ return false; }), lastMessage:'', retryTimer:0 };",
  "const configModal = document.getElementById('config-modal');",
  'const wrap = configModal; // destino inocuo del toggle de scanlines',
  "const configTabs = document.getElementById('config-tabs');",
  "const configContent = document.getElementById('config-content');",
  "const configFileInput = document.getElementById('cfg-file');",
  "const midiStatus = document.getElementById('midi-status');",
  "const syncNote = document.getElementById('sync-note');",
  "let ctx = document.createElement('canvas').getContext('2d'); // la vista previa DECOR lo redirige a su canvas",
  'function updateRemoteStatus(){}',
  'function connectRemoteHost(){}',
  'function closeRemoteConnection(){}',
  "function remoteMode(){ return CONFIG.remote && CONFIG.remote.mode === 'online' ? 'online' : 'lan'; }",
  "function remoteSessionMode(){ return ['controller','stream','mixed'].includes(CONFIG.remote && CONFIG.remote.sessionMode) ? CONFIG.remote.sessionMode : 'mixed'; }",
  'function renderScoresPanel(){}',
  'function drawEmergeGround(){}',
  "function slotLabel(slot){ return (CONFIG.text && CONFIG.text['p' + (slot + 1) + 'Label']) || ('P' + (slot + 1)); }",
  'function isConfigOpen(){ return true; }',
  'function isTypingInField(){',
  '  const el = document.activeElement;',
  "  return !!el && ['INPUT','TEXTAREA','SELECT'].includes(el.tagName);",
  '}',
  '// Los eventos MIDI/tecla solo actuan dentro del juego; aqui solo confirmamos',
  '// que el mensaje llego (util para probar mapeos con el controlador real).',
  'function triggerMidiEvent(name){',
  "  showToast('Recibido: ' + (MIDI_EVENT_LABELS[name] || name) + ' (el evento actua en el juego)');",
  '}'
].join('\n') + '\n';
const jsBlocks2 = [
  extract('midi-stack', 'function setupMIDI(){', 'function triggerMidiEvent(name){'),
  // px/rect y el ajuste de pixeles de withSpriteScale (fillPixels, que tambien
  // usan pixelDisc/pixelDome/pixelTriangle del bloque draw-decor).
  extract('pixel-primitives', 'let spriteSnap = null;', 'function strokeRect('),
  // Arte HD de los mechas: vista previa de la pestaña PLAYERS y enemigos clasicos.
  extract('mecha-art', '// ==== ARTE HD DE LOS MECHAKATZ (inicio) ====', '// ==== ARTE HD DE LOS MECHAKATZ (fin) ===='),
  extract('enemy-sprite-resolve', 'const ENEMY_SPRITES = [', 'function makeEnemy'),
  extract('enemy-art', 'const ENEMY_SPRITE_COLORS = {', 'function drawBossHead'),
  // Jefes: helpers del catalogo + dibujo, para la vista previa de la pestaña BOSS.
  extract('boss-helpers', '// ---- Helpers del catalogo de jefes (BOSS_TYPES) ----', 'function makeBoss(){'),
  extract('boss-art', 'function drawBossHead(cx, cy, head, side){', 'function drawItem(item, x, y){'),
  extract('draw-decor', 'function drawRoadLaneMarks(scroll', 'function drawParticles'),
  extract('panel', 'function applyConfigToLiveGame(preserveMIDI = true){', 'function renderConfigTabs(){'),
  extract('tabs-render', 'function renderConfigTabs(){', 'function openConfigPanel(){'),
  extract('file-persist', '// Handle persistente del archivo JSON cargado', "document.getElementById('help-btn')")
];
const glueInit = [
  '// ==== SINCRONIZACION CON EL JUEGO (localStorage compartido) ====',
  '// El scoreboard lo escribe el JUEGO (scores al terminar partida). Antes de',
  '// cada guardado re-adoptamos el scoreboard almacenado para no pisarlo.',
  'saveConfigToStorage = function(){',
  '  if(!configPersistReady) return;',
  '  try {',
  '    const stored = JSON.parse(localStorage.getItem(CONFIG_STORAGE_KEY) || "null");',
  '    if(stored && stored.scoreboard) CONFIG.scoreboard = stored.scoreboard;',
  '  } catch(error){ /* JSON corrupto: seguimos con el nuestro */ }',
  '  try {',
  '    const raw = JSON.stringify(CONFIG);',
  '    localStorage.setItem(CONFIG_STORAGE_KEY, raw);',
  '    lastSyncedConfigRaw = raw;',
  "    if(syncNote) syncNote.textContent = 'Guardado ' + new Date().toLocaleTimeString() + ' — el juego lo aplica en vivo';",
  '  } catch(error){',
  "    if(syncNote) syncNote.textContent = 'SIN localStorage: los cambios no llegan al juego';",
  '  }',
  '};',
  '// Cambios que llegan del juego (p. ej. scores nuevos). No re-renderizamos',
  '// mientras se edita un campo para no robar el foco.',
  'function adoptExternalConfig(raw){',
  '  if(!raw || raw === lastSyncedConfigRaw) return;',
  '  if(isTypingInField()) return;',
  '  let parsed = null;',
  '  try { parsed = JSON.parse(raw); } catch(error){ return; }',
  '  lastSyncedConfigRaw = raw;',
  '  CONFIG = configFromSaved(parsed);',
  '  renderConfigTabs();',
  '  refreshConfigContent();',
  "  showToast('Config sincronizada desde el juego');",
  '}',
  "window.addEventListener('storage', function(event){",
  '  if(event.key !== CONFIG_STORAGE_KEY || event.newValue == null) return;',
  '  adoptExternalConfig(event.newValue);',
  '});',
  'setInterval(function(){',
  '  try {',
  '    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);',
  '    if(raw) adoptExternalConfig(raw);',
  '  } catch(error){}',
  '}, 5000);',
  '',
  '// ==== TECLADO: LEARN KEY + Escape cancela learns ====',
  "window.addEventListener('keydown', function(event){",
  '  const key = normalizeHotkeyName(event.key);',
  "  if(key === 'escape' && (midiLearnTarget || keyLearnTarget)){",
  '    midiLearnTarget = null;',
  '    keyLearnTarget = null;',
  '    refreshConfigContent();',
  '    return;',
  '  }',
  '  if(keyLearnTarget && !isTypingInField()){',
  "    if(!['shift','control','alt','meta','tab','escape'].includes(key)){",
  '      const target = keyLearnTarget;',
  '      for(const otherEv of Object.keys(CONFIG.midi.mappings)){',
  '        if(otherEv !== target && CONFIG.midi.mappings[otherEv].key === key){',
  "          CONFIG.midi.mappings[otherEv].key = '';",
  '        }',
  '      }',
  '      CONFIG.midi.mappings[target].key = key;',
  '      keyLearnTarget = null;',
  '      applyConfigToLiveGame();',
  '      refreshConfigContent();',
  "      showToast('Tecla ' + key.toUpperCase() + ' asignada');",
  '      event.preventDefault();',
  '    }',
  '  }',
  '});',
  '',
  '// ==== BOTONES DE PIE ====',
  "document.getElementById('cfg-export').addEventListener('click', exportConfig);",
  "document.getElementById('cfg-import').addEventListener('click', function(){ configFileInput.click(); });",
  "configFileInput.addEventListener('change', function(event){",
  '  const file = event.target.files && event.target.files[0];',
  '  if(file) importConfig(file);',
  "  configFileInput.value = '';",
  '});',
  "document.getElementById('cfg-reset').addEventListener('click', function(){",
  "  if(!confirm('Resetear TODA la config a los valores por defecto? (se conservan MIDI y scores)')) return;",
  '  const midiState = deepClone(CONFIG.midi);',
  '  const scoreboardState = deepClone(CONFIG.scoreboard);',
  '  CONFIG = deepClone(DEFAULT_CONFIG);',
  '  CONFIG.midi = midiState;',
  '  CONFIG.scoreboard = scoreboardState;',
  '  applyConfigToLiveGame();',
  '  renderConfigTabs();',
  '  refreshConfigContent();',
  "  showToast('Config reseteada');",
  '});',
  '',
  '// ==== ARRANQUE ====',
  'const hadStoredConfig = loadConfigFromStorage();',
  'applyConfigToLiveGame();',
  'renderConfigTabs();',
  'refreshConfigContent();',
  'setupMIDI();',
  'configPersistReady = true;',
  'if(!hadStoredConfig) tryAutoLoadConfigJson();',
  "configModal.classList.add('show');",
  'if(syncNote) syncNote.textContent = hadStoredConfig',
  "  ? 'Config cargada del navegador — compartida en vivo con el juego'",
  "  : 'Config nueva (defaults): se guardara al primer cambio';"
].join('\n') + '\n';

// ---- CSS extraido + overrides de pagina ----
const cssPanelStart = source.indexOf('  #config-modal{');
const cssPanelEndAnchor = '.toast.show{opacity:1}';
const cssPanelEnd = source.indexOf(cssPanelEndAnchor);
if(cssPanelStart === -1 || cssPanelEnd === -1) throw new Error('CSS del panel no encontrado');
const cssPanel = source.slice(cssPanelStart, cssPanelEnd + cssPanelEndAnchor.length) + '\n';

const cssOverrides = `
  /* ---- Overrides de la pagina dedicada ---- */
  #config-box{width:min(1240px,98vw);height:min(920px,96vh)}
  #midi-status{margin-left:16px;font-size:14px;color:#9aa1c1;border:1px solid rgba(0,240,255,.3);padding:3px 8px}
  #midi-status.on{color:var(--green);border-color:var(--green)}
  .sync-note{margin-right:auto;align-self:center;color:#9aa1c1;font-size:13px}
  @media (max-width:760px){
    .cfg-grid{grid-template-columns:1fr}
    .cfg-row{grid-template-columns:1fr}
    .cfg-row.bool,.cfg-row.text,.cfg-row.color-row{grid-template-columns:1fr}
    #config-body{grid-template-columns:110px 1fr}
  }
`;

const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MechaKatz — CONFIG</title>
<!-- ============================================================
ARCHIVO GENERADO por build_config_editor.js a partir de
mechakatz_vs_kaiju_V9.html (bloques extraidos literalmente).
NO editar a mano: tras cambiar el panel CONFIG del juego, regenerar con
  node build_config_editor.js
La config se comparte con el juego via localStorage (mechakatz_config_v9);
el juego abierto en el mismo navegador aplica los cambios en vivo.
============================================================ -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:#0a0014;
    --pink:#ff2e88;
    --cyan:#00f0ff;
    --yellow:#ffea00;
    --purple:#9b30ff;
    --green:#00ff7f;
    --red:#ff4040;
  }
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{
    width:100%;
    height:100%;
    overflow:hidden;
    background:var(--bg);
    color:var(--cyan);
    font-family:'VT323',monospace;
  }
${cssPanel}${cssOverrides}</style>
</head>
<body>
<div id="config-modal">
  <div id="config-box">
    <div id="config-head">
      <h2>MECHAKATZ CONFIG</h2>
      <span id="midi-status">MIDI ESPERANDO</span>
      <span class="sub">Editor dedicado — el juego aplica los cambios en vivo</span>
    </div>
    <div id="config-body">
      <div id="config-tabs"></div>
      <div id="config-content"></div>
    </div>
    <div id="config-foot">
      <span id="sync-note" class="sync-note"></span>
      <button id="cfg-export">EXPORTAR</button>
      <button id="cfg-import">IMPORTAR</button>
      <input type="file" id="cfg-file" accept=".json" style="display:none">
      <button id="cfg-reset" class="danger">RESET</button>
    </div>
  </div>
</div>
<script>
'use strict';
// ==== BLOQUES EXTRAIDOS DEL JUEGO (no editar aqui) ====
${jsBlocks.join('\n')}
${glueVars}
${jsBlocks2.join('\n')}
${glueInit}</script>
</body>
</html>
`;

// Validar sintaxis del script generado antes de escribir
const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
new (require('vm').Script)(scriptMatch[1], { filename: 'mechakatz_config.js' });

fs.writeFileSync(OUT_FILE, html);
console.log(`OK: ${path.basename(OUT_FILE)} generado (${html.length} bytes)`);

// ---- Arte HD compartido con el mando del celular ----
// mobile-controller.html no se genera entero: solo se reemplaza lo que hay
// entre sus marcadores <mecha-art>, asi el escaner de la seleccion dibuja
// exactamente los mismos mechas que el juego.
const CONTROLLER_FILE = path.join(__dirname, 'mobile-controller.html');
const ART_BEGIN = '/* <mecha-art> GENERADO por build_config_editor.js desde el juego: no editar a mano */';
const ART_END = '/* </mecha-art> */';
const controllerArt = [
  'const TAU = Math.PI * 2;',
  extractFunction('clamp', 'function clamp(value, min, max){'),
  extractFunction('safeHexColor', 'function safeHexColor(value, fallback){'),
  extractFunction('shadeHex', 'function shadeHex(hex, factor){'),
  extract('pixel-primitives', 'let spriteSnap = null;', 'function strokeRect('),
  extract('pixel-shapes', 'function pixelDisc(cx, cy, r, color, squash = 1){', '// Fronda (palmeras, helechos)'),
  extract('mecha-art', '// ==== ARTE HD DE LOS MECHAKATZ (inicio) ====', '// ==== ARTE HD DE LOS MECHAKATZ (fin) ====')
].join('\n');
new (require('vm').Script)(controllerArt, { filename: 'mecha-art.js' });
const controller = fs.readFileSync(CONTROLLER_FILE, 'utf8');
const artStart = controller.indexOf(ART_BEGIN);
const artEnd = controller.indexOf(ART_END);
if(artStart === -1 || artEnd === -1 || artEnd < artStart) throw new Error('mobile-controller.html: marcadores <mecha-art> no encontrados');
const nextController = controller.slice(0, artStart + ART_BEGIN.length) + '\n' + controllerArt + controller.slice(artEnd);
if(nextController !== controller) fs.writeFileSync(CONTROLLER_FILE, nextController);
console.log(`OK: mobile-controller.html arte de mechas sincronizado (${controllerArt.length} bytes)`);
