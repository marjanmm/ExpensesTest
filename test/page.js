const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

// Loads public/<file> in jsdom and runs its inline script without a server or a browser.
// `routes` maps a URL to the JSON its fetch returns (null gives a 401). Chart.js is
// replaced by a stub that records every chart in `charts`; jsdom does no layout or
// drawing, so these tests cover the page logic, not how it looks.
function loadPage(file, routes) {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", file), "utf8");
  const charts = [];

  const dom = new JSDOM(html, {
    url: `http://localhost/${file}`,
    runScripts: "dangerously",
    beforeParse(window) {
      window.fetch = async (url) => {
        const body = routes[url];
        return { ok: body != null, status: body != null ? 200 : 401, json: async () => body };
      };
      // jsdom has no canvas; Chart.js is stubbed, so a placeholder context is enough
      window.HTMLCanvasElement.prototype.getContext = function () {
        return { canvas: this, clearRect() {} };
      };
      window.Chart = class {
        constructor(ctx, config) {
          this.canvas = ctx.canvas || ctx;
          this.config = config;
          this.destroyed = false;
          charts.push(this);
        }
        destroy() { this.destroyed = true; }
      };
    },
  });

  const { window } = dom;
  const $ = (sel) => window.document.querySelector(sel);

  // Sets a form control and fires the change event the page listens for
  function change(sel, value) {
    $(sel).value = value;
    $(sel).dispatchEvent(new window.Event("change"));
  }

  return { window, $, change, charts };
}

// Local-time YYYY-MM-DD, the same way the pages build dates
function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

module.exports = { loadPage, dateStr };
