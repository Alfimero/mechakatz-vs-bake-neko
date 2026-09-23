from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import hmac
import html
import io
import json
import os
import secrets
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote

import qrcode
from fastapi import FastAPI, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from pydantic import BaseModel, Field


PROTOCOL = "mecha.v1"
TICKET_PROTOCOL_PREFIX = "ticket."
DEVICE_PROTOCOL_PREFIX = "device."
ACTION_NAMES = ("up", "down", "left", "right", "light", "heavy", "shield", "special", "flight")
ALLOWED_ACTIONS = frozenset(ACTION_NAMES)
ALLOWED_SESSION_MODES = frozenset(("controller", "stream", "mixed"))
ALLOWED_VIEW_MODES = frozenset(("controller", "stream"))
MAX_NEGOTIATION_ID_CHARS = 128
MAX_SDP_CHARS = 96 * 1024
MAX_ICE_CANDIDATE_CHARS = 8 * 1024
MAX_SDP_MID_CHARS = 256
ROOT = Path(__file__).resolve().parents[1]
MOBILE_CONTROLLER = ROOT / "mobile-controller.html"


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on", "si", "sí"}


def _base64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _base64url_decode(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


@dataclass(slots=True)
class Settings:
    token_secret: str
    host_key: str = ""
    allow_open_create: bool = True
    public_url: str = ""
    allowed_origins: tuple[str, ...] = ("*",)
    max_players: int = 4
    max_message_bytes: int = 65_536
    max_inputs_per_second: int = 120
    heartbeat_seconds: float = 25.0
    heartbeat_grace_seconds: float = 15.0
    ice_servers: list[dict[str, Any]] = field(
        default_factory=lambda: [{"urls": ["stun:stun.l.google.com:19302"]}]
    )

    @classmethod
    def from_env(cls) -> "Settings":
        origins_raw = os.getenv("MECHA_ALLOWED_ORIGINS", "*")
        origins = tuple(item.strip() for item in origins_raw.split(",") if item.strip()) or ("*",)
        ice_raw = os.getenv(
            "MECHA_ICE_SERVERS_JSON",
            '[{"urls":["stun:stun.l.google.com:19302"]}]',
        )
        try:
            ice_servers = json.loads(ice_raw)
            if not isinstance(ice_servers, list):
                raise ValueError
        except (json.JSONDecodeError, ValueError):
            raise RuntimeError("MECHA_ICE_SERVERS_JSON debe ser una lista JSON valida")
        return cls(
            token_secret=os.getenv("MECHA_TOKEN_SECRET") or secrets.token_urlsafe(48),
            host_key=os.getenv("MECHA_HOST_KEY", ""),
            allow_open_create=_env_bool("MECHA_ALLOW_OPEN_CREATE", True),
            public_url=os.getenv("MECHA_PUBLIC_URL", "").rstrip("/"),
            allowed_origins=origins,
            max_message_bytes=max(4_096, int(os.getenv("MECHA_MAX_MESSAGE_BYTES", "65536"))),
            max_inputs_per_second=max(20, int(os.getenv("MECHA_MAX_INPUTS_PER_SECOND", "120"))),
            heartbeat_seconds=max(5.0, float(os.getenv("MECHA_HEARTBEAT_SECONDS", "25"))),
            heartbeat_grace_seconds=max(3.0, float(os.getenv("MECHA_HEARTBEAT_GRACE_SECONDS", "15"))),
            ice_servers=ice_servers,
        )


class SessionCreate(BaseModel):
    title: str = Field(default="MechaKatz VS Bake-Neko!", min_length=1, max_length=80)
    mode: Literal["controller", "stream", "mixed"] = "mixed"
    ttl_minutes: int = Field(default=180, ge=5, le=480)
    max_players: int = Field(default=4, ge=1, le=4)


@dataclass(slots=True)
class ConnectionState:
    websocket: WebSocket
    nonce: str
    role: str
    player: int | None = None
    device_hash: str = ""
    view_mode: str = "controller"
    last_sequence: int = -1
    input_times: deque[float] = field(default_factory=deque)
    last_seen: float = field(default_factory=time.monotonic)
    released: bool = False


@dataclass(slots=True)
class GameSession:
    session_id: str
    room_code: str
    title: str
    mode: str
    max_players: int
    created_at: float
    expires_at: float
    host_nonce: str
    controller_nonces: list[str]
    controller_device_hashes: list[str | None] = field(default_factory=list)
    host: ConnectionState | None = None
    controllers: list[ConnectionState | None] = field(default_factory=list)
    last_snapshot: dict[str, Any] | None = None

    def __post_init__(self) -> None:
        if not self.controllers:
            self.controllers = [None] * self.max_players
        if not self.controller_device_hashes:
            self.controller_device_hashes = [None] * self.max_players


class SessionRegistry:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.sessions: dict[str, GameSession] = {}

    def cleanup(self) -> None:
        now = time.time()
        expired = [sid for sid, session in self.sessions.items() if session.expires_at <= now]
        for sid in expired:
            self.sessions.pop(sid, None)

    def create(self, payload: SessionCreate) -> GameSession:
        self.cleanup()
        session_id = secrets.token_urlsafe(18)
        while session_id in self.sessions:
            session_id = secrets.token_urlsafe(18)
        room_code = secrets.token_hex(3).upper()
        now = time.time()
        session = GameSession(
            session_id=session_id,
            room_code=room_code,
            title=payload.title.strip(),
            mode=payload.mode,
            max_players=payload.max_players,
            created_at=now,
            expires_at=now + payload.ttl_minutes * 60,
            host_nonce=secrets.token_urlsafe(18),
            controller_nonces=[secrets.token_urlsafe(18) for _ in range(payload.max_players)],
        )
        self.sessions[session_id] = session
        return session

    def get(self, session_id: str) -> GameSession:
        self.cleanup()
        session = self.sessions.get(session_id)
        if not session:
            raise KeyError(session_id)
        return session


def issue_ticket(settings: Settings, session: GameSession, role: str, nonce: str, player: int | None = None) -> str:
    claims: dict[str, Any] = {
        "v": 1,
        "sid": session.session_id,
        "role": role,
        "nonce": nonce,
        "exp": int(session.expires_at),
    }
    if player is not None:
        claims["player"] = player
    body = _base64url(json.dumps(claims, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signature = _base64url(hmac.new(settings.token_secret.encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest())
    return f"{body}.{signature}"


def decode_ticket(settings: Settings, token: str) -> dict[str, Any]:
    try:
        if not isinstance(token, str) or not 32 <= len(token) <= 2_048:
            raise ValueError("longitud")
        body, signature = token.split(".", 1)
        if not body or not signature or "." in signature:
            raise ValueError("formato")
        expected = _base64url(
            hmac.new(settings.token_secret.encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest()
        )
        if not hmac.compare_digest(signature, expected):
            raise ValueError("firma")
        claims = json.loads(_base64url_decode(body).decode("utf-8"))
        if not isinstance(claims, dict):
            raise ValueError("claims")
        expires_at = claims.get("exp")
        if claims.get("v") != 1 or type(expires_at) is not int or expires_at <= int(time.time()):
            raise ValueError("expirado")
        if claims.get("role") not in {"host", "controller"}:
            raise ValueError("rol")
        if not isinstance(claims.get("sid"), str) or not isinstance(claims.get("nonce"), str):
            raise ValueError("identidad")
        if claims["role"] == "controller" and type(claims.get("player")) is not int:
            raise ValueError("slot")
        return claims
    except (ValueError, TypeError, KeyError, binascii.Error, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=401, detail="Ticket invalido o expirado") from exc


def request_base_url(request: Request, settings: Settings) -> str:
    if settings.public_url:
        return settings.public_url
    forwarded_proto = request.headers.get("x-forwarded-proto")
    forwarded_host = request.headers.get("x-forwarded-host")
    if forwarded_proto and forwarded_host:
        return f"{forwarded_proto}://{forwarded_host}".rstrip("/")
    return str(request.base_url).rstrip("/")


def websocket_url(base_url: str) -> str:
    if base_url.startswith("https://"):
        return "wss://" + base_url.removeprefix("https://") + "/ws"
    return "ws://" + base_url.removeprefix("http://") + "/ws"


def join_url(base_url: str, token: str, view_mode: str) -> str:
    fragment = f"ticket={quote(token, safe='')}&view={view_mode}"
    return f"{base_url}/controller#{fragment}"


def has_turn_server(settings: Settings) -> bool:
    for server in settings.ice_servers:
        if not isinstance(server, dict):
            continue
        urls = server.get("urls", [])
        if isinstance(urls, str):
            urls = [urls]
        if isinstance(urls, list) and any(
            isinstance(url, str) and url.lower().startswith(("turn:", "turns:")) for url in urls
        ):
            return True
    return False


def session_payload(session: GameSession, settings: Settings, base_url: str, include_host: bool = True) -> dict[str, Any]:
    host_ticket = issue_ticket(settings, session, "host", session.host_nonce)
    controller_tickets = [
        issue_ticket(settings, session, "controller", nonce, player)
        for player, nonce in enumerate(session.controller_nonces)
    ]
    result: dict[str, Any] = {
        "type": "session_created",
        "sessionId": session.session_id,
        "roomCode": session.room_code,
        "roomUrl": f"{base_url}/room/{session.session_id}",
        "wsUrl": websocket_url(base_url),
        "mode": session.mode,
        "expiresAt": int(session.expires_at),
        "iceServers": settings.ice_servers,
        "turnAvailable": has_turn_server(settings),
        "streamNetworkScope": "internet" if has_turn_server(settings) else "best_effort",
        "joinUrls": [join_url(base_url, token, "controller") for token in controller_tickets],
        "streamUrls": [join_url(base_url, token, "stream") for token in controller_tickets],
    }
    if include_host:
        result["hostTicket"] = host_ticket
    return result


def parse_websocket_ticket(websocket: WebSocket) -> tuple[str, list[str], str]:
    protocols = [part.strip() for part in websocket.headers.get("sec-websocket-protocol", "").split(",") if part.strip()]
    ticket_protocol = next((value for value in protocols if value.startswith(TICKET_PROTOCOL_PREFIX)), "")
    if not ticket_protocol:
        raise HTTPException(status_code=401, detail="Falta ticket WebSocket")
    device_protocol = next((value for value in protocols if value.startswith(DEVICE_PROTOCOL_PREFIX)), "")
    device_secret = device_protocol[len(DEVICE_PROTOCOL_PREFIX) :] if device_protocol else ""
    return ticket_protocol[len(TICKET_PROTOCOL_PREFIX) :], protocols, device_secret


def valid_device_secret(value: str) -> bool:
    allowed = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-")
    return 16 <= len(value) <= 256 and all(char in allowed for char in value)


def hash_device_secret(value: str) -> str:
    return hashlib.sha256(value.encode("ascii")).hexdigest()


def clean_actions(value: Any) -> dict[str, bool] | None:
    if not isinstance(value, dict) or set(value) != ALLOWED_ACTIONS:
        return None
    if any(type(value[action]) is not bool for action in ACTION_NAMES):
        return None
    return {action: value[action] for action in ACTION_NAMES}


def validate_input_sequence(connection: ConnectionState, sequence: Any, settings: Settings) -> str | None:
    if type(sequence) is not int or sequence < 0:
        return "schema"
    now = time.monotonic()
    while connection.input_times and connection.input_times[0] < now - 1.0:
        connection.input_times.popleft()
    if len(connection.input_times) >= settings.max_inputs_per_second:
        return "rate"
    if sequence <= connection.last_sequence:
        return "sequence"
    connection.input_times.append(now)
    connection.last_sequence = sequence
    return None


def clean_rtc_payload(payload: dict[str, Any], player: int) -> dict[str, Any] | None:
    message_type = payload.get("type")
    negotiation_id = payload.get("negotiationId")
    if (
        message_type not in {"webrtc_offer", "webrtc_answer", "webrtc_ice", "webrtc_stop"}
        or not isinstance(negotiation_id, str)
        or not 1 <= len(negotiation_id) <= MAX_NEGOTIATION_ID_CHARS
    ):
        return None
    outgoing: dict[str, Any] = {
        "type": message_type,
        "player": player,
        "negotiationId": negotiation_id,
    }
    if message_type in {"webrtc_offer", "webrtc_answer"}:
        sdp = payload.get("sdp")
        if not isinstance(sdp, str) or not 1 <= len(sdp) <= MAX_SDP_CHARS:
            return None
        outgoing["sdp"] = sdp
    elif message_type == "webrtc_ice":
        candidate = payload.get("candidate")
        if not isinstance(candidate, dict):
            return None
        candidate_text = candidate.get("candidate")
        sdp_mid = candidate.get("sdpMid")
        sdp_line = candidate.get("sdpMLineIndex")
        if not isinstance(candidate_text, str) or len(candidate_text) > MAX_ICE_CANDIDATE_CHARS:
            return None
        if sdp_mid is not None and (not isinstance(sdp_mid, str) or len(sdp_mid) > MAX_SDP_MID_CHARS):
            return None
        if sdp_line is not None and (type(sdp_line) is not int or sdp_line < 0):
            return None
        outgoing["candidate"] = {
            "candidate": candidate_text,
            "sdpMid": sdp_mid,
            "sdpMLineIndex": sdp_line,
        }
    return outgoing


def origin_allowed(websocket: WebSocket, settings: Settings) -> bool:
    if "*" in settings.allowed_origins:
        return True
    origin = websocket.headers.get("origin", "")
    return origin in settings.allowed_origins or (origin == "null" and "null" in settings.allowed_origins)


async def safe_send(connection: ConnectionState | None, payload: dict[str, Any]) -> bool:
    if not connection:
        return False
    try:
        await connection.websocket.send_json(payload)
        return True
    except Exception:
        return False


async def close_connection(connection: ConnectionState | None, code: int = 1000) -> None:
    if not connection:
        return
    try:
        await connection.websocket.close(code=code)
    except Exception:
        pass


def allowed_view(session: GameSession, requested: Any) -> str:
    requested_mode = requested if requested in ALLOWED_VIEW_MODES else "controller"
    if session.mode == "controller":
        return "controller"
    if session.mode == "stream":
        return "stream"
    return requested_mode


def public_session_status(session: GameSession) -> dict[str, Any]:
    return {
        "sessionId": session.session_id,
        "roomCode": session.room_code,
        "title": session.title,
        "mode": session.mode,
        "expiresAt": int(session.expires_at),
        "hostConnected": bool(session.host),
        "controllers": [
            {"connected": bool(controller), "viewMode": controller.view_mode if controller else None}
            for controller in session.controllers
        ],
    }


def room_page(session: GameSession, settings: Settings, base_url: str) -> str:
    payload = session_payload(session, settings, base_url, include_host=False)
    cards: list[str] = []
    for player in range(session.max_players):
        control_url = payload["joinUrls"][player]
        stream_url = payload["streamUrls"][player]
        cards.append(
            f"""
            <article class="card" data-player="{player}">
              <h2>P{player + 1}</h2>
              <img src="/room/{quote(session.session_id)}/qr/{player}?view=controller" alt="QR de control P{player + 1}">
              <a href="{html.escape(control_url)}">Control + estado</a>
              <a class="stream" href="{html.escape(stream_url)}">Juego transmitido + control</a>
              <span class="presence">Libre</span>
            </article>
            """
        )
    safe_title = html.escape(session.title)
    return f"""<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{safe_title} - Sala {session.room_code}</title>
<style>
:root{{--bg:#08010f;--panel:#11182a;--cyan:#00f0ff;--pink:#ff2e88;--yellow:#ffea00;--green:#00ff7f}}
*{{box-sizing:border-box}} body{{margin:0;background:radial-gradient(circle at top,#24103a,var(--bg) 55%);color:#e8feff;font:16px Consolas,monospace;min-height:100vh}}
main{{width:min(1120px,94vw);margin:auto;padding:32px 0}} h1{{color:var(--yellow);margin-bottom:6px}} .lead{{color:#bffaff;margin-top:0}}
.meta{{padding:14px;border:1px solid #2b4260;background:#080d18;margin:20px 0}} .grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px}}
.card{{padding:16px;background:linear-gradient(180deg,var(--panel),#080b13);border:1px solid #244c61;text-align:center}} .card.busy{{border-color:var(--green)}}
.card img{{display:block;width:min(100%,260px);margin:0 auto 12px;background:#fff;padding:8px}} .card a{{display:block;margin:8px 0;padding:10px;color:#001018;background:var(--cyan);text-decoration:none;font-weight:bold}}
.card a.stream{{background:var(--pink);color:#fff}} .presence{{display:block;margin-top:10px;color:var(--green)}} code{{color:var(--cyan)}}
</style></head><body><main>
<h1>{safe_title}</h1><p class="lead">Sala <strong>{session.room_code}</strong>. Cada telefono puede usar solo estado o recibir el juego transmitido.</p>
<div class="meta">El anfitrion se conecta de salida al relay. Expira: <code>{time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(session.expires_at))}</code>.</div>
<section class="grid">{''.join(cards)}</section>
</main><script>
async function refresh(){{try{{const r=await fetch('/api/sessions/{session.session_id}/public',{{cache:'no-store'}});if(!r.ok)return;const d=await r.json();document.querySelectorAll('.card').forEach((card,i)=>{{const c=d.controllers[i];card.classList.toggle('busy',!!(c&&c.connected));card.querySelector('.presence').textContent=c&&c.connected?('Conectado / '+c.viewMode):'Libre';}});}}catch(_e){{}}}}
setInterval(refresh,1500);refresh();
</script></body></html>"""


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    registry = SessionRegistry(settings)
    app = FastAPI(title="MechaKatz Online Session Orchestrator", version="1.0.0")
    app.state.settings = settings
    app.state.registry = registry

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-Mecha-Host-Key", "Authorization"],
    )

    @app.on_event("startup")
    async def startup_notice() -> None:
        if not os.getenv("MECHA_TOKEN_SECRET"):
            print("AVISO: MECHA_TOKEN_SECRET no esta configurado; los tickets cambiaran al reiniciar.")
        if settings.allow_open_create and not settings.host_key:
            print("AVISO: creacion abierta para desarrollo. En Internet define MECHA_HOST_KEY y MECHA_ALLOW_OPEN_CREATE=false.")

    @app.get("/health")
    async def health() -> dict[str, Any]:
        registry.cleanup()
        return {"status": "ok", "protocol": PROTOCOL, "sessions": len(registry.sessions)}

    @app.get("/")
    async def index() -> HTMLResponse:
        return HTMLResponse(
            """<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MechaKatz Online</title><style>body{margin:0;background:#08010f;color:#dffcff;font:18px Consolas,monospace;display:grid;place-items:center;min-height:100vh}main{max-width:720px;padding:28px;border:1px solid #00f0ff;background:#10182a}h1{color:#ffea00}code{color:#00ff7f}</style>
<main><h1>MechaKatz Online</h1><p>Relay de sesiones, controles y señalizacion WebRTC activo.</p><p>Salud: <code>/health</code></p></main></html>"""
        )

    @app.get("/controller")
    async def controller() -> FileResponse:
        return FileResponse(MOBILE_CONTROLLER, media_type="text/html; charset=utf-8")

    @app.post("/api/sessions", status_code=201)
    async def create_session(
        payload: SessionCreate,
        request: Request,
        x_mecha_host_key: str | None = Header(default=None),
    ) -> JSONResponse:
        if settings.host_key:
            if not x_mecha_host_key or not secrets.compare_digest(x_mecha_host_key, settings.host_key):
                raise HTTPException(status_code=401, detail="Clave de anfitrion invalida")
        elif not settings.allow_open_create:
            raise HTTPException(status_code=503, detail="La creacion de sesiones requiere MECHA_HOST_KEY")
        session = registry.create(payload)
        return JSONResponse(session_payload(session, settings, request_base_url(request, settings)), status_code=201)

    @app.get("/api/sessions/{session_id}/public")
    async def session_status(session_id: str) -> JSONResponse:
        try:
            session = registry.get(session_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Sala no encontrada") from exc
        return JSONResponse(public_session_status(session))

    @app.delete("/api/sessions/{session_id}", status_code=204)
    async def delete_session(session_id: str, authorization: str | None = Header(default=None)) -> Response:
        token = authorization.removeprefix("Bearer ").strip() if authorization else ""
        claims = decode_ticket(settings, token)
        if claims.get("role") != "host" or claims.get("sid") != session_id:
            raise HTTPException(status_code=403, detail="Solo el anfitrion puede cerrar la sala")
        try:
            session = registry.get(session_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Sala no encontrada") from exc
        if claims.get("nonce") != session.host_nonce:
            raise HTTPException(status_code=403, detail="Ticket de anfitrion invalido")
        await close_connection(session.host, 4000)
        for connection in session.controllers:
            await close_connection(connection, 4000)
        registry.sessions.pop(session_id, None)
        return Response(status_code=204)

    @app.get("/room/{session_id}")
    async def get_room(session_id: str, request: Request) -> HTMLResponse:
        try:
            session = registry.get(session_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Sala no encontrada") from exc
        return HTMLResponse(room_page(session, settings, request_base_url(request, settings)))

    @app.get("/room/{session_id}/qr/{player}")
    async def get_room_qr(session_id: str, player: int, request: Request, view: str = "controller") -> Response:
        try:
            session = registry.get(session_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Sala no encontrada") from exc
        if player < 0 or player >= session.max_players:
            raise HTTPException(status_code=404, detail="Slot no encontrado")
        view_mode = allowed_view(session, view)
        token = issue_ticket(settings, session, "controller", session.controller_nonces[player], player)
        url = join_url(request_base_url(request, settings), token, view_mode)
        image = qrcode.make(url)
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        return Response(buffer.getvalue(), media_type="image/png", headers={"Cache-Control": "no-store"})

    async def send_server_info(session: GameSession, connection: ConnectionState, base_url: str) -> None:
        payload = session_payload(session, settings, base_url, include_host=False)
        if connection.role == "controller":
            # A controller is authorized for exactly one ticket-bound slot.  Do
            # not disclose the bearer links for the other three slots.
            payload.pop("joinUrls", None)
            payload.pop("streamUrls", None)
        payload.update(
            {
                "type": "server_info",
                "title": session.title,
                "controllers": [bool(item) for item in session.controllers],
                "views": [item.view_mode if item else None for item in session.controllers],
                "allowedViews": ["controller"] if session.mode == "controller" else (["stream"] if session.mode == "stream" else ["controller", "stream"]),
            }
        )
        if connection.player is not None:
            payload["player"] = connection.player
            payload["viewMode"] = connection.view_mode
        await safe_send(connection, payload)

    async def notify_host_presence(session: GameSession, event_type: str, player: int, view_mode: str | None = None) -> None:
        payload: dict[str, Any] = {"type": event_type, "player": player}
        if view_mode:
            payload["viewMode"] = view_mode
        await safe_send(session.host, payload)

    async def release(session: GameSession, connection: ConnectionState) -> None:
        if connection.released:
            return
        connection.released = True
        if connection.role == "host" and session.host is connection:
            session.host = None
            for controller in session.controllers:
                await safe_send(controller, {"type": "host_left"})
        elif connection.role == "controller" and connection.player is not None:
            player = connection.player
            if 0 <= player < len(session.controllers) and session.controllers[player] is connection:
                session.controllers[player] = None
                await safe_send(
                    session.host,
                    {
                        "type": "controller_input_state",
                        "player": player,
                        "actions": {action: False for action in ACTION_NAMES},
                        "seq": max(connection.last_sequence, 0),
                        "neutral": True,
                        "reason": "disconnect",
                    },
                )
                await notify_host_presence(session, "controller_left", player)

    async def handle_host_message(session: GameSession, connection: ConnectionState, payload: dict[str, Any], base_url: str) -> None:
        message_type = payload.get("type")
        if message_type == "host_hello":
            await send_server_info(session, connection, base_url)
            return
        if message_type == "snapshot" and isinstance(payload.get("snapshot"), dict):
            session.last_snapshot = payload
            for controller in session.controllers:
                await safe_send(controller, payload)
            return
        if message_type == "toast" and isinstance(payload.get("message"), str):
            clean = {"type": "toast", "message": payload["message"][:300]}
            for controller in session.controllers:
                await safe_send(controller, clean)
            return
        if message_type in {"webrtc_offer", "webrtc_ice", "webrtc_stop"}:
            player = payload.get("player")
            if type(player) is not int or player < 0 or player >= session.max_players:
                await safe_send(connection, {"type": "message_rejected", "reason": "webrtc_schema"})
                return
            outgoing = clean_rtc_payload(payload, player)
            if outgoing is None:
                await safe_send(connection, {"type": "message_rejected", "reason": "webrtc_schema"})
                return
            await safe_send(session.controllers[player], outgoing)
            return
        if message_type in {"webrtc_answer"}:
            await safe_send(connection, {"type": "message_rejected", "reason": "webrtc_direction"})

    async def handle_controller_message(session: GameSession, connection: ConnectionState, payload: dict[str, Any]) -> None:
        message_type = payload.get("type")
        player = connection.player
        if player is None:
            return
        if message_type == "controller_hello":
            next_view = allowed_view(session, payload.get("viewMode"))
            if next_view != connection.view_mode:
                connection.view_mode = next_view
            await notify_host_presence(session, "controller_view", player, connection.view_mode)
            if session.last_snapshot:
                await safe_send(connection, session.last_snapshot)
            return
        if message_type == "set_view":
            next_view = allowed_view(session, payload.get("viewMode"))
            if next_view != connection.view_mode:
                connection.view_mode = next_view
                await notify_host_presence(session, "controller_view", player, connection.view_mode)
            await safe_send(connection, {"type": "view_mode", "viewMode": connection.view_mode})
            return
        if message_type == "request_snapshot":
            if session.last_snapshot:
                await safe_send(connection, session.last_snapshot)
            else:
                await safe_send(session.host, {"type": "request_snapshot"})
            return
        if message_type == "input_state":
            actions = clean_actions(payload.get("actions"))
            sequence = payload.get("seq")
            if actions is None:
                await safe_send(connection, {"type": "input_rejected", "reason": "schema"})
                return
            rejection = validate_input_sequence(connection, sequence, settings)
            if rejection:
                await safe_send(connection, {"type": "input_rejected", "reason": rejection})
                return
            await safe_send(
                session.host,
                {
                    "type": "controller_input_state",
                    "player": player,
                    "actions": actions,
                    "seq": sequence,
                },
            )
            return
        if message_type == "input":
            action = payload.get("action")
            state = payload.get("state")
            sequence = payload.get("seq")
            if action not in ALLOWED_ACTIONS or type(state) is not bool:
                await safe_send(connection, {"type": "input_rejected", "reason": "schema"})
                return
            rejection = validate_input_sequence(connection, sequence, settings)
            if rejection:
                await safe_send(connection, {"type": "input_rejected", "reason": rejection})
                return
            await safe_send(
                session.host,
                {"type": "controller_input", "player": player, "action": action, "state": state, "seq": sequence},
            )
            return
        if message_type in {"webrtc_answer", "webrtc_ice", "webrtc_stop"}:
            outgoing = clean_rtc_payload(payload, player)
            if outgoing is None:
                await safe_send(connection, {"type": "message_rejected", "reason": "webrtc_schema"})
                return
            await safe_send(session.host, outgoing)
            return
        if message_type == "webrtc_offer":
            await safe_send(connection, {"type": "message_rejected", "reason": "webrtc_direction"})

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket) -> None:
        if not origin_allowed(websocket, settings):
            await websocket.close(code=4403)
            return
        try:
            token, protocols, device_secret = parse_websocket_ticket(websocket)
            if PROTOCOL not in protocols:
                raise HTTPException(status_code=400, detail="Protocolo incompatible")
            claims = decode_ticket(settings, token)
            session = registry.get(str(claims["sid"]))
        except (HTTPException, KeyError):
            await websocket.close(code=4401)
            return

        role = str(claims["role"])
        player = claims.get("player")
        nonce = str(claims.get("nonce", ""))
        device_hash = ""
        if role == "host":
            if nonce != session.host_nonce:
                await websocket.close(code=4401)
                return
        else:
            if type(player) is not int or player < 0 or player >= session.max_players:
                await websocket.close(code=4401)
                return
            if nonce != session.controller_nonces[player]:
                await websocket.close(code=4401)
                return
            if not valid_device_secret(device_secret):
                await websocket.close(code=4401)
                return
            device_hash = hash_device_secret(device_secret)

        await websocket.accept(subprotocol=PROTOCOL)
        if role == "host" and session.host is not None:
            await websocket.close(code=4409)
            return
        if role == "controller":
            assert isinstance(player, int)
            bound_hash = session.controller_device_hashes[player]
            if bound_hash is not None and not hmac.compare_digest(bound_hash, device_hash):
                await websocket.close(code=4409)
                return

        connection = ConnectionState(
            websocket=websocket,
            nonce=nonce,
            role=role,
            player=player,
            device_hash=device_hash,
        )
        base_url = settings.public_url or (
            ("https" if websocket.url.scheme == "wss" else "http") + "://" + websocket.headers.get("host", "localhost")
        )

        if role == "host":
            session.host = connection
        else:
            assert isinstance(player, int)
            if session.controller_device_hashes[player] is None:
                session.controller_device_hashes[player] = device_hash
            old = session.controllers[player]
            session.controllers[player] = connection
            if old and old is not connection:
                await safe_send(old, {"type": "slot_replaced", "player": player})
                await close_connection(old, 4009)

        await send_server_info(session, connection, base_url)
        if role == "controller":
            assert isinstance(player, int)
            await notify_host_presence(session, "controller_joined", player, connection.view_mode)
            if session.last_snapshot:
                await safe_send(connection, session.last_snapshot)

        waiting_for_pong = False
        try:
            while True:
                remaining_lifetime = session.expires_at - time.time()
                if remaining_lifetime <= 0:
                    await websocket.close(code=4000)
                    break
                heartbeat_timeout = settings.heartbeat_grace_seconds if waiting_for_pong else settings.heartbeat_seconds
                expires_before_heartbeat = remaining_lifetime <= heartbeat_timeout
                timeout = min(heartbeat_timeout, remaining_lifetime)
                try:
                    raw = await asyncio.wait_for(websocket.receive_text(), timeout=timeout)
                except asyncio.TimeoutError:
                    if expires_before_heartbeat or session.expires_at <= time.time():
                        await websocket.close(code=4000)
                        break
                    if waiting_for_pong:
                        await websocket.close(code=4008)
                        break
                    waiting_for_pong = True
                    await websocket.send_json({"type": "ping", "ts": int(time.time() * 1000)})
                    continue
                connection.last_seen = time.monotonic()
                if session.expires_at <= time.time():
                    await websocket.close(code=4000)
                    break
                if len(raw.encode("utf-8")) > settings.max_message_bytes:
                    await websocket.close(code=1009)
                    break
                try:
                    payload = json.loads(raw)
                except json.JSONDecodeError:
                    await safe_send(connection, {"type": "message_rejected", "reason": "json"})
                    continue
                if not isinstance(payload, dict) or not isinstance(payload.get("type"), str):
                    await safe_send(connection, {"type": "message_rejected", "reason": "schema"})
                    continue
                if payload["type"] == "pong":
                    waiting_for_pong = False
                    continue
                waiting_for_pong = False
                if role == "host":
                    await handle_host_message(session, connection, payload, base_url)
                else:
                    await handle_controller_message(session, connection, payload)
        except WebSocketDisconnect:
            pass
        finally:
            await release(session, connection)

    return app


app = create_app()
