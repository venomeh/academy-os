import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

/**
 * AcademyOS data model — ported from the reference Supabase schema
 * (academyOS-BubbleServer/supabase/migrations/20260729075633_initial_schema.sql)
 * onto Convex. Differences from the reference, and why:
 *
 *  - No RLS. Every table is readable/writable only through the functions in
 *    convex/*.ts, each of which enforces the same access rules the reference
 *    encoded as SQL policies — see convex/lib/authz.ts for the shared checks.
 *  - No foreign keys or UNIQUE constraints — Convex doesn't have either.
 *    Uniqueness (student+period on vouchers, assessment+student on scores,
 *    voucher+bucket+channel on messageLog, etc.) is enforced in the mutation
 *    that writes the row, via an indexed lookup before insert.
 *  - `authTables` (from @convex-dev/auth) supplies `users`/`authAccounts`/
 *    `authSessions`/etc. `profiles` extends that with app-specific fields,
 *    exactly mirroring the reference's `profiles.id references auth.users.id`
 *    one-to-one relationship — just via `userId: v.id("users")` instead of a
 *    shared primary key.
 *  - Money fields are plain `v.number()` (PKR, whole rupees) — no numeric(10,2).
 *  - Money is append-only via `ledgerEntries`; `vouchers.total` is a cache
 *    recomputed whenever a late fine accrues (the reference does the same —
 *    voucher.total is not immutable after generation, only its *lines* up to
 *    that point are).
 */

export default defineSchema({
  ...authTables,

  // ---------------------------------------------------------------------
  // Academy / people
  // ---------------------------------------------------------------------

  academies: defineTable({
    name: v.string(),
  }),

  profiles: defineTable({
    userId: v.id("users"),
    academyId: v.id("academies"),
    role: v.union(v.literal("admin"), v.literal("teacher"), v.literal("parent")),
    fullName: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    languagePref: v.union(v.literal("en"), v.literal("ur")),
    active: v.boolean(),
  })
    .index("by_userId", ["userId"])
    .index("by_academy", ["academyId"])
    .index("by_role", ["academyId", "role"])
    .index("by_email", ["email"]),

  guardians: defineTable({
    profileId: v.id("profiles"),
    academyId: v.id("academies"),
    name: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    languagePref: v.union(v.literal("en"), v.literal("ur")),
    verified: v.boolean(),
    remindersPaused: v.boolean(),
    remindersPausedReason: v.optional(v.string()),
  })
    .index("by_profile", ["profileId"])
    .index("by_academy", ["academyId"])
    .index("by_phone", ["phone"]),

  // ---------------------------------------------------------------------
  // Academy setup
  // ---------------------------------------------------------------------

  students: defineTable({
    academyId: v.id("academies"),
    guardianId: v.id("guardians"),
    name: v.string(),
    photoStorageId: v.optional(v.id("_storage")),
    grade: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("left")),
    joinedAt: v.string(), // ISO date 'YYYY-MM-DD'
    feeOverride: v.optional(v.number()),
    overrideReason: v.optional(v.string()),
    needsFeeReview: v.boolean(),
  })
    .index("by_guardian", ["guardianId"])
    .index("by_academy", ["academyId"])
    .index("by_status", ["academyId", "status"]),

  batches: defineTable({
    academyId: v.id("academies"),
    name: v.string(),
    gradeLevel: v.optional(v.string()),
    daysOfWeek: v.array(v.string()),
    startTime: v.optional(v.string()), // 'HH:MM'
    endTime: v.optional(v.string()),
    monthlyTuition: v.number(),
    active: v.boolean(),
  }).index("by_academy", ["academyId"]),

  subjects: defineTable({
    academyId: v.id("academies"),
    batchId: v.id("batches"),
    name: v.string(),
  }).index("by_batch", ["batchId"]),

  batchTeachers: defineTable({
    batchId: v.id("batches"),
    teacherId: v.id("profiles"),
  })
    .index("by_batch", ["batchId"])
    .index("by_teacher", ["teacherId"])
    .index("by_batch_and_teacher", ["batchId", "teacherId"]),

  enrollments: defineTable({
    studentId: v.id("students"),
    batchId: v.id("batches"),
    startDate: v.string(), // ISO date
    endDate: v.optional(v.string()),
  })
    .index("by_student", ["studentId"])
    .index("by_batch", ["batchId"])
    .index("by_student_and_batch", ["studentId", "batchId"]),

  feeRules: defineTable({
    academyId: v.id("academies"),
    siblingDiscountPct: v.number(),
    lateFineType: v.union(v.literal("flat"), v.literal("percentage")),
    lateFineValue: v.number(),
    lateFineGraceDays: v.number(),
    generationDay: v.number(), // 1-28
    dueDay: v.number(), // 1-28
    admissionFee: v.number(),
    remindersSweepEnabled: v.optional(v.boolean()), // defaults to enabled when unset — see convex/reminders.ts
  }).index("by_academy", ["academyId"]),

  // ---------------------------------------------------------------------
  // Attendance & assessments
  // ---------------------------------------------------------------------

  attendance: defineTable({
    academyId: v.id("academies"),
    studentId: v.id("students"),
    batchId: v.id("batches"),
    date: v.string(), // ISO date
    status: v.union(v.literal("present"), v.literal("absent"), v.literal("late"), v.literal("leave")),
    markedBy: v.id("profiles"),
    correctedBy: v.optional(v.id("profiles")),
    correctedAt: v.optional(v.number()),
  })
    .index("by_batch_and_date", ["batchId", "date"])
    .index("by_student", ["studentId"])
    .index("by_student_and_batch_and_date", ["studentId", "batchId", "date"]),

  assessments: defineTable({
    academyId: v.id("academies"),
    batchId: v.id("batches"),
    subjectId: v.id("subjects"),
    date: v.string(),
    maxMarks: v.number(),
    published: v.boolean(),
    createdBy: v.id("profiles"),
  }).index("by_batch", ["batchId"]),

  scores: defineTable({
    assessmentId: v.id("assessments"),
    studentId: v.id("students"),
    obtained: v.optional(v.number()),
    absent: v.boolean(),
  })
    .index("by_assessment", ["assessmentId"])
    .index("by_student", ["studentId"])
    .index("by_assessment_and_student", ["assessmentId", "studentId"]),

  // ---------------------------------------------------------------------
  // Fee engine — vouchers & the append-only ledger
  // ---------------------------------------------------------------------

  vouchers: defineTable({
    academyId: v.id("academies"),
    studentId: v.id("students"),
    guardianId: v.id("guardians"),
    period: v.string(), // 'YYYY-MM'
    lineItems: v.array(
      v.object({
        label: v.string(),
        note: v.string(),
        amount: v.number(), // positive = charge, negative = discount
      })
    ),
    tuitionAmount: v.number(),
    siblingDiscount: v.number(),
    arrears: v.number(),
    fines: v.number(),
    total: v.number(), // mutable cache — bumped when a late fine accrues
    dueDate: v.string(),
    status: v.union(v.literal("unpaid"), v.literal("partial"), v.literal("paid")),
    token: v.string(), // public pay-link token, >=20 chars
    ruleSnapshot: v.object({
      siblingDiscountPct: v.number(),
      lateFineType: v.union(v.literal("flat"), v.literal("percentage")),
      lateFineValue: v.number(),
      lateFineGraceDays: v.number(),
      dueDay: v.number(),
      admissionFee: v.number(),
    }),
    generatedAt: v.number(),
  })
    .index("by_guardian", ["guardianId"])
    .index("by_status", ["status"])
    .index("by_due_date", ["dueDate"])
    .index("by_token", ["token"])
    .index("by_student_and_period", ["studentId", "period"])
    .index("by_period", ["period"]),

  // APPEND-ONLY — no mutation in convex/ledger.ts ever patches or deletes a
  // row here. Balances are always computed by summing this table.
  ledgerEntries: defineTable({
    academyId: v.id("academies"),
    guardianId: v.id("guardians"),
    studentId: v.id("students"),
    voucherId: v.optional(v.id("vouchers")),
    kind: v.union(v.literal("voucher"), v.literal("payment"), v.literal("fine"), v.literal("discount"), v.literal("adjustment")),
    amount: v.number(), // positive = credit toward balance, negative = charge
    method: v.optional(v.union(v.literal("cash"), v.literal("stripe"))),
    stripeEventId: v.optional(v.string()),
    receiptNumber: v.optional(v.string()),
    reason: v.optional(v.string()),
    createdBy: v.optional(v.id("profiles")),
  })
    .index("by_guardian", ["guardianId"])
    .index("by_student", ["studentId"])
    .index("by_voucher", ["voucherId"])
    .index("by_kind", ["kind"])
    .index("by_stripe_event", ["stripeEventId"])
    // One late fine per voucher, ever — checked before insert.
    .index("by_voucher_and_kind", ["voucherId", "kind"]),

  // ---------------------------------------------------------------------
  // AI progress remarks
  // ---------------------------------------------------------------------

  remarks: defineTable({
    academyId: v.id("academies"),
    studentId: v.id("students"),
    period: v.string(),
    draftText: v.optional(v.string()),
    finalText: v.optional(v.string()),
    language: v.union(v.literal("en"), v.literal("ur")),
    status: v.union(v.literal("draft"), v.literal("approved"), v.literal("rejected"), v.literal("low_data")),
    lowDataReason: v.optional(v.string()),
    source: v.union(v.literal("template"), v.literal("ai")), // how draftText was produced
    dataPack: v.optional(v.any()), // the structured facts the draft was grounded in — kept for audit/regen
    approvedBy: v.optional(v.id("profiles")),
    approvedAt: v.optional(v.number()),
  })
    .index("by_student", ["studentId"])
    .index("by_status", ["status"])
    .index("by_student_and_period", ["studentId", "period"]),

  // One consolidated "your child's remarks are ready" email per guardian
  // per batch per period — idempotency key for publishRemarks.
  remarkNotificationLog: defineTable({
    guardianId: v.id("guardians"),
    batchId: v.id("batches"),
    period: v.string(),
    channel: v.literal("email"),
    status: v.optional(v.union(v.literal("sent"), v.literal("failed"))),
    sentAt: v.optional(v.number()),
    errorDetail: v.optional(v.string()),
  }).index("by_guardian_and_batch_and_period", ["guardianId", "batchId", "period"]),

  // Per-call audit of the remark model: which model, how many tokens, and
  // why a draft failed. Kept out of `remarks` so a retry never rewrites history.
  remarkGenerationLog: defineTable({
    academyId: v.id("academies"),
    studentId: v.id("students"),
    period: v.string(),
    model: v.string(),
    status: v.union(v.literal("ok"), v.literal("error")),
    promptTokens: v.optional(v.number()),
    completionTokens: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  }).index("by_period", ["period"]),

  // Admin-editable tone prefix layered onto the remark prompt, versioned
  // the same insert-only way as reminderTemplates.
  remarkToneTemplates: defineTable({
    academyId: v.id("academies"),
    language: v.union(v.literal("en"), v.literal("ur")),
    version: v.number(),
    tone: v.string(),
    active: v.boolean(),
  }).index("by_academy_and_language_and_active", ["academyId", "language", "active"]),

  // ---------------------------------------------------------------------
  // Escalating fee follow-ups
  // ---------------------------------------------------------------------

  reminderTemplates: defineTable({
    academyId: v.id("academies"),
    bucket: v.union(v.literal("due_date"), v.literal("7d_gentle"), v.literal("14d_firm"), v.literal("30d_final")),
    language: v.union(v.literal("en"), v.literal("ur")),
    templateVersion: v.number(),
    subjectLine: v.string(),
    body: v.string(), // {{placeholder}} substitution, never LLM-generated — see convex/reminders.ts
    active: v.boolean(),
  }).index("by_academy_and_bucket_and_language_and_active", ["academyId", "bucket", "language", "active"]),

  messageLog: defineTable({
    academyId: v.id("academies"),
    guardianId: v.id("guardians"),
    voucherId: v.optional(v.id("vouchers")),
    bucket: v.optional(v.union(v.literal("due_date"), v.literal("7d_gentle"), v.literal("14d_firm"), v.literal("30d_final"))),
    channel: v.union(v.literal("email"), v.literal("whatsapp")),
    status: v.union(v.literal("pending"), v.literal("sent"), v.literal("failed")),
    templateVersion: v.optional(v.number()),
    content: v.optional(v.string()),
    // Whether the model personalised the locked template for this send, or
    // the deterministic substitution was used (§10 audit trail).
    personalized: v.optional(v.boolean()),
    errorDetail: v.optional(v.string()),
    sentAt: v.optional(v.number()),
  })
    .index("by_guardian", ["guardianId"])
    .index("by_voucher", ["voucherId"])
    // claim-then-send idempotency: insert here first, skip if it already exists
    .index("by_voucher_and_bucket_and_channel", ["voucherId", "bucket", "channel"]),

  // ---------------------------------------------------------------------
  // Agentic parent chatbot
  // ---------------------------------------------------------------------

  chatSessions: defineTable({
    guardianId: v.id("guardians"),
    startedAt: v.number(),
    lastMessageAt: v.number(),
    tokenUsage: v.number(),
  }).index("by_guardian", ["guardianId"]),

  chatMessages: defineTable({
    sessionId: v.id("chatSessions"),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("tool")),
    content: v.string(),
    toolName: v.optional(v.string()),
    toolPayload: v.optional(v.any()),
  }).index("by_session", ["sessionId"]),

  chatUsage: defineTable({
    guardianId: v.id("guardians"),
    date: v.string(), // ISO date
    requestCount: v.number(),
  }).index("by_guardian_and_date", ["guardianId", "date"]),

  inquiries: defineTable({
    academyId: v.id("academies"),
    guardianId: v.id("guardians"),
    topic: v.string(),
    message: v.string(),
    status: v.union(v.literal("open"), v.literal("resolved")),
    resolvedBy: v.optional(v.id("profiles")),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_guardian", ["guardianId"])
    .index("by_status", ["status"]),

  // ---------------------------------------------------------------------
  // Landing page + ops
  // ---------------------------------------------------------------------

  waitlist: defineTable({
    email: v.string(),
    source: v.optional(v.string()),
  }).index("by_email", ["email"]),

  jobRuns: defineTable({
    jobName: v.string(),
    period: v.optional(v.string()),
    result: v.any(),
  }).index("by_job_name", ["jobName"]),
});
