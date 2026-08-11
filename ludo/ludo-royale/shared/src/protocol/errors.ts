/** Protocol error codes (ARQUITECTURA §6.5). The client maps them to i18n keys. */
export const ERR = {
  NOT_YOUR_TURN: 'ERR_NOT_YOUR_TURN',
  ILLEGAL_MOVE: 'ERR_ILLEGAL_MOVE',
  /** Engine-level: action arrived in a phase that cannot accept it. */
  BAD_PHASE: 'ERR_BAD_PHASE',
  INSUFFICIENT_FUNDS: 'ERR_INSUFFICIENT_FUNDS',
  ROOM_FULL: 'ERR_ROOM_FULL',
  BAD_CODE: 'ERR_BAD_CODE',
  ALREADY_IN_MATCH: 'ERR_ALREADY_IN_MATCH',
  RATE_LIMIT: 'ERR_RATE_LIMIT',
} as const;

export type ErrCode = (typeof ERR)[keyof typeof ERR];

/**
 * Thrown by the engine when an action is invalid. Rooms catch it and answer
 * the offending client with an `err` message instead of crashing the match.
 */
export class IllegalActionError extends Error {
  readonly code: ErrCode;

  constructor(code: ErrCode, message?: string) {
    super(message ?? code);
    this.name = 'IllegalActionError';
    this.code = code;
  }
}
