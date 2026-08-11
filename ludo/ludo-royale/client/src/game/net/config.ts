/**
 * Game-server endpoint resolution. Overridable per deployment with
 * VITE_GAME_WS (client/.env). Defaults:
 *  - dev: `npm run dev -w @ludo/server` on localhost.
 *  - prod build without VITE_GAME_WS set: same-origin WSS — the domain the
 *    client itself was served from. This matches the documented nginx setup
 *    (Documentation > Production Deploy) where one domain reverse-proxies
 *    both the static client and the /colyseus WebSocket upgrade, so it
 *    works out of the box for any buyer domain with zero config. Set
 *    VITE_GAME_WS explicitly only if the game server lives on a different
 *    host/port than the client.
 */

const DEV_ENDPOINT = 'ws://localhost:8107';

function sameOriginEndpoint(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}`;
}

export function gameServerUrl(): string {
  const fromEnv = import.meta.env.VITE_GAME_WS;
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  return import.meta.env.DEV ? DEV_ENDPOINT : sameOriginEndpoint();
}
