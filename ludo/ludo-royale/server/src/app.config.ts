/**
 * Colyseus 0.17 server definition, shared by game.entry.ts and the
 * @colyseus/testing boot() harness. One room class, two matchmaking doors
 * (ARQUITECTURA §6.1/§6.3):
 *
 *   quick   — client.joinOrCreate('quick', { size }) · filterBy groups
 *             waiting rooms by size, so 2P/3P/4P queues never mix.
 *   private — client.create('private', { size }) returns the 6-char code
 *             (roomId); friends join with client.joinById(code).
 *
 * No express block: the game process speaks WebSocket only. Health checks
 * use Colyseus' built-in matchmaking endpoint; REST lives in the separate
 * ludo-api process from Sprint 3 (§2.3).
 */
import { defineRoom, defineServer } from 'colyseus';
import { LudoRoom } from './rooms/LudoRoom.js';

export default defineServer({
  rooms: {
    // Grouped by size, tier AND mode: 2P/3P/4P queues, Beginner/Gold stakes
    // and CLASSIC/POWER tables never mix (§6.1/§6.3).
    quick: defineRoom(LudoRoom).filterBy(['size', 'tierId', 'powerMode']),
    private: defineRoom(LudoRoom),
  },
});
