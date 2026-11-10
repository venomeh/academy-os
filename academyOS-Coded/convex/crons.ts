import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Everything recurring lives here — the Convex equivalent of the reference
 * backend's pg_cron jobs, minus the shared-secret dance: a cron-scheduled
 * function has no caller identity at all, so it can only ever reach the
 * `internal.*` entry points below (never the public, admin-gated ones a
 * client calls), which is a stronger guarantee than the reference's
 * CRON_SECRET-bearer-token check.
 *
 * All times below are UTC; Asia/Karachi is UTC+5 year-round (no DST).
 */
const crons = cronJobs();

// 6:00am PKT (1:00am UTC) — self-gates to feeRules.generationDay, so most
// days this is a fast no-op rather than a full pass over the roster.
crons.daily("generate-vouchers", { hourUTC: 1, minuteUTC: 0 }, internal.vouchers.runGenerateVouchers, {});

// 8:00am PKT (3:00am UTC) — one fine per voucher, ever; safe to run daily.
crons.daily("accrue-late-fines", { hourUTC: 3, minuteUTC: 0 }, internal.lateFines.runAccrue, {});

// 9:00am PKT (4:00am UTC) — the daily reminder sweep (§10).
crons.daily("reminder-sweep", { hourUTC: 4, minuteUTC: 0 }, internal.reminders.runSweep, {});

// 2:00am PKT on the 1st (9:00pm UTC on the last day of the prior month) —
// self-gates to the 1st of the month, drafting the period that just ended.
crons.daily("draft-remarks", { hourUTC: 21, minuteUTC: 0 }, internal.remarks.runDraftForPeriod, {});

export default crons;
