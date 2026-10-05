require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);

const app = express();
const port = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${port}`;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Sessions stored in PostgreSQL
app.use(session({
  store: new PgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || "dev-secret-change-in-production",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }, // 30 days
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

app.get("/auth/logout", (req, res) => {
  req.logout(() => res.redirect("/expenses.html"));
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

app.get("/api/expenses", requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM expenses WHERE user_id = $1 ORDER BY date DESC, created_at DESC",
    [req.user.id]
  );
  res.json(rows.map(r => ({ ...r, date: r.date.toISOString().split("T")[0] })));
});

app.post("/api/expenses", requireAuth, async (req, res) => {
  const { amount, date, category, description, currency } = req.body;
  if (!amount || !date || !category || !description || !currency) {
    return res.status(400).json({ error: "All fields required." });
  }
  const { rows } = await pool.query(
    `INSERT INTO expenses (user_id, amount, currency, date, category, description)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [req.user.id, amount, currency, date, category, description]
  );
  const r = rows[0];
  res.status(201).json({ ...r, date: r.date.toISOString().split("T")[0] });
});

app.delete("/api/expenses/:id", requireAuth, async (req, res) => {
  await pool.query(
    "DELETE FROM expenses WHERE id = $1 AND user_id = $2",
    [req.params.id, req.user.id]
  );
  res.status(204).end();
});

app.delete("/api/expenses", requireAuth, async (req, res) => {
  await pool.query("DELETE FROM expenses WHERE user_id = $1", [req.user.id]);
  res.status(204).end();
});

// Static files last
app.use(express.static(path.join(__dirname, "public")));

init().then(() => {
  app.listen(port, () => console.log(`Server running on ${BASE_URL}`));
});
