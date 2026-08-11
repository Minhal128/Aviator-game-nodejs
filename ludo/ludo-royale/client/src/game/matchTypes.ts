import type {
  AiLevel,
  GameDriver,
  GameState,
  PlayerColor,
  PlayerStatusMessage,
  PowerType,
  Seat,
} from '@ludo/shared';

/** Modes served by the local engine (Sprint 1b). */
export type OfflineMode = 'cpu' | 'local';
export type MatchMode = OfflineMode | 'online';

export type ConnectionStatus = 'connected' | 'reconnecting' | 'lost';

/**
 * What GameBoardScene needs beyond the GameDriver protocol callbacks:
 * a state snapshot for construction/resync, seat ownership, timers and
 * lifecycle. OfflineDriver satisfies it structurally; ColyseusClient adds
 * the optional online-only members (names, resync, connection status).
 */
export interface SceneDriver extends GameDriver {
  snapshot(): GameState;
  /** "Human" = controllable from THIS device (own seat when online). */
  isHumanSeat(seat: Seat): boolean;
  readonly turnTimerS: number;
  start(): void;
  destroy(): void;
  /** Online: display name per seat (offline derives names locally). */
  seatName?(seat: Seat): string;
  /** Online: current connected/auto flags per seat (schema truth) so a
   *  resume/resync can paint presence badges without waiting for the next
   *  playerStatus broadcast. */
  seatStatuses?(): PlayerStatusMessage[];
  /** Fired when the board must snap to snapshot() truth (forfeits, re-sync). */
  onResync?: () => void;
  onConnectionStatus?: (status: ConnectionStatus) => void;
}

/** Scene-to-scene payload: Home/Waiting → Game → Results ("Play Again"). */
export interface MatchInit {
  mode: MatchMode;
  numPlayers: 2 | 3 | 4;
  aiLevel: AiLevel;
  /** POWER mode (token drops + powers). Online rooms carry it in the schema. */
  powerMode?: boolean;
  /** Offline vs CPU: board color the human picked for seat 0. */
  seatZeroColor?: PlayerColor;
  /**
   * Offline vs CPU POWER: the human's owned power quantities (shop model).
   * Fetched by HomeScene before the scene starts; seeds seat 0's charges.
   */
  humanLoadout?: Readonly<Partial<Record<PowerType, number>>>;
  /** Online only — the connected ColyseusClient handed over by WaitingScene. */
  driver?: SceneDriver;
  /** Online only — private-room code for the HUD label. */
  roomCode?: string;
}

export interface SeatInfo {
  seat: Seat;
  color: PlayerColor;
  name: string;
  human: boolean;
}

export interface ResultsData {
  init: MatchInit;
  rows: { seat: Seat; place: number; color: PlayerColor; name: string }[];
  humanWon: boolean;
  /** Local device's seat (null in pass&play) — Results paints its avatar. */
  humanSeat?: Seat | null;
}
