import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
const { app } = require("../app");
const { setupDb, createUser, cleanDb, closeDb, validExpense } = require("./helpers");

let alice, bob;

beforeAll(setupDb);
beforeEach(async () => {
  await cleanDb();
  alice = await createUser("alice");
  bob = await createUser("bob");
});
afterAll(async () => {
  await cleanDb();
  await closeDb();
});

const post = (user, body) => request(app).post("/api/expenses").set("Cookie", user.cookie).send(body);
const list = user => request(app).get("/api/expenses").set("Cookie", user.cookie);

describe("creating expenses", () => {
  it("creates an expense for the signed-in user", async () => {
    const res = await post(alice, validExpense());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      user_id: alice.id,
      amount: "19.99",
      currency: "EUR",
      date: "2026-10-05",
      category: "food",
      description: "Lunch",
    });
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("trims the description", async () => {
    const res = await post(alice, validExpense({ description: "   Coffee  " }));
    expect(res.status).toBe(201);
    expect(res.body.description).toBe("Coffee");
  });

  it("accepts a numeric string amount", async () => {
    const res = await post(alice, validExpense({ amount: "12.50" }));
    expect(res.status).toBe(201);
    expect(res.body.amount).toBe("12.50");
  });

  it("ignores a user_id supplied in the body", async () => {
    const res = await post(alice, { ...validExpense(), user_id: bob.id });
    expect(res.status).toBe(201);
    expect(res.body.user_id).toBe(alice.id);
    expect((await list(bob)).body).toEqual([]);
  });

  it.each([
    ["amount is zero", { amount: 0 }, /positive/],
    ["amount is negative", { amount: -5 }, /positive/],
    ["amount is not a number", { amount: "abc" }, /positive/],
    ["amount is missing", { amount: undefined }, /positive/],
    ["amount has more than 2 decimals", { amount: 1.234 }, /2 decimal/],
    ["amount exceeds the column limit", { amount: 1e12 }, /too large/],
    ["currency is not supported", { currency: "XXX" }, /Currency/],
    ["currency is missing", { currency: undefined }, /Currency/],
    ["date is not a date", { date: "yesterday" }, /Date/],
    ["date does not exist", { date: "2026-02-30" }, /Date/],
    ["date has the wrong format", { date: "05/10/2026" }, /Date/],
    ["category is not allowed", { category: "<img src=x onerror=alert(1)>" }, /Category/],
    ["description is blank", { description: "   " }, /Description is required/],
    ["description is not a string", { description: 42 }, /Description is required/],
    ["description is over 200 characters", { description: "a".repeat(201) }, /at most 200/],
  ])("rejects the expense when %s", async (_label, override, message) => {
    const res = await post(alice, validExpense(override));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
    expect((await list(alice)).body).toEqual([]); // nothing was stored
  });

  it("accepts a description of exactly 200 characters and the maximum amount", async () => {
    const res = await post(alice, validExpense({ description: "a".repeat(200), amount: 9999999999.99 }));
    expect(res.status).toBe(201);
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await request(app).post("/api/expenses").set("Cookie", alice.cookie)
      .set("Content-Type", "application/json").send("{bad");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid JSON.");
  });

  it("returns 413 for a body over 10kb", async () => {
    const res = await post(alice, validExpense({ description: "a".repeat(11000) }));
    expect(res.status).toBe(413);
  });
});

describe("listing expenses", () => {
  it("returns newest date first and only the caller's expenses", async () => {
    await post(alice, validExpense({ date: "2026-01-10", description: "old" }));
    await post(alice, validExpense({ date: "2026-03-10", description: "new" }));
    await post(bob, validExpense({ description: "bob's" }));

    const res = await list(alice);
    expect(res.status).toBe(200);
    expect(res.body.map(e => e.description)).toEqual(["new", "old"]);
  });
});

describe("deleting expenses", () => {
  it("deletes the caller's own expense", async () => {
    const { body } = await post(alice, validExpense());
    const res = await request(app).delete(`/api/expenses/${body.id}`).set("Cookie", alice.cookie);
    expect(res.status).toBe(204);
    expect((await list(alice)).body).toEqual([]);
  });

  it("does not delete another user's expense", async () => {
    const { body } = await post(alice, validExpense());
    const res = await request(app).delete(`/api/expenses/${body.id}`).set("Cookie", bob.cookie);
    expect(res.status).toBe(204); // no information leak about whether it exists
    expect((await list(alice)).body).toHaveLength(1);
  });

  it("rejects a malformed id with 400", async () => {
    const res = await request(app).delete("/api/expenses/not-a-uuid").set("Cookie", alice.cookie);
    expect(res.status).toBe(400);
  });

  it("DELETE /api/expenses clears only the caller's expenses", async () => {
    await post(alice, validExpense());
    await post(alice, validExpense());
    await post(bob, validExpense());

    const res = await request(app).delete("/api/expenses").set("Cookie", alice.cookie);
    expect(res.status).toBe(204);
    expect((await list(alice)).body).toEqual([]);
    expect((await list(bob)).body).toHaveLength(1);
  });
});

describe("unknown routes", () => {
  it("returns a JSON 404 for unknown API routes", async () => {
    const res = await request(app).get("/api/nope").set("Cookie", alice.cookie);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });
});
