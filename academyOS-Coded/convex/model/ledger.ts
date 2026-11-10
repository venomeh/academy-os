import type { Doc } from "../_generated/dataModel";

// ---------------------------------------------------------------------------
// Balance arithmetic — the one place that decides what a voucher still owes.
// Every screen, tool, reminder and payment path derives its number from
// these three functions so an adjustment posted anywhere is reflected
// everywhere (Tasks.md §15 Rule 1: balances are computed, never stored).
//
// Sign convention on ledgerEntries.amount: positive reduces what the family
// owes (payment, discount, credit adjustment); negative increases it
// (voucher issued, fine, charge adjustment). A voucher's own `total` already
// carries its issued amount plus any accrued fine, so what remains is
// `total` minus every credit-kind row against it.
// ---------------------------------------------------------------------------

type LedgerLike = Pick<Doc<"ledgerEntries">, "kind" | "amount">;

const CREDIT_KINDS = new Set<Doc<"ledgerEntries">["kind"]>(["payment", "adjustment", "discount"]);

/** Money actually received against the voucher (cash + Stripe). Display-only — use `outstandingOf` for anything that decides state. */
export function voucherPaid(entries: LedgerLike[]): number {
  return entries.filter((e) => e.kind === "payment").reduce((s, e) => s + e.amount, 0);
}

/** Signed sum of everything that offsets the voucher: payments, discounts, and adjustments (a charge adjustment is negative and so *raises* the balance). */
export function voucherCredits(entries: LedgerLike[]): number {
  return entries.filter((e) => CREDIT_KINDS.has(e.kind)).reduce((s, e) => s + e.amount, 0);
}

/** What the family still owes on this voucher. Unclamped: a negative result means it is over-credited. */
export function outstandingOf(voucher: Pick<Doc<"vouchers">, "total">, entries: LedgerLike[]): number {
  return voucher.total - voucherCredits(entries);
}

/** Derived status — the only way `vouchers.status` is ever chosen. "partial" means partially *paid*; a discount alone leaves it unpaid. */
export function statusFor(voucher: Pick<Doc<"vouchers">, "total">, entries: LedgerLike[]): Doc<"vouchers">["status"] {
  const outstanding = outstandingOf(voucher, entries);
  if (outstanding <= 0) return "paid";
  return voucherPaid(entries) > 0 ? "partial" : "unpaid";
}

export type AgingBucket = "current" | "7d_gentle" | "14d_firm" | "30d_final";

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00Z`).getTime();
  const to = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.floor((to - from) / (1000 * 60 * 60 * 24));
}

/**
 * Bucket a voucher by days-since-due-date. Only meaningful once the voucher
 * is actually overdue (`today >= dueDate`) — a not-yet-due voucher isn't
 * "aging" at all, so callers deciding whether something counts as a
 * defaulter should separately require `today >= dueDate`, not rely on this
 * returning something falsy for that case (it returns "current" instead,
 * which is a display bucket, not a signal to include/exclude).
 */
export function agingBucket(voucher: Pick<Doc<"vouchers">, "dueDate">, today: string): AgingBucket {
  const overdueDays = daysBetween(voucher.dueDate, today);
  if (overdueDays >= 30) return "30d_final";
  if (overdueDays >= 14) return "14d_firm";
  if (overdueDays >= 7) return "7d_gentle";
  return "current";
}

export function isOverdue(voucher: Pick<Doc<"vouchers">, "dueDate">, today: string): boolean {
  return today >= voucher.dueDate;
}
