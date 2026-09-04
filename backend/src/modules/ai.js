/* ============================================================================
   AI Academic Coach — POST /api/ai/chat (STUDENT only), GET/PUT /api/ai/config.
   Pipeline: JWT → student identity → Academic Profile Service → deterministic
   analytics → AI context → provider (built-in engine OR external LLM via env
   vars AI_API_KEY / AI_MODEL / AI_BASE_URL) → validated answer.
   The AI never queries the database; provider failure never breaks the ERP.
   ========================================================================= */
const { Router } = require("express");
const env = require("../config/env");
const { db } = require("../config/db");
const { HttpError, requireStudent } = require("../middleware");
const { h } = require("../middleware/errorHandler");
const { buildProfile } = require("./academicProfile");

const router = Router();

/* ---------------- AI-safe context (subset of the profile) ---------------- */
function buildContext(p) {
  return {
    student: { name: p.student.name.split(" ")[0], semester: p.student.semester, program: p.student.program },
    overallPerformance: {
      averagePct: p.summary.averagePct, sgpa: p.summary.sgpa,
      attendancePercentage: p.attendance.percentage, attendanceRisk: p.attendance.risk,
      threshold: p.attendance.threshold,
    },
    courses: p.courses.map((c) => ({
      courseCode: c.courseCode, courseName: c.courseName, credits: c.credits, type: c.type, difficulty: c.difficulty,
      facultyName: c.facultyName,
      attendance: { percentage: c.attendance.percentage, total: c.attendance.total, attended: c.attendance.attended, absent: c.attendance.absent, risk: c.attendance.risk, classesNeededToRecover: c.attendance.classesNeeded },
      performance: { average: c.performance.average, classAverage: c.performance.classAverage, difference: c.performance.difference, trend: c.performance.trend, grade: c.performance.grade, label: c.performance.label },
      assessments: c.assessments.map((a) => ({ type: a.type, pct: a.pct, date: a.date })),
      classStatistics: c.classStats,
      curriculumUnits: (c.curriculum?.units ?? []).map((u) => `Unit ${u.no}: ${u.title} (${u.topics.join(", ")})`),
      feedback: c.feedback,
      priority: c.priority?.priority ?? "LOW",
    })),
    attendanceRisks: p.attendance.courses.filter((c) => c.belowThreshold)
      .map((c) => ({ courseName: c.courseName, percentage: c.percentage, risk: c.risk, classesNeeded: c.classesNeeded })),
    performanceTrends: p.courses.filter((c) => c.performance.trend !== "INSUFFICIENT_DATA" && c.performance.trend !== "STABLE")
      .map((c) => ({ courseName: c.courseName, trend: c.performance.trend, firstPct: c.assessments[0]?.pct ?? null, lastPct: c.assessments[c.assessments.length - 1]?.pct ?? null })),
    upcomingExams: p.upcomingExams,
    assignments: p.assignmentTracker,
    academicPriorities: p.priorities,
  };
}

/* ---------------- deterministic coach (built-in provider) ---------------- */
const NO_DATA = "I don't have enough data in the ERP to determine that yet.";
const block = (rec, why, ev, next) => ["RECOMMENDATION: " + rec, "WHY: " + why, "EVIDENCE:", ...ev.map((e) => "• " + e), "NEXT STEP: " + next].join("\n");
const rel = (d) => `${d >= 0 ? "+" : ""}${d} points vs the class average`;

function findCourse(ctx, m) {
  const byCode = ctx.courses.find((c) => m.includes(c.courseCode.toLowerCase()));
  if (byCode) return byCode;
  let best = null, bestScore = 1;
  for (const c of ctx.courses) {
    const words = c.courseName.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
    const score = words.filter((w) => m.includes(w)).length;
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best;
}

function coach(ctx, message) {
  const m = message.toLowerCase();
  const sources = ["academic_profile"];
  const course = findCourse(ctx, m);

  if (/(attend|bunk|miss|absent|75|threshold)/.test(m) && !course) {
    sources.push("attendance");
    if (ctx.attendanceRisks.length === 0) {
      return { answer: block("Your attendance is safe — no course is below the 75% threshold.",
        `Overall attendance is ${ctx.overallPerformance.attendancePercentage}% and every course meets the configured requirement.`,
        [`Overall attendance: ${ctx.overallPerformance.attendancePercentage}% (${ctx.overallPerformance.attendanceRisk})`],
        "Keep attending regularly; the buffer protects you before exams."), insights: [], sources };
    }
    const worst = [...ctx.attendanceRisks].sort((a, b) => a.percentage - b.percentage)[0];
    return {
      answer: block(`Yes — you are at attendance risk in ${ctx.attendanceRisks.length} course${ctx.attendanceRisks.length === 1 ? "" : "s"}. Prioritize ${worst.courseName}.`,
        "The ERP requires 75% attendance. Missing classes while below the threshold directly jeopardizes exam eligibility.",
        ctx.attendanceRisks.map((r) => `${r.courseName}: ${r.percentage}% (${r.risk}) — attend the next ${r.classesNeeded} classes consecutively to recover`),
        `Attend the next ${worst.classesNeeded} ${worst.courseName} classes without a miss, then re-check this page.`),
      insights: ctx.attendanceRisks.map((r) => `${r.courseName} at ${r.percentage}% — ${r.risk}`), sources,
    };
  }

  if (/(declin|drop|worse|falling|going down)/.test(m)) {
    sources.push("performance_trend");
    const dec = ctx.performanceTrends.filter((t) => t.trend === "DECLINING");
    if (dec.length === 0) {
      const imp = ctx.performanceTrends.filter((t) => t.trend === "IMPROVING");
      return { answer: block("No course shows a declining trend right now.",
        imp.length ? `In fact, ${imp.map((t) => t.courseName).join(", ")} ${imp.length === 1 ? "is" : "are"} improving.` : "All tracked courses are stable.",
        ctx.performanceTrends.map((t) => `${t.courseName}: ${t.trend}${t.firstPct !== null ? ` (${t.firstPct}% → ${t.lastPct}%)` : ""}`),
        "Keep the current study routine; revisit after the next assessment."), insights: imp.map((t) => `${t.courseName} improving`), sources };
    }
    const t = dec[0];
    return { answer: block(`Your performance is declining in ${dec.map((d) => d.courseName).join(", ")}. Start recovery there this week.`,
      "Your earliest assessments in these courses were stronger than your latest ones — the gap is widening, not closing.",
      dec.map((d) => `${d.courseName}: ${d.firstPct}% (first) → ${d.lastPct}% (latest)`),
      `Re-attempt the last ${t.courseName} assessment paper and list the exact topics you lost marks on before moving ahead.`),
      insights: dec.map((d) => `${d.courseName}: ${d.firstPct}% → ${d.lastPct}%`), sources: [...sources, "assessment_performance"] };
  }

  if (/(class|compar|relative|average|percentile|others|peers)/.test(m) && !course) {
    sources.push("class_average");
    const withStats = ctx.courses.filter((c) => c.performance.classAverage !== null && c.performance.average !== null);
    if (withStats.length === 0) return { answer: block(NO_DATA, "Class averages are computed by the backend once assessments exist.", ["No assessment data in the ERP yet"], "Ask again after your faculty publishes marks."), insights: [], sources };
    const above = withStats.filter((c) => (c.performance.difference ?? 0) >= 3);
    const below = withStats.filter((c) => (c.performance.difference ?? 0) <= -3);
    return {
      answer: block(above.length >= below.length
        ? `Overall you are performing at or above the class level — strongest in ${above[0]?.courseName ?? "your courses"}.`
        : `You are currently below the class average in ${below.map((c) => c.courseName).join(", ")} — that is where relative effort pays most.`,
        "Absolute marks can mislead; the ERP compares your average with the live class average per course.",
        withStats.map((c) => `${c.courseName}: you ${c.performance.average}% vs class ${c.performance.classAverage}% (${rel(c.performance.difference ?? 0)})`),
        "Focus first on the largest negative delta versus the class average."),
      insights: below.map((c) => `${c.courseName} ${rel(c.performance.difference ?? 0)}`), sources,
    };
  }

  if (/(strong|best|top|good at)/.test(m)) {
    sources.push("assessment_performance");
    const strong = ctx.courses.filter((c) => c.performance.label === "ABOVE_AVERAGE" || (c.performance.average !== null && c.performance.average >= 75))
      .sort((a, b) => (b.performance.average ?? 0) - (a.performance.average ?? 0));
    if (strong.length === 0) return { answer: block(NO_DATA, "Strong subjects are identified when your average beats the class average or crosses 75%.", ["No qualifying data yet"], "Revisit after the next assessment cycle."), insights: [], sources };
    const s = strong[0];
    return { answer: block(`${s.courseName} is your strongest subject right now.`,
      s.performance.difference !== null ? `You average ${s.performance.average}% there — ${rel(s.performance.difference)} — with a ${s.performance.trend.toLowerCase()} trend.` : `You average ${s.performance.average}% there.`,
      strong.slice(0, 3).map((c) => `${c.courseName}: ${c.performance.average}% (grade ${c.performance.grade ?? "—"}, ${c.performance.trend})`),
      "Protect this strength with light weekly revision instead of dropping the subject entirely."),
      insights: strong.map((c) => `${c.courseName}: ${c.performance.average}%`), sources };
  }

  if (/(attention|weak|struggl|hardest|tough|worst|fail)/.test(m) && !course) {
    sources.push("assessment_performance", "class_average");
    const weak = ctx.academicPriorities.filter((p) => p.priority !== "LOW");
    if (weak.length === 0) return { answer: block("No subject needs urgent attention right now.", "The priority engine found no failing averages, large class-average gaps, declines, or attendance risks.", ["All course priorities are LOW"], "Maintain your current plan and watch the Action Center."), insights: [], sources };
    const w = weak[0];
    return { answer: block(`${w.courseName} needs the most attention (${w.priority} priority).`,
      w.reasons.length ? `The priority engine scored it ${w.score} from objective signals.` : "It combines the weakest signals in your profile.",
      w.reasons, `Block 45 focused minutes daily on ${w.courseName} this week — small consistent reps beat cramming.`),
      insights: weak.map((p) => `${p.courseName}: ${p.priority}`), sources };
  }

  if (/(which|priorit).{0,18}exam|exam.{0,12}(priorit|first)/.test(m)) {
    sources.push("upcoming_exam");
    if (ctx.upcomingExams.length === 0) return { answer: block(NO_DATA, "No upcoming exams are scheduled for your enrolled courses.", ["Exam schedule is empty"], "Check back after the exam cell publishes the schedule."), insights: [], sources };
    const ranked = [...ctx.upcomingExams].sort((a, b) => {
      const pa = ctx.academicPriorities.find((p) => p.courseName === a.courseName)?.score ?? 0;
      const pb = ctx.academicPriorities.find((p) => p.courseName === b.courseName)?.score ?? 0;
      return (a.daysLeft - pa) - (b.daysLeft - pb);
    });
    const e = ranked[0];
    const pr = ctx.academicPriorities.find((p) => p.courseName === e.courseName);
    return { answer: block(`Prioritize ${e.courseName} — ${e.name} in ${e.daysLeft} day${e.daysLeft === 1 ? "" : "s"}.`,
      pr && pr.score > 0 ? `It is close AND academically risky: ${pr.reasons.join("; ").toLowerCase()}.` : "It is the closest exam on your schedule, so preparation time is the scarcest resource for it.",
      [`${e.name} — ${e.date}, ${e.urgency.toLowerCase()}`, ...(e.syllabusUnits.length ? [`Syllabus: ${e.syllabusUnits.join(" · ")}`] : [])],
      "Make a day-by-day revision plan covering the listed units, hardest unit first."),
      insights: [`${e.courseName} exam in ${e.daysLeft}d`], sources };
  }

  if (/(revise|revision|topics|syllabus|units|before.{0,12}exam|prepare)/.test(m)) {
    sources.push("curriculum", "upcoming_exam");
    const target = course
      ?? ctx.courses.find((c) => c.courseName === ctx.upcomingExams[0]?.courseName)
      ?? ctx.courses.find((c) => c.courseName === ctx.academicPriorities[0]?.courseName)
      ?? null;
    if (!target) return { answer: block(NO_DATA, "No courses with curriculum data are available.", ["Curriculum not published"], "Ask your faculty to publish course units."), insights: [], sources };
    if (target.curriculumUnits.length === 0) return { answer: block(NO_DATA, `The ERP has no syllabus units recorded for ${target.courseName}.`, ["Curriculum data missing"], "Ask the faculty to add units; I can then build a revision order."), insights: [], sources };
    const exam = ctx.upcomingExams.find((e) => e.courseName === target.courseName);
    return { answer: block(`Revise ${target.courseName} in unit order — start with the units you scored weakest on.`,
      exam ? `Your ${exam.name} is in ${exam.daysLeft} day${exam.daysLeft === 1 ? "" : "s"} and your current average is ${target.performance.average ?? "—"}% vs class ${target.performance.classAverage ?? "—"}%.`
        : `Your current average is ${target.performance.average ?? "—"}% vs class ${target.performance.classAverage ?? "—"}%.`,
      target.curriculumUnits.slice(0, 5),
      "Do one past-paper question per unit before re-reading theory — retrieval beats rereading."),
      insights: [`${target.courseCode}: ${target.curriculumUnits.length} units mapped`], sources };
  }

  if (course) {
    sources.push("assessment_performance");
    const c = course;
    const evidence = [];
    if (c.performance.average !== null) {
      evidence.push(`Your average: ${c.performance.average}% | class average: ${c.performance.classAverage ?? "—"}% (${c.performance.difference !== null ? rel(c.performance.difference) : "no class data"})`);
      evidence.push(`Trend: ${c.performance.trend}${c.performance.grade ? ` · latest grade ${c.performance.grade}` : ""}`);
    } else evidence.push("No assessments recorded for you yet");
    evidence.push(`Attendance: ${c.attendance.percentage}% (${c.attendance.risk})${c.attendance.classesNeededToRecover > 0 ? ` — attend next ${c.attendance.classesNeededToRecover} classes to recover` : ""}`);
    if (c.classStatistics?.passPercentage !== null) {
      evidence.push(`Class pass rate: ${c.classStatistics.passPercentage}% · your percentile: ${c.classStatistics.percentile ?? "n/a (needs 3+ peers)"}`);
      sources.push("class_average");
    }
    if (c.feedback) {
      evidence.push(`Course feedback: instructional clarity ${c.feedback.avgClarity}/5, course rating ${c.feedback.avgCourse}/5 (${c.feedback.responses} responses)`);
      sources.push("course_feedback");
    }
    const exam = ctx.upcomingExams.find((e) => e.courseName === c.courseName);
    if (exam) { evidence.push(`Upcoming: ${exam.name} in ${exam.daysLeft} days`); sources.push("upcoming_exam"); }
    const weak = (c.performance.difference ?? 0) <= -3 || (c.performance.average ?? 100) < 50 || c.attendance.risk !== "SAFE";
    return { answer: block(weak ? `${c.courseName} deserves structured attention: it is rated ${c.difficulty} difficulty and your signals are below target.` : `${c.courseName} is in good shape — optimize rather than overhaul.`,
      "Diagnosis from your ERP data, not opinion:", evidence,
      c.attendance.classesNeededToRecover > 0 ? `First fix attendance (next ${c.attendance.classesNeededToRecover} classes), then revise the weakest unit.`
        : exam ? `With ${exam.daysLeft} days to the exam, revise the listed units and attempt one timed paper.`
          : "Attempt one past assessment under timed conditions and compare against the class average."),
      insights: [`${c.courseCode}: ${c.performance.average ?? "—"}% vs class ${c.performance.classAverage ?? "—"}%`], sources };
  }

  // Default: weekly plan from priorities.
  const top = ctx.academicPriorities.filter((p) => p.priority !== "LOW").slice(0, 3);
  const nextExam = ctx.upcomingExams[0];
  const overdueA = ctx.assignments.filter((a) => a.status === "OVERDUE");
  const reasons = top.length ? top : ctx.academicPriorities.slice(0, 1);
  return {
    answer: block(
      top.length ? `This week, focus on ${top.map((t) => t.courseName).join(", then ")}.` : "You are broadly on track — spend this week consolidating your strongest subjects and staying ahead of the schedule.",
      top.length ? "The priority engine ranked these from live ERP signals — not guesses." : "No HIGH or MEDIUM priorities were found across performance, attendance, exams and assignments.",
      [
        ...reasons.map((t) => `${t.courseName} (${t.priority}): ${t.reasons[0] ?? "top-ranked course"}`),
        ...(overdueA.length ? [`Overdue assignment: ${overdueA[0].title} (${overdueA[0].courseName})`] : []),
        ...(nextExam ? [`Next exam: ${nextExam.courseName} — ${nextExam.name} in ${nextExam.daysLeft} days`] : []),
        ...(ctx.attendanceRisks.length ? [`Attendance risk: ${ctx.attendanceRisks[0].courseName} at ${ctx.attendanceRisks[0].percentage}%`] : []),
      ],
      top.length ? `Start with 45 minutes on ${top[0].courseName} today — consistency beats intensity.` : "Keep attending all classes and revise one unit per day to build a buffer."),
    insights: reasons.map((t) => `${t.courseName}: ${t.priority}`),
    sources: [...sources, "assessment_performance", ...(ctx.attendanceRisks.length ? ["attendance"] : []), ...(nextExam ? ["upcoming_exam"] : [])],
  };
}

/* ---------------- provider dispatch ---------------- */
async function askProvider(ctx, message, history) {
  if (env.AI_MODE === "http") {
    if (!env.AI_API_KEY) throw Object.assign(new Error("No AI_API_KEY configured."), { aiUnavailable: true });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    let res;
    try {
      res = await fetch(env.AI_BASE_URL.replace(/\/+$/, "") + "/chat/completions", {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.AI_API_KEY}` },
        body: JSON.stringify({
          model: env.AI_MODEL, temperature: 0.3,
          messages: [
            { role: "system", content: "You are the Academic Coach inside a college ERP. Use ONLY the supplied academic context; never invent data. Answer as RECOMMENDATION / WHY / EVIDENCE / NEXT STEP." },
            { role: "system", content: "ACADEMIC CONTEXT:\n" + JSON.stringify(ctx) },
            ...history.slice(-6),
            { role: "user", content: message },
          ],
        }),
      });
    } catch { clearTimeout(timer); throw Object.assign(new Error("Provider unreachable."), { aiUnavailable: true }); }
    clearTimeout(timer);
    if (!res.ok) throw Object.assign(new Error(`Provider HTTP ${res.status}`), { aiUnavailable: true });
    const json = await res.json().catch(() => null);
    const text = json?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) throw Object.assign(new Error("Empty provider response."), { aiUnavailable: true });
    return { answer: text.trim(), insights: [], sources: ["academic_profile"], provider: "http" };
  }
  // Built-in deterministic engine — no keys, no network, cannot fabricate data.
  await new Promise((r) => setTimeout(r, 300));
  return { ...coach(ctx, message), provider: "local" };
}

/* ---------------- routes ---------------- */
router.post("/chat", requireStudent, h(async (req, res) => {
  const message = String(req.body?.message ?? "").trim();
  if (!message) throw new HttpError(422, "Message cannot be empty.");
  const history = Array.isArray(req.body?.history)
    ? req.body.history.filter((t) => t && ["user", "assistant"].includes(t.role) && typeof t.content === "string").slice(-6)
    : [];
  const profile = buildProfile(req.student.id); // AI consumes the profile service only
  const ctx = buildContext(profile);
  try {
    const result = await askProvider(ctx, message, history);
    res.json({ success: true, provider: result.provider, answer: result.answer, insights: result.insights, sources: result.sources });
  } catch (e) {
    if (e.aiUnavailable) return res.json({ success: false, error: "AI_SERVICE_UNAVAILABLE", message: e.message });
    throw e;
  }
}));

router.get("/config", requireStudent, (_req, res) => {
  res.json({ mode: env.AI_MODE, model: env.AI_MODEL, baseUrl: env.AI_BASE_URL, hasKey: !!env.AI_API_KEY });
});

module.exports = router;
