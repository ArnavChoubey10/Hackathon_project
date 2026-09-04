/* Academic module — attendance, marks/assessments, results, exams, timetable,
   assignments. All calculations via utils/logic.js (never in SQL or clients). */
const { Router } = require("express");
const { db } = require("../config/db");
const { HttpError, auth, rbac, requireStudent, requireFaculty } = require("../middleware");
const { h } = require("../middleware/errorHandler");
const L = require("../utils/logic");

const router = Router();
router.use(auth);

const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

function assertCourseAccess(user, courseId) {
  const course = db.get("SELECT * FROM courses WHERE id = ?", [courseId]);
  if (!course) throw new HttpError(404, "Course not found.");
  if (user.role === "FACULTY" && course.faculty_id !== user.facultyId) {
    throw new HttpError(403, "You can only manage courses assigned to you.");
  }
  return course;
}
function notify(userId, title, body, kind) {
  if (!userId) return;
  db.run("INSERT INTO notifications (user_id,title,body,kind) VALUES (?,?,?,?)", [userId, title, body, kind]);
}

/* ================= attendance ================= */

router.get("/attendance/roster", rbac("ADMIN", "FACULTY"), (req, res) => {
  const { courseId, date } = req.query;
  if (!courseId || !date) throw new HttpError(422, "courseId and date are required.");
  assertCourseAccess(req.user, courseId);
  const rows = db.all(`SELECT s.id, s.name, s.reg_no, s.section,
      (SELECT status FROM attendance a WHERE a.course_id = ? AND a.student_id = s.id AND a.date = ?) AS status
    FROM enrollments e JOIN students s ON s.id = e.student_id WHERE e.course_id = ? ORDER BY s.reg_no`,
    [courseId, date, courseId])
    .map((r) => {
      const hist = db.all("SELECT status FROM attendance WHERE course_id = ? AND student_id = ? AND date <= ?", [courseId, r.id, date]).map((x) => x.status);
      const att = L.calculateAttendance(hist);
      return { studentId: r.id, name: r.name, regNo: r.reg_no, section: r.section, status: r.status ?? null, running: { percentage: att.percentage, risk: att.risk, total: att.total } };
    });
  res.json({ courseId, date, rows });
});

router.post("/attendance", rbac("ADMIN", "FACULTY"), h((req, res) => {
  const { courseId, date, records } = req.body || {};
  if (!courseId || !date || !Array.isArray(records)) throw new HttpError(422, "courseId, date and records are required.");
  assertCourseAccess(req.user, courseId);
  const course = db.get("SELECT * FROM courses WHERE id = ?", [courseId]);
  db.transaction(() => {
    for (const r of records) {
      if (!["PRESENT", "ABSENT"].includes(r.status)) throw new HttpError(422, "Invalid attendance status.");
      const enrolled = db.get("SELECT id FROM enrollments WHERE course_id = ? AND student_id = ?", [courseId, r.studentId]);
      if (!enrolled) throw new HttpError(422, "Student is not enrolled in this course.");
      db.run(`INSERT INTO attendance (course_id,student_id,date,status) VALUES (?,?,?,?)
        ON CONFLICT(course_id,student_id,date) DO UPDATE SET status = excluded.status`,
        [courseId, r.studentId, date, r.status]);
    }
    // Notify students pushed below the threshold by this save.
    for (const r of records) {
      const all = db.all("SELECT status FROM attendance WHERE course_id = ? AND student_id = ?", [courseId, r.studentId]).map((x) => x.status);
      const att = L.calculateAttendance(all);
      if (att.belowThreshold && r.status === "ABSENT") {
        const u = db.get("SELECT user_id FROM students WHERE id = ?", [r.studentId]);
        notify(u?.user_id, `Attendance below threshold — ${course.name}`,
          `Your attendance in ${course.code} is ${att.percentage}%, below the required ${L.ATTENDANCE_THRESHOLD}%. Attend the next ${att.classesNeeded} classes to recover.`, "DANGER");
      }
    }
  });
  res.json({ ok: true, saved: records.length });
}));

router.get("/attendance/course-summary", rbac("ADMIN", "FACULTY"), (_req, res) => {
  const courses = db.all("SELECT * FROM courses ORDER BY code");
  res.json(courses.map((c) => {
    const enrolled = db.all(`SELECT s.id, s.name, s.reg_no FROM enrollments e JOIN students s ON s.id = e.student_id WHERE e.course_id = ? ORDER BY s.reg_no`, [c.id]);
    return {
      course: { id: c.id, code: c.code, name: c.name },
      enrolled: enrolled.length,
      overall: L.calculateAttendance(db.all("SELECT status FROM attendance WHERE course_id = ?", [c.id]).map((r) => r.status)),
      perStudent: enrolled.map((s) => ({
        studentId: s.id, name: s.name, regNo: s.reg_no,
        ...L.calculateAttendance(db.all("SELECT status FROM attendance WHERE course_id = ? AND student_id = ?", [c.id, s.id]).map((r) => r.status)),
      })),
    };
  }));
});

router.get("/attendance/me", requireStudent, (req, res) => {
  const sid = req.student.id;
  const courses = db.all(`SELECT c.* FROM courses c JOIN enrollments e ON e.course_id = c.id WHERE e.student_id = ? ORDER BY c.code`, [sid]);
  const perCourse = courses.map((c) => {
    const att = L.calculateAttendance(db.all("SELECT status FROM attendance WHERE course_id = ? AND student_id = ? ORDER BY date", [c.id, sid]).map((r) => r.status));
    return { courseId: c.id, courseCode: c.code, courseName: c.name, ...att };
  });
  const overall = L.calculateAttendance(db.all("SELECT status FROM attendance WHERE student_id = ?", [sid]).map((r) => r.status));
  res.json({ overall, perCourse });
});

/* ================= marks / assessments ================= */

router.get("/marks/roster", rbac("ADMIN", "FACULTY"), (req, res) => {
  const { courseId, type } = req.query;
  if (!courseId || !type) throw new HttpError(422, "courseId and type are required.");
  assertCourseAccess(req.user, courseId);
  const slot = db.get("SELECT * FROM assessments WHERE course_id = ? AND type = ? ORDER BY date DESC LIMIT 1", [courseId, type]);
  const rows = db.all(`SELECT s.id, s.name, s.reg_no,
      ${slot ? "(SELECT marks FROM assessment_scores sc WHERE sc.assessment_id = ? AND sc.student_id = s.id)" : "NULL"} AS marks
    FROM enrollments e JOIN students s ON s.id = e.student_id WHERE e.course_id = ? ORDER BY s.reg_no`,
    slot ? [slot.id, courseId] : [courseId])
    .map((r) => ({ studentId: r.id, name: r.name, regNo: r.reg_no, marks: r.marks ?? null, maxMarks: slot?.max_marks ?? null }));
  res.json({ courseId, type, rows });
});

router.post("/marks", rbac("ADMIN", "FACULTY"), h((req, res) => {
  const { courseId, type, date, rows } = req.body || {};
  if (!courseId || !type || !date || !Array.isArray(rows) || rows.length === 0) throw new HttpError(422, "courseId, type, date and rows are required.");
  assertCourseAccess(req.user, courseId);
  const maxMarks = rows[0].maxMarks;
  for (const r of rows) {
    if (!Number.isFinite(r.marks) || r.marks < 0 || r.marks > r.maxMarks) throw new HttpError(422, `Marks must be between 0 and ${r.maxMarks}.`);
    if (r.maxMarks !== maxMarks) throw new HttpError(422, "All rows must share the same maximum marks.");
  }
  let classAverage = 0;
  db.transaction(() => {
    let slot = db.get("SELECT * FROM assessments WHERE course_id = ? AND type = ? AND date = ?", [courseId, type, date]);
    if (!slot) {
      const id = db.run("INSERT INTO assessments (course_id,type,max_marks,date) VALUES (?,?,?,?)", [courseId, type, maxMarks, date]).lastInsertRowid;
      slot = { id };
    } else if (slot.max_marks !== maxMarks) {
      db.run("UPDATE assessments SET max_marks = ? WHERE id = ?", [maxMarks, slot.id]);
    }
    for (const r of rows) {
      const enrolled = db.get("SELECT id FROM enrollments WHERE course_id = ? AND student_id = ?", [courseId, r.studentId]);
      if (!enrolled) throw new HttpError(422, "Student is not enrolled in this course.");
      db.run(`INSERT INTO assessment_scores (assessment_id,student_id,marks) VALUES (?,?,?)
        ON CONFLICT(assessment_id,student_id) DO UPDATE SET marks = excluded.marks`, [slot.id, r.studentId, r.marks]);
    }
    // Notify + publish-result notification for FAT entries.
    const course = db.get("SELECT * FROM courses WHERE id = ?", [courseId]);
    const pcts = db.all("SELECT marks FROM assessment_scores WHERE assessment_id = ?", [slot.id]).map((x) => L.pctOf(x.marks, maxMarks));
    classAverage = L.calculateClassAverage(pcts);
    if (type === "FAT") {
      for (const r of rows) {
        const g = L.calculateGrade(L.pctOf(r.marks, maxMarks));
        const u = db.get("SELECT user_id FROM students WHERE id = ?", [r.studentId]);
        notify(u?.user_id, `Result published — ${course.name}`, `You scored ${r.marks}/${maxMarks} (${g.grade}) in the FAT. Class average: ${classAverage}%.`, g.passed ? "SUCCESS" : "DANGER");
      }
    }
  });
  res.json({ ok: true, classAverage });
}));

router.get("/marks/course/:courseId", rbac("ADMIN", "FACULTY"), h((req, res) => {
  assertCourseAccess(req.user, req.params.courseId);
  const slots = db.all("SELECT * FROM assessments WHERE course_id = ? ORDER BY date", [req.params.courseId]);
  const grouped = {};
  for (const slot of slots) {
    const rows = db.all(`SELECT sc.student_id, sc.marks, s.name, s.reg_no FROM assessment_scores sc
      JOIN students s ON s.id = sc.student_id WHERE sc.assessment_id = ?`, [slot.id])
      .map((r) => {
        const pct = L.pctOf(r.marks, slot.max_marks);
        return { studentId: r.student_id, name: r.name, regNo: r.reg_no, marks: r.marks, maxMarks: slot.max_marks, pct, date: slot.date, grade: L.calculateGrade(pct).grade };
      });
    (grouped[slot.type] ??= []).push(...rows);
  }
  res.json(Object.entries(grouped).map(([type, rows]) => ({
    type,
    classAverage: L.calculateClassAverage(rows.map((r) => r.pct)),
    rows: rows.sort((a, b) => b.pct - a.pct),
  })));
}));

router.get("/marks/me", requireStudent, (req, res) => {
  const sid = req.student.id;
  const courses = db.all(`SELECT c.* FROM courses c JOIN enrollments e ON e.course_id = c.id WHERE e.student_id = ? ORDER BY c.code`, [sid]);
  const data = courses.map((c) => {
    const slots = db.all("SELECT * FROM assessments WHERE course_id = ? ORDER BY date", [c.id]);
    const groups = {};
    for (const slot of slots) {
      const mine = db.get("SELECT marks FROM assessment_scores WHERE assessment_id = ? AND student_id = ?", [slot.id, sid]);
      const all = db.all("SELECT marks FROM assessment_scores WHERE assessment_id = ?", [slot.id]);
      (groups[slot.type] ??= []).push({
        date: slot.date, maxMarks: slot.max_marks,
        marks: mine ? mine.marks : null,
        pct: mine ? L.pctOf(mine.marks, slot.max_marks) : null,
        classAverage: all.length ? L.calculateClassAverage(all.map((x) => L.pctOf(x.marks, slot.max_marks))) : null,
      });
    }
    return { courseId: c.id, courseCode: c.code, courseName: c.name, groups };
  });
  res.json(data);
});

/* ================= results ================= */

const resultRowsFor = (sid) => db.all(`
    SELECT c.id AS courseId, c.name AS courseName, c.credits, sc.marks, a.max_marks, a.date
    FROM assessments a
    JOIN assessment_scores sc ON sc.assessment_id = a.id
    JOIN courses c ON c.id = a.course_id
    WHERE a.type = 'FAT' AND sc.student_id = ?`, [sid])
  .map((r) => {
    const pct = L.pctOf(r.marks, r.max_marks);
    const g = L.calculateGrade(pct);
    return { courseId: r.courseId, courseName: r.courseName, credits: r.credits, marks: r.marks, maxMarks: r.max_marks, pct, grade: g.grade, points: g.points, passed: g.passed, date: r.date };
  })
  .sort((a, b) => b.date.localeCompare(a.date));

router.get("/results/me", requireStudent, (req, res) => {
  const results = resultRowsFor(req.student.id);
  const avgPcts = db.all(`SELECT c.id FROM courses c JOIN enrollments e ON e.course_id = c.id WHERE e.student_id = ?`, [req.student.id])
    .map(({ id }) => {
      const pcts = db.all(`SELECT sc.marks, a.max_marks FROM assessment_scores sc JOIN assessments a ON a.id = sc.assessment_id WHERE a.course_id = ? AND sc.student_id = ?`, [id, req.student.id]).map((r) => L.pctOf(r.marks, r.max_marks));
      return pcts.length ? L.round1(pcts.reduce((s, v) => s + v, 0) / pcts.length) : null;
    }).filter((v) => v !== null);
  const summary = {
    averagePct: avgPcts.length ? L.round1(avgPcts.reduce((s, v) => s + v, 0) / avgPcts.length) : null,
    sgpa: results.length ? L.round2(results.reduce((s, r) => s + r.points * r.credits, 0) / results.reduce((s, r) => s + r.credits, 0)) : null,
    cgpaNote: "Not enough historical data — CGPA requires completed previous semesters.",
    highest: avgPcts.length ? Math.max(...avgPcts) : null,
    subjectCount: db.get("SELECT COUNT(*) n FROM enrollments WHERE student_id = ?", [req.student.id]).n,
    passedCount: results.filter((r) => r.passed).length,
  };
  res.json({ results, summary, gradingScale: L.GRADING_SCALE });
});

router.get("/results/course/:courseId", rbac("ADMIN", "FACULTY"), h((req, res) => {
  assertCourseAccess(req.user, req.params.courseId);
  const fat = db.get("SELECT * FROM assessments WHERE course_id = ? AND type = 'FAT' ORDER BY date DESC LIMIT 1", [req.params.courseId]);
  const rows = db.all(`SELECT s.id, s.name, s.reg_no,
      ${fat ? "(SELECT marks FROM assessment_scores sc WHERE sc.assessment_id = ? AND sc.student_id = s.id)" : "NULL"} AS marks
    FROM enrollments e JOIN students s ON s.id = e.student_id WHERE e.course_id = ? ORDER BY s.reg_no`,
    fat ? [fat.id, req.params.courseId] : [req.params.courseId])
    .map((r) => {
      const pct = r.marks !== null && fat ? L.pctOf(r.marks, fat.max_marks) : null;
      const g = pct !== null ? L.calculateGrade(pct) : null;
      return { studentId: r.id, name: r.name, regNo: r.reg_no, marks: r.marks ?? null, maxMarks: fat?.max_marks ?? null, pct, grade: g?.grade ?? null, points: g?.points ?? null, passed: g?.passed ?? null };
    });
  const graded = rows.filter((r) => r.pct !== null).map((r) => r.pct);
  res.json({ rows, classAverage: graded.length ? L.calculateClassAverage(graded) : null, passPercentage: L.calculatePassPercentage(graded) });
}));

/* ================= exams ================= */

router.get("/exams", (req, res) => {
  let sql = `SELECT e.*, c.code AS courseCode, c.name AS courseName FROM exams e JOIN courses c ON c.id = e.course_id`;
  const p = [];
  if (req.user.role === "STUDENT") {
    sql += " WHERE e.course_id IN (SELECT course_id FROM enrollments WHERE student_id = ?)";
    p.push(req.user.studentId);
  } else if (req.user.role === "FACULTY") {
    sql += " WHERE e.course_id IN (SELECT id FROM courses WHERE faculty_id = ?)";
    p.push(req.user.facultyId);
  }
  res.json(db.all(sql + " ORDER BY e.date, e.start", p).map((e) => ({
    id: e.id, courseId: e.course_id, courseCode: e.courseCode, courseName: e.courseName, name: e.name,
    semester: e.semester, date: e.date, start: e.start, end: e.end, venue: e.venue,
  })));
});

router.post("/exams", rbac("ADMIN"), h((req, res) => {
  const { courseId, name, semester, date, start, end, venue } = req.body || {};
  if (!courseId || !name?.trim() || !date || !venue?.trim()) throw new HttpError(422, "Complete all exam fields.");
  const r = db.run("INSERT INTO exams (course_id,name,semester,date,start,end,venue) VALUES (?,?,?,?,?,?,?)",
    [courseId, name.trim(), Number(semester) || 1, date, start || "09:00", end || "12:00", venue.trim()]);
  const course = db.get("SELECT * FROM courses WHERE id = ?", [courseId]);
  for (const { user_id } of db.all(`SELECT s.user_id FROM enrollments e JOIN students s ON s.id = e.student_id WHERE e.course_id = ?`, [courseId])) {
    notify(user_id, `Exam scheduled — ${name.trim()}`, `${course.name} on ${date}, ${start}–${end} at ${venue}.`, "WARNING");
  }
  res.status(201).json({ id: r.lastInsertRowid });
}));

router.delete("/exams/:id", rbac("ADMIN"), h((req, res) => {
  db.run("DELETE FROM exams WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
}));

/* ================= timetable ================= */

router.get("/timetable", (req, res) => {
  let sql = `SELECT t.*, c.code AS courseCode, c.name AS courseName, f.name AS facultyName
    FROM timetable t JOIN courses c ON c.id = t.course_id LEFT JOIN faculty f ON f.id = c.faculty_id`;
  const p = [];
  if (req.user.role === "STUDENT") {
    sql += " WHERE t.course_id IN (SELECT course_id FROM enrollments WHERE student_id = ?)";
    p.push(req.user.studentId);
  } else if (req.user.role === "FACULTY") {
    sql += " WHERE t.course_id IN (SELECT id FROM courses WHERE faculty_id = ?)";
    p.push(req.user.facultyId);
  }
  res.json(db.all(sql + " ORDER BY t.day, t.start", p).map((t) => ({
    id: t.id, courseId: t.course_id, day: t.day, start: t.start, end: t.end, room: t.room,
    courseCode: t.courseCode, courseName: t.courseName, facultyName: t.facultyName ?? "—",
  })));
});

router.post("/timetable", rbac("ADMIN"), h((req, res) => {
  const { courseId, day, start, end, room } = req.body || {};
  if (!courseId || !(day >= 1 && day <= 5) || !start || !end) throw new HttpError(422, "Complete all timetable fields.");
  const r = db.run("INSERT INTO timetable (course_id,day,start,end,room) VALUES (?,?,?,?,?)", [courseId, day, start, end, room || "TBA"]);
  res.status(201).json({ id: r.lastInsertRowid });
}));

router.delete("/timetable/:id", rbac("ADMIN"), h((req, res) => {
  db.run("DELETE FROM timetable WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
}));

/* ================= assignments ================= */

router.get("/assignments", (req, res) => {
  const today = todayISO();
  const base = `SELECT a.*, c.code AS courseCode, c.name AS courseName FROM assignments a JOIN courses c ON c.id = a.course_id`;
  let rows;
  if (req.user.role === "STUDENT") {
    rows = db.all(base + " WHERE a.course_id IN (SELECT course_id FROM enrollments WHERE student_id = ?) ORDER BY a.due_date", [req.user.studentId]);
  } else if (req.user.role === "FACULTY") {
    rows = db.all(base + " WHERE a.course_id IN (SELECT id FROM courses WHERE faculty_id = ?) ORDER BY a.due_date", [req.user.facultyId]);
  } else {
    rows = db.all(base + " ORDER BY a.due_date");
  }
  res.json(rows.map((a) => {
    const enrolled = db.get("SELECT COUNT(*) n FROM enrollments WHERE course_id = ?", [a.course_id]).n;
    const submitted = db.get("SELECT COUNT(*) n FROM assignment_submissions WHERE assignment_id = ?", [a.id]).n;
    let myStatus = null;
    if (req.user.role === "STUDENT") {
      const mine = db.get("SELECT id FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?", [a.id, req.user.studentId]);
      myStatus = mine ? "SUBMITTED" : a.due_date < today ? "OVERDUE" : "PENDING";
    }
    return { id: a.id, courseId: a.course_id, courseCode: a.courseCode, courseName: a.courseName, title: a.title, description: a.description, dueDate: a.due_date, createdAt: a.created_at, enrolled, submitted, myStatus };
  }));
});

router.post("/assignments", rbac("ADMIN", "FACULTY"), h((req, res) => {
  const { courseId, title, description, dueDate } = req.body || {};
  const course = assertCourseAccess(req.user, courseId);
  if (!title?.trim() || !dueDate) throw new HttpError(422, "Title and due date are required.");
  const r = db.run("INSERT INTO assignments (course_id,title,description,due_date) VALUES (?,?,?,?)", [courseId, title.trim(), description || "", dueDate]);
  for (const { user_id } of db.all(`SELECT s.user_id FROM enrollments e JOIN students s ON s.id = e.student_id WHERE e.course_id = ?`, [courseId])) {
    notify(user_id, `New assignment — ${course.name}`, `“${title.trim()}” is due ${dueDate}.`, "INFO");
  }
  res.status(201).json({ id: r.lastInsertRowid });
}));

router.post("/assignments/:id/submit", requireStudent, h((req, res) => {
  const a = db.get("SELECT * FROM assignments WHERE id = ?", [req.params.id]);
  if (!a) throw new HttpError(404, "Assignment not found.");
  const enrolled = db.get("SELECT id FROM enrollments WHERE course_id = ? AND student_id = ?", [a.course_id, req.student.id]);
  if (!enrolled) throw new HttpError(403, "You are not enrolled in this course.");
  db.run(`INSERT INTO assignment_submissions (assignment_id,student_id) VALUES (?,?)
    ON CONFLICT(assignment_id,student_id) DO NOTHING`, [a.id, req.student.id]);
  res.json({ ok: true });
}));

module.exports = router;
