import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: "**/*.spec.ts",
  use: {
    baseURL: "http://127.0.0.1:3000",
    headless: true,
    launchOptions: process.env.CHROMIUM_PATH
      ? {
          executablePath: process.env.CHROMIUM_PATH,
          args: ["--no-sandbox", "--disable-dev-shm-usage"],
        }
      : undefined,
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --webpack",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
    env: { TURNSTILE_REQUIRED: "false" },
  },
});
