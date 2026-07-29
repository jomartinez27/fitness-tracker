import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { isoDateSchema, type IsoDate } from "@/lib/domain/entry";
import {
  extractedEntrySchema,
  inferredFieldSchema,
  type ExtractedEntry,
} from "./extraction";
import type { ExtractEvent } from "./protocol";

/**
 * The model half of the extraction (ADR-0003).
 *
 * The two channels are implemented with **tool use**, which is what makes the
 * design work rather than merely describe it: the model writes its
 * acknowledgement as ordinary text — streamable a token at a time — and returns
 * the structured sessions as a `tool_use` block whose input we read once, whole,
 * at the end. Asking for schema-constrained JSON as the *response* would have
 * meant either withholding output until it was complete or rendering fragments
 * of syntax, which is exactly the tension risk R2 named.
 */

const TOOL_NAME = "record_sessions";
const MAX_ENTRIES = 20;

export const DEFAULT_MODEL = "claude-opus-5";

/**
 * Deliberately plain: `strict: true` rejects the constraint keywords (string
 * lengths, array bounds) that this project's zod schema uses, so bounds are
 * enforced on the way out instead of being declared twice and enforced once.
 */
const RECORD_SESSIONS_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description:
    "Record the training sessions described by the user. Call exactly once, " +
    "including when the text describes no training at all.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      entries: {
        type: "array",
        items: {
          type: "object",
          properties: {
            activity: {
              type: "string",
              description: "Short name, e.g. Run, Yoga, Cycling, Strength.",
            },
            date: { type: "string", description: "YYYY-MM-DD." },
            durationMin: {
              type: "integer",
              description: "Whole minutes. Always required.",
            },
            distanceKm: {
              type: ["number", "null"],
              description:
                "Kilometres, or null for activities without a distance.",
            },
            inferred: {
              type: "array",
              items: {
                type: "string",
                enum: ["date", "durationMin", "distanceKm"],
              },
              description:
                "Only fields you worked out rather than read from the text.",
            },
          },
          required: ["activity", "date", "durationMin", "distanceKm", "inferred"],
          additionalProperties: false,
        },
      },
    },
    required: ["entries"],
    additionalProperties: false,
  },
};

function systemPrompt(today: IsoDate): string {
  return [
    "You turn a person's free-text description of their training into structured sessions.",
    "",
    `Today is ${today}. Resolve relative dates against it: "yesterday" is the day before,`,
    "and a bare weekday means the most recent one on or before today. Never produce a",
    "date in the future.",
    "",
    "First write ONE short sentence saying what you understood — plain prose, no lists,",
    `no markdown, no preamble. Then call ${TOOL_NAME}.`,
    "",
    "Rules:",
    "- One entry per session. Never invent a session the text does not describe.",
    "- If the text describes no training, call the tool with an empty entries array.",
    "- durationMin is always required. When the text gives no duration, estimate one",
    "  from the distance at a typical pace and add \"durationMin\" to inferred.",
    "- When the text gives no date, use today and add \"date\" to inferred.",
    "- inferred lists ONLY fields you worked out. A field the user stated must never",
    "  appear in it — that distinction is shown to the user, so it has to be accurate.",
    "- Convert miles to kilometres.",
  ].join("\n");
}

/** Lenient on the way in: the model may send null where we want absent. */
const toolEntrySchema = z.object({
  activity: z.string().min(1).max(80),
  date: isoDateSchema,
  durationMin: z.number().int().positive().max(24 * 60),
  distanceKm: z.number().positive().max(1000).nullish(),
  inferred: z.array(inferredFieldSchema).nullish(),
});

const toolInputSchema = z.object({ entries: z.array(z.unknown()) });

export class ExtractionUnavailableError extends Error {}

function toEntries(rawInput: unknown, today: IsoDate): ExtractedEntry[] {
  const parsed = toolInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new ExtractionUnavailableError("tool input malformed");

  const valid: ExtractedEntry[] = [];
  for (const raw of parsed.data.entries.slice(0, MAX_ENTRIES)) {
    const entry = toolEntrySchema.safeParse(raw);
    // A single malformed session is dropped rather than discarding the whole
    // extraction — three good sessions and one bad one should yield three.
    if (!entry.success) continue;
    // The prompt forbids future dates; enforce it rather than trust it.
    if (entry.data.date > today) continue;

    const candidate = extractedEntrySchema.safeParse({
      activity: entry.data.activity,
      date: entry.data.date,
      durationMin: entry.data.durationMin,
      ...(entry.data.distanceKm != null ? { distanceKm: entry.data.distanceKm } : {}),
      inferred: entry.data.inferred ?? [],
    });
    if (candidate.success) valid.push(candidate.data);
  }

  // Everything failing is a different situation from an honest empty result:
  // the model answered, but not in a shape we can use. Fall back rather than
  // tell the user they logged nothing.
  if (valid.length === 0 && parsed.data.entries.length > 0) {
    throw new ExtractionUnavailableError("no entry survived validation");
  }
  return valid;
}

export interface AnthropicExtractOptions {
  today: IsoDate;
  signal?: AbortSignal;
  model?: string;
  maxTokens?: number;
}

/**
 * Models observed to reject `effort`, remembered for the life of the process.
 *
 * `ANTHROPIC_MODEL` is meant to be a real deployment lever — the way to trade
 * capability for latency and cost without a code change. It wasn't: the request
 * always sent `output_config.effort`, and models that don't support it (Haiku
 * 4.5 among them) fail the whole call with a 400. Every request would have
 * silently fallen back to the local extractor while still being billed as an
 * Opus deployment.
 *
 * Learning it from the API beats hardcoding a capability list, which would be
 * wrong again the next time the model lineup moves.
 */
const modelsRejectingEffort = new Set<string>();

function isUnsupportedEffortError(error: unknown): boolean {
  return (
    error instanceof Anthropic.APIError &&
    error.status === 400 &&
    /effort/i.test(String(error.message))
  );
}

export async function* streamAnthropicExtraction(
  text: string,
  { today, signal, model, maxTokens = 1500 }: AnthropicExtractOptions,
): AsyncGenerator<ExtractEvent, void> {
  // The API rejects empty user content with a 400, so blank input would surface
  // as an upstream failure and quietly fall back — paying a round trip to learn
  // what we already know. The route rejects empty text before reaching here;
  // this keeps the extractor honest when called directly, and keeps it and the
  // mock answering the same contract.
  if (!text.trim()) {
    yield { type: "entries", entries: [], source: "ai" };
    return;
  }

  // Constructed per request rather than at module scope so a missing key is a
  // request-time failure the fallback absorbs, not a boot-time crash.
  const client = new Anthropic();
  const resolvedModel = model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;

  let streamed = false;

  async function* attempt(withEffort: boolean): AsyncGenerator<ExtractEvent, void> {
    const stream = client.messages.stream(
      {
        model: resolvedModel,
        max_tokens: maxTokens,
        system: systemPrompt(today),
        tools: [RECORD_SESSIONS_TOOL],
        messages: [{ role: "user", content: text }],
        // Extraction is a shallow task on a user-facing latency path, so
        // thinking is kept brief. It is not switched off: disabling thinking on
        // this model tier is the documented cause of tool calls being written
        // as plain prose, and this route depends entirely on the tool being
        // called — the failure mode would be a silent zero entries every time.
        ...(withEffort ? { output_config: { effort: "low" as const } } : {}),
      },
      { signal },
    );

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        streamed = true;
        yield { type: "summary_delta", text: event.delta.text };
      }
    }

    const message = await stream.finalMessage();

    const toolUse = message.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === TOOL_NAME,
    );
    if (!toolUse) {
      throw new ExtractionUnavailableError("model did not call the tool");
    }

    // The summary is not repeated here — the client already has it, accumulated
    // from the `summary_delta` events it rendered as they arrived.
    yield {
      type: "entries",
      entries: toEntries(toolUse.input, today),
      source: "ai",
    };
  }

  try {
    yield* attempt(!modelsRejectingEffort.has(resolvedModel));
  } catch (error) {
    // The rejection arrives with the initial response, before any token is
    // streamed, so retrying cannot duplicate prose the user already saw. The
    // `streamed` guard makes that a checked assumption rather than a hoped-for
    // one.
    if (streamed || !isUnsupportedEffortError(error)) throw error;
    modelsRejectingEffort.add(resolvedModel);
    yield* attempt(false);
  }
}
