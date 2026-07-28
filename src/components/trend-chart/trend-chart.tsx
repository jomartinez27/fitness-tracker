"use client";

import { useId, useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Label,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TrendPoint, TrendRange } from "@/lib/domain/entry";
import { RangeSelector } from "./range-selector";
import {
  formatAxisDate,
  formatFullDate,
  formatValue,
  niceAxis,
  tickInterval,
} from "./format";
import styles from "./trend-chart.module.css";

export type TrendStatus = "loading" | "error" | "ready";

export interface TrendChartCopy {
  rangeGroupLabel: string;
  rangeOptions: Record<TrendRange, string>;
  emptyNoDataTitle: string;
  emptyNoDataBody: string;
  emptyInRangeTitle: string;
  emptyInRangeBody: string;
  errorTitle: string;
  errorBody: string;
  retry: string;
  loading: string;
  tableCaption: string;
  columnDate: string;
  columnValue: string;
  goalLabel: (formattedTarget: string) => string;
  summary: (parts: {
    total: string;
    average: string;
    goal: string | null;
    points: number;
  }) => string;
}

export interface TrendChartProps {
  title: string;
  description?: string;
  data: TrendPoint[];
  unit: string;
  precision?: number;
  goal?: { value: number } | null;
  range: TrendRange;
  onRangeChange: (range: TrendRange) => void;
  status: TrendStatus;
  onRetry?: () => void;
  /**
   * Distinguishes "you haven't logged anything yet" from "nothing in this
   * range". Different situations, different copy, different next action —
   * conflating them is the most common version of this bug.
   */
  hasAnyData?: boolean;
  locale?: string;
  copy: TrendChartCopy;
}

/**
 * The trend chart.
 *
 * Deliberately inert: it takes data, a goal, a range, and an explicit `status`,
 * and fetches nothing. That is what makes empty/loading/error reachable in a
 * story and a test — they are props here, not consequences of a network call.
 *
 * No Recharts type appears in this file's public surface (ADR-0002), so
 * replacing the renderer touches this file and no consumer.
 */
export function TrendChart({
  title,
  description,
  data,
  unit,
  precision = 1,
  goal,
  range,
  onRangeChange,
  status,
  onRetry,
  hasAnyData = true,
  locale = "en-US",
  copy,
}: TrendChartProps) {
  const titleId = useId();
  const hasData = data.length > 0;

  const stats = useMemo(() => {
    if (!hasData) return null;
    const total = data.reduce((sum, point) => sum + point.value, 0);
    return {
      total,
      average: total / data.length,
      max: data.reduce((m, p) => Math.max(m, p.value), 0),
      last: data[data.length - 1],
    };
  }, [data, hasData]);

  // Headroom so the end label and the goal line are never flush against the
  // frame, on a scale whose ticks a human would have chosen.
  const axis = useMemo(
    () => niceAxis(stats?.max ?? 0, goal?.value),
    [stats, goal],
  );

  const format = (value: number) => formatValue(value, unit, precision, locale);

  const summary = stats
    ? copy.summary({
        total: format(stats.total),
        average: format(stats.average),
        goal: goal ? format(goal.value) : null,
        points: data.length,
      })
    : null;

  // A skeleton is for a first load. On refetch we keep the previous frame and
  // dim it, so changing range never collapses the layout.
  const showSkeleton = status === "loading" && !hasData;
  const isRefetching = status === "loading" && hasData;
  const showEmpty = status === "ready" && !hasData;
  const showError = status === "error";
  const showPlot = hasData && !showError;

  return (
    <section className={styles.root} aria-labelledby={titleId}>
      <header className={styles.header}>
        <div className={styles.heading}>
          {/* A single series needs no legend box; the title says what is plotted. */}
          <h3 id={titleId} className={styles.title}>
            {title}
          </h3>
          {description ? <p className={styles.description}>{description}</p> : null}
          {goal ? (
            <p className={styles.goalKey}>
              {/* A line key mirrors the mark it names; the text carries the meaning. */}
              <span className={styles.goalKeyMark} aria-hidden="true" />
              {copy.goalLabel(format(goal.value))}
            </p>
          ) : null}
        </div>
        <RangeSelector
          value={range}
          onChange={onRangeChange}
          label={copy.rangeGroupLabel}
          optionLabels={copy.rangeOptions}
          disabled={showError}
        />
      </header>

      <div className={styles.plot}>
        {showPlot ? (
          // The SVG is decorative to assistive tech; the table below is the content.
          <div
            aria-hidden="true"
            className={isRefetching ? styles.refetching : undefined}
            style={{ width: "100%", height: "100%" }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={data}
                margin={{ top: 16, right: 56, bottom: 4, left: 4 }}
                // Recharts 3 adds its own keyboard layer (tabindex on the SVG).
                // We already expose a richer accessible surface via the table,
                // and a focusable element inside an aria-hidden subtree is an
                // outright violation — so opt out rather than have two.
                accessibilityLayer={false}
                tabIndex={-1}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  interval={tickInterval(data.length)}
                  tickFormatter={(value: string) => formatAxisDate(value, locale)}
                  minTickGap={8}
                />
                <YAxis
                  width={40}
                  tickLine={false}
                  axisLine={false}
                  domain={[0, axis.max]}
                  ticks={axis.ticks}
                  tickFormatter={(value: number) =>
                    new Intl.NumberFormat(locale, {
                      maximumFractionDigits: precision,
                    }).format(value)
                  }
                />

                {/*
                  The goal line carries no in-plot label. At narrow widths the
                  data crosses wherever the label would sit, and a value written
                  over the series is worse than no value at all. It is named in
                  the header key instead — the documented fallback when a direct
                  label would collide.
                */}
                {goal ? (
                  <ReferenceLine y={goal.value} ifOverflow="extendDomain" />
                ) : null}

                {/*
                  Linear, not monotone. A smoothed curve through sparse daily
                  totals invents values that were never measured — it rounds a
                  rest day into a gentle slope and turns a single hard session
                  into a bell. The data is daily and spiky; the line should say so.
                */}
                <Area
                  type="linear"
                  dataKey="value"
                  dot={false}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />

                {/* Lines get their value at the end — one label, not ninety. */}
                {stats ? (
                  <ReferenceDot
                    x={stats.last.date}
                    y={stats.last.value}
                    r={4}
                    ifOverflow="extendDomain"
                  >
                    <Label
                      value={format(stats.last.value)}
                      position="right"
                      offset={8}
                      className={styles.endLabel}
                    />
                  </ReferenceDot>
                ) : null}

                <Tooltip
                  cursor={{ className: styles.crosshair, strokeWidth: 1 }}
                  isAnimationActive={false}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const value = payload[0].value as number;
                    return (
                      <div className={styles.tooltip}>
                        <p className={styles.tooltipDate}>
                          {formatFullDate(String(label), locale)}
                        </p>
                        <div className={styles.tooltipRow}>
                          {/* Line key, not a filled box. */}
                          <span className={styles.tooltipKey} />
                          {/* Value leads; the label follows. */}
                          <span className={styles.tooltipValue}>{format(value)}</span>
                          <span className={styles.tooltipLabel}>{title}</span>
                        </div>
                      </div>
                    );
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : null}

        {showSkeleton ? (
          <div className={styles.skeleton} aria-hidden="true" />
        ) : null}

        {showEmpty ? (
          <div className={styles.panel}>
            <p className={styles.panelTitle}>
              {hasAnyData ? copy.emptyInRangeTitle : copy.emptyNoDataTitle}
            </p>
            <p className={styles.panelBody}>
              {hasAnyData ? copy.emptyInRangeBody : copy.emptyNoDataBody}
            </p>
          </div>
        ) : null}

        {showError ? (
          <div className={styles.panel} role="alert">
            <p className={styles.panelTitle}>{copy.errorTitle}</p>
            <p className={styles.panelBody}>{copy.errorBody}</p>
            {onRetry ? (
              <button type="button" className={styles.retryButton} onClick={onRetry}>
                {copy.retry}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/*
        Everything the chart shows, reachable without hovering: the tooltip
        enhances, it never gates. This is also what the Vitest suite asserts
        against — jsdom computes no SVG geometry, so testing the paths would be
        testing a fiction.
      */}
      <div className={styles.visuallyHidden}>
        <div aria-live="polite">
          {showSkeleton ? copy.loading : null}
          {summary && !showError ? summary : null}
        </div>

        {showPlot ? (
          <table>
            <caption>{`${title} — ${copy.tableCaption}`}</caption>
            <thead>
              <tr>
                <th scope="col">{copy.columnDate}</th>
                <th scope="col">{copy.columnValue}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((point) => (
                <tr key={point.date}>
                  <th scope="row">{formatFullDate(point.date, locale)}</th>
                  <td>{format(point.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </section>
  );
}
