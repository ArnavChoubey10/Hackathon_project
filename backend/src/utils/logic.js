/* ============================================================================
   Centralized business rules — identical semantics to the frontend service
   (src/server/logic.ts). Single source of truth for the API.
   ========================================================================= */

const ATTENDANCE_THRESHOLD = 75;
const ATTENDANCE_WARN_AT = 70;
const PASSING_PCT = 40;

const GRADING_SCALE = [
  { min: 90, grade: "A+", points: 10 },
  { min: 80, grade: "A", points: 9 },
  { min: 70, grade: "B+", points: 8 },
  { min: 60, grade: "B", points: 7 },
  { min: 50, grade: "C", points: 6 },
  { min: 40, grade: "D", points: 5 },
  { min: 0, grade: "F", points: 0 },
];

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const pctOf = (marks, max) => (max <= 0 ? 0 : round1((marks / max) * 100));

/** Attendance % / risk / recovery — present ÷ total × 100, 75% rule. */
function calculateAttendance(statuses) {
  const total = statuses.length;
  const attended = statuses.filter((s) => s === "PRESENT").length;
  const absent = total - attended;
  const percentage = total === 0 ? 0 : round1((attended / total) * 100);
  const risk = total === 0 ? "SAFE"
    : percentage >= ATTENDANCE_THRESHOLD ? "SAFE"
      : percentage >= ATTENDANCE_WARN_AT ? "WARNING" : "CRITICAL";
  const belowThreshold = total > 0 && percentage < ATTENDANCE_THRESHOLD;
  const classesNeeded = belowThreshold ? Math.max(0, Math.ceil((0.75 * total - attended) / 0.25)) : 0;
  const canMiss = total === 0 ? 0 : Math.max(0, Math.floor(attended / 0.75 - total));
  return { total, attended, absent, percentage, threshold: ATTENDANCE_THRESHOLD, risk, belowThreshold, classesNeeded, canMiss };
}

function calculateGrade(pct) {
  const p = Math.min(100, Math.max(0, pct));
  const row = GRADING_SCALE.find((g) => p >= g.min) || GRADING_SCALE[GRADING_SCALE.length - 1];
  return { grade: row.grade, points: row.points, passed: p >= PASSING_PCT };
}

function calculateFee(total, paid) {
  const due = Math.max(0, total - paid);
  const status = paid >= total ? "PAID" : paid > 0 ? "PARTIAL" : "PENDING";
  return { due, status };
}

const calculateClassAverage = (pcts) =>
  pcts.length === 0 ? 0 : round1(pcts.reduce((s, v) => s + v, 0) / pcts.length);

/** ±5 first→last rule; needs ≥2 points. */
function calculateTrend(series) {
  if (series.length < 2) return "INSUFFICIENT_DATA";
  const delta = series[series.length - 1] - series[0];
  if (delta >= 5) return "IMPROVING";
  if (delta <= -5) return "DECLINING";
  return "STABLE";
}

function performanceLabel(diff) {
  if (diff >= 3) return "ABOVE_AVERAGE";
  if (diff <= -3) return "BELOW_AVERAGE";
  return "AROUND_AVERAGE";
}

function calculatePassPercentage(pcts) {
  if (pcts.length === 0) return null;
  return round1((100 * pcts.filter((p) => p >= PASSING_PCT).length) / pcts.length);
}

function calculatePercentile(myAvg, peerAvgs) {
  if (peerAvgs.length < 3) return null; // INSUFFICIENT_DATA
  const below = peerAvgs.filter((v) => v < myAvg).length;
  return Math.min(100, Math.round((100 * below) / (peerAvgs.length - 1)));
}

function calculateExamProximity(examDate, today) {
  const ms = new Date(examDate + "T12:00:00").getTime() - new Date(today + "T12:00:00").getTime();
  const daysLeft = Math.max(0, Math.round(ms / 86400000));
  return { daysLeft, urgency: daysLeft <= 3 ? "IMMINENT" : daysLeft <= 7 ? "NEAR" : "SCHEDULED" };
}

/** Transparent priority engine — structured reasons from objective signals. */
function calculateAcademicPriority(i) {
  const reasons = [];
  let score = 0;
  if (i.average !== null && i.average < PASSING_PCT + 5) {
    score += 3; reasons.push(`Average score is ${i.average}%, close to the ${PASSING_PCT}% passing line`);
  }
  if (i.difference !== null && i.difference <= -8) {
    score += 3; reasons.push(`Performance is ${Math.abs(i.difference)} points below the class average`);
  } else if (i.difference !== null && i.difference <= -5) {
    score += 2; reasons.push(`Performance is ${Math.abs(i.difference)} points below the class average`);
  }
  if (i.trend === "DECLINING") { score += 2; reasons.push("Recent assessments are declining"); }
  if (i.attendance.risk === "CRITICAL") {
    score += 3; reasons.push(`Attendance at ${i.attendance.percentage}% is critical (below ${ATTENDANCE_WARN_AT}%)`);
  } else if (i.attendance.risk === "WARNING") {
    score += 2; reasons.push(`Attendance at ${i.attendance.percentage}% is below the ${ATTENDANCE_THRESHOLD}% threshold`);
  }
  if (i.examDaysLeft !== null && i.examDaysLeft <= 7) {
    score += 2; reasons.push(`Upcoming exam in ${i.examDaysLeft} day${i.examDaysLeft === 1 ? "" : "s"}`);
  }
  if (i.assignmentDueDays !== null && i.assignmentDueDays <= 3) {
    score += 1;
    reasons.push(i.assignmentDueDays < 0
      ? `An assignment is ${Math.abs(i.assignmentDueDays)} day${i.assignmentDueDays === -1 ? "" : "s"} overdue`
      : `An assignment is due in ${i.assignmentDueDays} day${i.assignmentDueDays === 1 ? "" : "s"}`);
  }
  if (i.difficulty === "HARD") score += 1;
  if (i.credits >= 4) score += 1;
  if (i.type === "CORE") score += 1;
  return { priority: score >= 5 ? "HIGH" : score >= 3 ? "MEDIUM" : "LOW", score, reasons };
}

module.exports = {
  ATTENDANCE_THRESHOLD, ATTENDANCE_WARN_AT, PASSING_PCT, GRADING_SCALE,
  round1, round2, pctOf,
  calculateAttendance, calculateGrade, calculateFee, calculateClassAverage,
  calculateTrend, performanceLabel, calculatePassPercentage, calculatePercentile,
  calculateExamProximity, calculateAcademicPriority,
};
