# Backend

## Live Rooms

Dataset viewer supports temporary, account-free collaborative review at `/live/<room-id>#<room-key>`. Up to eight equal editors can collaborate for 24 hours, then room files expire. Exports include edited labelmap, annotations, notes, chat, event history, and report without changing canonical dataset files.

Deployment and local service instructions: [`flask-server/deploy/LIVE_ROOMS.md`](flask-server/deploy/LIVE_ROOMS.md).

#### Create Conda Environment
```
conda create -n PanTS_backend python=3.11
conda activate PanTS_backend
```

#### Set up environment backend
```
cd flask-server
touch .env  # creates the .env file
nano .env
```

Inside .env file (see `flask-server/.env.example` for the full list):
```
BASE_PATH=/

PANTS_PATH=/folder/where/PanTS

USE_SSL=false
```

Optional dataset vars:
```
# Writable dir for precomputed PanTS low-res volumes (make_lowres.py output)
PANTS_LOWRES_PATH=/home/visitor/pants_lowres

# CancerVerse (second, CT-only dataset). Leave unset to disable it.
CANCERVERSE_PATH=/folder/where/CancerVerse
CANCERVERSE_LOWRES_PATH=/home/visitor/cancerverse_lowres
```
`CANCERVERSE_PATH` holds the `CV_########/ct.nii.gz` cases; the metadata CSV `CancerVerse_dataset_metadata.csv` sits **next to** that folder (in its parent). When set, `/api/search?dataset=cancerverse` (or `dataset=all`) searches it; CancerVerse has no masks yet, so mask endpoints return `{"masks_available": false}`.

#### Build the search/shuffle quality index

Search and shuffle can rank cases by CT file size and thumbnail display quality without
adding filesystem or vision-model work to API requests. Generate the index offline on
the host that has the dataset mounted:

```
ollama pull qwen3-vl:4b
python scripts/compute_case_quality.py \
  --out /home/visitor/data/bodymaps_case_quality.v1.json \
  --datasets all \
  --vision required \
  --overwrite
```

Then set the same path in `flask-server/.env` before starting the backend:

```
BODYMAPS_CASE_QUALITY_MANIFEST=/home/visitor/data/bodymaps_case_quality.v1.json
BODYMAPS_THUMBNAIL_VISION_MODEL=qwen3-vl:4b
```

Use `--resume` instead of `--overwrite` to reuse unchanged CT and thumbnail records.
`--vision required` fails rather than silently producing an index without vision
classification. If the manifest is unset or unavailable, ranking falls back to scan
shape and voxel-spacing metadata.

Run backend:

```
pip install -r requirements.txt
python app.py
```

# Frontend

```
cd PanTS-Demo
touch .env
nano .env
```

Inside .env:
```
VITE_API_BASE=http://localhost:5001
```

#### Run frontend

```
npm install
npm run dev
```

# Roles, and the usage dashboard

Two roles live in the `user_role` table, granted from **Settings → People** by
anyone who already holds `admin`:

- **admin** — sees Settings → Usage, and can grant or revoke roles.
- **annotator** — reserved for editing and creating segmentation masks. It can
  be granted today, but **nothing reads it yet**; it gates no behaviour.

Two guards exist so this can't strand itself: you cannot remove your own admin,
and you cannot remove the last one.

#### The first admin

Nobody can grant a role until someone is an admin, so bootstrap it with either:

```
ADMIN_EMAILS=you@example.com,them@example.com
```

Those addresses are granted `admin` at startup (additive — it never revokes; an
address with no account yet is picked up on the next boot after they sign up).
Or do it without a restart:

```bash
python flask-server/scripts/grant_role.py --email you@example.com --role admin
```

`--revoke` takes a role away, and `--list` shows everyone who holds one.

#### Usage

**Settings → Usage** shows which features get used and which don't, how long
people spend on each page, and how that splits by plan and account type — over a
date range or all time.

It needs **two** things, not one: the backend started with
`ANALYTICS_DASHBOARD=true` (off by default, so a normal deploy doesn't serve
per-account behaviour at all), *and* an admin session. With the flag off the
endpoints 404 for everyone, admin included.

The main site records the events either way — that half is always on.

# Deploying Updates to the Server
---

After pushing changes, SSH into the server and run the following.

```
ssh visitor@bdmap1.wse.jhu.edu
```

#### 1. Back up the database
Accounts, sessions and job state live in SQLite, so take a copy before any deploy that might run migrations.
```
cd /home/visitor/PanTS-Viewer/flask-server && cp *.db ~/db-backup-$(date +%F-%H%M).db 2>/dev/null && echo "backed up" || echo "no db found"
```

#### 2. Pull latest changes
Production must always deploy from `main`. Confirm the branch first, then pull.
```
cd /home/visitor/PanTS-Viewer
git fetch
git checkout main
git pull
```
If `git pull` (or the checkout) refuses because of "local changes would be overwritten," someone edited files directly on the server. Do **not** force past it. Run `git status` to see what changed, then discard each file with `git checkout -- <file>` (or ask the maintainer) before pulling again. The server should never carry local edits.

#### 3. Rebuild the frontend and refresh backend dependencies
```
cd /home/visitor/PanTS-Viewer/PanTS-Demo && npm ci && npm run build
/home/visitor/.conda/envs/PanTS_backend/bin/pip install -r /home/visitor/PanTS-Viewer/flask-server/requirements.txt
```
The `pip install` is a fast no-op when nothing changed, but it is required whenever a PR adds or bumps a Python dependency — otherwise the restarted backend crashes on a missing import and the site goes empty. If `npm run build` errors out, **stop here**: nginx keeps serving the old site until a build succeeds, so fix the error before restarting the backend.

#### 4. Apply database migrations
Required whenever a PR adds an Alembic revision; a fast no-op otherwise. Skipping it after a schema change leaves the backend querying tables that do not exist.
```
cd /home/visitor/PanTS-Viewer/flask-server && /home/visitor/.conda/envs/PanTS_backend/bin/alembic upgrade head
```

#### 5. Restart the backend
```
# Stop the old gunicorn process and wait for the port to free
pkill -f "gunicorn.*app:app"; sleep 2
pgrep -f "gunicorn.*app:app" && echo "still running - rerun the line above" || echo "port clear"

# Start a new gunicorn process
nohup /home/visitor/.conda/envs/PanTS_backend/bin/gunicorn \
  --worker-class gthread --workers 1 --threads 8 \
  --bind 127.0.0.1:8000 --timeout 3600 \
  --chdir /home/visitor/PanTS-Viewer/flask-server \
  app:app > /tmp/gunicorn.log 2>&1 &
echo "PID: $!"
```

#### 6. Verify the backend is running
Give it a few seconds to load, then check the backend booted, the dataset loads, and masks serve (all three must succeed).
```
sleep 8
curl http://127.0.0.1:8000/api/ping
curl -s "http://127.0.0.1:8000/api/search?limit=1" | head -c 120; echo
curl -s -o /dev/null -w "segmentations: %{http_code}\n" "http://127.0.0.1:8000/api/get-segmentations/17.nii.gz"
```
Expect `{"message":"pong"}`, a JSON object with `items`, and `segmentations: 200`. If the backend fails to boot, check the log for the traceback.

Then check sign-in is wired up.
```
curl -s http://127.0.0.1:8000/api/auth/oauth/providers
curl -sS -i https://bodymaps.wse.jhu.edu/api/auth/oauth/google | grep -i "^location:" | tr '&' '\n' | grep redirect_uri
```
Expect `{"github":true,"google":true}`, then a `redirect_uri` beginning `https%3A%2F%2Fbodymaps.wse.jhu.edu`. A `http://` scheme there means `PUBLIC_BASE_URL` is unset or stale, and every sign-in fails `redirect_uri_mismatch` — the provider matches that string exactly. Note `providers` only reports whether credentials are non-empty, so it still returns `true` for rotated-but-not-updated secrets; those surface as `invalid_client` at sign-in.

Finally, load `https://bodymaps.wse.jhu.edu/upload` in a browser and confirm a signed-out visitor can still start a run.

Logs are written to `/tmp/gunicorn.log`.
