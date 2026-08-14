/**
 * /api/v1/matches - offline (vs CPU) progression + public stake tiers.
 */
import { Router } from 'express';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { lrRoomTiers } from '../db/schema.js';
import { authedUserId, requireAuth } from '../middleware/auth.js';
import type { AuthService } from '../services/AuthService.js';
import type { SettingsService } from '../services/SettingsService.js';
import type { WalletService } from '../services/WalletService.js';
import type { XpService } from '../services/XpService.js';

const bodySchema = z.object({
  mode: z.enum(['cpu', 'local']),
  numPlayers: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  powerMode: z.boolean(),
  place: z.number().int().min(1).max(4),
  aiLevel: z.enum(['easy', 'medium', 'hard']).optional(),
});

export function createMatchesRouter(
  auth: AuthService,
  settings: SettingsService,
  wallet: WalletService,
  xp: XpService,
  db: Db,
): Router {
  const router = Router();

  // Cash stakes for Play Online (1 coin = ₹1 on the Turbo Legends wallet).
  router.get('/tiers', async (_req, res) => {
    const rows = await db
      .select({
        id: lrRoomTiers.id,
        name: lrRoomTiers.name,
        entryFeeCoins: lrRoomTiers.entryFeeCoins,
        minLevel: lrRoomTiers.minLevel,
        sortOrder: lrRoomTiers.sortOrder,
      })
      .from(lrRoomTiers)
      .where(eq(lrRoomTiers.isActive, true))
      .orderBy(asc(lrRoomTiers.sortOrder));
    res.json({
      tiers: rows.map((r) => ({
        id: r.id,
        name: r.name,
        entryFee: r.entryFeeCoins,
        minLevel: r.minLevel,
      })),
    });
  });

  router.post('/local-result', requireAuth(auth), async (req, res) => {
    const userId = authedUserId(req);
    const body = bodySchema.parse(req.body);

    let coinsEarned = 0;
    let xpEarned = 0;
    let leveledUp = false;

    // Only vs-CPU progresses one owner. Pass&play earns nothing.
    if (body.mode === 'cpu') {
      const coinsTable = await settings.getJson<number[]>('local_match_coins_place', [400, 180, 120, 80]);
      const xpTable = await settings.getJson<number[]>('local_match_xp_place', [100, 60, 40, 25]);
      // Beating a tougher CPU is worth more (Jose): scale by difficulty.
      const diffMult = await settings.getJson<Record<string, number>>('local_match_difficulty_mult', {
        easy: 1,
        medium: 1.35,
        hard: 1.75,
      });
      const mult = body.aiLevel ? (diffMult[body.aiLevel] ?? 1) : 1;
      const i = Math.min(body.place - 1, 3);
      coinsEarned = Math.max(0, Math.round((coinsTable[i] ?? 0) * mult));
      xpEarned = Math.max(0, Math.round((xpTable[i] ?? 0) * mult));
      if (coinsEarned > 0) {
        await wallet.credit(userId, 'coins', coinsEarned, 'match_prize', 'local_cpu', undefined, `place ${body.place}`);
      }
      if (xpEarned > 0) {
        const r = await xp.addXp(userId, xpEarned);
        leveledUp = r.leveledUp;
      }
    }

    const user = await auth.publicUser(userId);
    res.json({
      coinsEarned,
      xpEarned,
      leveledUp,
      coins: user.coins,
      gems: user.gems,
      xp: user.xp,
      level: user.level,
    });
  });

  return router;
}
