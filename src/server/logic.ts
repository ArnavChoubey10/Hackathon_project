/* ============================================================================
   CampusCore — Centralized Business Logic (the "services" layer)
   Single source of truth for every calculation in the system:
   attendance, grades, fees, class averages, trends, insights, academic profile.
   The frontend never recomputes any of this — it only renders API results.
   ========================================================================= */

import type {
  Assessment, AttendanceRisk, AttendanceStatus, Course, DB, Difficulty,
  FeeStatus, Student, Trend,
} from "./db";
import { addDaysISO, todayISO } from "./db";

/* ---------------- configurable academic rules ---------------- */

export const ATTENDANCE_THRESHOLD = 75; // percent
export const ATTENDANCE_WARN_AT = 70;   // below this → CRITICAL
export const PASSING_PCT = 40;

export const GRADING_SCALE: { min: number; grade: string; points: number }[] = [
  { min: 90, grade: "A+", points: 10 },
  { min: 80, grade: "A", points: 9 },
  { min: 70, grade: "B+", points: 8 },
  { min: 60, grade: "B", points: 7 },
  { min: 50, grade: "C", points: 6 },
  { min: 40, grade: "D", points: 5 },
  { min: 0, grade: "F", points: 0 },
];

export const ASSESSMENT_MAX_DEFAULTS: Record<string, number> = {
  CAT1: 50, CAT2: 50, QUIZ: 20, ASSIGNMENT: 20, LAB: 30, FAT: 100, PROJECT: 50, OTHER: 50,
};

export const round1 = (n: number) => Math.round(n * 10) / 10;
export const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* ---------------- attendance intelligence ---------------- */

export interface AttendanceSummary {
  total: number; attended: number; absent: number;
  percentage: number; threshold: number;
  risk: AttendanceRisk; belowThreshold: boolean;
  classesNeeded: number; canMiss: number;
}

export function calculateAttendance(statuses: AttendanceStatus[]): AttendanceSummary {
  const total = statuses.length;
  const attended = statuses.filter((s) => s === "PRESENT").length;
  const absent = total - attended;
  const percentage = total === 0 ? 0 : round1((attended / total) * 100);
  const risk: AttendanceRisk =
    total === 0 ? "SAFE"
      : percentage >= ATTENDANCE_THRESHOLD ? "SAFE"
        : percentage >= ATTENDANCE_WARN_AT ? "WARNING"
          : "CRITICAL";
  const belowThreshold = total > 0 && percentage < ATTENDANCE_THRESHOLD;
  // smallest n with (attended + n) / (total + n) >= threshold
  const classesNeeded = belowThreshold
    ? Math.max(0, Math.ceil((0.75 * total - attended) / 0.25))
    : 0;
  // largest m with attended / (total + m) >= threshold
  const canMiss = total === 0 ? 0 : Math.max(0, Math.floor(attended / 0.75 - total));
  return { total, attended, absent, percentage, threshold: ATTENDANCE_THRESHOLD, risk, belowThreshold, classesNeeded, canMiss };
}

/* ---------------- grading ---------------- */

export function calculateGrade(pct: number): { grade: string; points: number; passed: boolean } {
  const p = clamp(pct, 0, 100);
  const row = GRADING_SCALE.find((g) => p >= g.min) ?? GRADING_SCALE[GRADING_SCALE.length - 1];
  return { grade: row.grade, points: row.points, passed: p >= PASSING_PCT };
}

/* ---------------- fees ---------------- */

export function calculateFee(total: number, paid: number): { due: number; status: FeeStatus } {
  const due = Math.max(0, total - paid);
  const status: FeeStatus = paid >= total ? "PAID" : paid > 0 ? "PARTIAL" : "PENDING";
  return { due, status };
}

/* ---------------- performance ---------------- */

export const pctOf = (a: { marks: number; maxMarks: number }) =>
  a.maxMarks <= 0 ? 0 : round1((a.marks / a.maxMarks) * 100);

/** Class average percentage over a set of assessments (real student marks only). */
export function calculateClassAverage(rows: Assessment[]): number {
  if (rows.length === 0) return 0;
  return round1(rows.reduce((s, a) => s + pctOf(a), 0) / rows.length);
}

/** Deterministic trend over a chronologically ordered percent series. */
export function calculateTrend(series: number[]): Trend {
  if (series.length < 2) return "INSUFFICIENT_DATA";
  const delta = series[series.length - 1] - series[0];
  if (delta >= 5) return "IMPROVING";
  if (delta <= -5) return "DECLINING";
  return "STABLE";
}

export function performanceLabel(diff: number): "ABOVE_AVERAGE" | "AROUND_AVERAGE" | "BELOW_AVERAGE" {
  if (diff >= 3) return "ABOVE_AVERAGE";
  if (diff <= -3) return "BELOW_AVERAGE";
  return "AROUND_AVERAGE";
}

/* ---------------- academic profile service ---------------- */

export interface CourseProfile {
  courseId: string; courseCode: string; courseName: string; credits: number;
  type: Course["type"]; difficulty: Difficulty; facultyName: string;
  attendance: AttendanceSummary;
  performance: {
    average: number | null; classAverage: number | null; difference: number | null;
    trend: Trend; grade: string | null; points: number | null; label: string;
  };
  assessments: { type: Assessment["type"]; marks: number; maxMarks: number; pct: number; date: string }[];
}

export interface Insight { severity: "HIGH" | "MEDIUM" | "LOW" | "GOOD"; text: string; }
export interface ActionItem {
  priority: "HIGH" | "MEDIUM" | "LOW"; kind: string;
  title: string; detail: string; link: string;
}

export interface AcademicProfile {
  student: { id: string; name: string; regNo: string; program: string; branch: string; semester: number; section: string };
  attendance: AttendanceSummary & { courses: (CourseProfile["attendance"] & { courseId: string; courseName: string })[] };
  courses: CourseProfile[];
  results: { courseId: string; courseName: string; credits: number; marks: number; maxMarks: number; pct: number; grade: string; points: number; passed: boolean; date: string }[];
  summary: {
    averagePct: number | null; sgpa: number | null; cgpaNote: string;
    highest: number | null; subjectCount: number; passedCount: number;
  };
  fees: { total: number; paid: number; due: number; status: FeeStatus } | null;
  insights: Insight[];
  actions: ActionItem[];
  generatedAt: string;
}

export function buildStudentProfile(db: DB, studentId: string): AcademicProfile {
  const student = db.students.find((s) => s.id === studentId)!;
  const enrolledCourseIds = db.enrollments.filter((e) => e.studentId === studentId).map((e) => e.courseId);
  const courses = db.courses.filter((c) => enrolledCourseIds.includes(c.id));
  const today = todayISO();

  const courseProfiles: CourseProfile[] = courses.map((c) => {
    const mine = db.assessments
      .filter((a) => a.courseId === c.id && a.studentId === studentId)
      .sort((a, b) => a.date.localeCompare(b.date));
    const allInCourse = db.assessments.filter((a) => a.courseId === c.id);
    const series = mine.map(pctOf);
    const average = mine.length ? round1(series.reduce((s, v) => s + v, 0) / series.length) : null;
    const classAverage = allInCourse.length ? calculateClassAverage(allInCourse) : null;
    const difference = average !== null && classAverage !== null ? round1(average - classAverage) : null;
    const fat = mine.filter((a) => a.type === "FAT").sort((a, b) => b.date.localeCompare(a.date))[0];
    const gradePct = fat ? pctOf(fat) : average;
    const g = gradePct !== null ? calculateGrade(gradePct) : null;
    const attRecords = db.attendance.filter((r) => r.courseId === c.id && r.studentId === studentId);
    return {
      courseId: c.id, courseCode: c.code, courseName: c.name, credits: c.credits,
      type: c.type, difficulty: c.difficulty,
      facultyName: db.faculty.find((f) => f.id === c.facultyId)?.name ?? "—",
      attendance: calculateAttendance(attRecords.map((r) => r.status)),
      performance: {
        average, classAverage, difference,
        trend: calculateTrend(series),
        grade: g?.grade ?? null, points: g?.points ?? null,
        label: difference === null ? "NO_DATA" : performanceLabel(difference),
      },
      assessments: mine.map((a) => ({ type: a.type, marks: a.marks, maxMarks: a.maxMarks, pct: pctOf(a), date: a.date })),
    };
  });

  const allAtt = db.attendance.filter((r) => r.studentId === studentId);
  const overallAtt = calculateAttendance(allAtt.map((r) => r.status));

  // Results = FAT assessments (official end-semester), graded by backend rules.
  const results = courseProfiles
    .map((cp) => {
      const fat = db.assessments.find((a) => a.courseId === cp.courseId && a.studentId === studentId && a.type === "FAT");
      if (!fat) return null;
      const pct = pctOf(fat);
      const g = calculateGrade(pct);
      return {
        courseId: cp.courseId, courseName: cp.courseName, credits: cp.credits,
        marks: fat.marks, maxMarks: fat.maxMarks, pct, grade: g.grade, points: g.points,
        passed: g.passed, date: fat.date,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.date.localeCompare(a.date));

  const graded = results;
  const avgPcts = courseProfiles.map((c) => c.performance.average).filter((v): v is number => v !== null);
  const summary = {
    averagePct: avgPcts.length ? round1(avgPcts.reduce((s, v) => s + v, 0) / avgPcts.length) : null,
    sgpa: graded.length
      ? round2(graded.reduce((s, r) => s + r.points * r.credits, 0) / graded.reduce((s, r) => s + r.credits, 0))
      : null,
    cgpaNote: "Not enough historical data — CGPA requires completed previous semesters.",
    highest: avgPcts.length ? Math.max(...avgPcts) : null,
    subjectCount: courses.length,
    passedCount: graded.filter((r) => r.passed).length,
  };

  const feeRows = db.fees.filter((f) => f.studentId === studentId);
  const fees = feeRows.length
    ? (() => {
        const total = feeRows.reduce((s, f) => s + f.total, 0);
        const paid = feeRows.reduce((s, f) => s + f.paid, 0);
        return { total, paid, ...calculateFee(total, paid) };
      })()
    : null;

  /* ---- deterministic insights from objective data ---- */
  const insights: Insight[] = [];
  for (const cp of courseProfiles) {
    if (cp.attendance.belowThreshold) {
      const sev = cp.attendance.risk === "CRITICAL" ? "HIGH" : "MEDIUM";
      insights.push({
        severity: sev,
        text: `Attendance in ${cp.courseName} is ${cp.attendance.percentage}% — below the required ${ATTENDANCE_THRESHOLD}%. Attend the next ${cp.attendance.classesNeeded} class${cp.attendance.classesNeeded === 1 ? "" : "es"} consecutively to recover.`,
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

  const openAssignments = db.assignments
    .filter((as) => enrolledCourseIds.includes(as.courseId))
    .filter((as) => !db.submissions.some((sb) => sb.assignmentId === as.id && sb.studentId === studentId));
  const overdue = openAssignments.filter((a) => a.dueDate < today);
  const dueSoon = openAssignments.filter((a) => a.dueDate >= today && a.dueDate <= addDaysISO(3));
  if (overdue.length) insights.push({ severity: "HIGH", text: `${overdue.length} assignment${overdue.length === 1 ? " is" : "s are"} overdue: ${overdue.map((a) => a.title.split("—")[0].trim()).join(", ")}.` });
  else if (dueSoon.length) insights.push({ severity: "LOW", text: `${dueSoon.length} assignment${dueSoon.length === 1 ? "" : "s"} due within 3 days.` });

  const upcomingExams = db.exams
    .filter((e) => enrolledCourseIds.includes(e.courseId) && e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (upcomingExams.length) {
    const next = upcomingExams[0];
    const cname = courses.find((c) => c.id === next.courseId)?.name ?? next.courseId;
    insights.push({ severity: "LOW", text: `Next exam: ${next.name} — ${cname} on ${next.date}.` });
  }
  if (insights.length === 0) insights.push({ severity: "GOOD", text: "Everything is on track — attendance, performance and dues are all healthy." });
  insights.sort((a, b) => ["HIGH", "MEDIUM", "LOW", "GOOD"].indexOf(a.severity) - ["HIGH", "MEDIUM", "LOW", "GOOD"].indexOf(b.severity));

  /* ---- action center: generated from real system state ---- */
  const actions: ActionItem[] = [];
  for (const cp of courseProfiles) {
    if (cp.attendance.belowThreshold) {
      actions.push({
        priority: "HIGH", kind: "attendance",
        title: `Attendance below ${ATTENDANCE_THRESHOLD}% — ${cp.courseName}`,
        detail: `Currently ${cp.attendance.percentage}% (${cp.attendance.risk}). Attend next ${cp.attendance.classesNeeded} classes to recover.`,
        link: "/student/attendance",
      });
    }
  }
  for (const a of overdue) {
    actions.push({ priority: "HIGH", kind: "assignment", title: `Overdue: ${a.title}`, detail: `Was due ${a.dueDate}. Submit as soon as possible.`, link: "/student/assignments" });
  }
  if (fees && fees.due > 0) {
    actions.push({ priority: "MEDIUM", kind: "fee", title: `Fees pending — ₹${fees.due.toLocaleString("en-IN")}`, detail: `${fees.status} payment status for the current semester.`, link: "/student/fees" });
  }
  for (const a of dueSoon) {
    actions.push({ priority: "MEDIUM", kind: "assignment", title: `Due soon: ${a.title}`, detail: `Deadline ${a.dueDate}.`, link: "/student/assignments" });
  }
  const pendingReq = db.requests.filter((r) => r.studentId === studentId && r.status === "PENDING");
  for (const r of pendingReq) {
    actions.push({ priority: "LOW", kind: "request", title: `Request under review — ${r.subject}`, detail: "You will be notified when it is processed.", link: "/student/requests" });
  }
  for (const e of upcomingExams.slice(0, 2)) {
    const cname = courses.find((c) => c.id === e.courseId)?.name ?? e.courseId;
    actions.push({ priority: "LOW", kind: "exam", title: `${e.name} — ${cname}`, detail: `${e.date}, ${e.start}–${e.end}, ${e.venue}.`, link: "/student/exams" });
  }
  actions.sort((a, b) => ["HIGH", "MEDIUM", "LOW"].indexOf(a.priority) - ["HIGH", "MEDIUM", "LOW"].indexOf(b.priority));

  return {
    student: { id: student.id, name: student.name, regNo: student.regNo, program: student.program, branch: student.branch, semester: student.semester, section: student.section },
    attendance: { ...overallAtt, courses: courseProfiles.map((cp) => ({ ...cp.attendance, courseId: cp.courseId, courseName: cp.courseName })) },
    courses: courseProfiles,
    results,
    summary,
    fees,
    insights,
    actions,
    generatedAt: new Date().toISOString(),
  };
}

/* ---------------- dashboard aggregates (all from live data) ---------------- */

export function adminStats(db: DB) {
  const allAtt = calculateAttendance(db.attendance.map((r) => r.status));
  const perStudent = db.students.map((s) => {
    const recs = db.attendance.filter((r) => r.studentId === s.id);
    return { student: s, att: calculateAttendance(recs.map((r) => r.status)) };
  });
  const below75 = perStudent.filter((p) => p.att.total > 0 && p.att.percentage < ATTENDANCE_THRESHOLD);
  const totalFee = db.fees.reduce((s, f) => s + f.total, 0);
  const paidFee = db.fees.reduce((s, f) => s + f.paid, 0);
  const pcts = db.assessments.map(pctOf);
  const avgMarks = pcts.length ? round1(pcts.reduce((s, v) => s + v, 0) / pcts.length) : 0;
  return {
    totalStudents: db.students.length,
    activeStudents: db.students.filter((s) => s.status === "ACTIVE").length,
    totalFaculty: db.faculty.length,
    totalCourses: db.courses.length,
    avgAttendance: allAtt.percentage,
    below75Count: below75.length,
    below75: below75.map((p) => ({ id: p.student.id, name: p.student.name, regNo: p.student.regNo, percentage: p.att.percentage, risk: p.att.risk })),
    feesCollected: paidFee, feesPending: totalFee - paidFee, feesTotal: totalFee,
    pendingRequests: db.requests.filter((r) => r.status === "PENDING").length,
    avgMarks,
    unreadNotifications: db.notifications.filter((n) => n.userId === "U1" && !n.read).length,
    courseAttendance: db.courses.map((c) => {
      const recs = db.attendance.filter((r) => r.courseId === c.id);
      return { id: c.id, code: c.code, name: c.name, ...calculateAttendance(recs.map((r) => r.status)) };
    }),
    feeStatusCounts: {
      PAID: db.fees.filter((f) => calculateFee(f.total, f.paid).status === "PAID").length,
      PARTIAL: db.fees.filter((f) => calculateFee(f.total, f.paid).status === "PARTIAL").length,
      PENDING: db.fees.filter((f) => calculateFee(f.total, f.paid).status === "PENDING").length,
    },
    recentActivity: [...db.activity].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8),
  };
}

export function facultyStats(db: DB, facultyId: string) {
  const myCourses = db.courses.filter((c) => c.facultyId === facultyId);
  const ids = myCourses.map((c) => c.id);
  const myStudents = new Set(db.enrollments.filter((e) => ids.includes(e.courseId)).map((e) => e.studentId));
  const recs = db.attendance.filter((r) => ids.includes(r.courseId));
  const att = calculateAttendance(recs.map((r) => r.status));
  const today = todayISO();
  const todayDow = new Date().getDay();
  const todayClasses = db.timetable
    .filter((t) => ids.includes(t.courseId) && t.day === todayDow)
    .map((t) => ({ ...t, course: myCourses.find((c) => c.id === t.courseId)! }));
  // pending grading: enrolled students without a FAT entry in my theory courses
  let pendingGrading = 0;
  for (const c of myCourses) {
    if (c.type === "LAB" || c.type === "PROJECT") continue;
    const enrolled = db.enrollments.filter((e) => e.courseId === c.id).map((e) => e.studentId);
    const graded = new Set(db.assessments.filter((a) => a.courseId === c.id && a.type === "FAT").map((a) => a.studentId));
    pendingGrading += enrolled.filter((sid) => !graded.has(sid)).length;
  }
  return {
    courses: myCourses.map((c) => {
      const cRecs = db.attendance.filter((r) => r.courseId === c.id);
      const cAs = db.assessments.filter((a) => a.courseId === c.id);
      return {
        ...c, enrolled: db.enrollments.filter((e) => e.courseId === c.id).length,
        attendance: calculateAttendance(cRecs.map((r) => r.status)),
        classAverage: cAs.length ? calculateClassAverage(cAs) : null,
      };
    }),
    totalStudents: myStudents.size,
    avgAttendance: att.percentage,
    attendanceTotal: att.total,
    todayClasses,
    pendingGrading,
    recentActivity: [...db.activity].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6),
  };
}
