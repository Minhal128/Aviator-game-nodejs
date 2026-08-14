/**
 * Game-server endpoint resolution. Overridable per deployment with
 * VITE_GAME_WS (client/.env). Defaults:
 *  - localhost / 127.0.0.1: Colyseus on :8107 (Laravel has no WS proxy)
 *  - other prod hosts: same-origin WSS (nginx /colyseus)
 *  - Vite DEV: ws://localhost:8107
 */

const DEV_ENDPOINT = 'ws://localhost:8107';

function sameOriginEndpoint(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}`;
}

/** Local Laravel (`:8000`) cannot upgrade WebSockets — hit ludo-game directly. */
function localGameEndpoint(): string | null {
  const host = window.location.hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') return null;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${host}:8107`;
}

export function gameServerUrl(): string {
  const fromEnv = import.meta.env.VITE_GAME_WS;
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  if (import.meta.env.DEV) return DEV_ENDPOINT;
  return localGameEndpoint() ?? sameOriginEndpoint();
}
