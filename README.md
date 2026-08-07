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

## Deploy — Render (card-free, recommended) or Fly.io free tier

> **2026 note:** Fly.io now requires a credit-card verification hold on new
> accounts, which some Nigerian bank cards can't pass. **Render's free web
> service needs NO credit card**, supports Socket.IO/WebSockets, and deploys
> straight from your GitHub repo. If your card clears Fly's check, either works.

**Why not serverless:** a live quiz needs a persistent WebSocket, so
Vercel/Netlify are ruled out. Both Render and Fly run an always-on container with
WebSockets out of the box. We stress-proved peak RSS ~96MB at 500 players, so a
small single instance is plenty.

---

### Option A — Render (no credit card) — RECOMMENDED if you can't verify a card

Included: `render.yaml` (the auto-deploy blueprint) + a self-healing `RENDER`
mode (`config.js` uses a tmp DB, and `engine.seedQuizzesIfEmpty()` repopulates a
starter quiz on every boot, so the app always works even without a persistent disk).

```bash
# 1. Push this repo to your GitHub (done: https://github.com/Osas000/oscar-arena)
# 2. In Render: New > Blueprint, select that repo. It reads render.yaml and
#    creates the oscar-arena web service (Docker) automatically.
# 3. In the service's Environment, set ADMIN_PIN to your 4-8 digit PIN.
#    (The blueprint declares it as `sync: false` so you control the value.)
# 4. Deploy. You get a public URL: https://oscar-arena.onrender.com
```

**Render free caveats (we've engineered around them):**
- **No persistent disk** → SQLite resets each wake. Mitigated: quizzes are
  seeded-on-empty from `server/src/seed-quizzes.json`, and the admin PIN comes
  from the `ADMIN_PIN` env var (never the DB). Player/answer records are
  per-session anyway.
- **Idle spin-down** after ~15 min → wakes on first player connect (~1 min
  delay once). Fine for an event; for a 24/7 smooth experience use Render
  Starter ($7/mo) which never spins down and has a persistent disk.

---

### Option B — Fly.io free tier (if you can pass card verification)

All app-side prerequisites are built (Dockerfile, fly.toml, health checks):

```bash
flyctl auth login            # opens browser
flyctl launch --no-deploy    # creates app + volume
flyctl secrets set ADMIN_PIN=<your-secret>
flyctl deploy                # -> https://oscar-arena.fly.dev
```

`auto_stop_machines = false` keeps the WebSocket process awake; the `arena_data`
volume persists `/app/server/data` (the DB) across restarts — so on Fly the DB
and changed PIN survive, which is nicer than Render free.

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