import { describe, it, expect, vi } from "vitest";
const { loadPage, dateStr } = require("./page");

const RATES = { base: "EUR", rates: { EUR: 1, USD: 1.1, RSD: 117 } };
const today = dateStr(new Date());

const expense = (overrides = {}) => ({
  id: 1, date: today, amount: "10.00", currency: "EUR", category: "food", description: "Lunch",
  ...overrides,
});

function routes({ avatar = null, expenses = [] } = {}) {
  return {
    "/auth/me": { name: "Alice", avatar },
    "/api/expenses": expenses,
    "/api/rates": RATES,
  };
}

const doughnuts = (charts) => charts.filter((c) => c.config.type === "doughnut");

describe.each(["expenses.html", "reports.html"])("%s header", (file) => {
  it("names the signed-in user on the Sign out button", async () => {
    const { $ } = loadPage(file, routes());
    await vi.waitFor(() => expect($(".btn-logout").title).toBe("Signed in as Alice"));
  });

  it("keeps the avatar hidden and without a src when the user has none", async () => {
    const { $ } = loadPage(file, routes());
    await vi.waitFor(() => expect($("#userName").textContent).toBe("Alice"));
    expect($("#userAvatar").hidden).toBe(true);
    expect($("#userAvatar").hasAttribute("src")).toBe(false);
  });

  it("shows the avatar only once it has loaded", async () => {
    const avatar = "https://lh3.googleusercontent.com/a/alice";
    const { $, window } = loadPage(file, routes({ avatar }));
    await vi.waitFor(() => expect($("#userAvatar").getAttribute("src")).toBe(avatar));
    expect($("#userAvatar").hidden).toBe(true);

    $("#userAvatar").dispatchEvent(new window.Event("load"));
    expect($("#userAvatar").hidden).toBe(false);
  });
});

describe("reports.html category doughnut", () => {
  it("draws no slice border when there is only one category", async () => {
    const { charts } = loadPage("reports.html", routes({ expenses: [expense()] }));
    await vi.waitFor(() => expect(doughnuts(charts)).toHaveLength(1));
    expect(doughnuts(charts)[0].config.data.datasets[0].borderWidth).toBe(0);
  });

  it("separates slices with a border when there are several categories", async () => {
    const expenses = [expense(), expense({ id: 2, category: "transport" })];
    const { charts } = loadPage("reports.html", routes({ expenses }));
    await vi.waitFor(() => expect(doughnuts(charts)).toHaveLength(1));
    expect(doughnuts(charts)[0].config.data.datasets[0].borderWidth).toBe(2);
  });
});

describe("reports.html empty range", () => {
  it("draws the doughnut again after switching away from a range with no expenses", async () => {
    const { $, change, charts } = loadPage("reports.html", routes({ expenses: [expense()] }));
    await vi.waitFor(() => expect(doughnuts(charts)).toHaveLength(1));
    const from = $("#dateFrom").value;
    const to = $("#dateTo").value;

    // Setting "to" first makes the range invalid (from > to), so nothing renders in between
    change("#dateTo", "2000-01-31");
    change("#dateFrom", "2000-01-01");
    expect($("#categoryEmpty").hidden).toBe(false);
    expect($("#categoryWrap").hidden).toBe(true);
    expect(doughnuts(charts).every((c) => c.destroyed)).toBe(true);

    change("#dateFrom", from);
    change("#dateTo", to);
    const latest = doughnuts(charts).at(-1);
    expect(latest.destroyed).toBe(false);
    expect(latest.canvas).toBe($("#categoryChart"));
    expect(latest.canvas.isConnected).toBe(true);
    expect($("#categoryEmpty").hidden).toBe(true);
    expect($("#categoryWrap").hidden).toBe(false);
  });
});
