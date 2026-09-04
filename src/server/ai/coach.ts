/* ============================================================================
   Deterministic Academic Coach Engine (built-in provider)
   Explains facts computed by the ERP analytics engine. It can ONLY quote
   values present in the AiContext — fabrication is structurally impossible.
   Every answer follows: RECOMMENDATION → WHY → EVIDENCE → NEXT STEP.
   ========================================================================= */

import type { AiContext, AiCourseView } from "./context";
import type { CoachAnswer, SourceTag } from "./provider";

const NO_DATA = "I don't have enough data in the ERP to determine that yet.";

function block(rec: string, why: string, evidence: string[], next: string): string {
  return [
    `RECOMMENDATION: ${rec}`,
    `WHY: ${why}`,
    `EVIDENCE:`,
    ...evidence.map((e) => `• ${e}`),
    `NEXT STEP: ${next}`,
  ].join("\n");
}

function findCourse(ctx: AiContext, message: string): AiCourseView | null {
  const m = message.toLowerCase();
  // Prefer exact code matches (cs403), then name-token overlap.
  const byCode = ctx.courses.find((c) => m.includes(c.courseCode.toLowerCase()));
  if (byCode) return byCode;
  let best: AiCourseView | null = null;
  let bestScore = 1; // need at least 2 matching significant words
  for (const c of ctx.courses) {
    const words = c.courseName.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
    const score = words.filter((w) => m.includes(w)).length;
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best;
}

const rel = (d: number) => `${d >= 0 ? "+" : ""}${d} points vs the class average`;

export function runDeterministicCoach(ctx: AiContext, message: string): CoachAnswer {
  const m = message.toLowerCase();
  const sources = new Set<SourceTag>(["academic_profile"]);
  const insights: string[] = [];

  const hasPerf = ctx.courses.some((c) => c.performance.average !== null);

  /* ---------- attendance ---------- */
  if (/(attend|bunk|miss|absent|75|threshold)/.test(m) && !findCourse(ctx, m)) {
    if (ctx.attendanceRisks.length === 0) {
      sources.add("attendance");
      return {
        answer: block(
          "Your attendance is safe — no course is below the 75% threshold.",
          `Overall attendance is ${ctx.overallPerformance.attendancePercentage}% and every course meets the configured requirement.`,
          [`Overall attendance: ${ctx.overallPerformance.attendancePercentage}% (${ctx.overallPerformance.attendanceRisk})`],
          "Keep attending regularly; the buffer protects you before exams.",
        ),
        insights: [`Overall attendance ${ctx.overallPerformance.attendancePercentage}% — SAFE`],
        sources: [...sources, "attendance"],
      };
    }
    sources.add("attendance");
    const worst = [...ctx.attendanceRisks].sort((a, b) => a.percentage - b.percentage)[0];
    const lines = ctx.attendanceRisks.map((r) =>
      `${r.courseName}: ${r.percentage}% (${r.risk}) — attend the next ${r.classesNeeded} classes consecutively to recover`);
    return {
      answer: block(
        `Yes — you are at attendance risk in ${ctx.attendanceRisks.length} course${ctx.attendanceRisks.length === 1 ? "" : "s"}. Prioritize ${worst.courseName}.`,
        "The ERP requires 75% attendance. Missing classes while below the threshold directly jeopardizes exam eligibility.",
        lines,
        `Attend the next ${worst.classesNeeded} ${worst.courseName} classes without a miss, then re-check this page.`,
      ),
      insights: ctx.attendanceRisks.map((r) => `${r.courseName} at ${r.percentage}% — ${r.risk}`),
      sources: [...sources],
    };
  }

  /* ---------- declining performance ---------- */
  if (/(declin|drop|worse|falling|going down)/.test(m)) {
    const dec = ctx.performanceTrends.filter((t) => t.trend === "DECLINING");
    sources.add("performance_trend");
    if (dec.length === 0) {
      const imp = ctx.performanceTrends.filter((t) => t.trend === "IMPROVING");
      return {
        answer: block(
          "No course shows a declining trend right now.",
          hasPerf
            ? `Trend analysis compares your first and latest assessments per course (±5% rule). ${imp.length ? `In fact, ${imp.map((t) => t.courseName).join(", ")} ${imp.length === 1 ? "is" : "are"} improving.` : "All tracked courses are stable."}`
            : NO_DATA,
          hasPerf
            ? ctx.performanceTrends.map((t) => `${t.courseName}: ${t.trend}${t.firstPct !== null ? ` (${t.firstPct}% → ${t.lastPct}%)` : ""}`)
            : ["No assessment history recorded yet"],
          hasPerf ? "Keep the current study routine; revisit after the next assessment." : "Once assessments are entered, trends will appear here.",
        ),
        insights: imp.map((t) => `${t.courseName} improving`),
        sources: [...sources],
      };
    }
    const t = dec[0];
    return {
      answer: block(
        `Your performance is declining in ${dec.map((d) => d.courseName).join(", ")}. Start recovery there this week.`,
        "Your earliest assessments in these courses were stronger than your latest ones — the gap is widening, not closing.",
        dec.map((d) => `${d.courseName}: ${d.firstPct}% (first) → ${d.lastPct}% (latest)`),
        `Re-attempt the last ${t.courseName} assessment paper and list the exact topics you lost marks on before moving ahead.`,
      ),
      insights: dec.map((d) => `${d.courseName}: ${d.firstPct}% → ${d.lastPct}%`),
      sources: [...sources, "assessment_performance"],
    };
  }

  /* ---------- comparison with class ---------- */
  if (/(class|compar|relative|average|percentile|others|peers)/.test(m) && !findCourse(ctx, m)) {
    sources.add("class_average");
    const withStats = ctx.courseStatistics.filter((c) => c.classAverage !== null && c.studentAverage !== null);
    if (withStats.length === 0) {
      return { answer: block(NO_DATA, "Class averages are computed by the backend once assessments exist.", ["No assessment data in the ERP yet"], "Ask again after your faculty publishes marks."), insights: [], sources: [...sources] };
    }
    const above = withStats.filter((c) => (c.difference ?? 0) >= 3);
    const below = withStats.filter((c) => (c.difference ?? 0) <= -3);
    const pctLine = withStats.filter((c) => c.percentile !== null)
      .map((c) => `${c.courseName}: ${c.percentile}th percentile`).join("; ");
    return {
      answer: block(
        above.length >= below.length
          ? `Overall you are performing at or above the class level — strongest in ${above[0]?.courseName ?? "your courses"}.`
          : `You are currently below the class average in ${below.map((c) => c.courseName).join(", ")} — that is where relative effort pays most.`,
        "Absolute marks can mislead; the ERP compares your average with the live class average per course.",
        withStats.map((c) => `${c.courseName}: you ${c.studentAverage}% vs class ${c.classAverage}% (${rel(c.difference ?? 0)})`),
        pctLine
          ? `Use your percentiles (${pctLine}) to decide where one extra hour changes your rank most.`
          : "Focus first on the largest negative delta versus the class average.",
      ),
      insights: below.map((c) => `${c.courseName} ${rel(c.difference ?? 0)}`),
      sources: [...sources],
    };
  }

  /* ---------- strongest subjects ---------- */
  if (/(strong|best|top|good at)/.test(m)) {
    const strong = ctx.courses
      .filter((c) => c.performance.label === "ABOVE_AVERAGE" || (c.performance.average !== null && c.performance.average >= 75))
      .sort((a, b) => (b.performance.average ?? 0) - (a.performance.average ?? 0));
    sources.add("assessment_performance");
    if (strong.length === 0) {
      return { answer: block(NO_DATA, "Strong subjects are identified when your average beats the class average or crosses 75%.", ["No qualifying data yet"], "Revisit after the next assessment cycle."), insights: [], sources: [...sources] };
    }
    const s = strong[0];
    return {
      answer: block(
        `${s.courseName} is your strongest subject right now.`,
        s.performance.difference !== null
          ? `You average ${s.performance.average}% there — ${rel(s.performance.difference)} — with a ${s.performance.trend.toLowerCase()} trend.`
          : `You average ${s.performance.average}% there with a ${s.performance.trend.toLowerCase()} trend.`,
        strong.slice(0, 3).map((c) => `${c.courseName}: ${c.performance.average}% (grade ${c.performance.grade ?? "—"}, ${c.performance.trend})`),
        "Protect this strength with light weekly revision instead of dropping the subject entirely.",
      ),
      insights: strong.map((c) => `${c.courseName}: ${c.performance.average}%`),
      sources: [...sources],
    };
  }

  /* ---------- needs attention ---------- */
  if (/(attention|weak|struggl|hardest|tough|worst|fail)/.test(m) && !findCourse(ctx, m)) {
    const weak = ctx.academicPriorities.filter((p) => p.priority !== "LOW");
    sources.add("assessment_performance");
    if (weak.length === 0) {
      return { answer: block("No subject needs urgent attention right now.", "The priority engine found no failing averages, large class-average gaps, declines, or attendance risks.", ["All course priorities are LOW"], "Maintain your current plan and watch the Action Center."), insights: [], sources: [...sources] };
    }
    const w = weak[0];
    return {
      answer: block(
        `${w.courseName} needs the most attention (${w.priority} priority).`,
        w.reasons.length ? `The priority engine scored it ${w.score} from objective signals: ${w.reasons.join("; ").toLowerCase()}.` : "It combines the weakest signals in your profile.",
        w.reasons.map((r) => r),
        `Block 45 focused minutes daily on ${w.courseName} this week — small consistent reps beat cramming.`,
      ),
      insights: weak.map((p) => `${p.courseName}: ${p.priority}`),
      sources: [...sources, "class_average"],
    };
  }

  /* ---------- exam prioritization ---------- */
  if (/(which|priorit).{0,18}exam|exam.{0,12}(priorit|first)/.test(m)) {
    sources.add("upcoming_exam");
    if (ctx.upcomingExams.length === 0) {
      return { answer: block(NO_DATA, "No upcoming exams are scheduled for your enrolled courses.", ["Exam schedule is empty"], "Check back after the exam cell publishes the schedule."), insights: [], sources: [...sources] };
    }
    const ranked = [...ctx.upcomingExams].sort((a, b) => {
      const pa = ctx.academicPriorities.find((p) => p.courseName === a.courseName)?.score ?? 0;
      const pb = ctx.academicPriorities.find((p) => p.courseName === b.courseName)?.score ?? 0;
      return (a.daysLeft - pa) - (b.daysLeft - pb);
    });
    const e = ranked[0];
    const pr = ctx.academicPriorities.find((p) => p.courseName === e.courseName);
    return {
      answer: block(
        `Prioritize ${e.courseName} — ${e.name} in ${e.daysLeft} day${e.daysLeft === 1 ? "" : "s"}.`,
        pr && pr.score > 0
          ? `It is close AND academically risky: ${pr.reasons.join("; ").toLowerCase()}.`
          : "It is the closest exam on your schedule, so preparation time is the scarcest resource for it.",
        [`${e.name} — ${e.date}, ${e.urgency.toLowerCase()}`, ...(e.syllabusUnits.length ? [`Syllabus: ${e.syllabusUnits.join(" · ")}`] : [])],
        "Make a day-by-day revision plan covering the listed units, hardest unit first.",
      ),
      insights: [`${e.courseName} exam in ${e.daysLeft}d`],
      sources: [...sources],
    };
  }

  /* ---------- revision topics / syllabus ---------- */
  if (/(revise|revision|topics|syllabus|units|before.{0,12}exam|prepare)/.test(m)) {
    sources.add("curriculum");
    const target = findCourse(ctx, m)
      ?? (ctx.upcomingExams[0] ? ctx.courses.find((c) => c.courseName === ctx.upcomingExams[0].courseName) : undefined)
      ?? (ctx.academicPriorities[0] ? ctx.courses.find((c) => c.courseName === ctx.academicPriorities[0].courseName) : undefined)
      ?? null;
    if (!target) return { answer: block(NO_DATA, "No courses with curriculum data are available.", ["Curriculum not published"], "Ask your faculty to publish course units."), insights: [], sources: [...sources] };
    const units = target.curriculumUnits;
    if (units.length === 0) {
      return { answer: block(NO_DATA, `The ERP has no syllabus units recorded for ${target.courseName}.`, ["Curriculum data missing"], "Ask the faculty to add units; I can then build a revision order."), insights: [], sources: [...sources] };
    }
    const exam = ctx.upcomingExams.find((e) => e.courseName === target.courseName);
    sources.add("upcoming_exam");
    return {
      answer: block(
        `Revise ${target.courseName} in unit order — start with the units you scored weakest on.`,
        exam
          ? `Your ${exam.name} is in ${exam.daysLeft} day${exam.daysLeft === 1 ? "" : "s"} and your current average is ${target.performance.average ?? "—"}% vs class ${target.performance.classAverage ?? "—"}%.`
          : `Your current average is ${target.performance.average ?? "—"}% vs class ${target.performance.classAverage ?? "—"}%.`,
        units.slice(0, 5),
        "Do one past-paper question per unit before re-reading theory — retrieval beats rereading.",
      ),
      insights: [`${target.courseCode}: ${units.length} units mapped`],
      sources: [...sources],
    };
  }

  /* ---------- course-specific diagnosis ---------- */
  const course = findCourse(ctx, m);
  if (course) {
    const c = course;
    sources.add("assessment_performance");
    const evidence: string[] = [];
    if (c.performance.average !== null) {
      evidence.push(`Your average: ${c.performance.average}% | class average: ${c.performance.classAverage ?? "—"}% (${c.performance.difference !== null ? rel(c.performance.difference) : "no class data"})`);
      evidence.push(`Trend: ${c.performance.trend}${c.performance.grade ? ` · latest grade ${c.performance.grade}` : ""}`);
    } else evidence.push("No assessments recorded for you yet");
    evidence.push(`Attendance: ${c.attendance.percentage}% (${c.attendance.risk})${c.attendance.classesNeededToRecover > 0 ? ` — attend next ${c.attendance.classesNeededToRecover} classes to recover` : ""}`);
    if (c.classStatistics.passPercentage !== null) {
      evidence.push(`Class pass rate: ${c.classStatistics.passPercentage}% · your percentile: ${c.classStatistics.percentile ?? "n/a (needs 3+ peers)"}`);
      sources.add("class_average");
    }
    if (c.feedback) {
      evidence.push(`Course feedback: instructional clarity ${c.feedback.avgClarity}/5, course rating ${c.feedback.avgCourse}/5 (${c.feedback.responses} responses)`);
      sources.add("course_feedback");
    }
    const exam = ctx.upcomingExams.find((e) => e.courseName === c.courseName);
    if (exam) { evidence.push(`Upcoming: ${exam.name} in ${exam.daysLeft} days`); sources.add("upcoming_exam"); }
    const weak = (c.performance.difference ?? 0) <= -3 || (c.performance.average ?? 100) < 50 || c.attendance.risk !== "SAFE";
    return {
      answer: block(
        weak
          ? `${c.courseName} deserves structured attention: it is rated ${c.difficulty} difficulty and your signals are below target.`
          : `${c.courseName} is in good shape — optimize rather than overhaul.`,
        "Diagnosis from your ERP data, not opinion:",
        evidence,
        c.attendance.classesNeededToRecover > 0
          ? `First fix attendance (next ${c.attendance.classesNeededToRecover} classes), then revise the weakest unit.`
          : exam
            ? `With ${exam.daysLeft} days to the exam, revise the listed units and attempt one timed paper.`
            : "Attempt one past assessment under timed conditions and compare against the class average.",
      ),
      insights: [`${c.courseCode}: ${c.performance.average ?? "—"}% vs class ${c.performance.classAverage ?? "—"}%`],
      sources: [...sources],
    };
  }

  /* ---------- weekly plan / focus (default) ---------- */
  const top = ctx.academicPriorities.filter((p) => p.priority !== "LOW").slice(0, 3);
  const nextExam = ctx.upcomingExams[0];
  const overdue = ctx.assignments.filter((a) => a.status === "OVERDUE");
  const reasons = top.length ? top : ctx.academicPriorities.slice(0, 1);
  return {
    answer: block(
      top.length
        ? `This week, focus on ${top.map((t) => t.courseName).join(", then ")}.`
        : "You are broadly on track — spend this week consolidating your strongest subjects and staying ahead of the schedule.",
      top.length
        ? "The priority engine ranked these from live ERP signals — not guesses."
        : "No HIGH or MEDIUM priorities were found across performance, attendance, exams and assignments.",
      [
        ...reasons.flatMap((t) => [`${t.courseName} (${t.priority}): ${t.reasons[0] ?? "top-ranked course"}`]),
        ...(overdue.length ? [`Overdue assignment: ${overdue[0].title} (${overdue[0].courseName})`] : []),
        ...(nextExam ? [`Next exam: ${nextExam.courseName} — ${nextExam.name} in ${nextExam.daysLeft} days`] : []),
        ...(ctx.attendanceRisks.length ? [`Attendance risk: ${ctx.attendanceRisks[0].courseName} at ${ctx.attendanceRisks[0].percentage}%`] : []),
      ].filter(Boolean),
      top.length
        ? `Start with 45 minutes on ${top[0].courseName} today — consistency beats intensity.`
        : "Keep attending all classes and revise one unit per day to build a buffer.",
    ),
    insights: reasons.map((t) => `${t.courseName}: ${t.priority}`),
    sources: [...sources, "assessment_performance", ...(ctx.attendanceRisks.length ? ["attendance" as SourceTag] : []), ...(nextExam ? ["upcoming_exam" as SourceTag] : [])],
  };
}
