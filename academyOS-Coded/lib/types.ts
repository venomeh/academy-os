/**
 * Domain types for AcademyOS.
 *
 * These mirror the Supabase Postgres schema in Tasks.md §14 field-for-field
 * (the `// table: x` comments name the destination table). Every dashboard
 * component and every function in lib/data/* is written against these types
 * only — never against ad-hoc shapes — so that swapping the mock data layer
 * in lib/mock/* for real Supabase queries later requires no changes above
 * lib/data/*.
 *
 * Money fields are plain numbers in PKR (no currency subunit conversion —
 * the academy prices in whole rupees). Dates are ISO 8601 strings.
 */

export type Role = "admin" | "teacher" | "parent";

export type Language = "English" | "Urdu";

// table: profiles
export interface Profile {
  id: string;
  academyId: string;
  role: Role;
  fullName: string;
  email: string;
  phone: string;
  languagePref: Language;
  active: boolean;
}

// table: guardians
export interface Guardian {
  id: string;
  profileId: string;
  name: string;
  phone: string;
  verified: boolean;
}

export type StudentStatus = "active" | "left";

// table: students
export interface Student {
  id: string;
  guardianId: string;
  name: string;
  photoKey: string | null;
  grade: number;
  status: StudentStatus;
  joinedAt: string;
  feeOverride: number | null;
  overrideReason: string | null;
}

// table: batches
export interface Batch {
  id: string;
  name: string;
  gradeLevel: number;
  subject: string;
  days: string;
  time: string;
  monthlyTuition: number;
  teacherIds: string[];
}

// table: enrollments
export interface Enrollment {
  id: string;
  studentId: string;
  batchId: string;
  startDate: string;
  endDate: string | null;
}

// table: fee_rules — snapshotted onto every voucher at generation time
export interface FeeRules {
  academyId: string;
  tuitionDefault: number;
  siblingDiscountPct: number;
  lateFineFlat: number;
  generationDay: number;
  dueDay: number;
  admissionFee: number;
}

export type AttendanceStatus = "present" | "absent" | "late" | "leave";

// table: attendance — unique (studentId, batchId, date)
export interface AttendanceRecord {
  id: string;
  studentId: string;
  batchId: string;
  date: string;
  status: AttendanceStatus;
  markedBy: string;
}

// table: assessments
export interface Assessment {
  id: string;
  batchId: string;
  subject: string;
  date: string;
  maxMarks: number;
  published: boolean;
}

// table: scores
export interface Score {
  id: string;
  assessmentId: string;
  studentId: string;
  obtained: number | null;
  absent: boolean;
}

export type VoucherStatus = "unpaid" | "partial" | "paid";

export interface VoucherLine {
  label: string;
  note: string;
  /** Positive = charge, negative = discount. */
  amount: number;
}

// table: vouchers
export interface Voucher {
  id: string;
  ref: string;
  studentId: string;
  period: string; // 'YYYY-MM'
  lines: VoucherLine[];
  total: number;
  paid: number;
  dueDate: string;
  status: VoucherStatus;
  token: string;
}

export type LedgerKind = "voucher" | "payment" | "fine" | "discount" | "adjustment";
export type PaymentMethod = "cash" | "stripe" | "system" | "manual";

// table: ledger_entries — append-only; balances are always computed, never edited
export interface LedgerEntry {
  id: string;
  guardianId: string;
  studentId: string;
  voucherId: string | null;
  kind: LedgerKind;
  /** Positive = credit toward balance (payment, discount), negative = charge. */
  amount: number;
  method: PaymentMethod;
  stripeEventId: string | null;
  reason: string | null;
  createdBy: string;
  createdAt: string;
}

export type RemarkStatus = "draft" | "approved" | "rejected" | "low_data";

// table: remarks
export interface Remark {
  id: string;
  studentId: string;
  period: string;
  draftText: string;
  finalText: string | null;
  language: Language;
  status: RemarkStatus;
  facts: string[];
  approvedBy: string | null;
  approvedAt: string | null;
}

export type ReminderBucket = "due_date" | "overdue_7" | "overdue_14" | "overdue_30";

// table: reminder_templates — locked, admin-approved, version-stored
export interface ReminderTemplate {
  bucket: ReminderBucket;
  label: string;
  version: string;
  tone: string;
  body: string;
  queuedTomorrow: number;
}

export type MessageChannel = "Email" | "WhatsApp";
export type MessageStatus = "queued" | "sent" | "delivered" | "opened" | "failed";

// table: message_log
export interface MessageLogEntry {
  id: string;
  channel: MessageChannel;
  to: string;
  subject: string;
  templateVersion: string;
  status: MessageStatus;
  sentAt: string;
}

// table: chat_sessions / chat_messages
export interface ChatMessage {
  id: string;
  from: "me" | "bot";
  text: string;
  tools: string[];
}

export type InquiryTopic = "Fee waiver" | "Schedule change" | "Complaint" | "Other";
export type InquiryStatus = "open" | "resolved";

// table: inquiries
export interface Inquiry {
  id: string;
  topic: InquiryTopic;
  from: string;
  guardianId: string;
  when: string;
  message: string;
  status: InquiryStatus;
}

// Convenience aggregate shapes returned by lib/data/* — computed server-side
// (RPCs / views in the real backend), not stored tables.

export interface AttendanceTallyRow {
  batchId: string;
  name: string;
  teacher: string;
  time: string;
  roster: number;
  status: "marked" | "pending" | "flagged";
  present: number;
  absent: number;
  late: number;
  savedAt: string;
}

export interface AgingBucket {
  label: "Current" | "7+ days" | "14+ days" | "30+ days";
  amount: number;
  families: number;
}

export interface DefaulterRow {
  family: string;
  guardianId: string;
  children: string;
  amount: number;
  months: string;
  bucket: AgingBucket["label"];
  paused: boolean;
}

export interface CollectionsPoint {
  paid: number;
  due: number;
}

export interface ScheduledJob {
  name: string;
  cron: string;
  status: "healthy" | "scheduled";
  last: string;
}

export interface FeedItem {
  id: string;
  kind: "payment" | "stripe" | "attendance" | "reminder" | "remark" | "inquiry";
  text: string;
  amount: number;
  time: string;
}
