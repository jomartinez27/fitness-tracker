import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Critical path (b): AI extraction error → retry → success.
 *
 * The server runs with `FEATURE_AI_ROUTE=false`, so `/api/extract` answers from
 * the deterministic local parser. That is deliberate rather than a compromise:
 * these tests exercise the real route, the real stream protocol and the real
 * client with no API key, no cost and no model nondeterminism. Whether the
 * model itself extracts well is checked by the opt-in live contract tests.
 *
 * Where a test needs a condition the server won't produce on demand — a dropped
 * connection, a 429, a genuine `source: "ai"` result — it intercepts the
 * request. Everything else goes through the real thing.
 */

const EN = "/en";

const AI_STREAM = [
  JSON.stringify({ type: "summary_delta", text: "Logged a 5 km run " }),
  JSON.stringify({ type: "summary_delta", text: "and 30 minutes of yoga." }),
  JSON.stringify({
    type: "entries",
    source: "ai",
    entries: [
      { activity: "Run", date: "2026-07-28", durationMin: 28, distanceKm: 5, inferred: ["durationMin"] },
      { activity: "Yoga", date: "2026-07-28", durationMin: 30, inferred: [] },
    ],
  }),
].join("\n");

const fulfilStream = (route: Route, body: string) =>
  route.fulfill({ status: 200, contentType: "application/x-ndjson", body });

async function describe(page: Page, text: string) {
  await page.getByLabel("What did you do?").fill(text);
  await page.getByRole("button", { name: "Extract sessions" }).click();
}

/** The results list — the header nav is also a `ul`/`li`. */
const sessions = (page: Page) => page.locator("section li");

test.beforeEach(async ({ page }) => {
  await page.goto(`${EN}/describe`);
  await expect(page.getByLabel("What did you do?")).toBeVisible();
});

test("extracts sessions, lets them be reviewed, and saves only what is ticked", async ({
  page,
}) => {
  await describe(page, "ran 5k, 30 min yoga");

  await expect(page.getByRole("heading", { name: /Found 2 sessions/ })).toBeVisible();
  // Nothing is written until the user says so.
  await expect(page.getByText(/nothing is saved until you say so/i)).toBeVisible();
  await expect(sessions(page)).toHaveCount(2);

  await sessions(page).nth(1).getByRole("checkbox").uncheck();
  await expect(page.getByRole("button", { name: "Save 1 session" })).toBeVisible();

  await page.getByRole("button", { name: "Save 1 session" }).click();
  await expect(page.getByText("1 session saved")).toBeVisible();
});

test("marks a value it worked out, so a guess is not read as a measurement", async ({
  page,
}) => {
  // "ran 5k" states a distance and no duration, so the duration is derived.
  await describe(page, "ran 5k");

  const session = sessions(page).first();
  await expect(session.getByText("estimated")).toBeVisible();
  await expect(
    session.getByText(/worked this out rather than reading it/i),
  ).toBeAttached();
});

test("recovers from a dropped connection: error → retry → success", async ({ page }) => {
  // The headline path for this issue.
  let attempts = 0;
  await page.route("**/api/extract", async (route) => {
    attempts += 1;
    if (attempts === 1) return route.abort("connectionfailed");
    return route.fallback();
  });

  await describe(page, "ran 5k, 30 min yoga");

  const alert = page.locator("main").getByRole("alert");
  await expect(alert).toBeFocused();
  await expect(alert.getByText("Couldn't reach the assistant")).toBeVisible();

  // The user's words survive the failure.
  await expect(page.getByLabel("What did you do?")).toHaveValue("ran 5k, 30 min yoga");

  await alert.getByRole("button", { name: "Try again" }).click();

  await expect(page.getByRole("heading", { name: /Found 2 sessions/ })).toBeVisible();
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  expect(attempts).toBe(2);
});

test("explains a rate limit and says when to come back", async ({ page }) => {
  await page.route("**/api/extract", (route) =>
    route.fulfill({
      status: 429,
      headers: { "retry-after": "17" },
      contentType: "application/json",
      body: JSON.stringify({ error: "rate_limited" }),
    }),
  );

  await describe(page, "ran 5k");

  const alert = page.locator("main").getByRole("alert");
  await expect(alert.getByText("That's a lot of requests")).toBeVisible();
  await expect(alert.getByText(/about 17 seconds/)).toBeVisible();
});

test("labels a locally-parsed result as a success, not a failure", async ({ page }) => {
  // The server is running with the model switched off, so this is the real
  // fallback path rather than a simulated one.
  await describe(page, "ran 5k");

  await expect(page.getByText("Parsed on your device")).toBeVisible();
  // Not an error, and still fully usable.
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Save 1 session/ })).toBeEnabled();
});

test("does not label a genuine model result", async ({ page }) => {
  await page.route("**/api/extract", (route) => fulfilStream(route, AI_STREAM));

  await describe(page, "ran 5k, 30 min yoga");

  await expect(page.getByRole("heading", { name: /Found 2 sessions/ })).toBeVisible();
  await expect(page.getByText("Parsed on your device")).toBeHidden();
});

test("treats finding nothing as guidance rather than an error", async ({ page }) => {
  await describe(page, "felt tired, took the week off");

  await expect(page.getByText(/couldn't find any sessions/i)).toBeVisible();
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
});

test("saved sessions reach the trend", async ({ page }) => {
  const totalFromSummary = async () => {
    // The chart's accessible summary lives in an aria-live region, not a
    // role=status — reading the SVG would be reading a fiction.
    const summary = await page.locator('main [aria-live="polite"]').first().textContent();
    return Number(summary?.match(/Total ([\d.]+) km/)?.[1] ?? "0");
  };

  await page.goto(`${EN}`);
  await page.getByRole("radio", { name: "7 days" }).click();
  await expect(page.locator("table")).toBeVisible();
  const before = await totalFromSummary();

  await page.getByRole("link", { name: "Describe your week" }).click();
  await page.waitForURL(`**${EN}/describe`);
  await describe(page, "ran 8k today");
  await page.getByRole("button", { name: /Save 1 session/ }).click();
  await expect(page.getByText("1 session saved")).toBeVisible();

  await page.getByRole("link", { name: "Trend" }).click();
  await page.waitForURL(`**${EN}`);
  await page.getByRole("radio", { name: "7 days" }).click();

  // Read through the accessible table's summary, not the SVG.
  await expect
    .poll(totalFromSummary, { message: "trend total after saving" })
    .toBeGreaterThan(before);
});
