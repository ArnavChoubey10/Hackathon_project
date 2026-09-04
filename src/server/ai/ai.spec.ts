/* ============================================================================
   Academic Coach — integration & security tests
   Run with: npx vitest run src/server/ai/ai.spec.ts
   ========================================================================= */

import { beforeEach, describe, expect, it } from "vitest";
import { api, ApiError } from "../api";
import { resetDB } from "../db";
import { saveAiConfig } from "./index";

const TOKEN_KEY = "campuscore.token";
const logoutRaw = () => localStorage.removeItem(TOKEN_KEY);

beforeEach(() => {
  resetDB();
  logoutRaw();
  saveAiConfig({ mode: "local", apiKey: "", model: "gpt-4o-mini", baseUrl: "https://api.openai.com/v1" });
});

describe("academic profile security", () => {
  it("rejects unauthenticated access to the profile", async () => {
    await expect(api.myAcademicProfile()).rejects.toBeInstanceOf(ApiError);
  });

  it("returns only the authenticated student's own data", async () => {
    await api.login("aarav@college.edu", "demo123");
    const p = await api.myAcademicProfile();
    expect(p.student.regNo).toBe("23CSE001");
    expect(JSON.stringify(p)).not.toContain("23CSE002"); // another student's roll no never appears
  });

  it("a second student's session sees only their data", async () => {
    await api.login("neha@college.edu", "demo123");
    const p = await api.myAcademicProfile();
    expect(p.student.regNo).toBe("23CSE002");
    expect(JSON.stringify(p)).not.toContain("Aarav");
  });
});

describe("ai chat endpoint", () => {
  it("students can call it and receive a structured, data-backed answer", async () => {
    await api.login("aarav@college.edu", "demo123");
    const res = await api.aiChat("Which subject should I focus on this week?", []);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.answer).toContain("RECOMMENDATION:");
      expect(res.answer).toContain("NEXT STEP:");
      expect(res.sources.length).toBeGreaterThan(0);
      // The coach must not leak other students' personal data.
      expect(res.answer).not.toContain("Neha");
      expect(res.answer).not.toContain("Kabir");
    }
  }, 15_000);

  it("faculty are denied access (student-only feature)", async () => {
    await api.login("faculty@college.edu", "demo123");
    await expect(api.aiChat("hello", [])).rejects.toBeInstanceOf(ApiError);
  });

  it("handles missing academic data honestly instead of crashing", async () => {
    // Admin creates a brand-new student with zero assessment history.
    await api.login("admin@college.edu", "demo123");
    await api.createStudent({
      name: "Test Fresh", regNo: "23CSE099", email: "fresh@college.edu", phone: "99999 00000",
      departmentId: "D1", program: "B.Tech", branch: "Computer Science & Engineering",
      semester: 4, section: "A", batch: "2023–2027", admissionYear: 2023,
    }, true);
    logoutRaw();
    await api.login("fresh@college.edu", "demo123");
    const res = await api.aiChat("Why is my performance declining?", []);
    expect(res.success).toBe(true);
    if (res.success) expect(res.answer.length).toBeGreaterThan(20);
  }, 15_000);

  it("missing AI credentials produce a controlled error, not a crash", async () => {
    await api.login("aarav@college.edu", "demo123");
    saveAiConfig({ mode: "http", apiKey: "", model: "gpt-4o-mini", baseUrl: "https://api.openai.com/v1" });
    const res = await api.aiChat("What should I focus on?", []);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("AI_SERVICE_UNAVAILABLE");
  }, 15_000);

  it("provider failure never breaks the ERP", async () => {
    await api.login("aarav@college.edu", "demo123");
    saveAiConfig({ mode: "http", apiKey: "sk-invalid", model: "x", baseUrl: "http://127.0.0.1:9" });
    const res = await api.aiChat("What should I focus on?", []);
    expect(res.success).toBe(false);
    // ERP still fully functional right after the failure:
    const p = await api.myAcademicProfile();
    expect(p.courses.length).toBeGreaterThan(0);
    saveAiConfig({ mode: "local", apiKey: "", model: "gpt-4o-mini", baseUrl: "https://api.openai.com/v1" });
  }, 20_000);
});

describe("existing ERP modules keep working", () => {
  it("attendance: faculty save → student profile recalculates", async () => {
    await api.login("faculty@college.edu", "demo123");
    const roster = await api.attendanceRoster("C1", "2026-01-05");
    const records = roster.rows.map((r) => ({ studentId: r.studentId, status: "PRESENT" as const }));
    await api.saveAttendance("C1", "2026-01-05", records);
    logoutRaw();
    await api.login("aarav@college.edu", "demo123");
    const p = await api.myAcademicProfile();
    const c1 = p.courses.find((c) => c.courseCode === "CS401")!;
    expect(c1.attendance.total).toBeGreaterThanOrEqual(26);
  }, 20_000);

  it("marks: publish → class average & grade recalculate", async () => {
    await api.login("faculty@college.edu", "demo123");
    const roster = await api.marksRoster("C2", "QUIZ");
    const res = await api.saveMarks("C2", "QUIZ", "2026-01-06",
      roster.rows.map((r, i) => ({ studentId: r.studentId, marks: 10 + (i % 8), maxMarks: 20 })));
    expect(res.classAverage).toBeGreaterThan(0);
    expect(res.classAverage).toBeLessThanOrEqual(100);
  }, 20_000);

  it("results stay graded by backend rules", async () => {
    await api.login("aarav@college.edu", "demo123");
    const r = await api.myResults();
    expect(r.results.length).toBeGreaterThan(0);
    for (const row of r.results) {
      expect(["A+", "A", "B+", "B", "C", "D", "F"]).toContain(row.grade);
    }
  }, 15_000);
});
