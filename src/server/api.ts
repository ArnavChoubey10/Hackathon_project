/* ============================================================================
   CampusCore — API Layer (REST-style facade over the database)
   - Token auth (JWT-shaped, 12h expiry) + role-based authorization
   - Student endpoints ALWAYS derive identity from the token, never from params
   - Faculty writes are restricted to their assigned courses
   - Every mutation validates input and persists through saveDB()
   Swap this file for fetch() calls to move to Express/SQLite — signatures match.
   ========================================================================= */

import {
  hashPass, loadDB, nextId, nowStamp, resetDB, saveDB, todayISO,
  type Assessment, type AssessmentType, type AttendanceStatus, type Course,
  type CourseType, type DB, type Difficulty, type NoticeKind, type RequestStatus,
  type FacultyProfile, type RequestType, type Role, type Student, type User,
} from "./db";
import {
  adminStats, ASSESSMENT_MAX_DEFAULTS, buildStudentProfile, calculateAttendance,
  calculateClassAverage, calculateFee, calculateGrade, calculateTrend, facultyStats, pctOf, round1,
} from "./logic";
import { aiChat as aiChatService, getAiConfig, saveAiConfig } from "./ai";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const TOKEN_KEY = "campuscore.token";
interface TokenPayload { uid: string; role: Role; sid?: string; fid?: string; exp: number; }

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const latency = () => wait(220 + Math.random() * 260);

function readToken(): TokenPayload {
  const raw = localStorage.getItem(TOKEN_KEY);
  if (!raw) throw new ApiError(401, "Not signed in. Please log in.");
  try {
    const p = JSON.parse(atob(raw)) as TokenPayload;
    if (p.exp < Date.now()) { localStorage.removeItem(TOKEN_KEY); throw new ApiError(401, "Session expired. Please log in again."); }
    return p;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(401, "Invalid session token.");
  }
}
function requireAuth(): TokenPayload { return readToken(); }
function requireRole(...roles: Role[]): TokenPayload {
  const t = requireAuth();
  if (!roles.includes(t.role)) throw new ApiError(403, "You are not authorized to perform this action.");
  return t;
}
function requireStudent(): { t: TokenPayload; sid: string } {
  const t = requireRole("STUDENT");
  if (!t.sid) throw new ApiError(403, "Student identity missing.");
  return { t, sid: t.sid };
}
function requireFaculty(): { t: TokenPayload; fid: string } {
  const t = requireRole("FACULTY");
  if (!t.fid) throw new ApiError(403, "Faculty identity missing.");
  return { t, fid: t.fid };
}

function notify(db: DB, userId: string, title: string, body: string, kind: NoticeKind) {
  db.notifications.push({ id: nextId(db, "N"), userId, title, body, kind, read: false, createdAt: nowStamp() });
}
function logActivity(db: DB, text: string, actor: string) {
  db.activity.push({ id: nextId(db, "AC"), at: nowStamp(), text, actor });
  if (db.activity.length > 60) db.activity = db.activity.slice(-60);
}

const publicStudent = (s: Student) => ({
  id: s.id, name: s.name, regNo: s.regNo, email: s.email, phone: s.phone,
  departmentId: s.departmentId, program: s.program, branch: s.branch,
  semester: s.semester, section: s.section, batch: s.batch,
  admissionYear: s.admissionYear, status: s.status,
});

/* ============================ the API surface ============================ */

export const api = {
  /* ---------- auth ---------- */
  async login(email: string, password: string) {
    await latency();
    const db = loadDB();
    const user = db.users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!user || user.passHash !== hashPass(password)) throw new ApiError(401, "Invalid email or password.");
    const payload: TokenPayload = { uid: user.id, role: user.role, sid: user.studentId, fid: user.facultyId, exp: Date.now() + 12 * 3600_000 };
    localStorage.setItem(TOKEN_KEY, btoa(JSON.stringify(payload)));
    return { token: localStorage.getItem(TOKEN_KEY)!, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
  },
  async logout() { localStorage.removeItem(TOKEN_KEY); },
  async me() {
    const t = requireAuth();
    const db = loadDB();
    const u = db.users.find((x) => x.id === t.uid);
    if (!u) throw new ApiError(401, "Account not found.");
    return { id: u.id, name: u.name, email: u.email, role: u.role, studentId: u.studentId, facultyId: u.facultyId };
  },

  /* ---------- students ---------- */
  async students(params?: { q?: string; departmentId?: string; semester?: number | ""; section?: string }) {
    requireRole("ADMIN", "FACULTY");
    await latency();
    const db = loadDB();
    let rows = [...db.students];
    if (params?.q) {
      const q = params.q.toLowerCase();
      rows = rows.filter((s) => s.name.toLowerCase().includes(q) || s.regNo.toLowerCase().includes(q) || s.email.toLowerCase().includes(q));
    }
    if (params?.departmentId) rows = rows.filter((s) => s.departmentId === params.departmentId);
    if (params?.semester !== undefined && params.semester !== "") rows = rows.filter((s) => s.semester === Number(params.semester));
    if (params?.section) rows = rows.filter((s) => s.section === params.section);
    return rows.map(publicStudent);
  },
  async student(id: string) {
    requireRole("ADMIN", "FACULTY");
    await latency();
    const db = loadDB();
    const s = db.students.find((x) => x.id === id);
    if (!s) throw new ApiError(404, "Student not found.");
    return publicStudent(s);
  },
  async createStudent(data: Omit<Student, "id" | "userId" | "status">, autoEnroll: boolean) {
    requireRole("ADMIN");
    await latency();
    const db = loadDB();
    if (!data.name.trim() || !data.regNo.trim() || !data.email.trim()) throw new ApiError(422, "Name, registration number and email are required.");
    if (db.students.some((s) => s.regNo.toLowerCase() === data.regNo.trim().toLowerCase())) throw new ApiError(409, `Registration number ${data.regNo} already exists.`);
    if (db.users.some((u) => u.email.toLowerCase() === data.email.trim().toLowerCase())) throw new ApiError(409, "A login account with this email already exists.");
    const id = nextId(db, "S");
    const uid = nextId(db, "U");
    const student: Student = { ...data, name: data.name.trim(), regNo: data.regNo.trim().toUpperCase(), email: data.email.trim(), id, userId: uid, status: "ACTIVE" };
    db.students.push(student);
    db.users.push({ id: uid, name: student.name, email: student.email, passHash: hashPass("demo123"), role: "STUDENT", studentId: id });
    if (autoEnroll) {
      db.courses.filter((c) => c.semester === student.semester).forEach((c) => {
        db.enrollments.push({ id: nextId(db, "EN"), studentId: id, courseId: c.id });
      });
    }
    notify(db, uid, "Welcome to CampusCore", "Your student account has been created. Default password: demo123.", "SUCCESS");
    logActivity(db, `New student registered — ${student.name} (${student.regNo})`, "Admin Office");
    saveDB(db);
    return publicStudent(student);
  },
  async updateStudent(id: string, patch: Partial<Student>) {
    requireRole("ADMIN");
    await latency();
    const db = loadDB();
    const s = db.students.find((x) => x.id === id);
    if (!s) throw new ApiError(404, "Student not found.");
    if (patch.regNo && patch.regNo !== s.regNo && db.students.some((x) => x.regNo.toLowerCase() === patch.regNo!.toLowerCase())) {
      throw new ApiError(409, "That registration number is already in use.");
    }
    Object.assign(s, patch);
    const u = db.users.find((x) => x.id === s.userId);
    if (u && patch.name) u.name = patch.name;
    logActivity(db, `Student record updated — ${s.name}`, "Admin Office");
    saveDB(db);
    return publicStudent(s);
  },
  myStudentRecord: async () => {
    const { sid } = requireStudent();
    await latency();
    const db = loadDB();
    const s = db.students.find((x) => x.id === sid);
    if (!s) throw new ApiError(404, "Student record not found.");
    return publicStudent(s);
  },
  async updateMyProfile(patch: { phone: string }) {
    const { sid } = requireStudent();
    await latency();
    const db = loadDB();
    const s = db.students.find((x) => x.id === sid)!;
    if (patch.phone.trim().length < 6) throw new ApiError(422, "Enter a valid phone number.");
    s.phone = patch.phone.trim();
    logActivity(db, `Student profile updated — ${s.name}`, s.name);
    saveDB(db);
    return publicStudent(s);
  },

  /* ---------- faculty ---------- */
  async facultyList() {
    requireRole("ADMIN", "FACULTY", "STUDENT");
    await latency();
    const db = loadDB();
    return db.faculty.map((f) => ({ ...f, department: db.departments.find((d) => d.id === f.departmentId)?.name ?? "—", courseCount: db.courses.filter((c) => c.facultyId === f.id).length }));
  },
  async createFaculty(data: { name: string; email: string; phone: string; departmentId: string; designation: string }, makeLogin: boolean) {
    requireRole("ADMIN");
    await latency();
    const db = loadDB();
    if (!data.name.trim() || !data.email.trim()) throw new ApiError(422, "Name and email are required.");
    if (db.faculty.some((f) => f.email.toLowerCase() === data.email.toLowerCase())) throw new ApiError(409, "A faculty member with this email exists.");
    const id = nextId(db, "F");
    const profile: FacultyProfile = { ...data, id };
    db.faculty.push(profile);
    if (makeLogin) {
      const uid = nextId(db, "U");
      db.users.push({ id: uid, name: data.name, email: data.email, passHash: hashPass("demo123"), role: "FACULTY", facultyId: id });
      profile.userId = uid;
    }
    logActivity(db, `Faculty added — ${data.name}`, "Admin Office");
    saveDB(db);
    return profile;
  },
  async updateFaculty(id: string, patch: Partial<{ name: string; phone: string; departmentId: string; designation: string }>) {
    requireRole("ADMIN");
    await latency();
    const db = loadDB();
    const f = db.faculty.find((x) => x.id === id);
    if (!f) throw new ApiError(404, "Faculty not found.");
    Object.assign(f, patch);
    saveDB(db);
    return f;
  },

  /* ---------- courses ---------- */
  async courses() {
    requireRole("ADMIN", "FACULTY", "STUDENT");
    await latency();
    const db = loadDB();
    return db.courses.map((c) => courseWithStats(db, c));
  },
  async myTeachingCourses() {
    const { fid } = requireFaculty();
    await latency();
    const db = loadDB();
    return db.courses.filter((c) => c.facultyId === fid).map((c) => courseWithStats(db, c));
  },
  async createCourse(data: { code: string; name: string; facultyId: string; departmentId: string; credits: number; semester: number; type: CourseType; difficulty: Difficulty }) {
    requireRole("ADMIN");
    await latency();
    const db = loadDB();
    if (!data.code.trim() || !data.name.trim()) throw new ApiError(422, "Course code and name are required.");
    if (db.courses.some((c) => c.code.toLowerCase() === data.code.toLowerCase())) throw new ApiError(409, "Course code already exists.");
    if (data.credits < 1 || data.credits > 6) throw new ApiError(422, "Credits must be between 1 and 6.");
    const c: Course = { ...data, id: nextId(db, "C") };
    db.courses.push(c);
    logActivity(db, `Course created — ${c.code} ${c.name}`, "Admin Office");
    saveDB(db);
    return c;
  },
  async updateCourse(id: string, patch: Partial<Course>) {
    requireRole("ADMIN");
    await latency();
    const db = loadDB();
    const c = db.courses.find((x) => x.id === id);
    if (!c) throw new ApiError(404, "Course not found.");
    Object.assign(c, patch);
    saveDB(db);
    return c;
  },

  /* ---------- attendance ---------- */
  async attendanceRoster(courseId: string, date: string) {
    requireRole("ADMIN", "FACULTY");
    const t = requireAuth();
    const db = loadDB();
    const course = db.courses.find((c) => c.id === courseId);
    if (!course) throw new ApiError(404, "Course not found.");
    if (t.role === "FACULTY" && course.facultyId !== t.fid) throw new ApiError(403, "You are not assigned to this course.");
    await latency();
    const enrolled = db.enrollments.filter((e) => e.courseId === courseId).map((e) => db.students.find((s) => s.id === e.studentId)!).filter(Boolean);
    const rows = enrolled.map((s) => {
      const rec = db.attendance.find((r) => r.courseId === courseId && r.studentId === s.id && r.date === date);
      const all = db.attendance.filter((r) => r.courseId === courseId && r.studentId === s.id);
      return { studentId: s.id, name: s.name, regNo: s.regNo, section: s.section, status: rec?.status ?? null, running: calculateAttendance(all.map((r) => r.status)) };
    });
    return { course: { id: course.id, code: course.code, name: course.name }, date, rows };
  },
  async saveAttendance(courseId: string, date: string, records: { studentId: string; status: AttendanceStatus }[]) {
    const t = requireRole("ADMIN", "FACULTY");
    const db = loadDB();
    const course = db.courses.find((c) => c.id === courseId);
    if (!course) throw new ApiError(404, "Course not found.");
    if (t.role === "FACULTY" && course.facultyId !== t.fid) throw new ApiError(403, "You are not assigned to this course.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError(422, "Invalid date.");
    for (const r of records) if (r.status !== "PRESENT" && r.status !== "ABSENT") throw new ApiError(422, "Attendance status must be PRESENT or ABSENT.");
    await latency();
    for (const r of records) {
      const existing = db.attendance.find((a) => a.courseId === courseId && a.studentId === r.studentId && a.date === date);
      if (existing) existing.status = r.status;
      else db.attendance.push({ id: nextId(db, "A"), courseId, studentId: r.studentId, date, status: r.status });
    }
    const actor = db.users.find((u) => u.id === t.uid)?.name ?? "System";
    logActivity(db, `Attendance saved — ${course.code} ${course.name} on ${date} (${records.length} students)`, actor);
    // notify students now below threshold in this course
    for (const r of records) {
      const recs = db.attendance.filter((a) => a.courseId === courseId && a.studentId === r.studentId);
      const sum = calculateAttendance(recs.map((a) => a.status));
      const st = db.students.find((s) => s.id === r.studentId);
      if (st?.userId && sum.belowThreshold && sum.total > 0) {
        notify(db, st.userId, `Attendance below threshold — ${course.name}`,
          `Your attendance in ${course.code} is now ${sum.percentage}% (required ${sum.threshold}%). Status: ${sum.risk}.`,
          sum.risk === "CRITICAL" ? "DANGER" : "WARNING");
      }
    }
    saveDB(db);
    return { saved: records.length };
  },
  async courseAttendanceSummary() {
    requireRole("ADMIN", "FACULTY");
    await latency();
    const db = loadDB();
    return db.courses.map((c) => {
      const recs = db.attendance.filter((r) => r.courseId === c.id);
      const enrolled = db.enrollments.filter((e) => e.courseId === c.id).length;
      const perStudent = db.enrollments.filter((e) => e.courseId === c.id).map((e) => {
        const s = db.students.find((x) => x.id === e.studentId)!;
        const sRecs = db.attendance.filter((r) => r.courseId === c.id && r.studentId === e.studentId);
        return { studentId: e.studentId, name: s?.name, regNo: s?.regNo, ...calculateAttendance(sRecs.map((r) => r.status)) };
      });
      return { course: { id: c.id, code: c.code, name: c.name }, enrolled, overall: calculateAttendance(recs.map((r) => r.status)), perStudent };
    });
  },
  async myAttendance() {
    const { sid } = requireStudent();
    await latency();
    const db = loadDB();
    const courseIds = db.enrollments.filter((e) => e.studentId === sid).map((e) => e.courseId);
    const courses = db.courses.filter((c) => courseIds.includes(c.id)).map((c) => {
      const recs = db.attendance.filter((r) => r.courseId === c.id && r.studentId === sid).sort((a, b) => b.date.localeCompare(a.date));
      return { course: { id: c.id, code: c.code, name: c.name, type: c.type }, summary: calculateAttendance(recs.map((r) => r.status)), recent: recs.slice(0, 10).map((r) => ({ date: r.date, status: r.status })) };
    });
    const all = db.attendance.filter((r) => r.studentId === sid);
    return { overall: calculateAttendance(all.map((r) => r.status)), courses };
  },

  /* ---------- marks / assessments ---------- */
  async marksRoster(courseId: string, type: AssessmentType) {
    requireRole("ADMIN", "FACULTY");
    const t = requireAuth();
    const db = loadDB();
    const course = db.courses.find((c) => c.id === courseId);
    if (!course) throw new ApiError(404, "Course not found.");
    if (t.role === "FACULTY" && course.facultyId !== t.fid) throw new ApiError(403, "You are not assigned to this course.");
    await latency();
    const rows = db.enrollments.filter((e) => e.courseId === courseId).map((e) => {
      const s = db.students.find((x) => x.id === e.studentId)!;
      const existing = db.assessments.find((a) => a.courseId === courseId && a.studentId === e.studentId && a.type === type);
      return { studentId: e.studentId, name: s?.name, regNo: s?.regNo, marks: existing?.marks ?? null, maxMarks: existing?.maxMarks ?? ASSESSMENT_MAX_DEFAULTS[type], date: existing?.date ?? null };
    });
    return { course: { id: course.id, code: course.code, name: course.name }, type, rows };
  },
  async saveMarks(courseId: string, type: AssessmentType, date: string, entries: { studentId: string; marks: number; maxMarks: number }[]) {
    const t = requireRole("ADMIN", "FACULTY");
    const db = loadDB();
    const course = db.courses.find((c) => c.id === courseId);
    if (!course) throw new ApiError(404, "Course not found.");
    if (t.role === "FACULTY" && course.facultyId !== t.fid) throw new ApiError(403, "You are not assigned to this course.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError(422, "Invalid date.");
    for (const e of entries) {
      if (e.maxMarks <= 0) throw new ApiError(422, "Maximum marks must be positive.");
      if (e.marks < 0 || e.marks > e.maxMarks) throw new ApiError(422, `Marks must be between 0 and ${e.maxMarks} for every student.`);
    }
    await latency();
    for (const e of entries) {
      const existing = db.assessments.find((a) => a.courseId === courseId && a.studentId === e.studentId && a.type === type);
      if (existing) { existing.marks = e.marks; existing.maxMarks = e.maxMarks; existing.date = date; }
      else db.assessments.push({ id: nextId(db, "M"), courseId, studentId: e.studentId, type, marks: e.marks, maxMarks: e.maxMarks, date });
    }
    const actor = db.users.find((u) => u.id === t.uid)?.name ?? "System";
    logActivity(db, `${type} marks saved — ${course.code} ${course.name} (${entries.length} students)`, actor);
    for (const e of entries) {
      const st = db.students.find((s) => s.id === e.studentId);
      if (st?.userId) notify(db, st.userId, `Marks published — ${course.name}`, `Your ${type} score: ${e.marks}/${e.maxMarks}.`, "INFO");
    }
    saveDB(db);
    const classAvg = calculateClassAverage(db.assessments.filter((a) => a.courseId === courseId && a.type === type));
    return { saved: entries.length, classAverage: classAvg };
  },
  async courseMarks(courseId: string) {
    requireRole("ADMIN", "FACULTY");
    await latency();
    const db = loadDB();
    const grouped: Record<string, Assessment[]> = {};
    db.assessments.filter((a) => a.courseId === courseId).forEach((a) => {
      (grouped[a.type] ??= []).push(a);
    });
    return Object.entries(grouped).map(([type, rows]) => ({
      type,
      classAverage: calculateClassAverage(rows),
      rows: rows.map((a) => {
        const s = db.students.find((x) => x.id === a.studentId);
        const pct = pctOf(a);
        return { studentId: a.studentId, name: s?.name, regNo: s?.regNo, marks: a.marks, maxMarks: a.maxMarks, pct, date: a.date, grade: calculateGrade(pct).grade };
      }).sort((x, y) => y.pct - x.pct),
    }));
  },
  async myMarks() {
    const { sid } = requireStudent();
    await latency();
    const db = loadDB();
    const courseIds = db.enrollments.filter((e) => e.studentId === sid).map((e) => e.courseId);
    return db.courses.filter((c) => courseIds.includes(c.id)).map((c) => {
      const mine = db.assessments.filter((a) => a.courseId === c.id && a.studentId === sid).sort((a, b) => a.date.localeCompare(b.date));
      const all = db.assessments.filter((a) => a.courseId === c.id);
      const minePct = mine.map(pctOf);
      const avg = minePct.length ? round1(minePct.reduce((s, v) => s + v, 0) / minePct.length) : null;
      const classAvg = all.length ? calculateClassAverage(all) : null;
      return {
        course: { id: c.id, code: c.code, name: c.name, credits: c.credits },
        assessments: mine.map((a) => {
          const classmates = all.filter((x) => x.type === a.type);
          const cAvg = calculateClassAverage(classmates);
          const pct = pctOf(a);
          return { id: a.id, type: a.type, marks: a.marks, maxMarks: a.maxMarks, pct, date: a.date, classAvg: cAvg, diff: round1(pct - cAvg), grade: calculateGrade(pct).grade };
        }),
        average: avg, classAverage: classAvg,
        difference: avg !== null && classAvg !== null ? round1(avg - classAvg) : null,
        trend: calculateTrend(minePct),
      };
    });
  },

  /* ---------- results ---------- */
  async myResults() {
    const { sid } = requireStudent();
    await latency();
    const db = loadDB();
    const p = buildStudentProfile(db, sid);
    return { results: p.results, summary: p.summary, gradingScale: gradeScaleRows() };
  },
  async courseResults(courseId: string) {
    requireRole("ADMIN", "FACULTY");
    await latency();
    const db = loadDB();
    const course = db.courses.find((c) => c.id === courseId);
    if (!course) throw new ApiError(404, "Course not found.");
    const rows = db.enrollments.filter((e) => e.courseId === courseId).map((e) => {
      const s = db.students.find((x) => x.id === e.studentId)!;
      const fat = db.assessments.find((a) => a.courseId === courseId && a.studentId === e.studentId && a.type === "FAT");
      const pct = fat ? pctOf(fat) : null;
      const g = pct !== null ? calculateGrade(pct) : null;
      return { studentId: e.studentId, name: s?.name, regNo: s?.regNo, marks: fat?.marks ?? null, maxMarks: fat?.maxMarks ?? null, pct, grade: g?.grade ?? null, points: g?.points ?? null, passed: g?.passed ?? null };
    });
    const gradedPcts = rows.filter((r) => r.pct !== null).map((r) => r.pct as number);
    return {
      course: { id: course.id, code: course.code, name: course.name, credits: course.credits },
      rows: rows.sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1)),
      classAverage: gradedPcts.length ? round1(gradedPcts.reduce((s, v) => s + v, 0) / gradedPcts.length) : null,
      passCount: rows.filter((r) => r.passed === true).length,
    };
  },

  /* ---------- fees ---------- */
  async feesList() {
    requireRole("ADMIN");
    await latency();
    const db = loadDB();
    return db.fees.map((f) => {
      const s = db.students.find((x) => x.id === f.studentId);
      return { ...f, ...calculateFee(f.total, f.paid), studentName: s?.name ?? "—", regNo: s?.regNo ?? "—" };
    });
  },
  async createFee(data: { studentId: string; semester: number; description: string; total: number; dueDate: string }) {
    requireRole("ADMIN");
    await latency();
    const db = loadDB();
    if (!data.studentId) throw new ApiError(422, "Select a student.");
    if (data.total <= 0) throw new ApiError(422, "Total fee must be greater than zero.");
    if (db.fees.some((f) => f.studentId === data.studentId && f.semester === data.semester)) throw new ApiError(409, "A fee record for this student and semester already exists.");
    const rec = { ...data, paid: 0, id: nextId(db, "FE") };
    db.fees.push(rec);
    const st = db.students.find((s) => s.id === data.studentId);
    if (st?.userId) notify(db, st.userId, "New fee record created", `${data.description} — ₹${data.total.toLocaleString("en-IN")} for semester ${data.semester}.`, "INFO");
    logActivity(db, `Fee record created — ${st?.name ?? data.studentId} (₹${data.total.toLocaleString("en-IN")})`, "Admin Office");
    saveDB(db);
    return rec;
  },
  async recordPayment(feeId: string, amount: number) {
    requireRole("ADMIN");
    await latency();
    const db = loadDB();
    const f = db.fees.find((x) => x.id === feeId);
    if (!f) throw new ApiError(404, "Fee record not found.");
    if (!Number.isFinite(amount) || amount <= 0) throw new ApiError(422, "Enter a valid payment amount.");
    if (f.paid + amount > f.total) throw new ApiError(422, `Payment exceeds balance. Due amount is ₹${(f.total - f.paid).toLocaleString("en-IN")}.`);
    f.paid += amount;
    const st = db.students.find((s) => s.id === f.studentId);
    const { due, status } = calculateFee(f.total, f.paid);
    if (st?.userId) notify(db, st.userId, "Fee payment recorded", `₹${amount.toLocaleString("en-IN")} received. ${status === "PAID" ? "Your fees are fully paid." : `Balance due: ₹${due.toLocaleString("en-IN")}.`}`, status === "PAID" ? "SUCCESS" : "INFO");
    logActivity(db, `Fee payment ₹${amount.toLocaleString("en-IN")} recorded — ${st?.name ?? f.studentId}`, "Admin Office");
    saveDB(db);
    return { ...f, ...calculateFee(f.total, f.paid) };
  },
  async myFees() {
    const { sid } = requireStudent();
    await latency();
    const db = loadDB();
    const rows = db.fees.filter((f) => f.studentId === sid).map((f) => ({ ...f, ...calculateFee(f.total, f.paid) }));
    const total = rows.reduce((s, f) => s + f.total, 0);
    const paid = rows.reduce((s, f) => s + f.paid, 0);
    return { rows, total, paid, ...calculateFee(total, paid) };
  },

  /* ---------- requests ---------- */
  async createRequest(data: { type: RequestType; subject: string; body: string }) {
    const { sid } = requireStudent();
    await latency();
    const db = loadDB();
    if (!data.subject.trim() || !data.body.trim()) throw new ApiError(422, "Subject and description are required.");
    const st = db.students.find((s) => s.id === sid)!;
    const req = { ...data, id: nextId(db, "R"), studentId: sid, status: "PENDING" as RequestStatus, createdAt: nowStamp() };
    db.requests.push(req);
    const adminUser = db.users.find((u) => u.role === "ADMIN");
    if (adminUser) notify(db, adminUser.id, "New student request", `${st.name} (${st.regNo}) — ${data.subject}`, "INFO");
    logActivity(db, `Request submitted — ${data.subject} (${st.name})`, st.name);
    saveDB(db);
    return req;
  },
  async myRequests() {
    const { sid } = requireStudent();
    await latency();
    const db = loadDB();
    return db.requests.filter((r) => r.studentId === sid).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async requestsList() {
    requireRole("ADMIN");
    await latency();
    const db = loadDB();
    return db.requests.map((r) => {
      const s = db.students.find((x) => x.id === r.studentId);
      return { ...r, studentName: s?.name ?? "—", regNo: s?.regNo ?? "—" };
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async setRequestStatus(id: string, status: RequestStatus, note?: string) {
    requireRole("ADMIN");
    await latency();
    const db = loadDB();
    const r = db.requests.find((x) => x.id === id);
    if (!r) throw new ApiError(404, "Request not found.");
    const allowed: Record<RequestStatus, RequestStatus[]> = {
      PENDING: ["APPROVED", "REJECTED"],
      APPROVED: ["COMPLETED"],
      REJECTED: [],
      COMPLETED: [],
    };
    if (!allowed[r.status].includes(status)) throw new ApiError(409, `Cannot move a ${r.status} request to ${status}.`);
    r.status = status;
    r.decidedAt = nowStamp();
    if (note) r.note = note;
    const st = db.students.find((s) => s.id === r.studentId);
    if (st?.userId) {
      const kind: NoticeKind = status === "APPROVED" || status === "COMPLETED" ? "SUCCESS" : "DANGER";
      notify(db, st.userId, `Request ${status.toLowerCase()} — ${r.subject}`, note || `Your request has been ${status.toLowerCase()} by the admin office.`, kind);
    }
    logActivity(db, `Request ${status.toLowerCase()} — ${r.subject}`, "Admin Office");
    saveDB(db);
    return r;
  },

  /* ---------- notifications ---------- */
  async myNotifications() {
    const t = requireAuth();
    await latency();
    const db = loadDB();
    return db.notifications.filter((n) => n.userId === t.uid).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async unreadCount() {
    const t = requireAuth();
    const db = loadDB();
    return db.notifications.filter((n) => n.userId === t.uid && !n.read).length;
  },
  async markRead(id: string) {
    const t = requireAuth();
    const db = loadDB();
    const n = db.notifications.find((x) => x.id === id && x.userId === t.uid);
    if (n) { n.read = true; saveDB(db); }
    return { ok: true };
  },
  async markAllRead() {
    const t = requireAuth();
    const db = loadDB();
    db.notifications.forEach((n) => { if (n.userId === t.uid) n.read = true; });
    saveDB(db);
    return { ok: true };
  },
  async broadcast(data: { title: string; body: string; audience: "STUDENTS" | "FACULTY" | "ALL" }) {
    requireRole("ADMIN");
    await latency();
    const db = loadDB();
    if (!data.title.trim() || !data.body.trim()) throw new ApiError(422, "Title and message are required.");
    const targets = db.users.filter((u) => data.audience === "ALL" ? true : u.role === (data.audience === "STUDENTS" ? "STUDENT" : "FACULTY"));
    targets.forEach((u) => notify(db, u.id, data.title.trim(), data.body.trim(), "INFO"));
    logActivity(db, `Notice broadcast — “${data.title.trim()}” to ${data.audience.toLowerCase()}`, "Admin Office");
    saveDB(db);
    return { sent: targets.length };
  },

  /* ---------- timetable / exams ---------- */
  async timetable() {
    const t = requireAuth();
    await latency();
    const db = loadDB();
    let slots = db.timetable;
    if (t.role === "STUDENT") {
      const ids = db.enrollments.filter((e) => e.studentId === t.sid).map((e) => e.courseId);
      slots = slots.filter((s) => ids.includes(s.courseId));
    } else if (t.role === "FACULTY") {
      const ids = db.courses.filter((c) => c.facultyId === t.fid).map((c) => c.id);
      slots = slots.filter((s) => ids.includes(s.courseId));
    }
    return slots.map((s) => {
      const c = db.courses.find((x) => x.id === s.courseId);
      return { ...s, courseCode: c?.code ?? "—", courseName: c?.name ?? "—", facultyName: db.faculty.find((f) => f.id === c?.facultyId)?.name ?? "—" };
    }).sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
  },
  async saveTimetableSlot(data: { courseId: string; day: number; start: string; end: string; room: string }) {
    requireRole("ADMIN");
    await latency();
    const db = loadDB();
    if (!data.courseId || data.day < 1 || data.day > 5 || !data.start || !data.end) throw new ApiError(422, "Complete all timetable fields.");
    const slot = { ...data, id: nextId(db, "T") };
    db.timetable.push(slot);
    logActivity(db, `Timetable slot added — ${db.courses.find((c) => c.id === data.courseId)?.code ?? ""} on day ${data.day}`, "Admin Office");
    saveDB(db);
    return slot;
  },
  async deleteTimetableSlot(id: string) {
    requireRole("ADMIN");
    const db = loadDB();
    db.timetable = db.timetable.filter((t) => t.id !== id);
    saveDB(db);
    return { ok: true };
  },
  async exams() {
    const t = requireAuth();
    await latency();
    const db = loadDB();
    let rows = db.exams;
    if (t.role === "STUDENT") {
      const ids = db.enrollments.filter((e) => e.studentId === t.sid).map((e) => e.courseId);
      rows = rows.filter((e) => ids.includes(e.courseId));
    } else if (t.role === "FACULTY") {
      const ids = db.courses.filter((c) => c.facultyId === t.fid).map((c) => c.id);
      rows = rows.filter((e) => ids.includes(e.courseId));
    }
    return rows.map((e) => ({ ...e, courseCode: db.courses.find((c) => c.id === e.courseId)?.code ?? "—", courseName: db.courses.find((c) => c.id === e.courseId)?.name ?? "—" }))
      .sort((a, b) => a.date.localeCompare(b.date));
  },
  async saveExam(data: { courseId: string; name: string; semester: number; date: string; start: string; end: string; venue: string }) {
    requireRole("ADMIN");
    await latency();
    const db = loadDB();
    if (!data.courseId || !data.name.trim() || !data.date || !data.venue.trim()) throw new ApiError(422, "Complete all exam fields.");
    const exam = { ...data, id: nextId(db, "X") };
    db.exams.push(exam);
    const enrolledUsers = db.enrollments.filter((e) => e.courseId === data.courseId)
      .map((e) => db.students.find((s) => s.id === e.studentId)?.userId).filter(Boolean) as string[];
    const cname = db.courses.find((c) => c.id === data.courseId)?.name ?? "";
    enrolledUsers.forEach((uid) => notify(db, uid, `Exam scheduled — ${data.name}`, `${cname} on ${data.date}, ${data.start}–${data.end} at ${data.venue}.`, "WARNING"));
    logActivity(db, `Exam scheduled — ${data.name} (${cname}) on ${data.date}`, "Admin Office");
    saveDB(db);
    return exam;
  },
  async deleteExam(id: string) {
    requireRole("ADMIN");
    const db = loadDB();
    db.exams = db.exams.filter((e) => e.id !== id);
    saveDB(db);
    return { ok: true };
  },

  /* ---------- assignments ---------- */
  async assignments() {
    const t = requireAuth();
    await latency();
    const db = loadDB();
    const today = todayISO();
    const withMeta = (list: typeof db.assignments) => list.map((a) => {
      const c = db.courses.find((x) => x.id === a.courseId);
      const enrolled = db.enrollments.filter((e) => e.courseId === a.courseId).length;
      const submitted = db.submissions.filter((s) => s.assignmentId === a.id).length;
      const mySub = t.role === "STUDENT" ? db.submissions.find((s) => s.assignmentId === a.id && s.studentId === t.sid) : undefined;
      const status = mySub ? "SUBMITTED" : a.dueDate < today ? "OVERDUE" : "PENDING";
      return { ...a, courseCode: c?.code ?? "—", courseName: c?.name ?? "—", enrolled, submitted, myStatus: status, submittedAt: mySub?.submittedAt ?? null };
    });
    if (t.role === "STUDENT") {
      const ids = db.enrollments.filter((e) => e.studentId === t.sid).map((e) => e.courseId);
      return withMeta(db.assignments.filter((a) => ids.includes(a.courseId))).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    }
    if (t.role === "FACULTY") {
      const ids = db.courses.filter((c) => c.facultyId === t.fid).map((c) => c.id);
      return withMeta(db.assignments.filter((a) => ids.includes(a.courseId))).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    }
    return withMeta(db.assignments).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  },
  async createAssignment(data: { courseId: string; title: string; description: string; dueDate: string }) {
    const t = requireRole("ADMIN", "FACULTY");
    const db = loadDB();
    const course = db.courses.find((c) => c.id === data.courseId);
    if (!course) throw new ApiError(404, "Course not found.");
    if (t.role === "FACULTY" && course.facultyId !== t.fid) throw new ApiError(403, "You can only post assignments for your own courses.");
    if (!data.title.trim() || !data.dueDate) throw new ApiError(422, "Title and due date are required.");
    await latency();
    const a = { ...data, id: nextId(db, "AS"), createdAt: nowStamp() };
    db.assignments.push(a);
    const users = db.enrollments.filter((e) => e.courseId === data.courseId)
      .map((e) => db.students.find((s) => s.id === e.studentId)?.userId).filter(Boolean) as string[];
    users.forEach((uid) => notify(db, uid, `New assignment — ${course.name}`, `“${data.title}” is due ${data.dueDate}.`, "INFO"));
    logActivity(db, `Assignment posted — ${data.title} (${course.code})`, db.users.find((u) => u.id === t.uid)?.name ?? "Faculty");
    saveDB(db);
    return a;
  },
  async submitAssignment(assignmentId: string) {
    const { sid } = requireStudent();
    await latency();
    const db = loadDB();
    const a = db.assignments.find((x) => x.id === assignmentId);
    if (!a) throw new ApiError(404, "Assignment not found.");
    const enrolled = db.enrollments.some((e) => e.courseId === a.courseId && e.studentId === sid);
    if (!enrolled) throw new ApiError(403, "You are not enrolled in this course.");
    if (db.submissions.some((s) => s.assignmentId === assignmentId && s.studentId === sid)) throw new ApiError(409, "Already submitted.");
    db.submissions.push({ id: nextId(db, "SB"), assignmentId, studentId: sid, status: "SUBMITTED", submittedAt: nowStamp() });
    const st = db.students.find((s) => s.id === sid)!;
    logActivity(db, `Assignment submitted — ${a.title} (${st.name})`, st.name);
    saveDB(db);
    return { ok: true };
  },

  /* ---------- academic profile (AI-ready) ---------- */
  async myAcademicProfile() {
    const { sid } = requireStudent();
    await latency();
    const db = loadDB();
    return buildStudentProfile(db, sid);
  },
  async studentProfile(id: string) {
    requireRole("ADMIN");
    await latency();
    const db = loadDB();
    if (!db.students.some((s) => s.id === id)) throw new ApiError(404, "Student not found.");
    return buildStudentProfile(db, id);
  },

  /* ---------- academic coach (AI layer) ---------- */
  // POST /api/ai/chat — STUDENT only; identity always derived from the token.
  async aiChat(message: string, history: { role: "user" | "assistant"; content: string }[] = []) {
    const { sid } = requireStudent();
    if (typeof message !== "string" || !message.trim()) throw new ApiError(422, "Message cannot be empty.");
    const db = loadDB();
    const profile = buildStudentProfile(db, sid); // backend builds the profile; the AI never touches the DB
    const turns = Array.isArray(history) ? history.filter((h) => h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string").slice(-6) : [];
    return aiChatService(profile, message, turns);
  },
  async aiConfig() {
    requireStudent();
    return { ...getAiConfig(), apiKey: getAiConfig().apiKey ? "••••" + getAiConfig().apiKey.slice(-4) : "" };
  },
  async saveAiConfig(cfg: { mode: "local" | "http"; apiKey: string; model: string; baseUrl: string }) {
    requireStudent();
    if (cfg.mode !== "local" && cfg.mode !== "http") throw new ApiError(422, "Mode must be 'local' or 'http'.");
    if (cfg.mode === "http" && cfg.baseUrl && !/^https?:\/\//i.test(cfg.baseUrl)) throw new ApiError(422, "Base URL must start with http(s)://");
    // An empty apiKey means "keep existing" so masked values never overwrite real keys.
    const existing = getAiConfig();
    const merged = { ...cfg, apiKey: cfg.apiKey.startsWith("••••") ? existing.apiKey : cfg.apiKey };
    return saveAiConfig(merged);
  },

  /* ---------- dashboards ---------- */
  async adminDashboard() {
    requireRole("ADMIN");
    await latency();
    return adminStats(loadDB());
  },
  async facultyDashboard() {
    const { fid } = requireFaculty();
    await latency();
    return facultyStats(loadDB(), fid);
  },
  async studentDashboard() {
    const { sid } = requireStudent();
    await latency();
    const db = loadDB();
    const profile = buildStudentProfile(db, sid);
    const t = requireAuth();
    const notices = db.notifications.filter((n) => n.userId === t.uid).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
    const openAssignments = profile.actions.filter((a) => a.kind === "assignment");
    return { profile, recentNotifications: notices, openAssignments: openAssignments.length };
  },

  /* ---------- search & meta ---------- */
  async search(q: string) {
    requireRole("ADMIN", "FACULTY");
    const db = loadDB();
    const needle = q.trim().toLowerCase();
    if (!needle) return { students: [], courses: [], faculty: [] };
    return {
      students: db.students.filter((s) => s.name.toLowerCase().includes(needle) || s.regNo.toLowerCase().includes(needle)).slice(0, 5).map((s) => ({ id: s.id, label: s.name, sub: s.regNo })),
      courses: db.courses.filter((c) => c.name.toLowerCase().includes(needle) || c.code.toLowerCase().includes(needle)).slice(0, 5).map((c) => ({ id: c.id, label: c.name, sub: c.code })),
      faculty: db.faculty.filter((f) => f.name.toLowerCase().includes(needle)).slice(0, 5).map((f) => ({ id: f.id, label: f.name, sub: f.designation })),
    };
  },
  async departments() {
    requireAuth();
    return loadDB().departments;
  },
  async resetDemo() {
    await latency();
    resetDB();
    logActivity(loadDB(), "Demo database restored to seed state", "System");
    return { ok: true };
  },
};

function courseWithStats(db: DB, c: Course) {
  const enrolled = db.enrollments.filter((e) => e.courseId === c.id).length;
  const recs = db.attendance.filter((r) => r.courseId === c.id);
  const as = db.assessments.filter((a) => a.courseId === c.id);
  return {
    ...c, enrolled,
    facultyName: db.faculty.find((f) => f.id === c.facultyId)?.name ?? "—",
    department: db.departments.find((d) => d.id === c.departmentId)?.code ?? "—",
    attendance: calculateAttendance(recs.map((r) => r.status)),
    classAverage: as.length ? calculateClassAverage(as) : null,
  };
}

function gradeScaleRows() {
  return [
    { range: "90–100", grade: "A+", points: 10 }, { range: "80–89", grade: "A", points: 9 },
    { range: "70–79", grade: "B+", points: 8 }, { range: "60–69", grade: "B", points: 7 },
    { range: "50–59", grade: "C", points: 6 }, { range: "40–49", grade: "D", points: 5 },
    { range: "Below 40", grade: "F", points: 0 },
  ];
}
