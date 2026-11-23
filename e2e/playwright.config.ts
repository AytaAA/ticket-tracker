import { defineConfig } from "@playwright/test";

// Runs against the live stack (`docker compose up --build`). Override with BASE_URL / MAILPIT_URL.
export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:8080",
    // Uses the locally installed Chrome; set PW_CHANNEL="" to use Playwright's bundled Chromium instead
    channel: process.env.PW_CHANNEL ?? "chrome",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
