import type { DraftValues, Entry, IsoDate } from "@/lib/domain/entry";

/**
 * Per-step validation.
 *
 * Errors are returned as message *keys*, not sentences, so this module stays
 * free of i18n and stays testable without a translation provider — the same
 * seam the chart uses for its copy.
 */

export const STEP_FIELDS = [
  ["activity", "date"],
  ["durationMin", "distanceKm"],
  ["notes"],
] as const satisfies ReadonlyArray<ReadonlyArray<keyof DraftValues>>;

export const STEP_COUNT = STEP_FIELDS.length;

export type FieldName = keyof DraftValues;
export type FieldErrors = Partial<Record<FieldName, string>>;

const MAX_MINUTES = 24 * 60;

function validateField(
  field: FieldName,
  values: DraftValues,
  today: IsoDate,
): string | undefined {
  const raw = values[field].trim();

  switch (field) {
    case "activity":
      if (!raw) return "activityRequired";
      if (raw.length > 80) return "activityTooLong";
      return undefined;

    case "date":
      if (!raw) return "dateRequired";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "dateRequired";
      // Comparing ISO date strings lexicographically is exact and avoids a
      // timezone round-trip, which is where "today" bugs usually come from.
      if (raw > today) return "dateInFuture";
      return undefined;

    case "durationMin": {
      if (!raw) return "durationRequired";
      if (!/^\d+$/.test(raw)) return "durationInvalid";
      const minutes = Number(raw);
      if (minutes <= 0) return "durationInvalid";
      if (minutes > MAX_MINUTES) return "durationTooLong";
      return undefined;
    }

    case "distanceKm": {
      if (!raw) return undefined; // genuinely optional — yoga has no distance
      if (!/^\d+([.,]\d+)?$/.test(raw)) return "distanceInvalid";
      const km = Number(raw.replace(",", "."));
      if (!Number.isFinite(km) || km < 0 || km > 1000) return "distanceInvalid";
      return undefined;
    }

    case "notes":
      if (raw.length > 500) return "notesTooLong";
      return undefined;
  }
}

/** Validates only the fields belonging to `step`. */
export function validateStep(
  step: number,
  values: DraftValues,
  today: IsoDate,
): FieldErrors {
  const errors: FieldErrors = {};
  for (const field of STEP_FIELDS[step] ?? []) {
    const error = validateField(field, values, today);
    if (error) errors[field] = error;
  }
  return errors;
}

/** Validates everything — the gate before a save is allowed. */
export function validateAll(values: DraftValues, today: IsoDate): FieldErrors {
  const errors: FieldErrors = {};
  for (let step = 0; step < STEP_COUNT; step += 1) {
    Object.assign(errors, validateStep(step, values, today));
  }
  return errors;
}

/** Which step owns a given field — used to jump back to the first error. */
export function stepOf(field: FieldName): number {
  return STEP_FIELDS.findIndex((fields) =>
    (fields as readonly FieldName[]).includes(field),
  );
}

/**
 * Converts validated form strings into an `Entry`.
 *
 * Only call this after `validateAll` returns clean — it assumes well-formed
 * input rather than re-checking it, so there is exactly one place where the
 * rules live.
 */
export function toEntry(values: DraftValues): Omit<Entry, "id" | "createdAt"> {
  const distance = values.distanceKm.trim().replace(",", ".");
  const notes = values.notes.trim();

  return {
    date: values.date.trim(),
    activity: values.activity.trim(),
    durationMin: Number(values.durationMin.trim()),
    ...(distance ? { distanceKm: Number(distance) } : {}),
    ...(notes ? { notes } : {}),
    source: "manual",
  };
}
