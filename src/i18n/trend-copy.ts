import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type { TrendChartCopy } from "@/components/trend-chart";

/**
 * Maps the message catalogue onto the chart's `copy` prop.
 *
 * The chart takes its strings as data rather than calling `useTranslations`
 * itself, which is what keeps it renderable in Storybook and Vitest with no
 * provider wrapped around it. This adapter is where the two worlds meet — one
 * file, at the app boundary, instead of a translation hook in every leaf.
 */
export function useTrendChartCopy(): TrendChartCopy {
  const t = useTranslations("chart");

  return useMemo<TrendChartCopy>(
    () => ({
      rangeGroupLabel: t("rangeGroupLabel"),
      rangeOptions: {
        "7d": t("range7d"),
        "30d": t("range30d"),
        "90d": t("range90d"),
      },
      emptyNoDataTitle: t("emptyNoDataTitle"),
      emptyNoDataBody: t("emptyNoDataBody"),
      emptyInRangeTitle: t("emptyInRangeTitle"),
      emptyInRangeBody: t("emptyInRangeBody"),
      errorTitle: t("errorTitle"),
      errorBody: t("errorBody"),
      retry: t("retry"),
      loading: t("loading"),
      tableCaption: t("tableCaption"),
      columnDate: t("columnDate"),
      columnValue: t("columnValue"),
      goalLabel: (target) => t("goal", { target }),
      summary: ({ total, average, goal, points }) =>
        goal
          ? t("summaryWithGoal", { total, average, goal, points })
          : t("summary", { total, average, points }),
    }),
    [t],
  );
}
