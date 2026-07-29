import { defineConfig, devices } from "@playwright/test";

const PORT = 3210;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL,
    trace: "on-first-retry",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // The entry flow is a phone-first surface, so it gets checked on one.
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],

  webServer: {
    // Production build, not dev: dev-only overlays inject their own controls
    // (the Next dev-tools button matches an accessible name of "Next", which
    // collides with this form's own Next button).
    command: `npm run build && npx next start -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
