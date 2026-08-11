/**
 * MailService against REAL MySQL: system mail delivery, lazy broadcast
 * materialization, mark-read, and the §7.2 attachment-claim dedupe
 * (UNIQUE lr_user_mail + guarded UPDATE + creditIn in one tx).
 */
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { lrMailMessages, lrUsers, lrWalletTransactions } from '../src/db/schema.js';
import { API_ERR, isApiError } from '../src/services/errors.js';
import { MailService } from '../src/services/MailService.js';
import { WalletService } from '../src/services/WalletService.js';
import { describeDb, setupDbSuite } from './apiHelpers.js';

describeDb('MailService (§7.6)', () => {
  const suite = setupDbSuite();

  function build() {
    const db = suite.db();
    const wallet = new WalletService(db);
    return { db, wallet, mail: new MailService(db, wallet) };
  }

  async function createUser(): Promise<number> {
    const [header] = await suite.db().insert(lrUsers).values({
      username: `mail_${Math.random().toString(36).slice(2, 10)}`,
      isGuest: true,
    });
    return header.insertId;
  }

  it('sendSystemMail lands in the inbox with its attachment metadata', async () => {
    const { mail } = build();
    const userId = await createUser();

    await mail.sendSystemMail(userId, 'first_win', { type: 'coins', amount: 250 });

    const inbox = await mail.getInbox(userId);
    expect(inbox.entries).toHaveLength(1);
    const entry = inbox.entries[0]!;
    expect(entry.title).toContain('First win');
    expect(entry.attachmentType).toBe('coins');
    expect(entry.attachmentAmount).toBe(250);
    expect(entry.read).toBe(false);
    expect(entry.claimed).toBe(false);
  });

  it('claim credits the attachment ONCE; the second claim is rejected', async () => {
    const { mail, wallet, db } = build();
    const userId = await createUser();
    await mail.sendSystemMail(userId, 'first_win', { type: 'coins', amount: 250 });
    const inbox = await mail.getInbox(userId);
    const id = inbox.entries[0]!.id;

    const result = await mail.claimAttachment(userId, id);
    expect(result.amount).toBe(250);
    expect(result.balanceAfter).toBe(250);

    await expect(mail.claimAttachment(userId, id)).rejects.toSatisfy((err: unknown) =>
      isApiError(err, API_ERR.ALREADY_CLAIMED),
    );

    expect((await wallet.getBalances(userId)).coins).toBe(250);
    const ledger = await db
      .select()
      .from(lrWalletTransactions)
      .where(eq(lrWalletTransactions.userId, userId));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.type).toBe('mail_attachment');
    expect(ledger[0]!.refType).toBe('mail');
    expect(ledger[0]!.refId).toBe(id);
  });

  it('a foreign user can neither read nor claim my mail', async () => {
    const { mail } = build();
    const owner = await createUser();
    const intruder = await createUser();
    await mail.sendSystemMail(owner, 'first_win', { type: 'coins', amount: 100 });
    const id = (await mail.getInbox(owner)).entries[0]!.id;

    await expect(mail.claimAttachment(intruder, id)).rejects.toSatisfy((err: unknown) =>
      isApiError(err, API_ERR.NOT_FOUND),
    );
    await expect(mail.markRead(intruder, id)).rejects.toSatisfy((err: unknown) =>
      isApiError(err, API_ERR.NOT_FOUND),
    );
  });

  it('markRead flips the read flag and is idempotent', async () => {
    const { mail } = build();
    const userId = await createUser();
    await mail.sendSystemMail(userId, 'first_win');
    const id = (await mail.getInbox(userId)).entries[0]!.id;

    await mail.markRead(userId, id);
    await mail.markRead(userId, id); // no throw
    expect((await mail.getInbox(userId)).entries[0]!.read).toBe(true);
  });

  it('broadcast mail (audience=all) materializes lazily on inbox open', async () => {
    const { mail, db } = build();
    const userId = await createUser();
    await db.insert(lrMailMessages).values({
      audience: 'all',
      title: 'Season kickoff',
      body: 'A new season begins!',
      attachmentType: 'none',
      createdAt: new Date(),
    });

    const inbox = await mail.getInbox(userId);
    expect(inbox.entries).toHaveLength(1);
    expect(inbox.entries[0]!.title).toBe('Season kickoff');

    // Second open must not duplicate the row (UNIQUE user+mail).
    expect((await mail.getInbox(userId)).entries).toHaveLength(1);
  });

  it('inbox paginates newest-first by cursor', async () => {
    const { mail } = build();
    const userId = await createUser();
    for (let i = 0; i < 3; i++) await mail.sendSystemMail(userId, 'first_win');

    const page1 = await mail.getInbox(userId, { limit: 2 });
    expect(page1.entries).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await mail.getInbox(userId, { limit: 2, beforeId: page1.nextCursor! });
    expect(page2.entries).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
    expect(page1.entries[0]!.id).toBeGreaterThan(page2.entries[0]!.id);
  });
});
