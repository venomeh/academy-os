import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin, requireGuardian, pktToday } from "./lib/authz";
import { agingBucket, isOverdue, outstandingOf, statusFor, type AgingBucket } from "./model/ledger";

export const listEntries = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const admin = await requireAdmin(ctx);
    const take = limit ?? 30;
    // Over-fetch then filter+re-slice by academy (single-tenant today, so
    // this headroom is generous; revisit with a compound index if/when
    // multi-academy support lands).
    const rows = await ctx.db.query("ledgerEntries").order("desc").take(take * 3);
    const forAcademy = rows.filter((r) => r.academyId === admin.academyId).slice(0, take);
    return Promise.all(
      forAcademy
        .map(async (r) => {
          const guardian = await ctx.db.get(r.guardianId);
          const student = await ctx.db.get(r.studentId);
          const voucher = r.voucherId ? await ctx.db.get(r.voucherId) : null;
          return {
            id: r._id,
            kind: r.kind,
            guardian: guardian?.name ?? "—",
            student: student?.name ?? "—",
            voucherPeriod: voucher?.period ?? null,
            amount: r.amount,
            method: r.method ?? null,
            receiptNumber: r.receiptNumber ?? null,
            reason: r.reason ?? null,
            createdAt: r._creationTime,
          };
        })
    );
  },
});

export const getTodayCollections = query({
  args: {},
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    const today = pktToday();
    const startOfDay = new Date(`${today}T00:00:00+05:00`).getTime();
    const rows = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_kind", (q) => q.eq("kind", "payment"))
      .collect();
    const todayRows = rows.filter((r) => r.academyId === admin.academyId && r._creationTime >= startOfDay);
    const cash = todayRows.filter((r) => r.method === "cash").reduce((s, r) => s + r.amount, 0);
    const stripe = todayRows.filter((r) => r.method === "stripe").reduce((s, r) => s + r.amount, 0);
    return { total: cash + stripe, cash, stripe, receipts: todayRows.length };
  },
});

async function activeUnpaidVouchers(ctx: QueryCtx, academyId: Id<"academies">): Promise<Doc<"vouchers">[]> {
  const unpaid = await ctx.db
    .query("vouchers")
    .withIndex("by_status", (q) => q.eq("status", "unpaid"))
    .collect();
  const partial = await ctx.db
    .query("vouchers")
    .withIndex("by_status", (q) => q.eq("status", "partial"))
    .collect();
  const candidates: Doc<"vouchers">[] = [...unpaid, ...partial].filter((v) => v.academyId === academyId);

  // Exclude students marked "left" — their historical unpaid vouchers stop
  // appearing here even though the vouchers/ledger themselves are untouched.
  const out: Doc<"vouchers">[] = [];
  for (const v of candidates) {
    const student = await ctx.db.get(v.studentId);
    if (student && student.status === "active") out.push(v);
  }
  return out;
}

export const getAgingBuckets = query({
  args: {},
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    const today = pktToday();
    const vouchers = await activeUnpaidVouchers(ctx, admin.academyId);

    const buckets: Record<AgingBucket, { amount: number; guardians: Set<string> }> = {
      current: { amount: 0, guardians: new Set() },
      "7d_gentle": { amount: 0, guardians: new Set() },
      "14d_firm": { amount: 0, guardians: new Set() },
      "30d_final": { amount: 0, guardians: new Set() },
    };

    for (const v of vouchers) {
      if (!isOverdue(v, today)) continue; // not yet due — not "aging"
      const entries = await ctx.db
        .query("ledgerEntries")
        .withIndex("by_voucher", (q) => q.eq("voucherId", v._id))
        .collect();
      const outstanding = outstandingOf(v, entries);
      if (outstanding <= 0) continue;
      const bucket = agingBucket(v, today);
      buckets[bucket].amount += outstanding;
      buckets[bucket].guardians.add(v.guardianId);
    }

    return (Object.keys(buckets) as AgingBucket[]).map((bucket) => ({
      bucket,
      amount: buckets[bucket].amount,
      families: buckets[bucket].guardians.size,
    }));
  },
});

export const getDefaulters = query({
  args: { bucket: v.optional(v.union(v.literal("all"), v.literal("current"), v.literal("7d_gentle"), v.literal("14d_firm"), v.literal("30d_final"))) },
  handler: async (ctx, { bucket }) => {
    const admin = await requireAdmin(ctx);
    const today = pktToday();
    const vouchers = (await activeUnpaidVouchers(ctx, admin.academyId)).filter((v) => isOverdue(v, today));

    const order: AgingBucket[] = ["current", "7d_gentle", "14d_firm", "30d_final"];
    const byGuardian = new Map<Id<"guardians">, { amount: number; students: Set<string>; worstBucket: AgingBucket }>();

    for (const v of vouchers) {
      const entries = await ctx.db
        .query("ledgerEntries")
        .withIndex("by_voucher", (q) => q.eq("voucherId", v._id))
        .collect();
      const outstanding = outstandingOf(v, entries);
      if (outstanding <= 0) continue;
      const b = agingBucket(v, today);
      const student = await ctx.db.get(v.studentId);
      const entry = byGuardian.get(v.guardianId) ?? { amount: 0, students: new Set<string>(), worstBucket: "current" as AgingBucket };
      entry.amount += outstanding;
      if (student) entry.students.add(student.name);
      if (order.indexOf(b) > order.indexOf(entry.worstBucket)) entry.worstBucket = b;
      byGuardian.set(v.guardianId, entry);
    }

    const rows = await Promise.all(
      [...byGuardian.entries()].map(async ([guardianId, v]) => {
        const guardian = await ctx.db.get(guardianId);
        return {
          guardianId,
          family: guardian?.name ?? "—",
          children: [...v.students].join(" + "),
          amount: v.amount,
          bucket: v.worstBucket,
          paused: guardian?.remindersPaused ?? false,
          pausedReason: guardian?.remindersPausedReason ?? null,
        };
      })
    );

    return rows.filter((r) => !bucket || bucket === "all" || r.bucket === bucket).sort((a, b) => b.amount - a.amount);
  },
});

export const togglePause = mutation({
  args: { guardianId: v.id("guardians"), reason: v.optional(v.string()) },
  handler: async (ctx, { guardianId, reason }) => {
    await requireAdmin(ctx);
    const guardian = await ctx.db.get(guardianId);
    if (!guardian) throw new Error("Guardian not found.");
    await ctx.db.patch(guardianId, {
      remindersPaused: !guardian.remindersPaused,
      remindersPausedReason: !guardian.remindersPaused ? (reason ?? "Paused by admin") : undefined,
    });
    return !guardian.remindersPaused;
  },
});

/** One family's full statement: every ledger row newest first, the running balance, and a per-child split. Shared by the parent portal and the admin's family view. */
async function guardianStatement(ctx: QueryCtx, guardianId: Id<"guardians">) {
  const entries = await ctx.db
    .query("ledgerEntries")
    .withIndex("by_guardian", (q) => q.eq("guardianId", guardianId))
    .order("desc")
    .collect();
  const studentNames = new Map<Id<"students">, string>();
  const rows = await Promise.all(
    entries.map(async (l) => {
      if (!studentNames.has(l.studentId)) studentNames.set(l.studentId, (await ctx.db.get(l.studentId))?.name ?? "—");
      const voucher = l.voucherId ? await ctx.db.get(l.voucherId) : null;
      return {
        id: l._id,
        kind: l.kind,
        studentId: l.studentId,
        studentName: studentNames.get(l.studentId) ?? "—",
        voucherPeriod: voucher?.period ?? null,
        reason: l.reason ?? null,
        receiptNumber: l.receiptNumber ?? null,
        method: l.method ?? null,
        amount: l.amount,
        createdAt: l._creationTime,
      };
    })
  );
  // Charges are negative, payments/discounts positive — balance owed is the negated sum.
  const runningBalance = Math.max(0, -entries.reduce((s, l) => s + l.amount, 0));
  const perChild = new Map<Id<"students">, number>();
  for (const l of entries) perChild.set(l.studentId, (perChild.get(l.studentId) ?? 0) - l.amount);
  const children = [...perChild.entries()].map(([studentId, owed]) => ({ studentId, name: studentNames.get(studentId) ?? "—", balance: Math.max(0, owed) }));
  return { rows, runningBalance, children };
}

/** Parent Portal statement (§8.3, §11) — the signed-in guardian's own ledger only. */
export const listForGuardian = query({
  args: {},
  handler: async (ctx) => {
    const { guardian } = await requireGuardian(ctx);
    return guardianStatement(ctx, guardian._id);
  },
});

/** Admin's per-family statement (§8.3) — the same rows a parent sees, plus contact and pause state. */
export const listForFamily = query({
  args: { guardianId: v.id("guardians") },
  handler: async (ctx, { guardianId }) => {
    const admin = await requireAdmin(ctx);
    const guardian = await ctx.db.get(guardianId);
    if (!guardian || guardian.academyId !== admin.academyId) return null;
    const statement = await guardianStatement(ctx, guardianId);
    return {
      guardian: {
        id: guardian._id,
        name: guardian.name,
        email: guardian.email ?? null,
        phone: guardian.phone ?? null,
        languagePref: guardian.languagePref,
        remindersPaused: guardian.remindersPaused,
        remindersPausedReason: guardian.remindersPausedReason ?? null,
      },
      ...statement,
    };
  },
});

/**
 * The PRD's only correction path (§8.3, §15 Rule 1): money is never edited,
 * a new row is appended with a reason. `amount` follows the ledger's sign
 * convention — positive credits the family (waiver, goodwill, mid-month
 * proration), negative charges them (a missed item). The voucher's cached
 * status is re-derived from the ledger afterwards, same as a payment.
 */
export const postAdjustment = mutation({
  args: {
    voucherId: v.id("vouchers"),
    amount: v.number(),
    kind: v.union(v.literal("adjustment"), v.literal("discount")),
    reason: v.string(),
  },
  handler: async (ctx, { voucherId, amount, kind, reason }) => {
    const admin = await requireAdmin(ctx);
    const voucher = await ctx.db.get(voucherId);
    if (!voucher || voucher.academyId !== admin.academyId) throw new Error("Voucher not found.");
    const cleanReason = reason.trim();
    if (!cleanReason) throw new Error("A reason is required for every adjustment.");
    const rounded = Math.round(amount);
    if (rounded === 0) throw new Error("Enter a non-zero amount.");
    if (kind === "discount" && rounded < 0) throw new Error("A discount always reduces the balance — use an adjustment to add a charge.");

    const entries = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_voucher", (q) => q.eq("voucherId", voucherId))
      .collect();
    const outstanding = outstandingOf(voucher, entries);
    if (rounded > 0 && rounded > outstanding) {
      throw new Error(`That credit exceeds what's outstanding — the maximum is ${Math.max(0, outstanding).toLocaleString()}.`);
    }

    await ctx.db.insert("ledgerEntries", {
      academyId: voucher.academyId,
      guardianId: voucher.guardianId,
      studentId: voucher.studentId,
      voucherId,
      kind,
      amount: rounded,
      reason: cleanReason,
      createdBy: admin._id,
    });
    const after = [...entries, { kind, amount: rounded }];
    const status = statusFor(voucher, after);
    await ctx.db.patch(voucherId, { status });
    // Posting a correction is what "reviewing" a mid-month voucher means —
    // clear the flag so the banner doesn't keep asking.
    const student = await ctx.db.get(voucher.studentId);
    if (student?.needsFeeReview) await ctx.db.patch(student._id, { needsFeeReview: false });
    return { status, outstanding: Math.max(0, outstandingOf(voucher, after)) };
  },
});
