# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
./setup-and-run.sh [--dev]   # macOS: installs Homebrew/Node/PostgreSQL 16, creates the DB and .env, prompts for Google OAuth creds, starts the app
npm start                    # node server.js (needs PostgreSQL running and .env filled in)
npm run dev                  # node --watch server.js
npm test                     # vitest run (all files)
npx vitest run test/expenses.test.js            # one file
npx vitest run test/expenses.test.js -t "deletes"  # tests whose name matches
```

There is no build step and no linter. The app is at `http://localhost:3000/expenses.html`; there's no `/` page.

## Architecture

- **`app.js` is the whole backend.** It builds and exports the Express app (`{ app, init, pool, sessionStore, ... }`) without listening. `server.js` only calls `init()` and then `listen`, which lets tests import the app directly. `init()` creates and migrates the tables with `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`; there's no migration tool.
- **Auth:** Google OAuth via Passport. Sessions are stored in Postgres by `connect-pg-simple` (its `session` table is created lazily). `/api/*` routes use `requireAuth` and must scope every query by `req.user.id`. Logout is POST only.
- **Async handlers** must be wrapped in `wrap(...)`, because Express 4 doesn't catch rejected promises. Errors go to the final error handler, which returns JSON.
- **Validation** of expenses is server-side in `validateExpense`. `CURRENCIES` and `CATEGORIES` there must stay in sync with the `<select>` options and label maps in both HTML pages.
- **Dates:** a custom `pg` type parser returns DATE columns as plain `"YYYY-MM-DD"` strings. Keep them as strings end to end. In the browser, build dates from local time (`toDateStr`), never `toISOString()`, which is UTC and gives yesterday's date in UTC+ timezones. The user is in Europe/Belgrade, and tests run with `TZ=Europe/Belgrade` for this reason.
- **Exchange rates:** `GET /api/rates` returns rates with EUR as the base (`eur = amount / rates[currency]`). It fetches from open.er-api.com, chosen because it covers RSD. The response is cached in memory for 12h and the stale cache is served if a refresh fails; the endpoint returns 503 only if no rates were ever fetched. All summary totals and Reports charts are shown in EUR only and must handle missing rates ("n/a").
- **Frontend:** `public/expenses.html` and `public/reports.html` are standalone pages with inline CSS and JS (vanilla, Chart.js from jsDelivr on Reports). There's no shared JS file, so helpers such as `formatMoney` and `toDateStr` and the header CSS are duplicated in both pages: change both. Weeks run Monday to Sunday. User text inserted with `innerHTML` must go through `escHtml`.
- **Security headers:** helmet's CSP in `app.js` limits scripts to `'self'` + jsDelivr, images to `'self'`/`data:`/Google avatars, and `connect-src` to `'self'`. The browser never calls third-party APIs directly; proxy them through the server, as `/api/rates` does. `/api` and `/auth` are rate-limited.

## Tests

- vitest + supertest. Tests run against a separate database, `postgres://localhost/expenses_test` (override with `TEST_DATABASE_URL`). `test/db-url.js` refuses any database whose name doesn't end in `_test`, and `test/global-setup.js` creates it if missing.
- Test files run one at a time in separate processes (shared DB, fresh in-memory rate limiter per file).
- `test/helpers.js`'s `createUser` bypasses Google: it inserts a `test-*` user, stores a session directly and returns a signed `connect.sid` cookie. `cleanDb` deletes `test-*` users and `test-sid-*` sessions.
- Network calls (such as the rates API) are mocked with `vi.stubGlobal("fetch", ...)`.
- Frontend logic is tested in `test/pages.test.js`. `test/page.js`'s `loadPage` runs a page's inline script in jsdom, with `fetch` answered from a route map and Chart.js replaced by a stub that records each chart's config. jsdom does no layout or drawing, so check how things look in a browser (below).

## Checking UI changes in a browser

Google login is not a blocker. Start the app against `expenses_test` with a known `SESSION_SECRET`, seed a user and session the way `createUser` does, set the signed `connect.sid` cookie in a headless browser and load the pages. When emulating mobile, measure overflow against the configured viewport width, not `window.innerWidth`; in mobile emulation the layout viewport grows to fit overflowing content.

## Repo conventions

- Work on a feature branch and open a PR to `main`. PRs are merged with merge commits.
- `.claude/agents/code-reviewer.md` is a read-only review subagent for PRs and diffs.
