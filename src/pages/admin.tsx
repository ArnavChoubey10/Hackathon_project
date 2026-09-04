import { useMemo, useState } from "react";
import { api, ApiError } from "../server/api";
import { ATTENDANCE_THRESHOLD } from "../server/logic";
import type { CourseType, Difficulty, RequestStatus } from "../server/db";
import { fmtDate, inr, timeAgo, useApi, useRouter, useToast } from "../state";
import {
  Badge, BarRow, Button, Card, CardHead, Donut, Empty, ErrorBox, FeeBadge, Field,
  GradeBadge, Icon, Loading, Modal, PageHead, RequestBadge, RiskBadge, SkeletonRows, Stat,
} from "../ui";
import { AttendanceMarker, NoticeList } from "./shared";
import { downloadProjectZip, projectFileCount } from "../download";

export function AdminWorkspace({ page }: { page: string }) {
  switch (page) {
    case "students": return <StudentsPage />;
    case "faculty": return <FacultyAdminPage />;
    case "courses": return <CoursesPage />;
    case "attendance": return <AdminAttendancePage />;
    case "results": return <AdminResultsPage />;
    case "fees": return <FeesAdminPage />;
    case "requests": return <RequestsAdminPage />;
    case "notifications": return <AdminNotificationsPage />;
    case "exams": return <AdminExamsPage />;
    case "timetable": return <AdminTimetablePage />;
    case "departments": return <DepartmentsPage />;
    case "programs": return <ProgramsPage />;
    case "reports": return <ReportsPage />;
    case "settings": return <SettingsPage />;
    default: return <AdminDashboard />;
  }
}

/* ================= dashboard ================= */

function AdminDashboard() {
  const { data, loading, error, reload } = useApi(() => api.adminDashboard(), []);
  const { navigate } = useRouter();
  if (loading) return <Loading label="Aggregating campus data…" />;
  if (error || !data) return <ErrorBox message={error ?? "Unable to load dashboard."} onRetry={reload} />;

  const collectionPct = data.feesTotal ? Math.round((data.feesCollected / data.feesTotal) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHead title="Admin dashboard" sub="Live aggregates — every number is computed from the shared database" />

      <div className="stagger grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Stat label="Total students" value={data.totalStudents} icon="users" tone="pine" hint={`${data.activeStudents} active`} />
        <Stat label="Faculty members" value={data.totalFaculty} icon="cap" tone="ink" />
        <Stat label="Courses running" value={data.totalCourses} icon="book" tone="pine" />
        <Stat label="Avg attendance" value={data.avgAttendance} decimals={1} suffix="%" icon="check" tone={data.avgAttendance >= 75 ? "pine" : "gold"} hint={`${data.below75Count} below ${ATTENDANCE_THRESHOLD}%`} />
      </div>
      <div className="stagger grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Stat label="Fees collected" value={data.feesCollected} icon="wallet" tone="pine" />
        <Stat label="Fees pending" value={data.feesPending} icon="alert" tone={data.feesPending > 0 ? "gold" : "pine"} />
        <Stat label="Pending requests" value={data.pendingRequests} icon="file" tone={data.pendingRequests > 0 ? "gold" : "pine"} />
        <Stat label="Avg marks (all)" value={data.avgMarks} decimals={1} suffix="%" icon="award" tone="ink" />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card pad={false}>
            <div className="p-5 pb-3"><CardHead icon="alert" title={`Students below ${ATTENDANCE_THRESHOLD}% attendance`} sub="Flagged automatically by the attendance engine" right={<Button tone="ghost" size="sm" onClick={() => navigate("/admin/students")}>Manage</Button>} /></div>
            {data.below75.length === 0 ? <Empty icon="check" title="Everyone is above the threshold" sub="No attendance risks right now." /> : (
              <ul className="divide-y divide-[#ecf1ec]">
                {data.below75.map((s) => (
                  <li key={s.id} className="flex items-center gap-4 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-semibold text-ink">{s.name}</p>
                      <p className="num text-[11px] text-faint">{s.regNo}</p>
                    </div>
                    <div className="w-36"><BarRow label="" value={s.percentage} tone={s.risk === "CRITICAL" ? "red" : "gold"} /></div>
                    <RiskBadge risk={s.risk} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card pad={false}>
            <div className="p-5 pb-3"><CardHead icon="chart" title="Attendance by course" /></div>
            <div className="space-y-3.5 px-5 pb-5">
              {data.courseAttendance.map((c) => (
                <BarRow key={c.id} label={`${c.code} · ${c.name}`} value={c.percentage} tone={c.percentage >= 75 ? "pine" : c.percentage >= 70 ? "gold" : "red"} />
              ))}
            </div>
          </Card>

          <Card pad={false}>
            <div className="p-5 pb-3"><CardHead icon="clock" title="Recent activity" sub="Campus-wide event stream" /></div>
            <ul className="space-y-3 px-5 pb-5">
              {data.recentActivity.map((a) => (
                <li key={a.id} className="flex gap-2.5">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-pine-400" />
                  <div>
                    <p className="text-xs leading-snug text-soft">{a.text}</p>
                    <p className="mt-0.5 font-mono text-[9.5px] uppercase tracking-wider text-faint">{a.actor} · {timeAgo(a.at)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-5">
          <Card className="flex flex-col items-center py-6">
            <Donut pct={collectionPct} tone={collectionPct >= 80 ? "pine" : collectionPct >= 50 ? "gold" : "red"} label="fee collected" />
            <p className="mt-3 text-xs text-soft"><span className="num font-semibold text-ink">{inr(data.feesCollected)}</span> of <span className="num font-semibold text-ink">{inr(data.feesTotal)}</span></p>
            <div className="mt-3 flex gap-2">
              <Badge tone="green">{data.feeStatusCounts.PAID} paid</Badge>
              <Badge tone="gold">{data.feeStatusCounts.PARTIAL} partial</Badge>
              <Badge tone="red">{data.feeStatusCounts.PENDING} pending</Badge>
            </div>
          </Card>
          <Card pad={false}>
            <div className="p-5 pb-3"><CardHead icon="file" title="Requests queue" right={<Button tone="ghost" size="sm" onClick={() => navigate("/admin/requests")}>Review</Button>} /></div>
            <div className="px-5 pb-5">
              <p className="font-display text-4xl font-bold text-ink">{data.pendingRequests}</p>
              <p className="mt-1 text-xs text-soft">awaiting approval or rejection</p>
            </div>
          </Card>
          <Card pad={false}>
            <div className="p-5 pb-3"><CardHead icon="spark" title="System status" /></div>
            <ul className="space-y-2.5 px-5 pb-5 text-xs">
              <li className="flex items-center justify-between"><span className="text-soft">Database</span><Badge tone="green">CONNECTED</Badge></li>
              <li className="flex items-center justify-between"><span className="text-soft">Academic Profile API</span><Badge tone="pine">READY</Badge></li>
              <li className="flex items-center justify-between"><span className="text-soft">AI Academic Coach</span><Badge tone="gray">PLANNED</Badge></li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ================= students ================= */

const emptyStudentForm = {
  name: "", regNo: "", email: "", phone: "", departmentId: "D1", program: "B.Tech",
  branch: "Computer Science & Engineering", semester: 4, section: "A", batch: "2023–2027", admissionYear: 2023,
};

function StudentsPage() {
  const [filters, setFilters] = useState({ q: "", departmentId: "", semester: "" as number | "", section: "" });
  const { data: depts } = useApi(() => api.departments(), []);
  const { data, loading, error, reload } = useApi(() => api.students(filters), [filters.q, filters.departmentId, filters.semester, filters.section]);
  const { push } = useToast();
  const [modal, setModal] = useState<"new" | string | null>(null); // "new" or student id being edited
  const [form, setForm] = useState(emptyStudentForm);
  const [autoEnroll, setAutoEnroll] = useState(true);
  const [busy, setBusy] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);

  const openEdit = (s: NonNullable<typeof data>[number]) => {
    setForm({ name: s.name, regNo: s.regNo, email: s.email, phone: s.phone, departmentId: s.departmentId, program: s.program, branch: s.branch, semester: s.semester, section: s.section, batch: s.batch, admissionYear: s.admissionYear });
    setModal(s.id);
  };

  const save = async () => {
    setBusy(true);
    try {
      if (modal === "new") {
        await api.createStudent(form, autoEnroll);
        push("success", `Student ${form.name} created with login ${form.email} (password demo123).`);
      } else if (modal) {
        await api.updateStudent(modal, form);
        push("success", "Student record updated.");
      }
      setModal(null);
      reload();
    } catch (e) {
      push("error", e instanceof ApiError ? e.message : "Could not save student.");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <PageHead title="Student management" sub="Create, search, filter and review — accounts are provisioned automatically"
        right={<Button onClick={() => { setForm(emptyStudentForm); setAutoEnroll(true); setModal("new"); }}><Icon name="plus" size={14} /> New student</Button>} />

      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2.5 border-b border-line p-4">
          <div className="relative min-w-52 flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"><Icon name="search" size={14} /></span>
            <input className="input pl-8" placeholder="Search name, roll no or email…" value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} />
          </div>
          <select className="input w-44" value={filters.departmentId} onChange={(e) => setFilters((f) => ({ ...f, departmentId: e.target.value }))}>
            <option value="">All departments</option>
            {(depts ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select className="input w-32" value={filters.semester} onChange={(e) => setFilters((f) => ({ ...f, semester: e.target.value === "" ? "" : Number(e.target.value) }))}>
            <option value="">All sems</option>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => <option key={s} value={s}>Sem {s}</option>)}
          </select>
          <select className="input w-32" value={filters.section} onChange={(e) => setFilters((f) => ({ ...f, section: e.target.value }))}>
            <option value="">All sections</option>
            <option value="A">Section A</option>
            <option value="B">Section B</option>
          </select>
        </div>

        {loading && <div className="p-4"><Loading label="Loading students…" /></div>}
        {!loading && error && <div className="p-4"><ErrorBox message={error} onRetry={reload} /></div>}
        {!loading && !error && data && (
          data.length === 0 ? <Empty icon="users" title="No students match" sub="Adjust filters or register a new student." /> : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>Roll no</th><th>Name</th><th>Program</th><th>Sem / Sec</th><th>Contact</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
                <tbody>
                  {data.map((s) => (
                    <tr key={s.id}>
                      <td className="num text-faint">{s.regNo}</td>
                      <td>
                        <button onClick={() => setViewId(s.id)} className="font-semibold text-ink hover:text-pine-700 hover:underline">{s.name}</button>
                      </td>
                      <td className="text-soft">{s.program}</td>
                      <td><Badge tone="gray">S{s.semester} · {s.section}</Badge></td>
                      <td className="text-soft">
                        <p className="text-xs">{s.email}</p>
                        <p className="num text-[11px] text-faint">{s.phone}</p>
                      </td>
                      <td>{s.status === "ACTIVE" ? <Badge tone="green">ACTIVE</Badge> : <Badge tone="gray">INACTIVE</Badge>}</td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <button title="View 360° profile" onClick={() => setViewId(s.id)} className="rounded-md p-1.5 text-faint hover:bg-pine-50 hover:text-pine-700"><Icon name="eye" size={15} /></button>
                          <button title="Edit" onClick={() => openEdit(s)} className="rounded-md p-1.5 text-faint hover:bg-pine-50 hover:text-pine-700"><Icon name="edit" size={15} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </Card>

      {/* create / edit modal */}
      <Modal open={modal !== null} onClose={() => setModal(null)} wide
        title={modal === "new" ? "Register new student" : "Edit student"} sub={modal === "new" ? "A login account is created with default password demo123" : "Identity changes are logged to the activity feed"}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name *"><input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
          <Field label="Registration no *"><input className="input num" value={form.regNo} onChange={(e) => setForm((f) => ({ ...f, regNo: e.target.value }))} placeholder="24CSE009" /></Field>
          <Field label="Email (login) *"><input className="input" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} disabled={modal !== "new"} /></Field>
          <Field label="Phone"><input className="input num" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></Field>
          <Field label="Department">
            <select className="input" value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}>
              {(depts ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Program"><input className="input" value={form.program} onChange={(e) => setForm((f) => ({ ...f, program: e.target.value }))} /></Field>
          <Field label="Branch"><input className="input" value={form.branch} onChange={(e) => setForm((f) => ({ ...f, branch: e.target.value }))} /></Field>
          <Field label="Semester">
            <select className="input" value={form.semester} onChange={(e) => setForm((f) => ({ ...f, semester: Number(e.target.value) }))}>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => <option key={s} value={s}>Semester {s}</option>)}
            </select>
          </Field>
          <Field label="Section">
            <select className="input" value={form.section} onChange={(e) => setForm((f) => ({ ...f, section: e.target.value }))}>
              <option value="A">A</option><option value="B">B</option>
            </select>
          </Field>
          <Field label="Batch"><input className="input" value={form.batch} onChange={(e) => setForm((f) => ({ ...f, batch: e.target.value }))} /></Field>
          <Field label="Admission year"><input type="number" className="input num" value={form.admissionYear} onChange={(e) => setForm((f) => ({ ...f, admissionYear: Number(e.target.value) }))} /></Field>
          {modal === "new" && (
            <div className="flex items-end pb-1">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-soft">
                <input type="checkbox" checked={autoEnroll} onChange={(e) => setAutoEnroll(e.target.checked)} className="h-4 w-4 accent-pine-600" />
                Enroll in all semester-{form.semester} courses
              </label>
            </div>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button tone="ghost" onClick={() => setModal(null)}>Cancel</Button>
          <Button onClick={() => void save()} loading={busy} disabled={!form.name.trim() || !form.regNo.trim() || !form.email.trim()}>
            <Icon name="check" size={14} /> {modal === "new" ? "Create student" : "Save changes"}
          </Button>
        </div>
      </Modal>

      {viewId && <Student360 id={viewId} onClose={() => setViewId(null)} />}
    </div>
  );
}

function Student360({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: p, loading, error, reload } = useApi(() => api.studentProfile(id), [id]);
  return (
    <Modal open onClose={onClose} wide title="Student 360° profile" sub="Same Academic Profile Service that powers the student workspace">
      {loading && <Loading label="Building profile from live data…" />}
      {!loading && error && <ErrorBox message={error} onRetry={reload} />}
      {!loading && !error && p && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-pine-900 p-4">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-pine-600 font-display text-sm font-bold text-white">
              {p.student.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-[15px] font-bold text-white">{p.student.name}</p>
              <p className="num text-[11px] text-pine-300">{p.student.regNo} · Sem {p.student.semester} · Section {p.student.section}</p>
            </div>
            <div className="flex gap-2">
              <Badge tone="green">{p.attendance.percentage}% att.</Badge>
              {p.summary.averagePct !== null && <Badge tone="pine">{p.summary.averagePct}% avg</Badge>}
              {p.fees && <FeeBadge status={p.fees.status} />}
            </div>
          </div>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="tbl">
              <thead><tr><th>Course</th><th>Attendance</th><th>Avg</th><th>Class avg</th><th>Trend</th><th>Grade</th></tr></thead>
              <tbody>
                {p.courses.map((c) => (
                  <tr key={c.courseId}>
                    <td><p className="font-medium text-ink">{c.courseCode}</p><p className="text-[11px] text-faint">{c.courseName}</p></td>
                    <td><span className="num font-semibold">{c.attendance.percentage}%</span> {c.attendance.belowThreshold && <RiskBadge risk={c.attendance.risk} />}</td>
                    <td className="num">{c.performance.average !== null ? `${c.performance.average}%` : "—"}</td>
                    <td className="num text-soft">{c.performance.classAverage !== null ? `${c.performance.classAverage}%` : "—"}</td>
                    <td className="text-xs text-soft">{c.performance.trend.replace("_", " ").toLowerCase()}</td>
                    <td>{c.performance.grade ? <GradeBadge grade={c.performance.grade} /> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-faint">Generated insights</p>
            <ul className="space-y-1.5">
              {p.insights.slice(0, 5).map((i, idx) => (
                <li key={idx} className="flex items-start gap-2 text-xs text-soft">
                  <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${i.severity === "HIGH" ? "bg-blush-500" : i.severity === "MEDIUM" ? "bg-gold-500" : i.severity === "GOOD" ? "bg-emerald-500" : "bg-pine-400"}`} />
                  {i.text}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ================= faculty admin ================= */

function FacultyAdminPage() {
  const { data, loading, error, reload } = useApi(() => api.facultyList(), []);
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", departmentId: "D1", designation: "Assistant Professor" });
  const [busy, setBusy] = useState(false);
  const { data: depts } = useApi(() => api.departments(), []);

  const save = async () => {
    setBusy(true);
    try {
      await api.createFaculty(form, true);
      push("success", `Faculty ${form.name} added with login (password demo123).`);
      setOpen(false); setForm({ name: "", email: "", phone: "", departmentId: "D1", designation: "Assistant Professor" });
      reload();
    } catch (e) {
      push("error", e instanceof ApiError ? e.message : "Could not add faculty.");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <PageHead title="Faculty" sub="Teaching staff and their current course load"
        right={<Button onClick={() => setOpen(true)}><Icon name="plus" size={14} /> Add faculty</Button>} />
      <Card pad={false}>
        {loading && <div className="p-4"><Loading label="Loading faculty…" /></div>}
        {!loading && error && <div className="p-4"><ErrorBox message={error} onRetry={reload} /></div>}
        {!loading && !error && data && (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Name</th><th>Department</th><th>Designation</th><th>Courses</th><th>Contact</th></tr></thead>
              <tbody>
                {data.map((f) => (
                  <tr key={f.id}>
                    <td className="font-semibold text-ink">{f.name}</td>
                    <td className="text-soft">{f.department}</td>
                    <td><Badge tone="gray">{f.designation}</Badge></td>
                    <td className="num">{f.courseCount}</td>
                    <td className="text-soft"><p className="text-xs">{f.email}</p><p className="num text-[11px] text-faint">{f.phone}</p></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="Add faculty member" sub="Optionally provisions a login with password demo123">
        <div className="space-y-4">
          <Field label="Full name *"><input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
          <Field label="Email *"><input className="input" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></Field>
          <Field label="Phone"><input className="input" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></Field>
          <Field label="Department">
            <select className="input" value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}>
              {(depts ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Designation">
            <select className="input" value={form.designation} onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))}>
              {["Professor", "Associate Professor", "Assistant Professor"].map((d) => <option key={d}>{d}</option>)}
            </select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button tone="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => void save()} loading={busy} disabled={!form.name.trim() || !form.email.trim()}><Icon name="check" size={14} /> Add faculty</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ================= courses admin ================= */

function CoursesPage() {
  const { data, loading, error, reload } = useApi(() => api.courses(), []);
  const { data: facultyList } = useApi(() => api.facultyList(), []);
  const { data: depts } = useApi(() => api.departments(), []);
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", facultyId: "", departmentId: "D1", credits: 4, semester: 4, type: "CORE" as CourseType, difficulty: "MEDIUM" as Difficulty });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.createCourse({ ...form, facultyId: form.facultyId || facultyList?.[0]?.id || "F1" });
      push("success", `Course ${form.code} created.`);
      setOpen(false); setForm({ code: "", name: "", facultyId: "", departmentId: "D1", credits: 4, semester: 4, type: "CORE", difficulty: "MEDIUM" });
      reload();
    } catch (e) {
      push("error", e instanceof ApiError ? e.message : "Could not create course.");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <PageHead title="Courses" sub="Catalogue with live enrollment, attendance and class averages"
        right={<Button onClick={() => setOpen(true)}><Icon name="plus" size={14} /> New course</Button>} />
      {loading && <Loading label="Loading courses…" />}
      {!loading && error && <ErrorBox message={error} onRetry={reload} />}
      {!loading && !error && data && (
        <div className="stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((c) => (
            <Card key={c.id} className="transition-transform hover:-translate-y-1">
              <div className="flex items-start justify-between">
                <p className="num text-[11px] font-semibold text-pine-600">{c.code}</p>
                <div className="flex gap-1.5"><Badge tone="pine">{c.type}</Badge><Badge tone="gray">{c.difficulty}</Badge></div>
              </div>
              <h3 className="mt-1 font-display text-[15px] font-bold leading-snug text-ink">{c.name}</h3>
              <p className="mt-1 text-xs text-faint">{c.facultyName} · {c.credits} cr · Sem {c.semester} · {c.department}</p>
              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3.5 text-center">
                <div><p className="num text-[16px] font-bold text-ink">{c.enrolled}</p><p className="text-[10px] uppercase tracking-wider text-faint">enrolled</p></div>
                <div><p className="num text-[16px] font-bold text-ink">{c.attendance.percentage}%</p><p className="text-[10px] uppercase tracking-wider text-faint">attendance</p></div>
                <div><p className="num text-[16px] font-bold text-ink">{c.classAverage !== null ? `${c.classAverage}%` : "—"}</p><p className="text-[10px] uppercase tracking-wider text-faint">class avg</p></div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="New course" sub="Difficulty and type are configured here — not generated">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Course code *"><input className="input num" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="CS407" /></Field>
          <Field label="Course name *"><input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
          <Field label="Faculty">
            <select className="input" value={form.facultyId} onChange={(e) => setForm((f) => ({ ...f, facultyId: e.target.value }))}>
              {(facultyList ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </Field>
          <Field label="Department">
            <select className="input" value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}>
              {(depts ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Credits"><input type="number" min={1} max={6} className="input num" value={form.credits} onChange={(e) => setForm((f) => ({ ...f, credits: Number(e.target.value) }))} /></Field>
          <Field label="Semester">
            <select className="input" value={form.semester} onChange={(e) => setForm((f) => ({ ...f, semester: Number(e.target.value) }))}>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => <option key={s} value={s}>Semester {s}</option>)}
            </select>
          </Field>
          <Field label="Course type">
            <select className="input" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as CourseType }))}>
              {["CORE", "ELECTIVE", "FOUNDATION", "LAB", "PROJECT", "OTHER"].map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Difficulty">
            <select className="input" value={form.difficulty} onChange={(e) => setForm((f) => ({ ...f, difficulty: e.target.value as Difficulty }))}>
              {["EASY", "MEDIUM", "HARD"].map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button tone="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => void save()} loading={busy} disabled={!form.code.trim() || !form.name.trim()}><Icon name="check" size={14} /> Create course</Button>
        </div>
      </Modal>
    </div>
  );
}

/* ================= attendance admin ================= */

function AdminAttendancePage() {
  const { data: summary, loading, error, reload } = useApi(() => api.courseAttendanceSummary(), []);
  const { data: courses } = useApi(() => api.courses(), []);
  const [marker, setMarker] = useState(false);
  if (loading) return <Loading label="Computing attendance summaries…" />;
  if (error || !summary) return <ErrorBox message={error ?? "Unable to load attendance."} onRetry={reload} />;
  return (
    <div className="space-y-6">
      <PageHead title="Attendance overview" sub="Course-level health across the campus"
        right={<Button onClick={() => setMarker(true)}><Icon name="check" size={14} /> Mark / edit attendance</Button>} />
      <div className="stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {summary.map((s) => {
          const atRisk = s.perStudent.filter((p) => p.belowThreshold).length;
          const tone = s.overall.risk === "CRITICAL" ? "red" : s.overall.risk === "WARNING" ? "gold" : "pine";
          return (
            <Card key={s.course.id}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="num text-[11px] font-semibold text-pine-600">{s.course.code}</p>
                  <h3 className="font-display text-[14.5px] font-bold text-ink">{s.course.name}</h3>
                </div>
                <RiskBadge risk={s.overall.risk} />
              </div>
              <div className="mt-3"><BarRow label={`${s.enrolled} students`} value={s.overall.percentage} tone={tone} /></div>
              <p className="mt-3 text-xs text-soft">
                {atRisk > 0
                  ? <span className="font-medium text-blush-600">{atRisk} student{atRisk === 1 ? "" : "s"} below {ATTENDANCE_THRESHOLD}%</span>
                  : <span className="text-emerald-700">Everyone above {ATTENDANCE_THRESHOLD}%</span>}
              </p>
              {atRisk > 0 && (
                <ul className="mt-2 space-y-1 border-t border-line pt-2">
                  {s.perStudent.filter((p) => p.belowThreshold).slice(0, 3).map((p) => (
                    <li key={p.studentId} className="flex items-center justify-between text-[11.5px]">
                      <span className="text-soft">{p.name}</span>
                      <span className="num font-semibold text-blush-600">{p.percentage}%</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>
      {marker && courses && (
        <AttendanceMarker courses={courses.map((c) => ({ id: c.id, code: c.code, name: c.name }))} />
      )}
    </div>
  );
}

/* ================= results admin ================= */

function AdminResultsPage() {
  const { data: courses } = useApi(() => api.courses(), []);
  const [courseId, setCourseId] = useState("");
  const active = courseId || "C1";
  const { data, loading, error, reload } = useApi(() => api.courseResults(active), [active]);
  return (
    <div className="space-y-6">
      <PageHead title="Results" sub="FAT outcomes per course — grades assigned by the central grading service" />
      <div className="max-w-sm">
        <select className="input" value={active} onChange={(e) => setCourseId(e.target.value)}>
          {(courses ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
        </select>
      </div>
      <Card pad={false}>
        {loading && <div className="p-4"><Loading label="Loading results…" /></div>}
        {!loading && error && <div className="p-4"><ErrorBox message={error} onRetry={reload} /></div>}
        {!loading && !error && data && (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3.5">
              <Badge tone="pine">{data.course.code}</Badge>
              <span className="text-[13px] font-medium text-soft">{data.course.name}</span>
              <span className="ml-auto flex items-center gap-2 text-xs text-soft">
                Class average <span className="num text-[15px] font-bold text-pine-700">{data.classAverage !== null ? `${data.classAverage}%` : "—"}</span>
                <Badge tone="green">{data.passCount} passed</Badge>
              </span>
            </div>
            {data.rows.length === 0 ? <Empty icon="award" title="No students enrolled" /> : (
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead><tr><th>#</th><th>Roll no</th><th>Student</th><th>Marks</th><th>%</th><th>Grade</th><th>Points</th><th>Status</th></tr></thead>
                  <tbody>
                    {data.rows.map((r, i) => (
                      <tr key={r.studentId}>
                        <td className="num text-faint">{i + 1}</td>
                        <td className="num text-faint">{r.regNo}</td>
                        <td className="font-medium text-ink">{r.name}</td>
                        <td className="num">{r.marks !== null ? `${r.marks}/${r.maxMarks}` : <Badge tone="gold">PENDING</Badge>}</td>
                        <td className="num font-semibold">{r.pct !== null ? `${r.pct}%` : "—"}</td>
                        <td>{r.grade ? <GradeBadge grade={r.grade} /> : "—"}</td>
                        <td className="num">{r.points ?? "—"}</td>
                        <td>{r.passed === null ? <Badge tone="gray">AWAITING</Badge> : r.passed ? <Badge tone="green">PASSED</Badge> : <Badge tone="red">FAILED</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

/* ================= fees admin ================= */

function FeesAdminPage() {
  const { data, loading, error, reload } = useApi(() => api.feesList(), []);
  const { data: students } = useApi(() => api.students(), []);
  const { push } = useToast();
  const [payFor, setPayFor] = useState<NonNullable<typeof data>[number] | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newFee, setNewFee] = useState({ studentId: "", semester: 4, description: "Semester 4 — Tuition & Examination", total: 45000, dueDate: "" });
  const [statusFilter, setStatusFilter] = useState<"" | "PAID" | "PARTIAL" | "PENDING">("");

  const rows = useMemo(() => (data ?? []).filter((f) => !statusFilter || f.status === statusFilter), [data, statusFilter]);
  const totals = useMemo(() => ({
    total: (data ?? []).reduce((s, f) => s + f.total, 0),
    paid: (data ?? []).reduce((s, f) => s + f.paid, 0),
  }), [data]);

  const pay = async () => {
    if (!payFor) return;
    setBusy(true);
    try {
      await api.recordPayment(payFor.id, Number(amount));
      push("success", `Payment of ${inr(Number(amount))} recorded — student notified.`);
      setPayFor(null); setAmount("");
      reload();
    } catch (e) {
      push("error", e instanceof ApiError ? e.message : "Could not record payment.");
    } finally { setBusy(false); }
  };

  const create = async () => {
    setBusy(true);
    try {
      await api.createFee(newFee);
      push("success", "Fee record created — student notified.");
      setCreateOpen(false);
      reload();
    } catch (e) {
      push("error", e instanceof ApiError ? e.message : "Could not create fee record.");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <PageHead title="Fees" sub={`Collected ${inr(totals.paid)} of ${inr(totals.total)} · dues computed as total − paid`}
        right={<Button onClick={() => setCreateOpen(true)}><Icon name="plus" size={14} /> Fee record</Button>} />

      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
          {(["", "PAID", "PARTIAL", "PENDING"] as const).map((s) => (
            <button key={s || "all"} onClick={() => setStatusFilter(s)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${statusFilter === s ? "bg-pine-900 text-white shadow-sm" : "border border-line bg-white text-soft hover:border-pine-300"}`}>
              {s === "" ? "All" : s}
            </button>
          ))}
        </div>
        {loading && <div className="p-4"><Loading label="Loading fee records…" /></div>}
        {!loading && error && <div className="p-4"><ErrorBox message={error} onRetry={reload} /></div>}
        {!loading && !error && (
          rows.length === 0 ? <Empty icon="wallet" title="No fee records" sub="Create a fee record to get started." /> : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>Roll no</th><th>Student</th><th>Sem</th><th>Total</th><th>Paid</th><th>Due</th><th>Due date</th><th>Status</th><th className="text-right">Action</th></tr></thead>
                <tbody>
                  {rows.map((f) => (
                    <tr key={f.id}>
                      <td className="num text-faint">{f.regNo}</td>
                      <td className="font-medium text-ink">{f.studentName}</td>
                      <td className="num">{f.semester}</td>
                      <td className="num">{inr(f.total)}</td>
                      <td className="num text-emerald-700">{inr(f.paid)}</td>
                      <td className={`num font-semibold ${f.due > 0 ? "text-blush-600" : "text-soft"}`}>{inr(f.due)}</td>
                      <td className="num text-soft">{fmtDate(f.dueDate)}</td>
                      <td><FeeBadge status={f.status} /></td>
                      <td className="text-right">
                        {f.due > 0 && <Button size="sm" tone="subtle" onClick={() => { setPayFor(f); setAmount(String(f.due)); }}><Icon name="wallet" size={12} /> Record payment</Button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </Card>

      <Modal open={payFor !== null} onClose={() => setPayFor(null)} title={`Payment — ${payFor?.studentName ?? ""}`} sub={`Balance due: ${inr(payFor?.due ?? 0)}`}>
        <div className="space-y-4">
          <Field label="Amount received (₹)"><input type="number" className="input num" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <div className="flex justify-end gap-2">
            <Button tone="ghost" onClick={() => setPayFor(null)}>Cancel</Button>
            <Button onClick={() => void pay()} loading={busy} disabled={!amount || Number(amount) <= 0}><Icon name="check" size={14} /> Record payment</Button>
          </div>
        </div>
      </Modal>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New fee record" sub="Raises a fee and notifies the student">
        <div className="space-y-4">
          <Field label="Student">
            <select className="input" value={newFee.studentId} onChange={(e) => setNewFee((f) => ({ ...f, studentId: e.target.value }))}>
              <option value="">Select student…</option>
              {(students ?? []).map((s) => <option key={s.id} value={s.id}>{s.regNo} — {s.name}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Semester"><input type="number" className="input num" value={newFee.semester} onChange={(e) => setNewFee((f) => ({ ...f, semester: Number(e.target.value) }))} /></Field>
            <Field label="Total (₹)"><input type="number" className="input num" value={newFee.total} onChange={(e) => setNewFee((f) => ({ ...f, total: Number(e.target.value) }))} /></Field>
          </div>
          <Field label="Description"><input className="input" value={newFee.description} onChange={(e) => setNewFee((f) => ({ ...f, description: e.target.value }))} /></Field>
          <Field label="Due date"><input type="date" className="input" value={newFee.dueDate} onChange={(e) => setNewFee((f) => ({ ...f, dueDate: e.target.value }))} /></Field>
          <div className="flex justify-end gap-2">
            <Button tone="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => void create()} loading={busy} disabled={!newFee.studentId || newFee.total <= 0 || !newFee.dueDate}><Icon name="check" size={14} /> Create record</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ================= requests admin ================= */

function RequestsAdminPage() {
  const { data, loading, error, reload } = useApi(() => api.requestsList(), []);
  const { push } = useToast();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const decide = async (id: string, status: RequestStatus) => {
    setBusy(true);
    try {
      await api.setRequestStatus(id, status, note.trim() || undefined);
      push("success", `Request ${status.toLowerCase()} — student notified automatically.`);
      setNote("");
      reload();
    } catch (e) {
      push("error", e instanceof ApiError ? e.message : "Could not update request.");
    } finally { setBusy(false); }
  };

  if (loading) return <Loading label="Loading requests…" />;
  if (error || !data) return <ErrorBox message={error ?? "Unable to load requests."} onRetry={reload} />;

  return (
    <div className="space-y-6">
      <PageHead title="Student requests" sub="State machine: PENDING → APPROVED / REJECTED → COMPLETED" />
      {data.length === 0 ? <Card><Empty icon="file" title="No requests" sub="Student requests will appear here." /></Card> : (
        <div className="space-y-4">
          {data.map((r) => (
            <Card key={r.id} className="anim-rise">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="gray">{r.type}</Badge>
                    <RequestBadge status={r.status} />
                    <span className="font-mono text-[10px] uppercase tracking-wider text-faint">{timeAgo(r.createdAt)}</span>
                  </div>
                  <h3 className="mt-2 font-display text-[14.5px] font-bold text-ink">{r.subject}</h3>
                  <p className="mt-0.5 text-xs text-faint">{r.studentName} · <span className="num">{r.regNo}</span></p>
                  <p className="mt-2 text-[13px] leading-relaxed text-soft">{r.body}</p>
                  {r.note && <p className="mt-2 rounded-lg bg-pine-50 px-3 py-2 text-xs text-pine-800"><span className="font-semibold">Note:</span> {r.note}</p>}
                </div>
                <div className="w-full max-w-60 space-y-2">
                  {r.status === "PENDING" && (
                    <>
                      <input className="input" placeholder="Optional note to student…" value={note} onChange={(e) => setNote(e.target.value)} />
                      <div className="flex gap-2">
                        <Button size="sm" className="flex-1" loading={busy} onClick={() => void decide(r.id, "APPROVED")}><Icon name="check" size={12} /> Approve</Button>
                        <Button size="sm" tone="dangerGhost" className="flex-1" loading={busy} onClick={() => void decide(r.id, "REJECTED")}><Icon name="x" size={12} /> Reject</Button>
                      </div>
                    </>
                  )}
                  {r.status === "APPROVED" && (
                    <Button size="sm" tone="subtle" className="w-full" loading={busy} onClick={() => void decide(r.id, "COMPLETED")}><Icon name="check" size={12} /> Mark completed</Button>
                  )}
                  {(r.status === "REJECTED" || r.status === "COMPLETED") && (
                    <p className="text-center font-mono text-[10px] uppercase tracking-widest text-faint">closed {r.decidedAt ? timeAgo(r.decidedAt) : ""}</p>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ================= notifications admin ================= */

function AdminNotificationsPage() {
  const { data, loading, error, reload } = useApi(() => api.myNotifications(), []);
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", body: "", audience: "STUDENTS" as "STUDENTS" | "FACULTY" | "ALL" });
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    try {
      const res = await api.broadcast(form);
      push("success", `Notice sent to ${res.sent} user${res.sent === 1 ? "" : "s"}.`);
      setOpen(false); setForm({ title: "", body: "", audience: "STUDENTS" });
      reload();
    } catch (e) {
      push("error", e instanceof ApiError ? e.message : "Could not broadcast.");
    } finally { setBusy(false); }
  };

  if (loading) return <Loading label="Loading notifications…" />;
  if (error || !data) return <ErrorBox message={error ?? "Unable to load notifications."} onRetry={reload} />;

  return (
    <div className="space-y-6">
      <PageHead title="Notifications" sub="System-generated notices land here too — attendance alerts, payments, results"
        right={<Button onClick={() => setOpen(true)}><Icon name="send" size={14} /> Broadcast notice</Button>} />
      <NoticeList items={data} timeAgo={timeAgo} emptySub="Broadcasts and system events appear here."
        onRead={(id) => void api.markRead(id).then(reload)}
        onReadAll={() => void api.markAllRead().then(reload)} />
      <Modal open={open} onClose={() => setOpen(false)} title="Broadcast notice" sub="Delivered to notification centers instantly">
        <div className="space-y-4">
          <Field label="Audience">
            <select className="input" value={form.audience} onChange={(e) => setForm((f) => ({ ...f, audience: e.target.value as typeof f.audience }))}>
              <option value="STUDENTS">All students</option>
              <option value="FACULTY">All faculty</option>
              <option value="ALL">Everyone</option>
            </select>
          </Field>
          <Field label="Title"><input className="input" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Campus closed on Friday" /></Field>
          <Field label="Message"><textarea className="input min-h-24" value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} /></Field>
          <div className="flex justify-end gap-2">
            <Button tone="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => void send()} loading={busy} disabled={!form.title.trim() || !form.body.trim()}><Icon name="send" size={13} /> Send</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ================= exams & timetable management ================= */

function AdminExamsPage() {
  const { data, loading, error, reload } = useApi(() => api.exams(), []);
  const { data: courses } = useApi(() => api.courses(), []);
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ courseId: "", name: "", semester: 4, date: "", start: "10:00", end: "13:00", venue: "" });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.saveExam(form);
      push("success", "Exam scheduled — enrolled students were notified.");
      setOpen(false); setForm({ courseId: "", name: "", semester: 4, date: "", start: "10:00", end: "13:00", venue: "" });
      reload();
    } catch (e) {
      push("error", e instanceof ApiError ? e.message : "Could not schedule exam.");
    } finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    try { await api.deleteExam(id); push("success", "Exam removed."); reload(); }
    catch { push("error", "Could not remove exam."); }
  };

  return (
    <div className="space-y-6">
      <PageHead title="Exam schedule" sub="Schedule exams — enrolled students see them instantly"
        right={<Button onClick={() => { setForm((f) => ({ ...f, courseId: courses?.[0]?.id ?? "" })); setOpen(true); }}><Icon name="plus" size={14} /> Schedule exam</Button>} />
      <Card pad={false}>
        {loading && <div className="p-4"><Loading label="Loading exams…" /></div>}
        {!loading && error && <div className="p-4"><ErrorBox message={error} onRetry={reload} /></div>}
        {!loading && !error && data && (
          data.length === 0 ? <Empty icon="clock" title="No exams scheduled" /> : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>Date</th><th>Exam</th><th>Course</th><th>Time</th><th>Venue</th><th>Sem</th><th className="text-right">Remove</th></tr></thead>
                <tbody>
                  {data.map((e) => (
                    <tr key={e.id}>
                      <td className="num font-semibold text-ink">{fmtDate(e.date)}</td>
                      <td className="font-medium text-ink">{e.name}</td>
                      <td><Badge tone="pine">{e.courseCode}</Badge> <span className="text-xs text-faint">{e.courseName}</span></td>
                      <td className="num text-soft">{e.start}–{e.end}</td>
                      <td className="text-soft">{e.venue}</td>
                      <td className="num">{e.semester}</td>
                      <td className="text-right">
                        <button onClick={() => void remove(e.id)} className="rounded-md p-1.5 text-faint hover:bg-blush-50 hover:text-blush-600" aria-label="Remove exam"><Icon name="trash" size={15} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="Schedule exam" sub="Notifies every enrolled student">
        <div className="space-y-4">
          <Field label="Course">
            <select className="input" value={form.courseId} onChange={(e) => setForm((f) => ({ ...f, courseId: e.target.value }))}>
              {(courses ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
          </Field>
          <Field label="Exam name"><input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. CAT 2 Theory" /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Date"><input type="date" className="input" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} /></Field>
            <Field label="Start"><input type="time" className="input" value={form.start} onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))} /></Field>
            <Field label="End"><input type="time" className="input" value={form.end} onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Venue"><input className="input" value={form.venue} onChange={(e) => setForm((f) => ({ ...f, venue: e.target.value }))} placeholder="A-201" /></Field>
            <Field label="Semester"><input type="number" className="input num" value={form.semester} onChange={(e) => setForm((f) => ({ ...f, semester: Number(e.target.value) }))} /></Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button tone="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => void save()} loading={busy} disabled={!form.courseId || !form.name.trim() || !form.date || !form.venue.trim()}><Icon name="check" size={14} /> Schedule</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function AdminTimetablePage() {
  const { data, loading, error, reload } = useApi(() => api.timetable(), []);
  const { data: courses } = useApi(() => api.courses(), []);
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ courseId: "", day: 1, start: "09:00", end: "10:00", room: "" });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.saveTimetableSlot(form);
      push("success", "Timetable slot added.");
      setOpen(false); setForm({ courseId: "", day: 1, start: "09:00", end: "10:00", room: "" });
      reload();
    } catch (e) {
      push("error", e instanceof ApiError ? e.message : "Could not add slot.");
    } finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    try { await api.deleteTimetableSlot(id); push("success", "Slot removed."); reload(); }
    catch { push("error", "Could not remove slot."); }
  };

  const dayName = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

  return (
    <div className="space-y-6">
      <PageHead title="Timetable" sub="Master schedule — students and faculty see filtered views automatically"
        right={<Button onClick={() => { setForm((f) => ({ ...f, courseId: courses?.[0]?.id ?? "" })); setOpen(true); }}><Icon name="plus" size={14} /> Add slot</Button>} />
      <Card pad={false}>
        {loading && <div className="p-4"><Loading label="Loading timetable…" /></div>}
        {!loading && error && <div className="p-4"><ErrorBox message={error} onRetry={reload} /></div>}
        {!loading && !error && data && (
          data.length === 0 ? <Empty icon="calendar" title="No slots scheduled" /> : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>Day</th><th>Time</th><th>Course</th><th>Faculty</th><th>Room</th><th className="text-right">Remove</th></tr></thead>
                <tbody>
                  {data.map((s) => (
                    <tr key={s.id}>
                      <td className="font-medium text-ink">{dayName[s.day]}</td>
                      <td className="num text-soft">{s.start}–{s.end}</td>
                      <td><Badge tone="pine">{s.courseCode}</Badge> <span className="text-xs text-faint">{s.courseName}</span></td>
                      <td className="text-soft">{s.facultyName}</td>
                      <td className="text-soft">{s.room}</td>
                      <td className="text-right">
                        <button onClick={() => void remove(s.id)} className="rounded-md p-1.5 text-faint hover:bg-blush-50 hover:text-blush-600" aria-label="Remove slot"><Icon name="trash" size={15} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="Add timetable slot">
        <div className="space-y-4">
          <Field label="Course">
            <select className="input" value={form.courseId} onChange={(e) => setForm((f) => ({ ...f, courseId: e.target.value }))}>
              {(courses ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
          </Field>
          <Field label="Day">
            <select className="input" value={form.day} onChange={(e) => setForm((f) => ({ ...f, day: Number(e.target.value) }))}>
              {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{dayName[d]}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start"><input type="time" className="input" value={form.start} onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))} /></Field>
            <Field label="End"><input type="time" className="input" value={form.end} onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))} /></Field>
          </div>
          <Field label="Room"><input className="input" value={form.room} onChange={(e) => setForm((f) => ({ ...f, room: e.target.value }))} placeholder="LH-204" /></Field>
          <div className="flex justify-end gap-2">
            <Button tone="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => void save()} loading={busy} disabled={!form.courseId || !form.room.trim()}><Icon name="check" size={14} /> Add slot</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ================= settings ================= */

function SettingsPage() {
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const [zipping, setZipping] = useState(false);
  const exportSource = async () => {
    setZipping(true);
    try {
      const n = await downloadProjectZip();
      push("success", `campuscore-erp.zip ready — ${n} files. Unzip it, then: npm install → npm run dev.`);
    } catch {
      push("error", "Could not build the zip file. Please try again.");
    } finally {
      setZipping(false);
    }
  };
  const reset = async () => {
    setBusy(true);
    try {
      await api.resetDemo();
      push("success", "Demo database restored to its seeded state.");
      setTimeout(() => window.location.reload(), 600);
    } catch {
      push("error", "Could not reset the database.");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <PageHead title="Settings" sub="Academic rules and demo controls" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHead icon="target" title="Academic rules" sub="Single source for every calculation in the system" />
          <ul className="space-y-2.5 text-[13px]">
            <li className="flex justify-between border-b border-[#ecf1ec] pb-2"><span className="text-soft">Attendance threshold</span><Badge tone="pine">75%</Badge></li>
            <li className="flex justify-between border-b border-[#ecf1ec] pb-2"><span className="text-soft">Critical below</span><Badge tone="red">70%</Badge></li>
            <li className="flex justify-between border-b border-[#ecf1ec] pb-2"><span className="text-soft">Passing mark</span><Badge tone="green">40%</Badge></li>
            <li className="flex justify-between"><span className="text-soft">Trend rule</span><Badge tone="gray">±5% first→last</Badge></li>
          </ul>
          <p className="mt-4 rounded-lg bg-paper px-3 py-2.5 text-[11px] leading-relaxed text-faint">
            Grading: 90+ A+ · 80+ A · 70+ B+ · 60+ B · 50+ C · 40+ D · &lt;40 F — computed by the backend on every save.
          </p>
        </Card>
        <Card>
          <CardHead icon="refresh" title="Demo data" sub="Restore the original seeded campus" />
          <p className="text-[13px] leading-relaxed text-soft">
            All changes you made (students, attendance, marks, fees, requests) are stored in the browser database.
            Resetting restores the original 8 students, 7 courses and full assessment history.
          </p>
          <Button tone="dangerGhost" className="mt-4" onClick={() => void reset()} loading={busy}>
            <Icon name="refresh" size={14} /> Reset demo database
          </Button>
        </Card>
        <Card>
          <CardHead icon="download" title="Project source" sub="Everything needed to run CampusCore on your machine" />
          <p className="text-[13px] leading-relaxed text-soft">
            Downloads the complete project as <span className="num rounded bg-paper px-1.5 py-0.5 text-[11.5px] font-semibold text-ink">campuscore-erp.zip</span> —
            {" "}{projectFileCount()} source files, config, and docs. Unzip it, run <span className="num rounded bg-paper px-1.5 py-0.5 text-[11.5px] font-semibold text-ink">npm install</span>,
            then <span className="num rounded bg-paper px-1.5 py-0.5 text-[11.5px] font-semibold text-ink">npm run dev</span>.
          </p>
          <Button className="mt-4" onClick={() => void exportSource()} loading={zipping}>
            <Icon name="download" size={14} /> Download project (.zip)
          </Button>
        </Card>
      </div>
    </div>
  );
}

/* ================= departments ================= */

function DepartmentsPage() {
  const { push } = useToast();
  const { data, loading, error, reload } = useApi(() => api.departments(), []);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      await api.createDepartment({ name, code });
      push("success", `Department ${code.toUpperCase()} created.`);
      setName(""); setCode("");
      reload();
    } catch (e) {
      push("error", e instanceof ApiError ? e.message : "Could not create department.");
    } finally { setBusy(false); }
  };

  const remove = async (id: string, deptName: string) => {
    try {
      await api.deleteDepartment(id);
      push("success", `Department ${deptName} deleted.`);
      reload();
    } catch (e) {
      push("error", e instanceof ApiError ? e.message : "Could not delete department.");
    }
  };

  return (
    <div className="space-y-6">
      <PageHead title="Departments" sub="Academic departments referenced by students, faculty and courses" />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card pad={false} className="lg:col-span-2">
          {loading ? <div className="p-4"><SkeletonRows rows={4} /></div>
            : error ? <div className="p-4"><ErrorBox message={error} onRetry={reload} /></div>
              : !data || data.length === 0 ? <Empty icon="db" title="No departments yet" sub="Create the first department on the right." />
                : (
                  <table className="tbl">
                    <thead><tr><th>Code</th><th>Department</th><th className="text-right">Action</th></tr></thead>
                    <tbody>
                      {data.map((d) => (
                        <tr key={d.id}>
                          <td><Badge tone="pine">{d.code}</Badge></td>
                          <td className="font-medium text-ink">{d.name}</td>
                          <td className="text-right">
                            <Button tone="ghost" size="sm" onClick={() => void remove(d.id, d.name)}><Icon name="trash" size={12} /> Delete</Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
        </Card>
        <Card>
          <CardHead icon="db" title="Add department" sub="Code must be unique" />
          <div className="space-y-3">
            <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Computer Science & Engineering" /></Field>
            <Field label="Code"><input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="CSE" maxLength={6} /></Field>
            <Button onClick={() => void create()} loading={busy} disabled={!name.trim() || !code.trim()} className="w-full">
              <Icon name="check" size={14} /> Create department
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ================= programs ================= */

function ProgramsPage() {
  const { push } = useToast();
  const { data, loading, error, reload } = useApi(() => api.programs(), []);
  const { data: departments } = useApi(() => api.departments(), []);
  const [name, setName] = useState("");
  const [level, setLevel] = useState<"UNDERGRADUATE" | "POSTGRADUATE" | "DIPLOMA">("UNDERGRADUATE");
  const [years, setYears] = useState(4);
  const [departmentId, setDepartmentId] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      await api.createProgram({ name, level, durationYears: years, departmentId: departmentId || null });
      push("success", `Program ${name} created.`);
      setName("");
      reload();
    } catch (e) {
      push("error", e instanceof ApiError ? e.message : "Could not create program.");
    } finally { setBusy(false); }
  };

  const remove = async (id: string, progName: string) => {
    try {
      await api.deleteProgram(id);
      push("success", `Program ${progName} deleted.`);
      reload();
    } catch (e) {
      push("error", e instanceof ApiError ? e.message : "Could not delete program.");
    }
  };

  const levelLabel: Record<string, string> = { UNDERGRADUATE: "Undergraduate", POSTGRADUATE: "Postgraduate", DIPLOMA: "Diploma" };

  return (
    <div className="space-y-6">
      <PageHead title="Programs" sub="Degree programs offered by the institution" />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card pad={false} className="lg:col-span-2">
          {loading ? <div className="p-4"><SkeletonRows rows={4} /></div>
            : error ? <div className="p-4"><ErrorBox message={error} onRetry={reload} /></div>
              : !data || data.length === 0 ? <Empty icon="cap" title="No programs yet" sub="Create the first program on the right." />
                : (
                  <table className="tbl">
                    <thead><tr><th>Program</th><th>Level</th><th>Duration</th><th>Department</th><th className="text-right">Action</th></tr></thead>
                    <tbody>
                      {data.map((p) => (
                        <tr key={p.id}>
                          <td className="font-medium text-ink">{p.name}</td>
                          <td><Badge tone="gray">{levelLabel[p.level] ?? p.level}</Badge></td>
                          <td className="num">{p.durationYears} years</td>
                          <td className="text-soft">{departments?.find((d) => d.id === p.departmentId)?.code ?? "—"}</td>
                          <td className="text-right">
                            <Button tone="ghost" size="sm" onClick={() => void remove(p.id, p.name)}><Icon name="trash" size={12} /> Delete</Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
        </Card>
        <Card>
          <CardHead icon="cap" title="Add program" sub="Degree or diploma track" />
          <div className="space-y-3">
            <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="B.Tech" /></Field>
            <Field label="Level">
              <select className="input" value={level} onChange={(e) => setLevel(e.target.value as typeof level)}>
                <option value="UNDERGRADUATE">Undergraduate</option>
                <option value="POSTGRADUATE">Postgraduate</option>
                <option value="DIPLOMA">Diploma</option>
              </select>
            </Field>
            <Field label="Duration (years)"><input type="number" min={1} max={6} className="input num" value={years} onChange={(e) => setYears(Number(e.target.value))} /></Field>
            <Field label="Department (optional)">
              <select className="input" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                <option value="">— None —</option>
                {(departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.code} — {d.name}</option>)}
              </select>
            </Field>
            <Button onClick={() => void create()} loading={busy} disabled={!name.trim()} className="w-full">
              <Icon name="check" size={14} /> Create program
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ================= reports ================= */

function ReportsPage() {
  const { data, loading, error, reload } = useApi(() => api.adminDashboard(), []);

  return (
    <div className="space-y-6">
      <PageHead title="Reports" sub="Institution-wide academic and financial position — computed from live records" />
      {loading && <Loading label="Compiling reports…" />}
      {!loading && error && <ErrorBox message={error} onRetry={reload} />}
      {!loading && !error && data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 stagger">
            <Stat label="Institution attendance" value={data.avgAttendance} suffix="%" icon="check" hint={`${data.below75Count} students below ${ATTENDANCE_THRESHOLD}%`} />
            <Stat label="Average marks" value={data.avgMarks} suffix="%" icon="award" hint="All assessments, all courses" />
            <Stat label="Pending requests" value={data.pendingRequests} icon="file" hint="Awaiting admin review" />
            <div className="card flex items-center gap-3.5 p-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-pine-50 text-pine-600"><Icon name="wallet" size={19} /></span>
              <span className="min-w-0">
                <span className="block font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint">Fees collected</span>
                <span className="num block font-display text-[19px] font-bold leading-tight text-ink">{inr(data.feesCollected)}</span>
                <span className="block truncate text-[10.5px] text-soft">{Math.round((data.feesCollected / Math.max(1, data.feesTotal)) * 100)}% of {inr(data.feesTotal)}</span>
              </span>
            </div>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card pad={false}>
              <CardHead icon="chart" title="Attendance by course" sub="Live from the attendance register" />
              <div className="space-y-3 p-5 pt-1">
                {data.courseAttendance.map((c: { id: string; code: string; name: string; percentage: number; risk: string }) => (
                  <BarRow key={c.id} label={`${c.code} — ${c.name}`} value={c.percentage} tone={c.risk === "CRITICAL" ? "red" : c.risk === "WARNING" ? "gold" : "pine"} />
                ))}
              </div>
            </Card>
            <Card pad={false}>
              <CardHead icon="users" title="Students below attendance threshold" sub={`Required: ${ATTENDANCE_THRESHOLD}%`} />
              {data.below75.length === 0
                ? <Empty icon="check" title="No students below threshold" sub="Everyone currently meets the attendance requirement." />
                : (
                  <table className="tbl">
                    <thead><tr><th>Roll no</th><th>Student</th><th>Attendance</th><th>Risk</th></tr></thead>
                    <tbody>
                      {data.below75.map((s: { id: string; regNo: string; name: string; percentage: number; risk: "SAFE" | "WARNING" | "CRITICAL" }) => (
                        <tr key={s.id}>
                          <td className="num text-faint">{s.regNo}</td>
                          <td className="font-medium text-ink">{s.name}</td>
                          <td className="num font-semibold">{s.percentage}%</td>
                          <td><RiskBadge risk={s.risk} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </Card>
          </div>
          <Card pad={false}>
            <CardHead icon="wallet" title="Fee collection summary" sub="Current semester" />
            <div className="grid gap-4 p-5 pt-1 sm:grid-cols-3">
              <div className="rounded-lg border border-line bg-paper p-4">
                <p className="font-mono text-[10px] uppercase tracking-widest text-faint">Collected</p>
                <p className="num mt-1 font-display text-2xl font-bold text-emerald-700">{inr(data.feesCollected)}</p>
                <p className="mt-1 text-[11px] text-soft">{data.feeStatusCounts.PAID} records fully paid</p>
              </div>
              <div className="rounded-lg border border-line bg-paper p-4">
                <p className="font-mono text-[10px] uppercase tracking-widest text-faint">Outstanding</p>
                <p className="num mt-1 font-display text-2xl font-bold text-gold-600">{inr(data.feesPending)}</p>
                <p className="mt-1 text-[11px] text-soft">{data.feeStatusCounts.PARTIAL} partial · {data.feeStatusCounts.PENDING} pending</p>
              </div>
              <div className="rounded-lg border border-line bg-paper p-4">
                <p className="font-mono text-[10px] uppercase tracking-widest text-faint">Assessed total</p>
                <p className="num mt-1 font-display text-2xl font-bold text-pine-700">{inr(data.feesTotal)}</p>
                <p className="mt-1 text-[11px] text-soft">Across {data.totalStudents} students</p>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
