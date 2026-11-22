import { defineConfig, devices } from "@playwright/test";

const API = "http://localhost:3101";
const WEB = "http://localhost:3100";

/**
 * Smoke tests against the real API (fake OTP, seeded test database) and a production build of the web app.
 * `pnpm test:e2e` builds both and prepares the database first; see e2e/README.md.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: WEB, trace: "retain-on-failure", ...devices["Pixel 7"] },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    {
      command: "node ../api/dist/main.js",
      url: `${API}/v1/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: "test",
        OTP_PROVIDER: "fake",
        PORT: "3101",
        WEB_ORIGIN: WEB,
        HOLD_SWEEP_INTERVAL_MS: "0",
        DATABASE_URL: process.env.DATABASE_URL_TEST ?? "",
        REDIS_URL: process.env.REDIS_URL_TEST ?? "",
      },
    },
    {
      command: "pnpm exec next start -p 3100",
      url: WEB,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { NODE_ENV: "production", API_URL: API, NEXT_PUBLIC_API_URL: API, NEXT_PUBLIC_SITE_URL: WEB },
    },
  ],
});
