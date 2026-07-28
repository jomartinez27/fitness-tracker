import { z } from "zod";

/**
 * The domain model. These schemas are the single contract shared by three
 * consumers that would otherwise drift apart: the entry form (#14), the
 * repository (#4/#5), and — critically — both AI extractors (#20/#21). The
 * mock extractor and the model are held to the same schema, which is what
 * stops the fallback path from silently diverging from the real one.
 */

/** A calendar day, `YYYY-MM-DD`. Deliberately not a Date: entries are dated, not timestamped. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date");

export type IsoDate = z.infer<typeof isoDateSchema>;

/** What a trend chart can plot. Each metric names its own unit and aggregation. */
export const metricSchema = z.enum(["distanceKm", "durationMin", "sessions"]);
export type Metric = z.infer<typeof metricSchema>;

export const METRIC_META: Record<
  Metric,
  { unit: string; messageKey: string; precision: number }
> = {
  distanceKm: { unit: "km", messageKey: "metric.distance", precision: 1 },
  durationMin: { unit: "min", messageKey: "metric.duration", precision: 0 },
  sessions: { unit: "", messageKey: "metric.sessions", precision: 0 },
};

/** Where an entry came from. Surfaced in the UI so AI-derived data is never disguised as hand-entered. */
export const entrySourceSchema = z.enum(["manual", "ai", "ai-fallback"]);
export type EntrySource = z.infer<typeof entrySourceSchema>;

export const entrySchema = z.object({
  id: z.string().min(1),
  date: isoDateSchema,
  activity: z.string().min(1).max(80),
  durationMin: z.number().int().nonnegative().max(24 * 60),
  distanceKm: z.number().nonnegative().max(1000).optional(),
  notes: z.string().max(500).optional(),
  source: entrySourceSchema,
  createdAt: z.number().int().positive(),
});
export type Entry = z.infer<typeof entrySchema>;

/**
 * A draft is every field optional — it is persisted mid-typing, so it is by
 * definition incomplete. This is the type that makes "no data loss on
 * back-navigation" (#15) possible: drafts are storage, not React state.
 */
export const entryDraftSchema = z.object({
  id: z.string().min(1),
  step: z.number().int().min(0),
  date: isoDateSchema.optional(),
  activity: z.string().max(80).optional(),
  durationMin: z.number().int().nonnegative().max(24 * 60).optional(),
  distanceKm: z.number().nonnegative().max(1000).optional(),
  notes: z.string().max(500).optional(),
  updatedAt: z.number().int().positive(),
});
export type EntryDraft = z.infer<typeof entryDraftSchema>;

export const goalSchema = z.object({
  metric: metricSchema,
  /** Target on the same scale as the plotted series — a daily target, not a weekly total. */
  target: z.number().positive(),
});
export type Goal = z.infer<typeof goalSchema>;

/** The ranges the trend chart offers. Ordered shortest-first; the UI relies on that order. */
export const TREND_RANGES = ["7d", "30d", "90d"] as const;
export const trendRangeSchema = z.enum(TREND_RANGES);
export type TrendRange = z.infer<typeof trendRangeSchema>;

export const RANGE_DAYS: Record<TrendRange, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/**
 * One plotted point. The chart speaks this and nothing else — it never sees an
 * `Entry`, which is what lets it be built and tested with no repository present.
 */
export interface TrendPoint {
  date: IsoDate;
  value: number;
}
