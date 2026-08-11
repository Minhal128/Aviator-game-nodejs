/**
 * Period-key helpers (ARQUITECTURA §7.4/§7.6). All resets are UTC by
 * blueprint default: `daily_reset_tz` ships as 'UTC' and v1 does not offer
 * other zones (the setting exists for a future admin knob). Keys:
 *
 *   daily  → '2026-07-02'  (lr_user_missions.period_key, streak dates)
 *   weekly → '2026-W27'    (ISO-8601 week, lr_leaderboard_live.period_key)
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** 'YYYY-MM-DD' of `d` in UTC. */
export function dailyKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** 00:00:00 UTC of the calendar day containing `d`. */
export function utcDayStart(d: Date = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * ISO-8601 week key 'YYYY-Www' (weeks start Monday; week 1 contains the
 * first Thursday — the year prefix follows the ISO week-numbering year).
 */
export function weeklyKey(d: Date = new Date()): string {
  // Shift to the Thursday of this week: its calendar year IS the ISO year.
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = t.getUTCDay() || 7; // Mon=1 … Sun=7
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const isoYear = t.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/** Weekly key of the week BEFORE the one containing `d` (snapshot target). */
export function previousWeeklyKey(d: Date = new Date()): string {
  return weeklyKey(new Date(d.getTime() - 7 * DAY_MS));
}

/** Whole UTC calendar days between two 'YYYY-MM-DD' keys (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}
