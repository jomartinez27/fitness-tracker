import type { IsoDate } from "@/lib/domain/entry";
import { addDays } from "@/lib/domain/trend";
import {
  extractionSchema,
  type Extraction,
  type ExtractedEntry,
  type ExtractOptions,
  type InferredField,
} from "./extraction";

/**
 * The deterministic extractor.
 *
 * Not a stub. This is the answer whenever the AI feature is flagged off, the
 * rate limit trips, the upstream call fails, or the timeout fires — so the UI
 * degrades to "slightly less clever" instead of "broken" (ADR-0003). It is also
 * the fixture the Playwright suite runs against, which is what keeps E2E free
 * and free of model nondeterminism.
 *
 * Built before the real route on purpose: the entire AI interface — states,
 * retry, streaming consumption, tests — can be finished and verified against
 * this, and the fallback branch gets exercised from day one instead of being
 * discovered during an incident.
 */

interface ActivityRule {
  name: string;
  patterns: RegExp;
  /** Minutes per km, for deriving a duration when only a distance is stated. */
  paceMinPerKm?: number;
  /** Fallback when the text gives neither duration nor distance. */
  typicalMin: number;
}

/**
 * Order is significant: `find` takes the first match, so specific rules must
 * precede the generic one at the end. "strength training" has to land on
 * Strength, not on the catch-all "training".
 */
const ACTIVITIES: ActivityRule[] = [
  { name: "Run", patterns: /\b(run|ran|running|jog|jogged|jogging|marathon|parkrun|treadmill)\b/, paceMinPerKm: 5.5, typicalMin: 35 },
  { name: "Cycling", patterns: /\b(cycle|cycled|cycling|bike|biked|biking|ride|rode)\b/, paceMinPerKm: 2.2, typicalMin: 45 },
  { name: "Swim", patterns: /\b(swim|swam|swimming)\b/, paceMinPerKm: 20, typicalMin: 40 },
  { name: "Walk", patterns: /\b(walk|walked|walking|hike|hiked|hiking)\b/, paceMinPerKm: 11, typicalMin: 40 },
  { name: "Row", patterns: /\b(row|rowed|rowing|erg)\b/, paceMinPerKm: 4.5, typicalMin: 30 },
  { name: "Yoga", patterns: /\b(yoga|vinyasa)\b/, typicalMin: 45 },
  { name: "Pilates", patterns: /\b(pilates)\b/, typicalMin: 45 },
  { name: "Strength", patterns: /\b(strength|lift|lifted|lifting|weights|gym|squats|deadlifts)\b/, typicalMin: 45 },
  { name: "HIIT", patterns: /\b(hiit|intervals?|circuits?)\b/, typicalMin: 30 },
  { name: "Climbing", patterns: /\b(climb|climbed|climbing|bouldering)\b/, typicalMin: 60 },
  // Generic, and deliberately last. "45 min workout" is a real thing people
  // write; dropping it entirely is worse than recording a session the user
  // named vaguely themselves. Still not an invention — they said "workout".
  { name: "Workout", patterns: /\b(workout|training|session|exercise|class)\b/, typicalMin: 45 },
];

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const toNumber = (raw: string) => Number(raw.replace(",", "."));

/**
 * Splits a comma that separates activities from one that is a decimal point.
 * "ran 5k, 30 min yoga" is two segments; "5,2 km" is one number.
 */
function splitSegments(text: string): string[] {
  return text
    .split(/\n|;|,(?!\s*\d+(?:[.,]\d+)?\s*(?:k|km|m|min))|,(?!\d)|\band\b|\bthen\b|\bplus\b|\+/i)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

// Ordered longest-first: regex alternation is first-match-wins, so `h|hr` would
// consume the "h" of "1 hr 20 min", leave "r 20 min", and silently drop the 20.
//
// `(?![a-z])` rather than `\b` to close a unit. There is no word boundary
// between the "h" and the "3" of "1h30" — both are word characters — so `\b`
// silently fails to match and the session collapses to a flat hour. A
// negative lookahead for a letter allows a digit to follow while still
// refusing to read the "h" of "hill" as hours.
const HOURS = "hours|hour|hrs|hr|h";
const MINUTES = "minutes|minute|mins|min|m";
const END_OF_UNIT = "(?![a-z])";

function parseDuration(segment: string): number | undefined {
  // "1h30", "1 hr 20 min", "2 hours". The trailing minutes group is guarded so
  // "1 hour 5k" reads as sixty minutes plus a distance, not as 1h05.
  const compound = segment.match(
    new RegExp(
      `(\\d+)\\s*(?:${HOURS})${END_OF_UNIT}(?:\\s*(\\d+)\\s*(?:${MINUTES})?${END_OF_UNIT})?`,
      "i",
    ),
  );
  if (compound) {
    const hours = Number(compound[1]);
    const minutes = compound[2] ? Number(compound[2]) : 0;
    return hours * 60 + minutes;
  }

  const minutes = segment.match(
    new RegExp(`(\\d+)\\s*(?:${MINUTES})${END_OF_UNIT}`, "i"),
  );
  if (minutes) return Number(minutes[1]);

  return undefined;
}

const MAX_DISTANCE_KM = 1000;

/**
 * Out-of-range distances are dropped, not clamped.
 *
 * "ran 99999 km" is not a 1000km run — clamping would turn nonsense into a
 * confident, wrong measurement that lands on the chart. Omitting the distance
 * says only what we actually know: there was a run.
 */
function inRange(km: number): number | undefined {
  return Number.isFinite(km) && km > 0 && km <= MAX_DISTANCE_KM ? km : undefined;
}

function parseDistance(segment: string): number | undefined {
  const miles = segment.match(/(\d+(?:[.,]\d+)?)\s*(?:miles|mile|mi)\b/i);
  if (miles) return inRange(Number((toNumber(miles[1]) * 1.609).toFixed(2)));

  // "5 km", "10.5km", "5,2 kilometres"
  const km = segment.match(/(\d+(?:[.,]\d+)?)\s*(?:kilometres|kilometers|kms|km)\b/i);
  if (km) return inRange(toNumber(km[1]));

  // Bare "5k" — but not "5 min" and not a stray "5"
  const shorthand = segment.match(/(\d+(?:[.,]\d+)?)\s*k\b/i);
  if (shorthand) return inRange(toNumber(shorthand[1]));

  return undefined;
}

/** Most recent occurrence of `weekday` on or before `today`. */
function lastWeekday(today: IsoDate, weekday: number): IsoDate {
  const current = new Date(`${today}T00:00:00Z`).getUTCDay();
  const delta = (current - weekday + 7) % 7;
  return addDays(today, -delta);
}

function parseDate(text: string, today: IsoDate): IsoDate | undefined {
  if (/\byesterday\b/i.test(text)) return addDays(today, -1);
  if (/\b(today|this morning|this afternoon|tonight|this evening)\b/i.test(text)) {
    return today;
  }

  const explicit = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (explicit) return explicit[1];

  for (const [index, day] of WEEKDAYS.entries()) {
    if (new RegExp(`\\b(last\\s+)?${day}\\b`, "i").test(text)) {
      const date = lastWeekday(today, index);
      return /\blast\s/i.test(text) ? addDays(date, -7) : date;
    }
  }

  return undefined;
}

function buildEntry(
  segment: string,
  rule: ActivityRule,
  date: IsoDate,
  dateWasStated: boolean,
): ExtractedEntry {
  const inferred: InferredField[] = [];
  if (!dateWasStated) inferred.push("date");

  const distanceKm = parseDistance(segment);
  let durationMin = parseDuration(segment);

  if (durationMin === undefined) {
    // Derive from distance where the activity has a meaningful pace, otherwise
    // fall back to a typical session. Either way it is marked inferred — the
    // user confirms before anything reaches the chart.
    durationMin =
      distanceKm !== undefined && rule.paceMinPerKm
        ? Math.round(distanceKm * rule.paceMinPerKm)
        : rule.typicalMin;
    inferred.push("durationMin");
  }

  return {
    activity: rule.name,
    date,
    durationMin: Math.min(Math.max(durationMin, 1), 24 * 60),
    ...(distanceKm !== undefined && distanceKm > 0 ? { distanceKm } : {}),
    inferred,
  };
}

export function mockExtract(text: string, { today }: ExtractOptions): Extraction {
  const trimmed = text.trim();
  if (!trimmed) return { entries: [] };

  // A date stated anywhere applies to the whole input ("yesterday I ran 5k and
  // did yoga"), unless a segment names its own.
  const globalDate = parseDate(trimmed, today);

  const entries: ExtractedEntry[] = [];

  for (const segment of splitSegments(trimmed)) {
    const rule = ACTIVITIES.find((candidate) => candidate.patterns.test(segment));
    // Unrecognised text is skipped rather than guessed at. Inventing an
    // activity from "felt tired today" would put fiction on the user's chart.
    if (!rule) continue;

    const segmentDate = parseDate(segment, today);
    const date = segmentDate ?? globalDate ?? today;
    const dateWasStated = segmentDate !== undefined || globalDate !== undefined;

    entries.push(buildEntry(segment, rule, date, dateWasStated));
    if (entries.length >= 20) break;
  }

  // Validated on the way out: the fallback is held to exactly the contract the
  // model is, so a bug here surfaces as a schema failure rather than as a
  // malformed entry reaching the UI.
  return extractionSchema.parse({ entries });
}
