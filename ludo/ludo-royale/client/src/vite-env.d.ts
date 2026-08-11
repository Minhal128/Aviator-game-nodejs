/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** WebSocket endpoint of the game server (net/config.ts picks defaults). */
  readonly VITE_GAME_WS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
