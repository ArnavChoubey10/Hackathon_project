/* Auth module — POST /api/auth/login | logout | GET /api/auth/me
   JWT issued here; bcrypt verification; role embedded in the token. */
const { Router } = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const env = require("../config/env");
const { db } = require("../config/db");
const { HttpError, auth } = require("../middleware");
const { h } = require("../middleware/errorHandler");

const router = Router();

router.post("/login", h(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) throw new HttpError(422, "Enter your email and password.");
  const user = db.get("SELECT * FROM users WHERE email = ?", [String(email).trim().toLowerCase()]);
  if (!user || !bcrypt.compareSync(String(password), user.pass_hash)) {
    throw new HttpError(401, "Invalid email or password.");
  }
  const token = jwt.sign(
    { id: user.id, role: user.role, studentId: user.student_id ?? null, facultyId: user.faculty_id ?? null },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  );
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}));

router.post("/logout", auth, (_req, res) => {
  // Stateless JWT: client discards the token. (A blocklist is the scale-up path.)
  res.json({ ok: true });
});

router.get("/me", auth, (req, res) => {
  const u = db.get("SELECT id,name,email,role,student_id,faculty_id FROM users WHERE id = ?", [req.user.id]);
  if (!u) throw new HttpError(401, "Account not found.");
  res.json({ id: u.id, name: u.name, email: u.email, role: u.role, studentId: u.student_id, facultyId: u.faculty_id });
});

module.exports = router;
