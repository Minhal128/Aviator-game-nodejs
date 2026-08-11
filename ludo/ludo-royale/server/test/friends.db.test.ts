/**
 * FriendsService — requests by referral code, the §7.7 double-row
 * friendship, auto-accept on mutual intent, unfriend, and the daily coin
 * gift: mail attachment + one-per-(pair, UTC day) dedupe ledger.
 */
import { and, eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import {
  lrFriendGifts,
  lrFriends,
  lrMailMessages,
  lrUserMail,
  lrUsers,
} from '../src/db/schema.js';
import { API_ERR, isApiError } from '../src/services/errors.js';
import { FriendsService, GIFT_COINS } from '../src/services/FriendsService.js';
import { MailService } from '../src/services/MailService.js';
import { WalletService } from '../src/services/WalletService.js';
import { describeDb, setupDbSuite } from './apiHelpers.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describeDb('FriendsService (§7.7)', () => {
  const suite = setupDbSuite();

  function build(): { friends: FriendsService } {
    const db = suite.db();
    const wallet = new WalletService(db);
    const mail = new MailService(db, wallet);
    return { friends: new FriendsService(db, mail) };
  }

  function rc(): string {
    return `FR${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  }

  async function createUser(code: string): Promise<number> {
    const [header] = await suite
      .db()
      .insert(lrUsers)
      .values({
        username: `fr_${Math.random().toString(36).slice(2, 10)}`,
        isGuest: true,
        coins: 0,
        gems: 0,
        referralCode: code,
      });
    return header.insertId;
  }

  it('request by code → accept creates the double row, visible to both', async () => {
    const { friends } = build();
    const codeB = rc();
    const a = await createUser(rc());
    const b = await createUser(codeB);

    const req = await friends.request(a, codeB.toLowerCase()); // case-insensitive
    expect(req.autoAccepted).toBe(false);

    const inboxB = await friends.overview(b);
    expect(inboxB.incoming).toHaveLength(1);

    const res = await friends.respond(b, inboxB.incoming[0]!.id, true);
    expect(res.accepted).toBe(true);

    const rows = await suite.db().select().from(lrFriends);
    expect(rows.filter((r) => r.userId === a && r.friendId === b)).toHaveLength(1);
    expect(rows.filter((r) => r.userId === b && r.friendId === a)).toHaveLength(1);
    expect((await friends.overview(a)).friends[0]?.canGift).toBe(true);
    expect((await friends.overview(b)).friends).toHaveLength(1);
  });

  it('rejects own code, unknown code, duplicates and existing friendships', async () => {
    const { friends } = build();
    const codeA = rc();
    const codeB = rc();
    const a = await createUser(codeA);
    const b = await createUser(codeB);

    await expect(friends.request(a, codeA)).rejects.toSatisfy(
      (e: unknown) => isApiError(e, API_ERR.VALIDATION),
    );
    await expect(friends.request(a, 'ZZZZZZ')).rejects.toSatisfy(
      (e: unknown) => isApiError(e, API_ERR.NOT_FOUND),
    );
    await friends.request(a, codeB);
    await expect(friends.request(a, codeB)).rejects.toSatisfy(
      (e: unknown) => isApiError(e, API_ERR.VALIDATION),
    );
    const reqs = (await friends.overview(b)).incoming;
    await friends.respond(b, reqs[0]!.id, true);
    await expect(friends.request(a, codeB)).rejects.toSatisfy(
      (e: unknown) => isApiError(e, API_ERR.VALIDATION),
    );
  });

  it('mutual pending requests auto-accept', async () => {
    const { friends } = build();
    const codeA = rc();
    const codeB = rc();
    const a = await createUser(codeA);
    const b = await createUser(codeB);

    await friends.request(a, codeB);
    const back = await friends.request(b, codeA);
    expect(back.autoAccepted).toBe(true);
    expect((await friends.overview(a)).friends).toHaveLength(1);
    expect((await friends.overview(b)).incoming).toHaveLength(0);
  });

  it('gift: coins mail + per-day dedupe + next day resets + gift-all skips sent', async () => {
    const { friends } = build();
    const codeB = rc();
    const codeC = rc();
    const a = await createUser(rc());
    const b = await createUser(codeB);
    const c = await createUser(codeC);
    for (const code of [codeB, codeC]) {
      await friends.request(a, code);
    }
    for (const u of [b, c]) {
      const inbox = await friends.overview(u);
      await friends.respond(u, inbox.incoming[0]!.id, true);
    }

    const now = new Date();
    expect((await friends.gift(a, b, now)).sent).toBe(1);

    // The gift landed as a coins mail in B's inbox.
    const [mailRow] = await suite
      .db()
      .select({
        attachmentType: lrMailMessages.attachmentType,
        attachmentAmount: lrMailMessages.attachmentAmount,
      })
      .from(lrUserMail)
      .innerJoin(lrMailMessages, eq(lrMailMessages.id, lrUserMail.mailId))
      .where(eq(lrUserMail.userId, b));
    expect(mailRow?.attachmentType).toBe('coins');
    expect(Number(mailRow?.attachmentAmount)).toBe(GIFT_COINS);

    // Same-day repeat rejected; overview flags canGift=false for B only.
    await expect(friends.gift(a, b, now)).rejects.toSatisfy(
      (e: unknown) => isApiError(e, API_ERR.VALIDATION),
    );
    const view = await friends.overview(a, now);
    expect(view.friends.find((f) => f.userId === b)?.canGift).toBe(false);
    expect(view.friends.find((f) => f.userId === c)?.canGift).toBe(true);

    // Gift-all only reaches C today; tomorrow B is giftable again.
    expect((await friends.gift(a, undefined, now)).sent).toBe(1);
    const tomorrow = new Date(now.getTime() + DAY_MS);
    expect((await friends.gift(a, b, tomorrow)).sent).toBe(1);
    const ledger = await suite
      .db()
      .select()
      .from(lrFriendGifts)
      .where(and(eq(lrFriendGifts.fromUserId, a), eq(lrFriendGifts.toUserId, b)));
    expect(ledger).toHaveLength(2);
  });

  it('remove drops both directions and blocks gifting', async () => {
    const { friends } = build();
    const codeB = rc();
    const a = await createUser(rc());
    const b = await createUser(codeB);
    await friends.request(a, codeB);
    const inbox = await friends.overview(b);
    await friends.respond(b, inbox.incoming[0]!.id, true);

    expect((await friends.remove(a, b)).removed).toBe(true);
    expect((await friends.overview(a)).friends).toHaveLength(0);
    expect((await friends.overview(b)).friends).toHaveLength(0);
    await expect(friends.gift(a, b)).rejects.toSatisfy(
      (e: unknown) => isApiError(e, API_ERR.VALIDATION),
    );
    // Re-friending after an unfriend works (old resolved requests don't block).
    const redo = await friends.request(a, codeB);
    expect(redo.autoAccepted).toBe(false);
  });
});
