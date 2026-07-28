# ADR-0002: Recharts for the trend chart, behind our own component boundary

- **Status:** Accepted
- **Date:** 2026-07-28
- **Deciders:** Jorge Martinez

## Context

The trend dashboard is one of the three pillars. It needs a time series with a goal reference
line and a 7d/30d/90d range selector, and it needs to be responsive, keyboard-accessible, and
correct in empty, loading, and error states. It is also the first thing built (Phase 1), in
isolation, before an app exists around it — which means the choice of charting approach
determines how much of Phase 1 is spent on chart mechanics versus on the states and tests
that are the actual point of building it in isolation.

The relevant question isn't "which library is most powerful." It's "which choice leaves the
most budget for the craft work, without painting us into a corner." Charting libraries are
also a classic source of App Router pain — most assume a browser at import time.

## Decision

**Use Recharts, wrapped in a `<TrendChart>` component that owns the entire public surface.**

The wrapper takes data, a goal, a range, and explicit `status` (`'loading' | 'error' |
'ready'`) as props. It fetches nothing, and no Recharts type appears in its props. Recharts
is imported in exactly one file. The component is a client component (`'use client'`) with a
fixed-aspect-ratio skeleton so the loading state reserves layout and hydration can't shift
the page.

Range selection is a real `radiogroup` with arrow-key navigation, not a row of buttons.
Tooltips are supplemented by an off-screen data table (`aria-live` on range change) so the
series is readable by a screen reader — the chart is decorative to assistive tech, the table
is the content.

## Consequences

**Positive**

- Responsive containers, axis tick management, tooltip positioning, and reference lines are
  solved. Phase 1's effort goes to empty/loading/error/retry, keyboard behavior, and tests,
  which is what Phase 1 is for.
- Declarative React composition means the chart reads like the rest of the codebase, and
  Storybook stories are just props — no imperative setup or teardown.
- The wrapper is the escape hatch. If Recharts becomes a constraint (custom interaction,
  bundle size, animation control), replacing the renderer touches one file and no consumer.

**Negative**

- **Bundle cost.** Recharts pulls in a slice of D3; it's the largest single dependency in the
  project. Accepted for one chart. Mitigated by keeping it in a client component that isn't
  in the entry-flow bundle, and it becomes a live concern only if a second chart type ships.
- **SSR/hydration friction** (risk R5). Recharts measures the DOM; naive server rendering
  produces a mismatch. Handled by the `'use client'` boundary and the fixed-dimension
  skeleton, with a hydration assertion in the test suite rather than a hope.
- **Customization ceiling.** Anything Recharts doesn't express declaratively means reaching
  into internals or dropping to custom SVG children. The wrapper means we'd find this out
  behind a stable interface.
- **Accessibility is not free.** Recharts' built-in a11y is thin; the radiogroup and the
  off-screen table are our work regardless of library. Worth stating plainly — picking a
  charting library does not buy an accessible chart.

## Alternatives considered

**visx (Airbnb).** Low-level D3 primitives as React components — the right tool if the chart
were the product. Rejected because scales, axes, tooltip hit-testing, and responsive sizing
all become hand-written, and the resulting v0 chart would look approximately identical while
costing several times the effort. That tradeoff demonstrates stamina, not judgment.

**Hand-rolled SVG, no dependency.** Zero bundle cost and total control, and genuinely viable
for a single line chart. Rejected for the same reason as visx plus one more: reference-line
label collision and responsive tick thinning are fiddly enough that they'd eat the time
budgeted for the states and tests that are the actual deliverable of Phase 1.

**Chart.js (via `react-chartjs-2`).** Mature and compact, but canvas-based — which puts the
rendered output beyond the reach of DOM assertions, so component tests degrade to snapshot
or image comparison, and the accessibility story gets worse rather than better. For a project
whose thesis is testable, accessible UI, canvas is the wrong substrate.

**Tremor / shadcn chart wrappers.** Faster still, but they wrap Recharts anyway and impose
their own design system. Since we're building our own component boundary regardless, the
wrapper adds a layer without removing one.
