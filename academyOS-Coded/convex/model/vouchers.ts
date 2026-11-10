import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { studentActiveEnrollments, siblingRank } from "./roster";
import { outstandingOf } from "./ledger";

/**
 * Voucher generation algorithm — §8.1, ported from the reference's
 * generate_vouchers RPC (see the fee-engine research earlier in this
 * conversation). Pure computation only (reads via QueryCtx|MutationCtx,
 * never writes) so it can be called from either a query (preview/dry-run)
 * or the mutation that actually inserts the row. Network I/O (the voucher
 * email) is NOT done here — mutations can't call fetch — it's the calling
 * action's job, using the fields this returns.
 */

export interface VoucherLine {
  label: string;
  note: string;
  amount: number;
}

export interface ComputedVoucher {
  studentId: Id<"students">;
  guardianId: Id<"guardians">;
  period: string;
  lineItems: VoucherLine[];
  tuitionAmount: number;
  siblingDiscount: number;
  arrears: number;
  admissionFee: number;
  total: number;
  dueDate: string;
  ruleSnapshot: {
    siblingDiscountPct: number;
    lateFineType: "flat" | "percentage";
    lateFineValue: number;
    lateFineGraceDays: number;
    dueDay: number;
    admissionFee: number;
  };
}

export type ComputeResult = { ok: true; voucher: ComputedVoucher } | { ok: false; reason: "inactive" | "no_enrollment" | "already_exists" };

function dueDateFor(period: string, dueDay: number): string {
  const [y, m] = period.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const day = Math.min(Math.max(dueDay, 1), lastDay);
  return `${period}-${String(day).padStart(2, "0")}`;
}

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export { randomToken };

/** Sum of unpaid balance across every one of this student's vouchers strictly before `period`. */
async function arrearsBefore(ctx: QueryCtx | MutationCtx, studentId: Id<"students">, period: string): Promise<number> {
  const priorVouchers = await ctx.db
    .query("vouchers")
    .withIndex("by_student_and_period", (q) => q.eq("studentId", studentId))
    .collect();
  let arrears = 0;
  for (const v of priorVouchers.filter((v) => v.period < period)) {
    const entries = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_voucher", (q) => q.eq("voucherId", v._id))
      .collect();
    arrears += Math.max(outstandingOf(v, entries), 0);
  }
  return arrears;
}

export async function computeVoucherForStudent(ctx: QueryCtx | MutationCtx, studentId: Id<"students">, period: string, feeRules: Doc<"feeRules">): Promise<ComputeResult> {
  const student = await ctx.db.get(studentId);
  if (!student || student.status !== "active") return { ok: false, reason: "inactive" };

  const existing = await ctx.db
    .query("vouchers")
    .withIndex("by_student_and_period", (q) => q.eq("studentId", studentId).eq("period", period))
    .unique();
  if (existing) return { ok: false, reason: "already_exists" };

  // A voucher period is the whole month, so "enrolled this period" means
  // active as of the period's last day — catches someone who joined
  // mid-period too, per studentActiveEnrollments' date-range semantics.
  const [y, m] = period.split("-").map(Number);
  const periodEnd = `${period}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
  const enrollments = await studentActiveEnrollments(ctx, studentId, periodEnd);
  if (enrollments.length === 0) return { ok: false, reason: "no_enrollment" };

  const tuitionAmount = student.feeOverride ?? enrollments.reduce((sum, e) => sum + e.batch.monthlyTuition, 0);

  const { rank } = await siblingRank(ctx, student.guardianId, studentId);
  const siblingDiscount = rank > 1 ? Math.round(tuitionAmount * (feeRules.siblingDiscountPct / 100)) : 0;

  const arrears = await arrearsBefore(ctx, studentId, period);

  const admissionFee = student.joinedAt.slice(0, 7) === period ? feeRules.admissionFee : 0;

  const total = tuitionAmount - siblingDiscount + arrears + admissionFee;

  const lineItems: VoucherLine[] = [{ label: "Monthly tuition", note: enrollments.map((e) => e.batch.name).join(", "), amount: tuitionAmount }];
  if (siblingDiscount > 0) lineItems.push({ label: "Sibling discount", note: `${feeRules.siblingDiscountPct}% off — additional child`, amount: -siblingDiscount });
  if (arrears > 0) lineItems.push({ label: "Arrears carried forward", note: "Prior unpaid balance", amount: arrears });
  if (admissionFee > 0) lineItems.push({ label: "Registration fee", note: "One-time, join month", amount: admissionFee });

  return {
    ok: true,
    voucher: {
      studentId,
      guardianId: student.guardianId,
      period,
      lineItems,
      tuitionAmount,
      siblingDiscount,
      arrears,
      admissionFee,
      total,
      dueDate: dueDateFor(period, feeRules.dueDay),
      ruleSnapshot: {
        siblingDiscountPct: feeRules.siblingDiscountPct,
        lateFineType: feeRules.lateFineType,
        lateFineValue: feeRules.lateFineValue,
        lateFineGraceDays: feeRules.lateFineGraceDays,
        dueDay: feeRules.dueDay,
        admissionFee: feeRules.admissionFee,
      },
    },
  };
}

export async function computeOutstanding(ctx: QueryCtx | MutationCtx, voucherId: Id<"vouchers">): Promise<number> {
  const voucher = await ctx.db.get(voucherId);
  if (!voucher) throw new Error("Voucher not found.");
  const entries = await ctx.db
    .query("ledgerEntries")
    .withIndex("by_voucher", (q) => q.eq("voucherId", voucherId))
    .collect();
  return outstandingOf(voucher, entries);
}
