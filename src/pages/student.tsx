import { useMemo, useState } from "react";
import { api, ApiError } from "../server/api";
import { todayISO, type RequestType } from "../server/db";
import { daysUntil, fmtDate, fmtDateShort, inr, timeAgo, useApi, useRouter, useToast } from "../state";
import {
  Badge, Button, Card, CardHead, DiffBadge, Donut, Empty, ErrorBox, Field, GradeBadge,
  Icon, Loading, Modal, PageHead, RiskBadge, Spark, Stat, TrendChip,
} from "../ui";
import { NoticeList, TimetableGrid } from "./shared";
import { CoachPage } from "./coach";

export function StudentWorkspace({ page }: { page: string }) {
  switch (page) {
    case "profile": return <ProfilePage />;
    case "courses": return <CoursesPage />;
    case "attendance": return <AttendancePage />;
    case "marks": return <MarksPage />;
    case "results": return <ResultsPage />;
    case "performance": return <PerformancePage />;
    case "coach": return <CoachPage />;
    case "timetable": return <TimetablePage />;
    case "exams": return <ExamsPage />;
    case "assignments": return <AssignmentsPage />;
    case "fees": return <FeesPage />;
    case "requests": return <RequestsPage />;
    case "notifications": return <NotificationsPage />;
    default: return <DashboardPage />;
  }
}

/* ================= dashboard ================= */

function DashboardPage() {
  const { data, loading, error, reload } = useApi(() => api.studentDashboard(), []);
  const { navigate } = useRouter();

  if (loading) return <Loading label="Building your dashboard from live records…" />;
  if (error || !data) return <ErrorBox message={error ?? "Unable to load dashboard."} onRetry={reload} />;

  const p = data.profile;
  const attTone = p.attendance.risk === "CRITICAL" ? "red" : p.attendance.risk === "WARNING" ? "gold" : "pine";
  const priorityTone = { HIGH: "red", MEDIUM: "gold", LOW: "gray" } as const;
  const kindIcon: Record<string, string> = { attendance: "check", assignment: "file", fee: "wallet", request: "send", exam: "clock" };

  return (
    <div className="space-y-6">
      <PageHead title={`Hello, ${p.student.name.split(" ")[0]}`} sub={`${p.student.regNo} · ${p.student.program} ${p.student.branch} · Semester ${p.student.semester}, Section ${p.student.section}`}
        right={<Button tone="ghost" size="sm" onClick={() => navigate("/student/performance")}><Icon name="trend" size={13} /> Academic performance</Button>} />

      <div className="stagger grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Stat label={`Attendance (≥${p.attendance.threshold}%)`} value={p.attendance.percentage} decimals={1} suffix="%" icon="check" tone={attTone} hint={p.attendance.risk} />
        <Stat label="Average marks" value={p.summary.averagePct ?? 0} decimals={1} suffix="%" icon="award" tone="pine" hint={p.summary.sgpa !== null ? `SGPA ${p.summary.sgpa}` : "no FAT yet"} />
        <Stat label="Fees due" value={p.fees?.due ?? 0} icon="wallet" tone={p.fees && p.fees.due > 0 ? "gold" : "pine"} hint={p.fees?.status ?? "—"} />
        <Stat label="Enrolled courses" value={p.summary.subjectCount} icon="book" tone="ink" hint={`${p.summary.passedCount}/${p.results.length} FAT passed`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* action center */}
          {p.actions.length > 0 && (
            <Card pad={false}>
              <div className="p-5 pb-3">
                <CardHead icon="target" title="Action Center" sub="Generated live from attendance, fees, assignments, requests and exams" />
              </div>
              <ul className="divide-y divide-[#ecf1ec]">
                {p.actions.slice(0, 5).map((a, i) => (
                  <li key={i} className="flex items-center gap-3 px-5 py-3">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${a.priority === "HIGH" ? "bg-blush-50 text-blush-600" : a.priority === "MEDIUM" ? "bg-gold-50 text-gold-600" : "bg-pine-50 text-pine-600"}`}>
                      <Icon name={kindIcon[a.kind] ?? "info"} size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-ink">{a.title}</p>
                      <p className="truncate text-xs text-soft">{a.detail}</p>
                    </div>
                    <Badge tone={priorityTone[a.priority]}>{a.priority}</Badge>
                    <button onClick={() => navigate(a.link)} className="rounded-md p-1.5 text-faint transition-colors hover:bg-pine-50 hover:text-pine-700" aria-label="Open">
                      <Icon name="arrowRight" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* academic snapshot */}
          <Card pad={false}>
            <div className="p-5 pb-3"><CardHead icon="chart" title="Academic snapshot" sub="Attendance and performance per course — from the shared database" /></div>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>Course</th><th>Attendance</th><th>Avg</th><th>Class avg</th><th>Δ</th><th>Trend</th><th>Grade</th></tr></thead>
                <tbody>
                  {p.courses.map((c) => (
                    <tr key={c.courseId}>
                      <td>
                        <p className="font-semibold text-ink">{c.courseCode}</p>
                        <p className="text-[11px] text-faint">{c.courseName}</p>
                      </td>
                      <td>
                        <span className="flex items-center gap-2">
                          <span className="num font-semibold">{c.attendance.percentage}%</span>
                          <RiskBadge risk={c.attendance.risk} />
                        </span>
                      </td>
                      <td className="num">{c.performance.average !== null ? `${c.performance.average}%` : "—"}</td>
                      <td className="num text-soft">{c.performance.classAverage !== null ? `${c.performance.classAverage}%` : "—"}</td>
                      <td><DiffBadge diff={c.performance.difference} /></td>
                      <td><TrendChip trend={c.performance.trend} /></td>
                      <td>{c.performance.grade ? <GradeBadge grade={c.performance.grade} /> : <span className="text-xs text-faint">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* recent results */}
          <Card pad={false}>
            <div className="p-5 pb-3"><CardHead icon="award" title="Recent results" sub="FAT assessments graded by backend rules" right={<Button tone="ghost" size="sm" onClick={() => navigate("/student/results")}>View all</Button>} /></div>
            {p.results.length === 0 ? <Empty icon="award" title="No results published yet" sub="Results appear here the moment faculty publish FAT marks." /> : (
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead><tr><th>Course</th><th>Date</th><th>Marks</th><th>%</th><th>Grade</th></tr></thead>
                  <tbody>
                    {p.results.slice(0, 5).map((r) => (
                      <tr key={r.courseId}>
                        <td className="font-medium text-ink">{r.courseName}</td>
                        <td className="num text-soft">{fmtDateShort(r.date)}</td>
                        <td className="num">{r.marks}/{r.maxMarks}</td>
                        <td className="num font-semibold">{r.pct}%</td>
                        <td><GradeBadge grade={r.grade} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* right rail */}
        <div className="space-y-5">
          <Card className="flex flex-col items-center py-6">
            <Donut pct={p.attendance.percentage} tone={attTone} label="attendance" />
            <p className="mt-3 text-center text-xs text-soft">
              <span className="num font-semibold text-ink">{p.attendance.attended}</span> of <span className="num font-semibold text-ink">{p.attendance.total}</span> classes attended
              {p.attendance.belowThreshold && <> · need <span className="num font-semibold text-blush-600">{p.attendance.classesNeeded}</span> to recover</>}
            </p>
          </Card>

          <Card pad={false}>
            <div className="p-5 pb-3"><CardHead icon="spark" title="Academic insights" sub="Objective, data-driven" /></div>
            <ul className="space-y-2.5 px-5 pb-5">
              {p.insights.slice(0, 5).map((ins, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className={`mt-0.5 shrink-0 ${ins.severity === "HIGH" ? "text-blush-600" : ins.severity === "MEDIUM" ? "text-gold-600" : ins.severity === "GOOD" ? "text-emerald-600" : "text-pine-500"}`}>
                    <Icon name={ins.severity === "GOOD" ? "check" : ins.severity === "LOW" ? "info" : "alert"} size={14} />
                  </span>
                  <p className="text-xs leading-relaxed text-soft">{ins.text}</p>
                </li>
              ))}
            </ul>
          </Card>

          <Card pad={false}>
            <div className="p-5 pb-3"><CardHead icon="clock" title="Upcoming exams" right={<Button tone="ghost" size="sm" onClick={() => navigate("/student/exams")}>Schedule</Button>} /></div>
            <UpcomingExamsMini />
          </Card>

          <Card pad={false}>
            <div className="p-5 pb-3"><CardHead icon="bell" title="Latest notifications" right={<Button tone="ghost" size="sm" onClick={() => navigate("/student/notifications")}>All</Button>} /></div>
            <ul className="divide-y divide-[#ecf1ec]">
              {data.recentNotifications.slice(0, 3).map((n) => (
                <li key={n.id} className="px-5 py-3">
                  <p className={`truncate text-[12.5px] ${n.read ? "text-soft" : "font-semibold text-ink"}`}>{n.title}</p>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-faint">{timeAgo(n.createdAt)}</p>
                </li>
              ))}
              {data.recentNotifications.length === 0 && <li className="px-5 py-4 text-xs text-faint">Nothing yet.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function UpcomingExamsMini() {
  const { data } = useApi(() => api.exams(), []);
  const today = todayISO();
  const upcoming = (data ?? []).filter((e) => e.date >= today).slice(0, 3);
  if (!data) return <div className="px-5 pb-5"><div className="skeleton h-16" /></div>;
  if (upcoming.length === 0) return <p className="px-5 pb-5 text-xs text-faint">No upcoming exams scheduled.</p>;
  return (
    <ul className="space-y-2 px-5 pb-5">
      {upcoming.map((e) => {
        const d = daysUntil(e.date);
        return (
          <li key={e.id} className="flex items-center gap-3 rounded-lg border border-line p-2.5 transition-colors hover:border-pine-300">
            <span className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-lg bg-pine-900 text-white">
              <span className="num text-[13px] font-bold leading-none">{e.date.slice(8)}</span>
              <span className="text-[8px] uppercase">{fmtDateShort(e.date).split(" ")[1]}</span>
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-semibold text-ink">{e.courseCode} · {e.name}</p>
              <p className="text-[11px] text-faint">{e.start}–{e.end} · {e.venue}</p>
            </div>
            <Badge tone={d <= 3 ? "red" : d <= 7 ? "gold" : "gray"}>{d === 0 ? "today" : `in ${d}d`}</Badge>
          </li>
        );
      })}
    </ul>
  );
}

/* ================= profile ================= */

function ProfilePage() {
  const { data, loading, error, reload } = useApi(() => api.myStudentRecord(), []);
  const { push } = useToast();
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  if (loading) return <Loading label="Loading profile…" />;
  if (error || !data) return <ErrorBox message={error ?? "Unable to load profile."} onRetry={reload} />;
  const s = data;

  const rows: { label: string; value: string; locked?: boolean }[] = [
    { label: "Full name", value: s.name, locked: true },
    { label: "Registration no", value: s.regNo, locked: true },
    { label: "Email (login)", value: s.email, locked: true },
    { label: "Phone", value: s.phone },
    { label: "Program", value: s.program, locked: true },
    { label: "Branch", value: s.branch, locked: true },
    { label: "Semester", value: `Semester ${s.semester}`, locked: true },
    { label: "Section", value: `Section ${s.section}`, locked: true },
    { label: "Batch", value: s.batch, locked: true },
    { label: "Admission year", value: String(s.admissionYear), locked: true },
  ];

  const savePhone = async () => {
    setSaving(true);
    try {
      await api.updateMyProfile({ phone });
      push("success", "Phone number updated.");
      setEditing(false);
      reload();
    } catch (e) {
      push("error", e instanceof ApiError ? e.message : "Could not update phone.");
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <PageHead title="My profile" sub="Identity fields are protected by the admin office — contact details are editable." />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <div className="flex flex-col items-center pt-2 text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-2xl bg-pine-900 font-display text-2xl font-bold text-pine-100">
              {s.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
            </span>
            <h2 className="mt-4 font-display text-xl font-bold text-ink">{s.name}</h2>
            <p className="num mt-1 text-xs tracking-wide text-faint">{s.regNo}</p>
            <div className="mt-3 flex gap-2">
              <Badge tone="pine">{s.program}</Badge>
              <Badge tone="gray">SEM {s.semester}</Badge>
              <Badge tone="gray">SEC {s.section}</Badge>
            </div>
            <div className="mt-5 w-full space-y-2 border-t border-line pt-4 text-left">
              <p className="flex items-center gap-2 text-xs text-soft"><Icon name="mail" size={13} className="text-faint" />{s.email}</p>
              <p className="flex items-center gap-2 text-xs text-soft"><Icon name="phone" size={13} className="text-faint" />{s.phone}</p>
              <p className="flex items-center gap-2 text-xs text-soft"><Icon name="cap" size={13} className="text-faint" />{s.branch}</p>
            </div>
            <Button tone="ghost" size="sm" className="mt-4" onClick={() => { setPhone(s.phone); setEditing(true); }}>
              <Icon name="edit" size={13} /> Edit contact details
            </Button>
          </div>
        </Card>

        <Card className="lg:col-span-2" pad={false}>
          <div className="p-5 pb-3"><CardHead icon="shield" title="Academic record" sub="Read-only — maintained by the administration" /></div>
          <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
            {rows.map((r) => (
              <div key={r.label} className="flex items-center justify-between gap-3 border-b border-[#ecf1ec] px-5 py-3">
                <dt className="text-xs font-medium text-faint">{r.label}</dt>
                <dd className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                  {r.value}
                  {r.locked && <span title="Protected field" className="text-faint"><Icon name="shield" size={12} /></span>}
                </dd>
              </div>
            ))}
          </dl>
          <p className="px-5 py-4 text-[11px] leading-relaxed text-faint">
            Need a correction? Raise an <span className="font-semibold text-pine-700">Academic request</span> from the Requests module — the admin office reviews and updates records there.
          </p>
        </Card>
      </div>

      <Modal open={editing} onClose={() => setEditing(false)} title="Edit contact details" sub="Only your phone number is editable by you.">
        <div className="space-y-4">
          <Field label="Phone number"><input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98XXX XXXXX" /></Field>
          <div className="flex justify-end gap-2">
            <Button tone="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            <Button onClick={() => void savePhone()} loading={saving}>Save changes</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ================= courses ================= */

function CoursesPage() {
  const { data, loading, error, reload } = useApi(() => api.myAcademicProfile(), []);
  if (loading) return <Loading label="Loading enrolled courses…" />;
  if (error || !data) return <ErrorBox message={error ?? "Unable to load courses."} onRetry={reload} />;
  const typeTone: Record<string, "pine" | "gold" | "gray" | "blue"> = { CORE: "pine", ELECTIVE: "blue", FOUNDATION: "gold", LAB: "gray", PROJECT: "gray", OTHER: "gray" };
  return (
    <div className="space-y-6">
      <PageHead title="My courses" sub={`${data.courses.length} enrolled this semester · attendance and averages update live`} />
      <div className="stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.courses.map((c) => (
          <Card key={c.courseId} className="flex flex-col transition-transform hover:-translate-y-1">
            <div className="flex items-start justify-between">
              <div>
                <p className="num text-[11px] font-semibold tracking-wide text-pine-600">{c.courseCode}</p>
                <h3 className="mt-0.5 font-display text-[15px] font-bold leading-snug text-ink">{c.courseName}</h3>
              </div>
              <Badge tone={typeTone[c.type]}>{c.type}</Badge>
            </div>
            <p className="mt-1.5 text-xs text-faint">{c.facultyName} · {c.credits} credits · {c.difficulty}</p>
            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3.5">
              <div>
                <p className="num text-[15px] font-bold text-ink">{c.attendance.percentage}%</p>
                <p className="text-[10px] uppercase tracking-wider text-faint">attendance</p>
              </div>
              <div>
                <p className="num text-[15px] font-bold text-ink">{c.performance.average !== null ? `${c.performance.average}%` : "—"}</p>
                <p className="text-[10px] uppercase tracking-wider text-faint">avg marks</p>
              </div>
              <div>
                <p className="text-[15px] font-bold">{c.performance.grade ?? "—"}</p>
                <p className="text-[10px] uppercase tracking-wider text-faint">grade</p>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <RiskBadge risk={c.attendance.risk} />
              <DiffBadge diff={c.performance.difference} />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ================= attendance ================= */

function AttendancePage() {
  const { data, loading, error, reload } = useApi(() => api.myAttendance(), []);
  if (loading) return <Loading label="Loading attendance…" />;
  if (error || !data) return <ErrorBox message={error ?? "Unable to load attendance."} onRetry={reload} />;
  const o = data.overall;
  const tone = o.risk === "CRITICAL" ? "red" : o.risk === "WARNING" ? "gold" : "pine";
  return (
    <div className="space-y-6">
      <PageHead title="Attendance" sub={`Threshold ${o.threshold}% · statuses computed by the backend from live records`} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="flex flex-col items-center justify-center py-7">
          <Donut pct={o.percentage} tone={tone} label="overall" size={140} />
          <div className="mt-4 flex items-center gap-2"><RiskBadge risk={o.risk} /><Badge tone="gray">{o.attended}/{o.total} classes</Badge></div>
          <p className="mt-3 max-w-55 text-center text-xs leading-relaxed text-soft">
            {o.belowThreshold
              ? <>Attend the next <span className="num font-bold text-blush-600">{o.classesNeeded}</span> classes to cross {o.threshold}%.</>
              : <>You can miss up to <span className="num font-bold text-pine-700">{o.canMiss}</span> classes and stay safe.</>}
          </p>
        </Card>
        <div className="space-y-4 lg:col-span-2">
          {data.courses.map((c) => {
            const s = c.summary;
            const t = s.risk === "CRITICAL" ? "red" : s.risk === "WARNING" ? "gold" : "pine";
            return (
              <Card key={c.course.id} className="anim-rise">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="num text-[11px] font-semibold text-pine-600">{c.course.code}</p>
                    <p className="font-display text-[14px] font-semibold text-ink">{c.course.name}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="num text-lg font-bold">{s.percentage}%</span>
                    <RiskBadge risk={s.risk} />
                  </div>
                </div>
                <div className="mt-3">
                  <div className="h-2 overflow-hidden rounded-full bg-[#e8eee8]">
                    <div className={`h-full rounded-full ${t === "red" ? "bg-blush-500" : t === "gold" ? "bg-gold-500" : "bg-pine-500"}`} style={{ width: `${s.percentage}%`, transition: "width 0.9s cubic-bezier(0.22,1,0.36,1)" }} />
                  </div>
                  <div className="relative mt-1 h-3">
                    <span className="absolute left-[75%] -translate-x-1/2 font-mono text-[9px] text-faint">▲ {s.threshold}%</span>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-soft">
                  <span><span className="num font-semibold text-emerald-700">{s.attended}</span> present · <span className="num font-semibold text-blush-600">{s.absent}</span> absent</span>
                  {s.belowThreshold
                    ? <span className="font-medium text-blush-600">Need {s.classesNeeded} consecutive classes to recover</span>
                    : <span>Can miss <span className="num font-semibold text-pine-700">{s.canMiss}</span> safely</span>}
                </div>
                <div className="mt-3 flex flex-wrap gap-1 border-t border-line pt-3">
                  {c.recent.map((r, i) => (
                    <span key={i} title={`${r.date}: ${r.status}`}
                      className={`num flex h-6 w-9 items-center justify-center rounded text-[9px] font-bold ${r.status === "PRESENT" ? "bg-emerald-100 text-emerald-700" : "bg-blush-50 text-blush-600"}`}>
                      {r.status === "PRESENT" ? "P" : "A"}
                    </span>
                  ))}
                  <span className="ml-1 self-center text-[10px] text-faint">last {c.recent.length} classes →</span>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ================= marks ================= */

function MarksPage() {
  const { data, loading, error, reload } = useApi(() => api.myMarks(), []);
  if (loading) return <Loading label="Loading marks…" />;
  if (error || !data) return <ErrorBox message={error ?? "Unable to load marks."} onRetry={reload} />;
  return (
    <div className="space-y-6">
      <PageHead title="Marks & assessments" sub="Class averages are recalculated from every student's marks — never hardcoded" />
      <div className="space-y-5">
        {data.map((c) => (
          <Card key={c.course.id} pad={false} className="anim-rise">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-5 py-4">
              <div>
                <p className="num text-[11px] font-semibold text-pine-600">{c.course.code} · {c.course.credits} credits</p>
                <h3 className="font-display text-[15px] font-bold text-ink">{c.course.name}</h3>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Spark points={c.assessments.map((a) => a.pct)} />
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wider text-faint">you vs class</p>
                  <div className="mt-1 flex items-center justify-end gap-2">
                    <span className="num text-sm font-bold">{c.average !== null ? `${c.average}%` : "—"}</span>
                    <DiffBadge diff={c.difference} />
                    <TrendChip trend={c.trend} />
                  </div>
                </div>
              </div>
            </div>
            {c.assessments.length === 0 ? <Empty icon="edit" title="No marks yet" sub="Assessments appear once faculty publish them." /> : (
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead><tr><th>Assessment</th><th>Date</th><th>Marks</th><th>%</th><th>Class avg</th><th>Δ</th><th>Grade</th></tr></thead>
                  <tbody>
                    {c.assessments.map((a) => (
                      <tr key={a.id}>
                        <td><Badge tone="pine">{a.type}</Badge></td>
                        <td className="num text-soft">{fmtDateShort(a.date)}</td>
                        <td className="num font-semibold">{a.marks}/{a.maxMarks}</td>
                        <td className="num">{a.pct}%</td>
                        <td className="num text-soft">{a.classAvg}%</td>
                        <td><DiffBadge diff={a.diff} /></td>
                        <td><GradeBadge grade={a.grade} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ================= results ================= */

function ResultsPage() {
  const { data, loading, error, reload } = useApi(() => api.myResults(), []);
  if (loading) return <Loading label="Loading results…" />;
  if (error || !data) return <ErrorBox message={error ?? "Unable to load results."} onRetry={reload} />;
  const { results, summary, gradingScale } = data;
  const avgPct = results.length ? Math.round(results.reduce((s, r) => s + r.pct, 0) / results.length * 10) / 10 : null;
  return (
    <div className="space-y-6">
      <PageHead title="Results" sub="End-semester (FAT) outcomes · grades and SGPA computed centrally" />
      <div className="stagger grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Stat label="SGPA" value={summary.sgpa ?? 0} decimals={2} icon="award" tone="pine" hint={summary.sgpa === null ? "no FAT data" : "out of 10"} />
        <Stat label="Average percentage" value={avgPct ?? 0} decimals={1} suffix="%" icon="chart" tone="pine" />
        <Stat label="Subjects passed" value={summary.passedCount} icon="check" tone="pine" hint={`of ${results.length} FATs`} />
        <Stat label="Highest score" value={results.length ? Math.max(...results.map((r) => r.pct)) : 0} decimals={1} suffix="%" icon="spark" tone="gold" />
      </div>

      <Card pad={false}>
        <div className="p-5 pb-3"><CardHead icon="award" title="Semester results" sub="One record per student + course + exam — duplicates prevented" /></div>
        {results.length === 0 ? <Empty icon="award" title="No results published yet" sub="Results appear when FAT marks are entered." /> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Exam</th><th>Course</th><th>Credits</th><th>Marks</th><th>%</th><th>Grade</th><th>Points</th><th>Status</th></tr></thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.courseId}>
                    <td className="text-soft">End Semester (FAT)</td>
                    <td className="font-medium text-ink">{r.courseName}</td>
                    <td className="num">{r.credits}</td>
                    <td className="num">{r.marks}/{r.maxMarks}</td>
                    <td className="num font-semibold">{r.pct}%</td>
                    <td><GradeBadge grade={r.grade} /></td>
                    <td className="num">{r.points}</td>
                    <td>{r.passed ? <Badge tone="green">PASSED</Badge> : <Badge tone="red">FAILED</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card pad={false}>
          <div className="p-5 pb-3"><CardHead icon="target" title="Grading scale" sub="Configured centrally — applied by the backend" /></div>
          <table className="tbl">
            <thead><tr><th>Range</th><th>Grade</th><th>Points</th></tr></thead>
            <tbody>{gradingScale.map((g) => (
              <tr key={g.grade}><td className="num text-soft">{g.range}</td><td><GradeBadge grade={g.grade} /></td><td className="num">{g.points}</td></tr>
            ))}</tbody>
          </table>
        </Card>
        <Card>
          <CardHead icon="info" title="CGPA" sub="Cross-semester aggregate" />
          <div className="rounded-lg border border-dashed border-line bg-paper px-4 py-5 text-center">
            <p className="font-display text-sm font-semibold text-soft">{summary.cgpaNote}</p>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ================= academic performance (AI-ready) ================= */

function PerformancePage() {
  const { data: p, loading, error, reload } = useApi(() => api.myAcademicProfile(), []);
  const [showJson, setShowJson] = useState(false);
  const ranked = useMemo(() => p ? [...p.courses].filter((c) => c.performance.average !== null).sort((a, b) => (b.performance.average ?? 0) - (a.performance.average ?? 0)) : [], [p]);

  if (loading) return <Loading label="Analysing your academic profile…" />;
  if (error || !p) return <ErrorBox message={error ?? "Unable to build profile."} onRetry={reload} />;

  const strongest = ranked.slice(0, 2);
  const weakest = ranked.slice(-2).reverse();
  const attention = p.courses.filter((c) => c.attendance.belowThreshold || c.performance.trend === "DECLINING" || (c.performance.difference !== null && c.performance.difference <= -5));
  const sevTone = { HIGH: "red", MEDIUM: "gold", LOW: "gray", GOOD: "green" } as const;

  return (
    <div className="space-y-6">
      <PageHead title="Academic Performance" sub="Deterministic analysis of your live ERP data — the same structured profile a future AI Academic Coach will consume"
        right={<Button tone="ghost" size="sm" onClick={() => setShowJson((v) => !v)}><Icon name="db" size={13} /> {showJson ? "Hide" : "View"} profile JSON</Button>} />

      {showJson && (
        <Card className="anim-pop overflow-hidden" pad={false}>
          <div className="flex items-center justify-between border-b border-line bg-pine-900 px-4 py-2.5">
            <span className="font-mono text-[11px] text-pine-200">GET /api/academic-profile/me</span>
            <Badge tone="green">structured · deterministic</Badge>
          </div>
          <pre className="max-h-80 overflow-auto bg-pine-950 p-4 font-mono text-[11px] leading-relaxed text-pine-100">{JSON.stringify({ student: p.student, attendance: { overallPercentage: p.attendance.percentage, threshold: p.attendance.threshold, risk: p.attendance.risk }, courses: p.courses.length, results: p.results.length, fees: p.fees, insights: p.insights }, null, 2)}</pre>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="bg-pine-900 border-pine-800">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-pine-300">Strongest subjects</p>
          <div className="mt-3 space-y-3">
            {strongest.length === 0 && <p className="text-xs text-pine-300">Not enough marks yet.</p>}
            {strongest.map((c) => (
              <div key={c.courseId}>
                <div className="flex items-baseline justify-between">
                  <p className="font-display text-[14px] font-semibold text-white">{c.courseName}</p>
                  <span className="num text-sm font-bold text-emerald-400">{c.performance.average}%</span>
                </div>
                <p className="text-[11px] text-pine-300">{c.performance.difference !== null && c.performance.difference > 0 ? `+${c.performance.difference} vs class avg` : "on par with class"} · grade {c.performance.grade ?? "—"}</p>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-faint">Needs attention</p>
          <div className="mt-3 space-y-3">
            {attention.length === 0 && <p className="text-xs text-soft">No courses flagged — keep it up.</p>}
            {attention.map((c) => (
              <div key={c.courseId} className="rounded-lg border border-blush-500/20 bg-blush-50/60 p-2.5">
                <p className="font-display text-[13.5px] font-semibold text-ink">{c.courseName}</p>
                <p className="mt-0.5 text-[11px] text-soft">
                  {c.attendance.belowThreshold && <span className="mr-1.5">attendance {c.attendance.percentage}%</span>}
                  {c.performance.trend === "DECLINING" && <span className="mr-1.5">declining scores</span>}
                  {c.performance.difference !== null && c.performance.difference <= -5 && <span>{Math.abs(c.performance.difference)} pts below class</span>}
                </p>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-faint">Weakest subjects</p>
          <div className="mt-3 space-y-3">
            {weakest.length === 0 && <p className="text-xs text-soft">Not enough marks yet.</p>}
            {weakest.map((c) => (
              <div key={c.courseId}>
                <div className="flex items-baseline justify-between">
                  <p className="font-display text-[14px] font-semibold text-ink">{c.courseName}</p>
                  <span className="num text-sm font-bold text-blush-600">{c.performance.average}%</span>
                </div>
                <p className="text-[11px] text-faint">class avg {c.performance.classAverage}% · trend {c.performance.trend.replace("_", " ").toLowerCase()}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card pad={false}>
        <div className="p-5 pb-3"><CardHead icon="trend" title="Course-by-course analysis" sub="Trend uses your chronological assessment history (±5% rule)" /></div>
        <div className="grid gap-4 p-5 pt-2 md:grid-cols-2 xl:grid-cols-3">
          {p.courses.map((c) => (
            <div key={c.courseId} className="rounded-xl border border-line p-4 transition-shadow hover:shadow-lift">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="num text-[10.5px] font-semibold text-pine-600">{c.courseCode}</p>
                  <p className="font-display text-[13.5px] font-bold leading-tight text-ink">{c.courseName}</p>
                </div>
                {c.performance.grade && <GradeBadge grade={c.performance.grade} />}
              </div>
              <div className="mt-3"><Spark points={c.assessments.map((a) => a.pct)} height={38} tone={c.performance.trend === "DECLINING" ? "#d93654" : "#0e6955"} /></div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <TrendChip trend={c.performance.trend} />
                <DiffBadge diff={c.performance.difference} />
                <Badge tone={c.attendance.risk === "SAFE" ? "green" : c.attendance.risk === "WARNING" ? "gold" : "red"}>{c.attendance.percentage}% att.</Badge>
              </div>
              <p className="mt-2 text-[11px] text-faint">avg {c.performance.average ?? "—"}% · class {c.performance.classAverage ?? "—"}% · {c.credits} cr · {c.difficulty}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card pad={false}>
        <div className="p-5 pb-3"><CardHead icon="spark" title="Generated insights" sub="Every statement below is derived from objective data — no AI involved yet" /></div>
        <ul className="grid gap-2.5 p-5 pt-2 md:grid-cols-2">
          {p.insights.map((ins, i) => (
            <li key={i} className="flex items-start gap-2.5 rounded-lg border border-line bg-paper/60 p-3">
              <Badge tone={sevTone[ins.severity]}>{ins.severity}</Badge>
              <p className="text-xs leading-relaxed text-soft">{ins.text}</p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/* ================= timetable / exams ================= */

function TimetablePage() {
  const { data, loading, error, reload } = useApi(() => api.timetable(), []);
  if (loading) return <Loading label="Loading timetable…" />;
  if (error || !data) return <ErrorBox message={error ?? "Unable to load timetable."} onRetry={reload} />;
  return (
    <div className="space-y-6">
      <PageHead title="Weekly timetable" sub="Your enrolled courses · today's column is highlighted" />
      {data.length === 0 ? <Card><Empty icon="calendar" title="No timetable published" sub="The admin office has not scheduled classes for your courses yet." /></Card> : <TimetableGrid slots={data} />}
    </div>
  );
}

function ExamsPage() {
  const { data, loading, error, reload } = useApi(() => api.exams(), []);
  if (loading) return <Loading label="Loading exam schedule…" />;
  if (error || !data) return <ErrorBox message={error ?? "Unable to load exams."} onRetry={reload} />;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const upcoming = data.filter((e) => e.date >= todayStr);
  const past = data.filter((e) => e.date < todayStr);
  return (
    <div className="space-y-6">
      <PageHead title="Exam schedule" sub="Published by the examination cell — you see only your enrolled courses" />
      <Card pad={false}>
        <div className="p-5 pb-3"><CardHead icon="clock" title={`Upcoming (${upcoming.length})`} /></div>
        {upcoming.length === 0 ? <Empty icon="clock" title="No upcoming exams" sub="New exams appear here the moment admin schedules them." /> : (
          <ul className="divide-y divide-[#ecf1ec]">
            {upcoming.map((e) => {
              const d = daysUntil(e.date);
              return (
                <li key={e.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                  <span className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-pine-900 text-white">
                    <span className="num text-lg font-bold leading-none">{e.date.slice(8)}</span>
                    <span className="mt-0.5 text-[9px] uppercase tracking-wider text-pine-300">{fmtDateShort(e.date).split(" ")[1]}</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-[14px] font-semibold text-ink">{e.name}</p>
                    <p className="text-xs text-soft">{e.courseCode} · {e.courseName} · Semester {e.semester}</p>
                    <p className="mt-0.5 text-[11px] text-faint">{e.start} – {e.end} · Venue: {e.venue}</p>
                  </div>
                  <Badge tone={d <= 3 ? "red" : d <= 7 ? "gold" : "gray"}>{d === 0 ? "TODAY" : `IN ${d} DAYS`}</Badge>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {past.length > 0 && (
        <Card pad={false}>
          <div className="p-5 pb-3"><CardHead icon="check" title={`Completed (${past.length})`} /></div>
          <ul className="divide-y divide-[#ecf1ec]">
            {past.map((e) => (
              <li key={e.id} className="flex items-center gap-4 px-5 py-3 opacity-70">
                <span className="num w-20 text-xs text-faint">{fmtDate(e.date)}</span>
                <span className="flex-1 text-[13px] text-soft">{e.courseCode} — {e.name}</span>
                <Badge tone="gray">DONE</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/* ================= assignments ================= */

function AssignmentsPage() {
  const { data, loading, error, reload } = useApi(() => api.assignments(), []);
  const { push } = useToast();
  const [submitting, setSubmitting] = useState<string | null>(null);

  if (loading) return <Loading label="Loading assignments…" />;
  if (error || !data) return <ErrorBox message={error ?? "Unable to load assignments."} onRetry={reload} />;

  const submit = async (id: string) => {
    setSubmitting(id);
    try {
      await api.submitAssignment(id);
      push("success", "Assignment marked as submitted.");
      reload();
    } catch (e) {
      push("error", e instanceof ApiError ? e.message : "Could not submit.");
    } finally { setSubmitting(null); }
  };

  const statusMeta: Record<string, { tone: "red" | "gold" | "green"; label: string }> = {
    OVERDUE: { tone: "red", label: "OVERDUE" },
    PENDING: { tone: "gold", label: "PENDING" },
    SUBMITTED: { tone: "green", label: "SUBMITTED" },
  };

  return (
    <div className="space-y-6">
      <PageHead title="Assignments" sub="Status is computed from due dates and your submissions" />
      {data.length === 0 ? <Card><Empty icon="file" title="No assignments yet" sub="Faculty post assignments for your courses here." /></Card> : (
        <div className="stagger grid gap-4 md:grid-cols-2">
          {data.map((a) => {
            const m = statusMeta[a.myStatus] ?? statusMeta.PENDING;
            const d = daysUntil(a.dueDate);
            return (
              <Card key={a.id} className={`flex flex-col ${a.myStatus === "OVERDUE" ? "border-blush-500/30!" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="num text-[11px] font-semibold text-pine-600">{a.courseCode} · {a.courseName}</p>
                    <h3 className="mt-0.5 font-display text-[14.5px] font-bold leading-snug text-ink">{a.title}</h3>
                  </div>
                  <Badge tone={m.tone}>{m.label}</Badge>
                </div>
                <p className="mt-2 flex-1 text-xs leading-relaxed text-soft">{a.description}</p>
                <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
                  <p className="text-[11px] text-faint">
                    Due <span className={`num font-semibold ${d < 0 ? "text-blush-600" : d <= 2 ? "text-gold-600" : "text-ink"}`}>{fmtDate(a.dueDate)}</span>
                    {d >= 0 && d <= 3 && a.myStatus !== "SUBMITTED" && <span className="ml-1 font-medium text-gold-600">· {d === 0 ? "due today" : `${d}d left`}</span>}
                  </p>
                  {a.myStatus === "SUBMITTED"
                    ? <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700"><Icon name="check" size={13} /> Submitted {timeAgo(a.submittedAt!)}</span>
                    : <Button size="sm" onClick={() => void submit(a.id)} loading={submitting === a.id}><Icon name="send" size={12} /> Mark submitted</Button>}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ================= fees ================= */

function FeesPage() {
  const { data, loading, error, reload } = useApi(() => api.myFees(), []);
  if (loading) return <Loading label="Loading fee records…" />;
  if (error || !data) return <ErrorBox message={error ?? "Unable to load fees."} onRetry={reload} />;
  return (
    <div className="space-y-6">
      <PageHead title="Fees" sub="Payments are recorded by the accounts office — due amounts update instantly" />
      <div className="stagger grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Stat label="Total fee" value={data.total} icon="wallet" tone="ink" />
        <Stat label="Paid" value={data.paid} icon="check" tone="pine" />
        <Stat label="Due" value={data.due} icon="alert" tone={data.due > 0 ? "gold" : "pine"} />
        <div className="card flex flex-col items-center justify-center p-4">
          <span className="scale-110"><FeeStatusBig status={data.status} /></span>
          <p className="mt-2 text-xs font-medium text-soft">Payment status</p>
        </div>
      </div>
      <Card pad={false}>
        <div className="p-5 pb-3"><CardHead icon="wallet" title="Fee records" /></div>
        {data.rows.length === 0 ? <Empty icon="wallet" title="No fee records" sub="The accounts office has not raised a fee for you yet." /> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Semester</th><th>Description</th><th>Total</th><th>Paid</th><th>Due</th><th>Due date</th><th>Status</th></tr></thead>
              <tbody>
                {data.rows.map((f) => (
                  <tr key={f.id}>
                    <td className="num">Sem {f.semester}</td>
                    <td className="font-medium text-ink">{f.description}</td>
                    <td className="num">{inr(f.total)}</td>
                    <td className="num text-emerald-700">{inr(f.paid)}</td>
                    <td className={`num font-semibold ${f.due > 0 ? "text-blush-600" : "text-soft"}`}>{inr(f.due)}</td>
                    <td className="num text-soft">{fmtDate(f.dueDate)}</td>
                    <td><FeeStatusBig status={f.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="text-[11px] text-faint">Payments are accepted at the accounts office (Block A). Online payment gateway is planned for a future release.</p>
    </div>
  );
}

function FeeStatusBig({ status }: { status: "PAID" | "PARTIAL" | "PENDING" }) {
  const map = { PAID: "green", PARTIAL: "gold", PENDING: "red" } as const;
  const tones = { green: "bg-emerald-100 text-emerald-800", gold: "bg-gold-50 text-gold-700", red: "bg-blush-50 text-blush-700" };
  return <span className={`rounded-md px-2.5 py-1 font-mono text-[11px] font-bold tracking-wider ${tones[map[status]]}`}>{status}</span>;
}

/* ================= requests ================= */

const REQ_TYPES: RequestType[] = ["LEAVE", "ACADEMIC", "BONAFIDE", "DOCUMENT", "GENERAL"];

function RequestsPage() {
  const { data, loading, error, reload } = useApi(() => api.myRequests(), []);
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<RequestType>("LEAVE");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.createRequest({ type, subject, body });
      push("success", "Request submitted — the admin office has been notified.");
      setOpen(false); setSubject(""); setBody("");
      reload();
    } catch (e) {
      push("error", e instanceof ApiError ? e.message : "Could not submit request.");
    } finally { setBusy(false); }
  };

  if (loading) return <Loading label="Loading requests…" />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;

  return (
    <div className="space-y-6">
      <PageHead title="Requests" sub="Leave, bonafide, documents and more — tracked end to end"
        right={<Button onClick={() => setOpen(true)}><Icon name="plus" size={14} /> New request</Button>} />
      {!data || data.length === 0 ? (
        <Card><Empty icon="send" title="No requests yet" sub="Submit your first request — you'll see live status updates here." action={<Button size="sm" onClick={() => setOpen(true)}><Icon name="plus" size={13} /> Create request</Button>} /></Card>
      ) : (
        <div className="space-y-3.5">
          {data.map((r) => (
            <Card key={r.id} className="anim-rise">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge tone="gray">{r.type}</Badge>
                    <RequestStatusPill status={r.status} />
                  </div>
                  <h3 className="mt-2 font-display text-[14.5px] font-bold text-ink">{r.subject}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-soft">{r.body}</p>
                  {r.note && (
                    <p className="mt-2 rounded-lg border border-pine-100 bg-pine-50 px-3 py-2 text-xs text-pine-800">
                      <span className="font-semibold">Admin office:</span> {r.note}
                    </p>
                  )}
                </div>
                <div className="text-right font-mono text-[10px] uppercase tracking-wider text-faint">
                  <p>raised {timeAgo(r.createdAt)}</p>
                  {r.decidedAt && <p className="mt-1">decided {timeAgo(r.decidedAt)}</p>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New request" sub="Routed to the admin office for review">
        <div className="space-y-4">
          <Field label="Request type">
            <select className="input" value={type} onChange={(e) => setType(e.target.value as RequestType)}>
              {REQ_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Subject"><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Short summary" /></Field>
          <Field label="Details">
            <textarea className="input min-h-24" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Explain what you need…" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button tone="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => void submit()} loading={busy} disabled={!subject.trim() || !body.trim()}><Icon name="send" size={13} /> Submit request</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function RequestStatusPill({ status }: { status: string }) {
  const map: Record<string, "gold" | "green" | "red" | "pine"> = { PENDING: "gold", APPROVED: "green", REJECTED: "red", COMPLETED: "pine" };
  return <Badge tone={map[status] ?? "gray"}>{status}</Badge>;
}

/* ================= notifications ================= */

function NotificationsPage() {
  const { data, loading, error, reload } = useApi(() => api.myNotifications(), []);
  if (loading) return <Loading label="Loading notifications…" />;
  if (error || !data) return <ErrorBox message={error ?? "Unable to load notifications."} onRetry={reload} />;
  return (
    <div className="space-y-6">
      <PageHead title="Notifications" sub="Attendance alerts, results, fees and announcements — generated from real events" />
      <NoticeList items={data} timeAgo={timeAgo} emptySub="You'll be notified about attendance, results, fees and requests."
        onRead={(id) => void api.markRead(id).then(reload)}
        onReadAll={() => void api.markAllRead().then(reload)} />
    </div>
  );
}
