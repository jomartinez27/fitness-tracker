import type { IsoDate } from "@/lib/domain/entry";
import { extractionSchema, type Extraction } from "./extraction";

/**
 * The behavioural contract every extractor must satisfy — the deterministic one
 * (#20) and the model (#21) alike.
 *
 * Expectations are stated as tolerances and patterns rather than exact values,
 * because the model is not deterministic and a contract it cannot pass is a
 * contract nobody will keep. What is pinned is the part that actually matters:
 * the right *number* of sessions, the right activities, the right dates, and
 * distances close enough to be the same fact.
 *
 * Deliberately free of any test framework, so this file is shared rather than
 * duplicated, and so importing it never drags vitest into a bundle.
 */

export interface FixtureExpectation {
  entryCount?: { min?: number; max?: number };
  /** Each pattern must match at least one extracted activity. */
  activities?: RegExp[];
  /** Every entry's date must be one of these. */
  allowedDates?: IsoDate[];
  approxDistanceKm?: { activity: RegExp; value: number; tolerance: number };
  approxDurationMin?: { activity: RegExp; value: number; tolerance: number };
}

export interface ExtractionFixture {
  name: string;
  input: string;
  today: IsoDate;
  expect: FixtureExpectation;
}

const TODAY: IsoDate = "2026-07-28"; // a Tuesday
const YESTERDAY: IsoDate = "2026-07-27";

export const EXTRACTION_FIXTURES: ExtractionFixture[] = [
  {
    name: "the canonical example: two sessions in one sentence",
    input: "ran 5k, 30 min yoga",
    today: TODAY,
    expect: {
      entryCount: { min: 2, max: 2 },
      activities: [/run/i, /yoga/i],
      allowedDates: [TODAY],
      approxDistanceKm: { activity: /run/i, value: 5, tolerance: 0.2 },
      approxDurationMin: { activity: /yoga/i, value: 30, tolerance: 5 },
    },
  },
  {
    name: "a stated date applies to the whole input",
    input: "yesterday I swam 1km and did 45 minutes of strength work",
    today: TODAY,
    expect: {
      entryCount: { min: 2, max: 2 },
      activities: [/swim|swam/i, /strength|weights|gym/i],
      allowedDates: [YESTERDAY],
    },
  },
  {
    name: "a decimal distance is not mistaken for a list separator",
    input: "easy run 5,2 km",
    today: TODAY,
    expect: {
      entryCount: { min: 1, max: 1 },
      activities: [/run/i],
      approxDistanceKm: { activity: /run/i, value: 5.2, tolerance: 0.15 },
    },
  },
  {
    name: "compound durations",
    input: "cycled 1h30 this morning",
    today: TODAY,
    expect: {
      entryCount: { min: 1, max: 1 },
      activities: [/cycl|bike|ride/i],
      allowedDates: [TODAY],
      approxDurationMin: { activity: /cycl|bike|ride/i, value: 90, tolerance: 5 },
    },
  },
  {
    name: "miles are converted, not stored raw",
    input: "ran 3 miles",
    today: TODAY,
    expect: {
      entryCount: { min: 1, max: 1 },
      activities: [/run/i],
      approxDistanceKm: { activity: /run/i, value: 4.83, tolerance: 0.2 },
    },
  },
  {
    name: "a weekday resolves to the most recent one",
    input: "monday: 40 min row",
    today: TODAY,
    expect: {
      entryCount: { min: 1, max: 1 },
      activities: [/row/i],
      allowedDates: ["2026-07-27"], // the Monday before Tuesday the 28th
    },
  },
  {
    name: "three sessions across separators",
    input: "swim 2km\nyoga 30 min\nran 8k",
    today: TODAY,
    expect: {
      entryCount: { min: 3, max: 3 },
      activities: [/swim|swam/i, /yoga/i, /run/i],
    },
  },
  {
    name: "text with no session in it invents nothing",
    input: "felt pretty tired this week honestly",
    today: TODAY,
    expect: { entryCount: { min: 0, max: 0 } },
  },
  {
    name: "empty input",
    input: "",
    today: TODAY,
    expect: { entryCount: { min: 0, max: 0 } },
  },
];

/**
 * Returns a list of human-readable violations — empty means the extraction
 * satisfies the contract. Returning strings rather than throwing lets a caller
 * report every problem at once instead of only the first.
 */
export function contractViolations(
  fixture: ExtractionFixture,
  extraction: Extraction,
): string[] {
  const problems: string[] = [];

  const parsed = extractionSchema.safeParse(extraction);
  if (!parsed.success) {
    return [`does not satisfy the schema: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`];
  }

  const { entries } = parsed.data;
  const { entryCount, activities, allowedDates, approxDistanceKm, approxDurationMin } =
    fixture.expect;

  if (entryCount?.min !== undefined && entries.length < entryCount.min) {
    problems.push(`expected at least ${entryCount.min} entries, got ${entries.length}`);
  }
  if (entryCount?.max !== undefined && entries.length > entryCount.max) {
    problems.push(`expected at most ${entryCount.max} entries, got ${entries.length}`);
  }

  for (const pattern of activities ?? []) {
    if (!entries.some((entry) => pattern.test(entry.activity))) {
      problems.push(
        `no entry matched activity ${pattern} (got: ${entries.map((e) => e.activity).join(", ") || "none"})`,
      );
    }
  }

  if (allowedDates) {
    for (const entry of entries) {
      if (!allowedDates.includes(entry.date)) {
        problems.push(
          `${entry.activity} dated ${entry.date}, expected one of ${allowedDates.join(", ")}`,
        );
      }
    }
  }

  if (approxDistanceKm) {
    const entry = entries.find((e) => approxDistanceKm.activity.test(e.activity));
    if (!entry) {
      problems.push(`no entry matching ${approxDistanceKm.activity} to check distance`);
    } else if (
      entry.distanceKm === undefined ||
      Math.abs(entry.distanceKm - approxDistanceKm.value) > approxDistanceKm.tolerance
    ) {
      problems.push(
        `${entry.activity} distance ${entry.distanceKm ?? "missing"}, expected ~${approxDistanceKm.value}`,
      );
    }
  }

  if (approxDurationMin) {
    const entry = entries.find((e) => approxDurationMin.activity.test(e.activity));
    if (!entry) {
      problems.push(`no entry matching ${approxDurationMin.activity} to check duration`);
    } else if (
      Math.abs(entry.durationMin - approxDurationMin.value) > approxDurationMin.tolerance
    ) {
      problems.push(
        `${entry.activity} duration ${entry.durationMin}, expected ~${approxDurationMin.value}`,
      );
    }
  }

  return problems;
}
