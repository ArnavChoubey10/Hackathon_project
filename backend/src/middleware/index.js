/* Authentication (JWT), RBAC and audit middleware. */
const jwt = require("jsonwebtoken");
const env = require("../config/env");
const { db } = require("../config/db");

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** Verify Bearer token → attach req.user { id, role, studentId, facultyId }. */
function auth(req, _res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, "Not signed in. Please log in."));
  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch (e) {
    return next(new HttpError(401, e.name === "TokenExpiredError" ? "Session expired. Please log in again." : "Invalid session token."));
  }
  req.user = payload;
  next();
}

/** rbac("ADMIN") / rbac("ADMIN","FACULTY") — role gate. */
function rbac(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, "Not signed in."));
    if (!roles.includes(req.user.role)) return next(new HttpError(403, "You are not authorized to perform this action."));
    next();
  };
}

/** Resolve the authenticated student record. Identity ALWAYS comes from the
    JWT — never from body/params supplied by the client. */
function requireStudent(req, _res, next) {
  if (!req.user || req.user.role !== "STUDENT") return next(new HttpError(403, "Student access required."));
  const student = db.get("SELECT * FROM students WHERE id = ?", [req.user.studentId]);
  if (!student) return next(new HttpError(403, "Student identity missing."));
  req.student = student;
  next();
}

function requireFaculty(req, _res, next) {
  if (!req.user || req.user.role !== "FACULTY") return next(new HttpError(403, "Faculty access required."));
  const fac = db.get("SELECT * FROM faculty WHERE id = ?", [req.user.facultyId]);
  if (!fac) return next(new HttpError(403, "Faculty identity missing."));
  req.faculty = fac;
  next();
}

/** Append a row to audit_logs for mutating requests (best-effort). */
function audit(req, res, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  res.on("finish", () => {
    try {
      db.run(
        "INSERT INTO audit_logs (actor, role, method, path, status) VALUES (?,?,?,?,?)",
        [req.user ? `user:${req.user.id}` : "anonymous", req.user ? req.user.role : null, req.method, req.path, res.statusCode]
      );
    } catch { /* auditing must never break a request */ }
  });
  next();
}

module.exports = { HttpError, auth, rbac, requireStudent, requireFaculty, audit };
