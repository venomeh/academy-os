import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { createAccount } from "@convex-dev/auth/server";
import { pktToday } from "./lib/authz";
import { computeVoucherForStudent, randomToken } from "./model/vouchers";
import { buildDataPack, draftText, draftUrduText } from "./model/remarks";

/**
 * One-time bootstrap — creates the academy row, default fee rules, and the
 * very first admin account. Admin-provisioned-only (§3) means every other
 * account is created by `auth.provisionAccount`, which requires an
 * *existing* admin caller — so the very first admin can't come from that
 * path. This file is the one deliberate exception, and it's not reachable
 * from the frontend: run it once from the CLI —
 *
 *   npx convex run seed:bootstrapAdmin '{"email":"owner@example.com","fullName":"...","password":"..."}'
 *
 * It's idempotent (no-ops if an academy already exists), so it's safe to
 * leave in place rather than deleting it after first use.
 */

export const findAcademy = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("academies").first(),
});

export const insertAcademyAndRules = internalMutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const academyId = await ctx.db.insert("academies", { name });
    await ctx.db.insert("feeRules", {
      academyId,
      siblingDiscountPct: 10,
      lateFineType: "flat",
      lateFineValue: 200,
      lateFineGraceDays: 0,
      generationDay: 1,
      dueDay: 10,
      admissionFee: 2000,
    });
    return academyId;
  },
});

export const insertAdminProfile = internalMutation({
  args: { userId: v.id("users"), academyId: v.id("academies"), fullName: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    return ctx.db.insert("profiles", {
      userId: args.userId,
      academyId: args.academyId,
      role: "admin",
      fullName: args.fullName,
      email: args.email,
      languagePref: "en",
      active: true,
    });
  },
});

export const bootstrapAdmin = action({
  args: { email: v.string(), fullName: v.string(), password: v.string(), academyName: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ ok: boolean; message: string }> => {
    const existing = await ctx.runQuery(internal.seed.findAcademy, {});
    if (existing) {
      return { ok: false, message: `Academy "${existing.name}" already exists — bootstrap only runs once. Use auth.provisionAccount (as an existing admin) to add more staff.` };
    }
    if (args.password.length < 8) {
      return { ok: false, message: "Password must be at least 8 characters." };
    }

    const academyId = await ctx.runMutation(internal.seed.insertAcademyAndRules, { name: args.academyName ?? "Bright Future Academy" });

    const email = args.email.trim().toLowerCase();
    const { user } = await createAccount(ctx, {
      provider: "password",
      account: { id: email, secret: args.password },
      profile: { email, name: args.fullName },
    });

    await ctx.runMutation(internal.seed.insertAdminProfile, { userId: user._id, academyId, fullName: args.fullName, email });

    return { ok: true, message: `Admin account created for ${email}. Sign in at /login.` };
  },
});

// =============================================================================
// Demo data — "Bright Future Academy". Real accounts, real vouchers computed
// by the real fee engine (computeVoucherForStudent), real attendance/scores,
// remarks drafted by the real data-pack builder. Not reachable from the
// frontend — run once from the CLI:
//
//   npx convex run seed:seedDemoData '{}'
//
// Trimmed from the original ~54-student mock dataset to ~29 students (10
// developed families with real payment-status storylines + 15 single-child
// filler families) to keep this authorable and runnable in one pass; every
// developed family's storyline (unpaid/partial/paid, sibling discount,
// arrears, late fine, mid-month join) is preserved.
// =============================================================================

const DEMO_PASSWORD = "academy1234";

function priorPeriodOf(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export const findExistingStudent = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("students").first(),
});

interface BatchSeed {
  key: string;
  name: string;
  subject: string;
  days: string[];
  start: string;
  end: string;
  tuition: number;
  teacherKey: string;
}

const BATCH_SEEDS: BatchSeed[] = [
  { key: "9b", name: "Class 9-B Science", subject: "Physics", days: ["Mon", "Tue", "Wed", "Thu"], start: "16:00", end: "17:00", tuition: 4500, teacherKey: "sana" },
  { key: "olevel", name: "O-Level Physics", subject: "Physics", days: ["Mon", "Tue", "Wed", "Thu"], start: "16:00", end: "17:00", tuition: 4500, teacherKey: "adnan" },
  { key: "7a", name: "Class 7-A Maths", subject: "Maths", days: ["Mon", "Wed", "Fri"], start: "17:00", end: "18:00", tuition: 4500, teacherKey: "rabia" },
  { key: "8c", name: "Class 8-C English", subject: "English", days: ["Tue", "Thu"], start: "17:00", end: "18:00", tuition: 4500, teacherKey: "sana" },
  { key: "6a", name: "Class 6-A Maths", subject: "Maths", days: ["Mon", "Wed", "Fri"], start: "18:00", end: "19:00", tuition: 4000, teacherKey: "rabia" },
  { key: "10a", name: "Class 10-A Chemistry", subject: "Chemistry", days: ["Tue", "Thu"], start: "18:00", end: "19:00", tuition: 5000, teacherKey: "adnan" },
];

const TEACHERS = [
  { key: "sana", name: "Sana Iqbal", email: "sana.iqbal@brightfuture.pk" },
  { key: "rabia", name: "Rabia Noor", email: "rabia.noor@brightfuture.pk" },
  { key: "adnan", name: "Adnan Malik", email: "adnan.malik@brightfuture.pk" },
];

type PayStory = "paid" | "partial-current" | "unpaid-with-arrears" | "unpaid-current" | "unpaid-current-only";

interface FamilySeed {
  guardianKey: string;
  guardianName: string;
  language: "en" | "ur";
  kids: { studentKey: string; name: string; grade: string; batchKey: string; story: PayStory; midMonthJoin?: boolean }[];
}

const FAMILIES: FamilySeed[] = [
  { guardianKey: "khalid", guardianName: "Khalid Ahmed", language: "en", kids: [
    { studentKey: "ayesha", name: "Ayesha Khan", grade: "9", batchKey: "9b", story: "unpaid-with-arrears" },
    { studentKey: "bilal", name: "Bilal Ahmed", grade: "7", batchKey: "7a", story: "unpaid-with-arrears" },
  ]},
  { guardianKey: "nadia", guardianName: "Nadia Sheikh", language: "en", kids: [
    { studentKey: "fatima", name: "Fatima Sheikh", grade: "10", batchKey: "olevel", story: "paid" },
  ]},
  { guardianKey: "imran", guardianName: "Imran Raza", language: "en", kids: [
    { studentKey: "hassan", name: "Hassan Raza", grade: "9", batchKey: "9b", story: "partial-current" },
  ]},
  { guardianKey: "sadia", guardianName: "Sadia Malik", language: "ur", kids: [
    { studentKey: "zainab", name: "Zainab Malik", grade: "8", batchKey: "8c", story: "paid" },
    { studentKey: "usman", name: "Usman Malik", grade: "10", batchKey: "olevel", story: "paid" },
    { studentKey: "hira", name: "Hira Malik", grade: "6", batchKey: "6a", story: "partial-current" },
  ]},
  { guardianKey: "tariq", guardianName: "Tariq Farooq", language: "ur", kids: [
    { studentKey: "omar", name: "Omar Farooq", grade: "9", batchKey: "9b", story: "unpaid-with-arrears" },
  ]},
  { guardianKey: "rukhsana", guardianName: "Rukhsana Javed", language: "en", kids: [
    { studentKey: "maryam", name: "Maryam Javed", grade: "7", batchKey: "7a", story: "paid" },
  ]},
  { guardianKey: "shahid", guardianName: "Shahid Hamza", language: "en", kids: [
    { studentKey: "ali", name: "Ali Hamza", grade: "8", batchKey: "8c", story: "partial-current" },
    { studentKey: "sara", name: "Sara Hamza", grade: "10", batchKey: "olevel", story: "paid" },
  ]},
  { guardianKey: "asma", guardianName: "Asma Qureshi", language: "ur", kids: [
    { studentKey: "ibrahim", name: "Ibrahim Qureshi", grade: "6", batchKey: "6a", story: "unpaid-with-arrears" },
  ]},
  { guardianKey: "kashif", guardianName: "Kashif Butt", language: "en", kids: [
    { studentKey: "noorfatima", name: "Noor Fatima", grade: "9", batchKey: "9b", story: "paid" },
  ]},
  { guardianKey: "farah", guardianName: "Farah Iqbal", language: "ur", kids: [
    { studentKey: "danish", name: "Danish Iqbal", grade: "8", batchKey: "8c", story: "unpaid-current-only", midMonthJoin: true },
  ]},
];

const FILLERS: { studentKey: string; name: string; grade: string; batchKey: string }[] = [
  { studentKey: "f-zohaib", name: "Zohaib Anwar", grade: "9", batchKey: "9b" },
  { studentKey: "f-mahnoor", name: "Mahnoor Aslam", grade: "9", batchKey: "9b" },
  { studentKey: "f-talha", name: "Talha Siddiqui", grade: "9", batchKey: "9b" },
  { studentKey: "f-hafsa", name: "Hafsa Rehman", grade: "8", batchKey: "8c" },
  { studentKey: "f-musa", name: "Musa Kamal", grade: "8", batchKey: "8c" },
  { studentKey: "f-anaya", name: "Anaya Waqar", grade: "8", batchKey: "8c" },
  { studentKey: "f-rehan", name: "Rehan Aziz", grade: "7", batchKey: "7a" },
  { studentKey: "f-sumaiya", name: "Sumaiya Bhatti", grade: "7", batchKey: "7a" },
  { studentKey: "f-hamna", name: "Hamna Siddique", grade: "10", batchKey: "olevel" },
  { studentKey: "f-ahsan", name: "Ahsan Riaz", grade: "10", batchKey: "olevel" },
  { studentKey: "f-rida", name: "Rida Anwar", grade: "6", batchKey: "6a" },
  { studentKey: "f-junaid", name: "Junaid Akhtar", grade: "6", batchKey: "6a" },
  { studentKey: "f-taha", name: "Taha Mirza", grade: "10", batchKey: "10a" },
  { studentKey: "f-sanai", name: "Sana Ilyas", grade: "10", batchKey: "10a" },
  { studentKey: "f-bilawal", name: "Bilawal Chaudhry", grade: "10", batchKey: "10a" },
];

export const seedDemoData = action({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean; message: string; credentials?: string[] }> => {
    const existing = await ctx.runQuery(internal.seed.findExistingStudent, {});
    if (existing) {
      return { ok: false, message: "Demo data already seeded (a student row already exists) — this only runs once." };
    }
    const academy = await ctx.runQuery(internal.seed.findAcademy, {});
    if (!academy) {
      return { ok: false, message: "No academy yet — run seed:bootstrapAdmin first." };
    }

    const credentials: string[] = [];

    // 1. Teachers — real auth accounts.
    const teacherIds: Record<string, Id<"profiles">> = {};
    for (const t of TEACHERS) {
      const { user } = await createAccount(ctx, { provider: "password", account: { id: t.email, secret: DEMO_PASSWORD }, profile: { email: t.email, name: t.name } });
      const profileId: Id<"profiles"> = await ctx.runMutation(internal.seed.insertStaffProfile, { userId: user._id, academyId: academy._id, role: "teacher", fullName: t.name, email: t.email });
      teacherIds[t.key] = profileId;
      credentials.push(`teacher  ${t.email} / ${DEMO_PASSWORD}  (${t.name})`);
    }

    // 2. Batches + subjects + teacher assignments.
    const batchIds: Record<string, Id<"batches">> = await ctx.runMutation(internal.seed.insertBatches, {
      academyId: academy._id,
      batches: BATCH_SEEDS.map((b) => ({ ...b, teacherId: teacherIds[b.teacherKey] })),
    });

    // 3. Guardians — real auth accounts (developed families + fillers).
    const guardianUserIds: { key: string; name: string; email: string; language: "en" | "ur"; userId: Id<"users"> }[] = [];
    for (const fam of FAMILIES) {
      const email = `${fam.guardianKey}@brightfuture-parent.pk`;
      const { user } = await createAccount(ctx, { provider: "password", account: { id: email, secret: DEMO_PASSWORD }, profile: { email, name: fam.guardianName } });
      guardianUserIds.push({ key: fam.guardianKey, name: fam.guardianName, email, language: fam.language, userId: user._id });
      credentials.push(`parent   ${email} / ${DEMO_PASSWORD}  (${fam.guardianName})`);
    }
    for (const f of FILLERS) {
      const key = `filler-${f.studentKey}`;
      const email = `${key}@brightfuture-parent.pk`;
      const guardianName = `${f.name.split(" ")[1] ?? f.name} Family`;
      const { user } = await createAccount(ctx, { provider: "password", account: { id: email, secret: DEMO_PASSWORD }, profile: { email, name: guardianName } });
      guardianUserIds.push({ key, name: guardianName, email, language: "en", userId: user._id });
    }

    // 4. Guardians table + students + enrollments (bulk, one mutation).
    const { studentIds, guardianIds } = await ctx.runMutation(internal.seed.insertFamiliesAndStudents, {
      academyId: academy._id,
      batchIds,
      developedGuardians: guardianUserIds.slice(0, FAMILIES.length),
      fillerGuardians: guardianUserIds.slice(FAMILIES.length),
    });

    // 5. Vouchers (prior + current period, computed by the real fee engine),
    // payments, and a late fine on the arrears storylines.
    await ctx.runMutation(internal.seed.seedVouchersAndLedger, { academyId: academy._id, studentIds, guardianIds });

    // 6. Attendance, assessments/scores, remarks — all real computation.
    await ctx.runMutation(internal.seed.seedAcademics, { academyId: academy._id, batchIds, studentIds });

    // 7. Reminder templates, tone templates, inquiries.
    await ctx.runMutation(internal.seed.seedTemplatesAndInquiries, { academyId: academy._id, guardianIds });

    return {
      ok: true,
      message: `Seeded ${FAMILIES.length + FILLERS.length} families, ${FAMILIES.reduce((s, f) => s + f.kids.length, 0) + FILLERS.length} students, 6 batches, 3 teachers.`,
      credentials,
    };
  },
});

export const insertStaffProfile = internalMutation({
  args: { userId: v.id("users"), academyId: v.id("academies"), role: v.union(v.literal("teacher"), v.literal("parent")), fullName: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    return ctx.db.insert("profiles", { userId: args.userId, academyId: args.academyId, role: args.role, fullName: args.fullName, email: args.email, languagePref: "en", active: true });
  },
});

export const insertBatches = internalMutation({
  args: {
    academyId: v.id("academies"),
    batches: v.array(v.object({ key: v.string(), name: v.string(), subject: v.string(), days: v.array(v.string()), start: v.string(), end: v.string(), tuition: v.number(), teacherId: v.id("profiles") })),
  },
  handler: async (ctx, { academyId, batches }) => {
    const ids: Record<string, Id<"batches">> = {};
    for (const b of batches) {
      const batchId = await ctx.db.insert("batches", { academyId, name: b.name, gradeLevel: undefined, daysOfWeek: b.days, startTime: b.start, endTime: b.end, monthlyTuition: b.tuition, active: true });
      await ctx.db.insert("subjects", { academyId, batchId, name: b.subject });
      await ctx.db.insert("batchTeachers", { batchId, teacherId: b.teacherId });
      ids[b.key] = batchId;
    }
    return ids;
  },
});

export const insertFamiliesAndStudents = internalMutation({
  args: {
    academyId: v.id("academies"),
    batchIds: v.record(v.string(), v.id("batches")),
    developedGuardians: v.array(v.object({ key: v.string(), name: v.string(), email: v.string(), language: v.union(v.literal("en"), v.literal("ur")), userId: v.id("users") })),
    fillerGuardians: v.array(v.object({ key: v.string(), name: v.string(), email: v.string(), language: v.union(v.literal("en"), v.literal("ur")), userId: v.id("users") })),
  },
  handler: async (ctx, args) => {
    const guardianIds: Record<string, Id<"guardians">> = {};
    const studentIds: Record<string, Id<"students">> = {};
    const today = pktToday();
    const oldJoinDate = `${Number(today.slice(0, 4)) - 1}-04-12`;
    const midMonthJoin = `${today.slice(0, 7)}-15`;

    for (const g of [...args.developedGuardians, ...args.fillerGuardians]) {
      guardianIds[g.key] = await ctx.db.insert("guardians", { profileId: await profileIdFor(ctx, g.userId), academyId: args.academyId, name: g.name, phone: undefined, email: g.email, languagePref: g.language, verified: true, remindersPaused: false });
    }

    for (const fam of FAMILIES) {
      for (const kid of fam.kids) {
        const joinedAt = kid.midMonthJoin ? midMonthJoin : oldJoinDate;
        const studentId = await ctx.db.insert("students", { academyId: args.academyId, guardianId: guardianIds[fam.guardianKey], name: kid.name, grade: kid.grade, status: "active", joinedAt, needsFeeReview: !!kid.midMonthJoin });
        await ctx.db.insert("enrollments", { studentId, batchId: args.batchIds[kid.batchKey], startDate: joinedAt });
        studentIds[kid.studentKey] = studentId;
      }
    }
    for (const f of FILLERS) {
      const gKey = `filler-${f.studentKey}`;
      const studentId = await ctx.db.insert("students", { academyId: args.academyId, guardianId: guardianIds[gKey], name: f.name, grade: f.grade, status: "active", joinedAt: oldJoinDate, needsFeeReview: false });
      await ctx.db.insert("enrollments", { studentId, batchId: args.batchIds[f.batchKey], startDate: oldJoinDate });
      studentIds[f.studentKey] = studentId;
    }

    return { studentIds, guardianIds };
  },
});

async function profileIdFor(ctx: MutationCtx, userId: Id<"users">): Promise<Id<"profiles">> {
  const profile = await ctx.db.query("profiles").withIndex("by_userId", (q) => q.eq("userId", userId)).unique();
  if (!profile) throw new Error("Profile not found for user — createAccount + insertStaffProfile must run before insertFamiliesAndStudents.");
  return profile._id;
}

/** Insert a ledger 'payment' entry and update voucher status — the seed-time equivalent of vouchers.recordCashPayment, without the admin-auth gate (nothing calling this has a signed-in caller). */
async function seedPayment(ctx: MutationCtx, voucherId: Id<"vouchers">, amount: number, method: "cash" | "stripe") {
  const voucher = await ctx.db.get(voucherId);
  if (!voucher) return;
  await ctx.db.insert("ledgerEntries", { academyId: voucher.academyId, guardianId: voucher.guardianId, studentId: voucher.studentId, voucherId, kind: "payment", amount, method, receiptNumber: method === "cash" ? `R-${Date.now().toString(36).toUpperCase()}` : undefined, stripeEventId: method === "stripe" ? `evt_seed_${randomToken().slice(0, 12)}` : undefined });
  const entries = await ctx.db.query("ledgerEntries").withIndex("by_voucher", (q) => q.eq("voucherId", voucherId)).collect();
  const paid = entries.filter((e) => e.kind === "payment").reduce((s, e) => s + e.amount, 0);
  await ctx.db.patch(voucherId, { status: paid >= voucher.total ? "paid" : paid > 0 ? "partial" : "unpaid" });
}

/** Real fee-engine computation + insert, bypassing createVoucherRecord's own idempotency re-check (already guaranteed fresh here) so it can run inside this bulk mutation directly. */
async function seedVoucher(ctx: MutationCtx, studentId: Id<"students">, period: string) {
  const student = await ctx.db.get(studentId);
  if (!student) return null;
  const feeRules = await ctx.db.query("feeRules").withIndex("by_academy", (q) => q.eq("academyId", student.academyId)).unique();
  if (!feeRules) throw new Error("Fee rules missing.");
  const result = await computeVoucherForStudent(ctx, studentId, period, feeRules);
  if (!result.ok) return null;
  const voucherId = await ctx.db.insert("vouchers", {
    academyId: student.academyId, studentId, guardianId: result.voucher.guardianId, period,
    lineItems: result.voucher.lineItems, tuitionAmount: result.voucher.tuitionAmount, siblingDiscount: result.voucher.siblingDiscount,
    arrears: result.voucher.arrears, fines: 0, total: result.voucher.total, dueDate: result.voucher.dueDate,
    status: "unpaid", token: randomToken(), ruleSnapshot: result.voucher.ruleSnapshot, generatedAt: Date.now(),
  });
  await ctx.db.insert("ledgerEntries", { academyId: student.academyId, guardianId: result.voucher.guardianId, studentId, voucherId, kind: "voucher", amount: -result.voucher.total });
  return voucherId;
}

export const seedVouchersAndLedger = internalMutation({
  args: { academyId: v.id("academies"), studentIds: v.record(v.string(), v.id("students")), guardianIds: v.record(v.string(), v.id("guardians")) },
  handler: async (ctx, { studentIds }) => {
    const current = pktToday().slice(0, 7);
    const prior = priorPeriodOf(current);

    // Arrears storyline: an unpaid prior-period voucher for these 4, with a
    // late fine applied (its due date — last month's — is safely in the
    // past regardless of what day it really is today).
    const arrearsStudents = ["ayesha", "bilal", "omar", "ibrahim"];
    for (const key of arrearsStudents) {
      const priorId = await seedVoucher(ctx, studentIds[key], prior);
      if (!priorId) continue;
      const v = await ctx.db.get(priorId);
      if (v) {
        const fine = v.ruleSnapshot.lateFineType === "flat" ? v.ruleSnapshot.lateFineValue : Math.round(v.total * (v.ruleSnapshot.lateFineValue / 100));
        await ctx.db.insert("ledgerEntries", { academyId: v.academyId, guardianId: v.guardianId, studentId: v.studentId, voucherId: priorId, kind: "fine", amount: -fine, reason: "late_fine" });
        await ctx.db.patch(priorId, { fines: fine, total: v.total + fine });
      }
    }

    // Current-period voucher for every student (arrears from the step above
    // flow in automatically for the 4 above), then apply the payment story.
    const payFull = new Set(["fatima", "zainab", "usman", "maryam", "sara", "noorfatima"]);
    const payHalf = new Set(["hassan", "hira", "ali"]);
    for (const key of Object.keys(studentIds)) {
      const voucherId = await seedVoucher(ctx, studentIds[key], current);
      if (!voucherId) continue;
      if (payFull.has(key) || key.startsWith("f-")) {
        const v = await ctx.db.get(voucherId);
        if (v) await seedPayment(ctx, voucherId, v.total, Math.random() > 0.5 ? "stripe" : "cash");
      } else if (payHalf.has(key)) {
        const v = await ctx.db.get(voucherId);
        if (v) await seedPayment(ctx, voucherId, Math.round(v.total / 2), "cash");
      }
      // "ayesha"/"bilal"/"omar"/"ibrahim" (unpaid, arrears already included)
      // and "danish" (mid-month join, unpaid, current) are left as-is.
    }
  },
});

export const seedAcademics = internalMutation({
  args: { academyId: v.id("academies"), batchIds: v.record(v.string(), v.id("batches")), studentIds: v.record(v.string(), v.id("students")) },
  handler: async (ctx, { batchIds, studentIds }) => {
    const today = pktToday();
    const period = today.slice(0, 7);
    const someoneMarkedBy = async (batchId: Id<"batches">) => {
      const bt = await ctx.db.query("batchTeachers").withIndex("by_batch", (q) => q.eq("batchId", batchId)).first();
      return bt!.teacherId;
    };

    // Today's attendance — 3 of 6 batches marked, 3 left pending.
    const rosterOf = async (batchId: Id<"batches">) => {
      const rows = await ctx.db.query("enrollments").withIndex("by_batch", (q) => q.eq("batchId", batchId)).collect();
      return rows.filter((r) => !r.endDate);
    };
    for (const key of ["9b", "olevel", "7a"] as const) {
      const batchId = batchIds[key];
      const markedBy = await someoneMarkedBy(batchId);
      const roster = await rosterOf(batchId);
      for (let i = 0; i < roster.length; i++) {
        const status = i === 0 ? "absent" : i === 1 ? "late" : "present";
        const student = await ctx.db.get(roster[i].studentId);
        await ctx.db.insert("attendance", { academyId: student!.academyId, studentId: roster[i].studentId, batchId, date: today, status, markedBy });
      }
    }
    // A little history for the two most-referenced students, so their
    // attendance % isn't a trivial 100 — a couple of prior weekdays this month.
    const historyFor = async (studentKey: string, batchKey: string, absentOnFirst: boolean) => {
      const batchId = batchIds[batchKey];
      const markedBy = await someoneMarkedBy(batchId);
      const [y, m] = period.split("-").map(Number);
      let added = 0;
      for (let day = 1; day < Number(today.slice(8, 10)) && added < 3; day++) {
        const dow = new Date(y, m - 1, day).getDay();
        if (dow === 0 || dow === 6) continue;
        const iso = `${period}-${String(day).padStart(2, "0")}`;
        await ctx.db.insert("attendance", { academyId: (await ctx.db.get(studentIds[studentKey]))!.academyId, studentId: studentIds[studentKey], batchId, date: iso, status: added === 0 && absentOnFirst ? "absent" : "present", markedBy });
        added += 1;
      }
    };
    await historyFor("ayesha", "9b", true);
    await historyFor("bilal", "7a", true);
    await historyFor("omar", "9b", true);

    // Assessments + scores.
    const subjectFor = async (batchId: Id<"batches">) => (await ctx.db.query("subjects").withIndex("by_batch", (q) => q.eq("batchId", batchId)).first())!;

    const nineB = batchIds["9b"];
    const nineBSubject = await subjectFor(nineB);
    const nineBTeacher = await someoneMarkedBy(nineB);
    const nineBAssessment = await ctx.db.insert("assessments", { academyId: (await ctx.db.get(nineB))!.academyId, batchId: nineB, subjectId: nineBSubject._id, date: today, maxMarks: 100, published: false, createdBy: nineBTeacher });
    const nineBMarks: Record<string, number> = { ayesha: 82, hassan: 61, omar: 48, noorfatima: 90 };
    for (const e of await rosterOf(nineB)) {
      const key = Object.keys(studentIds).find((k) => studentIds[k] === e.studentId)!;
      const obtained = nineBMarks[key] ?? 65 + Math.floor(Math.random() * 20);
      await ctx.db.insert("scores", { assessmentId: nineBAssessment, studentId: e.studentId, obtained, absent: false });
    }
    await ctx.db.patch(nineBAssessment, { published: true });

    const sevenA = batchIds["7a"];
    const sevenASubject = await subjectFor(sevenA);
    const sevenATeacher = await someoneMarkedBy(sevenA);
    const sevenAAssessment = await ctx.db.insert("assessments", { academyId: (await ctx.db.get(sevenA))!.academyId, batchId: sevenA, subjectId: sevenASubject._id, date: today, maxMarks: 100, published: false, createdBy: sevenATeacher });
    const sevenAMarks: Record<string, number> = { bilal: 79, maryam: 71 };
    for (const e of await rosterOf(sevenA)) {
      const key = Object.keys(studentIds).find((k) => studentIds[k] === e.studentId)!;
      const obtained = sevenAMarks[key] ?? 60 + Math.floor(Math.random() * 25);
      await ctx.db.insert("scores", { assessmentId: sevenAAssessment, studentId: e.studentId, obtained, absent: false });
    }
    await ctx.db.patch(sevenAAssessment, { published: true });

    // One unpublished draft, partially scored, to show that state.
    const eightC = batchIds["8c"];
    const eightCSubject = await subjectFor(eightC);
    const eightCTeacher = await someoneMarkedBy(eightC);
    const draftAssessment = await ctx.db.insert("assessments", { academyId: (await ctx.db.get(eightC))!.academyId, batchId: eightC, subjectId: eightCSubject._id, date: today, maxMarks: 100, published: false, createdBy: eightCTeacher });
    await ctx.db.insert("scores", { assessmentId: draftAssessment, studentId: studentIds["zainab"], obtained: 88, absent: false });
    await ctx.db.insert("scores", { assessmentId: draftAssessment, studentId: studentIds["ali"], obtained: 66, absent: false });

    // Remarks — real data-pack builder + real draft composer, for a few
    // representative students. Ayesha/Omar become drafts, Danish is a
    // genuine low-data case (mid-month joiner), Zainab is pre-approved.
    for (const key of ["ayesha", "omar", "zainab"]) {
      const student = await ctx.db.get(studentIds[key]);
      if (!student) continue;
      const guardian = await ctx.db.get(student.guardianId);
      const language = guardian?.languagePref ?? "en";
      const pack = await buildDataPack(ctx, studentIds[key], period);
      const result = language === "ur" ? draftUrduText(pack, student.name) : draftText(pack, student.name);
      const approved = key === "zainab";
      await ctx.db.insert("remarks", {
        academyId: student.academyId, studentId: studentIds[key], period,
        draftText: result.text, finalText: approved ? result.text : undefined, language,
        status: pack.lowData ? "low_data" : approved ? "approved" : "draft",
        lowDataReason: pack.lowDataReason ?? undefined, source: result.source, dataPack: pack,
        approvedBy: approved ? nineBTeacher : undefined, approvedAt: approved ? Date.now() : undefined,
      });
    }
    // Danish — genuine low-data remark (mid-month joiner, no tests yet).
    const danish = await ctx.db.get(studentIds["danish"]);
    if (danish) {
      const pack = await buildDataPack(ctx, studentIds["danish"], period);
      const result = draftUrduText(pack, danish.name);
      await ctx.db.insert("remarks", { academyId: danish.academyId, studentId: studentIds["danish"], period, draftText: result.text, language: "ur", status: "low_data", lowDataReason: pack.lowDataReason ?? "Joined mid-month", source: result.source, dataPack: pack });
    }
  },
});

export const seedTemplatesAndInquiries = internalMutation({
  args: { academyId: v.id("academies"), guardianIds: v.record(v.string(), v.id("guardians")) },
  handler: async (ctx, { academyId, guardianIds }) => {
    const templates: { bucket: "due_date" | "7d_gentle" | "14d_firm" | "30d_final"; language: "en" | "ur"; subject: string; body: string }[] = [
      { bucket: "due_date", language: "en", subject: "{{studentName}}'s fee voucher — due {{dueDate}}", body: "Assalam-o-alaikum {{guardianName}},\n\n{{studentName}}'s fee voucher for {{period}} of PKR {{amount}} is due on {{dueDate}}.\n\nBreakdown: {{itemization}}\nPay online: {{payUrl}}\n\nBright Future Academy" },
      { bucket: "7d_gentle", language: "en", subject: "A gentle reminder — PKR {{amount}} outstanding", body: "Assalam-o-alaikum {{guardianName}},\n\nWe have not yet received PKR {{amount}} for {{studentName}}'s {{period}} voucher. It may simply have been missed.\n\nPay online: {{payUrl}}\n\nIf already paid, please ignore this message." },
      { bucket: "14d_firm", language: "en", subject: "PKR {{amount}} now {{daysOverdue}} days overdue", body: "Assalam-o-alaikum {{guardianName}},\n\n{{studentName}} now has PKR {{amount}} outstanding, {{daysOverdue}} days overdue.\n\nPlease clear the balance or contact the front desk this week: {{payUrl}}" },
      { bucket: "30d_final", language: "en", subject: "Final notice — PKR {{amount}} outstanding", body: "Assalam-o-alaikum {{guardianName}},\n\nPKR {{amount}} has been outstanding for {{daysOverdue}} days. This is a final notice before the account is referred to the academy owner.\n\nPlease contact the front desk today: {{payUrl}}" },
      { bucket: "due_date", language: "ur", subject: "{{studentName}} کا فیس واؤچر — {{dueDate}} تک", body: "السلام علیکم {{guardianName}}،\n\n{{studentName}} کا {{period}} کا فیس واؤچر PKR {{amount}} کا ہے، جس کی آخری تاریخ {{dueDate}} ہے۔\n\nتفصیل: {{itemization}}\nآن لائن ادائیگی: {{payUrl}}" },
      { bucket: "7d_gentle", language: "ur", subject: "نرم یاد دہانی — PKR {{amount}} باقی", body: "السلام علیکم {{guardianName}}،\n\nہمیں ابھی تک {{studentName}} کے {{period}} کے واؤچر کی PKR {{amount}} وصول نہیں ہوئی۔\n\nآن لائن ادائیگی: {{payUrl}}" },
      { bucket: "14d_firm", language: "ur", subject: "PKR {{amount}} اب {{daysOverdue}} دن سے زیر التوا", body: "السلام علیکم {{guardianName}}،\n\n{{studentName}} پر اب PKR {{amount}} باقی ہیں، {{daysOverdue}} دن سے۔\n\nبراہ کرم فرنٹ ڈیسک سے رابطہ کریں: {{payUrl}}" },
      { bucket: "30d_final", language: "ur", subject: "آخری نوٹس — PKR {{amount}} باقی", body: "السلام علیکم {{guardianName}}،\n\nPKR {{amount}} گزشتہ {{daysOverdue}} دن سے باقی ہیں۔ یہ اکاؤنٹ کو مالک کے پاس بھیجنے سے پہلے آخری نوٹس ہے۔\n\nآج ہی فرنٹ ڈیسک سے رابطہ کریں: {{payUrl}}" },
    ];
    for (const t of templates) {
      await ctx.db.insert("reminderTemplates", { academyId, bucket: t.bucket, language: t.language, templateVersion: 1, subjectLine: t.subject, body: t.body, active: true });
    }

    await ctx.db.insert("remarkToneTemplates", { academyId, language: "en", version: 1, tone: "Warm, specific, and grounded only in the numbers provided. Never invent a fact.", active: true });
    await ctx.db.insert("remarkToneTemplates", { academyId, language: "ur", version: 1, tone: "گرمجوشی، مخصوص، اور صرف فراہم کردہ اعداد و شمار پر مبنی۔", active: true });

    const inquiries: { guardianKey: string; topic: string; message: string }[] = [
      { guardianKey: "asma", topic: "Fee waiver", message: "I want to ask about a fee concession for Ibrahim. My husband lost his job and I cannot pay the full amount this month." },
      { guardianKey: "rukhsana", topic: "Schedule change", message: "Can Maryam move from the 5pm Maths batch to an earlier one? She has school transport issues in the evening." },
      { guardianKey: "tariq", topic: "Complaint", message: "Omar says the physics teacher went through three chapters in one week. Can someone call me about this?" },
    ];
    for (const q of inquiries) {
      await ctx.db.insert("inquiries", { academyId, guardianId: guardianIds[q.guardianKey], topic: q.topic, message: q.message, status: "open" });
    }
  },
});
