import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { createAccount } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";
import { pktToday } from "./lib/authz";

/**
 * Demo-data seeding — populates the "Bright Future Academy" dataset through
 * the *real* write paths (createAccount, generateVouchers, recordCashPayment,
 * draftForPeriod, ...) rather than hand-crafted documents, so every number
 * on screen after this runs is something the actual system computed.
 *
 * Run once, after `seed:bootstrapAdmin`:
 *   npx convex run seedDemo:seedDemoData '{}'
 *
 * Idempotent: refuses to run a second time once batches exist.
 * Every seeded account shares one demo password: "academy1234".
 */

const DEMO_PASSWORD = "academy1234";

// ---------------------------------------------------------------------------
// Small internal reads/writes used only by the orchestrator below. All
// `export`ed — an unexported internalQuery/internalMutation compiles fine
// but fails at runtime the moment `internal.seedDemo.x` is called.
// ---------------------------------------------------------------------------

export const getAcademy = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("academies").first(),
});

export const alreadySeeded = internalQuery({
  args: { academyId: v.id("academies") },
  handler: async (ctx, { academyId }) => {
    const batch = await ctx.db
      .query("batches")
      .withIndex("by_academy", (q) => q.eq("academyId", academyId))
      .first();
    return batch !== null;
  },
});

export const insertProfile = internalMutation({
  args: {
    userId: v.id("users"),
    academyId: v.id("academies"),
    role: v.union(v.literal("teacher"), v.literal("parent")),
    fullName: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    languagePref: v.union(v.literal("en"), v.literal("ur")),
  },
  handler: async (ctx, args) => {
    const profileId = await ctx.db.insert("profiles", {
      userId: args.userId,
      academyId: args.academyId,
      role: args.role,
      fullName: args.fullName,
      email: args.email,
      phone: args.phone,
      languagePref: args.languagePref,
      active: true,
    });
    let guardianId: Id<"guardians"> | null = null;
    if (args.role === "parent") {
      guardianId = await ctx.db.insert("guardians", {
        profileId,
        academyId: args.academyId,
        name: args.fullName,
        phone: args.phone,
        email: args.email,
        languagePref: args.languagePref,
        verified: true,
        remindersPaused: false,
      });
    }
    return { profileId, guardianId };
  },
});

export const insertBatch = internalMutation({
  args: {
    academyId: v.id("academies"),
    name: v.string(),
    subjectName: v.string(),
    daysOfWeek: v.array(v.string()),
    startTime: v.string(),
    monthlyTuition: v.number(),
    teacherId: v.id("profiles"),
  },
  handler: async (ctx, args) => {
    const batchId = await ctx.db.insert("batches", {
      academyId: args.academyId,
      name: args.name,
      daysOfWeek: args.daysOfWeek,
      startTime: args.startTime,
      monthlyTuition: args.monthlyTuition,
      active: true,
    });
    const subjectId = await ctx.db.insert("subjects", { academyId: args.academyId, batchId, name: args.subjectName });
    await ctx.db.insert("batchTeachers", { batchId, teacherId: args.teacherId });
    return { batchId, subjectId };
  },
});

export const insertStudent = internalMutation({
  args: {
    academyId: v.id("academies"),
    guardianId: v.id("guardians"),
    name: v.string(),
    grade: v.string(),
    batchId: v.id("batches"),
    joinedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const studentId = await ctx.db.insert("students", {
      academyId: args.academyId,
      guardianId: args.guardianId,
      name: args.name,
      grade: args.grade,
      status: "active",
      joinedAt: args.joinedAt,
      needsFeeReview: false,
    });
    await ctx.db.insert("enrollments", { studentId, batchId: args.batchId, startDate: args.joinedAt });
    return studentId;
  },
});

export const insertAttendance = internalMutation({
  args: {
    academyId: v.id("academies"),
    studentId: v.id("students"),
    batchId: v.id("batches"),
    date: v.string(),
    status: v.union(v.literal("present"), v.literal("absent"), v.literal("late"), v.literal("leave")),
    markedBy: v.id("profiles"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("attendance")
      .withIndex("by_student_and_batch_and_date", (q) => q.eq("studentId", args.studentId).eq("batchId", args.batchId).eq("date", args.date))
      .unique();
    if (existing) return;
    await ctx.db.insert("attendance", {
      academyId: args.academyId,
      studentId: args.studentId,
      batchId: args.batchId,
      date: args.date,
      status: args.status,
      markedBy: args.markedBy,
    });
  },
});

export const insertAssessment = internalMutation({
  args: {
    academyId: v.id("academies"),
    batchId: v.id("batches"),
    subjectId: v.id("subjects"),
    date: v.string(),
    maxMarks: v.number(),
    published: v.boolean(),
    createdBy: v.id("profiles"),
    scores: v.array(v.object({ studentId: v.id("students"), obtained: v.optional(v.number()), absent: v.boolean() })),
  },
  handler: async (ctx, args) => {
    const assessmentId = await ctx.db.insert("assessments", {
      academyId: args.academyId,
      batchId: args.batchId,
      subjectId: args.subjectId,
      date: args.date,
      maxMarks: args.maxMarks,
      published: args.published,
      createdBy: args.createdBy,
    });
    for (const s of args.scores) {
      await ctx.db.insert("scores", { assessmentId, studentId: s.studentId, obtained: s.obtained, absent: s.absent });
    }
    return assessmentId;
  },
});

export const listStudentsByGuardian = internalQuery({
  args: { guardianId: v.id("guardians") },
  handler: async (ctx, { guardianId }) =>
    ctx.db
      .query("students")
      .withIndex("by_guardian", (q) => q.eq("guardianId", guardianId))
      .collect(),
});

export const listVouchersForStudent = internalQuery({
  args: { studentId: v.id("students"), period: v.string() },
  handler: async (ctx, { studentId, period }) =>
    ctx.db
      .query("vouchers")
      .withIndex("by_student_and_period", (q) => q.eq("studentId", studentId).eq("period", period))
      .unique(),
});

export const insertReminderTemplate = internalMutation({
  args: {
    academyId: v.id("academies"),
    bucket: v.union(v.literal("due_date"), v.literal("7d_gentle"), v.literal("14d_firm"), v.literal("30d_final")),
    language: v.union(v.literal("en"), v.literal("ur")),
    subjectLine: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("reminderTemplates")
      .withIndex("by_academy_and_bucket_and_language_and_active", (q) =>
        q.eq("academyId", args.academyId).eq("bucket", args.bucket).eq("language", args.language).eq("active", true)
      )
      .unique();
    if (existing) return;
    await ctx.db.insert("reminderTemplates", {
      academyId: args.academyId,
      bucket: args.bucket,
      language: args.language,
      subjectLine: args.subjectLine,
      body: args.body,
      templateVersion: 1,
      active: true,
    });
  },
});

/**
 * One-time backfill for deployments seeded before Urdu reminder templates
 * existed (insertReminderTemplate is idempotent, so this is safe to re-run):
 *   npx convex run seedDemo:backfillUrduReminderTemplates '{}'
 */
export const backfillUrduReminderTemplates = action({
  args: {},
  handler: async (ctx) => {
    const academy = await ctx.runQuery(internal.seedDemo.getAcademy, {});
    if (!academy) throw new Error("No academy found — run seed:bootstrapAdmin first.");
    const templates: Array<{ bucket: "due_date" | "7d_gentle" | "14d_firm" | "30d_final"; subjectLine: string; body: string }> = [
      {
        bucket: "due_date",
        subjectLine: "فیس واجب الادا — {{studentName}}",
        body: "السلام علیکم {{guardianName}}،\n\n{{studentName}} کی {{period}} کی فیس PKR {{amount}} کی رقم {{dueDate}} کو واجب الادا ہے۔\n\nتفصیل: {{itemization}}\nآن لائن ادائیگی: {{payUrl}}\n\nBright Future Academy",
      },
      {
        bucket: "7d_gentle",
        subjectLine: "نرم یاددہانی — {{studentName}}",
        body: "السلام علیکم {{guardianName}}،\n\n{{studentName}} کی {{period}} کی فیس PKR {{amount}} ابھی تک وصول نہیں ہوئی۔ ہو سکتا ہے یہ محض نظر انداز ہو گئی ہو۔\n\nباقی رقم: {{itemization}}\nآن لائن ادائیگی: {{payUrl}}\n\nاگر ادائیگی ہو چکی ہے تو براہ کرم اس پیغام کو نظر انداز کریں۔",
      },
      {
        bucket: "14d_firm",
        subjectLine: "براہ کرم بقایا جات ادا کریں — {{studentName}}",
        body: "السلام علیکم {{guardianName}}،\n\n{{studentName}} پر اب PKR {{amount}} بقایا ہے ({{daysOverdue}} دن سے زائد)۔\n\nبراہ کرم بقایا رقم ادا کریں یا اس ہفتے ادائیگی کی تاریخ سے آگاہ کریں تاکہ ریکارڈ میں درج کی جا سکے۔\nآن لائن ادائیگی: {{payUrl}}",
      },
      {
        bucket: "30d_final",
        subjectLine: "آخری نوٹس — {{studentName}}",
        body: "السلام علیکم {{guardianName}}،\n\nPKR {{amount}} کی رقم 30 دن سے زائد عرصے سے باقی ہے ({{daysOverdue}} دن)۔ یہ اکاؤنٹ کو اکیڈمی مالک کے پاس بھجوانے سے پہلے کا آخری نوٹس ہے۔\n\nبراہ کرم آج ہی فرنٹ ڈیسک سے رابطہ کر کے قسطوں کا منصوبہ طے کریں۔\nآن لائن ادائیگی: {{payUrl}}",
      },
    ];
    for (const t of templates) {
      await ctx.runMutation(internal.seedDemo.insertReminderTemplate, { academyId: academy._id, bucket: t.bucket, language: "ur", subjectLine: t.subjectLine, body: t.body });
    }
    return { ok: true };
  },
});

export const approveRemarkAsTeacher = internalMutation({
  args: { studentId: v.id("students"), period: v.string(), teacherId: v.id("profiles") },
  handler: async (ctx, args) => {
    const remark = await ctx.db
      .query("remarks")
      .withIndex("by_student_and_period", (q) => q.eq("studentId", args.studentId).eq("period", args.period))
      .unique();
    if (!remark || remark.status !== "draft") return false;
    await ctx.db.patch(remark._id, { status: "approved", finalText: remark.draftText, approvedBy: args.teacherId, approvedAt: Date.now() });
    return true;
  },
});

export const insertInquiry = internalMutation({
  args: { academyId: v.id("academies"), guardianId: v.id("guardians"), topic: v.string(), message: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("inquiries", { academyId: args.academyId, guardianId: args.guardianId, topic: args.topic, message: args.message, status: "open" });
  },
});

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

async function makeAccount(ctx: any, email: string, fullName: string): Promise<Id<"users">> {
  const { user } = await createAccount(ctx, {
    provider: "password",
    account: { id: email, secret: DEMO_PASSWORD },
    profile: { email, name: fullName },
  });
  return user._id;
}

const FILLER_FIRST = ["Zohaib", "Mahnoor", "Talha", "Areeba", "Faizan", "Kiran", "Saad", "Laiba", "Hafsa", "Musa", "Anaya", "Rayan", "Eman", "Hamza", "Aiza", "Rehan", "Sumaiya", "Arham", "Zoya", "Haris", "Amna", "Hamna", "Ahsan", "Wania", "Zaid", "Alina", "Rida", "Junaid", "Mishal", "Umer", "Iqra", "Taha", "Sana", "Bilawal", "Hamid", "Mehak", "Zubair", "Komal", "Salman", "Wasi"];
const FILLER_LAST = ["Anwar", "Aslam", "Siddiqui", "Nawaz", "Tariq", "Shah", "Bashir", "Yousaf", "Rehman", "Kamal", "Waqar", "Shafiq", "Zubair", "Nadeem", "Rauf", "Aziz", "Bhatti", "Sohail", "Kamran", "Munir", "Latif", "Siddique", "Riaz", "Shoukat", "Mehmood", "Farooqi", "Akhtar", "Tahir", "Saleem", "Mirza", "Ilyas", "Chaudhry", "Sarwar", "Jafri", "Alam", "Durrani"];

/**
 * Local-testing convenience: mint a teacher (or parent) you can sign in as
 * immediately, skipping the emailed first-login code.
 *
 *   npx convex run seedDemo:devCreateAccount '{"email":"t@x.pk","fullName":"Test Teacher","role":"teacher"}'
 *
 * An internalAction on purpose — internal functions are unreachable from any
 * client, so this can never be called from a browser. Password is the shared
 * demo one ("academy1234"). Never expose this as a public function.
 */
export const devCreateAccount = internalAction({
  args: {
    email: v.string(),
    fullName: v.string(),
    role: v.union(v.literal("teacher"), v.literal("parent")),
    batchId: v.optional(v.id("batches")),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; message: string }> => {
    const academy = await ctx.runQuery(internal.seedDemo.getAcademy, {});
    if (!academy) return { ok: false, message: "No academy — run seed:bootstrapAdmin first." };
    const email = args.email.trim().toLowerCase();
    const existing = await ctx.runQuery(internal.auth.findProfileByEmail, { email });
    if (existing) return { ok: false, message: "An account already exists for that email." };

    const userId = await makeAccount(ctx, email, args.fullName);
    await ctx.runMutation(internal.auth.finishProvisioning, {
      userId,
      academyId: academy._id,
      role: args.role,
      fullName: args.fullName,
      email,
      languagePref: "en",
    });
    if (args.batchId && args.role === "teacher") {
      await ctx.runMutation(internal.seedDemo.assignTeacherToBatch, { batchId: args.batchId, email });
    }
    return { ok: true, message: `${args.fullName} created — sign in as ${email} / ${DEMO_PASSWORD}` };
  },
});

/**
 * Teardown for devCreateAccount — removes one account and its auth rows by
 * email, leaving all other data alone.
 *
 *   npx convex run seedDemo:devDeleteAccount '{"email":"t@x.pk"}'
 *
 * Refuses to touch an admin, so you can't lock yourself out.
 */
export const devDeleteAccount = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }): Promise<{ ok: boolean; message: string }> => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_email", (q) => q.eq("email", email.trim().toLowerCase()))
      .unique();
    if (!profile) return { ok: false, message: "No account with that email." };
    if (profile.role === "admin") return { ok: false, message: "Refusing to delete an admin account." };

    for (const row of await ctx.db.query("batchTeachers").collect()) {
      if (row.teacherId === profile._id) await ctx.db.delete(row._id);
    }
    const guardian = await ctx.db
      .query("guardians")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .unique();
    if (guardian) {
      const kids = await ctx.db
        .query("students")
        .withIndex("by_guardian", (q) => q.eq("guardianId", guardian._id))
        .collect();
      if (kids.length > 0) return { ok: false, message: `That parent still has ${kids.length} student(s) enrolled — remove them first.` };
      await ctx.db.delete(guardian._id);
    }
    for (const acc of await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", profile.userId))
      .collect()) {
      await ctx.db.delete(acc._id);
    }
    for (const session of await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", profile.userId))
      .collect()) {
      for (const rt of await ctx.db
        .query("authRefreshTokens")
        .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
        .collect()) {
        await ctx.db.delete(rt._id);
      }
      await ctx.db.delete(session._id);
    }
    await ctx.db.delete(profile.userId);
    await ctx.db.delete(profile._id);
    return { ok: true, message: `${profile.fullName} removed.` };
  },
});

export const assignTeacherToBatch = internalMutation({
  args: { batchId: v.id("batches"), email: v.string() },
  handler: async (ctx, { batchId, email }) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (!profile) return;
    const existing = await ctx.db
      .query("batchTeachers")
      .withIndex("by_batch_and_teacher", (q) => q.eq("batchId", batchId).eq("teacherId", profile._id))
      .unique();
    if (!existing) await ctx.db.insert("batchTeachers", { batchId, teacherId: profile._id });
  },
});

export const seedDemoData = action({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean; message: string; counts?: Record<string, number> }> => {
    const academyDoc = await ctx.runQuery(internal.seedDemo.getAcademy, {});
    if (!academyDoc) return { ok: false, message: "No academy yet — run seed:bootstrapAdmin first." };
    const academy = { _id: academyDoc._id };
    const seeded = await ctx.runQuery(internal.seedDemo.alreadySeeded, { academyId: academy._id });
    if (seeded) return { ok: false, message: "Already seeded — batches already exist for this academy." };

    // --- teachers -----------------------------------------------------
    const teacherDefs = [
      { name: "Sana Iqbal", email: "sana.iqbal@brightfuture.pk" },
      { name: "Rabia Noor", email: "rabia.noor@brightfuture.pk" },
      { name: "Adnan Malik", email: "adnan.malik@brightfuture.pk" },
    ];
    const teacherIds: Record<string, Id<"profiles">> = {};
    for (const t of teacherDefs) {
      const userId = await makeAccount(ctx, t.email, t.name);
      const { profileId } = await ctx.runMutation(internal.seedDemo.insertProfile, { userId, academyId: academy._id, role: "teacher", fullName: t.name, email: t.email, languagePref: "en" });
      teacherIds[t.name] = profileId;
    }

    // --- batches --------------------------------------------------------
    const batchDefs = [
      { name: "Class 9-B Science", subject: "Physics", days: ["Mon", "Tue", "Wed", "Thu"], time: "16:00", tuition: 4500, teacher: "Sana Iqbal" },
      { name: "O-Level Physics", subject: "Physics", days: ["Mon", "Tue", "Wed", "Thu"], time: "16:00", tuition: 4500, teacher: "Adnan Malik" },
      { name: "Class 7-A Maths", subject: "Maths", days: ["Mon", "Wed", "Fri"], time: "17:00", tuition: 4500, teacher: "Rabia Noor" },
      { name: "Class 8-C English", subject: "English", days: ["Tue", "Thu"], time: "17:00", tuition: 4500, teacher: "Sana Iqbal" },
      { name: "Class 6-A Maths", subject: "Maths", days: ["Mon", "Wed", "Fri"], time: "18:00", tuition: 4000, teacher: "Rabia Noor" },
      { name: "Class 10-A Chemistry", subject: "Chemistry", days: ["Tue", "Thu"], time: "18:00", tuition: 5000, teacher: "Adnan Malik" },
    ] as const;
    const batchIds: Record<string, Id<"batches">> = {};
    const subjectIds: Record<string, Id<"subjects">> = {};
    for (const b of batchDefs) {
      const { batchId, subjectId } = await ctx.runMutation(internal.seedDemo.insertBatch, {
        academyId: academy._id,
        name: b.name,
        subjectName: b.subject,
        daysOfWeek: [...b.days],
        startTime: b.time,
        monthlyTuition: b.tuition,
        teacherId: teacherIds[b.teacher],
      });
      batchIds[b.name] = batchId;
      subjectIds[b.name] = subjectId;
    }

    const JOIN_DATE = "2025-04-12";

    // --- 10 developed families ------------------------------------------
    const families = [
      { guardian: "Khalid Ahmed", phone: "1111001", lang: "en", kids: [{ name: "Ayesha Khan", grade: "9", batch: "Class 9-B Science" }, { name: "Bilal Ahmed", grade: "7", batch: "Class 7-A Maths" }] },
      { guardian: "Nadia Sheikh", phone: "1111002", lang: "en", kids: [{ name: "Fatima Sheikh", grade: "10", batch: "O-Level Physics" }] },
      { guardian: "Imran Raza", phone: "1111003", lang: "en", kids: [{ name: "Hassan Raza", grade: "9", batch: "Class 9-B Science" }] },
      { guardian: "Sadia Malik", phone: "1111004", lang: "ur", kids: [{ name: "Zainab Malik", grade: "8", batch: "Class 8-C English" }, { name: "Usman Malik", grade: "10", batch: "O-Level Physics" }, { name: "Hira Malik", grade: "6", batch: "Class 6-A Maths" }] },
      { guardian: "Tariq Farooq", phone: "1111005", lang: "ur", kids: [{ name: "Omar Farooq", grade: "9", batch: "Class 9-B Science" }] },
      { guardian: "Rukhsana Javed", phone: "1111006", lang: "en", kids: [{ name: "Maryam Javed", grade: "7", batch: "Class 7-A Maths" }] },
      { guardian: "Shahid Hamza", phone: "1111007", lang: "en", kids: [{ name: "Ali Hamza", grade: "8", batch: "Class 8-C English" }, { name: "Sara Hamza", grade: "10", batch: "O-Level Physics" }] },
      { guardian: "Asma Qureshi", phone: "1111008", lang: "ur", kids: [{ name: "Ibrahim Qureshi", grade: "6", batch: "Class 6-A Maths" }] },
      { guardian: "Kashif Butt", phone: "1111009", lang: "en", kids: [{ name: "Noor Fatima", grade: "9", batch: "Class 9-B Science" }] },
      { guardian: "Farah Iqbal", phone: "1111010", lang: "ur", kids: [{ name: "Danish Iqbal", grade: "8", batch: "Class 8-C English" }] },
    ] as const;

    const studentIds: Record<string, Id<"students">> = {};
    const studentBatch: Record<string, string> = {};
    const guardianIds: Record<string, Id<"guardians">> = {};
    let studentCount = 0;
    let guardianCount = 0;

    for (const fam of families) {
      const email = `${fam.guardian.toLowerCase().replace(/\s+/g, ".")}@gmail.com`;
      const userId = await makeAccount(ctx, email, fam.guardian);
      const { guardianId } = await ctx.runMutation(internal.seedDemo.insertProfile, {
        userId,
        academyId: academy._id,
        role: "parent",
        fullName: fam.guardian,
        email,
        phone: `+92 300 ${fam.phone}`,
        languagePref: fam.lang,
      });
      guardianIds[fam.guardian] = guardianId!;
      guardianCount += 1;
      for (const kid of fam.kids) {
        const studentId: Id<"students"> = await ctx.runMutation(internal.seedDemo.insertStudent, {
          academyId: academy._id,
          guardianId: guardianId!,
          name: kid.name,
          grade: kid.grade,
          batchId: batchIds[kid.batch],
          joinedAt: JOIN_DATE,
        });
        studentIds[kid.name] = studentId;
        studentBatch[kid.name] = kid.batch;
        studentCount += 1;
      }
    }

    // --- ~40 filler students, padding each batch to a realistic size ----
    const fillerPlan: { batch: string; count: number }[] = [
      { batch: "Class 9-B Science", count: 8 }, // +4 named = 12
      { batch: "Class 8-C English", count: 7 }, // +3 named = 10
      { batch: "Class 7-A Maths", count: 6 }, // +2 named = 8
      { batch: "O-Level Physics", count: 5 }, // +3 named = 8
      { batch: "Class 6-A Maths", count: 5 }, // +2 named = 7
      { batch: "Class 10-A Chemistry", count: 9 }, // +0 named = 9
    ];
    let fillerIdx = 0;
    for (const plan of fillerPlan) {
      for (let i = 0; i < plan.count; i++) {
        const first = FILLER_FIRST[fillerIdx % FILLER_FIRST.length];
        const last = FILLER_LAST[fillerIdx % FILLER_LAST.length];
        const name = `${first} ${last}`;
        const email = `${first.toLowerCase()}.${last.toLowerCase()}.${fillerIdx}@gmail.com`;
        const userId = await makeAccount(ctx, email, `${first} Family`);
        const { guardianId } = await ctx.runMutation(internal.seedDemo.insertProfile, {
          userId,
          academyId: academy._id,
          role: "parent",
          fullName: `${first} Family`,
          email,
          languagePref: "en",
        });
        guardianCount += 1;
        const studentId: Id<"students"> = await ctx.runMutation(internal.seedDemo.insertStudent, {
          academyId: academy._id,
          guardianId: guardianId!,
          name,
          grade: "—",
          batchId: batchIds[plan.batch],
          joinedAt: JOIN_DATE,
        });
        studentIds[`filler:${name}:${fillerIdx}`] = studentId;
        studentCount += 1;
        fillerIdx += 1;
      }
    }

    // --- generate last month's vouchers, then settle most of them, so
    //     this month's generation has real arrears to carry forward for
    //     the two families meant to read as overdue ----------------------
    const now = new Date();
    const thisPeriod = pktToday().slice(0, 7);
    const lastPeriodDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastPeriod = `${lastPeriodDate.getFullYear()}-${String(lastPeriodDate.getMonth() + 1).padStart(2, "0")}`;

    await ctx.runAction(internal.vouchers.runGenerateVouchers, { period: lastPeriod, force: true });

    // Settle every family's prior-month voucher except the two meant to
    // carry real arrears into this month (Tariq Farooq / Omar, and Asma
    // Qureshi / Ibrahim).
    const leaveUnpaidLastMonth = new Set(["Omar Farooq", "Ibrahim Qureshi"]);
    for (const [name, studentId] of Object.entries(studentIds)) {
      if (name.startsWith("filler:") ? false : leaveUnpaidLastMonth.has(name)) continue;
      const voucher = await ctx.runQuery(internal.seedDemo.listVouchersForStudent, { studentId, period: lastPeriod });
      if (voucher && voucher.status !== "paid") {
        await ctx.runMutation(internal.vouchers.recordCashPaymentInternal, { voucherId: voucher._id, amount: voucher.total });
      }
    }

    // --- now generate this month's vouchers for real ---------------------
    const genResult = await ctx.runAction(internal.vouchers.runGenerateVouchers, { period: thisPeriod, force: true });

    // --- payment scenarios for this month --------------------------------
    async function payFull(name: string) {
      const voucher = await ctx.runQuery(internal.seedDemo.listVouchersForStudent, { studentId: studentIds[name], period: thisPeriod });
      if (voucher) await ctx.runMutation(internal.vouchers.recordCashPaymentInternal, { voucherId: voucher._id, amount: voucher.total });
    }
    async function payPartial(name: string, fraction: number) {
      const voucher = await ctx.runQuery(internal.seedDemo.listVouchersForStudent, { studentId: studentIds[name], period: thisPeriod });
      if (voucher) await ctx.runMutation(internal.vouchers.recordCashPaymentInternal, { voucherId: voucher._id, amount: Math.max(1, Math.round(voucher.total * fraction)) });
    }

    await payFull("Fatima Sheikh");
    await payFull("Maryam Javed");
    await payFull("Noor Fatima");
    await payPartial("Hassan Raza", 0.5);
    await payFull("Zainab Malik");
    await payFull("Usman Malik");
    await payPartial("Hira Malik", 0.4);
    await payPartial("Ali Hamza", 0.4);
    await payFull("Sara Hamza");
    // Ayesha Khan, Bilal Ahmed, Omar Farooq, Ibrahim Qureshi, Danish Iqbal: left unpaid.

    for (const key of Object.keys(studentIds)) {
      if (key.startsWith("filler:")) await payFull(key);
    }

    // --- attendance: today, 3 of 6 batches marked -------------------------
    const today = pktToday();
    async function markBatch(batchName: string, absentees: string[], lates: string[], teacherName: string) {
      const namesInBatch = Object.entries(studentBatch).filter(([, b]) => b === batchName).map(([n]) => n);
      for (const name of namesInBatch) {
        const status = absentees.includes(name) ? "absent" : lates.includes(name) ? "late" : "present";
        await ctx.runMutation(internal.seedDemo.insertAttendance, { academyId: academy._id, studentId: studentIds[name], batchId: batchIds[batchName], date: today, status, markedBy: teacherIds[teacherName] });
      }
    }
    await markBatch("Class 9-B Science", ["Omar Farooq"], ["Hassan Raza"], "Sana Iqbal");
    await markBatch("O-Level Physics", ["Usman Malik"], [], "Adnan Malik");
    await markBatch("Class 7-A Maths", ["Maryam Javed"], [], "Rabia Noor");

    // Backfill a few days of history for Ayesha and Bilal so their % isn't 100/undefined.
    const historyDays = [1, 2].map((d) => `${thisPeriod}-${String(d).padStart(2, "0")}`).filter((d) => d < today);
    for (const date of historyDays) {
      await ctx.runMutation(internal.seedDemo.insertAttendance, { academyId: academy._id, studentId: studentIds["Ayesha Khan"], batchId: batchIds["Class 9-B Science"], date, status: date.endsWith("-02") ? "absent" : "present", markedBy: teacherIds["Sana Iqbal"] });
      await ctx.runMutation(internal.seedDemo.insertAttendance, { academyId: academy._id, studentId: studentIds["Bilal Ahmed"], batchId: batchIds["Class 7-A Maths"], date, status: "absent", markedBy: teacherIds["Rabia Noor"] });
    }

    // --- assessments & scores ---------------------------------------------
    await ctx.runMutation(internal.seedDemo.insertAssessment, {
      academyId: academy._id,
      batchId: batchIds["Class 9-B Science"],
      subjectId: subjectIds["Class 9-B Science"],
      date: `${thisPeriod}-02`,
      maxMarks: 100,
      published: true,
      createdBy: teacherIds["Sana Iqbal"],
      scores: [
        { studentId: studentIds["Ayesha Khan"], obtained: 82, absent: false },
        { studentId: studentIds["Hassan Raza"], obtained: 61, absent: false },
        { studentId: studentIds["Omar Farooq"], obtained: 48, absent: false },
        { studentId: studentIds["Noor Fatima"], obtained: 90, absent: false },
      ],
    });
    await ctx.runMutation(internal.seedDemo.insertAssessment, {
      academyId: academy._id,
      batchId: batchIds["Class 7-A Maths"],
      subjectId: subjectIds["Class 7-A Maths"],
      date: `${thisPeriod}-01`,
      maxMarks: 100,
      published: true,
      createdBy: teacherIds["Rabia Noor"],
      scores: [
        { studentId: studentIds["Bilal Ahmed"], obtained: 79, absent: false },
        { studentId: studentIds["Maryam Javed"], obtained: 71, absent: false },
      ],
    });
    await ctx.runMutation(internal.seedDemo.insertAssessment, {
      academyId: academy._id,
      batchId: batchIds["Class 8-C English"],
      subjectId: subjectIds["Class 8-C English"],
      date: `${thisPeriod}-01`,
      maxMarks: 100,
      published: false, // draft on purpose — demonstrates the publish gate
      createdBy: teacherIds["Sana Iqbal"],
      scores: [
        { studentId: studentIds["Zainab Malik"], obtained: 88, absent: false },
        { studentId: studentIds["Ali Hamza"], obtained: 66, absent: false },
        { studentId: studentIds["Danish Iqbal"], obtained: undefined, absent: true },
      ],
    });

    // --- remarks: draft from the data we just created, approve a few ------
    await ctx.runAction(internal.remarks.runDraftForPeriod, { period: thisPeriod, force: true });
    await ctx.runMutation(internal.seedDemo.approveRemarkAsTeacher, { studentId: studentIds["Ayesha Khan"], period: thisPeriod, teacherId: teacherIds["Sana Iqbal"] });
    await ctx.runMutation(internal.seedDemo.approveRemarkAsTeacher, { studentId: studentIds["Bilal Ahmed"], period: thisPeriod, teacherId: teacherIds["Rabia Noor"] });
    await ctx.runMutation(internal.seedDemo.approveRemarkAsTeacher, { studentId: studentIds["Noor Fatima"], period: thisPeriod, teacherId: teacherIds["Sana Iqbal"] });

    // --- reminder templates (English + Urdu) --------------------------------
    await ctx.runMutation(internal.seedDemo.insertReminderTemplate, {
      academyId: academy._id,
      bucket: "due_date",
      language: "en",
      subjectLine: "Fee voucher due — {{studentName}}",
      body: "Assalam-o-alaikum {{guardianName}},\n\n{{studentName}}'s fee voucher for {{period}} of PKR {{amount}} is due on {{dueDate}}.\n\nBreakdown: {{itemization}}\nPay online: {{payUrl}}\n\nBright Future Academy",
    });
    await ctx.runMutation(internal.seedDemo.insertReminderTemplate, {
      academyId: academy._id,
      bucket: "7d_gentle",
      language: "en",
      subjectLine: "A gentle reminder — {{studentName}}",
      body: "Assalam-o-alaikum {{guardianName}},\n\nWe have not yet received PKR {{amount}} for {{period}}. It may simply have been missed.\n\nOutstanding: {{itemization}}\nPay online: {{payUrl}}\n\nIf the payment is already made, please ignore this message.",
    });
    await ctx.runMutation(internal.seedDemo.insertReminderTemplate, {
      academyId: academy._id,
      bucket: "14d_firm",
      language: "en",
      subjectLine: "Please clear the balance — {{studentName}}",
      body: "Assalam-o-alaikum {{guardianName}},\n\n{{studentName}} now has PKR {{amount}} outstanding ({{daysOverdue}} days overdue).\n\nPlease clear the balance or reply with a payment date this week so we can note it against the account.\nPay online: {{payUrl}}",
    });
    await ctx.runMutation(internal.seedDemo.insertReminderTemplate, {
      academyId: academy._id,
      bucket: "30d_final",
      language: "en",
      subjectLine: "Final notice — {{studentName}}",
      body: "Assalam-o-alaikum {{guardianName}},\n\nPKR {{amount}} has been outstanding for over 30 days ({{daysOverdue}} days). This is a final notice before the account is referred to the academy owner.\n\nPlease contact the front desk today to agree an installment plan.\nPay online: {{payUrl}}",
    });
    await ctx.runMutation(internal.seedDemo.insertReminderTemplate, {
      academyId: academy._id,
      bucket: "due_date",
      language: "ur",
      subjectLine: "فیس واجب الادا — {{studentName}}",
      body: "السلام علیکم {{guardianName}}،\n\n{{studentName}} کی {{period}} کی فیس PKR {{amount}} کی رقم {{dueDate}} کو واجب الادا ہے۔\n\nتفصیل: {{itemization}}\nآن لائن ادائیگی: {{payUrl}}\n\nBright Future Academy",
    });
    await ctx.runMutation(internal.seedDemo.insertReminderTemplate, {
      academyId: academy._id,
      bucket: "7d_gentle",
      language: "ur",
      subjectLine: "نرم یاددہانی — {{studentName}}",
      body: "السلام علیکم {{guardianName}}،\n\n{{studentName}} کی {{period}} کی فیس PKR {{amount}} ابھی تک وصول نہیں ہوئی۔ ہو سکتا ہے یہ محض نظر انداز ہو گئی ہو۔\n\nباقی رقم: {{itemization}}\nآن لائن ادائیگی: {{payUrl}}\n\nاگر ادائیگی ہو چکی ہے تو براہ کرم اس پیغام کو نظر انداز کریں۔",
    });
    await ctx.runMutation(internal.seedDemo.insertReminderTemplate, {
      academyId: academy._id,
      bucket: "14d_firm",
      language: "ur",
      subjectLine: "براہ کرم بقایا جات ادا کریں — {{studentName}}",
      body: "السلام علیکم {{guardianName}}،\n\n{{studentName}} پر اب PKR {{amount}} بقایا ہے ({{daysOverdue}} دن سے زائد)۔\n\nبراہ کرم بقایا رقم ادا کریں یا اس ہفتے ادائیگی کی تاریخ سے آگاہ کریں تاکہ ریکارڈ میں درج کی جا سکے۔\nآن لائن ادائیگی: {{payUrl}}",
    });
    await ctx.runMutation(internal.seedDemo.insertReminderTemplate, {
      academyId: academy._id,
      bucket: "30d_final",
      language: "ur",
      subjectLine: "آخری نوٹس — {{studentName}}",
      body: "السلام علیکم {{guardianName}}،\n\nPKR {{amount}} کی رقم 30 دن سے زائد عرصے سے باقی ہے ({{daysOverdue}} دن)۔ یہ اکاؤنٹ کو اکیڈمی مالک کے پاس بھجوانے سے پہلے کا آخری نوٹس ہے۔\n\nبراہ کرم آج ہی فرنٹ ڈیسک سے رابطہ کر کے قسطوں کا منصوبہ طے کریں۔\nآن لائن ادائیگی: {{payUrl}}",
    });

    // --- inquiries -----------------------------------------------------------
    await ctx.runMutation(internal.seedDemo.insertInquiry, { academyId: academy._id, guardianId: guardianIds["Asma Qureshi"], topic: "Fee waiver", message: "I want to ask about a fee concession for Ibrahim. My husband lost his job in August and I cannot pay the full amount this month." });
    await ctx.runMutation(internal.seedDemo.insertInquiry, { academyId: academy._id, guardianId: guardianIds["Rukhsana Javed"], topic: "Schedule change", message: "Can Maryam move from the 5pm Maths batch to the 4pm one? She has school transport issues in the evening." });
    await ctx.runMutation(internal.seedDemo.insertInquiry, { academyId: academy._id, guardianId: guardianIds["Tariq Farooq"], topic: "Complaint", message: "Omar says the physics teacher went through three chapters in one week. Can someone call me about this?" });

    return {
      ok: true,
      message: "Seeded Bright Future Academy.",
      counts: {
        teachers: teacherDefs.length,
        batches: batchDefs.length,
        guardians: guardianCount,
        students: studentCount,
        vouchersCreatedThisPeriod: "created" in genResult ? genResult.created : 0,
      },
    };
  },
});

/**
 * Dev-only teardown for a throwaway student and/or batch created while
 * exercising a flow by hand — removes the student's enrollments, attendance,
 * scores, remarks, vouchers, ledger rows and message log, then the student;
 * and a batch's subjects, assessments (+scores), teacher links, then the
 * batch. Internal on purpose: unreachable from any client, CLI only, same
 * blast radius as devDeleteAccount. Never run this against real data — the
 * ledger is append-only for everyone but the test harness.
 */
export const devDeleteTestData = internalMutation({
  args: { studentId: v.optional(v.id("students")), batchId: v.optional(v.id("batches")) },
  handler: async (ctx, { studentId, batchId }) => {
    const removed: Record<string, number> = {};
    const bump = (k: string) => (removed[k] = (removed[k] ?? 0) + 1);
    if (studentId) {
      for (const e of await ctx.db.query("enrollments").withIndex("by_student", (q) => q.eq("studentId", studentId)).collect()) { await ctx.db.delete(e._id); bump("enrollments"); }
      for (const a of await ctx.db.query("attendance").withIndex("by_student", (q) => q.eq("studentId", studentId)).collect()) { await ctx.db.delete(a._id); bump("attendance"); }
      for (const s of await ctx.db.query("scores").withIndex("by_student", (q) => q.eq("studentId", studentId)).collect()) { await ctx.db.delete(s._id); bump("scores"); }
      for (const r of await ctx.db.query("remarks").withIndex("by_student", (q) => q.eq("studentId", studentId)).collect()) { await ctx.db.delete(r._id); bump("remarks"); }
      for (const l of await ctx.db.query("ledgerEntries").withIndex("by_student", (q) => q.eq("studentId", studentId)).collect()) { await ctx.db.delete(l._id); bump("ledgerEntries"); }
      for (const vo of await ctx.db.query("vouchers").withIndex("by_student_and_period", (q) => q.eq("studentId", studentId)).collect()) {
        for (const m of await ctx.db.query("messageLog").withIndex("by_voucher", (q) => q.eq("voucherId", vo._id)).collect()) { await ctx.db.delete(m._id); bump("messageLog"); }
        await ctx.db.delete(vo._id); bump("vouchers");
      }
      const student = await ctx.db.get(studentId);
      if (student?.photoStorageId) await ctx.storage.delete(student.photoStorageId);
      if (student) { await ctx.db.delete(studentId); bump("students"); }
    }
    if (batchId) {
      for (const s of await ctx.db.query("subjects").withIndex("by_batch", (q) => q.eq("batchId", batchId)).collect()) { await ctx.db.delete(s._id); bump("subjects"); }
      for (const a of await ctx.db.query("assessments").withIndex("by_batch", (q) => q.eq("batchId", batchId)).collect()) {
        for (const s of await ctx.db.query("scores").withIndex("by_assessment", (q) => q.eq("assessmentId", a._id)).collect()) { await ctx.db.delete(s._id); bump("scores"); }
        await ctx.db.delete(a._id); bump("assessments");
      }
      for (const t of await ctx.db.query("batchTeachers").withIndex("by_batch", (q) => q.eq("batchId", batchId)).collect()) { await ctx.db.delete(t._id); bump("batchTeachers"); }
      for (const e of await ctx.db.query("enrollments").withIndex("by_batch", (q) => q.eq("batchId", batchId)).collect()) { await ctx.db.delete(e._id); bump("enrollments"); }
      for (const a of await ctx.db.query("attendance").withIndex("by_batch_and_date", (q) => q.eq("batchId", batchId)).collect()) { await ctx.db.delete(a._id); bump("attendance"); }
      if (await ctx.db.get(batchId)) { await ctx.db.delete(batchId); bump("batches"); }
    }
    return removed;
  },
});

/**
 * Dev-only cleanup for artifacts left by a manual/QA pass: remark drafts for
 * one period, a guardian's chat history and inquiries, and a waitlist row.
 * Internal on purpose (CLI only). Each argument is optional — pass just the
 * ones you mean to remove.
 */
export const devCleanupTestArtifacts = internalMutation({
  args: {
    remarksPeriod: v.optional(v.string()),
    guardianId: v.optional(v.id("guardians")),
    waitlistEmail: v.optional(v.string()),
  },
  handler: async (ctx, { remarksPeriod, guardianId, waitlistEmail }) => {
    const removed: Record<string, number> = {};
    const bump = (k: string) => (removed[k] = (removed[k] ?? 0) + 1);

    if (remarksPeriod) {
      for (const r of await ctx.db.query("remarks").collect()) {
        if (r.period === remarksPeriod) { await ctx.db.delete(r._id); bump("remarks"); }
      }
      for (const g of await ctx.db.query("remarkGenerationLog").withIndex("by_period", (q) => q.eq("period", remarksPeriod)).collect()) {
        await ctx.db.delete(g._id); bump("remarkGenerationLog");
      }
      for (const n of await ctx.db.query("remarkNotificationLog").collect()) {
        if (n.period === remarksPeriod) { await ctx.db.delete(n._id); bump("remarkNotificationLog"); }
      }
    }

    if (guardianId) {
      for (const s of await ctx.db.query("chatSessions").withIndex("by_guardian", (q) => q.eq("guardianId", guardianId)).collect()) {
        for (const m of await ctx.db.query("chatMessages").withIndex("by_session", (q) => q.eq("sessionId", s._id)).collect()) { await ctx.db.delete(m._id); bump("chatMessages"); }
        await ctx.db.delete(s._id); bump("chatSessions");
      }
      for (const u of await ctx.db.query("chatUsage").withIndex("by_guardian_and_date", (q) => q.eq("guardianId", guardianId)).collect()) { await ctx.db.delete(u._id); bump("chatUsage"); }
      for (const i of await ctx.db.query("inquiries").withIndex("by_guardian", (q) => q.eq("guardianId", guardianId)).collect()) { await ctx.db.delete(i._id); bump("inquiries"); }
      for (const m of await ctx.db.query("messageLog").withIndex("by_guardian", (q) => q.eq("guardianId", guardianId)).collect()) { await ctx.db.delete(m._id); bump("messageLog"); }
    }

    if (waitlistEmail) {
      const row = await ctx.db.query("waitlist").withIndex("by_email", (q) => q.eq("email", waitlistEmail.trim().toLowerCase())).unique();
      if (row) { await ctx.db.delete(row._id); bump("waitlist"); }
    }
    return removed;
  },
});
