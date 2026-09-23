from __future__ import annotations

from contextlib import AbstractContextManager
import time
from typing import Any
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from online_service.app import ACTION_NAMES, PROTOCOL, Settings, create_app, decode_ticket


ORIGIN = "https://relay.example.test"
HOST_KEY = "show-host-key"
DEVICE_A = "A_controller_device_secret_123456"
DEVICE_B = "B_controller_device_secret_654321"


@pytest.fixture()
def service() -> tuple[TestClient, Settings]:
    settings = Settings(
        token_secret="test-ticket-secret-that-is-long-and-stable",
        host_key=HOST_KEY,
        allow_open_create=False,
        public_url=ORIGIN,
        allowed_origins=(ORIGIN,),
        heartbeat_seconds=60,
        heartbeat_grace_seconds=10,
        ice_servers=[{"urls": ["stun:stun.example.test:3478"]}],
    )
    with TestClient(create_app(settings)) as client:
        yield client, settings


def create_session(client: TestClient, **overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "title": "Test Mecha Show",
        "mode": "mixed",
        "ttl_minutes": 30,
        "max_players": 4,
    }
    payload.update(overrides)
    response = client.post("/api/sessions", json=payload, headers={"X-Mecha-Host-Key": HOST_KEY})
    assert response.status_code == 201
    return response.json()


def ticket_from_join_url(url: str) -> str:
    parsed = urlsplit(url)
    assert parsed.query == ""
    fragment = parse_qs(parsed.fragment)
    assert set(fragment) == {"ticket", "view"}
    return fragment["ticket"][0]


def host_ws(client: TestClient, session: dict[str, Any]) -> AbstractContextManager[Any]:
    return client.websocket_connect(
        "/ws",
        subprotocols=[PROTOCOL, "ticket." + session["hostTicket"]],
        headers={"origin": ORIGIN},
    )


def controller_ws(
    client: TestClient,
    session: dict[str, Any],
    player: int = 0,
    device: str = DEVICE_A,
) -> AbstractContextManager[Any]:
    ticket = ticket_from_join_url(session["joinUrls"][player])
    return client.websocket_connect(
        "/ws",
        subprotocols=[PROTOCOL, "ticket." + ticket, "device." + device],
        headers={"origin": ORIGIN},
    )


def receive_type(
    websocket: Any,
    wanted: str,
    *,
    forbidden: set[str] | None = None,
    limit: int = 12,
) -> dict[str, Any]:
    forbidden = forbidden or set()
    seen: list[str] = []
    for _ in range(limit):
        message = websocket.receive_json()
        message_type = message.get("type")
        seen.append(str(message_type))
        assert message_type not in forbidden, f"received forbidden {message_type}; seen={seen}"
        if message_type == wanted:
            return message
    pytest.fail(f"message {wanted!r} not found; seen={seen}")


def assert_ws_denied(context: AbstractContextManager[Any], expected_code: int) -> None:
    try:
        with context as websocket:
            with pytest.raises(WebSocketDisconnect) as closed:
                websocket.receive_json()
            assert closed.value.code == expected_code
    except Exception as exc:
        # Starlette turns a close before accept into an HTTP denial response.
        # A post-accept policy conflict still exposes the private close code.
        status_code = getattr(exc, "status_code", None)
        close_code = getattr(exc, "code", None)
        assert status_code in {401, 403} or close_code == expected_code


def all_actions(**pressed: bool) -> dict[str, bool]:
    state = {action: False for action in ACTION_NAMES}
    state.update(pressed)
    return state


def test_http_key_tickets_fragment_qr_and_turn_disclosure(service: tuple[TestClient, Settings]) -> None:
    client, settings = service

    assert client.post("/api/sessions", json={}).status_code == 401
    assert client.post(
        "/api/sessions", json={}, headers={"X-Mecha-Host-Key": "wrong"}
    ).status_code == 401

    session = create_session(client)
    assert session["wsUrl"] == "wss://relay.example.test/ws"
    assert session["turnAvailable"] is False
    assert session["streamNetworkScope"] == "best_effort"
    assert len(session["joinUrls"]) == 4
    assert len(session["streamUrls"]) == 4

    controller_ticket = ticket_from_join_url(session["joinUrls"][0])
    claims = decode_ticket(settings, controller_ticket)
    assert claims["sid"] == session["sessionId"]
    assert claims["role"] == "controller"
    assert claims["player"] == 0

    replacement = "A" if controller_ticket[-1] != "A" else "B"
    with pytest.raises(HTTPException):
        decode_ticket(settings, controller_ticket[:-1] + replacement)

    qr = client.get(f"/room/{session['sessionId']}/qr/0?view=stream")
    assert qr.status_code == 200
    assert qr.headers["content-type"] == "image/png"
    assert qr.headers["cache-control"] == "no-store"
    assert qr.content.startswith(b"\x89PNG")


def test_handshake_protocol_origin_device_and_duplicate_host(service: tuple[TestClient, Settings]) -> None:
    client, _settings = service
    session = create_session(client)

    assert_ws_denied(
        client.websocket_connect(
            "/ws",
            subprotocols=[PROTOCOL, "ticket." + session["hostTicket"]],
            headers={"origin": "https://attacker.example"},
        ),
        4403,
    )
    assert_ws_denied(
        client.websocket_connect(
            "/ws",
            subprotocols=["ticket." + session["hostTicket"]],
            headers={"origin": ORIGIN},
        ),
        4401,
    )
    controller_ticket = ticket_from_join_url(session["joinUrls"][0])
    assert_ws_denied(
        client.websocket_connect(
            "/ws",
            subprotocols=[PROTOCOL, "ticket." + controller_ticket],
            headers={"origin": ORIGIN},
        ),
        4401,
    )

    with host_ws(client, session) as first_host:
        assert first_host.accepted_subprotocol == PROTOCOL
        receive_type(first_host, "server_info")
        assert_ws_denied(host_ws(client, session), 4409)
        first_host.send_json({"type": "host_hello"})
        receive_type(first_host, "server_info")

    # The same host ticket may reconnect only after the previous socket released.
    with host_ws(client, session) as reconnected:
        assert receive_type(reconnected, "server_info")["sessionId"] == session["sessionId"]


def test_open_websocket_closes_when_session_ttl_expires(service: tuple[TestClient, Settings]) -> None:
    client, _settings = service
    session = create_session(client)

    with host_ws(client, session) as host:
        receive_type(host, "server_info")
        live_session = client.app.state.registry.sessions[session["sessionId"]]
        live_session.expires_at = time.time() + 0.05
        # Wake the current receive, then the next wait is bounded by the TTL.
        host.send_json({"type": "pong"})
        closed = host.receive()
        assert closed["type"] == "websocket.close"
        assert closed["code"] == 4000


def test_atomic_input_sequence_neutralizes_once_and_hides_other_tickets(
    service: tuple[TestClient, Settings],
) -> None:
    client, _settings = service
    session = create_session(client)

    with host_ws(client, session) as host:
        receive_type(host, "server_info")
        with controller_ws(client, session, player=0) as controller:
            controller_info = receive_type(controller, "server_info")
            assert controller_info["player"] == 0
            assert "joinUrls" not in controller_info
            assert "streamUrls" not in controller_info
            receive_type(host, "controller_joined")

            actions = all_actions(left=True, light=True)
            controller.send_json(
                {"type": "input_state", "player": 3, "actions": actions, "seq": 7}
            )
            forwarded = receive_type(host, "controller_input_state")
            assert forwarded == {
                "type": "controller_input_state",
                "player": 0,
                "actions": actions,
                "seq": 7,
            }

            controller.send_json({"type": "input_state", "actions": all_actions(right=True), "seq": 7})
            assert receive_type(controller, "input_rejected")["reason"] == "sequence"

            malformed = all_actions(up=True)
            malformed.pop("flight")
            controller.send_json({"type": "input_state", "actions": malformed, "seq": 8})
            assert receive_type(controller, "input_rejected")["reason"] == "schema"

        neutral = receive_type(host, "controller_input_state")
        assert neutral["player"] == 0
        assert neutral["neutral"] is True
        assert neutral["reason"] == "disconnect"
        assert neutral["actions"] == all_actions()
        receive_type(host, "controller_left")

        # Force a deterministic response and fail if release emitted either event twice.
        host.send_json({"type": "host_hello"})
        receive_type(
            host,
            "server_info",
            forbidden={"controller_input_state", "controller_left"},
        )


def test_device_binding_allows_same_device_replacement_and_rejects_other(
    service: tuple[TestClient, Settings],
) -> None:
    client, _settings = service
    session = create_session(client)

    with host_ws(client, session) as host:
        receive_type(host, "server_info")
        with controller_ws(client, session, device=DEVICE_A) as first:
            receive_type(first, "server_info")
            receive_type(host, "controller_joined")

            assert_ws_denied(controller_ws(client, session, device=DEVICE_B), 4409)
            first.send_json({"type": "input_state", "actions": all_actions(up=True), "seq": 1})
            assert receive_type(host, "controller_input_state")["actions"]["up"] is True

            with controller_ws(client, session, device=DEVICE_A) as replacement:
                receive_type(replacement, "server_info")
                receive_type(first, "slot_replaced")
                with pytest.raises(WebSocketDisconnect) as closed:
                    first.receive_json()
                assert closed.value.code == 4009
                replacement.send_json(
                    {"type": "input_state", "actions": all_actions(right=True), "seq": 0}
                )
                forwarded = receive_type(host, "controller_input_state")
                assert forwarded["player"] == 0
                assert forwarded["actions"]["right"] is True

            receive_type(host, "controller_input_state")
            receive_type(host, "controller_left")

        # Device binding survives a transient disconnect.
        assert_ws_denied(controller_ws(client, session, device=DEVICE_B), 4409)
        with controller_ws(client, session, device=DEVICE_A) as reconnected:
            assert receive_type(reconnected, "server_info")["player"] == 0


def test_rtc_routing_validation_and_two_room_isolation(service: tuple[TestClient, Settings]) -> None:
    client, _settings = service
    session_a = create_session(client, title="Room A")
    session_b = create_session(client, title="Room B")

    with host_ws(client, session_a) as host_a, host_ws(client, session_b) as host_b:
        receive_type(host_a, "server_info")
        receive_type(host_b, "server_info")
        with controller_ws(client, session_a, device=DEVICE_A) as controller_a, controller_ws(
            client, session_b, device=DEVICE_B
        ) as controller_b:
            receive_type(controller_a, "server_info")
            receive_type(controller_b, "server_info")
            receive_type(host_a, "controller_joined")
            receive_type(host_b, "controller_joined")

            host_a.send_json(
                {
                    "type": "webrtc_offer",
                    "player": 0,
                    "negotiationId": "offer-room-a",
                    "sdp": "v=0\r\no=host-a",
                }
            )
            offer = receive_type(controller_a, "webrtc_offer")
            assert offer["player"] == 0
            assert offer["negotiationId"] == "offer-room-a"

            controller_a.send_json(
                {
                    "type": "webrtc_answer",
                    "player": 3,
                    "negotiationId": "offer-room-a",
                    "sdp": "v=0\r\no=controller-a",
                }
            )
            answer = receive_type(host_a, "webrtc_answer")
            assert answer["player"] == 0

            controller_a.send_json(
                {
                    "type": "webrtc_ice",
                    "player": 2,
                    "negotiationId": "offer-room-a",
                    "candidate": {
                        "candidate": "candidate:1 1 udp 1 192.0.2.1 5000 typ host",
                        "sdpMid": "0",
                        "sdpMLineIndex": 0,
                        "ignored": "not forwarded",
                    },
                }
            )
            ice = receive_type(host_a, "webrtc_ice")
            assert ice["player"] == 0
            assert "ignored" not in ice["candidate"]

            host_a.send_json(
                {
                    "type": "webrtc_stop",
                    "player": 0,
                    "negotiationId": "offer-room-a",
                }
            )
            assert receive_type(controller_a, "webrtc_stop")["player"] == 0

            host_a.send_json(
                {
                    "type": "webrtc_offer",
                    "player": 0,
                    "negotiationId": "",
                    "sdp": "v=0",
                }
            )
            assert receive_type(host_a, "message_rejected")["reason"] == "webrtc_schema"

            # Room B responds to its own request before any forbidden Room A event.
            host_b.send_json({"type": "host_hello"})
            receive_type(
                host_b,
                "server_info",
                forbidden={"webrtc_answer", "webrtc_ice", "controller_input_state"},
            )
            controller_b.send_json(
                {"type": "input_state", "actions": all_actions(down=True), "seq": 1}
            )
            room_b_input = receive_type(host_b, "controller_input_state")
            assert room_b_input["player"] == 0
            assert room_b_input["actions"]["down"] is True
