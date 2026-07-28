# Backlog

**Epic:** Ship an AI-native training tracker that demonstrates production-grade frontend
craft — form UX that never loses data, a trend chart with real states, and a flag-gated
streamed AI feature.

This file is the source of truth for the plan. It is also the import format: each issue below
maps 1:1 to a GitHub issue, with the same title, labels, and milestone.

## Labels

| Label | Meaning |
|---|---|
| `risk:high` | Can't be fixed by trying harder — needs a design decision, has a known failure mode, or gates the demo |
| `risk:med` | Known unknowns: library friction, config surprises, a11y nuance |
| `risk:low` | Mechanical; the only risk is time |
| `area:infra` `area:data` `area:chart` `area:forms` `area:ai` `area:i18n` `area:a11y` | Where the work lives |

## Milestones

| Milestone | Contains | Exit criterion |
|---|---|---|
| **v0 — the spine** | M0 foundations, M1 chart in isolation, M2 app shell + entry flow | A stranger opens the deployed URL, reads a populated trend chart in seconds, logs an entry, kills the tab mid-entry, and returns to an intact draft. AI flag off. |
| **v1 — the differentiators** | M3 AI extraction, ES locale, E2E coverage | AI flag on in production, rate limits verified, fallback verified by forcing the failure. |
| **Stretch** | Everything flagged and optional | None of it blocks calling v1 done. |

---

## Sequencing rationale

The order is chosen so that **the riskiest thing is never the last thing**.

1. **Foundations first (M0), and thin.** Types, the repository interface, flags, and test
   tooling are cheap and unblock everything. The repository interface specifically comes
   before any feature, because retrofitting a persistence seam after features exist is how
   you end up with `idb` imports in a form component.

2. **The chart in isolation before the app (M1).** Counter-intuitive ordering, deliberately
   chosen: building it standalone forces its states to be props rather than consequences of a
   fetch, which is what makes empty/loading/error testable at all. It also front-loads the
   Recharts + App Router hydration risk (R5) into a phase where nothing depends on it yet. If
   Recharts turns out to be wrong, ADR-0002's wrapper means we find out with one component
   written instead of a whole dashboard.

3. **Entry flow before dashboard wiring (M2).** The dashboard is a consumer of two things
   that already exist by then (the chart, the repository), so it's near-mechanical. The entry
   flow contains the two genuinely hard problems in v0 — draft persistence across
   back-navigation (#15) and optimistic submit with retry (#16) — and those deserve the
   fresh-budget slot, not the leftover one.

4. **The mock extractor before the real route (M3).** #20 before #21 is the load-bearing
   ordering in v1. It means the entire AI *interface* — states, retry, streaming consumption,
   E2E tests — can be built and verified with zero API cost and zero nondeterminism, and it
   means the fallback path is exercised from day one rather than being an untested branch
   that only runs during an incident.

5. **Abuse controls before the flag flip (#22 before #26).** The public deployment is the
   moment risk R1 becomes real. Rate limiting, caps, and timeouts ship *before* the feature is
   switched on in production, not as a follow-up.

6. **ES after EN, but keyed from commit one.** Message keys are a v0 discipline (#6); the
   Spanish catalogue is a v1 task (#24). Translating is cheap; extracting hardcoded strings
   from a finished app is not.

**Critical path:** #1 → #3 → #4 → #7 → #14 → #15 → #17 → #19 → #20 → #21 → #26.
Everything else can slip without moving the end date.

---

## Milestone: v0 — the spine

### M0 · Foundations

**#1 — Test and story tooling: Vitest, Testing Library, Storybook, Playwright**
`risk:med` · `area:infra` · blocks: #7–#12, #25
Vitest + jsdom + Testing Library, Storybook 8 with the Next + Tailwind v4 setup, Playwright
installed and configured but with no specs yet. Wire `test`, `test:e2e`, `storybook` scripts.
*Risk:* Tailwind v4 and Next 16 are recent enough that Storybook's builder config is the most
likely place to lose an afternoon. Doing it first means that afternoon is scheduled.

**#2 — `flags.ts`: a single typed source for feature flags**
`risk:low` · `area:infra` · blocks: #21, #23, #26
One module exporting typed booleans. No `process.env` reads anywhere else. Include the
server-side AI flag (distinct from the `NEXT_PUBLIC_` one — the route must be able to refuse
independently of the UI hiding).

**#3 — Domain model: `Entry`, `EntryDraft`, `Goal`, `Metric` + Zod schemas**
`risk:low` · `area:data` · blocks: #4, #7, #14, #20
Types plus runtime schemas. The same schema validates form input, repository writes, and AI
extraction output — that shared contract is what keeps the mock and the model honest (#20).

**#4 — `Repository` interface + `InMemoryRepository`**
`risk:low` · `area:data` · depends: #3 · blocks: #5, #11, #17
The interface from ADR-0001, plus the in-memory implementation used by tests, Storybook, and
the R4 degraded-mode fallback.

**#5 — `IndexedDbRepository` + 90 days of seeded demo data**
`risk:med` · `area:data` · depends: #4 · blocks: #17
`idb`-backed implementation, seeded on first run so a first-time visitor sees a populated
chart. Draft writes and entry commits must share one transaction — that atomicity is what
makes #15 fixable rather than racy.
*Risk:* seed data has to look plausible (rest days, variance, a visible trend) or the demo
reads as fake.

**#6 — i18n scaffolding: `next-intl`, `/[locale]/` routing, EN catalogue**
`risk:med` · `area:i18n` · blocks: #13, #24
Locale-routed layout, EN messages, and the lint rule or review discipline that keeps literal
strings out of components.
*Risk:* App Router + locale segments interact with layouts and metadata in ways worth getting
right once, up front.

### M1 · Trend chart in isolation (Phase 1)

**#7 — `<TrendChart>` ready state with goal reference line**
`risk:med` · `area:chart` · depends: #1, #3 · blocks: #8, #9, #10, #17
The wrapper from ADR-0002: data, goal, range, and `status` as props. Fetches nothing. No
Recharts type in the public props.

**#8 — Range selector (7d/30d/90d) as an accessible radiogroup**
`risk:med` · `area:chart` `area:a11y` · depends: #7
Roving tabindex, arrow-key navigation, correct `aria-checked`. Not three buttons in a row.

**#9 — Chart empty / loading / error / retry states**
`risk:low` · `area:chart` · depends: #7
Fixed-aspect skeleton that reserves layout. Empty state distinguishes "no data yet" from "no
data in this range" — different situations, different copy, different affordance.

**#10 — Chart accessibility: off-screen data table + `aria-live` range announcements**
`risk:med` · `area:chart` `area:a11y` · depends: #7, #8
The chart is decorative to assistive tech; the table is the content. Range changes announce.

**#11 — Storybook stories: every state, every range, mobile + desktop viewports**
`risk:low` · `area:chart` · depends: #4, #9, #10
Includes the awkward cases — single data point, all-zero series, goal above/below the whole
series, a gap in the data.

**#12 — Vitest coverage for `<TrendChart>`, including a hydration assertion**
`risk:med` · `area:chart` · depends: #9, #10
Explicitly asserts no hydration mismatch (risk R5) rather than assuming the `'use client'`
boundary handles it.

### M2 · App shell and entry flow (Phase 2)

**#13 — App shell: locale layout, navigation, responsive frame**
`risk:low` · `area:infra` · depends: #6

**#14 — Quick-add entry flow: steps + per-step validation**
`risk:med` · `area:forms` · depends: #3, #13 · blocks: #15, #16
Validation on blur and on step-advance, never on every keystroke. Errors are announced and
focus moves to the first invalid field.

**#15 — Draft autosave and hydrate-on-mount (no data loss on back-nav)**
`risk:high` · `area:forms` `area:data` · depends: #5, #14 · blocks: #16
The pillar-one promise. Debounced writes to the draft record; the form hydrates from the
draft, so back-navigation and refresh are non-events. Explicit test for the R3 interleaving:
draft cleared in the same transaction that commits the entry, so a successful submit can't
resurrect a stale draft.

**#16 — Optimistic submit with retry**
`risk:high` · `area:forms` · depends: #15
Entry appears immediately; failure surfaces a non-destructive retry with the user's input
intact. Retry is idempotent — a double-tap can't produce two entries.

**#17 — Dashboard page: wire `<TrendChart>` to the repository**
`risk:low` · `area:chart` `area:data` · depends: #5, #7, #11
Near-mechanical by this point, which is the intended payoff of building the chart first.

**#18 — IndexedDB-unavailable fallback + honest persistent banner**
`risk:med` · `area:data` `area:a11y` · depends: #5
Feature-detect at boot, fall back to `InMemoryRepository`, and *tell the user* their changes
won't be saved. Risk R4.

**#19 — Deploy to Vercel with the AI flag off**
`risk:low` · `area:infra` · depends: #17
v0 is publicly reachable and demoable before any AI code exists.

---

## Milestone: v1 — the differentiators

**#20 — `mockExtract()` + a shared schema contract test**
`risk:med` · `area:ai` · depends: #3 · blocks: #21, #23, #25
Deterministic keyword/regex extractor, no network. One contract test runs both extractors
against the same schema so the fallback can't silently drift from the real thing.

**#21 — `POST /api/extract`: streaming route, two-channel response**
`risk:high` · `area:ai` · depends: #2, #20 · blocks: #22, #23
Streams prose acknowledgement; emits schema-valid structured entries as a terminal event
(ADR-0003, risk R2). `ANTHROPIC_MODEL` configurable, key server-only.

**#22 — Abuse controls: per-IP rate limit, input/output caps, timeout**
`risk:high` · `area:ai` `area:infra` · depends: #21 · blocks: #26
Risk R1. Every trip falls back to the mock rather than erroring. Ships *before* #26.

**#23 — AI extraction UI: states, retry, and fallback labeling**
`risk:med` · `area:ai` `area:a11y` · depends: #2, #20, #21
Streamed prose is the loading affordance. "Parsed locally" is a labeled success, not an
error. Retry is explicit.

**#24 — Spanish catalogue and locale switcher**
`risk:med` · `area:i18n` · depends: #6, #23
Includes date/number formatting and the layout consequences of longer strings.

**#25 — Playwright: the two critical paths**
`risk:med` · `area:infra` · depends: #1, #16, #20, #23
(a) Entry survives back-navigation and refresh. (b) AI extraction error → retry → success.
Both run against the mock, so E2E is free and deterministic.

**#26 — Flip `NEXT_PUBLIC_FEATURE_AI` on in production and verify**
`risk:high` · `area:ai` `area:infra` · depends: #22, #23, #25
Verify the rate limit trips as designed, the fallback engages, and the kill switch works —
by actually forcing each, not by reading the code.

---

## Milestone: Stretch

Each behind its own flag. None blocks v1.

- **#27 — Weekly AI trend summary** · `risk:med` · `area:ai` — second use of the streaming
  route; reuses everything #21–#23 established.
- **#28 — Goal-setting UI** · `risk:low` · `area:forms` — v0 hardcodes goals in seed data.
- **#29 — CSV export** · `risk:low` · `area:data` — the honest answer to ADR-0001's
  "clearing site data destroys everything".
- **#30 — PWA install + offline read** · `risk:med` · `area:infra` — read-only offline; not
  offline sync, which stays a non-goal.
- **#31 — Durable rate limiting (Upstash / Vercel KV)** · `risk:med` · `area:ai` — replaces
  the per-instance in-memory limiter from #22.
