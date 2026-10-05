import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
const { app } = require("../app");
const { setupDb, createUser, cleanDb, closeDb, validExpense } = require("./helpers");

let user;

beforeAll(setupDb);
beforeEach(async () => {
  await cleanDb();
  user = await createUser("alice");
});
afterAll(async () => {
  await cleanDb();
  await closeDb();
});

// The suite runs with TZ=Europe/Belgrade (see vitest.config.mjs), where a naive
// Date -> toISOString() conversion moves midnight back to the previous day.
describe("dates are stored and returned as the same calendar day", () => {
  it.each(["2026-10-05", "2026-01-01", "2026-03-29", "2026-12-31"])("%s", async date => {
    const created = await request(app).post("/api/expenses").set("Cookie", user.cookie).send(validExpense({ date }));
    expect(created.status).toBe(201);
    expect(created.body.date).toBe(date);

    const listed = await request(app).get("/api/expenses").set("Cookie", user.cookie);
    expect(listed.body[0].date).toBe(date);
  });
});
