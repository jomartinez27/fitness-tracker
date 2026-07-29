# ADR-0003: Server-side AI extraction — flagged, rate-limited, with a deterministic fallback

- **Status:** Accepted
- **Date:** 2026-07-28
- **Deciders:** Jorge Martinez

## Context

Pillar 3 lets a user type their week in plain text — "ran 5k, 30 min yoga" — and get
structured entries back, streamed. That requires a call to the Anthropic Messages API, which
requires an API key, which means deciding where the key lives and who is allowed to spend it.

The deployment is a public URL on a personal Vercel account with no auth. Anyone who finds it
— or crawls it — can invoke whatever endpoint backs this feature. Two things follow: the key
cannot reach the client, and the endpoint needs a spend ceiling that doesn't depend on
visitors behaving well.

There's a second, quieter problem. Streaming and schema-constrained structured output pull in
opposite directions: a JSON response constrained by a schema is not parseable until it's
nearly complete, so "stream the JSON" produces a UI that either shows nothing for the whole
response or renders fragments of syntax. Streaming is a stated requirement, and so is
structured extraction. That tension has to be resolved deliberately rather than discovered
during implementation.

## Decision

**A single Next API route, `POST /api/extract`, behind a feature flag, IP rate-limited,
token-capped, with a deterministic mock extractor as the fallback for every failure mode.**

**Key handling.** `ANTHROPIC_API_KEY` in `.env.local`, gitignored, set as a Vercel
environment variable in production. Server-only — never `NEXT_PUBLIC_`. The route is the only
module that constructs an SDK client. Model is `ANTHROPIC_MODEL`, defaulting to
`claude-opus-5`.

**Abuse controls, in layers:**

| Layer | Control |
|---|---|
| Kill switch | `NEXT_PUBLIC_FEATURE_AI=false` hides the UI; the route independently checks its own server-side flag and answers from the local extractor (see the amendment below) |
| Rate limit | Per-IP token bucket, small burst, low sustained rate; on trip → mock, not an error |
| Input cap | Request body length capped before the model call |
| Output cap | `max_tokens` bounded per request |
| Timeout | Server aborts the upstream stream past a fixed wall-clock budget |

**Resolving the streaming/structured tension — two channels, one request.** The model streams
a short human-readable acknowledgement of what it understood ("Logged a 5km run and 30
minutes of yoga…"), which is what the user actually watches; structured entries are resolved
from the completed message and emitted as a final event on the same stream. The client
renders streamed prose immediately and commits entries on the terminal event. The user gets
live feedback, and the app never parses half a JSON object. Extraction uses the Messages API
structured-output support rather than prose-parsing, so entries arrive schema-valid or not
at all.

**Fallback.** `mockExtract(text)` — a deterministic regex/keyword extractor with no network
call — answers whenever the flag is off, the rate limit trips, the upstream errors, or the
timeout fires. The response is tagged so the UI can say the entries were parsed locally. This
is also the fixture Playwright runs against, so E2E never spends money and never flakes on
model nondeterminism.

**States.** The extraction surface gets the same four states as everything else: empty (no
text yet), loading (streaming, with the partial prose as the loading affordance), error
(upstream failed *and* the fallback was inapplicable), retry (explicit, idempotent). The
"fell back to local parsing" case is deliberately **not** an error state — it's a success
with a quieter result.

## Consequences

**Positive**

- The feature is live and visible to any visitor, with cost bounded by construction rather
  than by trust.
- No failure mode produces a broken UI. Worst case is degraded extraction with an honest
  label — which is a better demo of judgment than a happy path that 500s under load.
- The mock makes E2E deterministic and free, and makes the whole feature developable with no
  API key set.
- Turning the feature off in production is one environment variable and a redeploy.

**Negative**

- **The mock is a second implementation to keep honest.** Its output must satisfy the same
  schema, or the fallback path fails in a worse way than the thing it's protecting against.
  Mitigated by testing both extractors against one shared schema contract.
- **The final-event design defers structured results to completion**, so a long response
  shows prose before entries appear. Accepted: entries appearing atomically is better than
  entries appearing and then correcting themselves.
- **In-memory rate limiting doesn't hold across serverless instances.** It's a speed bump,
  not a guarantee. Acceptable at this traffic level; the fix (Upstash/Vercel KV) is noted in
  the backlog rather than pretended away.
- **Extra latency vs. calling the API directly from the client** — a hop through our server.
  Irrelevant next to model latency, and non-negotiable given the key.

## Amendment — 2026-07-28, while implementing #21

**1. The kill switch falls back; it does not 404.** As written, this ADR
contradicted itself: the controls table said the route "404s" when the flag is
off, while the fallback section said the local extractor answers "whenever the
flag is off". Both cannot be true.

Resolved in favour of the fallback. The purpose of the switch is to stop
*spend*, not to remove the feature, and a 404 breaks the UI to achieve something
the fallback achieves without breaking it. The whole design principle here is
degrade rather than fail; a kill switch that violates it is the wrong switch.
Flag off therefore means: no upstream call, no cost, endpoint still answers,
result labelled `ai-fallback`.

**2. The Vercel duration limit is not the constraint I assumed.** Hobby
functions default *and* cap at 300s with fluid compute, so a streamed
extraction is nowhere near it.

The timeout still matters, for a different reason: **which timeout fires first**.
If the platform kills the function, the client gets a severed connection and has
to infer what happened. If ours fires, we abort the upstream call and stream a
clean, labelled fallback. So the route sets `maxDuration = 30` and aborts
upstream at 20s — both far below the platform ceiling, chosen so the failure is
ours to handle rather than the platform's to inflict.

**3. Two channels, implemented with tool use.** The ADR described the design but
not the mechanism. The model writes its acknowledgement as ordinary text
(streamable token by token) and returns sessions as a `tool_use` block whose
input is read once, whole, at the end. This is what makes the two-channel claim
real rather than aspirational — there is no point at which anything parses a
partial JSON object.

**4. `ANTHROPIC_MODEL` was not actually configurable.** The requirement is that
the model is an env-var lever. It wasn't: the request always sent
`output_config.effort`, and models that don't support it fail the whole call
with a 400. Pointing the var at Haiku 4.5 meant *every* request silently served
the local fallback while the deployment was still billed as a live model —
worse than an outright error, because it looks like it works.

Fixed by retrying once without `effort` on that specific 400 and remembering the
model, so the penalty is paid once per process. Learned from the API rather than
hardcoded, since a capability list goes stale the next time the lineup moves.

**5. Measured, rather than assumed, model choice.** With the lever working, all
three candidates were run against the #20 contract and timed (median of 3–4;
`"ran 5k, 30 min yoga"`):

| model | first text | total | cost/call | contract | weekday fixture |
|---|---|---|---|---|---|
| Opus 5 (`effort: low`) | 2.7s | 8.0s | $0.0083 | 9/9 | 4/4 |
| Sonnet 5 (`effort: low`) | 1.7s | 3.5s | $0.0044 | 9/9 | 4/4 |
| Haiku 4.5 | 1.1s | 1.9s | $0.0015 | 8/9 | **1/4** |

Haiku is ruled out on evidence, not on instinct: it resolves "monday: 40 min row"
to *today* three times in four, and reports `inferred: []` — claiming it read a
date it in fact guessed wrong. Relative dates are the core of "type your week
naturally", not an edge case, and a wrong answer arriving four times faster is
still wrong.

Opus 5 stays the default. Sonnet 5 matched it on every contract fixture at half
the latency and half the cost, which makes it the obvious candidate if the demo
ever sees real traffic — but that is a capability-for-cost trade to make
deliberately, not a default to quietly downgrade. The lever now works, so it is
one environment variable away.

**6. The route guarantees exactly one terminal event.** A stream that ends after
prose without ever calling the tool throws nothing and looks like success, so a
fallback that only runs in `catch` leaves the client waiting forever for data
that is never coming. The guarantee lives in `finally`, keyed on whether an
`entries` event was actually delivered.

## Alternatives considered

**Bring-your-own-key — visitor pastes their own Anthropic key.** Zero cost exposure and a
clean security story. Rejected: nearly no visitor has a key, so the pillar becomes invisible
to the people it exists to impress. It also normalizes pasting API keys into strangers' web
forms, which is a bad thing to teach even in a demo.

**AI disabled in production, local-only with a recorded video.** Safest and cheapest.
Rejected: a feature that only runs on the author's machine is a claim, not a demonstration.
The layered controls above make "live" affordable enough that the safety of this option isn't
worth what it costs in evidence.

**Client-side call with a public/proxied key.** Rejected outright. Any key reachable by the
browser is a public key, regardless of proxying, obfuscation, or referrer checks.

**Stream the structured JSON directly and parse incrementally.** Tempting — one channel, and
entries could appear as they're generated. Rejected: partial-JSON parsing is a well-known
source of subtle bugs, and the failure mode (a malformed entry briefly rendered, then
corrected) is exactly the kind of jitter this project is meant to avoid. The two-channel
design costs nothing the user perceives.
