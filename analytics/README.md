# BodyMaps usage dashboard

Internal, local-only view of how the main site is actually used: which features
get opened, how long people spend on each part of the app, and how that differs
by plan and by account type.

## This must not be deployed

It reads per-account behaviour and it has **no login of its own**. The endpoints
it depends on are refused by the API unless `ANALYTICS_DASHBOARD=true`, which is
off by default, so a normal deploy of `flask-server` does not serve them at all.
There is deliberately no Vercel config, no Dockerfile, and no build step wired
into CI for this app.

If it ever does need to be reachable by more than one person, it needs an
authenticated admin role in front of it first — the flag is a guard against
accidents, not an access control system.

## Running it

Two terminals, from the repo root:

```bash
ANALYTICS_DASHBOARD=true PERMISSIONS_DIR=./permissions flask-server/.venv/bin/python flask-server/app.py
```

```bash
cd analytics && npm install && npm run dev
```

Then open http://localhost:5174. The API is expected on
http://localhost:5001; override with `VITE_API_BASE` if yours differs.

The main site must be running too (on 5173) if you want to generate events to
look at — the dashboard only reads what the app has recorded.

## Where the data comes from

- `PanTS-Demo/src/helpers/analytics.ts` — what the main site records, and the
  list of event names it is allowed to send.
- `flask-server/services/analytics_store.py` — what the server stores, and every
  aggregate this dashboard displays.
- `flask-server/api/analytics_blueprint.py` — the endpoints, and the env gate.

Event names and route patterns are checked against a fixed list on both sides,
so a case id or a filename can never end up in the analytics table. Plan and
account type are stamped by the server from the account, never sent by the
browser.

## Styling

This app imports `PanTS-Demo/src/routes/Settings/Settings.css` and uses the main
site's own `set-*` classes for its panels, rows and controls, so it inherits the
site's look rather than keeping a second copy of it that drifts. Only the pieces
the main site has no equivalent for — the bars, the trend line, the stat tiles —
are defined locally, in `src/dashboard.css`.
