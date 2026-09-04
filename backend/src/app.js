/* Express application — middleware chain + routes + error handling. */
const express = require("express");
const cors = require("cors");
const mountRoutes = require("./routes");
const { audit } = require("./middleware");
const { errorHandler, notFound } = require("./middleware/errorHandler");

function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors()); // tighten origins in production
  app.use(express.json({ limit: "256kb" }));
  app.use(audit);
  app.use("/api", mountRoutes());
  app.use("/api", notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
