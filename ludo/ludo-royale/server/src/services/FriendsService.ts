/**
 * FriendsService — friends list, requests by referral code and the daily
 * coin gift (§7.7, LW "Friends" parity v1).
 *
 * Requests: by the target's referral code (the same code the Invite panel
 * shares). A pending request in the OPPOSITE direction auto-accepts — both
 * players wanted it. Friendship stores the §7.7 double row (A→B and B→A)
 * so "my friends" is one indexed lookup.
 *
 * Gifts: GIFT_COINS travel as a user mail with a coins attachment (claim +
 * wallet credit reuse the transactional mail flow); lr_friend_gifts is the
 * one-per-(sender, receiver, UTC-day) dedupe ledger — the UNIQUE key is the
 * source of truth, a race just loses the insert.
 */
import { and, asc, eq, inArray, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { lrFriendGifts, lrFriendRequests, lrFriends, lrUsers } from '../db/schema.js';
import { API_ERR, ApiError } from './errors.js';
import type { MailService } from './MailService.js';
import type { Tx } from '../db/client.js';

/** Daily gift size (coins). [DECISIÓN] admin setting in v1.1. */
export const GIFT_COINS = 100;

export interface FriendEntry {
  userId: number;
  name: string;
  level: number;
  avatarKey: string;
  /** false once today's gift to this friend was already sent. */
  canGift: boolean;
}

export interface FriendRequestEntry {
  id: number;
  name: string;
  level: number;
}

export interface FriendsOverview {
  friends: FriendEntry[];
  incoming: FriendRequestEntry[];
}

const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * mysql2 duplicate-key probe (the UNIQUE gift ledger race). Drizzle wraps
 * driver errors ("Failed query: …") keeping the original in `cause`.
 */
function isDupKey(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: string; cause?: { code?: string } | null };
  return e.code === 'ER_DUP_ENTRY' || e.cause?.code === 'ER_DUP_ENTRY';
}

export class FriendsService {
  constructor(
    private readonly db: Db,
    private readonly mail: MailService,
  ) {}

  async overview(userId: number, now: Date = new Date()): Promise<FriendsOverview> {
    const rows = await this.db
      .select({
        userId: lrFriends.friendId,
        name: lrUsers.username,
        level: lrUsers.level,
        avatarKey: lrUsers.avatarKey,
      })
      .from(lrFriends)
      .innerJoin(lrUsers, eq(lrUsers.id, lrFriends.friendId))
      .where(eq(lrFriends.userId, userId))
      .orderBy(asc(lrUsers.username));

    const giftedTo = new Set<number>();
    if (rows.length > 0) {
      const gifts = await this.db
        .select({ to: lrFriendGifts.toUserId })
        .from(lrFriendGifts)
        .where(
          and(
            eq(lrFriendGifts.fromUserId, userId),
            eq(lrFriendGifts.dayKey, dayKey(now)),
            inArray(
              lrFriendGifts.toUserId,
              rows.map((r) => r.userId),
            ),
          ),
        );
      for (const g of gifts) giftedTo.add(g.to);
    }

    const incoming = await this.db
      .select({
        id: lrFriendRequests.id,
        name: lrUsers.username,
        level: lrUsers.level,
      })
      .from(lrFriendRequests)
      .innerJoin(lrUsers, eq(lrUsers.id, lrFriendRequests.fromUserId))
      .where(and(eq(lrFriendRequests.toUserId, userId), eq(lrFriendRequests.status, 'pending')))
      .orderBy(asc(lrFriendRequests.id));

    return {
      friends: rows.map((r) => ({ ...r, canGift: !giftedTo.has(r.userId) })),
      incoming,
    };
  }

  /** Send a request to the owner of `rawCode`; mutual intent auto-accepts. */
  async request(
    userId: number,
    rawCode: string,
    now: Date = new Date(),
  ): Promise<{ autoAccepted: boolean; name: string }> {
    const code = rawCode.trim().toUpperCase();
    const [target] = await this.db
      .select({ id: lrUsers.id, name: lrUsers.username })
      .from(lrUsers)
      .where(eq(lrUsers.referralCode, code))
      .limit(1);
    if (!target) throw new ApiError(404, API_ERR.NOT_FOUND, 'no player with that code');
    if (target.id === userId) {
      throw new ApiError(400, API_ERR.VALIDATION, 'that is your own code');
    }
    const [already] = await this.db
      .select({ id: lrFriends.id })
      .from(lrFriends)
      .where(and(eq(lrFriends.userId, userId), eq(lrFriends.friendId, target.id)))
      .limit(1);
    if (already) throw new ApiError(400, API_ERR.VALIDATION, 'already friends');

    return this.db.transaction(async (tx) => {
      const [inverse] = await tx
        .select({ id: lrFriendRequests.id })
        .from(lrFriendRequests)
        .where(
          and(
            eq(lrFriendRequests.fromUserId, target.id),
            eq(lrFriendRequests.toUserId, userId),
            eq(lrFriendRequests.status, 'pending'),
          ),
        )
        .limit(1);
      if (inverse) {
        await this.acceptIn(tx, inverse.id, target.id, userId, now);
        return { autoAccepted: true, name: target.name };
      }
      const [mine] = await tx
        .select({ id: lrFriendRequests.id })
        .from(lrFriendRequests)
        .where(
          and(
            eq(lrFriendRequests.fromUserId, userId),
            eq(lrFriendRequests.toUserId, target.id),
            eq(lrFriendRequests.status, 'pending'),
          ),
        )
        .limit(1);
      if (mine) throw new ApiError(400, API_ERR.VALIDATION, 'request already sent');
      await tx.insert(lrFriendRequests).values({
        fromUserId: userId,
        toUserId: target.id,
        createdAt: now,
      });
      return { autoAccepted: false, name: target.name };
    });
  }

  /** Accept/decline a request addressed to me. */
  async respond(
    userId: number,
    requestId: number,
    accept: boolean,
    now: Date = new Date(),
  ): Promise<{ accepted: boolean }> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ id: lrFriendRequests.id, fromUserId: lrFriendRequests.fromUserId })
        .from(lrFriendRequests)
        .where(
          and(
            eq(lrFriendRequests.id, requestId),
            eq(lrFriendRequests.toUserId, userId),
            eq(lrFriendRequests.status, 'pending'),
          ),
        )
        .limit(1);
      if (!row) throw new ApiError(404, API_ERR.NOT_FOUND, 'request not found');
      if (!accept) {
        await tx
          .update(lrFriendRequests)
          .set({ status: 'declined', resolvedAt: now })
          .where(eq(lrFriendRequests.id, row.id));
        return { accepted: false };
      }
      await this.acceptIn(tx, row.id, row.fromUserId, userId, now);
      return { accepted: true };
    });
  }

  /** Unfriend: drop both §7.7 rows; old resolved requests don't block a redo. */
  async remove(userId: number, friendId: number): Promise<{ removed: boolean }> {
    const result = await this.db
      .delete(lrFriends)
      .where(
        or(
          and(eq(lrFriends.userId, userId), eq(lrFriends.friendId, friendId)),
          and(eq(lrFriends.userId, friendId), eq(lrFriends.friendId, userId)),
        ),
      );
    return { removed: result[0].affectedRows > 0 };
  }

  /**
   * Daily coin gift. With `friendId`: that friend (throws if already sent
   * today). Without: every still-giftable friend ("Send all"). Each gift is
   * its own transaction — one duplicate never rolls back the rest.
   */
  async gift(
    userId: number,
    friendId?: number,
    now: Date = new Date(),
  ): Promise<{ sent: number }> {
    const [me] = await this.db
      .select({ name: lrUsers.username })
      .from(lrUsers)
      .where(eq(lrUsers.id, userId))
      .limit(1);
    if (!me) throw new ApiError(404, API_ERR.USER_NOT_FOUND, 'user not found');
    const day = dayKey(now);

    if (friendId !== undefined) {
      await this.assertFriends(userId, friendId);
      const sent = await this.db.transaction((tx) =>
        this.giftOneIn(tx, userId, me.name, friendId, day, now),
      );
      if (!sent) throw new ApiError(400, API_ERR.VALIDATION, 'already gifted today');
      return { sent: 1 };
    }

    const friends = await this.db
      .select({ friendId: lrFriends.friendId })
      .from(lrFriends)
      .where(eq(lrFriends.userId, userId));
    let sent = 0;
    for (const f of friends) {
      const ok = await this.db.transaction((tx) =>
        this.giftOneIn(tx, userId, me.name, f.friendId, day, now),
      );
      if (ok) sent += 1;
    }
    return { sent };
  }

  // -------------------------------------------------------------------------

  private async assertFriends(userId: number, friendId: number): Promise<void> {
    const [row] = await this.db
      .select({ id: lrFriends.id })
      .from(lrFriends)
      .where(and(eq(lrFriends.userId, userId), eq(lrFriends.friendId, friendId)))
      .limit(1);
    if (!row) throw new ApiError(400, API_ERR.VALIDATION, 'not friends');
  }

  private async acceptIn(
    tx: Tx,
    requestId: number,
    fromUserId: number,
    toUserId: number,
    now: Date,
  ): Promise<void> {
    await tx
      .update(lrFriendRequests)
      .set({ status: 'accepted', resolvedAt: now })
      .where(eq(lrFriendRequests.id, requestId));
    // Double row (§7.7); tolerate replays of half-created friendships.
    for (const [a, b] of [
      [fromUserId, toUserId],
      [toUserId, fromUserId],
    ] as const) {
      try {
        await tx.insert(lrFriends).values({ userId: a, friendId: b, createdAt: now });
      } catch (err) {
        if (!isDupKey(err)) throw err;
      }
    }
  }

  /** One gift inside the caller's tx; false = today's already sent. */
  private async giftOneIn(
    tx: Tx,
    fromId: number,
    fromName: string,
    toId: number,
    day: string,
    now: Date,
  ): Promise<boolean> {
    try {
      await tx.insert(lrFriendGifts).values({
        fromUserId: fromId,
        toUserId: toId,
        dayKey: day,
        createdAt: now,
      });
    } catch (err) {
      if (isDupKey(err)) return false;
      throw err;
    }
    await this.mail.sendCustomMailIn(
      tx,
      toId,
      `🎁 ${fromName}`,
      `¡${fromName} te envió ${GIFT_COINS} monedas de regalo! / ${fromName} sent you a gift of ${GIFT_COINS} coins!`,
      { type: 'coins', amount: GIFT_COINS },
      now,
    );
    return true;
  }
}
