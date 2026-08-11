import type { PowerType, Seat } from './types.js';
import type {
  DiceMessage,
  EmoteShownMessage,
  ErrMessage,
  MatchEndMessage,
  MoveResultMessage,
  PlayerStatusMessage,
  PowerUsedMessage,
  TokenCollectedMessage,
  TokenSpawnedMessage,
  TrapTriggeredMessage,
  TurnMessage,
  TurnSkippedMessage,
} from './protocol/messages.js';

/** Capture notice surfaced to the scene (fires the capture combo fx). */
export interface CaptureNotice {
  bySeat: Seat;
  byPieceId: number;
  victimSeat: Seat;
  victimPieceId: number;
  /** Absolute track cell where it happened. */
  cell: number;
}

/**
 * GameDriver — one contract, two transports (ARQUITECTURA §4.5).
 *
 * GameBoardScene drives a match through this interface without knowing
 * whether OfflineDriver (local engine + AI, Sprint 1b) or ColyseusClient
 * (online room, Sprint 2) sits behind it. Handlers are optional assignable
 * callbacks so the scene wires only what it renders.
 */
export interface GameDriver {
  requestRoll(): void;
  requestMove(pieceId: number): void;
  sendEmote(emoteId: number): void;
  forfeit(): void;
  /** POWER mode: spend a charge (no-op / error in classic matches). */
  usePower(
    power: PowerType,
    opts?: { face?: number; pieceId?: number; targetSeat?: Seat; cell?: number },
  ): void;

  onDice?: (msg: DiceMessage) => void;
  onMove?: (msg: MoveResultMessage) => void;
  onTurn?: (msg: TurnMessage) => void;
  onTurnSkipped?: (msg: TurnSkippedMessage) => void;
  onCapture?: (notice: CaptureNotice) => void;
  onMatchEnd?: (msg: MatchEndMessage) => void;
  onPlayerStatus?: (msg: PlayerStatusMessage) => void;
  /** Remote emote broadcast (§6.5 `emoteShown`). Offline drivers never fire it. */
  onEmoteShown?: (msg: EmoteShownMessage) => void;
  onError?: (msg: ErrMessage) => void;
  onTokenSpawned?: (msg: TokenSpawnedMessage) => void;
  onTokenCollected?: (msg: TokenCollectedMessage) => void;
  onPowerUsed?: (msg: PowerUsedMessage) => void;
  /** POWER battle set: an armed bomb went off. */
  onTrapTriggered?: (msg: TrapTriggeredMessage) => void;
}
