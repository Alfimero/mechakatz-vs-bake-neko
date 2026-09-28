'use strict';

// Prueba de humo de la cabina de los operadores (mobile-controller.html).
// Ejecuta el arte compartido (<mecha-art>) y el motor de la cabina en un
// contexto aislado de Node y dibuja cada personalidad en cada modo, evento,
// tramo de vida y paso de su guion de espera. Tambien comprueba que el
// catalogo del juego (OPERATOR_PERSONAS) y las animaciones del mando esten
// alineados.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const mobile = fs.readFileSync(path.join(root, 'mobile-controller.html'), 'utf8');
const game = fs.readFileSync(path.join(root, 'mechakatz_vs_kaiju_V9.html'), 'utf8');

function between(text, start, end) {
  const a = text.indexOf(start);
  const b = text.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `bloque no encontrado: ${start}`);
  return text.slice(a + start.length, b);
}

const art = between(mobile, '/* <mecha-art> GENERADO por build_config_editor.js desde el juego: no editar a mano */', '/* </mecha-art> */');
const engine = between(mobile, '/* ==== CABINA DE LOS OPERADORES (inicio) ==== */', '/* ==== CABINA DE LOS OPERADORES (fin) ==== */');

let clock = 1000;
const context = vm.createContext({
  Math,
  console,
  performance: { now: () => clock },
  ImageData: class {
    constructor(data, width, height) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  }
});
vm.runInContext(`let ctx = null;\n${art}`, context, { filename: 'mecha-art.js' });
vm.runInContext(engine, context, { filename: 'cabina.js' });
const run = code => vm.runInContext(code, context);

// ---- Catalogo: el juego y el mando conocen las mismas personalidades ----
// (Array.from: los arreglos del contexto aislado tienen otro prototipo.)
const ids = Array.from(run('OPERATOR_PERSONAS.map(opt => opt.value)'));
assert.equal(ids.length, 12, 'se esperaban 12 personalidades');
const gameIds = [...between(game, 'const OPERATOR_PERSONAS = [', '];').matchAll(/value:'([a-z]+)'/g)].map(m => m[1]);
assert.deepEqual(gameIds, ids, 'el bloque <mecha-art> del mando no coincide con el juego (correr node build_config_editor.js)');
const kinds = ['desperate', 'attention', 'distract', 'sleep'];
const categories = ['start', 'focus', 'hit', 'heal', 'special', 'low', 'attention', 'desperate', 'distract', 'sleep', 'wake', 'sos', 'revive', 'win', 'lose', 'eject', 'boss'];
for (const id of ids) {
  const persona = run(`OP_PERSONAS[${JSON.stringify(id)}]`);
  assert.ok(persona, `personalidad sin animaciones en el mando: ${id}`);
  assert.equal(persona.focus.length, 3, `${id}: faltan caras de los 3 tramos de vida`);
  for (const kind of kinds) {
    assert.ok(persona.idle.some(step => step[0] === kind), `${id}: su guion de espera no tiene '${kind}'`);
  }
  for (const category of categories) {
    assert.ok(Array.isArray(persona.lines[category]) && persona.lines[category].length, `${id}: faltan frases '${category}'`);
  }
  assert.ok(run(`!!OP_ACC[${JSON.stringify(persona.acc)}]`), `${id}: accesorio desconocido ${persona.acc}`);
}

// ---- Resolucion por nombre, orden por defecto y eleccion manual ----
assert.equal(run("resolveOperatorPersona({ name:'MEFISTECH' }, 7)"), 'jugueton');
assert.equal(run("resolveOperatorPersona({ name:'beyliszeta' }, 7)"), 'platicador');
assert.equal(run("resolveOperatorPersona({ name:'BURTRON' }, 7)"), 'elegante');
assert.equal(run("resolveOperatorGender({ name:'ERISPRIME' }, 0)"), 'f');
assert.equal(run("resolveOperatorGender({ name:'BURTRON', operator:'diva' }, 0)"), 'm', 'el genero es del gato, no de la personalidad');
assert.equal(run("resolveOperatorPersona({ name:'NUEVO', operator:'auto' }, 1)"), 'jugueton');
assert.equal(run("resolveOperatorPersona({ name:'MEFISTECH', operator:'genio' }, 0)"), 'genio');

// ---- Tramos de vida (100-67 / 66-34 / 33-1) y frases con genero ----
const tierAt = (hp, max) => run(`OPS.hp = ${hp}; OPS.maxHp = ${max}; opTier()`);
assert.equal(tierAt(67, 100), 0);
assert.equal(tierAt(66, 100), 1);
assert.equal(tierAt(34, 100), 1);
assert.equal(tierAt(33, 100), 2);
assert.equal(tierAt(1, 100), 2);
assert.equal(run("OPS.gender = 'f'; opGendered('¡DESPIERT{O|A} Y LIST{O|A}!')"), '¡DESPIERTA Y LISTA!');
assert.equal(run("OPS.gender = 'm'; opGendered('LIST{O|A}')"), 'LISTO');

// ---- Dibujo: cada personalidad en cada situacion ----
const coats = ['solid', 'tabby', 'spots', 'points', 'tuxedo', 'calico', 'tortie'];
const ears = ['normal', 'big', 'fold', 'tuft'];
const bodies = ['#0e0e0b', '#f2f2f2', '#f08a24', '#7e8fa4'];
function distinctColors() {
  return run('new Set(OP_BUF).size');
}
function draw(times) {
  for (const dt of times) {
    clock += dt;
    run(`opDrawScene(${clock})`);
  }
}
let frames = 0;
ids.forEach((id, i) => {
  const look = {
    body: bodies[i % bodies.length],
    accent: i % 2 ? '#ffffff' : '#4b473f',
    visor: '#51af12',
    coat: coats[i % coats.length],
    coatColor: '#5a3212',
    coatColor2: '#2e1806',
    belly: '#fff0cc',
    ears: ears[i % ears.length]
  };
  run(`opSetPilot(${JSON.stringify({ look, persona: id, name: id.toUpperCase() })})`);
  run("opSetVitals({ hp:100, maxHp:100, special:100, maxSpecial:100, message:'STAGE 1 - PRUEBA' })");
  run("opSetMode('active')");
  // Pilotando en los tres tramos, con palanca, golpe y especial.
  for (const hp of [100, 50, 20]) {
    run(`opSetVitals({ hp:${hp} }); opActivity(${clock}); opInput('right', true); opInput('light', true)`);
    draw([33, 33]);
    run("opInput('right', false); opInput('light', false)");
    frames += 2;
  }
  assert.ok(distinctColors() > 40, `${id}: la cabina salio casi vacia`);
  run("opSetVitals({ hp:100 }); opInput('special', true); opInput('special', false)");
  draw([200, 300, 400]);
  // Eventos del juego.
  for (const event of ["opEvent('hurt', { amount:1 })", "opEvent('heal')", "opEvent('block')", "opEvent('stage')", "opEvent('boss')"]) {
    run(event);
    draw([60, 200]);
    frames += 2;
  }
  // Guion de espera completo: cada paso a mitad y al final.
  const script = run(`OP_PERSONAS[${JSON.stringify(id)}].idle.map(step => step[1])`);
  let wait = 5.2;
  for (const seconds of script) {
    run(`OPS.react = null; OPS.lastInputAt = ${clock} - ${wait * 1000}`);
    draw([33, 1500, 33]);
    frames += 3;
    wait += (seconds || 8);
  }
  // Caido (KO y SOS con bengala), rescatado, destruido con eyeccion, fin.
  run("opSetVitals({ hp:0, repairSeconds:12 }); opSetMode('downed')");
  draw([100, 1200, 1500]);
  run("opEvent('sos')");
  draw([100, 700]);
  run("opSetVitals({ hp:35 }); opSetMode('active')");
  draw([200, 900]);
  run("opSetVitals({ hp:0, repairSeconds:5 }); opSetMode('downed'); opSetMode('destroyed')");
  assert.equal(run('OPS.ejectLive'), true, `${id}: la eyeccion debe animarse al pasar de caido a destruido`);
  draw([300, 400, 400, 300, 700, 1200, 4000]);
  run("opSetMode('victory')");
  draw([200, 800]);
  run("opSetMode('gameover')");
  draw([500]);
  run("opSetMode('offline')");
  draw([100]);
  run("opSetMode('standby')");
  frames += 16;
});
assert.ok(run('OPS.parts.length') <= 160, 'las particulas deben tener tope');

// ---- Operador de cuerpo completo del escaner (tamaño segun el mecha) ----
const figurePixels = () => run('OP_FIG.reduce((n, c) => n + (c ? 1 : 0), 0)');
ids.forEach((id, i) => {
  const look = { body: bodies[i % bodies.length], accent: '#4b473f', visor: '#e4e70d', coat: coats[i % coats.length], coatColor: '#5a3212', coatColor2: '#2e1806', belly: '#fff0cc', ears: ears[i % ears.length] };
  const sizes = [];
  for (const [scale, ready, dt] of [[0.6, false, 1000], [0.8, false, 3500], [1.05, true, 700]]) {
    clock += dt;
    run(`opDrawFigureBuffer(${JSON.stringify({ look, persona: id, gender: 'm', scale, ready, revealed: true, key: id })}, ${clock})`);
    sizes.push(figurePixels());
  }
  assert.ok(sizes.every(n => n > 150), `${id}: la figura del escaner salio vacia`);
  assert.ok(sizes[2] > sizes[0], `${id}: la figura debe crecer con el tamaño del mecha`);
});

// ---- Compuertas del hangar: selladas, destrabando, abriendo, abordaje ----
const doorPixels = () => run('OP_DOOR_BUF.reduce((n, c) => n + (c ? 1 : 0), 0)');
const full = 192 * 108;
run("opDoorsInfo('standby', 'ESPERANDO INICIO', 'P1', '#00f0ff'); OP_DOORS.state = 'closed'");
clock += 100;
run(`opDrawDoors(${clock})`);
assert.equal(doorPixels(), full, 'cerradas, las compuertas tapan todo el marco');
run(`opDoorsSet(true, ${clock})`);
assert.equal(run('opDoorsState()'), 'opening');
clock += 300;
run(`opDoorsTick(${clock}); opDrawDoors(${clock})`);
assert.equal(doorPixels(), full, 'destrabando: todavia no se separan');
clock += 700;
run(`opDoorsTick(${clock}); opDrawDoors(${clock})`);
assert.ok(doorPixels() < full * 0.8, 'abriendo: el centro queda transparente');
clock += 800;
run(`opDoorsTick(${clock})`);
assert.equal(run('opDoorsState()'), 'open');
run(`opDoorsCycle(${clock})`);
assert.equal(run('opDoorsState()'), 'closing');
clock += 800;
run(`opDoorsTick(${clock})`);
assert.equal(run('opDoorsState()'), 'opening', 'el abordaje vuelve a abrir sobre la cabina');
run(`opDoorsSet(false, ${clock}); opDoorsTick(${clock + 800})`);
assert.equal(run('opDoorsState()'), 'closed');

console.log(`Cockpit operator checks: PASS (${ids.length} personalidades, ${frames} cuadros)`);
