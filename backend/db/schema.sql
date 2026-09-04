-- CampusCore schema (SQLite dialect; portable types for PostgreSQL migration)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS departments (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL,
  code  TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS programs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  level          TEXT NOT NULL CHECK (level IN ('UNDERGRADUATE','POSTGRADUATE','DIPLOMA')),
  duration_years INTEGER NOT NULL DEFAULT 4,
  department_id  INTEGER REFERENCES departments(id)
);

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash  TEXT NOT NULL,               -- bcrypt
  role       TEXT NOT NULL CHECK (role IN ('ADMIN','FACULTY','STUDENT')),
  student_id INTEGER,
  faculty_id INTEGER
);

CREATE TABLE IF NOT EXISTS faculty (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone         TEXT,
  department_id INTEGER REFERENCES departments(id),
  designation   TEXT
);

CREATE TABLE IF NOT EXISTS students (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER REFERENCES users(id),
  name           TEXT NOT NULL,
  reg_no         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone          TEXT,
  department_id  INTEGER REFERENCES departments(id),
  program_id     INTEGER REFERENCES programs(id),
  program        TEXT NOT NULL DEFAULT 'B.Tech',
  branch         TEXT,
  semester       INTEGER NOT NULL DEFAULT 1,
  section        TEXT,
  batch          TEXT,
  admission_year INTEGER,
  status         TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE'))
);

-- Course assignment to faculty lives on the course row (1 faculty per course
-- in the current model; a faculty_course join table is the migration path if
-- team-teaching is added later).
CREATE TABLE IF NOT EXISTS courses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  faculty_id    INTEGER REFERENCES faculty(id),
  department_id INTEGER REFERENCES departments(id),
  credits       INTEGER NOT NULL DEFAULT 3,
  semester      INTEGER NOT NULL DEFAULT 1,
  type          TEXT NOT NULL DEFAULT 'CORE'
                CHECK (type IN ('CORE','ELECTIVE','FOUNDATION','LAB','PROJECT','OTHER')),
  difficulty    TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (difficulty IN ('EASY','MEDIUM','HARD'))
);

CREATE TABLE IF NOT EXISTS enrollments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  UNIQUE (student_id, course_id)
);

CREATE TABLE IF NOT EXISTS attendance (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,               -- ISO yyyy-mm-dd
  status     TEXT NOT NULL CHECK (status IN ('PRESENT','ABSENT')),
  UNIQUE (course_id, student_id, date)
);

-- assessment = the evaluation slot; assessment_scores holds one row per student.
CREATE TABLE IF NOT EXISTS assessments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('CAT1','CAT2','QUIZ','ASSIGNMENT','LAB','FAT','PROJECT','OTHER')),
  max_marks  INTEGER NOT NULL DEFAULT 50,
  date       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assessment_scores (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  marks         INTEGER NOT NULL CHECK (marks >= 0),
  UNIQUE (assessment_id, student_id)
);

CREATE TABLE IF NOT EXISTS exams (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  semester   INTEGER NOT NULL,
  date       TEXT NOT NULL,
  start      TEXT NOT NULL,
  end        TEXT NOT NULL,
  venue      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS timetable (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  day       INTEGER NOT NULL CHECK (day BETWEEN 1 AND 5),  -- Monday..Friday
  start     TEXT NOT NULL,
  end       TEXT NOT NULL,
  room      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assignments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  due_date    TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assignment_submissions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'SUBMITTED',
  submitted_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (assignment_id, student_id)
);

CREATE TABLE IF NOT EXISTS fees (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  semester    INTEGER NOT NULL,
  description TEXT NOT NULL,
  total       INTEGER NOT NULL CHECK (total >= 0),
  paid        INTEGER NOT NULL DEFAULT 0 CHECK (paid >= 0),
  due_date    TEXT,
  UNIQUE (student_id, semester)
);

CREATE TABLE IF NOT EXISTS requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('LEAVE','ACADEMIC','BONAFIDE','DOCUMENT','GENERAL')),
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'PENDING'
              CHECK (status IN ('PENDING','APPROVED','REJECTED','COMPLETED')),
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at  TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'INFO' CHECK (kind IN ('INFO','SUCCESS','WARNING','DANGER')),
  read       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS curricula (
  course_id     INTEGER PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
  description   TEXT,
  prerequisites TEXT,                     -- JSON array
  objectives    TEXT,                     -- JSON array
  units         TEXT                      -- JSON array of {no,title,topics[]}
);

CREATE TABLE IF NOT EXISTS feedbacks (
  course_id   INTEGER PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
  avg_clarity REAL NOT NULL,
  avg_course  REAL NOT NULL,
  responses   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_config (
  id       INTEGER PRIMARY KEY CHECK (id = 1),
  mode     TEXT NOT NULL DEFAULT 'local',
  api_key  TEXT NOT NULL DEFAULT '',
  model    TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  base_url TEXT NOT NULL DEFAULT 'https://api.openai.com/v1'
);
INSERT OR IGNORE INTO ai_config (id) VALUES (1);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor      TEXT NOT NULL,
  role       TEXT,
  method     TEXT,
  path       TEXT,
  status     INTEGER,
  at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_attendance_course_date ON attendance(course_id, date);
CREATE INDEX IF NOT EXISTS idx_scores_assessment ON assessment_scores(assessment_id);
CREATE INDEX IF NOT EXISTS idx_scores_student ON assessment_scores(student_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);
