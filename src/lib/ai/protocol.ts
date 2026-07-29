import type { ExtractedEntry, ExtractionSource } from "./extraction";

/**
 * The wire protocol between `/api/extract` and the client.
 *
 * Newline-delimited JSON, not Server-Sent Events. SSE's browser client
 * (`EventSource`) can only issue GET requests, and the free text being
 * extracted belongs in a POST body rather than a query string — so SSE would
 * mean hand-rolling a parser anyway, with a heavier format. NDJSON over
 * `fetch` + `ReadableStream` is one `split("\n")` and a `JSON.parse`.
 *
 * The two channels of ADR-0003 are `summary_delta` (prose, streamed as it is
 * generated) and a single terminal `entries` event carrying schema-valid
 * structured data. Nothing ever has to parse half a JSON object.
 */

export type ExtractErrorCode =
  | "invalid_input"
  | "input_too_long"
  | "extraction_failed";

export type ExtractEvent =
  /** A chunk of the human-readable acknowledgement. May arrive many times. */
  | { type: "summary_delta"; text: string }
  /** Terminal, and the only source of structured data. */
  | { type: "entries"; entries: ExtractedEntry[]; source: ExtractionSource }
  /** Terminal. Only for failures the fallback could not absorb. */
  | { type: "error"; code: ExtractErrorCode };

export const EXTRACT_CONTENT_TYPE = "application/x-ndjson";

export function encodeEvent(event: ExtractEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/**
 * Decodes a chunked NDJSON stream.
 *
 * Chunk boundaries do not respect line boundaries — a single event routinely
 * arrives split across two reads — so the parser holds a buffer and only emits
 * whole lines. Naively `JSON.parse`-ing each chunk works right up until the
 * first event long enough to be split, which is exactly the kind of bug that
 * only shows up under a slow connection.
 */
export function createEventParser() {
  let buffer = "";

  return {
    /** Events completed by this chunk. */
    push(chunk: string): ExtractEvent[] {
      buffer += chunk;
      const lines = buffer.split("\n");
      // The last element is either "" (chunk ended on a newline) or a partial
      // line; either way it stays buffered.
      buffer = lines.pop() ?? "";
      return lines.flatMap(parseLine);
    },

    /** Anything left when the stream closes without a trailing newline. */
    flush(): ExtractEvent[] {
      const remaining = buffer;
      buffer = "";
      return parseLine(remaining);
    },
  };
}

function parseLine(line: string): ExtractEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  try {
    // A malformed line is dropped rather than thrown: a truncated stream should
    // degrade to "no entries", not take down the page that is rendering it.
    return [JSON.parse(trimmed) as ExtractEvent];
  } catch {
    return [];
  }
}
