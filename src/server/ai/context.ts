/* ============================================================================
   AI Context Builder
   Transforms the authenticated student's Academic Profile into a compact,
   structured, AI-safe context. The AI layer NEVER sees the raw database and
   NEVER sees other students' personal data — only aggregates (class average,
   highest/lowest, pass %, percentile) derived in the analytics engine.
   ========================================================================= */

import type { AcademicProfile } from "../logic";

export interface AiCourseView {
  courseCode: string;
  courseName: string;
  credits: number;
  type: string;
  difficulty: string;
  facultyName: string;
  attendance: {
    percentage: number; total: number; attended: number; absent: number;
    risk: string; classesNeededToRecover: number;
  };
  performance: {
    average: number | null; classAverage: number | null; difference: number | null;
    trend: string; grade: string | null; label: string;
  };
  classStatistics: {
    highestClassPct: number | null; lowestClassPct: number | null;
    passPercentage: number | null; percentile: number | null;
  };
  assessments: { type: string; pct: number; date: string }[];
  curriculumUnits: string[];
  feedback: { avgClarity: number; avgCourse: number; responses: number } | null;
  priority: { level: string; score: number; reasons: string[] };
}

export interface AiContext {
  student: { name: string; rollNumber: string; program: string; semester: number; section: string };
  overallPerformance: {
    attendancePercentage: number; attendanceRisk: string;
    averagePct: number | null; sgpa: number | null; cgpaNote: string;
    subjectCount: number; passedCount: number;
  };
  courses: AiCourseView[];
  attendanceRisks: { courseName: string; percentage: number; risk: string; classesNeeded: number }[];
  performanceTrends: { courseName: string; trend: string; firstPct: number | null; lastPct: number | null }[];
  upcomingExams: { name: string; courseName: string; date: string; daysLeft: number; urgency: string; syllabusUnits: string[] }[];
  assignments: { title: string; courseName: string; dueDate: string; daysLeft: number; status: string }[];
  academicPriorities: { courseName: string; priority: string; score: number; reasons: string[] }[];
  courseStatistics: { courseName: string; classAverage: number | null; studentAverage: number | null; difference: number | null; passPercentage: number | null; percentile: number | null }[];
  fees: { status: string; due: number } | null;
}

export function buildAiContext(profile: AcademicProfile): AiContext {
  const courses: AiCourseView[] = profile.courses.map((cp) => ({
    courseCode: cp.courseCode,
    courseName: cp.courseName,
    credits: cp.credits,
    type: cp.type,
    difficulty: cp.difficulty,
    facultyName: cp.facultyName,
    attendance: {
      percentage: cp.attendance.percentage,
      total: cp.attendance.total,
      attended: cp.attendance.attended,
      absent: cp.attendance.absent,
      risk: cp.attendance.risk,
      classesNeededToRecover: cp.attendance.classesNeeded,
    },
    performance: {
      average: cp.performance.average,
      classAverage: cp.performance.classAverage,
      difference: cp.performance.difference,
      trend: cp.performance.trend,
      grade: cp.performance.grade,
      label: cp.performance.label,
    },
    classStatistics: {
      highestClassPct: cp.classStats?.highestClassPct ?? null,
      lowestClassPct: cp.classStats?.lowestClassPct ?? null,
      passPercentage: cp.classStats?.passPercentage ?? null,
      percentile: cp.classStats?.percentile ?? null,
    },
    assessments: cp.assessments.map((a) => ({ type: a.type, pct: a.pct, date: a.date })),
    curriculumUnits: cp.curriculum?.units.map((u) => `Unit ${u.no}: ${u.title} (${u.topics.join(", ")})`) ?? [],
    feedback: cp.feedback ? { avgClarity: cp.feedback.avgClarity, avgCourse: cp.feedback.avgCourse, responses: cp.feedback.responses } : null,
    priority: { level: cp.priority?.priority ?? "LOW", score: cp.priority?.score ?? 0, reasons: cp.priority?.reasons ?? [] },
  }));

  return {
    student: {
      name: profile.student.name,
      rollNumber: profile.student.regNo,
      program: profile.student.program,
      semester: profile.student.semester,
      section: profile.student.section,
    },
    overallPerformance: {
      attendancePercentage: profile.attendance.percentage,
      attendanceRisk: profile.attendance.risk,
      averagePct: profile.summary.averagePct,
      sgpa: profile.summary.sgpa,
      cgpaNote: profile.summary.cgpaNote,
      subjectCount: profile.summary.subjectCount,
      passedCount: profile.summary.passedCount,
    },
    courses,
    attendanceRisks: profile.courses
      .filter((c) => c.attendance.belowThreshold)
      .map((c) => ({ courseName: c.courseName, percentage: c.attendance.percentage, risk: c.attendance.risk, classesNeeded: c.attendance.classesNeeded })),
    performanceTrends: profile.courses
      .filter((c) => c.performance.trend !== "INSUFFICIENT_DATA")
      .map((c) => {
        const s = c.assessments.map((a) => a.pct);
        return { courseName: c.courseName, trend: c.performance.trend, firstPct: s[0] ?? null, lastPct: s[s.length - 1] ?? null };
      }),
    upcomingExams: profile.upcomingExams.map((e) => ({
      name: e.name, courseName: e.courseName, date: e.date, daysLeft: e.daysLeft, urgency: e.urgency, syllabusUnits: e.syllabusUnits,
    })),
    assignments: profile.assignmentTracker.map((a) => ({
      title: a.title, courseName: a.courseName, dueDate: a.dueDate, daysLeft: a.daysLeft, status: a.status,
    })),
    academicPriorities: profile.priorities.map((p) => ({
      courseName: p.courseName, priority: p.priority, score: p.score, reasons: p.reasons,
    })),
    courseStatistics: profile.courses.map((c) => ({
      courseName: c.courseName,
      classAverage: c.performance.classAverage,
      studentAverage: c.performance.average,
      difference: c.performance.difference,
      passPercentage: c.classStats?.passPercentage ?? null,
      percentile: c.classStats?.percentile ?? null,
    })),
    fees: profile.fees ? { status: profile.fees.status, due: profile.fees.due } : null,
  };
}
