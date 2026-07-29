"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  METRIC_META,
  metricSchema,
  type Metric,
  type TrendPoint,
  type TrendRange,
} from "@/lib/domain/entry";
import { buildTrendSeries, rangeBounds, toIsoDate } from "@/lib/domain/trend";
import { useRepository } from "@/lib/repository/provider";
import { TrendChart, type TrendStatus } from "@/components/trend-chart";
import { useTrendChartCopy } from "@/i18n/trend-copy";

interface LoadedTrend {
  /** Which request produced this data — the basis for deriving status. */
  key: string;
  data: TrendPoint[];
  goal: { value: number } | null;
  hasAnyData: boolean;
}

const TITLE_KEY: Record<Metric, string> = {
  distanceKm: "distance",
  durationMin: "duration",
  sessions: "sessions",
};

export function TrendPanel() {
  const { repository, status: storageStatus } = useRepository();
  const t = useTranslations("chart");
  const tMetric = useTranslations("metric");
  const tDashboard = useTranslations("dashboard");
  const copy = useTrendChartCopy();

  const [range, setRange] = useState<TrendRange>("30d");
  const [metric, setMetric] = useState<Metric>("distanceKm");
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<LoadedTrend | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);

  const requestKey = `${range}|${metric}|${attempt}`;

  useEffect(() => {
    if (!repository) return;
    let cancelled = false;

    (async () => {
      try {
        const today = toIsoDate(new Date());
        const [entries, goal] = await Promise.all([
          repository.listEntries(rangeBounds(today, range)),
          repository.getGoal(metric),
        ]);
        if (cancelled) return;

        // Only pay for "is there anything at all?" when the answer changes what
        // we render — i.e. when this range came back empty.
        let hasAnyData = true;
        if (entries.length === 0) {
          const all = await repository.listEntries({ from: "0001-01-01", to: today });
          if (cancelled) return;
          hasAnyData = all.length > 0;
        }

        setLoaded({
          key: requestKey,
          data: hasAnyData || entries.length > 0
            ? buildTrendSeries(entries, metric, range, today)
            : [],
          goal: goal ? { value: goal.target } : null,
          hasAnyData,
        });
      } catch {
        if (!cancelled) setFailedKey(requestKey);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [repository, range, metric, requestKey]);

  /**
   * Status is derived, not stored.
   *
   * Setting `loading` synchronously at the top of the effect would trigger a
   * cascading render, and would mean two sources of truth for one fact.
   * Comparing the in-flight request key against the loaded one gives the same
   * answer — and makes "keep the previous frame while refetching" fall out for
   * free, because `loaded.data` simply stays mounted until the new data lands.
   */
  const status: TrendStatus =
    failedKey === requestKey
      ? "error"
      : storageStatus !== "opening" && loaded?.key === requestKey
        ? "ready"
        : "loading";

  const retry = useCallback(() => {
    setFailedKey(null);
    setAttempt((n) => n + 1);
  }, []);

  const meta = METRIC_META[metric];
  const titleKey = TITLE_KEY[metric];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <label htmlFor="metric" className="text-sm text-ink-2">
          {tDashboard("metricLabel")}
        </label>
        <select
          id="metric"
          value={metric}
          onChange={(event) => setMetric(metricSchema.parse(event.target.value))}
          className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
        >
          {metricSchema.options.map((option) => (
            <option key={option} value={option}>
              {tMetric(option)}
            </option>
          ))}
        </select>
      </div>

      <TrendChart
        title={t(`${titleKey}Title`)}
        description={t(`${titleKey}Description`)}
        // Previous data stays rendered while the next request is in flight.
        data={loaded?.data ?? []}
        unit={meta.unit}
        precision={meta.precision}
        goal={loaded?.goal ?? null}
        range={range}
        onRangeChange={setRange}
        status={status}
        onRetry={retry}
        hasAnyData={loaded?.hasAnyData ?? true}
        copy={copy}
      />
    </div>
  );
}
