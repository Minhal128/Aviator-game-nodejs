/**
 * Number formatting per STYLE-GUIDE §7: full below 1,000; locale thousands
 * separator to 9,999; compact with trimmed trailing zeros from 10,000 up
 * (12.5K · 4.95M · 1.2B). Used by the HUD counters and every reward label.
 */
export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs < 1000) return String(n);
  if (abs < 10000) return n.toLocaleString();
  const units: ReadonlyArray<{ v: number; s: string }> = [
    { v: 1e9, s: 'B' },
    { v: 1e6, s: 'M' },
    { v: 1e3, s: 'K' },
  ];
  for (const u of units) {
    if (abs >= u.v) {
      const x = n / u.v;
      const rounded =
        Math.abs(x) >= 100
          ? Math.round(x)
          : Math.abs(x) >= 10
            ? Math.round(x * 10) / 10
            : Math.round(x * 100) / 100;
      return `${rounded}${u.s}`;
    }
  }
  return String(n);
}

/** Full locale-aware number (confirm dialogs, reward rows). */
export function formatFull(n: number): string {
  return n.toLocaleString();
}
