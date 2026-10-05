require("dotenv").config();
const crypto = require("crypto");
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { Pool } = require("pg");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);

const app = express();
const port = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${port}`;
const isProd = process.env.NODE_ENV === "production";

// ── Configuration checks ────────────────────────────────────────────────────

let sessionSecret = process.env.SESSION_SECRET;
if (isProd && (!sessionSecret || sessionSecret === "change-this-to-a-random-string")) {
  console.error("SESSION_SECRET must be set to a random string in production.");
  process.exit(1);
}
if (!sessionSecret) {
  sessionSecret = crypto.randomBytes(32).toString("hex");
  console.warn("SESSION_SECRET is not set; using a random one. Sessions will not survive a restart.");
}

// Behind a reverse proxy (needed for secure cookies and correct client IPs in rate limiting).
// Set TRUST_PROXY to the number of proxy hops, e.g. 1.
if (process.env.TRUST_PROXY) {
  const v = process.env.TRUST_PROXY;
  app.set("trust proxy", /^\d+$/.test(v) ? Number(v) : v);
}

// In production the database connection is TLS with certificate verification.
// Use DATABASE_SSL_CA for a custom CA, or DATABASE_SSL=false for a trusted private network.
function sslConfig() {
  if (!isProd || process.env.DATABASE_SSL === "false") return false;
  return { rejectUnauthorized: true, ...(process.env.DATABASE_SSL_CA && { ca: process.env.DATABASE_SSL_CA }) };
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig(),
});
pool.on("error", err => console.error("Unexpected database error:", err.message));

// ── Middleware ──────────────────────────────────────────────────────────────

// The pages use inline scripts/styles and Chart.js from jsDelivr; Google avatars are loaded as images.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https://*.googleusercontent.com"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: isProd ? [] : null,
    },
  },
}));

const limiterOptions = {
  windowMs: 15 * 60 * 1000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
};
app.use("/api", rateLimit({ ...limiterOptions, limit: 300 }));
app.use("/auth", rateLimit({ ...limiterOptions, limit: 100 }));

app.use(express.json({ limit: "10kb" }));

// Sessions stored in PostgreSQL
const sessionStore = new PgSession({ pool, createTableIfMissing: true });
app.use(session({
  store: sessionStore,
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
  },
}));

app.use(passport.initialize());
app.use(passport.session());

// Google OAuth strategy
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: `${BASE_URL}/auth/google/callback`,
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (google_id, email, name, avatar)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (google_id) DO UPDATE SET name = $3, avatar = $4
       RETURNING *`,
      [profile.id, profile.emails[0].value, profile.displayName, profile.photos?.[0]?.value ?? null]
    );
    return done(null, rows[0]);
  } catch (err) {
    return done(err);
  }
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
    done(null, rows[0] ?? false);
  } catch (err) {
    done(err);
  }
});

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: "Unauthorized" });
}

// Express 4 does not catch rejected promises from async handlers; forward them to the error handler.
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ── Validation ──────────────────────────────────────────────────────────────

const CURRENCIES = ["RSD", "EUR", "USD", "CHF", "GBP"];
const CATEGORIES = ["food", "transport", "housing", "health", "shopping", "entertainment", "utilities", "other"];
const MAX_AMOUNT = 9999999999.99; // NUMERIC(12, 2)
const MAX_DESCRIPTION = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRealDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Returns { value } with normalized fields, or { error } with a message for the client.
function validateExpense(body) {
  const { amount, currency, date, category } = body ?? {};
  const description = typeof body?.description === "string" ? body.description.trim() : "";

  const amt = typeof amount === "number" ? amount
    : typeof amount === "string" && amount.trim() !== "" ? Number(amount)
    : NaN;
  if (!Number.isFinite(amt) || amt <= 0) return { error: "Amount must be a positive number." };
  if (amt > MAX_AMOUNT) return { error: "Amount is too large." };
  if (Math.round(amt * 100) / 100 !== amt) return { error: "Amount can have at most 2 decimal places." };

  if (!CURRENCIES.includes(currency)) return { error: `Currency must be one of: ${CURRENCIES.join(", ")}.` };
  if (!isRealDate(date)) return { error: "Date must be a valid date in YYYY-MM-DD format." };
  if (!CATEGORIES.includes(category)) return { error: `Category must be one of: ${CATEGORIES.join(", ")}.` };
  if (!description) return { error: "Description is required." };
  if (description.length > MAX_DESCRIPTION) return { error: `Description must be at most ${MAX_DESCRIPTION} characters.` };

  return { value: { amount: amt, currency, date, category, description } };
}

// Initialize database tables
async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id        SERIAL PRIMARY KEY,
      google_id TEXT UNIQUE NOT NULL,
      email     TEXT NOT NULL,
      name      TEXT,
      avatar    TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS expenses (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
      amount      NUMERIC(12, 2) NOT NULL,
      currency    TEXT NOT NULL DEFAULT 'RSD',
      date        DATE NOT NULL,
      category    TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Migrations for existing tables
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`).catch(() => {});
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'RSD'`).catch(() => {});

  console.log("Database ready.");
}

// ── Auth routes ─────────────────────────────────────────────────────────────

app.get("/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

app.get("/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/?error=auth_failed" }),
  (req, res) => res.redirect("/expenses.html")
);

// POST only, so a third-party page cannot log users out with a plain link or image.
app.post("/auth/logout", (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.redirect(303, "/expenses.html");
    });
  });
});

app.get("/auth/me", (req, res) => {
  if (req.isAuthenticated()) {
    const { id, name, email, avatar } = req.user;
    res.json({ id, name, email, avatar });
  } else {
    res.status(401).json(null);
  }
});

// ── Expense API (protected) ──────────────────────────────────────────────────

app.get("/api/expenses", requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM expenses WHERE user_id = $1 ORDER BY date DESC, created_at DESC",
    [req.user.id]
  );
  res.json(rows.map(r => ({ ...r, date: r.date.toISOString().split("T")[0] })));
}));

app.post("/api/expenses", requireAuth, wrap(async (req, res) => {
  const { value, error } = validateExpense(req.body);
  if (error) return res.status(400).json({ error });

  const { rows } = await pool.query(
    `INSERT INTO expenses (user_id, amount, currency, date, category, description)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [req.user.id, value.amount, value.currency, value.date, value.category, value.description]
  );
  const r = rows[0];
  res.status(201).json({ ...r, date: r.date.toISOString().split("T")[0] });
}));

app.delete("/api/expenses/:id", requireAuth, wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "Invalid expense id." });
  await pool.query(
    "DELETE FROM expenses WHERE id = $1 AND user_id = $2",
    [req.params.id, req.user.id]
  );
  res.status(204).end();
}));

app.delete("/api/expenses", requireAuth, wrap(async (req, res) => {
  await pool.query("DELETE FROM expenses WHERE user_id = $1", [req.user.id]);
  res.status(204).end();
}));

app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

// Static files last (only public/, never the project root)
app.use(express.static(path.join(__dirname, "public")));

// ── Error handling ──────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  // Malformed or oversized request bodies from express.json
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON." });
  if (err.type === "entity.too.large") return res.status(413).json({ error: "Request body too large." });

  console.error(`${req.method} ${req.originalUrl} failed:`, err);
  res.status(500).json({ error: "Internal server error." });
});

module.exports = { app, init, pool, sessionStore, port, BASE_URL };
