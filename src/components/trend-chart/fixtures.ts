import type { Metric, TrendPoint, TrendRange } from "@/lib/domain/entry";
import { TREND_RANGES } from "@/lib/domain/entry";
import { generateSeedEntries } from "@/lib/domain/seed";
import { buildTrendSeries, rangeBounds } from "@/lib/domain/trend";
import { InMemoryRepository } from "@/lib/repository/in-memory";

/**
 * Fixtures for stories and tests.
 *
 * These deliberately go through `InMemoryRepository` rather than hand-writing
 * arrays: the fixtures then exercise the same interface the app will use, so a
 * break in the repository contract shows up in the chart's stories rather than
 * waiting for integration.
 */
export const DEMO_TODAY = "2026-07-28";
export const DEMO_GOAL = { value: 5 };

const repository = new InMemoryRepository({
  entries: generateSeedEntries({ today: DEMO_TODAY }),
  goals: [{ metric: "distanceKm", target: DEMO_GOAL.value }],
});

async function seriesFor(range: TrendRange, metric: Metric): Promise<TrendPoint[]> {
  const entries = await repository.listEntries(rangeBounds(DEMO_TODAY, range));
  return buildTrendSeries(entries, metric, range, DEMO_TODAY);
}

export const demoSeries = Object.fromEntries(
  await Promise.all(
    TREND_RANGES.map(async (range) => [range, await seriesFor(range, "distanceKm")] as const),
  ),
) as Record<TrendRange, TrendPoint[]>;

/** The awkward cases — the reason the chart is built in isolation at all. */
export const edgeCases = {
  /** One day of data: no line to draw, only a point. */
  singlePoint: [{ date: DEMO_TODAY, value: 6.4 }] satisfies TrendPoint[],
  /** A real, valid chart: seven rest days is a flat line at zero, not an empty state. */
  allZero: demoSeries["7d"].map((point) => ({ ...point, value: 0 })),
  /** Goal sits above every value — the reference line must not fall off the top. */
  goalAboveSeries: demoSeries["7d"].map((point, i) => ({ ...point, value: 1 + i * 0.1 })),
  /** Goal sits below every value — headroom must still leave the label readable. */
  goalBelowSeries: demoSeries["7d"].map((point, i) => ({ ...point, value: 30 + i })),
} as const;
