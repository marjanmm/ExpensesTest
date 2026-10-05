import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
const { app } = require("../app");
const { setupDb, closeDb } = require("./helpers");

beforeAll(setupDb);
afterAll(closeDb);

describe("static files", () => {
  it.each(["/expenses.html", "/reports.html"])("serves %s", async path => {
    const res = await request(app).get(path);
    expect(res.status).toBe(200);
  });

  it.each(["/.env", "/.env.example", "/server.js", "/app.js", "/package.json", "/.git/config", "/public/expenses.html"])(
    "does not serve %s",
    async path => {
      const res = await request(app).get(path);
      expect(res.status).toBe(404);
    }
  );
});

describe("security headers", () => {
  it("sets CSP, nosniff and hides X-Powered-By", async () => {
    const res = await request(app).get("/expenses.html");
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("does not send CORS headers (same-origin only)", async () => {
    const res = await request(app).get("/api/expenses").set("Origin", "https://evil.example");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });
});

describe("rate limiting", () => {
  it("returns 429 on /auth after 100 requests in a window", async () => {
    let last;
    for (let i = 0; i < 101; i++) last = await request(app).get("/auth/me");
    expect(last.status).toBe(429);
    expect(last.headers["retry-after"]).toBeDefined();
    expect(last.body.error).toMatch(/Too many requests/);
  });
});
