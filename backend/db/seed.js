/* ============================================================================
   CampusCore demo data seed — same demo story as the original build:
   Aarav: strong+improving DSA, average DBMS, weak+declining OS (attendance
   65.4% → CRITICAL), improving CN/Stats, partial fees, pending leave request.
   Usage: node db/seed.js [--reset]
   ========================================================================= */
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { init } = require("../src/config/db");

const db = init();
const reset = process.argv.includes("--reset");

/* ---------------- date helpers (ISO, local-safe) ---------------- */
const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDaysISO = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return toISO(d); };
const stamp = (daysAgo) => { const d = new Date(); d.setDate(d.getDate() + daysAgo); d.setHours(10, 15, 0, 0); return d.toISOString(); };
function lastWeekdays(n) {
  const out = []; const d = new Date();
  while (out.length < n) { d.setDate(d.getDate() - 1); const dow = d.getDay(); if (dow !== 0 && dow !== 6) out.push(toISO(d)); }
  return out.reverse();
}

/* ---------------- deterministic RNG (same story every seed) ---------------- */
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260214);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function run() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  db.run("PRAGMA foreign_keys = OFF");
  if (reset) {
    for (const t of ["departments","programs","users","faculty","students","courses","enrollments",
      "attendance","assessments","assessment_scores","exams","timetable","assignments",
      "assignment_submissions","fees","requests","notifications","curricula","feedbacks","audit_logs"]) {
      db.run(`DELETE FROM ${t}`);
    }
  }
  db.run(schema); // idempotent (IF NOT EXISTS)
  db.run("PRAGMA foreign_keys = ON");

  const existing = db.get("SELECT COUNT(*) AS n FROM users");
  if (existing.n > 0 && !reset) { console.log("Database already seeded. Use --reset to reseed."); return; }

  const pass = bcrypt.hashSync("demo123", 10);
  const dates = lastWeekdays(26);

  /* ---- departments & programs ---- */
  const deps = [
    [1, "Computer Science & Engineering", "CSE"],
    [2, "Electronics & Communication", "ECE"],
    [3, "Science & Humanities", "SSH"],
  ];
  for (const [id, name, code] of deps) db.run("INSERT INTO departments (id,name,code) VALUES (?,?,?)", [id, name, code]);
  const progs = [
    [1, "B.Tech", "UNDERGRADUATE", 4, 1],
    [2, "M.Tech", "POSTGRADUATE", 2, 1],
    [3, "B.Sc", "UNDERGRADUATE", 3, 3],
  ];
  for (const p of progs) db.run("INSERT INTO programs (id,name,level,duration_years,department_id) VALUES (?,?,?,?,?)", p);

  /* ---- users ---- */
  db.run("INSERT INTO users (id,name,email,pass_hash,role,faculty_id) VALUES (1,'Dr. Anita Deshmukh','admin@college.edu',?,'ADMIN',NULL)", [pass]);
  db.run("INSERT INTO users (id,name,email,pass_hash,role,faculty_id) VALUES (2,'Dr. Kavitha Raman','faculty@college.edu',?,'FACULTY',1)", [pass]);

  /* ---- faculty ---- */
  const fac = [
    [1, 2, "Dr. Kavitha Raman", "faculty@college.edu", "98220 11223", 1, "Professor"],
    [2, null, "Prof. Arjun Mehta", "arjun.mehta@college.edu", "98220 44556", 1, "Assistant Professor"],
    [3, null, "Dr. Sneha Kulkarni", "sneha.k@college.edu", "98220 77889", 3, "Associate Professor"],
    [4, null, "Prof. Vikram Iyer", "vikram.iyer@college.edu", "98220 33445", 2, "Assistant Professor"],
  ];
  for (const f of fac) db.run("INSERT INTO faculty (id,user_id,name,email,phone,department_id,designation) VALUES (?,?,?,?,?,?,?)", f);

  /* ---- students + their logins (users 3..10) ---- */
  const studs = [
    [1, "Aarav Sharma", "23CSE001", "aarav@college.edu", "98765 43210", "A"],
    [2, "Neha Patel", "23CSE002", "neha@college.edu", "98765 43211", "A"],
    [3, "Rohan Verma", "23CSE003", "student1@college.edu", "98765 43212", "A"],
    [4, "Ishita Rao", "23CSE004", "student2@college.edu", "98765 43213", "A"],
    [5, "Kabir Singh", "23CSE005", "kabir.singh@college.edu", "98765 43214", "B"],
    [6, "Divya Nair", "23CSE006", "divya.nair@college.edu", "98765 43215", "B"],
    [7, "Aditya Menon", "23CSE007", "aditya.menon@college.edu", "98765 43216", "B"],
    [8, "Sara Khan", "23CSE008", "sara.khan@college.edu", "98765 43217", "B"],
  ];
  studs.forEach(([id, name, reg, email, phone, section], i) => {
    db.run("INSERT INTO students (id,user_id,name,reg_no,email,phone,department_id,program_id,program,branch,semester,section,batch,admission_year,status) VALUES (?,?,?,?,?,1,1,'B.Tech','Computer Science & Engineering',4,?,'2023–2027',2023,'ACTIVE')",
      [id, id + 2, name, reg, email, phone, section]);
    db.run("INSERT INTO users (id,name,email,pass_hash,role,student_id) VALUES (?,?,?,?,'STUDENT',?)", [id + 2, name, email, pass, id]);
  });

  /* ---- courses ---- */
  const courses = [
    [1, "CS401", "Data Structures & Algorithms", 1, 1, 4, 4, "CORE", "MEDIUM"],
    [2, "CS402", "Database Management Systems", 1, 1, 4, 4, "CORE", "MEDIUM"],
    [3, "CS403", "Operating Systems", 2, 1, 4, 4, "CORE", "HARD"],
    [4, "CS404", "Computer Networks", 2, 1, 4, 4, "CORE", "MEDIUM"],
    [5, "MA401", "Probability & Statistics", 3, 3, 3, 4, "FOUNDATION", "MEDIUM"],
    [6, "CS405", "DBMS Laboratory", 1, 1, 2, 4, "LAB", "EASY"],
    [7, "CS406", "Python for Data Engineering", 3, 1, 3, 4, "ELECTIVE", "EASY"],
  ];
  for (const c of courses) db.run("INSERT INTO courses (id,code,name,faculty_id,department_id,credits,semester,type,difficulty) VALUES (?,?,?,?,?,?,?,?,?)", c);

  /* ---- enrollments: section A (1-4) all 7, section B (5-8) first 5 ---- */
  for (let s = 1; s <= 8; s++) {
    const count = s <= 4 ? 7 : 5;
    for (let c = 1; c <= count; c++) db.run("INSERT INTO enrollments (student_id,course_id) VALUES (?,?)", [s, c]);
  }

  /* ---- attendance: exact absence counts per (student, course) ---- */
  const absencePlan = [
    [2, 3, 9, 2, 4, 1, 2], // Aarav → OS 17/26 = 65.4% CRITICAL
    [1, 0, 2, 1, 0, 0, 1],
    [2, 3, 3, 2, 2, 1, 2],
    [0, 1, 1, 0, 1, 0, 0],
    [3, 7, 4, 3, 3, 2, 3], // Kabir → DBMS 73.1% WARNING
    [2, 2, 5, 2, 2, 1, 2],
    [3, 4, 4, 5, 3, 2, 3],
    [1, 1, 2, 1, 1, 0, 1],
  ];
  const insAtt = (cid, sid, date, status) =>
    db.run("INSERT INTO attendance (course_id,student_id,date,status) VALUES (?,?,?,?)", [cid, sid, date, status]);
  for (let s = 1; s <= 8; s++) {
    const count = s <= 4 ? 7 : 5;
    for (let c = 1; c <= count; c++) {
      const abs = absencePlan[s - 1][c - 1];
      const absentIdx = new Set();
      if (abs > 0) {
        const step = dates.length / abs;
        for (let j = 0; j < abs; j++) absentIdx.add(Math.min(dates.length - 1, Math.round(step * (j + 0.5))));
      }
      dates.forEach((date, i) => insAtt(c, s, date, absentIdx.has(i) ? "ABSENT" : "PRESENT"));
    }
  }

  /* ---- assessments (slots) + scores ---- */
  const d = addDaysISO;
  const slotsByCourse = {
    1: [["QUIZ", 20, d(-24)], ["CAT1", 50, d(-16)], ["CAT2", 50, d(-8)], ["FAT", 100, d(-2)]],
    2: [["QUIZ", 20, d(-24)], ["CAT1", 50, d(-16)], ["CAT2", 50, d(-8)], ["FAT", 100, d(-2)]],
    3: [["QUIZ", 20, d(-24)], ["CAT1", 50, d(-16)], ["CAT2", 50, d(-8)], ["FAT", 100, d(-2)]],
    4: [["QUIZ", 20, d(-24)], ["CAT1", 50, d(-16)], ["CAT2", 50, d(-8)], ["FAT", 100, d(-2)]],
    5: [["QUIZ", 20, d(-24)], ["CAT1", 50, d(-16)], ["CAT2", 50, d(-8)], ["FAT", 100, d(-2)]],
    6: [["LAB", 30, d(-14)], ["LAB", 30, d(-4)]],
    7: [["QUIZ", 20, d(-24)], ["CAT1", 50, d(-16)]],
  };
  const courseMean = [68, 63, 66, 70, 64, 78, 73];
  const aaravPct = {
    1: [70, 78, 86, 91], 2: [58, 60, 63, 62], 3: [55, 50, 44, 38],
    4: [66, 70, 75, 78], 5: [52, 57, 61, 64], 6: [80, 86], 7: [74, 81],
  };
  let aid = 0;
  for (let c = 1; c <= 7; c++) {
    slotsByCourse[c].forEach(([type, max, date], ti) => {
      aid += 1;
      db.run("INSERT INTO assessments (id,course_id,type,max_marks,date) VALUES (?,?,?,?,?)", [aid, c, type, max, date]);
      const enrolled = db.all("SELECT student_id FROM enrollments WHERE course_id = ?", [c]);
      for (const { student_id: sid } of enrolled) {
        const pct = sid === 1
          ? aaravPct[c][ti]
          : clamp(Math.round(courseMean[c - 1] + (rng() * 32 - 15)), 32, 97);
        const marks = clamp(Math.round((pct / 100) * max), 0, max);
        db.run("INSERT INTO assessment_scores (assessment_id,student_id,marks) VALUES (?,?,?)", [aid, sid, marks]);
      }
    });
  }

  /* ---- exams ---- */
  const exams = [
    [1, 1, "End Semester Theory (FAT)", 4, d(-2), "14:00", "17:00", "A-201"],
    [2, 2, "End Semester Theory (FAT)", 4, d(-2), "09:30", "12:30", "A-202"],
    [3, 3, "End Semester Theory (FAT)", 4, d(-2), "14:00", "17:00", "A-203"],
    [4, 4, "End Semester Theory (FAT)", 4, d(-2), "09:30", "12:30", "B-101"],
    [5, 5, "End Semester Theory (FAT)", 4, d(-2), "14:00", "16:00", "B-102"],
    [6, 6, "Lab Practical Examination", 4, d(4), "10:00", "13:00", "DB Lab 2"],
    [7, 7, "Project Review Viva", 4, d(6), "14:00", "16:00", "Seminar Hall"],
    [8, 3, "Supplementary Theory Exam", 4, d(9), "10:00", "13:00", "A-101"],
  ];
  for (const e of exams) db.run("INSERT INTO exams (id,course_id,name,semester,date,start,end,venue) VALUES (?,?,?,?,?,?,?,?)", e);

  /* ---- timetable (day 1=Mon..5=Fri) ---- */
  const tt = [
    [1, 1, 1, "09:00", "10:00", "LH-204"], [2, 2, 1, "10:00", "11:00", "LH-204"], [3, 5, 1, "11:15", "12:15", "LH-103"],
    [4, 3, 2, "09:00", "10:00", "LH-205"], [5, 4, 2, "10:00", "11:00", "LH-205"], [6, 7, 2, "14:00", "15:00", "LH-103"],
    [7, 1, 3, "09:00", "10:00", "LH-204"], [8, 3, 3, "11:15", "12:15", "LH-205"], [9, 5, 3, "14:00", "15:00", "LH-103"],
    [10, 2, 4, "09:00", "10:00", "LH-204"], [11, 4, 4, "10:00", "11:00", "LH-205"], [12, 7, 4, "11:15", "12:15", "LH-103"],
    [13, 6, 5, "09:30", "12:30", "DB Lab 2"], [14, 1, 5, "14:00", "15:00", "LH-204"],
  ];
  for (const t of tt) db.run("INSERT INTO timetable (id,course_id,day,start,end,room) VALUES (?,?,?,?,?,?)", t);

  /* ---- assignments + submissions ---- */
  const asg = [
    [1, 1, "Balanced BST — Implementation & Complexity Analysis", "Implement an AVL tree with insert/delete. Submit the report with rotation diagrams and a complexity table.", d(3), stamp(-6)],
    [2, 2, "ER Modelling — Hospital Management Case Study", "Draw the complete ER diagram (entities, relationships, cardinalities) and convert it to a relational schema in 3NF.", d(1), stamp(-5)],
    [3, 3, "CPU Scheduler Simulation (FCFS / SJF / RR)", "Simulate all three policies on the given process set. Compare average waiting and turnaround times.", d(-2), stamp(-9)],
    [4, 4, "Wireshark — TCP Handshake & Congestion Analysis", "Capture a real TCP session and annotate the handshake, sequence numbers and retransmissions.", d(5), stamp(-4)],
    [5, 7, "Python Mini Project — Grade Analyzer CLI", "Build a small CLI that reads a CSV of marks and prints grades, averages and toppers.", d(6), stamp(-3)],
  ];
  for (const a of asg) db.run("INSERT INTO assignments (id,course_id,title,description,due_date,created_at) VALUES (?,?,?,?,?,?)", a);
  const subs = [
    [2, 2, -2], [2, 4, -2], [2, 6, -1], [3, 2, -4], [3, 4, -3], [3, 5, -3], [3, 8, -2], [4, 1, -1], [4, 3, -1], [1, 4, 0], [5, 6, 0],
  ];
  for (const [a, s, ago] of subs) db.run("INSERT INTO assignment_submissions (assignment_id,student_id,status,submitted_at) VALUES (?,?,'SUBMITTED',?)", [a, s, stamp(ago)]);

  /* ---- fees ---- */
  const fees = [
    [1, 1, 4, "Semester 4 — Tuition & Examination", 45000, 20000, d(12)], // Aarav PARTIAL
    [2, 2, 4, "Semester 4 — Tuition & Examination", 45000, 45000, d(12)],
    [3, 3, 4, "Semester 4 — Tuition & Examination", 45000, 0, d(12)],
    [4, 4, 4, "Semester 4 — Tuition & Examination", 45000, 45000, d(12)],
    [5, 5, 4, "Semester 4 — Tuition & Examination", 45000, 15000, d(12)],
    [6, 6, 4, "Semester 4 — Tuition & Examination", 45000, 45000, d(12)],
    [7, 7, 4, "Semester 4 — Tuition & Examination", 45000, 0, d(12)],
    [8, 8, 4, "Semester 4 — Tuition & Examination", 45000, 30000, d(12)],
  ];
  for (const f of fees) db.run("INSERT INTO fees (id,student_id,semester,description,total,paid,due_date) VALUES (?,?,?,?,?,?,?)", f);

  /* ---- requests ---- */
  const reqs = [
    [1, 1, "LEAVE", "Leave — Inter-College Hackathon (3 days)", "Requesting leave from 24th to 26th to represent the college at SmartHack 2026, Pune.", "PENDING", null, stamp(-1), null],
    [2, 1, "BONAFIDE", "Bonafide certificate for internship application", "Need a bonafide certificate addressed to TCS iON for a summer internship application.", "APPROVED", "Approved. Collect the signed copy from Admin Office, Block A.", stamp(-5), stamp(-3)],
    [3, 3, "ACADEMIC", "Fee payment in two instalments", "Due to financial constraints, I request permission to pay the semester fee in two instalments this term.", "PENDING", null, stamp(-2), null],
    [4, 2, "DOCUMENT", "Official transcript — 2 copies", "Require two sealed official transcripts for a university application abroad.", "COMPLETED", "Transcripts issued. Receipt no. 2214.", stamp(-9), stamp(-7)],
  ];
  for (const r of reqs) db.run("INSERT INTO requests (id,student_id,type,subject,body,status,note,created_at,decided_at) VALUES (?,?,?,?,?,?,?,?,?)", r);

  /* ---- notifications (user ids: admin=1, faculty=2, students=3..10) ---- */
  const notes = [
    [1, 3, "Result published — Data Structures & Algorithms", "You scored 91/100 (A+) in the FAT. Class average: 68%.", "SUCCESS", 0, stamp(-2)],
    [2, 3, "Attendance below threshold — Operating Systems", "Your attendance in CS403 is 65.4%, below the required 75%. Attend the next classes to recover.", "DANGER", 0, stamp(-1)],
    [3, 3, "Fee due reminder", "₹25,000 is pending for Semester 4. Due date is approaching.", "WARNING", 0, stamp(-1)],
    [4, 3, "New assignment — Database Management Systems", "“ER Modelling — Hospital Management Case Study” is due soon.", "INFO", 1, stamp(-5)],
    [5, 4, "Result published — Data Structures & Algorithms", "Your FAT result for CS401 has been published.", "SUCCESS", 0, stamp(-2)],
    [6, 5, "Fee pending — Semester 4", "No payment recorded yet for Semester 4. Total due: ₹45,000.", "WARNING", 0, stamp(-1)],
    [7, 1, "2 student requests awaiting review", "A leave request and a fee-instalment request are pending approval.", "INFO", 0, stamp(-1)],
    [8, 2, "Supplementary exam scheduled — CS403", "A supplementary theory exam for Operating Systems has been scheduled by the admin office.", "INFO", 0, stamp(-1)],
  ];
  for (const n of notes) db.run("INSERT INTO notifications (id,user_id,title,body,kind,read,created_at) VALUES (?,?,?,?,?,?,?)", n);

  /* ---- curricula & feedbacks (synthetic demo content) ---- */
  const U = (no, title, topics) => ({ no, title, topics });
  const curricula = {
    1: { description: "Design and analysis of fundamental data structures and algorithms with complexity reasoning.", prerequisites: ["Programming in C"], objectives: ["Reason about time and space complexity", "Select the right structure for a problem", "Implement classic graph and tree algorithms"], units: [U(1, "Complexity & Linear Structures", ["Asymptotic notation", "Arrays", "Linked lists"]), U(2, "Stacks, Queues & Recursion", ["ADTs", "Applications", "Divide and conquer"]), U(3, "Trees & BSTs", ["Binary trees", "Traversals", "AVL rotations"]), U(4, "Heaps & Hashing", ["Priority queues", "Hash functions", "Collision handling"]), U(5, "Graphs", ["BFS/DFS", "Shortest paths", "MST"])] },
    2: { description: "Relational database theory, modelling, SQL and transaction processing.", prerequisites: ["Programming in C"], objectives: ["Model data with ER diagrams", "Write correct SQL", "Normalize schemas to 3NF"], units: [U(1, "Data Modelling", ["ER model", "Cardinality", "Weak entities"]), U(2, "Relational Model & SQL", ["Relational algebra", "DDL/DML", "Joins & subqueries"]), U(3, "Normalization", ["Functional dependencies", "1NF–BCNF", "Decomposition"]), U(4, "Transactions", ["ACID", "Schedules", "Concurrency control"]), U(5, "Indexing & Storage", ["B+ trees", "Query plans", "File organization"])] },
    3: { description: "Operating system concepts: processes, scheduling, synchronization, memory and storage.", prerequisites: ["Data Structures & Algorithms"], objectives: ["Explain process lifecycle and scheduling", "Solve classic synchronization problems", "Analyse paging and deadlock conditions"], units: [U(1, "Processes & Threads", ["PCB", "Context switching", "IPC"]), U(2, "CPU Scheduling", ["FCFS/SJF/RR", "Priority", "Multilevel queues"]), U(3, "Synchronization", ["Critical sections", "Semaphores", "Monitors"]), U(4, "Deadlocks", ["Conditions", "Banker's algorithm", "Recovery"]), U(5, "Memory Management", ["Paging", "Segmentation", "Virtual memory", "Page replacement"])] },
    4: { description: "Layered network architecture from physical links to application protocols.", prerequisites: ["Probability & Statistics (parallel)"], objectives: ["Map protocols to OSI/TCP-IP layers", "Trace packet flow end to end", "Compute addressing and subnetting"], units: [U(1, "Foundations", ["OSI & TCP/IP", "Encapsulation", "Performance metrics"]), U(2, "Data Link Layer", ["Framing", "Error detection", "MAC & Ethernet"]), U(3, "Network Layer", ["IPv4 addressing", "Subnetting", "Routing basics"]), U(4, "Transport Layer", ["UDP vs TCP", "Flow control", "Congestion control"]), U(5, "Application Layer", ["DNS", "HTTP", "Email protocols"])] },
    5: { description: "Probability theory and statistical inference for engineers.", prerequisites: ["Class XII Mathematics"], objectives: ["Compute probabilities from axioms", "Work with common distributions", "Interpret hypothesis tests"], units: [U(1, "Probability Axioms", ["Sample spaces", "Conditional probability", "Bayes theorem"]), U(2, "Random Variables", ["PMF/PDF", "CDF", "Expectation & variance"]), U(3, "Distributions", ["Binomial", "Poisson", "Normal"]), U(4, "Joint Distributions", ["Independence", "Covariance", "CLT"]), U(5, "Inference", ["Estimation", "Confidence intervals", "Hypothesis testing"])] },
    6: { description: "Hands-on database laboratory aligned with the DBMS theory course.", prerequisites: ["Database Management Systems (parallel)"], objectives: ["Write production-quality SQL", "Design and normalize a schema", "Build a small data-driven application"], units: [U(1, "SQL Fundamentals", ["DDL", "DML", "Constraints"]), U(2, "Advanced Queries", ["Joins", "Aggregation", "Views"]), U(3, "Schema Design Lab", ["ER to tables", "Normalization practice"]), U(4, "Procedural SQL", ["Functions", "Triggers", "Cursors"]), U(5, "Mini Project", ["End-to-end data app", "Indexing & explain plans"])] },
    7: { description: "Python programming applied to data engineering tasks.", prerequisites: [], objectives: ["Write idiomatic Python", "Process structured data files", "Automate small data pipelines"], units: [U(1, "Language Core", ["Syntax", "Collections", "Functions"]), U(2, "Data Handling", ["CSV/JSON", "Comprehensions", "Error handling"]), U(3, "OOP & Modules", ["Classes", "Packages", "Testing basics"]), U(4, "Mini Pipelines", ["ETL script", "Logging", "CLI tools"])] },
  };
  for (const [cid, c] of Object.entries(curricula)) {
    db.run("INSERT OR REPLACE INTO curricula (course_id,description,prerequisites,objectives,units) VALUES (?,?,?,?,?)",
      [Number(cid), c.description, JSON.stringify(c.prerequisites), JSON.stringify(c.objectives), JSON.stringify(c.units)]);
  }
  const feedbacks = [[1, 4.3, 4.2, 41], [2, 4.1, 4.0, 39], [3, 3.7, 3.6, 40], [4, 4.0, 3.9, 37], [5, 3.9, 3.8, 35], [6, 4.4, 4.5, 33], [7, 4.2, 4.3, 30]];
  for (const [cid, cl, co, r] of feedbacks) db.run("INSERT OR REPLACE INTO feedbacks (course_id,avg_clarity,avg_course,responses) VALUES (?,?,?,?)", [cid, cl, co, r]);

  console.log("Seeded: 3 departments, 3 programs, 10 users, 4 faculty, 8 students, 7 courses,");
  console.log(`        ${db.get("SELECT COUNT(*) n FROM attendance").n} attendance records, ${db.get("SELECT COUNT(*) n FROM assessment_scores").n} assessment scores.`);
  console.log("Demo password for every account: demo123");
}

run();
