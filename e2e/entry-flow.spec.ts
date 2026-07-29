import { expect, test, type Page } from "@playwright/test";

/**
 * The v0 promise, verified against a real browser and real IndexedDB.
 *
 * These paths are deliberately not covered in jsdom: the things that break them
 * — persistent storage, the router's client-side navigation, and the browser's
 * default form-submit behaviour — are exactly the things jsdom simulates rather
 * than implements. One of the bugs this suite exists to catch (a step-advance
 * button silently submitting the form) passed every jsdom test.
 */

const EN = "/en";

/** Client-side navigation does no network work, so `networkidle` resolves instantly. */
async function navigate(page: Page, linkName: string, url: string) {
  await page.getByRole("link", { name: linkName }).click();
  await page.waitForURL(`**${url}`);
}

test.beforeEach(async ({ page }) => {
  await page.goto(`${EN}/log`);
  await expect(page.getByText("Step 1 of 3")).toBeVisible();
});

test("keeps a half-finished session across navigation, back/forward and a reload", async ({
  page,
}) => {
  await page.getByLabel("Activity").fill("Hill repeats");
  await page.getByLabel("Date").fill("2026-07-26");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Duration").fill("53");
  await page.getByLabel("Distance").fill("9,4");

  // Leave mid-entry and come back.
  await navigate(page, "Trend", EN);
  await navigate(page, "Log a session", `${EN}/log`);

  await expect(page.getByText("Step 2 of 3")).toBeVisible();
  await expect(page.getByLabel("Duration")).toHaveValue("53");
  await expect(page.getByLabel("Distance")).toHaveValue("9,4");

  // Browser history and a hard reload must be no worse.
  await page.goBack();
  await page.waitForURL(`**${EN}`);
  await page.goForward();
  await page.waitForURL(`**${EN}/log`);
  await page.reload();

  await expect(page.getByText("Step 2 of 3")).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByLabel("Activity")).toHaveValue("Hill repeats");
});

test("advancing a step never submits the form early", async ({ page }) => {
  // Regression: React reused one DOM node for the Next and Save buttons, so
  // advancing off the last input step flipped it to type="submit" mid-click and
  // the browser saved the session a step early. Invisible in jsdom.
  await page.getByLabel("Activity").fill("Tempo run");
  await page.getByLabel("Date").fill("2026-07-25");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Duration").fill("31");
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await expect(page.getByText("Step 3 of 3")).toBeVisible();
  await expect(page.getByText("Session saved")).toBeHidden();
  await expect(page.getByRole("button", { name: "Save session" })).toBeVisible();
});

test("saves the session, clears the draft for good, and shows it on the trend", async ({
  page,
}) => {
  await page.getByLabel("Activity").fill("Long run");
  await page.getByLabel("Date").fill("2026-07-26");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Duration").fill("64");
  await page.getByLabel("Distance").fill("9,4"); // comma decimal
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Save session" }).click();

  await expect(page.getByText("Session saved")).toBeVisible();

  // Risk R3, including the half that atomicity can't fix: a debounced autosave
  // firing after the commit and re-creating the draft.
  await navigate(page, "Trend", EN);
  await navigate(page, "Log a session", `${EN}/log`);
  await expect(page.getByLabel("Activity")).toHaveValue("");
  await expect(page.getByText(/restored your unsaved session/)).toBeHidden();

  // And it actually reached the chart — via the accessible table, not the SVG.
  await navigate(page, "Trend", EN);
  await page.getByRole("radio", { name: "7 days" }).click();
  await expect(
    page.getByRole("row", { name: /July 26, 2026.*9\.4 km/ }),
  ).toBeVisible();
});

test("blocks an invalid step and says why", async ({ page }) => {
  await page.getByRole("button", { name: "Next", exact: true }).click();

  // Scoped to the form: Next renders its own route announcer with role="alert".
  const alert = page.locator("form").getByRole("alert");
  await expect(alert).toBeFocused();
  await expect(alert.getByText(/Give the session a name/)).toBeVisible();
  await expect(page.getByText("Step 1 of 3")).toBeVisible();
  await expect(page.getByLabel("Activity")).toHaveAttribute("aria-invalid", "true");
});
