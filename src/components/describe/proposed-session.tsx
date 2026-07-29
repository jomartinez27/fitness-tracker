"use client";

import { useId } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { ExtractedEntry, InferredField } from "@/lib/ai/extraction";

/**
 * One proposed session, awaiting confirmation.
 *
 * The `inferred` markers are the reason this component exists rather than the
 * entries going straight to storage. "ran 5k" states a distance and no
 * duration, so something has to fill it — but a number derived from an assumed
 * pace is not the same kind of fact as one the user typed, and showing them
 * identically would put a guess on the chart wearing the clothes of a
 * measurement. The badge says which is which, and the checkbox means nothing is
 * saved that the user hasn't looked at.
 */
export function ProposedSession({
  entry,
  included,
  onToggle,
}: {
  entry: ExtractedEntry;
  included: boolean;
  onToggle: (included: boolean) => void;
}) {
  const t = useTranslations("describe.results");
  const format = useFormatter();
  const id = useId();

  const isInferred = (field: InferredField) => entry.inferred.includes(field);

  const date = format.dateTime(new Date(`${entry.date}T00:00:00Z`), {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

  return (
    <li className="flex items-start gap-3 rounded-md border border-line bg-surface p-3">
      <input
        id={id}
        type="checkbox"
        checked={included}
        onChange={(event) => onToggle(event.target.checked)}
        className="mt-1 size-4 shrink-0"
      />
      <label htmlFor={id} className="flex flex-1 flex-col gap-1">
        <span className="sr-only">{t("include")}</span>

        <span className="text-sm font-semibold">{entry.activity}</span>

        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
          <Fact value={date} inferred={isInferred("date")} label={t("assumedDate")} />
          <Fact
            value={`${entry.durationMin} min`}
            inferred={isInferred("durationMin")}
            label={t("estimated")}
          />
          {entry.distanceKm !== undefined ? (
            <Fact
              value={`${entry.distanceKm} km`}
              inferred={isInferred("distanceKm")}
              label={t("estimated")}
            />
          ) : null}
        </span>

        {/*
          Once per session, not once per badge. A row with both an assumed date
          and an estimated duration otherwise reads the identical sentence twice
          to a screen reader — the badges already differ by their own labels.
        */}
        {entry.inferred.length > 0 ? (
          <span className="sr-only">{t("estimatedExplanation")}</span>
        ) : null}
      </label>
    </li>
  );
}

function Fact({
  value,
  inferred,
  label,
}: {
  value: string;
  inferred: boolean;
  label: string;
}) {
  if (!inferred) return <span>{value}</span>;

  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{value}</span>
      {/*
        The badge carries its meaning as text, not colour — a chip that only
        differed by shade would say nothing to a screen reader, and nothing at
        all in forced-colours mode.
      */}
      <span className="rounded border border-line px-1.5 py-0.5 text-xs text-ink-muted">
        {label}
      </span>
    </span>
  );
}
