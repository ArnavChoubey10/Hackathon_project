import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../server/api";
import { ASSESSMENT_MAX_DEFAULTS } from "../server/logic";
import { todayISO, type AssessmentType, type AttendanceRisk, type AttendanceStatus } from "../server/db";
import { useToast } from "../state";
import { Badge, Button, Card, CardHead, Empty, ErrorBox, Icon, RiskBadge, Seg, SkeletonRows } from "../ui";

interface CourseOpt { id: string; code: string; name: string; }

/* ================= Attendance Marker ================= */

export function AttendanceMarker({ courses, allowCourseSelect = true }: { courses: CourseOpt[]; allowCourseSelect?: boolean }) {
  const { push } = useToast();
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");
  const [date, setDate] = useState(todayISO());
  const [rows, setRows] = useState<{ studentId: string; name: string; regNo: string; section: string; status: AttendanceStatus | null; running: { percentage: number; risk: AttendanceRisk; total: number } }[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!courseId && courses.length) setCourseId(courses[0].id); }, [courses, courseId]);

  const load = async () => {
    if (!courseId) return;
    setLoading(true); setError(null);
    try {
      const r = await api.attendanceRoster(courseId, date);
      setRows(r.rows.map((x) => ({ studentId: x.studentId, name: x.name, regNo: x.regNo, section: x.section, status: x.status as AttendanceStatus | null, running: { percentage: x.running.percentage, risk: x.running.risk, total: x.running.total } })));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Unable to load roster.");
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); /* on course/date change */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, date]);

  const setStatus = (sid: string, status: AttendanceStatus) =>
    setRows((rs) => rs ? rs.map((r) => (r.studentId === sid ? { ...r, status } : r)) : rs);

  const pending = rows?.filter((r) => r.status === null).length ?? 0;
  const presentCount = rows?.filter((r) => r.status === "PRESENT").length ?? 0;

  const save = async () => {
    if (!rows) return;
    if (pending > 0) { push("error", `Mark ${pending} student${pending === 1 ? "" : "s"} before saving.`); return; }
    setSaving(true);
    try {
      await api.saveAttendance(courseId, date, rows.map((r) => ({ studentId: r.studentId, status: r.status! })));
      push("success", `Attendance saved — ${rows.length} records. Students below threshold were notified.`);
      void load();
    } catch (e) {
      push("error", e instanceof ApiError ? e.message : "Could not save attendance.");
    } finally { setSaving(false); }
  };

  const course = courses.find((c) => c.id === courseId);

  return (
    <Card pad={false}>
      <div className="p-5 pb-4">
        <CardHead icon="check" title="Mark attendance" sub="Present / absent per student — saved to the shared database" />
        <div className="flex flex-wrap items-end gap-3">
          {allowCourseSelect && (
            <label className="block min-w-52 flex-1">
              <span className="mb-1.5 block text-xs font-semibold text-soft">Course</span>
              <select className="input" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
            </label>
          )}
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-soft">Class date</span>
            <input type="date" className="input" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
          </label>
          {rows && rows.length > 0 && (
            <Button tone="subtle" size="sm" onClick={() => setRows((rs) => rs ? rs.map((r) => ({ ...r, status: "PRESENT" as AttendanceStatus })) : rs)}>
              <Icon name="check" size={13} /> All present
            </Button>
          )}
        </div>
      </div>

      <div className="border-t border-line">
        {loading && <div className="p-4"><SkeletonRows rows={5} /></div>}
        {!loading && error && <div className="p-4"><ErrorBox message={error} onRetry={() => void load()} /></div>}
        {!loading && !error && rows && rows.length === 0 && <Empty icon="users" title="No students enrolled" sub="Enroll students in this course from the admin workspace." />}
        {!loading && !error && rows && rows.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr><th>Roll no</th><th>Student</th><th>Section</th><th>Running %</th><th className="text-right">Status</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.studentId}>
                      <td className="num text-faint">{r.regNo}</td>
                      <td className="font-medium text-ink">{r.name}</td>
                      <td><Badge tone="gray">{r.section}</Badge></td>
                      <td>
                        <span className="flex items-center gap-2">
                          <span className="num text-[13px] font-semibold">{r.running.percentage}%</span>
                          {r.running.total > 0 && <RiskBadge risk={r.running.risk} />}
                        </span>
                      </td>
                      <td className="text-right">
                        <Seg<AttendanceStatus>
                          value={r.status}
                          onChange={(v) => setStatus(r.studentId, v)}
                          options={[{ value: "PRESENT", label: "Present", tone: "green" }, { value: "ABSENT", label: "Absent", tone: "red" }]}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
              <p className="text-xs text-soft">
                <span className="num font-semibold text-emerald-700">{presentCount}</span> present ·
                <span className="num font-semibold text-blush-600"> {(rows?.length ?? 0) - presentCount - pending}</span> absent
                {pending > 0 && <span className="ml-2 text-gold-600 font-medium">· {pending} unmarked</span>}
                {course && <span className="ml-2 text-faint">· {course.code}, {date}</span>}
              </p>
              <Button onClick={() => void save()} loading={saving} disabled={pending > 0}>
                <Icon name="check" size={14} /> Save attendance
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

/* ================= Marks Entry ================= */

const TYPES: AssessmentType[] = ["CAT1", "CAT2", "QUIZ", "ASSIGNMENT", "LAB", "FAT", "PROJECT"];

export function MarksEntry({ courses }: { courses: CourseOpt[] }) {
  const { push } = useToast();
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");
  const [type, setType] = useState<AssessmentType>("CAT1");
  const [date, setDate] = useState(todayISO());
  const [maxMarks, setMaxMarks] = useState(ASSESSMENT_MAX_DEFAULTS.CAT1);
  const [rows, setRows] = useState<{ studentId: string; name: string; regNo: string; marks: string; hasPrev: boolean }[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastAvg, setLastAvg] = useState<number | null>(null);

  useEffect(() => { if (!courseId && courses.length) setCourseId(courses[0].id); }, [courses, courseId]);

  const load = async () => {
    if (!courseId) return;
    setLoading(true); setError(null); setLastAvg(null);
    try {
      const r = await api.marksRoster(courseId, type);
      setRows(r.rows.map((x) => ({ studentId: x.studentId, name: x.name, regNo: x.regNo, marks: x.marks !== null ? String(x.marks) : "", hasPrev: x.marks !== null })));
      if (r.rows.length) setMaxMarks(r.rows[0].maxMarks);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Unable to load students.");
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, type]);

  const changeType = (t: AssessmentType) => { setType(t); setMaxMarks(ASSESSMENT_MAX_DEFAULTS[t]); };

  const invalid = useMemo(() => {
    if (!rows) return [];
    return rows.filter((r) => {
      if (r.marks.trim() === "") return true;
      const n = Number(r.marks);
      return Number.isNaN(n) || n < 0 || n > maxMarks;
    }).map((r) => r.studentId);
  }, [rows, maxMarks]);

  const save = async () => {
    if (!rows) return;
    if (invalid.length > 0) { push("error", "Every student needs valid marks between 0 and the maximum."); return; }
    setSaving(true);
    try {
      const res = await api.saveMarks(courseId, type, date, rows.map((r) => ({ studentId: r.studentId, marks: Number(r.marks), maxMarks })));
      setLastAvg(res.classAverage);
      push("success", `Marks saved for ${rows.length} students. Class average: ${res.classAverage}%.`);
      void load();
    } catch (e) {
      push("error", e instanceof ApiError ? e.message : "Could not save marks.");
    } finally { setSaving(false); }
  };

  return (
    <Card pad={false}>
      <div className="p-5 pb-4">
        <CardHead icon="edit" title="Enter marks" sub="Validated 0–max per student · duplicates update the same assessment" />
        <div className="flex flex-wrap items-end gap-3">
          <label className="block min-w-52 flex-1">
            <span className="mb-1.5 block text-xs font-semibold text-soft">Course</span>
            <select className="input" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-soft">Assessment</span>
            <select className="input" value={type} onChange={(e) => changeType(e.target.value as AssessmentType)}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-soft">Max marks</span>
            <input type="number" className="input num w-24" value={maxMarks} min={1} onChange={(e) => setMaxMarks(Number(e.target.value))} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-soft">Date</span>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="border-t border-line">
        {loading && <div className="p-4"><SkeletonRows rows={5} /></div>}
        {!loading && error && <div className="p-4"><ErrorBox message={error} onRetry={() => void load()} /></div>}
        {!loading && !error && rows && rows.length === 0 && <Empty icon="users" title="No students enrolled" sub="Enroll students in this course from the admin workspace." />}
        {!loading && !error && rows && rows.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr><th>Roll no</th><th>Student</th><th>Previous</th><th className="text-right">Marks / {maxMarks}</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const bad = invalid.includes(r.studentId);
                    return (
                      <tr key={r.studentId}>
                        <td className="num text-faint">{r.regNo}</td>
                        <td className="font-medium text-ink">{r.name}</td>
                        <td>{r.hasPrev ? <Badge tone="pine">editing</Badge> : <Badge tone="gray">new</Badge>}</td>
                        <td className="text-right">
                          <input
                            type="number" min={0} max={maxMarks}
                            value={r.marks}
                            onChange={(e) => setRows((rs) => rs ? rs.map((x) => x.studentId === r.studentId ? { ...x, marks: e.target.value } : x) : rs)}
                            className={`input num ml-auto w-24 text-right ${bad ? "input-err" : ""}`}
                            placeholder="—"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
              <p className="text-xs text-soft">
                {invalid.length > 0
                  ? <span className="font-medium text-blush-600">{invalid.length} invalid entr{invalid.length === 1 ? "y" : "ies"} — marks must be 0–{maxMarks}.</span>
                  : lastAvg !== null
                    ? <span>Class average recalculated from live data: <span className="num font-bold text-pine-700">{lastAvg}%</span></span>
                    : "Grades and class averages are computed by the backend on save."}
              </p>
              <Button onClick={() => void save()} loading={saving} disabled={invalid.length > 0}>
                <Icon name="check" size={14} /> Publish marks
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

/* ================= Timetable grid ================= */

export interface SlotView { day: number; start: string; end: string; room: string; courseCode: string; courseName: string; facultyName: string; }

const DAY_SHORT = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

export function TimetableGrid({ slots }: { slots: SlotView[] }) {
  const days = [1, 2, 3, 4, 5];
  const todayDow = new Date().getDay();
  return (
    <div className="grid gap-3 md:grid-cols-5">
      {days.map((d) => {
        const daySlots = slots.filter((s) => s.day === d).sort((a, b) => a.start.localeCompare(b.start));
        const isToday = d === todayDow;
        return (
          <div key={d} className={`card overflow-hidden p-0 transition-shadow ${isToday ? "ring-2 ring-pine-400/70" : ""}`}>
            <div className={`flex items-center justify-between px-3.5 py-2.5 ${isToday ? "bg-pine-600 text-white" : "bg-[#f7faf7] text-soft"}`}>
              <span className="font-display text-[13px] font-semibold">{DAY_SHORT[d]}</span>
              {isToday && <span className="rounded bg-white/20 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest">today</span>}
            </div>
            <div className="space-y-2 p-2.5">
              {daySlots.length === 0 && <p className="px-1 py-4 text-center text-[11px] text-faint">No classes</p>}
              {daySlots.map((s, i) => (
                <div key={i} className="anim-rise rounded-lg border border-line bg-white p-2.5 transition-transform hover:-translate-y-0.5 hover:shadow-lift" style={{ animationDelay: `${i * 0.05}s` }}>
                  <p className="num text-[10px] font-semibold text-pine-600">{s.start} – {s.end}</p>
                  <p className="mt-0.5 font-display text-[13px] font-semibold leading-tight text-ink">{s.courseCode}</p>
                  <p className="truncate text-[11px] text-soft">{s.courseName}</p>
                  <p className="mt-1 flex items-center gap-1 text-[10px] text-faint"><Icon name="user" size={10} />{s.facultyName}</p>
                  <p className="flex items-center gap-1 text-[10px] text-faint"><Icon name="dashboard" size={10} />{s.room}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ================= notification list (shared) ================= */

export interface NoticeView { id: string; title: string; body: string; kind: string; read: boolean; createdAt: string; }

export function NoticeList({ items, onRead, onReadAll, emptySub, timeAgo }: {
  items: NoticeView[]; onRead?: (id: string) => void; onReadAll?: () => void; emptySub: string;
  timeAgo: (s: string) => string;
}) {
  const [filter, setFilter] = useState<"ALL" | "UNREAD">("ALL");
  const shown = filter === "UNREAD" ? items.filter((n) => !n.read) : items;
  const unread = items.filter((n) => !n.read).length;
  const kindTone: Record<string, string> = { INFO: "pine", SUCCESS: "green", WARNING: "gold", DANGER: "red" };
  return (
    <Card pad={false}>
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <div className="flex items-center gap-2">
          <Seg<"ALL" | "UNREAD"> value={filter} onChange={setFilter}
            options={[{ value: "ALL", label: `All (${items.length})` }, { value: "UNREAD", label: `Unread (${unread})` }]} />
        </div>
        {onReadAll && unread > 0 && <Button tone="ghost" size="sm" onClick={onReadAll}><Icon name="check" size={12} /> Mark all read</Button>}
      </div>
      {shown.length === 0 ? (
        <Empty icon="bell" title={filter === "UNREAD" ? "You're all caught up" : "No notifications yet"} sub={emptySub} />
      ) : (
        <ul className="divide-y divide-[#ecf1ec]">
          {shown.map((n) => (
            <li key={n.id}>
              <button onClick={() => onRead?.(n.id)} disabled={n.read}
                className={`flex w-full items-start gap-3.5 px-5 py-4 text-left transition-colors ${n.read ? "" : "bg-pine-50/50 hover:bg-pine-50"}`}>
                <span className={`mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${n.kind === "DANGER" ? "bg-blush-50 text-blush-600" : n.kind === "WARNING" ? "bg-gold-50 text-gold-600" : n.kind === "SUCCESS" ? "bg-emerald-100 text-emerald-700" : "bg-pine-50 text-pine-600"}`}>
                  <Icon name={n.kind === "DANGER" ? "alert" : n.kind === "WARNING" ? "clock" : n.kind === "SUCCESS" ? "check" : "info"} size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className={`truncate text-[13.5px] ${n.read ? "font-medium text-soft" : "font-semibold text-ink"}`}>{n.title}</span>
                    {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-pine-500" />}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-soft">{n.body}</span>
                  <span className="mt-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-faint">
                    <Badge tone={(kindTone[n.kind] ?? "gray") as "pine"}>{n.kind}</Badge> {timeAgo(n.createdAt)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

