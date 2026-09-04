/* Catalog module — departments, programs, faculty, students, courses.
   Routes → handlers (controllers) → service fns → db. Admin-only mutations. */
const { Router } = require("express");
const bcrypt = require("bcryptjs");
const { db } = require("../config/db");
const { HttpError, auth, rbac, requireFaculty } = require("../middleware");
const { h } = require("../middleware/errorHandler");
const { round1, calculateAttendance, calculateClassAverage, pctOf } = require("../utils/logic");

const router = Router();
router.use(auth);

const mapStudent = (s) => ({
  id: s.id, name: s.name, regNo: s.reg_no, email: s.email, phone: s.phone,
  departmentId: s.department_id, program: s.program, branch: s.branch, semester: s.semester,
  section: s.section, batch: s.batch, admissionYear: s.admission_year, status: s.status, userId: s.user_id,
});

/* ---------------- departments ---------------- */
router.get("/departments", (_req, res) => res.json(db.all("SELECT id,name,code FROM departments ORDER BY id")));
router.post("/departments", rbac("ADMIN"), h((req, res) => {
  const { name, code } = req.body || {};
  if (!name?.trim() || !code?.trim()) throw new HttpError(422, "Name and code are required.");
  if (db.get("SELECT id FROM departments WHERE code = ?", [code.trim().toUpperCase()])) throw new HttpError(409, "Department code already exists.");
  const r = db.run("INSERT INTO departments (name,code) VALUES (?,?)", [name.trim(), code.trim().toUpperCase()]);
  res.status(201).json({ id: r.lastInsertRowid, name: name.trim(), code: code.trim().toUpperCase() });
}));
router.delete("/departments/:id", rbac("ADMIN"), h((req, res) => {
  const used = db.get("SELECT COUNT(*) n FROM students WHERE department_id = ?", [req.params.id]).n
    + db.get("SELECT COUNT(*) n FROM courses WHERE department_id = ?", [req.params.id]).n;
  if (used > 0) throw new HttpError(409, "Department is in use and cannot be deleted.");
  db.run("DELETE FROM departments WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
}));

/* ---------------- programs ---------------- */
router.get("/programs", (_req, res) => res.json(db.all(`
  SELECT p.id, p.name, p.level, p.duration_years AS durationYears, p.department_id AS departmentId,
         d.code AS departmentCode
  FROM programs p LEFT JOIN departments d ON d.id = p.department_id ORDER BY p.id`)));
router.post("/programs", rbac("ADMIN"), h((req, res) => {
  const { name, level, durationYears, departmentId } = req.body || {};
  if (!name?.trim() || !["UNDERGRADUATE", "POSTGRADUATE", "DIPLOMA"].includes(level)) throw new HttpError(422, "Name and a valid level are required.");
  const r = db.run("INSERT INTO programs (name,level,duration_years,department_id) VALUES (?,?,?,?)",
    [name.trim(), level, Number(durationYears) || 4, departmentId || null]);
  res.status(201).json({ id: r.lastInsertRowid });
}));
router.delete("/programs/:id", rbac("ADMIN"), h((req, res) => {
  db.run("DELETE FROM programs WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
}));

/* ---------------- faculty ---------------- */
router.get("/faculty", rbac("ADMIN", "FACULTY", "STUDENT"), (_req, res) => {
  res.json(db.all(`SELECT f.id, f.name, f.email, f.phone, f.department_id AS departmentId, f.designation,
      d.name AS department,
      (SELECT COUNT(*) FROM courses c WHERE c.faculty_id = f.id) AS courseCount
    FROM faculty f LEFT JOIN departments d ON d.id = f.department_id ORDER BY f.id`));
});
router.put("/faculty/:id", rbac("ADMIN"), h((req, res) => {
  const f = db.get("SELECT * FROM faculty WHERE id = ?", [req.params.id]);
  if (!f) throw new HttpError(404, "Faculty member not found.");
  const p = req.body || {};
  db.run(`UPDATE faculty SET name=COALESCE(?,name), phone=COALESCE(?,phone), department_id=COALESCE(?,department_id), designation=COALESCE(?,designation) WHERE id=?`,
    [p.name ?? null, p.phone ?? null, p.departmentId ?? null, p.designation ?? null, f.id]);
  res.json({ ok: true });
}));

router.post("/faculty", rbac("ADMIN"), h((req, res) => {
  const { name, email, phone, departmentId, designation, makeLogin } = req.body || {};
  if (!name?.trim() || !email?.trim()) throw new HttpError(422, "Name and email are required.");
  if (db.get("SELECT id FROM faculty WHERE email = ?", [email.trim().toLowerCase()])) throw new HttpError(409, "A faculty member with this email exists.");
  let userId = null;
  if (makeLogin) {
    if (db.get("SELECT id FROM users WHERE email = ?", [email.trim().toLowerCase()])) throw new HttpError(409, "A login account with this email already exists.");
    userId = db.run("INSERT INTO users (name,email,pass_hash,role) VALUES (?,?,'FACULTY-placeholder','FACULTY')", [name.trim(), email.trim().toLowerCase()]).lastInsertRowid;
    db.run("UPDATE users SET pass_hash = ? WHERE id = ?", [bcrypt.hashSync("demo123", 10), userId]);
  }
  const r = db.run("INSERT INTO faculty (user_id,name,email,phone,department_id,designation) VALUES (?,?,?,?,?,?)",
    [userId, name.trim(), email.trim().toLowerCase(), phone || null, departmentId || null, designation || null]);
  if (userId) db.run("UPDATE users SET faculty_id = ? WHERE id = ?", [r.lastInsertRowid, userId]);
  res.status(201).json({ id: r.lastInsertRowid });
}));

/* ---------------- own profile (self-service, identity from JWT) ---------------- */
router.put("/profile/me", h((req, res) => {
  if (req.user.role !== "STUDENT") throw new HttpError(403, "Only students use this endpoint.");
  const phone = String(req.body?.phone ?? "").trim();
  db.run("UPDATE students SET phone = ? WHERE id = ?", [phone || null, req.user.studentId]);
  res.json({ ok: true });
}));

/* ---------------- students ---------------- */
router.get("/students", rbac("ADMIN", "FACULTY"), (req, res) => {
  const { q, departmentId, semester, section } = req.query;
  let sql = "SELECT * FROM students WHERE 1=1";
  const p = [];
  if (q) { sql += " AND (LOWER(name) LIKE ? OR LOWER(reg_no) LIKE ? OR LOWER(email) LIKE ?)"; const like = `%${String(q).toLowerCase()}%`; p.push(like, like, like); }
  if (departmentId) { sql += " AND department_id = ?"; p.push(departmentId); }
  if (semester !== undefined && semester !== "") { sql += " AND semester = ?"; p.push(Number(semester)); }
  if (section) { sql += " AND section = ?"; p.push(section); }
  sql += " ORDER BY reg_no";
  res.json(db.all(sql, p).map(mapStudent));
});

router.get("/students/:id", rbac("ADMIN", "FACULTY"), h((req, res) => {
  const s = db.get("SELECT * FROM students WHERE id = ?", [req.params.id]);
  if (!s) throw new HttpError(404, "Student not found.");
  res.json(mapStudent(s));
}));

router.post("/students", rbac("ADMIN"), h((req, res) => {
  const { name, regNo, email, phone, departmentId, program, branch, semester, section, batch, admissionYear, autoEnroll } = req.body || {};
  if (!name?.trim() || !regNo?.trim() || !email?.trim()) throw new HttpError(422, "Name, registration number and email are required.");
  if (db.get("SELECT id FROM students WHERE reg_no = ?", [regNo.trim().toUpperCase()])) throw new HttpError(409, `Registration number ${regNo} already exists.`);
  if (db.get("SELECT id FROM users WHERE email = ?", [email.trim().toLowerCase()])) throw new HttpError(409, "A login account with this email already exists.");
  db.transaction(() => {
    const sid = db.run(`INSERT INTO students (name,reg_no,email,phone,department_id,program,branch,semester,section,batch,admission_year,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'ACTIVE')`,
      [name.trim(), regNo.trim().toUpperCase(), email.trim().toLowerCase(), phone || null, departmentId || null,
       program || "B.Tech", branch || null, Number(semester) || 1, section || null, batch || null, Number(admissionYear) || new Date().getFullYear()]).lastInsertRowid;
    const uid = db.run("INSERT INTO users (name,email,pass_hash,role,student_id) VALUES (?,?,?,'STUDENT',?)",
      [name.trim(), email.trim().toLowerCase(), bcrypt.hashSync("demo123", 10), sid]).lastInsertRowid;
    db.run("UPDATE students SET user_id = ? WHERE id = ?", [uid, sid]);
    if (autoEnroll) {
      const courses = db.all("SELECT id FROM courses WHERE semester = ?", [Number(semester) || 1]);
      for (const c of courses) db.run("INSERT OR IGNORE INTO enrollments (student_id,course_id) VALUES (?,?)", [sid, c.id]);
    }
    res.status(201).json({ id: sid });
  });
}));

router.put("/students/:id", rbac("ADMIN"), h((req, res) => {
  const s = db.get("SELECT * FROM students WHERE id = ?", [req.params.id]);
  if (!s) throw new HttpError(404, "Student not found.");
  const p = req.body || {};
  if (p.regNo && p.regNo !== s.reg_no && db.get("SELECT id FROM students WHERE reg_no = ?", [p.regNo.toUpperCase()])) {
    throw new HttpError(409, "That registration number is already in use.");
  }
  db.run(`UPDATE students SET name=COALESCE(?,name), reg_no=COALESCE(?,reg_no), phone=COALESCE(?,phone),
    department_id=COALESCE(?,department_id), program=COALESCE(?,program), branch=COALESCE(?,branch),
    semester=COALESCE(?,semester), section=COALESCE(?,section), batch=COALESCE(?,batch),
    admission_year=COALESCE(?,admission_year), status=COALESCE(?,status) WHERE id=?`,
    [p.name ?? null, p.regNo ? p.regNo.toUpperCase() : null, p.phone ?? null, p.departmentId ?? null, p.program ?? null,
     p.branch ?? null, p.semester ?? null, p.section ?? null, p.batch ?? null, p.admissionYear ?? null, p.status ?? null, s.id]);
  if (p.name && s.user_id) db.run("UPDATE users SET name = ? WHERE id = ?", [p.name, s.user_id]);
  res.json({ ok: true });
}));

router.delete("/students/:id", rbac("ADMIN"), h((req, res) => {
  const s = db.get("SELECT * FROM students WHERE id = ?", [req.params.id]);
  if (!s) throw new HttpError(404, "Student not found.");
  db.transaction(() => {
    if (s.user_id) db.run("DELETE FROM users WHERE id = ?", [s.user_id]);
    db.run("DELETE FROM students WHERE id = ?", [s.id]); // cascades enrollments/attendance/scores/fees/requests
  });
  res.json({ ok: true });
}));

/* ---------------- courses ---------------- */
const courseWithStats = (c) => {
  const enrolled = db.get("SELECT COUNT(*) n FROM enrollments WHERE course_id = ?", [c.id]).n;
  const att = calculateAttendance(db.all("SELECT status FROM attendance WHERE course_id = ?", [c.id]).map((r) => r.status));
  const pcts = db.all(`SELECT sc.marks, a.max_marks FROM assessment_scores sc JOIN assessments a ON a.id = sc.assessment_id WHERE a.course_id = ?`, [c.id]).map((r) => pctOf(r.marks, r.max_marks));
  const f = db.get("SELECT name FROM faculty WHERE id = ?", [c.faculty_id]);
  return {
    id: c.id, code: c.code, name: c.name, facultyId: c.faculty_id, departmentId: c.department_id,
    credits: c.credits, semester: c.semester, type: c.type, difficulty: c.difficulty,
    facultyName: f?.name ?? "—", enrolled, attendancePct: att.percentage,
    classAverage: pcts.length ? calculateClassAverage(pcts) : null,
  };
};

router.get("/courses", (_req, res) => {
  res.json(db.all("SELECT * FROM courses ORDER BY code").map(courseWithStats));
});

router.get("/courses/my-teaching", requireFaculty, (req, res) => {
  res.json(db.all("SELECT * FROM courses WHERE faculty_id = ? ORDER BY code", [req.faculty.id]).map(courseWithStats));
});

router.get("/courses/:id", h((req, res) => {
  const c = db.get("SELECT * FROM courses WHERE id = ?", [req.params.id]);
  if (!c) throw new HttpError(404, "Course not found.");
  const students = db.all(`SELECT s.id, s.name, s.reg_no FROM enrollments e JOIN students s ON s.id = e.student_id WHERE e.course_id = ? ORDER BY s.reg_no`, [c.id])
    .map((s) => ({ id: s.id, name: s.name, regNo: s.reg_no }));
  res.json({ ...courseWithStats(c), students });
}));

router.post("/courses", rbac("ADMIN"), h((req, res) => {
  const { code, name, facultyId, departmentId, credits, semester, type, difficulty } = req.body || {};
  if (!code?.trim() || !name?.trim()) throw new HttpError(422, "Course code and name are required.");
  if (db.get("SELECT id FROM courses WHERE code = ?", [code.trim().toUpperCase()])) throw new HttpError(409, `Course code ${code} already exists.`);
  const r = db.run("INSERT INTO courses (code,name,faculty_id,department_id,credits,semester,type,difficulty) VALUES (?,?,?,?,?,?,?,?)",
    [code.trim().toUpperCase(), name.trim(), facultyId || null, departmentId || null, Number(credits) || 3, Number(semester) || 1, type || "CORE", difficulty || "MEDIUM"]);
  res.status(201).json({ id: r.lastInsertRowid });
}));

router.put("/courses/:id", rbac("ADMIN"), h((req, res) => {
  const c = db.get("SELECT * FROM courses WHERE id = ?", [req.params.id]);
  if (!c) throw new HttpError(404, "Course not found.");
  const p = req.body || {};
  db.run(`UPDATE courses SET code=COALESCE(?,code), name=COALESCE(?,name), faculty_id=COALESCE(?,faculty_id),
    department_id=COALESCE(?,department_id), credits=COALESCE(?,credits), semester=COALESCE(?,semester),
    type=COALESCE(?,type), difficulty=COALESCE(?,difficulty) WHERE id=?`,
    [p.code ? p.code.toUpperCase() : null, p.name ?? null, p.facultyId ?? null, p.departmentId ?? null,
     p.credits ?? null, p.semester ?? null, p.type ?? null, p.difficulty ?? null, c.id]);
  res.json({ ok: true });
}));

router.delete("/courses/:id", rbac("ADMIN"), h((req, res) => {
  db.run("DELETE FROM courses WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
}));

module.exports = router;
module.exports.mapStudent = mapStudent;
module.exports.round1 = round1;
