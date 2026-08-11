import type { MoveDescriptor } from '../../types.js';

/** Uniform pick from a non-empty array; `rand` must return values in [0,1). */
function pick<T>(items: readonly T[], rand: () => number): T {
  const idx = Math.min(items.length - 1, Math.floor(rand() * items.length));
  const item = items[idx];
  if (item === undefined) throw new Error('pick() on empty array');
  return item;
}

/**
 * Level 1 "Casual" (ARQUITECTURA §5.6): uniform random over legal moves,
 * with a single exception — when a capture is available it takes one with
 * probability 0.5. That miss rate is what keeps the bot beatable.
 */
export function easyMove(moves: MoveDescriptor[], rand: () => number): MoveDescriptor | null {
  if (moves.length === 0) return null;
  const captures = moves.filter((m) => m.captures.length > 0);
  if (captures.length > 0 && rand() < 0.5) return pick(captures, rand);
  return pick(moves, rand);
}
