/**
 * @colyseus/schema mirror of the engine GameState (ARQUITECTURA §6.4).
 *
 * The schema is the truth for re-sync and reconnection; the JUICE comes from
 * protocol messages (`dice`/`moveResult`/`turn`, §6.5) which the client
 * animates — movements are never animated from schema patches. PieceSchema
 * rows are created once at match start and mutated in place so patches stay
 * tiny (one int16 per hop).
 *
 * Sprint-3 fields from §6.4 (userId, avatarKey, frameKey, level, tierId) are
 * deliberately absent: there are no accounts nor economy yet.
 */
import { Schema, MapSchema, ArraySchema } from '@colyseus/schema';
import { type } from '@colyseus/schema';

export class PlayerSchema extends Schema {
  @type('int8') seat: number = 0;
  @type('string') name: string = '';
  /** Engine color ('' until the match starts and seats are compacted). */
  @type('string') color: string = '';
  @type('boolean') connected: boolean = true;
  /** True while the server plays this seat (§5.4 strikes / §6.6 grace). */
  @type('boolean') auto: boolean = false;
  /** Final placement, 1-based; 0 while still playing. */
  @type('int8') place: number = 0;
  @type('boolean') forfeited: boolean = false;
  @type('int8') timeoutStrikes: number = 0;
}

export class PieceSchema extends Schema {
  @type('int8') seat: number = 0;
  @type('int8') pieceId: number = 0;
  /** Color-relative steps (§5.1): -1 base · 0..50 track · 51..56 lane · 57 home. */
  @type('int16') steps: number = -1;
}

/** POWER mode: a collectible token on an absolute ring cell. */
export class TokenSchema extends Schema {
  @type('int8') cell: number = 0;
  /** 'plus' | 'double' | 'pick' | 'shield' */
  @type('string') power: string = 'plus';
}

/** POWER mode: per-seat charge counters (row index = seat). */
export class ChargesSchema extends Schema {
  @type('int8') plus: number = 0;
  @type('int8') double: number = 0;
  @type('int8') pick: number = 0;
  @type('int8') shield: number = 0;
  @type('int8') bomb: number = 0;
  @type('int8') bolt: number = 0;
  @type('int8') freeze: number = 0;
  @type('int8') portal: number = 0;
}

/** POWER battle set: an armed bomb on an absolute ring cell. */
export class TrapSchema extends Schema {
  /** Seat that planted it (enemies of this seat trigger it). */
  @type('int8') seat: number = 0;
  @type('int8') cell: number = 0;
}

/** POWER battle set: a piece sitting out its owner's next turn. */
export class FrozenSchema extends Schema {
  @type('int8') seat: number = 0;
  @type('int8') pieceId: number = 0;
}

/** POWER mode: an active immunity dome. */
export class ShieldSchema extends Schema {
  @type('int8') seat: number = 0;
  @type('int8') pieceId: number = 0;
}

export class LudoRoomState extends Schema {
  /** 'lobby' | 'countdown' | 'playing' | 'finished' */
  @type('string') phase: string = 'lobby';
  /** 'quick' | 'private' */
  @type('string') mode: string = 'quick';
  /** Configured room size (maxClients). */
  @type('uint8') size: number = 2;
  /** Actual seats once the match starts (private rooms may start below size). */
  @type('uint8') numPlayers: number = 0;
  @type('uint8') turnTimerS: number = 30;
  @type('int8') currentSeat: number = 0;
  /** Last rolled value awaiting a move; 0 when no roll is pending. */
  @type('int8') dice: number = 0;
  @type('boolean') awaitingMove: boolean = false;
  /** Epoch ms — clients paint the timer ring from this (§5.4). */
  @type('number') turnDeadline: number = 0;
  @type('int8') consecutiveSixes: number = 0;
  /** Epoch ms of the lobby countdown end; 0 when not counting. */
  @type('number') countdownEnds: number = 0;
  /** 6-char join code for private rooms ('' in quick). */
  @type('string') privateCode: string = '';
  /** First joiner; may start a private room early and kick in LOBBY (§6.1). */
  @type('string') hostSessionId: string = '';
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
  @type([PieceSchema]) pieces = new ArraySchema<PieceSchema>();
  /** Seats in finish order (index 0 = 1st place). */
  @type(['int8']) winnerOrder = new ArraySchema<number>();
  /** POWER mode (empty/false on classic rooms). */
  @type('boolean') powerMode: boolean = false;
  @type([TokenSchema]) tokens = new ArraySchema<TokenSchema>();
  @type([ChargesSchema]) charges = new ArraySchema<ChargesSchema>();
  @type([ShieldSchema]) shields = new ArraySchema<ShieldSchema>();
  @type([TrapSchema]) traps = new ArraySchema<TrapSchema>();
  @type([FrozenSchema]) frozen = new ArraySchema<FrozenSchema>();
}
