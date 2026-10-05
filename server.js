const { app, init, port, BASE_URL } = require("./app");

init()
  .then(() => app.listen(port, () => console.log(`Server running on ${BASE_URL}`)))
  .catch(err => {
    console.error("Startup failed:", err.message || err.code || err);
    process.exit(1);
  });
