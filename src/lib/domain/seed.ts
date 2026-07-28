import type { Entry } from "./entry";
import { addDays } from "./trend";

/**
 * Deterministic demo data.
 *
 * Determinism is the whole point: the same seed produces the same 90 days in
 * Storybook, in Vitest, and in the browser, so stories are stable and tests
 * don't need to stub a random source.
 *
 * The shape matters as much as the values. Real training data has rest days,
 * week-to-week variance, and a trend you can actually see — a smooth synthetic
 * curve reads as fake on sight and undercuts the demo it exists to serve.
 */

/** mulberry32 — small, fast, and good enough for demo data. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ACTIVITIES = [
  { name: "Run", paceMinPerKm: 5.6, distance: [3, 12] as const },
  { name: "Easy run", paceMinPerKm: 6.4, distance: [4, 8] as const },
  { name: "Intervals", paceMinPerKm: 4.9, distance: [5, 9] as const },
  { name: "Cycling", paceMinPerKm: 2.4, distance: [12, 40] as const },
  { name: "Yoga", paceMinPerKm: 0, distance: [0, 0] as const },
  { name: "Strength", paceMinPerKm: 0, distance: [0, 0] as const },
];

export interface SeedOptions {
  /** Last day of the generated window, inclusive. */
  today: string;
  days?: number;
  seed?: number;
}

export function generateSeedEntries({
  today,
  days = 90,
  seed = 20260728,
}: SeedOptions): Entry[] {
  const rand = prng(seed);
  const entries: Entry[] = [];
  const start = addDays(today, -(days - 1));

  for (let i = 0; i < days; i += 1) {
    const date = addDays(start, i);
    const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();

    // Rest days cluster on Mondays and Fridays, plus the occasional missed session.
    const restBias = dayOfWeek === 1 || dayOfWeek === 5 ? 0.55 : 0.18;
    if (rand() < restBias) continue;

    // Sundays are long days; a mild upward trend runs across the window.
    const sessions = dayOfWeek === 0 && rand() < 0.35 ? 2 : 1;
    const progress = 1 + (i / days) * 0.28;

    for (let s = 0; s < sessions; s += 1) {
      const activity = ACTIVITIES[Math.floor(rand() * ACTIVITIES.length)];
      const [lo, hi] = activity.distance;
      const distanceKm =
        hi === 0 ? undefined : Number(((lo + rand() * (hi - lo)) * progress).toFixed(1));
      const durationMin =
        distanceKm === undefined
          ? Math.round(25 + rand() * 40)
          : Math.round(distanceKm * activity.paceMinPerKm * (0.94 + rand() * 0.12));

      entries.push({
        id: `seed_${date}_${s}`,
        date,
        activity: activity.name,
        durationMin,
        distanceKm,
        source: "manual",
        createdAt: Date.parse(`${date}T18:00:00Z`) + s,
      });
    }
  }

  return entries;
}
