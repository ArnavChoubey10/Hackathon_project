/* Academic Profile Service — GET /api/academic-profile/me (student) and
   /api/academic-profile/:studentId (admin). Structured, deterministic,
   AI-ready. The AI layer consumes ONLY this output — never raw tables. */
const { Router } = require("express");
const { db } = require("../config/db");
const { HttpError, auth, rbac, requireStudent } = require("../middleware");
const L = require("../utils/logic");

const router = Router();
router.use(auth);

const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

function buildProfile(studentId) {
  const student = db.get("SELECT * FROM students WHERE id = ?", [studentId]);
  if (!student) throw new HttpError(404, "Student not found.");
  const today = todayISO();
  const courses = db.all(`SELECT c.* FROM courses c JOIN enrollments e ON e.course_id = c.id WHERE e.student_id = ? ORDER BY c.code`, [studentId]);
  const enrolledIds = courses.map((c) => c.id);

  const courseProfiles = courses.map((c) => {
    const mine = db.all(`SELECT a.type, sc.marks, a.max_marks, a.date FROM assessments a
      JOIN assessment_scores sc ON sc.assessment_id = a.id
      WHERE a.course_id = ? AND sc.student_id = ? ORDER BY a.date`, [c.id, studentId]);
    const series = mine.map((a) => L.pctOf(a.marks, a.max_marks));
    const average = series.length ? L.round1(series.reduce((s, v) => s + v, 0) / series.length) : null;
    const allPcts = db.all(`SELECT sc.marks, a.max_marks FROM assessment_scores sc JOIN assessments a ON a.id = sc.assessment_id WHERE a.course_id = ?`, [c.id]).map((r) => L.pctOf(r.marks, r.max_marks));
    const classAverage = allPcts.length ? L.calculateClassAverage(allPcts) : null;
    const difference = average !== null && classAverage !== null ? L.round1(average - classAverage) : null;
    const fat = mine.filter((a) => a.type === "FAT").sort((a, b) => b.date.localeCompare(a.date))[0];
    const gradePct = fat ? L.pctOf(fat.marks, fat.max_marks) : average;
    const g = gradePct !== null ? L.calculateGrade(gradePct) : null;
    const attendance = L.calculateAttendance(db.all("SELECT status FROM attendance WHERE course_id = ? AND student_id = ?", [c.id, studentId]).map((r) => r.status));

    // Class statistics from real per-student averages.
    const peerAvgs = db.all("SELECT student_id FROM enrollments WHERE course_id = ?", [c.id]).map((e) => {
      const ms = db.all(`SELECT sc.marks, a.max_marks FROM assessment_scores sc JOIN assessments a ON a.id = sc.assessment_id WHERE a.course_id = ? AND sc.student_id = ?`, [c.id, e.student_id]);
      if (ms.length === 0) return null;
      const p = ms.map((r) => L.pctOf(r.marks, r.max_marks));
      return L.round1(p.reduce((s, v) => s + v, 0) / p.length);
    }).filter((v) => v !== null);

    const curriculum = db.get("SELECT * FROM curricula WHERE course_id = ?", [c.id]);
    const feedback = db.get("SELECT * FROM feedbacks WHERE course_id = ?", [c.id]);
    const fac = db.get("SELECT name FROM faculty WHERE id = ?", [c.faculty_id]);

    return {
      courseId: c.id, courseCode: c.code, courseName: c.name, credits: c.credits, type: c.type, difficulty: c.difficulty,
      facultyName: fac?.name ?? "—",
      attendance,
      performance: {
        average, classAverage, difference, trend: L.calculateTrend(series),
        grade: g?.grade ?? null, points: g?.points ?? null,
        label: difference === null ? "NO_DATA" : L.performanceLabel(difference),
      },
      assessments: mine.map((a) => ({ type: a.type, marks: a.marks, maxMarks: a.max_marks, pct: L.pctOf(a.marks, a.max_marks), date: a.date })),
      classStats: {
        highestClassPct: peerAvgs.length ? Math.max(...peerAvgs) : null,
        lowestClassPct: peerAvgs.length ? Math.min(...peerAvgs) : null,
        passPercentage: L.calculatePassPercentage(peerAvgs),
        percentile: average !== null ? L.calculatePercentile(average, peerAvgs) : null,
      },
      curriculum: curriculum ? {
        courseId: c.id, description: curriculum.description,
        prerequisites: JSON.parse(curriculum.prerequisites || "[]"),
        objectives: JSON.parse(curriculum.objectives || "[]"),
        units: JSON.parse(curriculum.units || "[]"),
      } : null,
      feedback: feedback ? { courseId: c.id, avgClarity: feedback.avg_clarity, avgCourse: feedback.avg_course, responses: feedback.responses } : null,
    };
  });

  /* ---- upcoming exams with proximity + syllabus units ---- */
  const upcomingExams = db.all(`SELECT e.id, e.name AS examName, e.course_id, e.date, e.start, e.end, e.venue, e.semester,
      c.code AS courseCode, c.name AS courseName
    FROM exams e JOIN courses c ON c.id = e.course_id
    WHERE e.course_id IN (${enrolledIds.length ? enrolledIds.map(() => "?").join(",") : "NULL"}) AND e.date >= ? ORDER BY e.date`, [...enrolledIds, today])
    .map((e) => {
      const prox = L.calculateExamProximity(e.date, today);
      const cur = db.get("SELECT units FROM curricula WHERE course_id = ?", [e.course_id]);
      const units = cur ? JSON.parse(cur.units || "[]") : [];
      return { id: e.id, name: e.examName, courseId: e.course_id, courseCode: e.courseCode, courseName: e.courseName, date: e.date, start: e.start, end: e.end, venue: e.venue, semester: e.semester, daysLeft: prox.daysLeft, urgency: prox.urgency, syllabusUnits: units.map((un) => un.title) };
    });

  /* ---- assignment tracker ---- */
  const assignmentTracker = db.all(`SELECT a.*, c.code, c.name FROM assignments a JOIN courses c ON c.id = a.course_id
      WHERE a.course_id IN (${enrolledIds.length ? enrolledIds.map(() => "?").join(",") : "NULL"}) ORDER BY a.due_date`, enrolledIds)
    .map((a) => {
      const submitted = !!db.get("SELECT id FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?", [a.id, studentId]);
      const daysLeft = Math.round((new Date(a.due_date + "T12:00:00").getTime() - new Date(today + "T12:00:00").getTime()) / 86400000);
      return { id: a.id, title: a.title, courseId: a.course_id, courseCode: a.code, courseName: a.name, dueDate: a.due_date, daysLeft, submitted, status: submitted ? "SUBMITTED" : daysLeft < 0 ? "OVERDUE" : "PENDING" };
    });

  /* ---- priorities ---- */
  for (const cp of courseProfiles) {
    const ex = upcomingExams.find((e) => e.courseId === cp.courseId);
    const openDue = assignmentTracker.filter((a) => a.courseId === cp.courseId && !a.submitted).map((a) => a.daysLeft);
    cp.priority = L.calculateAcademicPriority({
      average: cp.performance.average, difference: cp.performance.difference, trend: cp.performance.trend,
      attendance: cp.attendance, difficulty: cp.difficulty, credits: cp.credits, type: cp.type,
      examDaysLeft: ex ? ex.daysLeft : null,
      assignmentDueDays: openDue.length ? Math.min(...openDue) : null,
    });
  }
  const priorities = courseProfiles
    .map((cp) => ({ courseId: cp.courseId, courseCode: cp.courseCode, courseName: cp.courseName, priority: cp.priority.priority, score: cp.priority.score, reasons: cp.priority.reasons }))
    .sort((a, b) => b.score - a.score);

  /* ---- results (FAT) ---- */
  const results = courseProfiles.map((cp) => {
    const fat = db.get(`SELECT sc.marks, a.max_marks, a.date FROM assessments a JOIN assessment_scores sc ON sc.assessment_id = a.id
      WHERE a.course_id = ? AND sc.student_id = ? AND a.type = 'FAT'`, [cp.courseId, studentId]);
    if (!fat) return null;
    const pct = L.pctOf(fat.marks, fat.max_marks);
    const g = L.calculateGrade(pct);
    return { courseId: cp.courseId, courseName: cp.courseName, credits: cp.credits, marks: fat.marks, maxMarks: fat.max_marks, pct, grade: g.grade, points: g.points, passed: g.passed, date: fat.date };
  }).filter(Boolean).sort((a, b) => b.date.localeCompare(a.date));

  const overallAtt = L.calculateAttendance(db.all("SELECT status FROM attendance WHERE student_id = ?", [studentId]).map((r) => r.status));
  const avgPcts = courseProfiles.map((c) => c.performance.average).filter((v) => v !== null);
  const summary = {
    averagePct: avgPcts.length ? L.round1(avgPcts.reduce((s, v) => s + v, 0) / avgPcts.length) : null,
    sgpa: results.length ? L.round2(results.reduce((s, r) => s + r.points * r.credits, 0) / results.reduce((s, r) => s + r.credits, 0)) : null,
    cgpaNote: "Not enough historical data — CGPA requires completed previous semesters.",
    highest: avgPcts.length ? Math.max(...avgPcts) : null,
    subjectCount: courses.length,
    passedCount: results.filter((r) => r.passed).length,
  };

  const feeRows = db.all("SELECT total, paid FROM fees WHERE student_id = ?", [studentId]);
  const fees = feeRows.length
    ? (() => {
        const total = feeRows.reduce((s, f) => s + f.total, 0);
        const paid = feeRows.reduce((s, f) => s + f.paid, 0);
        return { total, paid, ...L.calculateFee(total, paid) };
      })()
    : null;

  /* ---- insights (deterministic, from objective data) ---- */
  const insights = [];
  for (const cp of courseProfiles) {
    if (cp.attendance.belowThreshold) {
      insights.push({
        severity: cp.attendance.risk === "CRITICAL" ? "HIGH" : "MEDIUM",
        text: `Attendance in ${cp.courseName} is ${cp.attendance.percentage}% — below the required ${L.ATTENDANCE_THRESHOLD}%. Attend the next ${cp.attendance.classesNeeded} class${cp.attendance.classesNeeded === 1 ? "" : "es"} consecutively to recover.`,
      });
    }
    if (cp.performance.trend === "IMPROVING") {
      const s = cp.assessments.map((a) => a.pct);
      insights.push({ severity: "GOOD", text: `Performance in ${cp.courseName} is improving (${s[0]}% → ${s[s.length - 1]}%).` });
    }
    if (cp.performance.trend === "DECLINING") {
      const s = cp.assessments.map((a) => a.pct);
      insights.push({ severity: "MEDIUM", text: `Scores in ${cp.courseName} are declining (${s[0]}% → ${s[s.length - 1]}%). Early revision is recommended.` });
    }
    if (cp.performance.difference !== null && cp.performance.difference <= -5) {
      insights.push({ severity: "MEDIUM", text: `${cp.courseName} average is ${Math.abs(cp.performance.difference)} points below the class average (${cp.performance.classAverage}%).` });
    }
    if (cp.performance.difference !== null && cp.performance.difference >= 5) {
      insights.push({ severity: "GOOD", text: `You are ${cp.performance.difference} points above the class average in ${cp.courseName}.` });
    }
    const fatRes = results.find((r) => r.courseId === cp.courseId);
    if (fatRes && !fatRes.passed) {
      insights.push({ severity: "HIGH", text: `FAT result in ${cp.courseName} is ${fatRes.grade} (${fatRes.pct}%) — below the passing mark. A supplementary exam may apply.` });
    }
  }
  if (fees && fees.due > 0) {
    insights.push({ severity: fees.status === "PENDING" ? "HIGH" : "MEDIUM", text: `₹${fees.due.toLocaleString("en-IN")} in semester fees is pending (${fees.status.toLowerCase()}).` });
  }
  const overdue = assignmentTracker.filter((a) => a.status === "OVERDUE");
  const dueSoon = assignmentTracker.filter((a) => a.status === "PENDING" && a.daysLeft <= 3);
  if (overdue.length) insights.push({ severity: "HIGH", text: `${overdue.length} assignment${overdue.length === 1 ? " is" : "s are"} overdue: ${overdue.map((a) => a.title.split("—")[0].trim()).join(", ")}.` });
  else if (dueSoon.length) insights.push({ severity: "LOW", text: `${dueSoon.length} assignment${dueSoon.length === 1 ? "" : "s"} due within 3 days.` });
  if (upcomingExams.length) insights.push({ severity: "LOW", text: `Next exam: ${upcomingExams[0].name} — ${upcomingExams[0].courseName} on ${upcomingExams[0].date}.` });
  if (insights.length === 0) insights.push({ severity: "GOOD", text: "Everything is on track — attendance, performance and dues are all healthy." });
  insights.sort((a, b) => ["HIGH", "MEDIUM", "LOW", "GOOD"].indexOf(a.severity) - ["HIGH", "MEDIUM", "LOW", "GOOD"].indexOf(b.severity));

  /* ---- action center ---- */
  const actions = [];
  for (const cp of courseProfiles) {
    if (cp.attendance.belowThreshold) {
      actions.push({ priority: "HIGH", kind: "attendance", title: `Attendance below ${L.ATTENDANCE_THRESHOLD}% — ${cp.courseName}`, detail: `Currently ${cp.attendance.percentage}% (${cp.attendance.risk}). Attend next ${cp.attendance.classesNeeded} classes to recover.`, link: "/student/attendance" });
    }
  }
  for (const a of overdue) actions.push({ priority: "HIGH", kind: "assignment", title: `Overdue: ${a.title}`, detail: `Was due ${a.dueDate}. Submit as soon as possible.`, link: "/student/assignments" });
  if (fees && fees.due > 0) actions.push({ priority: "MEDIUM", kind: "fee", title: `Fees pending — ₹${fees.due.toLocaleString("en-IN")}`, detail: `${fees.status} payment status for the current semester.`, link: "/student/fees" });
  for (const a of dueSoon) actions.push({ priority: "MEDIUM", kind: "assignment", title: `Due soon: ${a.title}`, detail: `Deadline ${a.dueDate}.`, link: "/student/assignments" });
  for (const r of db.all("SELECT * FROM requests WHERE student_id = ? AND status = 'PENDING'", [studentId])) {
    actions.push({ priority: "LOW", kind: "request", title: `Request under review — ${r.subject}`, detail: "You will be notified when it is processed.", link: "/student/requests" });
  }
  for (const e of upcomingExams.slice(0, 2)) actions.push({ priority: "LOW", kind: "exam", title: `${e.name} — ${e.courseName}`, detail: `${e.date}, ${e.start}–${e.end}, ${e.venue}.`, link: "/student/exams" });
  actions.sort((a, b) => ["HIGH", "MEDIUM", "LOW"].indexOf(a.priority) - ["HIGH", "MEDIUM", "LOW"].indexOf(b.priority));

  return {
    student: { id: student.id, name: student.name, regNo: student.reg_no, program: student.program, branch: student.branch, semester: student.semester, section: student.section },
    attendance: { ...overallAtt, courses: courseProfiles.map((cp) => ({ ...cp.attendance, courseId: cp.courseId, courseName: cp.courseName })) },
    courses: courseProfiles,
    results, summary, fees, insights, actions,
    generatedAt: new Date().toISOString(),
    upcomingExams, assignmentTracker, priorities,
  };
}

router.get("/academic-profile/me", requireStudent, (req, res) => res.json(buildProfile(req.student.id)));
router.get("/academic-profile/:studentId", rbac("ADMIN"), (req, res) => res.json(buildProfile(req.params.studentId)));

module.exports = router;
module.exports.buildProfile = buildProfile;
