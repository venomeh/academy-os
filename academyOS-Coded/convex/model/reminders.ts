import type { Doc } from "../_generated/dataModel";
import { agingBucket, isOverdue } from "./ledger";

export type ReminderBucket = "due_date" | "7d_gentle" | "14d_firm" | "30d_final";

/**
 * Which reminder (if any) is due today for this voucher. Reuses the money
 * engine's `agingBucket`/`isOverdue` (convex/model/ledger.ts) for the
 * overdue buckets and adds the one case that isn't "aging" at all: the
 * due-date-day notice. A voucher 1-6 days overdue is between buckets — the
 * reference sends nothing there either (it already sent the due-date
 * notice, and 7d_gentle isn't due yet).
 */
export function reminderBucketFor(voucher: Pick<Doc<"vouchers">, "dueDate">, today: string): ReminderBucket | null {
  if (voucher.dueDate === today) return "due_date";
  if (!isOverdue(voucher, today)) return null;
  const bucket = agingBucket(voucher, today);
  return bucket === "current" ? null : bucket;
}

/** {{key}} substitution. An unmatched placeholder is left visible on purpose — a silent blank would hide a broken template. */
export function fillTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => (key in vars ? vars[key] : match));
}

export function formatItemization(lineItems: { label: string; amount: number }[]): string {
  return lineItems.map((l) => `${l.label}: ${l.amount >= 0 ? "" : "−"}${Math.abs(l.amount).toLocaleString()}`).join(", ");
}

export function daysOverdue(dueDate: string, today: string): number {
  const from = new Date(`${dueDate}T00:00:00Z`).getTime();
  const to = new Date(`${today}T00:00:00Z`).getTime();
  return Math.max(0, Math.floor((to - from) / (1000 * 60 * 60 * 24)));
}
