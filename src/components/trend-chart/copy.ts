import type { TrendChartCopy } from "./trend-chart";

/**
 * The chart takes its strings as a prop rather than reaching for a translation
 * hook. Two reasons, both structural:
 *
 * 1. It keeps the component renderable in Storybook and Vitest with no i18n
 *    provider wrapped around it — isolation stays real.
 * 2. It puts the locale decision at the app boundary (#6/#24), where it
 *    belongs, instead of scattering `useTranslations` through leaf components.
 *
 * This object is the English default and the shape the message catalogue must
 * satisfy. When next-intl lands, the app maps messages into this same object.
 */
export const defaultTrendCopy: TrendChartCopy = {
  rangeGroupLabel: "Time range",
  rangeOptions: { "7d": "7 days", "30d": "30 days", "90d": "90 days" },

  emptyNoDataTitle: "No sessions logged yet",
  emptyNoDataBody:
    "Log your first session and your trend will start building here.",

  emptyInRangeTitle: "Nothing in this range",
  emptyInRangeBody:
    "You have sessions logged, just none in this window. Try a longer range.",

  errorTitle: "Couldn't load your trend",
  errorBody: "Your data is safe — this is a display problem, not a lost session.",
  retry: "Try again",
  loading: "Loading your trend",

  tableCaption: "session data as a table",
  columnDate: "Date",
  columnValue: "Total",

  goalLabel: (target) => `Goal ${target}`,

  summary: ({ total, average, goal, points }) =>
    [
      `${points} days shown.`,
      `Total ${total}, averaging ${average} per day.`,
      goal ? `Goal is ${goal} per day.` : null,
    ]
      .filter(Boolean)
      .join(" "),
};
