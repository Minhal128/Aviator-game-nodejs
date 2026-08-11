# Ludo Royale

Real-time multiplayer Ludo — Quick Match, Private Rooms, vs CPU (3 difficulties)
and local Pasa y Juega, with an optional **POWER Mode**: four collectible
board power-ups plus four gold-bought battle powers (capped at 2 uses each
per match). Server-authoritative (dice + move validation happen on the
server, never the client), with 249 automated tests covering the rules
engine and the API.

**Full documentation (requirements, local Quick Start, production VPS
deploy with nginx, POWER Mode reference, economy tuning, branding/i18n and
troubleshooting) lives in the sibling `Documentation/` folder — start at
`Documentation/index.html`.**

## Structure

```
ludo-royale/
├── shared/   @ludo/shared   — pure TypeScript Ludo rules engine + AI (no Phaser, no network)
├── client/   @ludo/client   — Phaser 4 game client (web, PWA-installable)
└── server/   @ludo/server   — Colyseus game server + REST API (two processes, one codebase)
```

The `shared` package is the single source of truth for the game rules. Both
the offline client driver (vs CPU / Pasa y Juega) and the authoritative
Colyseus server execute the exact same compiled reducer (`applyAction`) —
zero rule divergence between offline and online play, covered by 133 of the
project's 249 tests.

## Fastest path to a running game

```bash
npm install
npm run build:shared
# configure server/.env and client/.env — see Documentation/quick-start.html
npm run db:migrate --workspace @ludo/server
npm run db:seed --workspace @ludo/server
npm run dev --workspace @ludo/server        # terminal 1 — ludo-game (Colyseus)
npm run api:dev --workspace @ludo/server    # terminal 2 — ludo-api (REST)
npm run dev --workspace @ludo/client        # terminal 3 — http://localhost:5173
```

See `Documentation/quick-start.html` for the full walkthrough (database
setup, environment variables, generating a `JWT_SECRET`) and
`Documentation/production-deploy.html` for shipping it to a VPS with nginx
and PM2/systemd.

## Run the test suite

```bash
npm test          # @ludo/shared (133 tests) + @ludo/server (116 tests)
```

The database-backed server tests need a separate `DATABASE_URL_TEST`
database (they truncate `lr_*` tables between cases) — see
`Documentation/troubleshooting.html`.
