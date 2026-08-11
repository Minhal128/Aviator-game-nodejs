/**
 * MailService — inbox + attachments (ARQUITECTURA §7.6/§8.1).
 *
 * Broadcast mails (`audience='all'`) are NOT fanned out on write: the
 * lr_user_mail row materializes lazily when the user opens the inbox
 * (UNIQUE(user_id, mail_id) makes the materialization idempotent).
 *
 * Attachment claim dedupe (§7.2): the guarded UPDATE on lr_user_mail
 * (claimed_at IS NULL) and the WalletService credit share one transaction —
 * ledger type 'mail_attachment', ref mail/lr_user_mail.id.
 *
 * sendSystemMail(): server-generated mails (first-win-of-the-day bonus, and
 * later live-ops templates). Titles/bodies are English server-side in v1 —
 * the client mail panel localizes known system templates by title match; the
 * admin MailComposer (Sprint 3c) writes free text.
 */
import { and, asc, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import { lrMailMessages, lrUserInventory, lrUserMail } from '../db/schema.js';
import { API_ERR, ApiError } from './errors.js';
import type { WalletService } from './WalletService.js';

const HOUR_MS = 60 * 60 * 1000;

/** Server-generated mail templates (English v1 — see file header). */
export const SYSTEM_MAIL_TEMPLATES = {
  first_win: {
    title: 'First win of the day!',
    body: 'You won your first match today — here is a little extra. Keep the streak rolling!',
  },
} as const;

export type SystemMailTemplate = keyof typeof SYSTEM_MAIL_TEMPLATES;

export interface MailAttachment {
  type: 'coins' | 'gems' | 'item';
  amount?: number;
  itemId?: number;
  itemDurationH?: number;
}

export interface InboxEntry {
  /** lr_user_mail.id — the id used by read/claim endpoints. */
  id: number;
  title: string;
  body: string;
  attachmentType: 'none' | 'coins' | 'gems' | 'item';
  attachmentAmount: number | null;
  attachmentItemId: number | null;
  read: boolean;
  claimed: boolean;
  createdAt: Date;
  expiresAt: Date | null;
}

export interface InboxPage {
  entries: InboxEntry[];
  nextCursor: number | null;
}

export interface MailClaimResult {
  id: number;
  attachmentType: 'coins' | 'gems' | 'item';
  amount: number;
  balanceAfter: number | null;
}

export class MailService {
  constructor(
    private readonly db: Db,
    private readonly wallet: WalletService,
  ) {}

  /** Inbox, newest first, cursor-paginated by lr_user_mail.id. */
  async getInbox(
    userId: number,
    opts: { limit?: number; beforeId?: number } = {},
    now: Date = new Date(),
  ): Promise<InboxPage> {
    await this.materializeBroadcasts(userId, now);

    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
    const conditions = [
      eq(lrUserMail.userId, userId),
      isNull(lrUserMail.deletedAt),
      or(isNull(lrMailMessages.expiresAt), gt(lrMailMessages.expiresAt, now)),
    ];
    if (opts.beforeId !== undefined) conditions.push(lt(lrUserMail.id, opts.beforeId));

    const rows = await this.db
      .select({
        id: lrUserMail.id,
        readAt: lrUserMail.readAt,
        claimedAt: lrUserMail.claimedAt,
        title: lrMailMessages.title,
        body: lrMailMessages.body,
        attachmentType: lrMailMessages.attachmentType,
        attachmentAmount: lrMailMessages.attachmentAmount,
        attachmentItemId: lrMailMessages.attachmentItemId,
        createdAt: lrMailMessages.createdAt,
        expiresAt: lrMailMessages.expiresAt,
      })
      .from(lrUserMail)
      .innerJoin(lrMailMessages, eq(lrUserMail.mailId, lrMailMessages.id))
      .where(and(...conditions))
      .orderBy(desc(lrUserMail.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      entries: page.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        attachmentType: r.attachmentType,
        attachmentAmount: r.attachmentAmount,
        attachmentItemId: r.attachmentItemId,
        read: r.readAt !== null,
        claimed: r.claimedAt !== null,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
      })),
      nextCursor: hasMore && last ? last.id : null,
    };
  }

  /** Mark one inbox entry read. Idempotent; 404 when it is not yours. */
  async markRead(userId: number, userMailId: number, now: Date = new Date()): Promise<void> {
    const [header] = await this.db
      .update(lrUserMail)
      .set({ readAt: now })
      .where(
        and(
          eq(lrUserMail.id, userMailId),
          eq(lrUserMail.userId, userId),
          isNull(lrUserMail.readAt),
        ),
      );
    if (header.affectedRows > 0) return;
    const exists = await this.db
      .select({ id: lrUserMail.id })
      .from(lrUserMail)
      .where(and(eq(lrUserMail.id, userMailId), eq(lrUserMail.userId, userId)))
      .limit(1);
    if (exists.length === 0) throw new ApiError(404, API_ERR.NOT_FOUND, 'mail not found');
  }

  /**
   * Claim the attachment of one inbox entry. Atomic guarded UPDATE on the
   * UNIQUE origin row + credit/grant in the SAME transaction (§7.2).
   */
  async claimAttachment(
    userId: number,
    userMailId: number,
    now: Date = new Date(),
  ): Promise<MailClaimResult> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: lrUserMail.id,
          claimedAt: lrUserMail.claimedAt,
          attachmentType: lrMailMessages.attachmentType,
          attachmentAmount: lrMailMessages.attachmentAmount,
          attachmentItemId: lrMailMessages.attachmentItemId,
          attachmentItemDurationH: lrMailMessages.attachmentItemDurationH,
          expiresAt: lrMailMessages.expiresAt,
        })
        .from(lrUserMail)
        .innerJoin(lrMailMessages, eq(lrUserMail.mailId, lrMailMessages.id))
        .where(and(eq(lrUserMail.id, userMailId), eq(lrUserMail.userId, userId)))
        .limit(1);
      const row = rows[0];
      if (!row) throw new ApiError(404, API_ERR.NOT_FOUND, 'mail not found');
      if (row.attachmentType === 'none') {
        throw new ApiError(400, API_ERR.VALIDATION, 'mail has no attachment');
      }
      if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
        throw new ApiError(409, API_ERR.ITEM_EXPIRED, 'mail has expired');
      }

      const [claimed] = await tx
        .update(lrUserMail)
        .set({ claimedAt: now, readAt: sql`COALESCE(read_at, ${now})` })
        .where(and(eq(lrUserMail.id, userMailId), isNull(lrUserMail.claimedAt)));
      if (claimed.affectedRows === 0) {
        throw new ApiError(409, API_ERR.ALREADY_CLAIMED, 'attachment already claimed');
      }

      if (row.attachmentType === 'item' && row.attachmentItemId !== null) {
        await tx
          .insert(lrUserInventory)
          .values({
            userId,
            itemId: row.attachmentItemId,
            qty: 1,
            acquiredVia: 'mail',
            expiresAt: row.attachmentItemDurationH
              ? new Date(now.getTime() + row.attachmentItemDurationH * HOUR_MS)
              : null,
            createdAt: now,
          })
          .onDuplicateKeyUpdate({ set: { qty: sql`qty + 1` } });
        return { id: userMailId, attachmentType: 'item' as const, amount: 1, balanceAfter: null };
      }

      const amount = row.attachmentAmount ?? 0;
      const { balanceAfter } = await this.wallet.creditIn(
        tx,
        userId,
        row.attachmentType as 'coins' | 'gems',
        amount,
        'mail_attachment',
        'mail',
        userMailId,
      );
      return { id: userMailId, attachmentType: row.attachmentType, amount, balanceAfter };
    });
  }

  /** Standalone system mail (own transaction). */
  async sendSystemMail(
    userId: number,
    template: SystemMailTemplate,
    attachment?: MailAttachment,
  ): Promise<number> {
    return this.db.transaction((tx) => this.sendSystemMailIn(tx, userId, template, attachment));
  }

  /**
   * Composition variant: insert the message + the user's inbox row inside
   * the CALLER's transaction (used by MatchService for the first-win mail).
   * Returns the lr_user_mail.id.
   */
  async sendSystemMailIn(
    tx: Tx,
    userId: number,
    template: SystemMailTemplate,
    attachment?: MailAttachment,
    now: Date = new Date(),
  ): Promise<number> {
    const tpl = SYSTEM_MAIL_TEMPLATES[template];
    return this.sendCustomMailIn(tx, userId, tpl.title, tpl.body, attachment, now);
  }

  /**
   * Caller-authored user mail (friend gifts carry the sender's name in the
   * title). Same insert pair as system mail, inside the caller's tx.
   */
  async sendCustomMailIn(
    tx: Tx,
    userId: number,
    title: string,
    body: string,
    attachment?: MailAttachment,
    now: Date = new Date(),
  ): Promise<number> {
    const [msgHeader] = await tx.insert(lrMailMessages).values({
      audience: 'user',
      userId,
      title,
      body,
      attachmentType: attachment?.type ?? 'none',
      attachmentAmount: attachment?.amount ?? null,
      attachmentItemId: attachment?.itemId ?? null,
      attachmentItemDurationH: attachment?.itemDurationH ?? null,
      createdAt: now,
    });
    const [umHeader] = await tx.insert(lrUserMail).values({
      userId,
      mailId: msgHeader.insertId,
    });
    return umHeader.insertId;
  }

  /** Lazily create lr_user_mail rows for live `audience='all'` messages. */
  private async materializeBroadcasts(userId: number, now: Date): Promise<void> {
    const broadcasts = await this.db
      .select({ id: lrMailMessages.id })
      .from(lrMailMessages)
      .where(
        and(
          eq(lrMailMessages.audience, 'all'),
          or(isNull(lrMailMessages.expiresAt), gt(lrMailMessages.expiresAt, now)),
        ),
      )
      .orderBy(asc(lrMailMessages.id));
    if (broadcasts.length === 0) return;

    await this.db
      .insert(lrUserMail)
      .values(broadcasts.map((b) => ({ userId, mailId: b.id })))
      // No-op on rows that already exist (UNIQUE(user_id, mail_id)).
      .onDuplicateKeyUpdate({ set: { mailId: sql`mail_id` } });
  }
}
