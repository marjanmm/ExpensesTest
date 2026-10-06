import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
const { app, resetRatesCache } = require("../app");
const { setupDb, createUser, cleanDb, closeDb } = require("./helpers");

let alice;

beforeAll(setupDb);
beforeEach(async () => {
  resetRatesCache();
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

  it("serves stale rates when a refresh fails, then backs off before retrying", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(apiResponse(GOOD)));
    expect((await request(app).get("/api/rates").set("Cookie", alice.cookie)).status).toBe(200);

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 13 * 60 * 60 * 1000); // past the 12h TTL
      const failing = vi.fn().mockRejectedValue(new Error("network down"));
      vi.stubGlobal("fetch", failing);
      const user = await createUser("alice-later"); // a session valid at the shifted time

      const res = await request(app).get("/api/rates").set("Cookie", user.cookie);
      expect(res.status).toBe(200);
      expect(res.body.rates.RSD).toBe(117.2);

      // Within the backoff window upstream is not hit again
      await request(app).get("/api/rates").set("Cookie", user.cookie);
      expect(failing).toHaveBeenCalledTimes(1);

      // After it, upstream is retried
      vi.setSystemTime(Date.now() + 6 * 60 * 1000);
      await request(app).get("/api/rates").set("Cookie", user.cookie);
      expect(failing).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns 503 with no cache and does not retry during backoff", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", failing);
    expect((await request(app).get("/api/rates").set("Cookie", alice.cookie)).status).toBe(503);
    expect((await request(app).get("/api/rates").set("Cookie", alice.cookie)).status).toBe(503);
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it("keeps valid rates when the update timestamp is unparseable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ time_last_update_utc: "not a date", rates: GOOD }),
    }));
    const res = await request(app).get("/api/rates").set("Cookie", alice.cookie);
    expect(res.status).toBe(200);
    expect(res.body.updatedAt).toBeNull();
    expect(res.body.rates.RSD).toBe(117.2);
  });
});
