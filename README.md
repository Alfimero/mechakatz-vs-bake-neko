# MechaKatz VS Bake-Neko!

Beat-'em-up de pixel art para una funcion en vivo. De uno a cuatro asistentes controlan MechaKatz mientras la salida principal se muestra en el navegador del anfitrion. Un VJ dirige el show en tiempo real por MIDI o teclado (enemigos, ataques del jefe, avance de etapa, efectos) y todo se ajusta en vivo desde un editor de configuracion dedicado.

![Pantalla de titulo de MechaKatz VS Bake-Neko!](docs/screenshot.png)

## Requisitos

- Navegador moderno basado en Chromium (Chrome/Edge) para Web MIDI y WebRTC.
- Node.js 18 o superior: hub LAN y generador del editor (sin dependencias npm).
- Python 3.11: solo para el servicio online (`online_service/requirements.txt`).
- Conexion a Internet la primera vez para las fuentes de Google Fonts (Press Start 2P y VT323); sin ella el juego funciona con fuentes de respaldo.

## Formas de jugar

El proyecto conserva tres rutas compatibles:

| Perfil | Imagen | Control | Transporte |
| --- | --- | --- | --- |
| Local | Pantalla del anfitrion | Teclado o MIDI | Sin red |
| Telefono LAN | Pantalla del anfitrion; cabina del operador en el telefono | Joystick y botones tactiles | WebSocket local, puerto 8765 |
| Telefono online | Cabina del operador; video del juego opcional (boton VIDEO) | Los mismos controles tactiles | WSS para control y WebRTC para video/audio |

En ambos perfiles de telefono el juego del anfitrion sigue siendo la autoridad: el relay solo autentica sesiones, asigna slots, reenvia entradas y coordina WebRTC.

### Mando del telefono

- **Compuertas del hangar**: mientras no hay enlace o el anfitrion no empieza, la pantalla central muestra unas compuertas blindadas selladas con tu placa (P1-P4) y el estado ("SIN ENLACE", "ESPERANDO INICIO"). Al empezar la seleccion se destraban y se abren sobre el **escaner**, donde junto a tu mecha aparece su operador de cuerpo completo (mas grande o mas pequeño segun el tamaño del mecha, con su pose caracteristica; salta de gusto al confirmar). Al empezar la partida se cierran y se vuelven a abrir sobre la cabina.
- La pantalla central del mando es la **cabina del operador**: el gato que pilota tu mecha, en pixel art, visto desde la camara del tablero. Tiene el pelaje, los ojos y los colores de tu personaje y una personalidad propia (ver [docs/OPERADORES.md](docs/OPERADORES.md)). Sin taparla quedan la palanca y los botones STRIKE/SYSTEM.
  - **Pilotando**: mueve sus palancas con tu palanca y aprieta el gatillo con STRIKE; su cara cambia con la vida del mecha (100-67 % fresco, 66-34 % con curitas y averias, 33-1 % agotado, jadeando y con un ojo medio cerrado).
  - **Si no tocas el mando 5 segundos** se desespera, llama tu atencion (saluda, golpea el vidrio...), se distrae (cubo Rubik, D&D en solitario, videojuegos, te...) y termina dormido; cada personalidad lo hace a su manera.
  - **Daño y curacion**: con cada golpe la cabina tiembla y se tiñe de naranja; al curarse brilla de verde. El gran boton del tablero brilla cuando el especial esta listo.
  - **Mecha caido**: el operador queda KO y luego pide rescate con un cartel. STRIKE y SYSTEM pasan a ser **¡AYUDA!/SOS**: lanzan una bengala sobre tu mecha en la pantalla grande para que un compañero te repare antes de que acabe la cuenta.
  - **Mecha destruido**: el operador sale eyectado en paracaidas (nube de humo caricaturesca, sin violencia) y la cabina queda vacia.
  - En salas online, el boton **VIDEO** (junto a ESTADO, tambien en **ESTADO > Centro**) cambia el centro entre la cabina y el video del juego. Siempre empieza apagado, aunque el enlace o la sala pidan video; el boton de sonido aparece sobre el video.
  - `mobile-controller.html?demo` abre la cabina sin juego, con un panel de prueba en ESTADO para ver a los 12 operadores en cada situacion.
- La personalidad y el genero de cada operador se eligen en el editor (**PLAYERS > Operador**); en `Auto` se usan los de su nombre (MEFISTECH, BEYLISZETA, BURTRON, ERISPRIME y los gatos del elenco).
- **Formato**: `AUTO` sigue la orientacion del telefono; `VERTICAL` pone el video arriba y el mando abajo; `HORIZONTAL` muestra el juego completo al centro con la palanca en el borde izquierdo y los botones en el derecho. Si el navegador no permite bloquear la orientacion, el mando se gira solo para sostener el telefono de lado. La eleccion se recuerda en el telefono.
- **ESTADO** despliega desde arriba un menu con pilotos, nivel, centro (cabina o video), formato, barras del mecha, jefe, avisos y ayuda. Se cierra con `Cerrar` o tocando fuera; un punto rojo avisa si tu mecha cayo.
- Al salir del navegador el video se corta para ahorrar datos y, si estaba encendido, se reanuda al volver.

## Archivos principales

- `mechakatz_vs_kaiju_V9.html`: juego y fuente del panel de configuracion.
- `mobile-controller.html`: cockpit movil para LAN y sesiones online.
- `mecha_remote_hub.js`: hub LAN heredado; no debe exponerse directamente a Internet.
- `online_service/`: orquestador FastAPI para sesiones online autenticadas.
- `build_config_editor.js`: regenera `mechakatz_config.html` desde el juego.
- `mechakatz_config.html`: editor de configuracion **generado**; no se edita a mano.
- `MECHAKATZ.json`: configuracion exportada del show.

## Controles

| Accion | Jugador 1 | Jugador 2 |
| --- | --- | --- |
| Mover | `W` `A` `S` `D` | Flechas |
| Golpe ligero | `F` | `J` |
| Golpe fuerte | `G` | `K` |
| Escudo | `R` | `I` |
| Especial | `T` | `O` |
| Vuelo | `Espacio` | `L` |

Los jugadores 3 y 4 se unen por telefono o MIDI.

Eventos del VJ (nota MIDI en canal 1 / tecla), editables en el editor de configuracion:

| Evento | Nota | Tecla |
| --- | --- | --- |
| Enemigo pequeno / grande / lanzador | 36 / 38 / 40 | `F1` / `F2` / `F3` |
| Oleada | 41 | `F4` |
| Monstruo del mundo (segun el nivel) | 42 | `Insert` |
| Soltar vida | 43 | `F5` |
| Entrada del jefe | 57 | `F6` |
| Ataque 1 / 2 / 3 del jefe (en el Bake-Neko: laser / fuego / golpe) | 48 / 50 / 52 | `F7` / `F8` / `F9` |
| Fase 2 del jefe (en el Bake-Neko: segunda cabeza) | 55 | `F10` |
| Flash + temblor | 60 | `F11` |
| Forzar avance | 64 | `\` |
| Entrar a seleccion | 65 | `Enter` |
| Terminar sesion | 67 | `F12` |

## Editor de configuracion

Abre `mechakatz_config.html` en otra ventana del **mismo navegador** que el juego. Cada cambio se guarda en `localStorage` y el juego lo aplica en vivo. Desde el editor tambien se exporta/importa la configuracion como JSON.

### Partidas al azar y jefes

- El fondo del titulo es un mundo al azar del pool cada vez que se abre el juego (y al volver al titulo).
- Cada partida juega 3 niveles y el jefe aparece siempre en el 3ro. En **STAGES > Modo de partida**, `3 MUNDOS AL AZAR DEL POOL` (por defecto) elige 3 mundos distintos entre los marcados **En partidas al azar**; `UN MUNDO COMPLETO` juega los 3 niveles de un solo mundo; `UN SET AL AZAR` usa los sets de abajo. **Forzar set** sirve para ensayar.
- El jefe final se sortea en cada partida entre cuatro jefes de 2 fases (pestaña **BOSS**, con vista previa animada, sorteo y colores):
  - **BAKE-NEKO**: laser, cortina de fuego y pisoton; en fase 2 despierta la segunda cabeza y flota.
  - **ONI-GANI**: cangrejo kaiju con chorro a presion, burbujas acidas y embestidas; en fase 2 se rompe el caparazon y acelera.
  - **TENGU-X**: cuervo mecanico con vendaval a ras de suelo (esquivalo moviendote al hueco o volando), abanico de plumas y lluvia de plumas; en fase 2 pelea en el aire.
  - **DAIDARA-BOT**: coloso de piedra con ojo de magma, lluvia de rocas y terremoto con ondas; en fase 2 se agrieta y muestra su nucleo de magma.
- Los cues MIDI de jefe son por slot: `Ataque 1/2/3` disparan el ataque equivalente del jefe activo y `Activar fase 2` adelanta la segunda fase.

### Niveles del mundo: mañana, tarde y noche

Cada mundo tiene **3 niveles** y cada nivel **3 oleadas**. El mundo juega el nivel que corresponde a su posicion en la partida:

| Posicion | Nivel | Enemigos | Look |
| --- | --- | --- | --- |
| 1ro | MAÑANA | Los 3 clasicos | Cielo de dia, nubes, bruma en lo lejano |
| 2do | TARDE | Aparece el monstruo propio del mundo | Atardecer, sol bajo, aves |
| 3ro | NOCHE + jefe | Los dos monstruos del mundo, mas fuertes | Estrellas, luna, luces encendidas |

- El escenario se pinta una sola vez en DECOR (la **escena base**, que es el momento natural de cada mundo: el desierto y el bosque son de tarde, la ciudad neon y la base lunar de noche). Los otros momentos se derivan solos: otro cielo, gradacion de color por paleta (ventanas, neon y antorchas quedan encendidas), capas ocultas o agregadas y bruma en lo lejano. En DECOR y en MODO DIBUJO el selector **Ver momento del dia** muestra cada nivel.
- En **STAGES > Niveles del mundo** cada nivel tiene nombre, momento del dia, intensidad del tono, multiplicadores de vida/daño/velocidad de los enemigos, cielo personalizable y su editor de oleadas. `REGENERAR LOS 3 NIVELES` vuelve a los valores del mundo.
- Nuevo modo de partida **UN MUNDO COMPLETO**: se sortea un mundo y se juegan sus 3 niveles seguidos (mañana, tarde y noche con el jefe).
- El fondo del titulo tambien sortea el momento del dia.

Bestiario (12 monstruos nuevos, editables y pintables en ENEMIES; se vuelven mas rapidos y fuertes de noche):

| Mundo | TARDE | NOCHE |
| --- | --- | --- |
| Desierto | **ESCORPIX**: se entierra y brota bajo el jugador tras un anillo de aviso | **MOMIA-BOT**: lanza una venda y te jala hacia ella |
| Suburbio | **GNOMO-BOMBA**: enciende la mecha y explota (daña a todos) | **PODA-BOT**: se alinea con tu carril y embiste de lado a lado |
| Ciudad neon | **DRON-NEON**: vuela y dispara por su carril tras una mira laser | **NINJA-HOLO**: se teletransporta a tu espalda y corta |
| Bosque | **HONGO-MECA**: nubes de esporas que envenenan y frenan | **LOBO-X**: merodea y salta sobre ti |
| Jungla | **RANA-DARDO**: avanza a saltos y escupe charcos de veneno | **CAMALEON**: casi invisible; su lengua roba energia del especial |
| Base espacial | **SLIME-X**: se divide al morir | **CENTINELA**: escudo frontal; flanquealo o rompe su guardia con golpe fuerte, especial, picada o lanzandole algo |

El siguiente paso planeado (mundos bajo el agua: Atlantida, Artico, Playa y Rio) esta en [docs/PLAN_MUNDOS_ACUATICOS.md](docs/PLAN_MUNDOS_ACUATICOS.md).

### Mundos y MODO DIBUJO

En la pestana **DECOR** la seccion **Mundos** crea un nivel nuevo desde una plantilla (desierto, suburbio, ciudad neon, bosque, jungla, base espacial o vacio), lo duplica o lo abre directamente en **MODO DIBUJO**. Los niveles nuevos heredan el horizonte y los carriles del primer nivel del pool; para jugarlos, asignalos a un set en **STAGES**.

**MODO DIBUJO** es un editor a pantalla completa del mapa:

- Arriba, una tira con **todo el largo del nivel**, las oleadas (`O1`, `O2`...) y el final. Click o arrastre para ir a esa parte; `RECORRER` reproduce el recorrido como en la partida.
- En el centro, la vista editable: `PINTAR` (pincel/gotero local) o `NAVEGAR` (arrastrar para recorrer). `CAPA ELEGIDA` limita la pintura a la capa seleccionada y `RESALTAR CAPA` atenua las demas.
- A la derecha, las capas: visibilidad, orden, agregar elementos por categoria y sus parametros. Cada capa tiene opacidad, desplazamiento vertical, densidad, dispersion y una **zona** del nivel: con `ZONA DESDE AQUI` / `ZONA HASTA AQUI` un lago, una cabana o un templo aparece solo en ese tramo.
- Atajos: `P`/`M` pintar-navegar, `B`/`I` pincel-gotero, `[` `]` grosor, flechas para recorrer (`Shift` = una pantalla), `R` reproducir, `T` objetivo, `H` resaltar, `L` carriles, `Ctrl+Z` deshacer, `Esc` cerrar.

El catalogo de elementos incluye nubes, aves, niebla, luciernagas, estrellas fugaces, planetas, pinos, arboles, palmeras, helechos, arbustos, penascos, hierba, lianas, dosel, lagos (con su montaña nevada, rio, muelle y cabañas), cascadas, templos, cabanas, lanzaderas, modulos de estacion, cupulas, radares, tuberias y suelos de pradera, selva y metal, ademas de los elementos clasicos de desierto y ciudad.

Se incluyen tres mundos nuevos (agregados una sola vez al pool, junto con un set propio):

- **BOSQUE BRUMOSO**: atardecer frio entre pinos azulados y niebla; en el primer tercio, un lago al pie de su propia montaña nevada (el rio nace en el glaciar y baja por un prado), con muelle, farol, barca y cabañas en la orilla; cabana del guardabosques cerca del final y luciernagas en la segunda mitad.

La capa **LAGO / RIO** lleva su entorno en la misma celda, asi el rio nunca se despega de su montaña con el parallax: `Montaña del rio` (alto, 0 = sin montaña), `Muelle` (largo, 0 = sin muelle) y `Cabañas en la orilla` (0-3), con colores propios para montaña, nieve, pinos, madera y ventanas (las ventanas y el farol siguen encendidos de noche).
- **TEMPLO ESMERALDA**: jungla humeda con dosel, lianas, loros, cascadas y un templo escalonado con antorchas que emerge en la segunda mitad.
- **BASE LUNAR NYX-7**: base de noche eterna frente a un gigante gaseoso anillado, con lanzaderas, modulos, radares, cupulas y tuberias; es la arena final del Bake-Neko.

Si modificas el codigo del panel dentro del juego, regenera el editor:

```powershell
node .\build_config_editor.js
```

## Ejecucion local

Juego sin telefonos: abre `mechakatz_vs_kaiju_V9.html` en un navegador.

Controladores en la misma red:

```powershell
node .\mecha_remote_hub.js
```

> **Aviso de privacidad:** en Windows el hub detecta la red WiFi y lee su contrasena con `netsh wlan show profile key=clear` para mostrar un QR de conexion. La contrasena queda visible en la pagina del hub para cualquiera en esa red. Si no lo deseas, define `MECHA_WIFI_AUTODETECT=false` o fija una red manual en `start_mecha_remote_hub.bat`.

Controladores mediante el servicio de sesiones:

```powershell
.\start_mecha_online_service.bat
```

El servicio escucha en `0.0.0.0:8787`. El lanzador usa `py -3.11`, `python` o la instalacion local de Python 3.11 (en ese orden), detecta la IPv4 LAN del PC y la anuncia como base de los QR cuando no existe `MECHA_PUBLIC_URL`; deja la ventana abierta mientras juegas. `127.0.0.1` solo sirve desde el mismo PC: si ejecutas Uvicorn manualmente, usa la IP LAN (por ejemplo `http://192.168.x.x:8787`) en `serviceHttpUrl` o define `MECHA_PUBLIC_URL` con esa IP. En el editor de configuracion selecciona el transporte online y conecta el anfitrion. La sala entrega un QR y un enlace por piloto; el video del juego empieza apagado en todos los mandos y cada jugador lo enciende con el boton VIDEO, junto a ESTADO.

Si el celular muestra `ERR_CONNECTION_REFUSED`, revisa primero que el enlace no contenga `127.0.0.1`/`localhost`, que el lanzador siga abierto y que el puerto TCP `8787` este permitido en la red privada de Windows. Si el firewall lo bloquea, abre PowerShell/CMD como administrador y ejecuta: `netsh advfirewall firewall add rule name="MechaKatz Online Service 8787 (Private)" dir=in action=allow protocol=TCP localport=8787 profile=private`. Es una regla local acotada al puerto y perfil privado; no la agregues en redes publicas.

## Publicacion para Internet

La ejecucion publica (fuera de la misma Wi-Fi) requiere un dominio HTTPS, proxy con WebSocket, secretos persistentes y un servidor TURN. Configura `MECHA_PUBLIC_URL=https://...` antes de iniciar el relay; no guardes secretos reales en el repositorio. Sin esa infraestructura solo queda disponible el modo LAN.

El estado de las salas vive en memoria. Ejecuta una sola instancia y un solo worker. Antes de escalar horizontalmente hay que mover sesiones y coordinacion a un almacen compartido.

STUN puede bastar en redes sencillas, pero no atraviesa todas las combinaciones de NAT o firewall. El control y la cabina funcionan enteramente sobre WSS; para afirmar que el video del juego (boton VIDEO) funciona entre redes arbitrarias se debe configurar TURN y probar desde datos celulares.

Consulta [online_service/README.md](online_service/README.md) para el despliegue y las variables.

## Verificacion

```powershell
node .\build_config_editor.js
py -3.11 -m pytest -q
py -3.11 -m uvicorn online_service.app:app --host 127.0.0.1 --port 8787
py -3.11 .\tests\live_relay_smoke.py http://127.0.0.1:8787
```

`tests/test_client_contracts.js` valida sintaxis y contratos compartidos de juego, movil, editor generado y JSON. `tests/test_cockpit_operators.js` ejecuta el motor de la cabina del celular en Node y dibuja a los 12 operadores en cada modo, evento, tramo de vida y paso de espera:

```powershell
node .\tests\test_client_contracts.js
node .\tests\test_cockpit_operators.js
```

## Licencia

Distribuido bajo la licencia MIT. Consulta [LICENSE](LICENSE).
