# CampusCore — Unified Digital Campus (College ERP)

A working college ERP with **one system, one database, three role-based workspaces** (Admin, Faculty, Student).
Every dashboard, badge and insight is computed from the same shared data store — when faculty mark attendance or
publish marks, student dashboards, class averages, grades, risk insights and notifications update immediately.

> **Deployment note:** this hackathon build runs the full backend (database + services + API + auth/RBAC) as an
> in-browser layer persisted to `localStorage`, because the deliverable is a static bundle. The code is organized
> exactly like the planned Express/SQLite modular monolith (`src/server/db.ts` → `src/server/logic.ts` →
> `src/server/api.ts`), so each `api.*` method maps 1:1 to a REST endpoint for a future server migration.

## Demo credentials (password: `demo123`)

| Role    | Email                     | Notes                                    |
|---------|---------------------------|------------------------------------------|
| Admin   | admin@college.edu         | Dr. Anita Deshmukh                       |
| Faculty | faculty@college.edu       | Dr. Kavitha Raman (CS401, CS402, CS405)  |
| Student | aarav@college.edu         | Demo story: strong/weak/improving/declining subjects, 65.4% attendance in OS, partial fees |
| Student | neha@college.edu          |                                          |
| Student | student1@college.edu / student2@college.edu | Rohan Verma / Ishita Rao |

## Features

- **Auth**: token login (12h expiry), logout, invalid-credential and expired-session handling, route guards.
- **RBAC enforced in the API layer** — students can only ever touch their own records (identity derived from the
  token, never from URL params); faculty writes are scoped to assigned courses; admin has full access.
- **Student workspace**: dashboard with Action Center, profile (identity fields protected), courses, attendance
  (risk status, classes needed to recover, safe-to-miss), marks vs class average with trends, results + SGPA,
  timetable, exam schedule, assignments (submit/status), fees, requests, notifications, **Academic Performance**.
- **Faculty workspace**: dashboard (today's classes, pending grading), my courses, scoped student roster,
  attendance marking (bulk present, edit any past date), validated marks entry, assignments, timetable.
- **Admin workspace**: live dashboard aggregates, student CRUD (duplicate reg-no prevention, auto login
  provisioning, auto-enrollment, 360° profile), faculty & course management, attendance overview + marking,
  per-course results, fee records/payments, request state machine, broadcast notifications, settings + demo reset.
- **Event-driven notifications**: attendance below threshold, marks published, fee payments, request decisions,
  assignments posted, exams scheduled, broadcasts.
- Full **loading / empty / error / success** states on every page; toasts for all mutations.

## Centralized business logic (`src/server/logic.ts`)

| Function | Rule |
|---|---|
| `calculateAttendance` | % = present/total×100 (1 dp); SAFE ≥75, WARNING 70–74.9, CRITICAL <70; classes-needed & safe-miss math |
| `calculateGrade` | 90+ A+, 80+ A, 70+ B+, 60+ B, 50+ C, 40+ D, <40 F (configurable scale) |
| `calculateFee` | due = total − paid; PAID / PARTIAL / PENDING |
| `calculateClassAverage` | mean of real student mark percentages |
| `calculateTrend` | last−first ≥ +5 → IMPROVING, ≤ −5 → DECLINING, else STABLE, <2 points → INSUFFICIENT_DATA |
| `buildStudentProfile` | **Academic Profile Service** — structured, deterministic, frontend-independent |
| insights + actions | generated only from objective data (no AI) |

## AI-ready foundation (no AI implemented — by design)

`api.myAcademicProfile()` (≙ `GET /api/academic-profile/me`) returns a structured profile:
`student`, `attendance`, `courses[]` (attendance + performance + assessments), `results`, `fees`, `insights`, `actions`.
A future AI Academic Coach would be: Chat UI → `/api/ai/chat` → AI Service → authenticated student id →
Academic Profile Service → model. The coach will never query the database directly.

## Database tables

`users, departments, faculty, students, courses, enrollments, attendance, assessments, exams, timetable,
assignments, submissions, fees, requests, notifications, activity`

## Run

```bash
npm install
npm run dev      # local development
npm run build    # production bundle (dist/)
```

Reset demo data anytime from **Admin → Settings → Reset demo database**.

## Known limitations (hackathon scope)

- No real file uploads for assignments (status-based), no online fee payment gateway, CGPA awaiting historical
  semesters ("Not enough historical data" shown honestly), attendance edit is per-date roster (no bulk CSV import).
