/**
 * @ludo/shared — core game types.
 *
 * Everything here is plain, JSON-serializable data: no classes, no runtime
 * dependencies. The same shapes travel through the Colyseus room, the
 * offline driver and the test suite.
 */

export type PlayerColor = 'red' | 'blue' | 'yellow' | 'green';

/** Seat index around the board. Seat order is also turn order. */
export type Seat = 0 | 1 | 2 | 3;

export type GamePhase = 'lobby' | 'playing' | 'finished';

/** Sub-phase of the current turn while `phase === 'playing'`. */
export type TurnPhase = 'wait_roll' | 'wait_move';

export type AiLevel = 'easy' | 'medium' | 'hard';

export interface PieceState {
  seat: Seat;
  /** 0-3 within the seat. */
  pieceId: number;
  /**
   * Color-relative position (ARQUITECTURA §5.1):
   * -1 = BASE · 0..50 = main track · 51..56 = home lane · 57 = HOME.
   */
  steps: number;
}

export interface PlayerState {
  seat: Seat;
  color: PlayerColor;
  /** Final placement, 1-based. 0 while still playing. */
  place: number;
  forfeited: boolean;
  /** Consecutive turn timeouts; reset by any manual action (§5.4). */
  timeoutStrikes: number;
}

// ---------------------------------------------------------------------------
// POWER mode (Ludo World parity): collectible tokens drop on ring cells;
// landing on one earns a charge; charges are spent on your roll phase.
// ---------------------------------------------------------------------------

export type PowerType =
  // Classic set — roll-phase modifiers + on-board defense.
  | 'plus'
  | 'double'
  | 'pick'
  | 'shield'
  // Battle set — board-affecting offensive powers (bought with gold).
  | 'bomb'
  | 'bolt'
  | 'freeze'
  | 'portal';

/** A collectible sitting on an ABSOLUTE ring cell (0..51). */
export interface BoardToken {
  cell: number;
  power: PowerType;
}

/**
 * Per-seat, per-match usable charges — one counter per power type. In the
 * inventory model these are seeded at match start from the player's OWNED
 * powers, clamped to POWER_MATCH_CAP (max 2 of each per match), and spent by
 * USE_POWER. Nothing on the board replenishes them.
 */
export type PowerCharges = Record<PowerType, number>;

/** An active immunity dome. Expires when the owner's turn starts again. */
export interface ShieldState {
  seat: Seat;
  pieceId: number;
}

/** An armed bomb on an absolute ring cell. Triggers for enemies of `seat`. */
export interface TrapState {
  seat: Seat;
  cell: number;
}

/** A frozen piece — excluded from legal moves while `remaining` > 0. */
export interface FrozenState {
  /** Owner of the FROZEN piece (the victim), not the caster. */
  seat: Seat;
  pieceId: number;
  /** Owner turns left to sit out; decremented when that turn ends. */
  remaining: number;
}

/** Armed roll modifier — consumed by the very next ROLL of the same seat. */
export type PendingRoll = { kind: 'double' } | { kind: 'pick'; face: number };

/** Parametrizable rules (§5.2.9). Defaults replicate the CLASSIC ruleset. */
export interface RuleFlags {
  /** Two own pieces on a track cell form an uncapturable, unlandable wall. */
  blockEnabled: boolean;
  extraTurnOnCapture: boolean;
  /** Third consecutive six forfeits the turn on the spot. */
  tripleSixForfeit: boolean;
  /** 3-4P matches keep playing until 2nd place is decided. */
  playForSecond: boolean;
  /** On turn timeout the engine plays the turn (Easy heuristic) instead of skipping. */
  autoMoveOnTimeout: boolean;
}

export interface GameConfig {
  numPlayers: 2 | 3 | 4;
  rules: RuleFlags;
  turnTimerS: number;
  startingSeat: Seat;
  /** POWER mode: token drops + collectible powers (classic when false). */
  powerMode: boolean;
  /**
   * POWER token drops on the ring (the legacy Ludo World economy). When
   * false the ONLY charges are the ones seeded from the player's inventory
   * at match start (shop model) — nothing spawns on the board.
   */
  tokenDrops: boolean;
}

export interface GameState {
  phase: GamePhase;
  turnPhase: TurnPhase;
  config: GameConfig;
  players: PlayerState[];
  pieces: PieceState[];
  currentSeat: Seat;
  /** Last rolled value awaiting a move; 0 when no roll is pending. */
  dice: number;
  /** Both dice when the pending value came from a POWER double roll. */
  diceParts: [number, number] | null;
  consecutiveSixes: number;
  /** Epoch ms; 0 when the caller does not manage clocks (pure/offline usage). */
  turnDeadline: number;
  /** Seats in finish order (index 0 = 1st place). */
  winnerOrder: Seat[];
  /** Every injected dice value, in order, for post-hoc RNG audit (§5.5). */
  rngLog: number[];
  /** POWER mode state — always present, empty/zeroed in classic matches. */
  tokens: BoardToken[];
  /** Indexed by seat. */
  charges: PowerCharges[];
  shields: ShieldState[];
  /** POWER battle set: armed bombs waiting on absolute ring cells. */
  traps: TrapState[];
  /** POWER battle set: pieces sitting out their owner's next turn. */
  frozen: FrozenState[];
  pendingRoll: PendingRoll | null;
}

export interface CaptureRef {
  seat: Seat;
  pieceId: number;
}

/** A fully-resolved legal move: what happens if the piece is played. */
export interface MoveDescriptor {
  seat: Seat;
  pieceId: number;
  dice: number;
  /** steps before the move (-1 = leaving BASE). */
  from: number;
  /** steps after the move (57 = HOME). */
  to: number;
  /** Intermediate steps values, one per cell hopped (drives the animation). */
  path: number[];
  captures: CaptureRef[];
  reachesHome: boolean;
  /** True when playing this move grants a re-roll (six / capture / home, §5.2.5). */
  extraTurn: boolean;
}

export type ExtraTurnReason = 'six' | 'capture' | 'home';

export type SkipReason = 'no_moves' | 'triple_six' | 'timeout';

/**
 * Engine actions. Dice values are ALWAYS injected by the caller — the engine
 * has no RNG so the server can use crypto.randomInt and tests can script
 * exact sequences (§5.5).
 */
export type GameAction =
  | { type: 'START'; now?: number }
  | { type: 'ROLL'; seat: Seat; dice: number; dice2?: number; auto?: boolean; now?: number }
  | { type: 'MOVE'; seat: Seat; pieceId: number; auto?: boolean; now?: number }
  | { type: 'TIMEOUT'; dice?: number; rng?: number; now?: number }
  | { type: 'FORFEIT'; seat: Seat; now?: number }
  /**
   * POWER mode only, roll phase of your own turn. `face` for pick; `pieceId`
   * names an OWN piece for shield/plus/portal; bolt/freeze aim at an ENEMY
   * piece via `targetSeat`+`pieceId`; bomb takes an absolute ring `cell`.
   */
  | {
      type: 'USE_POWER';
      seat: Seat;
      power: PowerType;
      face?: number;
      pieceId?: number;
      targetSeat?: Seat;
      cell?: number;
      now?: number;
    };

export type GameEvent =
  | { type: 'MATCH_STARTED'; startingSeat: Seat }
  | {
      type: 'DICE_ROLLED';
      seat: Seat;
      value: number;
      legalPieceIds: number[];
      extraTurn: boolean;
      /** Both dice of a POWER double roll (value = their sum). */
      parts?: [number, number];
      /** True when the value came from a pick power, not luck. */
      picked?: boolean;
    }
  | {
      type: 'PIECE_MOVED';
      seat: Seat;
      pieceId: number;
      from: number;
      to: number;
      path: number[];
      reachedHome: boolean;
      /** Direct jump (portal/bolt): slide, don't hop cell by cell. */
      teleport?: boolean;
    }
  | {
      type: 'CAPTURE';
      seat: Seat;
      pieceId: number;
      victimSeat: Seat;
      victimPieceId: number;
      /** Absolute track cell where the capture happened. */
      cell: number;
    }
  | { type: 'EXTRA_TURN'; seat: Seat; reasons: ExtraTurnReason[] }
  | { type: 'TURN_SKIPPED'; seat: Seat; reason: SkipReason }
  | { type: 'TURN_CHANGED'; seat: Seat; turnPhase: TurnPhase }
  | { type: 'PLAYER_TIMEOUT'; seat: Seat; strikes: number }
  | { type: 'PLAYER_FINISHED'; seat: Seat; place: number }
  | { type: 'PLAYER_FORFEITED'; seat: Seat; place: number }
  | { type: 'MATCH_ENDED'; ranking: { seat: Seat; place: number }[] }
  | { type: 'TOKEN_SPAWNED'; cell: number; power: PowerType }
  | { type: 'TOKEN_COLLECTED'; seat: Seat; cell: number; power: PowerType; charges: number }
  | {
      type: 'POWER_USED';
      seat: Seat;
      power: PowerType;
      face?: number;
      pieceId?: number;
      /** bolt/freeze: owner of the targeted enemy piece. */
      targetSeat?: Seat;
      /** bomb: the trapped absolute ring cell. */
      cell?: number;
    }
  | {
      type: 'TRAP_TRIGGERED';
      /** Seat that planted the bomb. */
      seat: Seat;
      victimSeat: Seat;
      victimPieceId: number;
      cell: number;
      /** True when a shield absorbed the blast (shield spent, piece safe). */
      blocked: boolean;
    };

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
}
