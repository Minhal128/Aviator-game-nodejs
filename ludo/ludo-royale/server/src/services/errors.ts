/**
 * Typed error surface of the API/services layer. Every failure a route can
 * answer with is an ApiError carrying an HTTP status + stable machine code
 * (the client maps codes to i18n keys, same pattern as the game protocol's
 * shared/protocol/errors.ts).
 */

export const API_ERR = {
  /** Same literal as shared ERR.INSUFFICIENT_FUNDS — one code everywhere. */
  INSUFFICIENT_FUNDS: 'ERR_INSUFFICIENT_FUNDS',
  USER_NOT_FOUND: 'ERR_USER_NOT_FOUND',
  INVALID_AMOUNT: 'ERR_INVALID_AMOUNT',
  VALIDATION: 'ERR_VALIDATION',
  INVALID_TOKEN: 'ERR_INVALID_TOKEN',
  INVALID_REFRESH: 'ERR_INVALID_REFRESH',
  REFRESH_EXPIRED: 'ERR_REFRESH_EXPIRED',
  /** Rotated refresh presented again → whole family revoked (§8.2). */
  REFRESH_REUSED: 'ERR_REFRESH_REUSED',
  BANNED: 'ERR_BANNED',
  USERNAME_TAKEN: 'ERR_USERNAME_TAKEN',
  RATE_LIMIT: 'ERR_RATE_LIMIT',
  NOT_FOUND: 'ERR_NOT_FOUND',
  EMAIL_TAKEN: 'ERR_EMAIL_TAKEN',
  INVALID_CREDENTIALS: 'ERR_INVALID_CREDENTIALS',
  INTERNAL: 'ERR_INTERNAL',
  /** Reward already granted for this period/origin (daily, mission, mail…). */
  ALREADY_CLAIMED: 'ERR_ALREADY_CLAIMED',
  /** Mission/attachment claim before the completion condition is met. */
  NOT_COMPLETED: 'ERR_NOT_COMPLETED',
  /** Buying a permanent item that already sits in the inventory. */
  ALREADY_OWNED: 'ERR_ALREADY_OWNED',
  /** Item inactive, outside its availability window or level-gated. */
  ITEM_UNAVAILABLE: 'ERR_ITEM_UNAVAILABLE',
  /** Temporal item/mail past its expiration. */
  ITEM_EXPIRED: 'ERR_ITEM_EXPIRED',
  /** Lucky Wheel: all free spins of the UTC day are used (§7.8). */
  NO_SPINS_LEFT: 'ERR_NO_SPINS_LEFT',
  /** Lucky Wheel: no lr_lucky_wheel_config row is active. */
  WHEEL_INACTIVE: 'ERR_WHEEL_INACTIVE',
} as const;

export type ApiErrCode = (typeof API_ERR)[keyof typeof API_ERR];

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrCode;

  constructor(status: number, code: ApiErrCode, message?: string) {
    super(message ?? code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** Narrowing helper for catch blocks. */
export function isApiError(err: unknown, code?: ApiErrCode): err is ApiError {
  return err instanceof ApiError && (code === undefined || err.code === code);
}
