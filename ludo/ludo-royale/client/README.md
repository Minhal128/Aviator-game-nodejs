# @ludo/client

Phaser 4 game client for Ludo Royale. Sprint 1b scope: fully playable Ludo in
the browser — vs CPU (3 AI levels) and local pass & play (2–4 players) — with
the procedural board and the six juice effects from the STYLE-GUIDE. Online
play (Colyseus) and the DOM meta-game arrive in later sprints; the scene
already talks to the engine through the `GameDriver` contract, so swapping in
`ColyseusClient` requires no scene changes.

## Run

From the monorepo root (Node 22+):

```bash
npm install
npm run dev --workspace @ludo/client       # http://localhost:5173
```

## Build

```bash
npm run build --workspace @ludo/client     # typecheck + vite build → client/dist
npm run preview --workspace @ludo/client   # serve the production build locally
```

`@ludo/shared` is consumed straight from its TypeScript source via a Vite
alias — no separate engine build step is needed.

## Notes

- All textures (board, pawns, dice frames, particles) are generated
  procedurally at boot; there are zero binary assets in this sprint.
- Colors, durations and easings live in `src/theme/tokens.ts` (STYLE-GUIDE
  §2/§5). Scenes never hardcode a hex or a duration.
- `prefers-reduced-motion` is honored globally: tweens collapse to short
  fades, shake/confetti/loops are disabled, information (timer ring, values)
  is preserved.
- UI strings live in `src/i18n/` (EN default, ES included).
