# Plan: mundos acuáticos (Atlántida, Ártico, Playa y Río)

Estado: **propuesta, no implementada**. Se apoya en la arquitectura actual:
cada mundo tiene 3 niveles (`stage.levels[0..2]` = MAÑANA, TARDE y NOCHE), cada
nivel tiene 3 oleadas, un bestiario por mundo (`WORLD_BESTIARY`) y un jefe de
2 fases en el 3er nivel (`BOSS_TYPES`).

## 1. Idea general

Los cuatro mundos nuevos funcionan igual que los actuales (3 niveles, 3 oleadas,
monstruo de la tarde, monstruo de la noche y jefe al final). Lo nuevo es que un
nivel puede cambiar de **modalidad**: tierra, bajo el agua, orilla, corriente o
ventisca. Así un mismo mundo puede contar una pequeña historia, como en el Ártico:

| Mundo | Nivel 1 · MAÑANA | Nivel 2 · TARDE | Nivel 3 · NOCHE + jefe |
| --- | --- | --- | --- |
| **ÁRTICO** | Tundra helada (tierra, ventisca suave) | **Bajo el hielo** (submarino) | Témpanos con manadas de pingüinos (tierra) |
| **ATLÁNTIDA** | Arrecife de entrada (submarino) | Ciudad hundida (submarino) | Templo del abismo (submarino, oscuridad) |
| **PLAYA** | Playa soleada (tierra) | Pozas de marea (orilla) | Playa nocturna bioluminiscente (orilla) |
| **RÍO** | Ribera (tierra) | Rápidos en balsa (corriente) | Poza de la cascada (orilla) |

En modo **UN MUNDO COMPLETO** se vive la historia entera (en el Ártico: tundra →
buceo bajo el hielo → salida a tierra entre pingüinos). En partidas al azar cada
nivel también funciona suelto: si el Ártico cae en 2do lugar, ese nivel es "el
Ártico bajo el hielo".

## 2. Cambios de base (fase 0)

Son pequeños y compatibles con las configuraciones actuales:

1. **Escena propia por nivel** — `level.scenery` opcional. Si existe, el nivel
   usa esa escena en lugar de la escena base del mundo (la del Ártico
   submarino no se parece a la tundra). El look de mañana/tarde/noche se sigue
   aplicando encima. En DECOR, el selector "Ver momento del día" pasa a
   "Escena: base / nivel N" y pinta sobre la escena elegida.
2. **Modalidad por nivel** — `level.mode`: `tierra` | `submarino` | `orilla` |
   `corriente` | `ventisca`. Una tabla `LEVEL_MODES` define la física y los
   efectos (ver sección 3). Por defecto `tierra`, así nada cambia.
3. **Transiciones de entrada y salida** — `level.entry` / `level.exit`:
   - `caida` (actual): los mechas caen del cielo y salen volando.
   - `zambullida`: al terminar, los mechas saltan a un agujero en el hielo o al
     mar (chapuzón y burbujas).
   - `hundirse`: el nivel empieza con los mechas descendiendo entre burbujas.
   - `emerger`: salen del agua de un salto y aterrizan en tierra.
   - `balsa`: entran subidos a una balsa (nivel de corriente).
4. **Jefe del mundo** — nueva opción `CONFIG.boss.pick = 'world'`: el jefe es
   el del mundo que cae en 3er lugar (ORCATRON en el Ártico, etc.). `random`
   sigue sorteando entre todos.
5. **Mundos sembrados una vez** — se agregan con el mecanismo actual
   (`seedBuiltinWorlds` + `CONFIG.worldSeeds`), con ids `arctic`, `atlantis`,
   `beach` y `river`, y un set propio.

## 3. Modalidades

Ninguna agrega botones: el celular sigue con palanca + STRIKE/SYSTEM y el
teclado/MIDI no cambian. Eso es clave para el show.

| Modalidad | Física y reglas | Efectos |
| --- | --- | --- |
| **Submarino** | Gravedad baja (saltos y derribos flotan), movimiento ×0.85, proyectiles más lentos. El "vuelo" pasa a ser nado libre sin costo de vida. Los enemigos pueden nadar a distinta altura. | Tinte azul con perspectiva, rayos de luz, cáusticas animadas, burbujas de los mechas y un sonido amortiguado. |
| **Orilla** | Los carriles cercanos son agua baja: frenan un 25 % y salpican. Las olas llegan cada cierto tiempo y empujan hacia el fondo. | Espuma en la línea del agua y chapoteo. |
| **Corriente** | La cámara avanza sola (balsa). Troncos y rocas cruzan los carriles como obstáculos y los enemigos saltan a la balsa. | Agua rápida, salpicaduras y remolinos. |
| **Ventisca** | Viento que empuja de lado en rachas avisadas; suelo de hielo con inercia (se resbala). | Nieve cayendo, visibilidad reducida en el fondo. |
| **Abismo** (variante nocturna submarina) | Solo se ve alrededor de cada mecha y de las criaturas luminosas. | Viñeta oscura con luces; peces linterna. |

## 4. Bestiario nuevo (8 monstruos)

| Mundo | TARDE (nivel 2+) | NOCHE (nivel 3) |
| --- | --- | --- |
| Ártico | **NARVAL-X**: embiste con el cuerno bajo el agua tras apuntar por su carril. | **PINGÜINO-COMANDO**: llegan en escuadras de 3 y cruzan deslizándose de panza; al final del nivel, manadas neutrales cruzan el fondo. |
| Atlántida | **MEDUSA-BOT**: flota subiendo y bajando; cada tanto se electrifica (aura con aviso) y no conviene tocarla. | **PEZ-LINTERNA**: en la oscuridad solo se ve su señuelo; si te acercas, muerde. |
| Playa | **CANGREJO-ERMITAÑO**: se esconde en la concha (invulnerable) y sale a pellizcar; la concha se puede patear contra otros. | **GAVIOTA-DRON**: se lanza en picada y **roba los ítems de vida** del suelo. |
| Río | **PIRAÑA-BOT**: cardúmenes que saltan del agua en arco cruzando carriles. | **CAIMÁN**: se hace pasar por tronco y muerde cuando pasas cerca. |

Todos siguen el patrón actual: `ability` propia, aviso antes de pegar y más
fuerza con el nivel (`tier` 1..3). Se editan y pintan en la pestaña ENEMIES.

## 5. Jefes nuevos (2 fases, 3 ataques en los cues MIDI)

| Jefe | Mundo | Ataque 1 (laser) | Ataque 2 (fuego) | Ataque 3 (golpe) | Fase 2 |
| --- | --- | --- | --- | --- | --- |
| **ORCATRON** | Ártico | Aliento helado (rayo que congela y frena) | Lluvia de carámbanos | Embestida desde bajo el hielo (brota bajo un jugador) | Rompe el hielo y ataca saltando en arcos. |
| **POSEIDRON** | Atlántida | Rayo del tridente | Cortina de burbujas | Maremoto por carriles | Se le cae la armadura e invoca un remolino que atrae. |
| **KRAKEN-TAKO** | Playa | Tentáculos que golpean carriles | Nube de tinta (zona oscura con daño) | Remolino que jala | Se enfurece: 8 tentáculos y más rápido. |
| **KAPPA-GIGA** | Río | Chorro de agua | Lluvia de rocas del río | Ola a ras de suelo (se salta volando) | Se derrama el agua de su cabeza y entra en frenesí (yokai, como el Bake-Neko). |

Se reutilizan los tipos de ataque existentes (`beam`, `volley`, `slam`,
`charge`, `wave`, `rain`) y se agrega uno: `pull` (remolino/tentáculo que
atrae), que también sirve para POSEIDRON y KRAKEN-TAKO.

## 6. Elementos de escenario nuevos (DECOR)

- **Submarino**: fondo de mar con rayos de luz, algas (kelp), corales, burbujas,
  cáusticas, bancos de peces, barco hundido, columnas y estatuas de la Atlántida.
- **Ártico**: aurora boreal (cielo), icebergs, témpanos, iglús, nieve cayendo,
  manada de pingüinos de fondo, agujero en el hielo (para la transición).
- **Playa**: olas rompiendo, sombrillas, castillos de arena, faro, muelle.
- **Río**: rápidos, troncos, juncos, nenúfares, puente colgante.
- **Suelos**: lecho marino, hielo, arena húmeda con espuma y ribera.

Todos con el mismo sistema: colores editables, parallax, zonas del nivel,
densidad, crecimiento y caché de sprites.

## 7. Fases de trabajo sugeridas

1. **Fase 0 — Base**: escena por nivel, modalidades con tabla de física,
   transiciones de entrada/salida y jefe del mundo. Verificar que los 6 mundos
   actuales se ven y juegan idénticos.
2. **Fase 1 — Atlántida**: modalidad submarina completa, elementos marinos,
   MEDUSA-BOT, PEZ-LINTERNA y POSEIDRON (con el ataque `pull`).
3. **Fase 2 — Ártico**: tundra con ventisca, nivel bajo el hielo con zambullida
   y salida, pingüinos (enemigos y manadas neutrales), NARVAL-X y ORCATRON.
4. **Fase 3 — Playa y Río**: modalidad orilla (carriles de agua y olas),
   modalidad corriente (balsa con cámara automática), sus 4 monstruos y
   KRAKEN-TAKO y KAPPA-GIGA.
5. **Fase 4 — Show**: cues MIDI opcionales (ola que empuja a todos, ráfaga de
   ventisca, apagar la luz del abismo), ajuste de dificultad y documentación.

## 8. Riesgos y decisiones abiertas

- **Controles**: bajo el agua no se agrega un eje vertical nuevo; los mechas
  flotan solos y el nado libre usa el vuelo actual. Si se quisiera profundidad
  real, habría que mapearla en el celular (hoy la palanca ya usa arriba/abajo
  para cambiar de carril).
- **Oxígeno**: se propone **no** usar medidor de aire (en un show en vivo
  frustra); como opción, burbujas de aire que curan.
- **Legibilidad**: el tinte submarino y la oscuridad del abismo deben conservar
  el contraste de mechas y enemigos. Se prueban con capturas como las de esta
  entrega.
- **Rendimiento**: las cáusticas y la luz del abismo se dibujan como patrones en
  caché y no píxel a píxel.
- **Corriente**: la cámara automática cambia el ritmo de las oleadas; conviene
  que en ese nivel las oleadas no bloqueen el avance (llegan sobre la balsa).
