import type { ExtractedEntry, ExtractionSource } from "./extraction";
import { createEventParser, type ExtractEvent } from "./protocol";

/**
 * Client half of the extraction protocol.
 *
 * Yields events as they arrive so the UI can render prose while the model is
 * still writing it — the streaming is the loading affordance, which is why
 * there is no spinner anywhere in this feature.
 */

export type ExtractFailureCode =
  | "rate_limited"
  | "input_too_long"
  | "invalid_input"
  | "network"
  | "unknown";

export class ExtractRequestError extends Error {
  constructor(
    readonly code: ExtractFailureCode,
    /** Present on `rate_limited`, so the UI can say *when* to come back. */
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
  }
}

export async function* streamExtraction(
  text: string,
  signal?: AbortSignal,
): AsyncGenerator<ExtractEvent, void> {
  let response: Response;
  try {
    response = await fetch("/api/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal,
    });
  } catch (error) {
    // An abort is the user changing their mind, not a failure to report.
    if (signal?.aborted) throw error;
    throw new ExtractRequestError("network");
  }

  if (!response.ok) {
    const retryAfter = Number(response.headers.get("retry-after"));
    const body = await response.json().catch(() => null);
    const code = (body as { error?: string } | null)?.error;

    throw new ExtractRequestError(
      code === "rate_limited" ||
      code === "input_too_long" ||
      code === "invalid_input"
        ? code
        : "unknown",
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    );
  }

  if (!response.body) throw new ExtractRequestError("network");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = createEventParser();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield* parser.push(decoder.decode(value, { stream: true }));
    }
    yield* parser.flush();
  } finally {
    // Releasing the lock lets an aborted request tear down promptly instead of
    // leaving the connection pinned open.
    reader.releaseLock();
  }
}

export interface Extraction {
  summary: string;
  entries: ExtractedEntry[];
  source: ExtractionSource;
}

/** Convenience for tests and non-streaming callers. */
export async function extractOnce(
  text: string,
  signal?: AbortSignal,
): Promise<Extraction> {
  let summary = "";
  let entries: ExtractedEntry[] = [];
  let source: ExtractionSource = "ai-fallback";

  for await (const event of streamExtraction(text, signal)) {
    if (event.type === "summary_delta") summary += event.text;
    if (event.type === "entries") {
      entries = event.entries;
      source = event.source;
    }
  }

  return { summary, entries, source };
}
