/**
 * Fractional ordering for Kanban cards: a dropped card gets a position between
 * its new neighbours, so a move is a single-row UPDATE.
 */
export const STEP = 1024;

export function positionBetween(before: number | null, after: number | null): number {
  if (before == null && after == null) return STEP;
  if (before == null) return (after as number) - STEP;
  if (after == null) return before + STEP;
  return (before + after) / 2;
}

/** True when neighbours are so close that a midpoint would lose precision. */
export function needsRebalance(before: number | null, after: number | null): boolean {
  if (before == null || after == null) return false;
  return Math.abs(after - before) < 1e-6;
}

/** Evenly re-spaced positions for a column, preserving order. */
export function rebalance(count: number): number[] {
  return Array.from({ length: count }, (_, i) => (i + 1) * STEP);
}
