import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
const { app } = require("../app");
const { setupDb, createUser, cleanDb, closeDb } = require("./helpers");

beforeAll(setupDb);
beforeEach(cleanDb);
afterAll(async () => {
  await cleanDb();
  await closeDb();
});

describe("authentication", () => {
  it("rejects unauthenticated API requests with 401", async () => {
    for (const [method, path] of [["get", "/api/expenses"], ["post", "/api/expenses"], ["delete", "/api/expenses"], ["delete", "/api/expenses/7a1f2e3c-0000-4000-8000-000000000000"]]) {
      const res = await request(app)[method](path);
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  it("GET /auth/me is 401 with no session", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
  });

  it("GET /auth/me returns the profile (and only the profile) of a signed-in user", async () => {
    const user = await createUser("alice");
    const res = await request(app).get("/auth/me").set("Cookie", user.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: user.id, name: "alice", email: "alice@example.test", avatar: null });
  });

  it("ignores a session cookie with a bad signature", async () => {
    const user = await createUser("alice");
    const forged = user.cookie.replace(/\.[^.]+$/, ".forgedsignature");
    const res = await request(app).get("/auth/me").set("Cookie", forged);
    expect(res.status).toBe(401);
  });

  it("POST /auth/logout ends the session and redirects", async () => {
    const user = await createUser("alice");
    const out = await request(app).post("/auth/logout").set("Cookie", user.cookie);
    expect(out.status).toBe(303);
    expect(out.headers.location).toBe("/expenses.html");

    const after = await request(app).get("/auth/me").set("Cookie", user.cookie);
    expect(after.status).toBe(401);
  });

  it("GET /auth/logout no longer exists", async () => {
    const res = await request(app).get("/auth/logout");
    expect(res.status).toBe(404);
  });

  it("starts the Google flow by redirecting to accounts.google.com", async () => {
    const res = await request(app).get("/auth/google");
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("https://accounts.google.com/");
    expect(res.headers.location).toContain("client_id=test-client-id");
  });
});
