# OSCAR ARENA — Royal Rangers Live Quiz Platform

A server-authoritative, Kahoot-class live quiz platform for the Royal Rangers
unit. Host creates/runs a quiz on a big projector screen; every player answers
from their phone by entering a 6-digit PIN. Built for up to **500+ concurrent
players** on **one** small process, resilient over poor Nigerian mobile data.

**Brand:** actual Royal Rangers compass logo · navy/gold · tagline *"Who will
rule the arena?"*

---

## Quick start (local dev)

```bash
npm install
npm run dev        # server on :8080 + client on :5173 (Vite HMR)
```

- Player: open the client URL, tap **PLAY**, enter the PIN shown on the host
  screen.
- Host: tap **HOST A QUIZ**, enter the admin PIN (`ADMIN_PIN`, default
  `000000`), build a quiz, then **Host it** → share the PIN / screen.

### Production build + run from one process
```bash
npm run build          # Vite build -> client/dist
npm run start          # server serves the built client + Socket.IO on :8080
```

---

## Layout

```
quiz-arena/
  server/      Node + Socket.IO + better-sqlite3 (server-authoritative engine)
  client/      React 18 + Vite + Tailwind + Framer Motion (host + player UIs)
  stress/      load harness  (node stress/load.js --players 500)
  deploy/      systemd unit (Oracle free-tier fallback)
  Dockerfile   production image (Fly.io / any host)
  fly.toml     Fly.io config
```

## Architecture & scale guarantees

- **Server-authoritative.** The server owns every clock, deadline, score and
  phase; clients are thin renderers. Phone clocks can't cheat, and dropped
  connections can't desync state — reconnect re-attaches the socket to the
  same identity + score.
- **Resilient transport.** Socket.IO auto-reconnects and falls back to HTTP
  long-polling when a proxy/ven drops a long-lived WebSocket.
- **Stress-proven.** `stress/load.js` opened 500 real players against one
  process: 100% registered (150–270ms join p95), every answer echoed, full game
  cycle to podium, server peak RSS ~96 MB. See build log for the run.

### Run the load test
```bash
bash stress/run.sh --players 500     # boots throwaway server, runs load, reports
# or against an existing server:
OSCAR_URL=http://host:8080 ADMIN_PIN=000000 node stress/load.js --players 500
```

## Deploy — Fly.io free tier (chosen) or Oracle free ARM (fallback)

**Why Fly.io:** a live quiz needs a persistent WebSocket, so serverless
(Vercel/Netlify) is ruled out. Fly runs ONE always-on Linux VM with WebSockets
out of the box, has a genuine free allowance (a single small VM is plenty — we
proved peak RSS ~96MB at 500 players), and deploys with one command.

All app-side prerequisites are already built (Dockerfile, fly.toml, volumes,
health checks). You only need a Fly account + auth, then:

```bash
# 1. One-time: create account at https://fly.io, then
flyctl auth login            # opens browser; sign in (do NOT paste creds in chat)

# 2. One-time: register the app as an ID and create its data volume
flyctl launch --no-deploy    # reads fly.toml, creates app + volume

# 3. One-time: store the admin PIN encrypted (never in git)
flyctl secrets set ADMIN_PIN=<your-secret>

# 4. Push it live
flyctl deploy                # builds the Dockerfile image, boots the VM, serves
# -> https://oscar-arena.fly.dev   (swap ADMIN_PIN placeholder in fly.toml first!)
```

**Things already in place so the deploy succeeds cleanly:** `flyctl launch`
reads `fly.toml` for region, VM size, port 8080, and the `arena_data` volume
mounted at `/app/server/data`. `auto_stop_machines = false` keeps the
WebSocket process awake, and `/healthz` is our Fly health-check endpoint. The
`Dockerfile` already builds the React client + server into one image.

After deploy, verify (QA gate over the PUBLIC url, not localhost):
```bash
curl https://oscar-arena.fly.dev/healthz          # {ok,heap,rss}
curl https://oscar-arena.fly.dev/manifest.webmanifest
curl -o /dev/null -w "%{http_code}\n" https://oscar-arena.fly.dev/icons/icon-192.png
```
Then run a quick player+host smoke against the public URL via the qa runner.

**Region presets in `fly.toml`:**
Open it and set `primary_region` (e.g. `ams` = Amsterdam, nearest to Nigeria;
`fra` Frankfurt). Change memory via `fly machines update` later if you ever
exceed the free allowance — the numbers we observed (96MB RSS) fit the free
instance comfortably.

---

**Fallback — Oracle Cloud Always-Free ARM VM (cheap serverless no).** Truly
$0 forever, always-on, no allowance to run out. More manual than Fly (create
a VM, push the code, run). The same `Dockerfile` drops straight onto any
Docker host; or use the included systemd unit:

```bash
# as root, with the repo at /opt/oscar-arena
useradd -r -m -d /opt/oscar-arena oscar
install -o oscar -g oscar deploy/oscar-arena.service /etc/systemd/system/
mkdir -p /opt/oscar-arena/data && chown oscar:oscar /opt/oscar-arena/data
systemctl daemon-reload && systemctl enable --now oscar-arena
```

**Important in both:** persist the data dir (`/app/server/data` on Fly via the
`arena_data` volume; `/opt/oscar-arena/data` on Oracle) — that's where the
SQLite DB lives. A reboot without it loses nothing critical but drops saved
sessions/answers.

## Configuration (`.env`, never commit `.env`)

| Var | Default | Purpose |
|-----|---------|---------|
| `NODE_ENV` | `development` | dev/prod |
| `PORT` | `8080` | HTTP+WS port |
| `ADMIN_PIN` | `000000` | bootstrap host builder / hosting PIN (default only) |

> **Change the admin PIN after first login** — the default `000000` is meant as a
> bootstrap only. Log in as host, open the dashboard and tap **🔒 Change PIN**,
> enter your current PIN + a new 4–8 digit one. The new PIN is stored in the DB
> (`settings` table) so it survives restarts. The PIN is requested on every host
> login and gates every builder/hosting API (`x-admin-pin` header) plus the
> `host:join` socket — so `/host` cannot be reached without the current PIN.
| `DB_PATH` | `./data/oscar-arena.db` | SQLite file |

## QA / tests

```bash
npm run test:engine     # engine unit tests (timing, scoring, reconnect)
npm run lint            # eslint clean
npm run build           # vite build 0-errors
bash stress/run.sh --players 500   # load gate
```
Every feature is a QA gate: tested in a real running session, not "build is
green." No feature ships from a green build alone.

## Data policy

Stores only nicknames + scores. No real names / emails / PII collected.