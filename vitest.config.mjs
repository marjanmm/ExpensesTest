import { defineConfig } from "vitest/config";
import dbUrl from "./test/db-url.js";

const { TEST_DATABASE_URL, testDbName } = dbUrl;

testDbName(); // fail fast if the target is not a *_test database

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.js"],
    include: ["test/**/*.test.js"],
    // Each file gets a fresh process (and a fresh in-memory rate limiter); files share one database, so run them one at a time.
    pool: "forks",
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: TEST_DATABASE_URL,
      SESSION_SECRET: "test-session-secret",
      GOOGLE_CLIENT_ID: "test-client-id",
      GOOGLE_CLIENT_SECRET: "test-client-secret",
      BASE_URL: "http://localhost:3000",
      // A timezone east of UTC, where date handling bugs show up.
      TZ: "Europe/Belgrade",
    },
  },
});
