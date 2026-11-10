import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { ActionCtx, QueryCtx, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireAdmin, requireAdminOrTeacher, requireGuardian, requireTeacher, ownedStudentOrNull, teacherStudentIds, isTeacherOfBatch } from "./lib/authz";
import { batchName, studentActiveEnrollments } from "./model/roster";
import { buildDataPack, draftText, draftUrduText, lowDataStub, looksLikeUnfixedStub, type RemarkDataPack } from "./model/remarks";
import { DEFAULT_TONE, GROUNDING_RULES, GROUNDING_RULES_FORCED, buildUserPayload, isReasoningDump, isUsableRemark, parseDraftResponse, userPrompt } from "./model/remarksAi";
import { aiConfigured, chatCompletion, remarksModel } from "./lib/ai";
import { sendEmail, emailShell } from "./model/email";

/**
 * AI progress remarks review/publish — §9. Approving a remark is what makes
 * it parent-visible (`convex/assessments.ts`-style guardian queries filter
 * on `status: "approved"` the same way `getPublishedResults` filters on
 * `published: true`); `publishForBatch` below is a *separate*, later,
 * batch-level step that only sends one consolidated notification email —
 * it is not required for visibility, exactly like the reference backend.
 */

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

/**
 * The numbers a draft was grounded in, in the shape the review queues show
 * beside the text — so a teacher can check every figure against its source
 * before approving, rather than trusting the model.
 */
function factsFrom(dataPack: unknown) {
  const p = (dataPack ?? {}) as Partial<RemarkDataPack>;
  const att = p.attendance;
  return {
    attendancePct: att?.attendancePct ?? null,
    presentDays: att ? att.presentDays + att.lateDays : null,
    totalDays: att?.totalDays ?? null,
    tests: (p.publishedTests ?? []).map((t) => ({ subject: t.subject, pct: t.pct, obtained: t.obtained, maxMarks: t.maxMarks, batchAveragePct: t.maxMarks ? Math.round((t.batchAverage / t.maxMarks) * 100) : null })),
    avgPct: p.currentMonthAvgPct ?? null,
    previousAvgPct: p.previousMonthAvgPct ?? null,
    trend: p.trend || null,
  };
}

export const getTeacherQueue = query({
  args: {},
  handler: async (ctx) => {
    const teacher = await requireTeacher(ctx);
    const studentIds = await teacherStudentIds(ctx, teacher._id);
    const all = await ctx.db.query("remarks").collect();
    const mine = all.filter((r) => studentIds.has(r.studentId) && (r.status === "draft" || r.status === "low_data"));
    return Promise.all(
      mine.map(async (r) => {
        const student = await ctx.db.get(r.studentId);
        return { id: r._id, studentId: r.studentId, student: student?.name ?? "—", period: r.period, status: r.status, language: r.language, source: r.source ?? "template", text: r.draftText ?? "", lowDataReason: r.lowDataReason ?? null, facts: factsFrom(r.dataPack) };
      })
    );
  },
});

export const getAllForAdmin = query({
  args: { period: v.optional(v.string()) },
  handler: async (ctx, { period }) => {
    await requireAdmin(ctx);
    const target = period ?? currentPeriod();
    const all = await ctx.db.query("remarks").collect();
    const rows = all.filter((r) => r.period === target);
    return Promise.all(
      rows.map(async (r) => {
        const student = await ctx.db.get(r.studentId);
        const enrollments = student ? await studentActiveEnrollments(ctx, student._id) : [];
        return {
          id: r._id,
          studentId: r.studentId,
          student: student?.name ?? "—",
          batches: enrollments.map((e) => e.batch.name),
          status: r.status,
          language: r.language,
          source: r.source ?? "template",
          text: r.finalText ?? r.draftText ?? "",
          lowDataReason: r.lowDataReason ?? null,
          approvedAt: r.approvedAt ?? null,
          facts: factsFrom(r.dataPack),
        };
      })
    );
  },
});

export const getStats = query({
  args: { period: v.optional(v.string()) },
  handler: async (ctx, { period }) => {
    await requireAdmin(ctx);
    const target = period ?? currentPeriod();
    const all = await ctx.db.query("remarks").collect();
    const rows = all.filter((r) => r.period === target);
    return {
      total: rows.length,
      draft: rows.filter((r) => r.status === "draft").length,
      approved: rows.filter((r) => r.status === "approved").length,
      rejected: rows.filter((r) => r.status === "rejected").length,
      lowData: rows.filter((r) => r.status === "low_data").length,
    };
  },
});

export const getApprovedForStudent = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    const { guardian } = await requireGuardian(ctx);
    const student = await ownedStudentOrNull(ctx, guardian._id, studentId);
    if (!student) return [];
    const rows = await ctx.db
      .query("remarks")
      .withIndex("by_student", (q) => q.eq("studentId", studentId))
      .collect();
    return rows
      .filter((r) => r.status === "approved")
      .sort((a, b) => (a.period < b.period ? 1 : -1))
      .map((r) => ({ period: r.period, text: r.finalText ?? r.draftText ?? "", language: r.language }));
  },
});

async function requireRemarkAccess(ctx: QueryCtx | MutationCtx, remarkId: Id<"remarks">) {
  const profile = await requireAdminOrTeacher(ctx);
  const remark = await ctx.db.get(remarkId);
  if (!remark) throw new Error("Remark not found.");
  if (profile.role === "teacher") {
    const ids = await teacherStudentIds(ctx, profile._id);
    if (!ids.has(remark.studentId)) throw new Error("Not your student.");
  }
  return { profile, remark };
}

export const approve = mutation({
  args: { remarkId: v.id("remarks") },
  handler: async (ctx, { remarkId }) => {
    const { profile, remark } = await requireRemarkAccess(ctx, remarkId);
    const text = remark.draftText ?? "";
    if (remark.status === "low_data" && looksLikeUnfixedStub(text)) {
      throw new Error("This is still the auto-generated low-data stub — write a real remark before approving, or leave it as low-data.");
    }
    await ctx.db.patch(remarkId, { status: "approved", finalText: text, approvedBy: profile._id, approvedAt: Date.now() });
  },
});

export const reject = mutation({
  args: { remarkId: v.id("remarks") },
  handler: async (ctx, { remarkId }) => {
    await requireRemarkAccess(ctx, remarkId);
    await ctx.db.patch(remarkId, { status: "rejected" });
  },
});

export const editDraft = mutation({
  args: { remarkId: v.id("remarks"), text: v.string() },
  handler: async (ctx, { remarkId, text }) => {
    await requireRemarkAccess(ctx, remarkId);
    await ctx.db.patch(remarkId, { draftText: text });
  },
});

/** Switching language re-drafts through the same path as Regenerate, so an AI draft stays an AI draft in the new language. */
export const setLanguage = action({
  args: { remarkId: v.id("remarks"), language: v.union(v.literal("en"), v.literal("ur")) },
  handler: async (ctx, { remarkId, language }): Promise<{ source: "ai" | "template" }> => {
    const item = await ctx.runQuery(internal.remarks.regenContext, { remarkId });
    const drafted = await draftOne(ctx, { ...item, language });
    await ctx.runMutation(internal.remarks.upsertDraft, { ...drafted, language, existingId: remarkId });
    return { source: drafted.source };
  },
});

/** Teacher/admin "Regenerate" — always re-asks the model, including for a low-data month. */
export const regenerate = action({
  args: { remarkId: v.id("remarks") },
  handler: async (ctx, { remarkId }): Promise<{ source: "ai" | "template" }> => {
    const item = await ctx.runQuery(internal.remarks.regenContext, { remarkId });
    const drafted = await draftOne(ctx, item, { forceAi: true });
    await ctx.runMutation(internal.remarks.upsertDraft, { ...drafted, existingId: remarkId });
    return { source: drafted.source };
  },
});

/** Auth + data gathering for a single regenerate. Runs with the caller's identity (Convex propagates it through runQuery). */
export const regenContext = internalQuery({
  args: { remarkId: v.id("remarks") },
  handler: async (ctx, { remarkId }): Promise<DraftItem> => {
    const { remark } = await requireRemarkAccess(ctx, remarkId);
    const item = await draftItemFor(ctx, remark.studentId, remark.period);
    if (!item) throw new Error("Student not found.");
    return item;
  },
});

// ---------------------------------------------------------------------------
// Drafting (§9) — an action, because the model call is external I/O. The DB
// reads and writes around it stay in internal query/mutation halves.
// ---------------------------------------------------------------------------

export interface DraftItem {
  academyId: Id<"academies">;
  studentId: Id<"students">;
  studentName: string;
  batchName: string;
  period: string;
  language: "en" | "ur";
  tone: string;
  dataPack: RemarkDataPack;
}

/** Everything the model is allowed to see for one student, plus the tone the admin set. */
async function draftItemFor(ctx: QueryCtx, studentId: Id<"students">, period: string): Promise<DraftItem | null> {
  const student = await ctx.db.get(studentId);
  if (!student) return null;
  const guardian = await ctx.db.get(student.guardianId);
  const language = guardian?.languagePref ?? "en";
  const enrollments = await studentActiveEnrollments(ctx, studentId, `${period}-15`);
  const tone = await ctx.db
    .query("remarkToneTemplates")
    .withIndex("by_academy_and_language_and_active", (q) =>
      q.eq("academyId", student.academyId).eq("language", language).eq("active", true)
    )
    .unique();
  return {
    academyId: student.academyId,
    studentId,
    studentName: student.name,
    batchName: enrollments[0]?.batch.name ?? "their batch",
    period,
    language,
    tone: tone?.tone ?? DEFAULT_TONE,
    dataPack: await buildDataPack(ctx, studentId, period),
  };
}

interface DraftedRow {
  academyId: Id<"academies">;
  studentId: Id<"students">;
  period: string;
  text: string;
  language: "en" | "ur";
  status: "draft" | "low_data";
  lowDataReason?: string;
  source: "ai" | "template";
  dataPack: RemarkDataPack;
}

/**
 * One student, one draft. Low-data students never reach the model (§9: they
 * are flagged, not given a vague remark). If the model is unavailable or
 * returns something ungrounded, we fall back to the deterministic writer —
 * the teacher still gets a queue to review, and `source` records which path
 * produced the text so nobody mistakes one for the other.
 */
async function draftOne(ctx: ActionCtx, item: DraftItem, opts?: { forceAi?: boolean }): Promise<DraftedRow> {
  const base = {
    academyId: item.academyId,
    studentId: item.studentId,
    period: item.period,
    language: item.language,
    dataPack: item.dataPack,
  };

  const forceAi = opts?.forceAi === true;

  const lowDataResult = (): DraftedRow => {
    const stub = lowDataStub(item.studentName, item.dataPack.lowDataReason ?? "Insufficient monthly data.");
    return { ...base, text: stub.text, status: "low_data", lowDataReason: item.dataPack.lowDataReason ?? undefined, source: "template" };
  };

  // The monthly job flags a thin month rather than writing a vague remark
  // (§9). Regenerate is a teacher explicitly asking for one anyway, so it
  // skips the flag and puts the same data pack in front of the model.
  if (item.dataPack.lowData && !forceAi) return lowDataResult();

  const fallback = () =>
    item.language === "ur" ? draftUrduText(item.dataPack, item.studentName) : draftText(item.dataPack, item.studentName);

  if (aiConfigured()) {
    const model = remarksModel();
    const payload = buildUserPayload({
      dataPack: item.dataPack,
      studentName: item.studentName,
      batchName: item.batchName,
      period: item.period,
      language: item.language,
    });
    const result = await chatCompletion({
      model,
      jsonObject: true,
      excludeReasoning: true,
      temperature: 0.3,
      // Generous: this model spends most of its budget on reasoning that
      // `excludeReasoning` strips, and a tight cap left the visible draft
      // truncated to a fragment (observed: "...").
      maxTokens: 1400,
      messages: [
        { role: "system", content: `${item.tone}\n\n${forceAi ? GROUNDING_RULES_FORCED : GROUNDING_RULES}` },
        { role: "user", content: userPrompt(payload) },
      ],
    });

    if (result.ok) {
      const parsed = parseDraftResponse(result.text);
      if (parsed && isUsableRemark(parsed.text)) {
        await ctx.runMutation(internal.remarks.logGeneration, {
          academyId: item.academyId,
          studentId: item.studentId,
          period: item.period,
          model,
          status: "ok",
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          totalTokens: result.usage.totalTokens,
        });
        return { ...base, text: parsed.text, status: "draft", source: "ai" };
      }
      await ctx.runMutation(internal.remarks.logGeneration, {
        academyId: item.academyId,
        studentId: item.studentId,
        period: item.period,
        model,
        status: "error",
        errorMessage: `unusable draft ${JSON.stringify((parsed?.text ?? result.text).slice(0, 120))} (finish_reason: ${result.finishReason})`,
      });
    } else {
      await ctx.runMutation(internal.remarks.logGeneration, {
        academyId: item.academyId,
        studentId: item.studentId,
        period: item.period,
        model,
        status: "error",
        errorMessage: result.error.slice(0, 500),
      });
    }
  }

  // Model unavailable or ungrounded. A thin month keeps its low-data flag
  // rather than getting a remark invented out of nothing.
  if (item.dataPack.lowData) return lowDataResult();

  const written = fallback();
  return { ...base, text: written.text, status: "draft", source: "template" };
}

/** Client-facing: admin-only. Same logic the monthly cron runs. */
export const draftForPeriod = action({
  args: { period: v.optional(v.string()), force: v.optional(v.boolean()), regenerate: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<DraftRunResult> => {
    const admin = await ctx.runQuery(internal.auth.currentProfileQuery, {});
    if (!admin || admin.role !== "admin") throw new Error("Admin access required.");
    return runDraft(ctx, args);
  },
});

/** Cron-safe: no auth check — only reachable from server code (crons.ts), never from a client. */
export const runDraftForPeriod = internalAction({
  args: { period: v.optional(v.string()), force: v.optional(v.boolean()), regenerate: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<DraftRunResult> => runDraft(ctx, args),
});

type DraftRunResult =
  | { skipped: string }
  | { created: number; skippedExisting: number; ai: number; template: number; period: string };

async function runDraft(
  ctx: ActionCtx,
  args: { period?: string; force?: boolean; regenerate?: boolean }
): Promise<DraftRunResult> {
  const today = new Date();
  if (!args.period && !args.force && today.getDate() !== 1) {
    return { skipped: "not the 1st of the month — pass `period` or `force` to run anyway" };
  }
  const period = args.period ?? previousPeriodOf(today);

  const queue = await ctx.runQuery(internal.remarks.draftQueue, { period, regenerate: args.regenerate });
  if ("skipped" in queue) return queue;

  let created = 0;
  let ai = 0;
  let template = 0;
  for (const item of queue.items) {
    const drafted = await draftOne(ctx, item);
    await ctx.runMutation(internal.remarks.upsertDraft, { ...drafted, existingId: item.existingId ?? undefined });
    created += 1;
    if (drafted.source === "ai") ai += 1;
    else template += 1;
  }

  const result = { created, skippedExisting: queue.skippedExisting, ai, template, period };
  await ctx.runMutation(internal.remarks.logDraftJobRun, { period, result });
  return result;
}

/**
 * Who still needs a draft. Skips students who already have one — unless the
 * stored text is a model monologue that leaked through an earlier run, which
 * we redraft on sight rather than leaving in a teacher's queue.
 */
export const draftQueue = internalQuery({
  args: { period: v.string(), regenerate: v.optional(v.boolean()) },
  handler: async (
    ctx,
    { period, regenerate }
  ): Promise<{ skipped: string } | { items: (DraftItem & { existingId: Id<"remarks"> | null })[]; skippedExisting: number }> => {
    const academy = await ctx.db.query("academies").first();
    if (!academy) return { skipped: "no academy configured yet" };

    const students = await ctx.db
      .query("students")
      .withIndex("by_status", (q) => q.eq("academyId", academy._id).eq("status", "active"))
      .collect();

    const items: (DraftItem & { existingId: Id<"remarks"> | null })[] = [];
    let skippedExisting = 0;
    for (const student of students) {
      const existing = await ctx.db
        .query("remarks")
        .withIndex("by_student_and_period", (q) => q.eq("studentId", student._id).eq("period", period))
        .unique();
      const dirty = existing ? isReasoningDump(`${existing.draftText ?? ""} ${existing.finalText ?? ""}`) : false;
      if (existing && !regenerate && !dirty) {
        skippedExisting += 1;
        continue;
      }
      const item = await draftItemFor(ctx, student._id, period);
      if (item) items.push({ ...item, existingId: existing?._id ?? null });
    }
    return { items, skippedExisting };
  },
});

export const upsertDraft = internalMutation({
  args: {
    academyId: v.id("academies"),
    studentId: v.id("students"),
    period: v.string(),
    text: v.string(),
    language: v.union(v.literal("en"), v.literal("ur")),
    status: v.union(v.literal("draft"), v.literal("low_data")),
    lowDataReason: v.optional(v.string()),
    source: v.union(v.literal("ai"), v.literal("template")),
    dataPack: v.any(),
    existingId: v.optional(v.id("remarks")),
  },
  handler: async (ctx, args) => {
    const row = {
      academyId: args.academyId,
      studentId: args.studentId,
      period: args.period,
      draftText: args.text,
      language: args.language,
      status: args.status,
      lowDataReason: args.lowDataReason,
      source: args.source,
      dataPack: args.dataPack,
      // A fresh draft is unreviewed by definition — clear any prior approval.
      approvedBy: undefined,
      approvedAt: undefined,
      finalText: undefined,
    };
    if (args.existingId) await ctx.db.patch(args.existingId, row);
    else await ctx.db.insert("remarks", row);
  },
});

export const logGeneration = internalMutation({
  args: {
    academyId: v.id("academies"),
    studentId: v.id("students"),
    period: v.string(),
    model: v.string(),
    status: v.union(v.literal("ok"), v.literal("error")),
    promptTokens: v.optional(v.number()),
    completionTokens: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("remarkGenerationLog", args);
  },
});

export const logDraftJobRun = internalMutation({
  args: { period: v.string(), result: v.any() },
  handler: async (ctx, { period, result }) => {
    await ctx.db.insert("jobRuns", { jobName: "draft-remarks", period, result });
  },
});

function previousPeriodOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Batch publish — an action, since it sends email. Reads/writes go through
// small internal helpers because actions can't touch ctx.db directly.
// ---------------------------------------------------------------------------

export const collectApprovedForBatch = internalQuery({
  args: { batchId: v.id("batches"), period: v.string() },
  handler: async (ctx, { batchId, period }) => {
    const enrollments = await ctx.db
      .query("enrollments")
      .withIndex("by_batch", (q) => q.eq("batchId", batchId))
      .collect();
    const today = new Date().toISOString().slice(0, 10);
    const activeStudentIds = [...new Set(enrollments.filter((e) => e.startDate <= today && (!e.endDate || e.endDate >= today)).map((e) => e.studentId))];

    const byGuardian = new Map<Id<"guardians">, { guardianEmail: string; guardianName: string; children: { name: string; text: string }[] }>();
    let allApproved = true;

    for (const studentId of activeStudentIds) {
      const student = await ctx.db.get(studentId);
      if (!student) continue;
      const remark = await ctx.db
        .query("remarks")
        .withIndex("by_student_and_period", (q) => q.eq("studentId", studentId).eq("period", period))
        .unique();
      if (!remark || remark.status !== "approved") {
        allApproved = false;
        continue;
      }
      const guardian = await ctx.db.get(student.guardianId);
      if (!guardian?.email) continue;
      const entry = byGuardian.get(guardian._id) ?? { guardianEmail: guardian.email, guardianName: guardian.name, children: [] };
      entry.children.push({ name: student.name, text: remark.finalText ?? remark.draftText ?? "" });
      byGuardian.set(guardian._id, entry);
    }

    return { allApproved, guardianCount: activeStudentIds.length === 0 ? 0 : byGuardian.size, byGuardian: [...byGuardian.entries()].map(([guardianId, v]) => ({ guardianId, ...v })) };
  },
});

export const claimNotification = internalMutation({
  args: { guardianId: v.id("guardians"), batchId: v.id("batches"), period: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("remarkNotificationLog")
      .withIndex("by_guardian_and_batch_and_period", (q) => q.eq("guardianId", args.guardianId).eq("batchId", args.batchId).eq("period", args.period))
      .unique();
    if (existing) return false;
    await ctx.db.insert("remarkNotificationLog", { ...args, channel: "email" });
    return true;
  },
});

export const publishForBatch = action({
  args: { batchId: v.id("batches"), period: v.string() },
  handler: async (ctx, args): Promise<{ notified: number; skipped: number; failed: number }> => {
    const caller = await ctx.runQuery(internal.auth.currentProfileQuery, {});
    if (!caller) throw new Error("Not signed in.");
    if (caller.role === "teacher") {
      const owns = await ctx.runQuery(internal.remarks.isTeacherOfBatchInternal, { teacherId: caller._id, batchId: args.batchId });
      if (!owns) throw new Error("Not your batch.");
    } else if (caller.role !== "admin") {
      throw new Error("Staff access required.");
    }
    const batch = await ctx.runQuery(internal.remarks.getBatchNameInternal, { batchId: args.batchId });
    const { allApproved, byGuardian } = await ctx.runQuery(internal.remarks.collectApprovedForBatch, args);
    if (!allApproved) throw new Error("Not every student in this batch has an approved remark for this period yet.");

    let notified = 0;
    let skipped = 0;
    let failed = 0;
    for (const g of byGuardian) {
      const claimed = await ctx.runMutation(internal.remarks.claimNotification, { guardianId: g.guardianId, batchId: args.batchId, period: args.period });
      if (!claimed) {
        skipped += 1;
        continue;
      }
      const childrenHtml = g.children.map((c) => `<p style="font-size:14px;"><strong>${c.name}</strong> — ${c.text}</p>`).join("");
      const result = await sendEmail({
        to: g.guardianEmail,
        subject: `${batch} — ${args.period} progress remarks`,
        html: emailShell(`<p style="font-size:15px;">This month's approved remarks for your ${g.children.length > 1 ? "children" : "child"}:</p>${childrenHtml}`),
        text: g.children.map((c) => `${c.name}: ${c.text}`).join("\n\n"),
      });
      await ctx.runMutation(internal.remarks.markNotification, {
        guardianId: g.guardianId,
        batchId: args.batchId,
        period: args.period,
        ok: result.ok,
        error: result.ok ? undefined : result.error,
      });
      if (result.ok) notified += 1;
      else failed += 1;
    }
    return { notified, skipped, failed };
  },
});

export const markNotification = internalMutation({
  args: {
    guardianId: v.id("guardians"),
    batchId: v.id("batches"),
    period: v.string(),
    ok: v.boolean(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { guardianId, batchId, period, ok, error }) => {
    const row = await ctx.db
      .query("remarkNotificationLog")
      .withIndex("by_guardian_and_batch_and_period", (q) => q.eq("guardianId", guardianId).eq("batchId", batchId).eq("period", period))
      .unique();
    if (!row) return;
    await ctx.db.patch(row._id, ok ? { status: "sent", sentAt: Date.now() } : { status: "failed", errorDetail: error?.slice(0, 500) });
  },
});

/** Per-batch publish readiness for the period — what the admin's Publish panel renders. */
export const getPublishStatus = query({
  args: { period: v.string() },
  handler: async (ctx, { period }) => {
    const admin = await requireAdmin(ctx);
    const batches = await ctx.db
      .query("batches")
      .withIndex("by_academy", (q) => q.eq("academyId", admin.academyId))
      .collect();
    const today = new Date().toISOString().slice(0, 10);

    return Promise.all(
      batches
        .filter((b) => b.active)
        .map(async (batch) => {
          const enrollments = await ctx.db
            .query("enrollments")
            .withIndex("by_batch", (q) => q.eq("batchId", batch._id))
            .collect();
          const studentIds = [...new Set(enrollments.filter((e) => e.startDate <= today && (!e.endDate || e.endDate >= today)).map((e) => e.studentId))];
          let approved = 0;
          for (const studentId of studentIds) {
            const remark = await ctx.db
              .query("remarks")
              .withIndex("by_student_and_period", (q) => q.eq("studentId", studentId).eq("period", period))
              .unique();
            if (remark?.status === "approved") approved += 1;
          }
          const notifications = await ctx.db.query("remarkNotificationLog").collect();
          const sent = notifications.filter((n) => n.batchId === batch._id && n.period === period && n.status === "sent").length;
          return { batchId: batch._id, name: batch.name, total: studentIds.length, approved, notified: sent };
        })
    );
  },
});

export const getBatchNameInternal = internalQuery({
  args: { batchId: v.id("batches") },
  handler: async (ctx, { batchId }) => batchName(ctx, batchId),
});

export const isTeacherOfBatchInternal = internalQuery({
  args: { teacherId: v.id("profiles"), batchId: v.id("batches") },
  handler: async (ctx, { teacherId, batchId }) => isTeacherOfBatch(ctx, teacherId, batchId),
});

// ---------------------------------------------------------------------------
// Tone templates — versioned, insert-only, same pattern as reminderTemplates.
// ---------------------------------------------------------------------------

/** What the admin's Tone panel renders: the active tone per language (or null → DEFAULT_TONE applies). */
export const activeToneTemplates = query({
  args: {},
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    const pick = async (language: "en" | "ur") => {
      const row = await ctx.db
        .query("remarkToneTemplates")
        .withIndex("by_academy_and_language_and_active", (q) => q.eq("academyId", admin.academyId).eq("language", language).eq("active", true))
        .unique();
      return row ? { tone: row.tone, version: row.version } : null;
    };
    return { en: await pick("en"), ur: await pick("ur"), defaultTone: DEFAULT_TONE };
  },
});

export const listToneTemplates = query({
  args: {},
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    const rows = await ctx.db.query("remarkToneTemplates").collect();
    return rows.filter((r) => r.academyId === admin.academyId);
  },
});

export const setToneTemplate = mutation({
  args: { language: v.union(v.literal("en"), v.literal("ur")), tone: v.string() },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    if (!args.tone.trim()) throw new Error("The tone instructions can't be empty.");
    const current = await ctx.db
      .query("remarkToneTemplates")
      .withIndex("by_academy_and_language_and_active", (q) => q.eq("academyId", admin.academyId).eq("language", args.language).eq("active", true))
      .unique();
    if (current) await ctx.db.patch(current._id, { active: false });
    await ctx.db.insert("remarkToneTemplates", { academyId: admin.academyId, language: args.language, tone: args.tone, version: (current?.version ?? 0) + 1, active: true });
  },
});
