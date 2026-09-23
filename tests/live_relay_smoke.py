from __future__ import annotations

import asyncio
import json
import sys
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx
import websockets


ACTIONS = ("up", "down", "left", "right", "light", "heavy", "shield", "special", "flight")


async def receive_type(socket: Any, wanted: str, limit: int = 16) -> dict[str, Any]:
    seen: list[str] = []
    for _ in range(limit):
        raw = await asyncio.wait_for(socket.recv(), timeout=3)
        payload = json.loads(raw)
        seen.append(str(payload.get("type")))
        if payload.get("type") == wanted:
            return payload
    raise AssertionError(f"No se recibio {wanted!r}; vistos={seen}")


async def main(base_url: str) -> None:
    base_url = base_url.rstrip("/")
    ws_url = ("wss://" if base_url.startswith("https://") else "ws://") + urlsplit(base_url).netloc + "/ws"
    async with httpx.AsyncClient(base_url=base_url, timeout=5) as client:
        health = (await client.get("/health")).json()
        assert health["status"] == "ok"

        response = await client.post(
            "/api/sessions",
            json={"title": "Live relay smoke", "mode": "mixed", "ttl_minutes": 5, "max_players": 4},
        )
        response.raise_for_status()
        session = response.json()
        stream_fragment = parse_qs(urlsplit(session["streamUrls"][0]).fragment)
        state_fragment = parse_qs(urlsplit(session["joinUrls"][1]).fragment)
        stream_ticket = stream_fragment["ticket"][0]
        state_ticket = state_fragment["ticket"][0]

        host_protocols = ["mecha.v1", "ticket." + session["hostTicket"]]
        stream_protocols = [
            "mecha.v1",
            "ticket." + stream_ticket,
            "device.live_smoke_stream_device_0123456789",
        ]
        state_protocols = [
            "mecha.v1",
            "ticket." + state_ticket,
            "device.live_smoke_state_device_0123456789",
        ]
        async with websockets.connect(ws_url, subprotocols=host_protocols, origin=base_url) as host:
            assert host.subprotocol == "mecha.v1"
            await receive_type(host, "server_info")
            async with websockets.connect(ws_url, subprotocols=stream_protocols, origin=base_url) as stream_controller:
                assert stream_controller.subprotocol == "mecha.v1"
                stream_info = await receive_type(stream_controller, "server_info")
                assert stream_info["player"] == 0
                await receive_type(host, "controller_joined")

                async with websockets.connect(ws_url, subprotocols=state_protocols, origin=base_url) as state_controller:
                    assert state_controller.subprotocol == "mecha.v1"
                    state_info = await receive_type(state_controller, "server_info")
                    assert state_info["player"] == 1
                    await receive_type(host, "controller_joined")

                    await stream_controller.send(json.dumps({"type": "controller_hello", "viewMode": "stream"}))
                    await state_controller.send(json.dumps({"type": "controller_hello", "viewMode": "controller"}))
                    stream_view = await receive_type(host, "controller_view")
                    state_view = await receive_type(host, "controller_view")
                    assert stream_view == {"type": "controller_view", "player": 0, "viewMode": "stream"}
                    assert state_view == {"type": "controller_view", "player": 1, "viewMode": "controller"}

                    stream_actions = {action: action in {"left", "light"} for action in ACTIONS}
                    state_actions = {action: action == "right" for action in ACTIONS}
                    await stream_controller.send(
                        json.dumps({"type": "input_state", "actions": stream_actions, "seq": 1})
                    )
                    await state_controller.send(
                        json.dumps({"type": "input_state", "actions": state_actions, "seq": 1})
                    )
                    stream_forwarded = await receive_type(host, "controller_input_state")
                    state_forwarded = await receive_type(host, "controller_input_state")
                    assert stream_forwarded["player"] == 0 and stream_forwarded["actions"] == stream_actions
                    assert state_forwarded["player"] == 1 and state_forwarded["actions"] == state_actions

                    snapshot = {"type": "snapshot", "snapshot": {"state": "title", "players": [], "roster": []}}
                    await host.send(json.dumps(snapshot))
                    assert await receive_type(stream_controller, "snapshot") == snapshot
                    assert await receive_type(state_controller, "snapshot") == snapshot

                    offer = {
                        "type": "webrtc_offer",
                        "player": 0,
                        "negotiationId": "live-smoke-negotiation",
                        "sdp": "v=0\r\no=live-host",
                    }
                    await host.send(json.dumps(offer))
                    relayed_offer = await receive_type(stream_controller, "webrtc_offer")
                    assert relayed_offer["sdp"] == offer["sdp"]
                    await stream_controller.send(
                        json.dumps(
                            {
                                "type": "webrtc_answer",
                                "negotiationId": offer["negotiationId"],
                                "sdp": "v=0\r\no=live-controller",
                            }
                        )
                    )
                    answer = await receive_type(host, "webrtc_answer")
                    assert answer["player"] == 0 and answer["negotiationId"] == offer["negotiationId"]

                state_neutral = await receive_type(host, "controller_input_state")
                assert state_neutral["player"] == 1 and state_neutral["neutral"] is True
                await receive_type(host, "controller_left")

            neutral = await receive_type(host, "controller_input_state")
            assert neutral["player"] == 0 and neutral["neutral"] is True and not any(neutral["actions"].values())
            await receive_type(host, "controller_left")

        closed = await client.delete(
            f"/api/sessions/{session['sessionId']}",
            headers={"Authorization": "Bearer " + session["hostTicket"]},
        )
        assert closed.status_code == 204

    print("Live relay smoke: PASS")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18787"))
