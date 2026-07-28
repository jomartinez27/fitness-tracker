import type { Entry, IsoDate, Metric, TrendPoint, TrendRange } from "./entry";
import { RANGE_DAYS } from "./entry";

export function toIsoDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

/** Inclusive range covering `range` days and ending on `today`. */
export function rangeBounds(today: IsoDate, range: TrendRange) {
  return { from: addDays(today, -(RANGE_DAYS[range] - 1)), to: today };
}

function valueOf(entry: Entry, metric: Metric): number {
  switch (metric) {
    case "distanceKm":
      return entry.distanceKm ?? 0;
    case "durationMin":
      return entry.durationMin;
    case "sessions":
      return 1;
  }
}

/**
 * Entries → a dense daily series.
 *
 * Every day in the range gets a point, including days with no entries, which
 * are `0` rather than absent. This matters: a rest day is a real zero, and
 * dropping it would let the line connect Monday straight to Wednesday and
 * quietly overstate the trend. A gap in a time series is a claim that no
 * measurement exists — here one does, and it is zero.
 */
export function buildTrendSeries(
  entries: Entry[],
  metric: Metric,
  range: TrendRange,
  today: IsoDate,
): TrendPoint[] {
  const totals = new Map<IsoDate, number>();
  for (const entry of entries) {
    totals.set(entry.date, (totals.get(entry.date) ?? 0) + valueOf(entry, metric));
  }

  const days = RANGE_DAYS[range];
  const { from } = rangeBounds(today, range);

  return Array.from({ length: days }, (_, i) => {
    const date = addDays(from, i);
    return { date, value: totals.get(date) ?? 0 };
  });
}
