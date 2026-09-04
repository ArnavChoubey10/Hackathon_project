/* Office module — fees, requests (state machine), notifications, broadcast. */
const { Router } = require("express");
const { db } = require("../config/db");
const { HttpError, auth, rbac, requireStudent } = require("../middleware");
const { h } = require("../middleware/errorHandler");
const L = require("../utils/logic");

const router = Router();
router.use(auth);

function notify(userId, title, body, kind) {
  if (!userId) return;
  db.run("INSERT INTO notifications (user_id,title,body,kind) VALUES (?,?,?,?)", [userId, title, body, kind]);
}

/* ================= fees ================= */

const feeView = (f) => {
  const s = db.get("SELECT name, reg_no FROM students WHERE id = ?", [f.student_id]);
  return {
    id: f.id, studentId: f.student_id, studentName: s?.name ?? "—", regNo: s?.reg_no ?? "—",
    semester: f.semester, description: f.description, total: f.total, paid: f.paid, dueDate: f.due_date,
    ...L.calculateFee(f.total, f.paid),
  };
};

router.get("/fees", rbac("ADMIN"), (_req, res) => {
  res.json(db.all("SELECT * FROM fees ORDER BY student_id").map(feeView));
});

router.get("/fees/me", requireStudent, (req, res) => {
  const rows = db.all("SELECT * FROM fees WHERE student_id = ?", [req.student.id]).map((f) => ({
    id: f.id, semester: f.semester, description: f.description, total: f.total, paid: f.paid, dueDate: f.due_date,
    ...L.calculateFee(f.total, f.paid),
  }));
  const total = rows.reduce((s, r) => s + r.total, 0);
  const paid = rows.reduce((s, r) => s + r.paid, 0);
  res.json({ rows, total, paid, ...L.calculateFee(total, paid) });
});

router.post("/fees", rbac("ADMIN"), h((req, res) => {
  const { studentId, semester, description, total, dueDate } = req.body || {};
  if (!studentId) throw new HttpError(422, "Select a student.");
  if (!(Number(total) > 0)) throw new HttpError(422, "Total fee must be greater than zero.");
  if (db.get("SELECT id FROM fees WHERE student_id = ? AND semester = ?", [studentId, semester])) {
    throw new HttpError(409, "A fee record for this student and semester already exists.");
  }
  const r = db.run("INSERT INTO fees (student_id,semester,description,total,paid,due_date) VALUES (?,?,?,?,'0',?)",
    [studentId, Number(semester) || 1, description || "Semester fees", Number(total), dueDate || null]);
  const st = db.get("SELECT user_id, name FROM students WHERE id = ?", [studentId]);
  notify(st?.user_id, "New fee record created", `${description || "Semester fees"} — ₹${Number(total).toLocaleString("en-IN")} for semester ${semester}.`, "INFO");
  res.status(201).json({ id: r.lastInsertRowid });
}));

router.post("/fees/:id/pay", rbac("ADMIN"), h((req, res) => {
  const f = db.get("SELECT * FROM fees WHERE id = ?", [req.params.id]);
  if (!f) throw new HttpError(404, "Fee record not found.");
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(422, "Enter a valid payment amount.");
  if (f.paid + amount > f.total) throw new HttpError(422, `Payment exceeds balance. Due amount is ₹${(f.total - f.paid).toLocaleString("en-IN")}.`);
  db.run("UPDATE fees SET paid = paid + ? WHERE id = ?", [amount, f.id]);
  const st = db.get("SELECT user_id FROM students WHERE id = ?", [f.student_id]);
  const { due, status } = L.calculateFee(f.total, f.paid + amount);
  notify(st?.user_id, "Fee payment recorded",
    `₹${amount.toLocaleString("en-IN")} received. ${status === "PAID" ? "Your fees are fully paid." : `Balance due: ₹${due.toLocaleString("en-IN")}.`}`,
    status === "PAID" ? "SUCCESS" : "INFO");
  res.json({ ok: true, ...L.calculateFee(f.total, f.paid + amount) });
}));

/* ================= requests ================= */

const REQUEST_TYPES = ["LEAVE", "ACADEMIC", "BONAFIDE", "DOCUMENT", "GENERAL"];
const ALLOWED = { PENDING: ["APPROVED", "REJECTED"], APPROVED: ["COMPLETED"], REJECTED: [], COMPLETED: [] };

const reqView = (r) => {
  const s = db.get("SELECT name, reg_no FROM students WHERE id = ?", [r.student_id]);
  return {
    id: r.id, studentId: r.student_id, studentName: s?.name ?? "—", regNo: s?.reg_no ?? "—",
    type: r.type, subject: r.subject, body: r.body, status: r.status, note: r.note,
    createdAt: r.created_at, decidedAt: r.decided_at,
  };
};

router.get("/requests", rbac("ADMIN"), (_req, res) => {
  res.json(db.all("SELECT * FROM requests ORDER BY created_at DESC").map(reqView));
});

router.get("/requests/me", requireStudent, (req, res) => {
  res.json(db.all("SELECT * FROM requests WHERE student_id = ? ORDER BY created_at DESC", [req.student.id]).map(reqView));
});

router.post("/requests", requireStudent, h((req, res) => {
  const { type, subject, body } = req.body || {};
  if (!REQUEST_TYPES.includes(type)) throw new HttpError(422, "Choose a valid request type.");
  if (!subject?.trim() || !body?.trim()) throw new HttpError(422, "Subject and details are required.");
  const r = db.run("INSERT INTO requests (student_id,type,subject,body) VALUES (?,?,?,?)",
    [req.student.id, type, subject.trim(), body.trim()]);
  res.status(201).json({ id: r.lastInsertRowid });
}));

router.patch("/requests/:id", rbac("ADMIN"), h((req, res) => {
  const r = db.get("SELECT * FROM requests WHERE id = ?", [req.params.id]);
  if (!r) throw new HttpError(404, "Request not found.");
  const { status, note } = req.body || {};
  if (!ALLOWED[r.status].includes(status)) throw new HttpError(409, `Cannot move a ${r.status} request to ${status}.`);
  db.run("UPDATE requests SET status = ?, note = COALESCE(?, note), decided_at = datetime('now') WHERE id = ?", [status, note ?? null, r.id]);
  const st = db.get("SELECT user_id FROM students WHERE id = ?", [r.student_id]);
  notify(st?.user_id, `Request ${status.toLowerCase()} — ${r.subject}`,
    status === "REJECTED" ? (note || "Your request was rejected.") : (note || `Your request is now ${status.toLowerCase()}.`),
    status === "REJECTED" ? "DANGER" : "SUCCESS");
  res.json({ ok: true });
}));

/* ================= notifications ================= */

router.get("/notifications/unread-count", (req, res) => {
  res.json(db.get("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read = 0", [req.user.id]).n);
});

router.get("/notifications", (req, res) => {
  res.json(db.all("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100", [req.user.id])
    .map((n) => ({ id: n.id, title: n.title, body: n.body, kind: n.kind, read: !!n.read, createdAt: n.created_at })));
});

router.post("/notifications/read-all", (req, res) => {
  db.run("UPDATE notifications SET read = 1 WHERE user_id = ?", [req.user.id]);
  res.json({ ok: true });
});

router.post("/notifications/:id/read", h((req, res) => {
  const n = db.get("SELECT * FROM notifications WHERE id = ?", [req.params.id]);
  if (!n) throw new HttpError(404, "Notification not found.");
  if (n.user_id !== req.user.id) throw new HttpError(403, "Not your notification."); // isolation
  db.run("UPDATE notifications SET read = 1 WHERE id = ?", [n.id]);
  res.json({ ok: true });
}));

router.post("/notifications/broadcast", rbac("ADMIN"), h((req, res) => {
  const { title, body, audience } = req.body || {};
  if (!title?.trim() || !body?.trim()) throw new HttpError(422, "Title and message are required.");
  const targets = audience === "ALL"
    ? db.all("SELECT id FROM users")
    : db.all("SELECT id FROM users WHERE role = ?", [audience === "STUDENTS" ? "STUDENT" : "FACULTY"]);
  for (const t of targets) notify(t.id, title.trim(), body.trim(), "INFO");
  res.json({ sent: targets.length });
}));

module.exports = router;
