"use client";

import { useRef } from "react";
import { TREND_RANGES, type TrendRange } from "@/lib/domain/entry";
import styles from "./trend-chart.module.css";

export interface RangeSelectorProps {
  value: TrendRange;
  onChange: (range: TrendRange) => void;
  /** Accessible name for the group, e.g. "Time range". */
  label: string;
  optionLabels: Record<TrendRange, string>;
  disabled?: boolean;
}

/**
 * A real `radiogroup` with roving tabindex — not three buttons with a highlight.
 *
 * The distinction is not pedantry. With a radiogroup a screen-reader user hears
 * "Time range, 30 days, radio button, 2 of 3"; with three buttons they hear
 * three unrelated buttons and have to infer that picking one unpicks the others.
 * Roving tabindex also means the group is one Tab stop rather than three, which
 * is what keyboard users expect of a segmented control.
 */
export function RangeSelector({
  value,
  onChange,
  label,
  optionLabels,
  disabled = false,
}: RangeSelectorProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function focusIndex(index: number) {
    const next = TREND_RANGES[index];
    refs.current[index]?.focus();
    onChange(next);
  }

  function handleKeyDown(event: React.KeyboardEvent, index: number) {
    const last = TREND_RANGES.length - 1;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        focusIndex(index === last ? 0 : index + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        focusIndex(index === 0 ? last : index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusIndex(0);
        break;
      case "End":
        event.preventDefault();
        focusIndex(last);
        break;
    }
  }

  return (
    <div role="radiogroup" aria-label={label} className={styles.rangeGroup}>
      {TREND_RANGES.map((range, index) => {
        const checked = range === value;
        return (
          <button
            key={range}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            // Roving tabindex: the group is a single Tab stop.
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            className={styles.rangeOption}
            onClick={() => onChange(range)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {optionLabels[range]}
          </button>
        );
      })}
    </div>
  );
}
