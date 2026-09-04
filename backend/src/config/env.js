/* Central environment configuration — the only place process.env is read. */
require("dotenv").config();

const env = {
  PORT: Number(process.env.PORT || 4000),
  NODE_ENV: process.env.NODE_ENV || "development",
  DATABASE_URL: process.env.DATABASE_URL || "./campuscore.db",
  JWT_SECRET: process.env.JWT_SECRET || "",
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "12h",
  AI_MODE: process.env.AI_MODE || "local",
  AI_API_KEY: process.env.AI_API_KEY || "",
  AI_MODEL: process.env.AI_MODEL || "gpt-4o-mini",
  AI_BASE_URL: process.env.AI_BASE_URL || "https://api.openai.com/v1",
};

if (!env.JWT_SECRET) {
  if (env.NODE_ENV === "production") {
    console.error("FATAL: JWT_SECRET must be set in production.");
    process.exit(1);
  }
  env.JWT_SECRET = "dev-only-secret-do-not-use-in-production";
  console.warn("warn: JWT_SECRET not set — using an insecure development secret.");
}

module.exports = env;
