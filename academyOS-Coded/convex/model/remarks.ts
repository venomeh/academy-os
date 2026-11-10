import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { attendanceSummary, studentActiveEnrollments, type AttendanceSummary } from "./roster";

/**
 * AI progress remarks — §9. No LLM call yet (see convex/remarks.ts's
 * `draftForPeriod`): `draftText`/`draftUrduText` below compose the remark
 * deterministically from the data pack. Grounding is structural, not
 * prompt-based — every sentence quotes a number that's actually in the
 * pack, so there is nothing to invent. When a real Claude call is wired up
 * later, it replaces `draftText`/`draftUrduText` only — `buildDataPack` and
 * every caller stay exactly as they are.
 */

export interface PublishedTest {
  subject: string;
  date: string;
  obtained: number;
  maxMarks: number;
  pct: number;
  batchAverage: number;
}

export interface RemarkDataPack {
  attendance: AttendanceSummary;
  publishedTests: PublishedTest[];
  currentMonthAvgPct: number | null;
  previousMonthAvgPct: number | null;
  trend: "improved" | "declined" | "stable" | "";
  joinedMidMonth: boolean;
  lowData: boolean;
  lowDataReason: string | null;
}

function previousPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function publishedTestsForPeriod(ctx: QueryCtx | MutationCtx, studentId: Id<"students">, period: string): Promise<PublishedTest[]> {
  const enrollments = await studentActiveEnrollments(ctx, studentId, `${period}-15`);
  const tests: PublishedTest[] = [];
  for (const { batch } of enrollments) {
    const assessments = await ctx.db
      .query("assessments")
      .withIndex("by_batch", (q) => q.eq("batchId", batch._id))
      .collect();
    for (const assessment of assessments) {
      if (!assessment.published || !assessment.date.startsWith(period)) continue;
      const score = await ctx.db
        .query("scores")
        .withIndex("by_assessment_and_student", (q) => q.eq("assessmentId", assessment._id).eq("studentId", studentId))
        .unique();
      if (!score || score.absent || score.obtained === undefined) continue;
      const subject = await ctx.db.get(assessment.subjectId);
      const peers = await ctx.db
        .query("scores")
        .withIndex("by_assessment", (q) => q.eq("assessmentId", assessment._id))
        .collect();
      const scoredPeers = peers.filter((p) => !p.absent && p.obtained !== undefined);
      const batchAverage = scoredPeers.length ? Math.round(scoredPeers.reduce((s, p) => s + (p.obtained ?? 0), 0) / scoredPeers.length) : 0;
      tests.push({
        subject: subject?.name ?? "Subject",
        date: assessment.date,
        obtained: score.obtained,
        maxMarks: assessment.maxMarks,
        pct: Math.round((score.obtained / assessment.maxMarks) * 100),
        batchAverage,
      });
    }
  }
  return tests.sort((a, b) => (a.date < b.date ? 1 : -1));
}

function averagePct(tests: PublishedTest[]): number | null {
  if (tests.length === 0) return null;
  return Math.round(tests.reduce((s, t) => s + t.pct, 0) / tests.length);
}

export async function buildDataPack(ctx: QueryCtx | MutationCtx, studentId: Id<"students">, period: string): Promise<RemarkDataPack> {
  const student = await ctx.db.get(studentId);
  if (!student) throw new Error("Student not found.");

  const attendance = await attendanceSummary(ctx, studentId, period);
  const publishedTests = await publishedTestsForPeriod(ctx, studentId, period);
  const currentMonthAvgPct = averagePct(publishedTests);
  const previousMonthAvgPct = averagePct(await publishedTestsForPeriod(ctx, studentId, previousPeriod(period)));

  let trend: RemarkDataPack["trend"] = "";
  if (currentMonthAvgPct !== null && previousMonthAvgPct !== null) {
    if (currentMonthAvgPct > previousMonthAvgPct + 1) trend = "improved";
    else if (currentMonthAvgPct < previousMonthAvgPct - 1) trend = "declined";
    else trend = "stable";
  }

  const joinedMidMonth = student.joinedAt.startsWith(period) && student.joinedAt.slice(8, 10) !== "01";

  const reasons: string[] = [];
  if (publishedTests.length === 0) reasons.push("no published tests this month");
  if (student.joinedAt > `${period}-01`) reasons.push("joined partway through the month");
  if (attendance.totalDays === 0) reasons.push("no attendance recorded this month");

  return {
    attendance,
    publishedTests,
    currentMonthAvgPct,
    previousMonthAvgPct,
    trend,
    joinedMidMonth,
    lowData: reasons.length > 0,
    lowDataReason: reasons.length ? reasons.join("; ") : null,
  };
}

export interface DraftResult {
  text: string;
  source: "template" | "ai";
}

/**
 * A low-data stub is deliberately terse and names its own reason — this is
 * the only signal `remarks.ts`'s `approve` mutation has to block someone
 * approving it unedited (the reference backend had a real incident where a
 * UI default-value stub got approved as if it were a genuine remark).
 */
export function lowDataStub(studentName: string, reason: string): DraftResult {
  return { text: `${studentName} — insufficient data this month (${reason}). A full remark will be possible once more data is in.`, source: "template" };
}

export function draftText(dataPack: RemarkDataPack, studentName: string): DraftResult {
  if (dataPack.lowData) return lowDataStub(studentName, dataPack.lowDataReason ?? "insufficient data");

  const { attendance, publishedTests, trend } = dataPack;
  const sentences: string[] = [];

  const attended = attendance.presentDays + attendance.lateDays;
  sentences.push(`${studentName} attended ${attended} of ${attendance.totalDays} sessions (${attendance.attendancePct}%) this month.`);

  const primary = publishedTests[0];
  if (primary) {
    const delta = primary.obtained - primary.batchAverage;
    const deltaText = delta === 0 ? `level with the batch average of ${primary.batchAverage}` : `${Math.abs(delta)} point${Math.abs(delta) === 1 ? "" : "s"} ${delta > 0 ? "above" : "below"} the batch average of ${primary.batchAverage}`;
    sentences.push(`${studentName} scored ${primary.obtained} out of ${primary.maxMarks} in the ${primary.subject} test, ${deltaText}.`);
    if (publishedTests.length > 1) {
      sentences.push(`${publishedTests.length - 1} other test${publishedTests.length - 1 === 1 ? "" : "s"} were also published this month.`);
    }
  }

  if (trend === "improved") sentences.push("That is an improvement on last month.");
  else if (trend === "declined") sentences.push("That is down from last month.");
  else if (trend === "stable") sentences.push("Marks have held steady month to month.");

  return { text: sentences.join(" "), source: "template" };
}

export function draftUrduText(dataPack: RemarkDataPack, studentName: string): DraftResult {
  if (dataPack.lowData) {
    return { text: `${studentName} — اس مہینے کافی معلومات دستیاب نہیں ہیں (${dataPack.lowDataReason ?? "ناکافی ڈیٹا"})۔ اگلے مہینے مکمل رپورٹ دی جائے گی۔`, source: "template" };
  }

  const { attendance, publishedTests, trend } = dataPack;
  const sentences: string[] = [];
  const attended = attendance.presentDays + attendance.lateDays;
  sentences.push(`${studentName} نے اس مہینے ${attendance.totalDays} میں سے ${attended} کلاسز میں شرکت کی (${attendance.attendancePct}%)۔`);

  const primary = publishedTests[0];
  if (primary) {
    const delta = primary.obtained - primary.batchAverage;
    const deltaText = delta === 0 ? `جو بیچ کی اوسط ${primary.batchAverage} کے برابر ہے` : `جو بیچ کی اوسط ${primary.batchAverage} سے ${Math.abs(delta)} نمبر ${delta > 0 ? "زیادہ" : "کم"} ہے`;
    sentences.push(`${studentName} نے ${primary.subject} کے ٹیسٹ میں ${primary.maxMarks} میں سے ${primary.obtained} نمبر لیے، ${deltaText}۔`);
  }

  if (trend === "improved") sentences.push("پچھلے مہینے سے بہتری آئی ہے۔");
  else if (trend === "declined") sentences.push("پچھلے مہینے کے مقابلے میں کمی آئی ہے۔");
  else if (trend === "stable") sentences.push("نمبر مہینے بہ مہینے مستحکم رہے ہیں۔");

  return { text: sentences.join(" "), source: "template" };
}

/** Guards `remarks.approve` against the low-data-stub-approved-as-real incident. */
export function looksLikeUnfixedStub(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length < 50 || trimmed.includes("insufficient data this month") || trimmed.includes("کافی معلومات دستیاب نہیں");
}
