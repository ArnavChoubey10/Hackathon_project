/* Entry point — boots config, database, seed check, HTTP server. */
const env = require("./config/env");
const { init } = require("./config/db");
const { createApp } = require("./app");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const db = init();
db.run(fs.readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf8"));

// First run → seed demo data automatically.
const { n } = db.get("SELECT COUNT(*) AS n FROM users");
if (n === 0) {
  console.log("Empty database detected — seeding demo data…");
  execFileSync(process.execPath, [path.join(__dirname, "..", "db", "seed.js")], { stdio: "inherit" });
}

const app = createApp();
app.listen(env.PORT, () => {
  console.log(`CampusCore API listening on http://localhost:${env.PORT}  (SQLite: ${env.DATABASE_URL})`);
  console.log("Demo accounts (password demo123): admin@college.edu · faculty@college.edu · aarav@college.edu");
});
