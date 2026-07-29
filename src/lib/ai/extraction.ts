import { z } from "zod";
import { isoDateSchema, type IsoDate } from "@/lib/domain/entry";

/**
 * The contract both extractors answer to.
 *
 * There are two implementations — a deterministic local parser (#20) and the
 * Anthropic Messages API (#21) — and the fallback is only worth having if it
 * produces the *same shape* as the thing it replaces. This schema is what makes
 * that true rather than hoped for: both are validated against it, so the
 * fallback path can't quietly drift into returning something the UI can't render
 * and only find out during an incident.
 */

/** Fields the extractor worked out rather than read. */
export const inferredFieldSchema = z.enum(["date", "durationMin", "distanceKm"]);
export type InferredField = z.infer<typeof inferredFieldSchema>;

export const extractedEntrySchema = z.object({
  activity: z.string().min(1).max(80),
  date: isoDateSchema,
  durationMin: z.number().int().positive().max(24 * 60),
  distanceKm: z.number().positive().max(1000).optional(),
  /**
   * Surfaced so the UI never presents a guess as a measurement.
   *
   * "ran 5k" states a distance and no duration. Something has to fill
   * `durationMin`, but a number derived from an assumed pace is not the same
   * kind of fact as one the user typed, and showing them identically would be a
   * small lie that compounds — it lands in the chart as though it were measured.
   */
  inferred: z.array(inferredFieldSchema).default([]),
});
export type ExtractedEntry = z.infer<typeof extractedEntrySchema>;

export const extractionSchema = z.object({
  entries: z.array(extractedEntrySchema).max(20),
  /**
   * Prose acknowledgement of what was understood — the thing the user watches
   * while the model streams (ADR-0003).
   *
   * Optional because only the model writes it. The mock deliberately does not:
   * it would be hardcoded English in an app that ships EN/ES, and a fallback
   * that silently switches the user's language is a worse failure than no
   * sentence at all. When it's absent the UI composes one from `entries` using
   * the message catalogue, which is localised by construction.
   */
  summary: z.string().min(1).max(400).optional(),
});
export type Extraction = z.infer<typeof extractionSchema>;

/** Where an extraction came from. Drives the "parsed locally" label in the UI. */
export type ExtractionSource = "ai" | "ai-fallback";

export interface ExtractionResult extends Extraction {
  source: ExtractionSource;
}

export interface ExtractOptions {
  /** Injected rather than read from the clock, so results are reproducible. */
  today: IsoDate;
}

export type Extractor = (
  text: string,
  options: ExtractOptions,
) => Extraction | Promise<Extraction>;

/** Longest free-text input we will attempt to parse or send upstream (ADR-0003). */
export const MAX_INPUT_LENGTH = 2000;
