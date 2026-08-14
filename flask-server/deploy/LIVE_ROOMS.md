# BodyMaps Live Rooms deployment

Live Rooms use existing Flask service for creation, snapshots, and exports, plus separate async WebSocket process on `127.0.0.1:8001`. Room files live under `${SESSIONS_DIR_PATH}/live_rooms` and expire after 24 hours.

## Install and verify

```bash
cd /home/visitor/PanTS-Viewer/flask-server
./.venv/bin/pip install -r requirements.txt
./.venv/bin/python -m pytest tests/unit/test_live_room_store.py
./.venv/bin/python -m py_compile live_rooms_ws.py services/live_room_store.py api/live_rooms.py
```

`PANTS_PATH` and `SESSIONS_DIR_PATH` come from existing `flask-server/.env`. WebSocket service loads same file. Service user needs read access to dataset tree and write access to session directory.

## Enable services

```bash
sudo cp deploy/systemd/bodymaps-live-rooms.service /etc/systemd/system/
sudo cp deploy/systemd/bodymaps-live-rooms-cleanup.service /etc/systemd/system/
sudo cp deploy/systemd/bodymaps-live-rooms-cleanup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bodymaps-live-rooms.service bodymaps-live-rooms-cleanup.timer
curl -fsS http://127.0.0.1:8001/health
```

Install updated `deploy/nginx-bodymaps.conf`, then validate and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## Development

Run services in separate terminals:

```bash
cd flask-server
python app.py
python live_rooms_ws.py
```

Vite proxies `/api` to Flask and `/ws` to `VITE_WS_BASE` (default `ws://127.0.0.1:8001`).

## Operations

- REST health: `GET /api/live-rooms/health`
- WebSocket health: `GET http://127.0.0.1:8001/health`
- Logs: `journalctl -u bodymaps-live-rooms.service`
- Cleanup logs: `journalctl -u bodymaps-live-rooms-cleanup.service`
- Room key exists only in URL fragment and `X-Room-Key`; never add fragment or key to analytics/logs.
- Room access is bearer-link collaboration, not privacy-grade authorization.
- Canonical `image_only` and `mask_only` stay read-only. Exports materialize under session directory only.
