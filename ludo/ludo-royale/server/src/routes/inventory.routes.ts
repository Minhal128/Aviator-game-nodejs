/**
 * /api/v1/inventory — backpack + equip (§8.1). One equipped item per
 * category; expiration enforced by InventoryService.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authedUserId, requireAuth } from '../middleware/auth.js';
import type { AuthService } from '../services/AuthService.js';
import type { InventoryService } from '../services/InventoryService.js';

const equipSchema = z.object({
  itemId: z.number().int().positive(),
});

const unequipSchema = z.object({
  category: z.enum(['dice_skin', 'token_skin', 'board_theme', 'avatar', 'avatar_frame']),
});

/** POWER consumables (sku power_*): the offline driver spends through here. */
const consumePowerSchema = z.object({
  power: z.enum(['plus', 'double', 'pick', 'shield', 'bomb', 'bolt', 'freeze', 'portal']),
});

export function createInventoryRouter(auth: AuthService, inventory: InventoryService): Router {
  const router = Router();
  router.use(requireAuth(auth));

  router.get('/', async (req, res) => {
    res.json({ items: await inventory.getInventory(authedUserId(req)) });
  });

  router.post('/equip', async (req, res) => {
    const body = equipSchema.parse(req.body);
    res.json(await inventory.equip(authedUserId(req), body.itemId));
  });

  // "Equip the default" — clears the category (see InventoryService.unequip).
  router.post('/unequip', async (req, res) => {
    const body = unequipSchema.parse(req.body);
    res.json(await inventory.unequip(authedUserId(req), body.category));
  });

  // POWER loadout: owned power quantities (seeds offline match charges).
  router.get('/powers', async (req, res) => {
    res.json({ powers: await inventory.getPowerLoadout(authedUserId(req)) });
  });

  // POWER spend: one unit per successful USE_POWER in an offline match
  // (online matches consume server-side inside the room).
  router.post('/powers/consume', async (req, res) => {
    const body = consumePowerSchema.parse(req.body);
    res.json(await inventory.consumePower(authedUserId(req), body.power));
  });

  return router;
}
