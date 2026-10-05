// Tests run against their own database so real data is never touched.
// Override with TEST_DATABASE_URL; the database name must end in "_test".
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || "postgres://localhost/expenses_test";

function testDbName(url = TEST_DATABASE_URL) {
  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!/^[A-Za-z0-9_]+_test$/.test(name)) {
    throw new Error(`Refusing to run tests against database "${name}": its name must end in "_test".`);
  }
  return name;
}

module.exports = { TEST_DATABASE_URL, testDbName };
