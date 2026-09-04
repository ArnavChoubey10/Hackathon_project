/* Centralized error handling — technical detail to server logs only. */
const { HttpError } = require("./index");

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  if (status >= 500) console.error(`[error] ${req.method} ${req.path}:`, err);
  else console.warn(`[warn] ${status} ${req.method} ${req.path}: ${err.message}`);
  res.status(status).json({
    error: status >= 500 ? "Something went wrong on the server. Please try again." : err.message,
    ...(status === 422 && err.fields ? { fields: err.fields } : {}),
  });
}

/** 404 for unknown /api routes. */
function notFound(_req, res) {
  res.status(404).json({ error: "Endpoint not found." });
}

/** Wrap async handlers so rejections reach errorHandler. */
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { errorHandler, notFound, h, HttpError };
