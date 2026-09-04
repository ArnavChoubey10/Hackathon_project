/* ============================================================================
   Database layer — engine abstraction.
   Today: SQLite via better-sqlite3. Tomorrow: PostgreSQL.
   All modules use db.all / db.get / db.run with `?` placeholders only —
   no SQLite-specific syntax in module code, so swapping the engine is a
   change confined to this file (+ dialect-specific SQL in db/schema.sql).
   ========================================================================= */
const path = require("path");
const env = require("./env");

let engine;
let dialect = "sqlite";

function init() {
  if (engine) return engine;
  if (/^postgres(ql)?:\/\//i.test(env.DATABASE_URL)) {
    // PostgreSQL-ready hook. To activate later:
    //   1. npm i pg  2. implement the same 4 methods below  3. set DATABASE_URL
    throw new Error(
      "PostgreSQL support is architected but not bundled. Install `pg` and implement the adapter in src/config/db.js."
    );
  }
  const Database = require("better-sqlite3");
  const file = path.resolve(process.cwd(), env.DATABASE_URL.replace(/^\.\//, ""));
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  dialect = "sqlite";
  engine = {
    dialect,
    /** SELECT many */
    all: (sql, params = []) => sqlite.prepare(sql).all(...params),
    /** SELECT one */
    get: (sql, params = []) => sqlite.prepare(sql).get(...params),
    /** INSERT/UPDATE/DELETE — returns { changes, lastInsertRowid } */
    run: (sql, params = []) => {
      const info = sqlite.prepare(sql).run(...params);
      return { changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) };
    },
    /** Run fn inside a transaction (atomic batch writes). */
    transaction: (fn) => sqlite.transaction(fn)(),
    close: () => sqlite.close(),
  };
  return engine;
}

module.exports = { init, get db() { return init(); } };
