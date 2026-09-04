import { useState } from "react";
import { api, ApiError } from "../server/api";
import { fmtDate, timeAgo, useApi, useRouter, useToast } from "../state";
import {
  Badge, Button, Card, CardHead, Donut, Empty, ErrorBox, Field,
  Icon, Loading, Modal, PageHead, RiskBadge, Stat,
} from "../ui";
import { AttendanceMarker, MarksEntry, NoticeList, TimetableGrid } from "./shared";

export function FacultyWorkspace({ page }: { page: string }) {
  switch (page) {
    case "courses": return <MyCoursesPage />;
    case "students": return <FacultyStudentsPage />;
    case "attendance": return <FacultyAttendancePage />;
    case "marks": return <FacultyMarksPage />;
    case "assignments": return <FacultyAssignmentsPage />;
    case "timetable": return <FacultyTimetablePage />;
    case "notifications": return <FacultyNotificationsPage />;
    default: return <FacultyDashboard />;
  }
}

/* ================= dashboard ================= */

function FacultyDashboard() {
  const { data, loading, error, reload } = useApi(() => api.facultyDashboard(), []);
  const { navigate } = useRouter();
  if (loading) return <Loading label="Loading faculty dashboard…" />;
  if (error || !data) return <ErrorBox message={error ?? "Unable to load dashboard."} onRetry={reload} />;

  const todayLabel = new Date().toLocaleDateString("en-IN", { weekday: "long" });
  const avgTone = data.avgAttendance >= 75 ? "pine" : data.avgAttendance >= 70 ? "gold" : "red";

  return (
    <div className="space-y-6">
      <PageHead title="Faculty dashboard" sub={`${data.courses.length} assigned courses · ${data.totalStudents} unique students · ${todayLabel}`}
        right={
          <>
            <Button tone="ghost" size="sm" onClick={() => navigate("/faculty/students")}><Icon name="users" size={13} /> View students</Button>
            <Button size="sm" onClick={() => navigate("/faculty/attendance")}><Icon name="check" size={13} /> Mark attendance</Button>
            <Button tone="dark" size="sm" onClick={() => navigate("/faculty/marks")}><Icon name="edit" size={13} /> Enter marks</Button>
          </>
        } />

      <div className="stagger grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Stat label="Assigned courses" value={data.courses.length} icon="book" tone="ink" />
        <Stat label="Students taught" value={data.totalStudents} icon="users" tone="pine" />
        <Stat label="Avg attendance" value={data.avgAttendance} decimals={1} suffix="%" icon="check" tone={avgTone} hint={`${data.attendanceTotal} records`} />
        <Stat label="Pending FAT grading" value={data.pendingGrading} icon="award" tone={data.pendingGrading > 0 ? "gold" : "pine"} hint="theory courses" />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card pad={false}>
            <div className="p-5 pb-3"><CardHead icon="book" title="My courses" sub="Attendance and class average recalculate on every save" right={<Button tone="ghost" size="sm" onClick={() => navigate("/faculty/courses")}>Details</Button>} /></div>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>Course</th><th>Enrolled</th><th>Attendance</th><th>Class avg</th><th></th></tr></thead>
                <tbody>
                  {data.courses.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <p className="font-semibold text-ink">{c.code}</p>
                        <p className="text-[11px] text-faint">{c.name}</p>
                      </td>
                      <td className="num">{c.enrolled}</td>
                      <td>
                        <span className="flex items-center gap-2">
                          <span className="num font-semibold">{c.attendance.percentage}%</span>
                          <RiskBadge risk={c.attendance.risk} />
                        </span>
                      </td>
                      <td className="num">{c.classAverage !== null ? `${c.classAverage}%` : "—"}</td>
                      <td className="text-right">
                        <button onClick={() => navigate("/faculty/marks")} className="rounded-md p-1.5 text-faint hover:bg-pine-50 hover:text-pine-700" aria-label="Enter marks">
                          <Icon name="arrowRight" size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card pad={false}>
            <div className="p-5 pb-3"><CardHead icon="calendar" title={`Today's classes — ${todayLabel}`} /></div>
            {data.todayClasses.length === 0 ? (
              <Empty icon="calendar" title="No classes today" sub="Enjoy the break — or get ahead on grading." />
            ) : (
              <ul className="divide-y divide-[#ecf1ec]">
                {data.todayClasses.sort((a: { start: string }, b: { start: string }) => a.start.localeCompare(b.start)).map((t: { id: string; start: string; end: string; room: string; course: { code: string; name: string } }) => (
                  <li key={t.id} className="flex items-center gap-4 px-5 py-3.5">
                    <span className="num w-24 text-[13px] font-bold text-pine-700">{t.start}–{t.end}</span>
                    <div className="flex-1">
                      <p className="text-[13.5px] font-semibold text-ink">{t.course.code} · {t.course.name}</p>
                    </div>
                    <Badge tone="gray">{t.room}</Badge>
                    <Button size="sm" tone="subtle" onClick={() => navigate("/faculty/attendance")}><Icon name="check" size={12} /> Take attendance</Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card className="flex flex-col items-center py-6">
            <Donut pct={data.avgAttendance} tone={avgTone === "pine" ? "pine" : avgTone === "gold" ? "gold" : "red"} label="attendance" />
            <p className="mt-3 text-xs text-soft">across all assigned courses</p>
          </Card>
          <Card pad={false}>
            <div className="p-5 pb-3"><CardHead icon="clock" title="Recent activity" sub="Shared campus event log" /></div>
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
      </div>
    </div>
  );
}

/* ================= my courses ================= */

function MyCoursesPage() {
  const { data, loading, error, reload } = useApi(() => api.myTeachingCourses(), []);
  if (loading) return <Loading label="Loading your courses…" />;
  if (error || !data) return <ErrorBox message={error ?? "Unable to load courses."} onRetry={reload} />;
  return (
    <div className="space-y-6">
      <PageHead title="My courses" sub="Only courses assigned to you — writes are scoped server-side too" />
      {data.length === 0 ? <Card><Empty icon="book" title="No courses assigned" sub="The admin office assigns courses from the Courses module." /></Card> : (
        <div className="stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((c) => (
            <Card key={c.id} className="transition-transform hover:-translate-y-1">
              <div className="flex items-start justify-between">
                <p className="num text-[11px] font-semibold text-pine-600">{c.code}</p>
                <Badge tone="gray">{c.type}</Badge>
              </div>
              <h3 className="mt-1 font-display text-[15px] font-bold text-ink">{c.name}</h3>
              <p className="mt-1 text-xs text-faint">{c.credits} credits · Semester {c.semester} · {c.difficulty}</p>
              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3.5 text-center">
                <div><p className="num text-[16px] font-bold text-ink">{c.enrolled}</p><p className="text-[10px] uppercase tracking-wider text-faint">students</p></div>
                <div><p className="num text-[16px] font-bold text-ink">{c.attendance.percentage}%</p><p className="text-[10px] uppercase tracking-wider text-faint">attendance</p></div>
                <div><p className="num text-[16px] font-bold text-ink">{c.classAverage !== null ? `${c.classAverage}%` : "—"}</p><p className="text-[10px] uppercase tracking-wider text-faint">class avg</p></div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ================= students (scoped to assigned courses) ================= */

function FacultyStudentsPage() {
  const { data: courses, loading: cLoading } = useApi(() => api.myTeachingCourses(), []);
  const [courseId, setCourseId] = useState("");
  const active = courseId || courses?.[0]?.id || "";
  const { data: roster, loading, error, reload } = useApi(
    () => (active ? api.attendanceRoster(active, new Date().toISOString().slice(0, 10)) : Promise.resolve(null)),
    [active],
  );

  if (cLoading) return <Loading label="Loading courses…" />;
  if (!courses || courses.length === 0) return <Card><Empty icon="users" title="No assigned courses" sub="Students appear once the admin assigns you a course." /></Card>;

  return (
    <div className="space-y-6">
      <PageHead title="My students" sub="Roster from your assigned courses with running attendance" />
      <div className="max-w-sm">
        <select className="input" value={active} onChange={(e) => setCourseId(e.target.value)}>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
        </select>
      </div>
      <Card pad={false}>
        {loading && <div className="p-4"><Loading label="Loading roster…" /></div>}
        {!loading && error && <div className="p-4"><ErrorBox message={error} onRetry={reload} /></div>}
        {!loading && !error && roster && (
          roster.rows.length === 0 ? <Empty icon="users" title="No students enrolled" /> : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>#</th><th>Roll no</th><th>Student</th><th>Section</th><th>Attendance ({roster.course.code})</th><th>Risk</th></tr></thead>
                <tbody>
                  {roster.rows.map((r, i) => (
                    <tr key={r.studentId}>
                      <td className="num text-faint">{i + 1}</td>
                      <td className="num text-faint">{r.regNo}</td>
                      <td className="font-medium text-ink">{r.name}</td>
                      <td><Badge tone="gray">{r.section}</Badge></td>
                      <td className="num font-semibold">{r.running.percentage}% <span className="text-faint font-normal">({r.running.attended}/{r.running.total})</span></td>
                      <td><RiskBadge risk={r.running.risk} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </Card>
    </div>
  );
}

/* ================= attendance & marks ================= */

function FacultyAttendancePage() {
  const { data: courses, loading } = useApi(() => api.myTeachingCourses(), []);
  if (loading) return <Loading label="Loading courses…" />;
  if (!courses || courses.length === 0) return <Card><Empty icon="check" title="No assigned courses" sub="The admin office must assign you a course first." /></Card>;
  return (
    <div className="space-y-6">
      <PageHead title="Attendance" sub="Save once — student dashboards, insights and notifications update immediately" />
      <AttendanceMarker courses={courses.map((c) => ({ id: c.id, code: c.code, name: c.name }))} />
    </div>
  );
}

function FacultyMarksPage() {
  const { data: courses, loading } = useApi(() => api.myTeachingCourses(), []);
  if (loading) return <Loading label="Loading courses…" />;
  if (!courses || courses.length === 0) return <Card><Empty icon="edit" title="No assigned courses" sub="The admin office must assign you a course first." /></Card>;
  return (
    <div className="space-y-6">
      <PageHead title="Marks entry" sub="Publish CAT / Quiz / FAT marks — grades and averages recompute automatically" />
      <MarksEntry courses={courses.map((c) => ({ id: c.id, code: c.code, name: c.name }))} />
    </div>
  );
}

/* ================= assignments ================= */

function FacultyAssignmentsPage() {
  const { data, loading, error, reload } = useApi(() => api.assignments(), []);
  const { data: courses } = useApi(() => api.myTeachingCourses(), []);
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [courseId, setCourseId] = useState("");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.createAssignment({ courseId, title, description: desc, dueDate: due });
      push("success", "Assignment posted — enrolled students were notified.");
      setOpen(false); setTitle(""); setDesc(""); setDue("");
      reload();
    } catch (e) {
      push("error", e instanceof ApiError ? e.message : "Could not post assignment.");
    } finally { setBusy(false); }
  };

  if (loading) return <Loading label="Loading assignments…" />;
  if (error || !data) return <ErrorBox message={error ?? "Unable to load assignments."} onRetry={reload} />;

  return (
    <div className="space-y-6">
      <PageHead title="Assignments" sub="Post work for your courses — submissions are tracked per student"
        right={<Button onClick={() => { setCourseId(courses?.[0]?.id ?? ""); setOpen(true); }}><Icon name="plus" size={14} /> New assignment</Button>} />
      {data.length === 0 ? <Card><Empty icon="file" title="No assignments posted" sub="Create the first assignment for your course." action={<Button size="sm" onClick={() => setOpen(true)}><Icon name="plus" size={13} /> Create</Button>} /></Card> : (
        <Card pad={false}>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Assignment</th><th>Course</th><th>Due</th><th>Submissions</th></tr></thead>
              <tbody>
                {data.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <p className="font-medium text-ink">{a.title}</p>
                      <p className="max-w-md truncate text-[11px] text-faint">{a.description}</p>
                    </td>
                    <td><Badge tone="pine">{a.courseCode}</Badge></td>
                    <td className="num text-soft">{fmtDate(a.dueDate)}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="num text-[13px] font-semibold">{a.submitted}/{a.enrolled}</span>
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[#e8eee8]">
                          <div className="h-full rounded-full bg-pine-500" style={{ width: `${a.enrolled ? (a.submitted / a.enrolled) * 100 : 0}%`, transition: "width 0.6s ease" }} />
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New assignment" sub="Students in the course are notified instantly">
        <div className="space-y-4">
          <Field label="Course">
            <select className="input" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              {(courses ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
          </Field>
          <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Normalisation worksheet" /></Field>
          <Field label="Instructions"><textarea className="input min-h-24" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What should students do?" /></Field>
          <Field label="Due date"><input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
          <div className="flex justify-end gap-2">
            <Button tone="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => void submit()} loading={busy} disabled={!title.trim() || !due}><Icon name="send" size={13} /> Post assignment</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ================= timetable & notifications ================= */

function FacultyTimetablePage() {
  const { data, loading, error, reload } = useApi(() => api.timetable(), []);
  if (loading) return <Loading label="Loading timetable…" />;
  if (error || !data) return <ErrorBox message={error ?? "Unable to load timetable."} onRetry={reload} />;
  return (
    <div className="space-y-6">
      <PageHead title="Teaching timetable" sub="Your scheduled classes across the week" />
      {data.length === 0 ? <Card><Empty icon="calendar" title="No scheduled classes" sub="The admin office manages timetable slots." /></Card> : <TimetableGrid slots={data} />}
    </div>
  );
}

function FacultyNotificationsPage() {
  const { data, loading, error, reload } = useApi(() => api.myNotifications(), []);
  if (loading) return <Loading label="Loading notifications…" />;
  if (error || !data) return <ErrorBox message={error ?? "Unable to load notifications."} onRetry={reload} />;
  return (
    <div className="space-y-6">
      <PageHead title="Notifications" sub="Exam scheduling, broadcasts and admin updates" />
      <NoticeList items={data} timeAgo={timeAgo} emptySub="Broadcasts and exam updates from the admin office appear here."
        onRead={(id) => void api.markRead(id).then(reload)}
        onReadAll={() => void api.markAllRead().then(reload)} />
    </div>
  );
}

