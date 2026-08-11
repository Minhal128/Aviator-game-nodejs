/**
 * Client↔server message contracts (ARQUITECTURA §6.5). Implemented by the
 * Colyseus room in Sprint 2 and mirrored by OfflineDriver in Sprint 1b —
 * the GameBoardScene consumes these shapes through GameDriver either way.
 */
import type { PowerType, Seat } from '../types.js';
import type { ErrCode } from './errors.js';

export { PROTOCOL_VERSION } from '../constants.js';

// ---------------------------------------------------------------------------
// Client → Server
// ---------------------------------------------------------------------------

export interface RollMessage {}

export interface MoveMessage {
  pieceId: number;
}

export interface EmoteMessage {
  emoteId: number;
}

export interface ForfeitMessage {}

/** POWER mode: spend a charge on your roll phase. */
export interface UsePowerMessage {
  power: PowerType;
  /** 1..6, pick only. */
  face?: number;
  /** shield/plus/portal: own piece · bolt/freeze: the enemy piece. */
  pieceId?: number;
  /** bolt/freeze: owner of the targeted enemy piece. */
  targetSeat?: Seat;
  /** bomb: absolute ring cell to trap. */
  cell?: number;
}

/** PrivateRoom host only, with 2+ players seated. */
export interface StartMatchMessage {}

/** PrivateRoom host only, LOBBY only. */
export interface KickPlayerMessage {
  seat: Seat;
}

export interface ClientMessages {
  roll: RollMessage;
  move: MoveMessage;
  emote: EmoteMessage;
  forfeit: ForfeitMessage;
  startMatch: StartMatchMessage;
  kickPlayer: KickPlayerMessage;
  usePower: UsePowerMessage;
}

export type ClientMessageType = keyof ClientMessages;

// ---------------------------------------------------------------------------
// Server → Client
// ---------------------------------------------------------------------------

export interface DiceMessage {
  seat: Seat;
  value: number;
  /** Pieces the roller may move — the client highlights them. */
  legalPieceIds: number[];
  extraTurn: boolean;
  /** POWER double roll: both dice (value is their sum). */
  parts?: [number, number];
  /** POWER pick: the face was chosen, not rolled. */
  picked?: boolean;
}

/** POWER: a token dropped on an absolute ring cell. */
export interface TokenSpawnedMessage {
  cell: number;
  power: PowerType;
}

/** POWER: the mover landed on a token and gained a charge. */
export interface TokenCollectedMessage {
  seat: Seat;
  cell: number;
  power: PowerType;
  /** New charge count of that power for the seat. */
  charges: number;
}

/** POWER: a charge was spent. */
export interface PowerUsedMessage {
  seat: Seat;
  power: PowerType;
  face?: number;
  pieceId?: number;
  /** bolt/freeze: owner of the targeted enemy piece. */
  targetSeat?: Seat;
  /** bomb: the trapped absolute ring cell. */
  cell?: number;
}

/** POWER: an armed bomb went off under `victimSeat`'s piece. */
export interface TrapTriggeredMessage {
  /** Seat that planted the bomb. */
  seat: Seat;
  victimSeat: Seat;
  victimPieceId: number;
  cell: number;
  /** True when a shield absorbed the blast (piece survived). */
  blocked: boolean;
}

export interface MoveResultMessage {
  seat: Seat;
  pieceId: number;
  /** Cell-by-cell steps values for the hop animation. */
  path: number[];
  captured?: { seat: Seat; pieceId: number };
  reachedHome: boolean;
  extraTurn: boolean;
  /** Direct jump (portal/bolt): slide, don't hop cell by cell. */
  teleport?: boolean;
}

export interface TurnMessage {
  seat: Seat;
  /** Epoch ms deadline for the pending decision (drives the timer ring). */
  deadline: number;
  phase: 'roll' | 'move';
}

export interface TurnSkippedMessage {
  seat: Seat;
  reason: 'no_moves' | 'timeout' | 'triple_six';
}

export interface PlayerStatusMessage {
  seat: Seat;
  connected: boolean;
  auto: boolean;
}

export interface EmoteShownMessage {
  seat: Seat;
  emoteId: number;
}

export interface MatchEndMessage {
  /**
   * `coinsDelta` is the seat's NET coin change from the match economy:
   * prize − entry fee (Beginner 2P: winner 900 − 500 = +400, loser −500).
   * Level-up rewards triggered by the match XP are NOT included — they land
   * as separate wallet entries. `xpEarned` is the placement XP.
   */
  ranking: { seat: Seat; place: number; coinsDelta: number; xpEarned: number }[];
  /** Sum of the entry fees collected from the paying seats (0 = free table). */
  potTotal: number;
  /**
   * True when the server could not persist the match / pay prizes (DB outage).
   * The match result stands; rewards were NOT granted with this broadcast.
   */
  rewardsPending?: boolean;
}

export interface ErrMessage {
  code: ErrCode;
  msg: string;
}

export interface ServerMessages {
  dice: DiceMessage;
  moveResult: MoveResultMessage;
  turn: TurnMessage;
  turnSkipped: TurnSkippedMessage;
  playerStatus: PlayerStatusMessage;
  emoteShown: EmoteShownMessage;
  matchEnd: MatchEndMessage;
  err: ErrMessage;
  tokenSpawned: TokenSpawnedMessage;
  tokenCollected: TokenCollectedMessage;
  powerUsed: PowerUsedMessage;
  trapTriggered: TrapTriggeredMessage;
}

export type ServerMessageType = keyof ServerMessages;
