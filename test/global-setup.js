const { Client } = require("pg");
const { TEST_DATABASE_URL, testDbName } = require("./db-url");

// Creates the test database if it does not exist yet.
module.exports = async function globalSetup() {
  const name = testDbName();
  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = "/postgres";

  const client = new Client({ connectionString: adminUrl.toString() });
  try {
    await client.connect();
  } catch (err) {
    throw new Error(`Cannot connect to PostgreSQL to prepare the test database (${err.message || err.code}). Is it running?`);
  }
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (!rowCount) await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }
};
