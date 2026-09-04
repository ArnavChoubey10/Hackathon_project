/* ============================================================================
   Remote transport — routes api.* calls over HTTP to the Express/SQLite
   backend when one is reachable (VITE_API_URL or localhost:4000 health probe).
   Otherwise the in-browser engine (api.ts) is used — identical contracts,
   so pages are unaware of the switch. Backend down ⇒ ERP keeps working.
   ========================================================================= */

import { ApiError } from "./api";

const TOKEN_KEY = "campuscore.token";

const BASE: string =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") ??
  `${window.location.protocol}//${window.location.hostname}:4000`;

let mode: "local" | "remote" = "local";
export const remoteMode = () => mode;

/** Boot-time probe: is a CampusCore API listening? */
export async function probeRemote(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 800);
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: controller.signal });
    const json = (await res.json()) as { service?: string };
    mode = res.ok && json.service === "campuscore-api" ? "remote" : "local";
  } catch {
    mode = "local";
  } finally {
    clearTimeout(timer);
  }
  return mode === "remote";
}

/* ---------------- request plumbing ---------------- */

async function request(method: string, path: string, body?: unknown): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Cannot reach the CampusCore server. Falling back to the in-browser database.");
  }
  let json: unknown = null;
  try { json = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const msg = (json as { error?: string } | null)?.error ?? `Request failed (HTTP ${res.status}).`;
    throw new ApiError(res.status, msg);
  }
  return json;
}

const qs = (params: Record<string, unknown>) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
};

/* ---------------- method → REST route map (mirrors backend/modules) ----------------
   args are positional, exactly as the frontend calls api.<method>(...). */
type Route = (args: unknown[]) => { m: string; p: string; b?: unknown } | null;

const R: Record<string, Route> = {
  // auth
  login: ([email, password]) => ({ m: "POST", p: "/auth/login", b: { email, password } }),
  logout: () => ({ m: "POST", p: "/auth/logout" }),
  me: () => ({ m: "GET", p: "/auth/me" }),
  updateMyProfile: ([patch]) => ({ m: "PUT", p: "/profile/me", b: patch }),
  // catalog
  students: ([params]) => ({ m: "GET", p: `/students${qs((params ?? {}) as Record<string, unknown>)}` }),
  student: ([id]) => ({ m: "GET", p: `/students/${id}` }),
  createStudent: ([data, autoEnroll]) => ({ m: "POST", p: "/students", b: { ...(data as object), autoEnroll } }),
  updateStudent: ([id, patch]) => ({ m: "PUT", p: `/students/${id}`, b: patch }),
  facultyList: () => ({ m: "GET", p: "/faculty" }),
  createFaculty: ([data, makeLogin]) => ({ m: "POST", p: "/faculty", b: { ...(data as object), makeLogin } }),
  updateFaculty: ([id, patch]) => ({ m: "PUT", p: `/faculty/${id}`, b: patch }),
  departments: () => ({ m: "GET", p: "/departments" }),
  createDepartment: ([data]) => ({ m: "POST", p: "/departments", b: data }),
  deleteDepartment: ([id]) => ({ m: "DELETE", p: `/departments/${id}` }),
  programs: () => ({ m: "GET", p: "/programs" }),
  createProgram: ([data]) => ({ m: "POST", p: "/programs", b: data }),
  deleteProgram: ([id]) => ({ m: "DELETE", p: `/programs/${id}` }),
  courses: () => ({ m: "GET", p: "/courses" }),
  myTeachingCourses: () => ({ m: "GET", p: "/courses/my-teaching" }),
  createCourse: ([data]) => ({ m: "POST", p: "/courses", b: data }),
  updateCourse: ([id, patch]) => ({ m: "PUT", p: `/courses/${id}`, b: patch }),
  // academic
  attendanceRoster: ([courseId, date]) => ({ m: "GET", p: `/attendance/roster${qs({ courseId, date })}` }),
  saveAttendance: ([courseId, date, records]) => ({ m: "POST", p: "/attendance", b: { courseId, date, records } }),
  courseAttendanceSummary: () => ({ m: "GET", p: "/attendance/course-summary" }),
  myAttendance: () => ({ m: "GET", p: "/attendance/me" }),
  marksRoster: ([courseId, type]) => ({ m: "GET", p: `/marks/roster${qs({ courseId, type })}` }),
  saveMarks: ([courseId, type, date, entries]) => ({ m: "POST", p: "/marks", b: { courseId, type, date, rows: entries } }),
  courseMarks: ([courseId]) => ({ m: "GET", p: `/marks/course/${courseId}` }),
  myMarks: () => ({ m: "GET", p: "/marks/me" }),
  myResults: () => ({ m: "GET", p: "/results/me" }),
  courseResults: ([courseId]) => ({ m: "GET", p: `/results/course/${courseId}` }),
  exams: () => ({ m: "GET", p: "/exams" }),
  saveExam: ([data]) => ({ m: "POST", p: "/exams", b: data }),
  deleteExam: ([id]) => ({ m: "DELETE", p: `/exams/${id}` }),
  timetable: () => ({ m: "GET", p: "/timetable" }),
  saveTimetableSlot: ([data]) => ({ m: "POST", p: "/timetable", b: data }),
  deleteTimetableSlot: ([id]) => ({ m: "DELETE", p: `/timetable/${id}` }),
  assignments: () => ({ m: "GET", p: "/assignments" }),
  createAssignment: ([data]) => ({ m: "POST", p: "/assignments", b: data }),
  submitAssignment: ([id]) => ({ m: "POST", p: `/assignments/${id}/submit` }),
  // office
  feesList: () => ({ m: "GET", p: "/fees" }),
  createFee: ([data]) => ({ m: "POST", p: "/fees", b: data }),
  recordPayment: ([feeId, amount]) => ({ m: "POST", p: `/fees/${feeId}/pay`, b: { amount } }),
  myFees: () => ({ m: "GET", p: "/fees/me" }),
  createRequest: ([data]) => ({ m: "POST", p: "/requests", b: data }),
  myRequests: () => ({ m: "GET", p: "/requests/me" }),
  requestsList: () => ({ m: "GET", p: "/requests" }),
  setRequestStatus: ([id, status, note]) => ({ m: "PATCH", p: `/requests/${id}`, b: { status, note } }),
  myNotifications: () => ({ m: "GET", p: "/notifications" }),
  unreadCount: () => ({ m: "GET", p: "/notifications/unread-count" }),
  markRead: ([id]) => ({ m: "POST", p: `/notifications/${id}/read` }),
  markAllRead: () => ({ m: "POST", p: "/notifications/read-all" }),
  broadcast: ([data]) => ({ m: "POST", p: "/notifications/broadcast", b: data }),
  // profile / coach / dashboards / meta
  myAcademicProfile: () => ({ m: "GET", p: "/academic-profile/me" }),
  studentProfile: ([id]) => ({ m: "GET", p: `/academic-profile/${id}` }),
  aiChat: ([message, history]) => ({ m: "POST", p: "/ai/chat", b: { message, history } }),
  aiConfig: () => ({ m: "GET", p: "/ai/config" }),
  adminDashboard: () => ({ m: "GET", p: "/dashboard/admin" }),
  facultyDashboard: () => ({ m: "GET", p: "/dashboard/faculty" }),
  studentDashboard: () => ({ m: "GET", p: "/dashboard/student" }),
  search: ([q]) => ({ m: "GET", p: `/search${qs({ q })}` }),
  resetDemo: () => ({ m: "POST", p: "/admin/reset-demo" }),
};

/** Wrap the local api object: remote when the backend is up, local otherwise. */
export function withRemote<T extends object>(local: T): T {
  return new Proxy(local, {
    get(target, prop: string, receiver) {
      const original = Reflect.get(target, prop, receiver);
      if (typeof original !== "function" || mode !== "remote" || !(prop in R)) return original;
      return async (...args: unknown[]) => {
        const route = R[prop]?.(args);
        if (!route) return (original as (...a: unknown[]) => unknown)(...args);
        // Token lifecycle stays client-side, identical to local mode.
        let out: unknown;
        try {
          out = await request(route.m, route.p, route.b);
        } catch (e) {
          // Backend went away mid-session → heal by falling back to the local engine.
          if (e instanceof ApiError && e.status === 0) {
            mode = "local";
            return (original as (...a: unknown[]) => unknown)(...args);
          }
          throw e;
        }
        if (prop === "login") {
          const o = out as { token?: string };
          if (o?.token) localStorage.setItem(TOKEN_KEY, o.token);
          return { token: o.token, user: (out as { user: unknown }).user };
        }
        if (prop === "logout") { localStorage.removeItem(TOKEN_KEY); return out; }
        return out;
      };
    },
  });
}
