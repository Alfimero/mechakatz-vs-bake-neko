# Servicio online de MechaKatz

Servicio FastAPI que crea salas efimeras, emite tickets firmados y conecta un anfitrion con hasta cuatro controladores. Los controles, snapshots y la senalizacion viajan por WebSocket; el video/audio viaja directamente entre navegador y telefono mediante WebRTC.

## Desarrollo local

Las dependencias declaradas estan en `requirements.txt`.

```powershell
py -3.11 -m pip install -r .\online_service\requirements.txt
py -3.11 -m uvicorn online_service.app:app --host 127.0.0.1 --port 8787
```

La configuracion predeterminada permite crear salas sin clave solo para facilitar pruebas locales. No publiques ese valor. Para una prueba desde otro dispositivo en la misma Wi-Fi, el relay debe escuchar en `0.0.0.0` y los enlaces deben anunciar la IPv4 LAN del PC; `127.0.0.1` siempre significa el dispositivo que abre el enlace. El lanzador `start_mecha_online_service.bat` hace ese anuncio automaticamente si no se definio `MECHA_PUBLIC_URL`. Si Windows bloquea la entrada, permite solo el puerto privado con `netsh advfirewall firewall add rule name="MechaKatz Online Service 8787 (Private)" dir=in action=allow protocol=TCP localport=8787 profile=private` ejecutado como administrador.

## Configuracion publica

Variables disponibles:

- `MECHA_PUBLIC_URL`: origen HTTPS visible, por ejemplo `https://juego.example.com`.
- `MECHA_TOKEN_SECRET`: secreto largo y persistente para tickets HMAC.
- `MECHA_HOST_KEY`: clave que el juego usa al crear una sala.
- `MECHA_ALLOW_OPEN_CREATE=false`: obliga a presentar la clave anterior.
- `MECHA_ALLOWED_ORIGINS`: lista separada por comas para REST y WebSocket. Incluye `null` solo si se autorizara expresamente un anfitrion abierto por `file://`.
- `MECHA_ICE_SERVERS_JSON`: lista JSON de servidores STUN/TURN y sus credenciales.
- `MECHA_MAX_MESSAGE_BYTES`, `MECHA_MAX_INPUTS_PER_SECOND`, `MECHA_HEARTBEAT_SECONDS` y `MECHA_HEARTBEAT_GRACE_SECONDS`: limites operativos.

Usa un proxy que termine TLS y preserve Upgrade/Connection para `/ws`. El valor publico debe producir enlaces `https://` y `wss://`.

Tambien se incluye un contenedor de un solo worker. Desde la raiz, despues de crear `online_service/.env`:

```powershell
docker compose -f .\docker-compose.online.example.yml up --build
```

El puerto se publica solo en loopback para que el proxy HTTPS sea el unico punto de entrada publico.

## Limites del MVP

- Las salas estan en RAM y se pierden al reiniciar.
- Debe ejecutarse un solo worker; varios workers no comparten sesiones.
- El relay no transporta el video y no sustituye TURN.
- Cada enlace corresponde a un slot. El ticket se coloca en el fragmento de la URL para que no llegue en la peticion HTTP y el controlador lo retira de la barra al cargar.
- El juego conserva la autoridad de movimiento, combate y puntuacion.

## Pruebas

```powershell
py -3.11 -m pytest -q
py -3.11 .\tests\live_relay_smoke.py http://127.0.0.1:8787
```

La suite cubre creacion/autorizacion de salas, tickets, aislamiento, asignacion de dispositivo, secuencias de entrada, neutralizacion al desconectar y enrutamiento de senalizacion. El smoke contra Uvicorn real monta simultaneamente un telefono en Estado y otro en Juego. La aceptacion publica exige ademas una prueba manual con el anfitrion y un telefono en redes distintas, incluyendo una ruta ICE `relay` provista por TURN.
