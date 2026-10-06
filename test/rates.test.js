import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
const { app } = require("../app");
const { setupDb, createUser, cleanDb, closeDb } = require("./helpers");

let alice;

beforeAll(setupDb);
beforeEach(async () => {
  await cleanDb();
  alice = await createUser("alice");
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await cleanDb();
  await closeDb();
});

const apiResponse = rates => ({
  ok: true,
  json: async () => ({ time_last_update_utc: "Tue, 06 Oct 2026 00:02:31 +0000", rates }),
});
const GOOD = { EUR: 1, RSD: 117.2, USD: 1.17, CHF: 0.93, GBP: 0.87, JPY: 180 };

describe("GET /api/rates", () => {
  it("requires authentication", async () => {
    expect((await request(app).get("/api/rates")).status).toBe(401);
  });

  it("returns only supported currencies and caches the upstream response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(apiResponse(GOOD));
    vi.stubGlobal("fetch", fetchMock);

    const first = await request(app).get("/api/rates").set("Cookie", alice.cookie);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({
      base: "EUR",
      rates: { EUR: 1, RSD: 117.2, USD: 1.17, CHF: 0.93, GBP: 0.87 },
      updatedAt: "2026-10-06T00:02:31.000Z",
    });

    await request(app).get("/api/rates").set("Cookie", alice.cookie);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("serves stale rates when a refresh fails", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 13 * 60 * 60 * 1000); // past the 12h TTL
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
      const user = await createUser("alice-later"); // a session valid at the shifted time
      const res = await request(app).get("/api/rates").set("Cookie", user.cookie);
      expect(res.status).toBe(200);
      expect(res.body.rates.RSD).toBe(117.2);
    } finally {
      vi.useRealTimers();
    }
  });
});
