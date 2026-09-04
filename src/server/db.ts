/* ============================================================================
   CampusCore — Database Layer (in-browser, localStorage-persisted)
   Mirrors the relational schema planned for SQLite/PostgreSQL.
   All business data lives here; the API layer (api.ts) is the only consumer.
   ========================================================================= */

export type Role = "ADMIN" | "FACULTY" | "STUDENT";
export type AttendanceStatus = "PRESENT" | "ABSENT";
export type CourseType = "CORE" | "ELECTIVE" | "FOUNDATION" | "LAB" | "PROJECT" | "OTHER";
export type Difficulty = "EASY" | "MEDIUM" | "HARD";
export type AssessmentType = "CAT1" | "CAT2" | "QUIZ" | "ASSIGNMENT" | "LAB" | "FAT" | "PROJECT" | "OTHER";
export type FeeStatus = "PAID" | "PARTIAL" | "PENDING";
export type RequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "COMPLETED";
export type RequestType = "LEAVE" | "ACADEMIC" | "BONAFIDE" | "DOCUMENT" | "GENERAL";
export type AttendanceRisk = "SAFE" | "WARNING" | "CRITICAL";
export type Trend = "IMPROVING" | "DECLINING" | "STABLE" | "INSUFFICIENT_DATA";
export type NoticeKind = "INFO" | "SUCCESS" | "WARNING" | "DANGER";

export interface User {
  id: string; name: string; email: string; passHash: string;
  role: Role; studentId?: string; facultyId?: string;
}
export interface Department { id: string; name: string; code: string; }
export interface FacultyProfile {
  id: string; name: string; email: string; phone: string;
  departmentId: string; designation: string; userId?: string;
}
export interface Student {
  id: string; name: string; regNo: string; email: string; phone: string;
  departmentId: string; program: string; branch: string; semester: number;
  section: string; batch: string; admissionYear: number;
  status: "ACTIVE" | "INACTIVE"; userId?: string;
}
export interface Course {
  id: string; code: string; name: string; facultyId: string; departmentId: string;
  credits: number; semester: number; type: CourseType; difficulty: Difficulty;
}
export interface Enrollment { id: string; studentId: string; courseId: string; }
export interface AttendanceRecord {
  id: string; courseId: string; studentId: string; date: string; status: AttendanceStatus;
}
export interface Assessment {
  id: string; courseId: string; studentId: string; type: AssessmentType;
  marks: number; maxMarks: number; date: string;
}
export interface Exam {
  id: string; courseId: string; name: string; semester: number;
  date: string; start: string; end: string; venue: string;
}
export interface TimetableSlot {
  id: string; courseId: string; day: number; // 1 = Monday … 5 = Friday
  start: string; end: string; room: string;
}
export interface Assignment {
  id: string; courseId: string; title: string; description: string;
  dueDate: string; createdAt: string;
}
export interface Submission {
  id: string; assignmentId: string; studentId: string;
  status: "SUBMITTED"; submittedAt: string;
}
export interface FeeRecord {
  id: string; studentId: string; semester: number; description: string;
  total: number; paid: number; dueDate: string;
}
export interface ServiceRequest {
  id: string; studentId: string; type: RequestType; subject: string; body: string;
  status: RequestStatus; createdAt: string; decidedAt?: string; note?: string;
}
export interface Notification {
  id: string; userId: string; title: string; body: string; kind: NoticeKind;
  read: boolean; createdAt: string;
}
export interface Activity { id: string; at: string; text: string; actor: string; }
export interface CurriculumUnit { no: number; title: string; topics: string[]; }
export interface CourseCurriculum {
  courseId: string; description: string; prerequisites: string[];
  objectives: string[]; units: CurriculumUnit[];
}
export interface CourseFeedback {
  courseId: string; avgClarity: number; avgCourse: number; responses: number; // aggregated, neutral statistics
}

export interface DB {
  v: number; seq: number;
  users: User[]; departments: Department[]; faculty: FacultyProfile[]; students: Student[];
  courses: Course[]; enrollments: Enrollment[]; attendance: AttendanceRecord[];
  assessments: Assessment[]; exams: Exam[]; timetable: TimetableSlot[];
  assignments: Assignment[]; submissions: Submission[]; fees: FeeRecord[];
  requests: ServiceRequest[]; notifications: Notification[]; activity: Activity[];
  curricula: CourseCurriculum[]; feedbacks: CourseFeedback[];
}

/* ---------------- date helpers ---------------- */

export const toISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const todayISO = () => toISO(new Date());
export const addDaysISO = (n: number, from?: string) => {
  const base = from ? new Date(from + "T12:00:00") : new Date();
  base.setDate(base.getDate() + n);
  return toISO(base);
};
export const nowStamp = () => new Date().toISOString();
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Last `n` weekdays (Mon–Fri), ascending, ending yesterday/today. */
export function lastWeekdays(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  while (out.length < n) {
    d.setDate(d.getDate() - 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) out.push(toISO(d));
  }
  return out.reverse();
}

/* ---------------- persistence ---------------- */

// Storage shim so the same code runs in browsers and in the Node test runner.
if (typeof (globalThis as { localStorage?: unknown }).localStorage === "undefined") {
  const mem = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => { mem.clear(); },
  };
}

const LS_KEY = "campuscore.db.v1";
let cache: DB | null = null;

export function loadDB(): DB {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DB;
      if (parsed && parsed.v === 1) {
        // Additive migration: tables introduced by the AI Coach layer.
        if (!parsed.curricula) parsed.curricula = seedCurricula();
        if (!parsed.feedbacks) parsed.feedbacks = seedFeedbacks();
        cache = parsed;
        return parsed;
      }
    }
  } catch { /* corrupted → reseed */ }
  cache = buildSeed();
  saveDB(cache);
  return cache;
}
export function saveDB(db: DB) { cache = db; localStorage.setItem(LS_KEY, JSON.stringify(db)); }
export function resetDB(): DB {
  cache = buildSeed();
  saveDB(cache);
  return cache;
}
export function nextId(db: DB, prefix: string): string {
  db.seq += 1;
  return `${prefix}${db.seq}`;
}

/** Demo-grade password digest (production backend would use bcrypt). */
export function hashPass(p: string): string {
  let h = 5381;
  const s = "cc::" + p;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return "h" + (h >>> 0).toString(36);
}

/* ---------------- seed ---------------- */

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* ---- curriculum & feedback seed (synthetic demo content) ---- */

export function seedCurricula(): CourseCurriculum[] {
  const u = (no: number, title: string, topics: string[]): CurriculumUnit => ({ no, title, topics });
  return [
    {
      courseId: "C1", description: "Design and analysis of fundamental data structures and algorithms with complexity reasoning.",
      prerequisites: ["Programming in C"],
      objectives: ["Reason about time and space complexity", "Select the right structure for a problem", "Implement classic graph and tree algorithms"],
      units: [
        u(1, "Complexity & Linear Structures", ["Asymptotic notation", "Arrays", "Linked lists"]),
        u(2, "Stacks, Queues & Recursion", ["ADTs", "Applications", "Divide and conquer"]),
        u(3, "Trees & BSTs", ["Binary trees", "Traversals", "AVL rotations"]),
        u(4, "Heaps & Hashing", ["Priority queues", "Hash functions", "Collision handling"]),
        u(5, "Graphs", ["BFS/DFS", "Shortest paths", "MST"]),
      ],
    },
    {
      courseId: "C2", description: "Relational database theory, modelling, SQL and transaction processing.",
      prerequisites: ["Programming in C", "Set theory basics"],
      objectives: ["Model data with ER diagrams", "Write correct SQL", "Normalize schemas to 3NF"],
      units: [
        u(1, "Data Modelling", ["ER model", "Cardinality", "Weak entities"]),
        u(2, "Relational Model & SQL", ["Relational algebra", "DDL/DML", "Joins & subqueries"]),
        u(3, "Normalization", ["Functional dependencies", "1NF–BCNF", "Decomposition"]),
        u(4, "Transactions", ["ACID", "Schedules", "Concurrency control"]),
        u(5, "Indexing & Storage", ["B+ trees", "Query plans", "File organization"]),
      ],
    },
    {
      courseId: "C3", description: "Operating system concepts: processes, scheduling, synchronization, memory and storage.",
      prerequisites: ["Data Structures & Algorithms"],
      objectives: ["Explain process lifecycle and scheduling", "Solve classic synchronization problems", "Analyse paging and deadlock conditions"],
      units: [
        u(1, "Processes & Threads", ["PCB", "Context switching", "IPC"]),
        u(2, "CPU Scheduling", ["FCFS/SJF/RR", "Priority", "Multilevel queues"]),
        u(3, "Synchronization", ["Critical sections", "Semaphores", "Monitors"]),
        u(4, "Deadlocks", ["Conditions", "Banker's algorithm", "Recovery"]),
        u(5, "Memory Management", ["Paging", "Segmentation", "Virtual memory", "Page replacement"]),
      ],
    },
    {
      courseId: "C4", description: "Layered network architecture from physical links to application protocols.",
      prerequisites: ["Probability & Statistics (parallel)"],
      objectives: ["Map protocols to OSI/TCP-IP layers", "Trace packet flow end to end", "Compute addressing and subnetting"],
      units: [
        u(1, "Foundations", ["OSI & TCP/IP", "Encapsulation", "Performance metrics"]),
        u(2, "Data Link Layer", ["Framing", "Error detection", "MAC & Ethernet"]),
        u(3, "Network Layer", ["IPv4 addressing", "Subnetting", "Routing basics"]),
        u(4, "Transport Layer", ["UDP vs TCP", "Flow control", "Congestion control"]),
        u(5, "Application Layer", ["DNS", "HTTP", "Email protocols"]),
      ],
    },
    {
      courseId: "C5", description: "Probability theory and statistical inference for engineers.",
      prerequisites: ["Class XII Mathematics"],
      objectives: ["Compute probabilities from axioms", "Work with common distributions", "Interpret hypothesis tests"],
      units: [
        u(1, "Probability Axioms", ["Sample spaces", "Conditional probability", "Bayes theorem"]),
        u(2, "Random Variables", ["PMF/PDF", "CDF", "Expectation & variance"]),
        u(3, "Distributions", ["Binomial", "Poisson", "Normal"]),
        u(4, "Joint Distributions", ["Independence", "Covariance", "CLT"]),
        u(5, "Inference", ["Estimation", "Confidence intervals", "Hypothesis testing"]),
      ],
    },
    {
      courseId: "C6", description: "Hands-on database laboratory aligned with the DBMS theory course.",
      prerequisites: ["Database Management Systems (parallel)"],
      objectives: ["Write production-quality SQL", "Design and normalize a schema", "Build a small data-driven application"],
      units: [
        u(1, "SQL Fundamentals", ["DDL", "DML", "Constraints"]),
        u(2, "Advanced Queries", ["Joins", "Aggregation", "Views"]),
        u(3, "Schema Design Lab", ["ER to tables", "Normalization practice"]),
        u(4, "Procedural SQL", ["Functions", "Triggers", "Cursors"]),
        u(5, "Mini Project", ["End-to-end data app", "Indexing & explain plans"]),
      ],
    },
    {
      courseId: "C7", description: "Python programming applied to data engineering tasks.",
      prerequisites: ["None"],
      objectives: ["Write idiomatic Python", "Process structured data files", "Automate small data pipelines"],
      units: [
        u(1, "Language Core", ["Syntax", "Collections", "Functions"]),
        u(2, "Data Handling", ["CSV/JSON", "Comprehensions", "Error handling"]),
        u(3, "OOP & Modules", ["Classes", "Packages", "Testing basics"]),
        u(4, "Mini Pipelines", ["ETL script", "Logging", "CLI tools"]),
      ],
    },
  ];
}

export function seedFeedbacks(): CourseFeedback[] {
  // Aggregated, anonymized statistics only (demo data).
  return [
    { courseId: "C1", avgClarity: 4.3, avgCourse: 4.2, responses: 41 },
    { courseId: "C2", avgClarity: 4.1, avgCourse: 4.0, responses: 39 },
    { courseId: "C3", avgClarity: 3.7, avgCourse: 3.6, responses: 40 },
    { courseId: "C4", avgClarity: 4.0, avgCourse: 3.9, responses: 37 },
    { courseId: "C5", avgClarity: 3.9, avgCourse: 3.8, responses: 35 },
    { courseId: "C6", avgClarity: 4.4, avgCourse: 4.5, responses: 33 },
    { courseId: "C7", avgClarity: 4.2, avgCourse: 4.3, responses: 30 },
  ];
}

export function buildSeed(): DB {
  const rng = mulberry32(20260214);
  const d = (n: number) => addDaysISO(n);
  const stamp = (daysAgo: number) => {
    const t = new Date(); t.setDate(t.getDate() + daysAgo); t.setHours(10, 15, 0, 0);
    return t.toISOString();
  };
  const dates = lastWeekdays(26);

  const departments: Department[] = [
    { id: "D1", name: "Computer Science & Engineering", code: "CSE" },
    { id: "D2", name: "Electronics & Communication", code: "ECE" },
    { id: "D3", name: "Science & Humanities", code: "SSH" },
  ];

  const faculty: FacultyProfile[] = [
    { id: "F1", name: "Dr. Kavitha Raman", email: "faculty@college.edu", phone: "98220 11223", departmentId: "D1", designation: "Professor" },
    { id: "F2", name: "Prof. Arjun Mehta", email: "arjun.mehta@college.edu", phone: "98220 44556", departmentId: "D1", designation: "Assistant Professor" },
    { id: "F3", name: "Dr. Sneha Kulkarni", email: "sneha.k@college.edu", phone: "98220 77889", departmentId: "D3", designation: "Associate Professor" },
    { id: "F4", name: "Prof. Vikram Iyer", email: "vikram.iyer@college.edu", phone: "98220 33445", departmentId: "D2", designation: "Assistant Professor" },
  ];

  const mkStudent = (
    id: string, name: string, regNo: string, email: string, phone: string,
    section: string,
  ): Student => ({
    id, name, regNo, email, phone, departmentId: "D1", program: "B.Tech",
    branch: "Computer Science & Engineering", semester: 4, section,
    batch: "2023–2027", admissionYear: 2023, status: "ACTIVE",
  });

  const students: Student[] = [
    mkStudent("S1", "Aarav Sharma", "23CSE001", "aarav@college.edu", "98765 43210", "A"),
    mkStudent("S2", "Neha Patel", "23CSE002", "neha@college.edu", "98765 43211", "A"),
    mkStudent("S3", "Rohan Verma", "23CSE003", "student1@college.edu", "98765 43212", "A"),
    mkStudent("S4", "Ishita Rao", "23CSE004", "student2@college.edu", "98765 43213", "A"),
    mkStudent("S5", "Kabir Singh", "23CSE005", "kabir.singh@college.edu", "98765 43214", "B"),
    mkStudent("S6", "Divya Nair", "23CSE006", "divya.nair@college.edu", "98765 43215", "B"),
    mkStudent("S7", "Aditya Menon", "23CSE007", "aditya.menon@college.edu", "98765 43216", "B"),
    mkStudent("S8", "Sara Khan", "23CSE008", "sara.khan@college.edu", "98765 43217", "B"),
  ];

  const users: User[] = [
    { id: "U1", name: "Dr. Anita Deshmukh", email: "admin@college.edu", passHash: hashPass("demo123"), role: "ADMIN" },
    { id: "U2", name: "Dr. Kavitha Raman", email: "faculty@college.edu", passHash: hashPass("demo123"), role: "FACULTY", facultyId: "F1" },
    ...students.map((s, i): User => ({
      id: `U${i + 3}`, name: s.name, email: s.email, passHash: hashPass("demo123"), role: "STUDENT", studentId: s.id,
    })),
  ];
  faculty[0].userId = "U2";
  students.forEach((s, i) => { s.userId = `U${i + 3}`; });

  const courses: Course[] = [
    { id: "C1", code: "CS401", name: "Data Structures & Algorithms", facultyId: "F1", departmentId: "D1", credits: 4, semester: 4, type: "CORE", difficulty: "MEDIUM" },
    { id: "C2", code: "CS402", name: "Database Management Systems", facultyId: "F1", departmentId: "D1", credits: 4, semester: 4, type: "CORE", difficulty: "MEDIUM" },
    { id: "C3", code: "CS403", name: "Operating Systems", facultyId: "F2", departmentId: "D1", credits: 4, semester: 4, type: "CORE", difficulty: "HARD" },
    { id: "C4", code: "CS404", name: "Computer Networks", facultyId: "F2", departmentId: "D1", credits: 4, semester: 4, type: "CORE", difficulty: "MEDIUM" },
    { id: "C5", code: "MA401", name: "Probability & Statistics", facultyId: "F3", departmentId: "D3", credits: 3, semester: 4, type: "FOUNDATION", difficulty: "MEDIUM" },
    { id: "C6", code: "CS405", name: "DBMS Laboratory", facultyId: "F1", departmentId: "D1", credits: 2, semester: 4, type: "LAB", difficulty: "EASY" },
    { id: "C7", code: "CS406", name: "Python for Data Engineering", facultyId: "F3", departmentId: "D1", credits: 3, semester: 4, type: "ELECTIVE", difficulty: "EASY" },
  ];

  // Section A (S1–S4) take all 7 courses; Section B (S5–S8) take the 5 theory courses.
  const enrollments: Enrollment[] = [];
  let eid = 0;
  students.forEach((s, si) => {
    const courseCount = si < 4 ? 7 : 5;
    for (let ci = 0; ci < courseCount; ci++) {
      eid += 1;
      enrollments.push({ id: `EN${eid}`, studentId: s.id, courseId: courses[ci].id });
    }
  });

  /* ---- attendance: exact absence counts per (student, course) ---- */
  const absencePlan: number[][] = [
    // C1 C2 C3 C4 C5 C6 C7
    [2, 3, 9, 2, 4, 1, 2], // Aarav  → OS at 65.4% (CRITICAL)
    [1, 0, 2, 1, 0, 0, 1], // Neha
    [2, 3, 3, 2, 2, 1, 2], // Rohan
    [0, 1, 1, 0, 1, 0, 0], // Ishita
    [3, 7, 4, 3, 3, 2, 3], // Kabir  → DBMS at 73.1% (WARNING)
    [2, 2, 5, 2, 2, 1, 2], // Divya
    [3, 4, 4, 5, 3, 2, 3], // Aditya
    [1, 1, 2, 1, 1, 0, 1], // Sara
  ];
  const attendance: AttendanceRecord[] = [];
  let aid = 0;
  students.forEach((s, si) => {
    const courseCount = si < 4 ? 7 : 5;
    for (let ci = 0; ci < courseCount; ci++) {
      const abs = absencePlan[si][ci];
      const absentIdx = new Set<number>();
      if (abs > 0) {
        const step = dates.length / abs;
        for (let j = 0; j < abs; j++) absentIdx.add(Math.min(dates.length - 1, Math.round(step * (j + 0.5))));
      }
      dates.forEach((date, i) => {
        aid += 1;
        attendance.push({
          id: `A${aid}`, courseId: courses[ci].id, studentId: s.id, date,
          status: absentIdx.has(i) ? "ABSENT" : "PRESENT",
        });
      });
    }
  });

  /* ---- assessments: percent targets → marks ---- */
  const courseMean = [68, 63, 66, 70, 64, 78, 73];
  // Aarav's engineered story: strong+improving C1, average C2, weak+declining C3, improving C4/C5.
  const aaravPct: Record<string, number[]> = {
    C1: [70, 78, 86, 91], C2: [58, 60, 63, 62], C3: [55, 50, 44, 38],
    C4: [66, 70, 75, 78], C5: [52, 57, 61, 64], C6: [80, 86], C7: [74, 81],
  };
  const assessDates = { QUIZ: d(-24), CAT1: d(-16), CAT2: d(-8), FAT: d(-2), LAB1: d(-14), LAB2: d(-4) };
  const assessments: Assessment[] = [];
  let mid = 0;
  const pushA = (courseId: string, studentId: string, type: AssessmentType, pct: number, max: number, date: string) => {
    mid += 1;
    assessments.push({
      id: `M${mid}`, courseId, studentId, type,
      marks: clamp(Math.round((pct / 100) * max), 0, max), maxMarks: max, date,
    });
  };
  students.forEach((s, si) => {
    const courseCount = si < 4 ? 7 : 5;
    for (let ci = 0; ci < courseCount; ci++) {
      const c = courses[ci];
      const targets: [AssessmentType, number, string][] =
        c.id === "C6"
          ? [["LAB", 30, assessDates.LAB1], ["LAB", 30, assessDates.LAB2]]
          : c.id === "C7"
            ? [["QUIZ", 20, assessDates.QUIZ], ["CAT1", 50, assessDates.CAT1]]
            : [["QUIZ", 20, assessDates.QUIZ], ["CAT1", 50, assessDates.CAT1], ["CAT2", 50, assessDates.CAT2], ["FAT", 100, assessDates.FAT]];
      targets.forEach(([type, max, date], ti) => {
        const pct = si === 0
          ? aaravPct[c.id][ti]
          : clamp(Math.round(courseMean[ci] + (rng() * 32 - 15)), 32, 97);
        pushA(c.id, s.id, type, pct, max, date);
      });
    }
  });

  /* ---- exams (past FATs + upcoming practicals / supplementary) ---- */
  const exams: Exam[] = [
    { id: "X1", courseId: "C1", name: "End Semester Theory (FAT)", semester: 4, date: d(-2), start: "14:00", end: "17:00", venue: "A-201" },
    { id: "X2", courseId: "C2", name: "End Semester Theory (FAT)", semester: 4, date: d(-2), start: "09:30", end: "12:30", venue: "A-202" },
    { id: "X3", courseId: "C3", name: "End Semester Theory (FAT)", semester: 4, date: d(-2), start: "14:00", end: "17:00", venue: "A-203" },
    { id: "X4", courseId: "C4", name: "End Semester Theory (FAT)", semester: 4, date: d(-2), start: "09:30", end: "12:30", venue: "B-101" },
    { id: "X5", courseId: "C5", name: "End Semester Theory (FAT)", semester: 4, date: d(-2), start: "14:00", end: "16:00", venue: "B-102" },
    { id: "X6", courseId: "C6", name: "Lab Practical Examination", semester: 4, date: d(4), start: "10:00", end: "13:00", venue: "DB Lab 2" },
    { id: "X7", courseId: "C7", name: "Project Review Viva", semester: 4, date: d(6), start: "14:00", end: "16:00", venue: "Seminar Hall" },
    { id: "X8", courseId: "C3", name: "Supplementary Theory Exam", semester: 4, date: d(9), start: "10:00", end: "13:00", venue: "A-101" },
  ];

  /* ---- timetable ---- */
  const timetable: TimetableSlot[] = [
    { id: "T1", courseId: "C1", day: 1, start: "09:00", end: "10:00", room: "LH-204" },
    { id: "T2", courseId: "C2", day: 1, start: "10:00", end: "11:00", room: "LH-204" },
    { id: "T3", courseId: "C5", day: 1, start: "11:15", end: "12:15", room: "LH-103" },
    { id: "T4", courseId: "C3", day: 2, start: "09:00", end: "10:00", room: "LH-205" },
    { id: "T5", courseId: "C4", day: 2, start: "10:00", end: "11:00", room: "LH-205" },
    { id: "T6", courseId: "C7", day: 2, start: "14:00", end: "15:00", room: "LH-103" },
    { id: "T7", courseId: "C1", day: 3, start: "09:00", end: "10:00", room: "LH-204" },
    { id: "T8", courseId: "C3", day: 3, start: "11:15", end: "12:15", room: "LH-205" },
    { id: "T9", courseId: "C5", day: 3, start: "14:00", end: "15:00", room: "LH-103" },
    { id: "T10", courseId: "C2", day: 4, start: "09:00", end: "10:00", room: "LH-204" },
    { id: "T11", courseId: "C4", day: 4, start: "10:00", end: "11:00", room: "LH-205" },
    { id: "T12", courseId: "C7", day: 4, start: "11:15", end: "12:15", room: "LH-103" },
    { id: "T13", courseId: "C6", day: 5, start: "09:30", end: "12:30", room: "DB Lab 2" },
    { id: "T14", courseId: "C1", day: 5, start: "14:00", end: "15:00", room: "LH-204" },
  ];

  /* ---- assignments & submissions ---- */
  const assignments: Assignment[] = [
    { id: "AS1", courseId: "C1", title: "Balanced BST — Implementation & Complexity Analysis", description: "Implement an AVL tree with insert/delete. Submit the report with rotation diagrams and a complexity table.", dueDate: d(3), createdAt: stamp(-6) },
    { id: "AS2", courseId: "C2", title: "ER Modelling — Hospital Management Case Study", description: "Draw the complete ER diagram (entities, relationships, cardinalities) and convert it to a relational schema in 3NF.", dueDate: d(1), createdAt: stamp(-5) },
    { id: "AS3", courseId: "C3", title: "CPU Scheduler Simulation (FCFS / SJF / RR)", description: "Simulate all three policies on the given process set. Compare average waiting and turnaround times.", dueDate: d(-2), createdAt: stamp(-9) },
    { id: "AS4", courseId: "C4", title: "Wireshark — TCP Handshake & Congestion Analysis", description: "Capture a real TCP session and annotate the handshake, sequence numbers and retransmissions.", dueDate: d(5), createdAt: stamp(-4) },
    { id: "AS5", courseId: "C7", title: "Python Mini Project — Grade Analyzer CLI", description: "Build a small CLI that reads a CSV of marks and prints grades, averages and toppers.", dueDate: d(6), createdAt: stamp(-3) },
  ];
  const submissions: Submission[] = [
    { id: "SB1", assignmentId: "AS2", studentId: "S2", status: "SUBMITTED", submittedAt: stamp(-2) },
    { id: "SB2", assignmentId: "AS2", studentId: "S4", status: "SUBMITTED", submittedAt: stamp(-2) },
    { id: "SB3", assignmentId: "AS2", studentId: "S6", status: "SUBMITTED", submittedAt: stamp(-1) },
    { id: "SB4", assignmentId: "AS3", studentId: "S2", status: "SUBMITTED", submittedAt: stamp(-4) },
    { id: "SB5", assignmentId: "AS3", studentId: "S4", status: "SUBMITTED", submittedAt: stamp(-3) },
    { id: "SB6", assignmentId: "AS3", studentId: "S5", status: "SUBMITTED", submittedAt: stamp(-3) },
    { id: "SB7", assignmentId: "AS3", studentId: "S8", status: "SUBMITTED", submittedAt: stamp(-2) },
    { id: "SB8", assignmentId: "AS4", studentId: "S1", status: "SUBMITTED", submittedAt: stamp(-1) },
    { id: "SB9", assignmentId: "AS4", studentId: "S3", status: "SUBMITTED", submittedAt: stamp(-1) },
    { id: "SB10", assignmentId: "AS1", studentId: "S4", status: "SUBMITTED", submittedAt: stamp(0) },
    { id: "SB11", assignmentId: "AS5", studentId: "S6", status: "SUBMITTED", submittedAt: stamp(0) },
  ];

  /* ---- fees ---- */
  const fees: FeeRecord[] = [
    { id: "FE1", studentId: "S1", semester: 4, description: "Semester 4 — Tuition & Examination", total: 45000, paid: 20000, dueDate: d(12) },
    { id: "FE2", studentId: "S2", semester: 4, description: "Semester 4 — Tuition & Examination", total: 45000, paid: 45000, dueDate: d(12) },
    { id: "FE3", studentId: "S3", semester: 4, description: "Semester 4 — Tuition & Examination", total: 45000, paid: 0, dueDate: d(12) },
    { id: "FE4", studentId: "S4", semester: 4, description: "Semester 4 — Tuition & Examination", total: 45000, paid: 45000, dueDate: d(12) },
    { id: "FE5", studentId: "S5", semester: 4, description: "Semester 4 — Tuition & Examination", total: 45000, paid: 15000, dueDate: d(12) },
    { id: "FE6", studentId: "S6", semester: 4, description: "Semester 4 — Tuition & Examination", total: 45000, paid: 45000, dueDate: d(12) },
    { id: "FE7", studentId: "S7", semester: 4, description: "Semester 4 — Tuition & Examination", total: 45000, paid: 0, dueDate: d(12) },
    { id: "FE8", studentId: "S8", semester: 4, description: "Semester 4 — Tuition & Examination", total: 45000, paid: 30000, dueDate: d(12) },
  ];

  /* ---- requests ---- */
  const requests: ServiceRequest[] = [
    { id: "R1", studentId: "S1", type: "LEAVE", subject: "Leave — Inter-College Hackathon (3 days)", body: "Requesting leave from 24th to 26th to represent the college at SmartHack 2026, Pune. Event pass and faculty mentor approval are attached.", status: "PENDING", createdAt: stamp(-1) },
    { id: "R2", studentId: "S1", type: "BONAFIDE", subject: "Bonafide certificate for internship application", body: "Need a bonafide certificate addressed to TCS iON for a summer internship application.", status: "APPROVED", createdAt: stamp(-5), decidedAt: stamp(-3), note: "Approved. Collect the signed copy from Admin Office, Block A." },
    { id: "R3", studentId: "S3", type: "ACADEMIC", subject: "Fee payment in two instalments", body: "Due to financial constraints, I request permission to pay the semester fee in two instalments this term.", status: "PENDING", createdAt: stamp(-2) },
    { id: "R4", studentId: "S2", type: "DOCUMENT", subject: "Official transcript — 2 copies", body: "Require two sealed official transcripts for a university application abroad.", status: "COMPLETED", createdAt: stamp(-9), decidedAt: stamp(-7), note: "Transcripts issued. Receipt no. 2214." },
  ];

  /* ---- notifications ---- */
  const notifications: Notification[] = [
    { id: "N1", userId: "U3", title: "Result published — Data Structures & Algorithms", body: "You scored 91/100 (A+) in the FAT. Class average: 68%.", kind: "SUCCESS", read: false, createdAt: stamp(-2) },
    { id: "N2", userId: "U3", title: "Attendance below threshold — Operating Systems", body: "Your attendance in CS403 is 65.4%, below the required 75%. Attend the next classes to recover.", kind: "DANGER", read: false, createdAt: stamp(-1) },
    { id: "N3", userId: "U3", title: "Fee due reminder", body: "₹25,000 is pending for Semester 4. Due date is approaching.", kind: "WARNING", read: false, createdAt: stamp(-1) },
    { id: "N4", userId: "U3", title: "New assignment — Database Management Systems", body: "“ER Modelling — Hospital Management Case Study” is due soon.", kind: "INFO", read: true, createdAt: stamp(-5) },
    { id: "N5", userId: "U4", title: "Result published — Data Structures & Algorithms", body: "Your FAT result for CS401 has been published.", kind: "SUCCESS", read: false, createdAt: stamp(-2) },
    { id: "N6", userId: "U5", title: "Fee pending — Semester 4", body: "No payment recorded yet for Semester 4. Total due: ₹45,000.", kind: "WARNING", read: false, createdAt: stamp(-1) },
    { id: "N7", userId: "U1", title: "2 student requests awaiting review", body: "A leave request and a fee-instalment request are pending approval.", kind: "INFO", read: false, createdAt: stamp(-1) },
    { id: "N8", userId: "U2", title: "Supplementary exam scheduled — CS403", body: "A supplementary theory exam for Operating Systems has been scheduled by the admin office.", kind: "INFO", read: false, createdAt: stamp(-1) },
  ];

  /* ---- activity feed ---- */
  const activity: Activity[] = [
    { id: "AC1", at: stamp(0), text: "Assignment submitted — Wireshark TCP Analysis (Aarav Sharma)", actor: "System" },
    { id: "AC2", at: stamp(-1), text: "Attendance saved — CS402 Database Management Systems (8 students)", actor: "Dr. Kavitha Raman" },
    { id: "AC3", at: stamp(-2), text: "FAT results published for 5 theory courses", actor: "Admin Office" },
    { id: "AC4", at: stamp(-3), text: "Fee payment ₹15,000 recorded — Kabir Singh", actor: "Dr. Anita Deshmukh" },
    { id: "AC5", at: stamp(-3), text: "Request approved — Bonafide certificate (Aarav Sharma)", actor: "Dr. Anita Deshmukh" },
    { id: "AC6", at: stamp(-4), text: "New assignment posted — CS403 Operating Systems", actor: "Prof. Arjun Mehta" },
    { id: "AC7", at: stamp(-5), text: "Student profile updated — Sara Khan", actor: "Sara Khan" },
  ];

  return {
    v: 1, seq: 1000,
    users, departments, faculty, students, courses, enrollments, attendance,
    assessments, exams, timetable, assignments, submissions, fees, requests,
    notifications, activity,
    curricula: seedCurricula(), feedbacks: seedFeedbacks(),
  };
}
