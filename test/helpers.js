const { promisify } = require("util");
const signature = require("cookie-signature");
const { pool, sessionStore, init } = require("../app");

const set = promisify(sessionStore.set.bind(sessionStore));

// Prepares the schema once per test file.
async function setupDb() {
  await init();
  // connect-pg-simple creates its table lazily on first use; touch it so cleanDb can rely on it.
  await promisify(sessionStore.get.bind(sessionStore))("test-sid-init");
}

// Creates a user plus a logged-in session (what the Google callback would do) and
// returns the Cookie header value to send with requests.
async function createUser(name) {
  const { rows } = await pool.query(
    "INSERT INTO users (google_id, email, name) VALUES ($1, $2, $3) RETURNING id",
    [`test-${name}`, `${name}@example.test`, name]
  );
  const id = rows[0].id;
  const sid = `test-sid-${name}-${Date.now()}`;
  await set(sid, {
    cookie: { originalMaxAge: 3600000, expires: new Date(Date.now() + 3600000).toISOString(), httpOnly: true, path: "/" },
    passport: { user: id },
  });
  const cookie = "connect.sid=" + encodeURIComponent("s:" + signature.sign(sid, process.env.SESSION_SECRET));
  return { id, name, cookie };
}

async function cleanDb() {
  await pool.query("DELETE FROM users WHERE google_id LIKE 'test-%'"); // expenses cascade
  await pool.query("DELETE FROM session WHERE sid LIKE 'test-sid-%'");
}

async function closeDb() {
  await pool.end();
}

const validExpense = (overrides = {}) => ({
  amount: 19.99,
  currency: "EUR",
  date: "2026-10-05",
  category: "food",
  description: "Lunch",
  ...overrides,
});

module.exports = { setupDb, createUser, cleanDb, closeDb, validExpense };
