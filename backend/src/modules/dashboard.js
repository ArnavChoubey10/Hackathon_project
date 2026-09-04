/* Dashboard aggregates, global search, demo reset — all computed from live data. */
const { Router } = require("express");
const { execFileSync } = require("child_process");
const path = require("path");
const { db } = require("../config/db");
const { HttpError, auth, rbac, requireStudent, requireFaculty } = require("../middleware");
const { h } = require("../middleware/errorHandler");
const L = require("../utils/logic");
const { buildProfile } = require("./academicProfile");

const router = Router();
router.use(auth);

router.get("/dashboard/admin", rbac("ADMIN"), (req, res) => {
  const students = db.all("SELECT * FROM students");
  const allAtt = L.calculateAttendance(db.all("SELECT status FROM attendance").map((r) => r.status));
  const below75 = students.map((s) => {
    const att = L.calculateAttendance(db.all("SELECT status FROM attendance WHERE student_id = ?", [s.id]).map((r) => r.status));
    return { student: s, att };
  }).filter((p) => p.att.total > 0 && p.att.percentage < L.ATTENDANCE_THRESHOLD);
  const fees = db.all("SELECT total, paid FROM fees");
  const feesTotal = fees.reduce((s, f) => s + f.total, 0);
  const feesPaid = fees.reduce((s, f) => s + f.paid, 0);
  const pcts = db.all(`SELECT sc.marks, a.max_marks FROM assessment_scores sc JOIN assessments a ON a.id = sc.assessment_id`)
    .map((r) => L.pctOf(r.marks, r.max_marks));
  const courseAttendance = db.all("SELECT * FROM courses ORDER BY code").map((c) => {
    const att = L.calculateAttendance(db.all("SELECT status FROM attendance WHERE course_id = ?", [c.id]).map((r) => r.status));
    return { id: c.id, code: c.code, name: c.name, ...att };
  });
  const feeRows = db.all("SELECT total, paid FROM fees").map((f) => L.calculateFee(f.total, f.paid).status);
  res.json({
    totalStudents: students.length,
    activeStudents: students.filter((s) => s.status === "ACTIVE").length,
    totalFaculty: db.get("SELECT COUNT(*) n FROM faculty").n,
    totalCourses: db.get("SELECT COUNT(*) n FROM courses").n,
    avgAttendance: allAtt.percentage,
    below75Count: below75.length,
    below75: below75.map((p) => ({ id: p.student.id, name: p.student.name, regNo: p.student.reg_no, percentage: p.att.percentage, risk: p.att.risk })),
    feesCollected: feesPaid, feesPending: feesTotal - feesPaid, feesTotal,
    pendingRequests: db.get("SELECT COUNT(*) n FROM requests WHERE status = 'PENDING'").n,
    avgMarks: pcts.length ? L.round1(pcts.reduce((s, v) => s + v, 0) / pcts.length) : 0,
    unreadNotifications: db.get("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read = 0", [req_user_id()]).n,
    courseAttendance,
    feeStatusCounts: {
      PAID: feeRows.filter((s) => s === "PAID").length,
      PARTIAL: feeRows.filter((s) => s === "PARTIAL").length,
      PENDING: feeRows.filter((s) => s === "PENDING").length,
    },
    recentActivity: db.all("SELECT actor || ' — ' || path AS text, at FROM audit_logs ORDER BY id DESC LIMIT 8")
      .map((r) => ({ id: r.at, at: r.at, text: r.text, actor: "Audit" })),
  });
  function req_user_id() { return arguments.callee.caller ? 0 : 0; }
});

router.get("/dashboard/faculty", requireFaculty, (req, res) => {
  const fid = req.faculty.id;
  const myCourses = db.all("SELECT * FROM courses WHERE faculty_id = ? ORDER BY code", [fid]);
  const ids = myCourses.map((c) => c.id);
  const placeholders = ids.length ? ids.map(() => "?").join(",") : "NULL";
  const studentIds = new Set(db.all(`SELECT student_id FROM enrollments WHERE course_id IN (${placeholders})`, ids).map((e) => e.student_id));
  const att = L.calculateAttendance(db.all(`SELECT status FROM attendance WHERE course_id IN (${placeholders})`, ids).map((r) => r.status));
  const todayDow = new Date().getDay();
  const todayClasses = db.all(`SELECT t.*, c.code, c.name FROM timetable t JOIN courses c ON c.id = t.course_id
    WHERE t.day = ? AND t.course_id IN (${placeholders}) ORDER BY t.start`, [todayDow, ...ids])
    .map((t) => ({ id: t.id, courseId: t.course_id, day: t.day, start: t.start, end: t.end, room: t.room, course: { code: t.code, name: t.name } }));
  let pendingGrading = 0;
  for (const c of myCourses) {
    if (c.type === "LAB" || c.type === "PROJECT") continue;
    const enrolled = db.all("SELECT student_id FROM enrollments WHERE course_id = ?", [c.id]).map((e) => e.student_id);
    const graded = new Set(db.all(`SELECT sc.student_id FROM assessment_scores sc JOIN assessments a ON a.id = sc.assessment_id WHERE a.course_id = ? AND a.type = 'FAT'`, [c.id]).map((r) => r.student_id));
    pendingGrading += enrolled.filter((sid) => !graded.has(sid)).length;
  }
  res.json({
    courses: myCourses.map((c) => {
      const cAtt = L.calculateAttendance(db.all("SELECT status FROM attendance WHERE course_id = ?", [c.id]).map((r) => r.status));
      const cPcts = db.all(`SELECT sc.marks, a.max_marks FROM assessment_scores sc JOIN assessments a ON a.id = sc.assessment_id WHERE a.course_id = ?`, [c.id]).map((r) => L.pctOf(r.marks, r.max_marks));
      return { ...c, facultyId: c.faculty_id, departmentId: c.department_id, enrolled: db.get("SELECT COUNT(*) n FROM enrollments WHERE course_id = ?", [c.id]).n, attendance: cAtt, classAverage: cPcts.length ? L.calculateClassAverage(cPcts) : null };
    }),
    totalStudents: studentIds.size,
    avgAttendance: att.percentage,
    attendanceTotal: att.total,
    todayClasses,
    pendingGrading,
    recentActivity: db.all("SELECT actor || ' — ' || path AS text, at FROM audit_logs ORDER BY id DESC LIMIT 6")
      .map((r) => ({ id: r.at, at: r.at, text: r.text, actor: "Audit" })),
  });
});

router.get("/dashboard/student", requireStudent, (req, res) => {
  const profile = buildProfile(req.student.id);
  const notices = db.all("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 5", [req.user.id])
    .map((n) => ({ id: n.id, title: n.title, body: n.body, kind: n.kind, read: !!n.read, createdAt: n.created_at }));
  res.json({ profile, recentNotifications: notices, openAssignments: profile.actions.filter((a) => a.kind === "assignment").length });
});

/* ---------------- search ---------------- */
router.get("/search", rbac("ADMIN", "FACULTY"), (req, res) => {
  const needle = String(req.query.q || "").trim().toLowerCase();
  if (!needle) return res.json({ students: [], courses: [], faculty: [] });
  const like = `%${needle}%`;
  res.json({
    students: db.all("SELECT id, name, reg_no FROM students WHERE LOWER(name) LIKE ? OR LOWER(reg_no) LIKE ? LIMIT 5", [like, like]).map((s) => ({ id: s.id, label: s.name, sub: s.reg_no })),
    courses: db.all("SELECT id, name, code FROM courses WHERE LOWER(name) LIKE ? OR LOWER(code) LIKE ? LIMIT 5", [like, like]).map((c) => ({ id: c.id, label: c.name, sub: c.code })),
    faculty: db.all("SELECT id, name, designation FROM faculty WHERE LOWER(name) LIKE ? LIMIT 5", [like]).map((f) => ({ id: f.id, label: f.name, sub: f.designation })),
  });
});

/* ---------------- demo reset (ADMIN) ---------------- */
router.post("/admin/reset-demo", rbac("ADMIN"), h((_req, res) => {
  execFileSync(process.execPath, [path.join(__dirname, "..", "..", "db", "seed.js"), "--reset"], { stdio: "pipe" });
  res.json({ ok: true });
}));

module.exports = router;
