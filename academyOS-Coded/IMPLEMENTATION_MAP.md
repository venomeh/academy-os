# AcademyOS — Architecture & Implementation Map

Maps every functional and security requirement of **AcademyOS** to the code that implements it in [`academyOS-Coded/`](./).

**Stack note.** This directory is a full-stack **Next.js 15 (App Router) application on Convex**, using `@convex-dev/auth`, Convex file storage, and Convex scheduled crons. [`academyOS-BubbleServer/`](../academyOS-BubbleServer) is the parallel **Supabase (Postgres + RLS + Deno Edge Functions) + Bubble.io** implementation, maintained side-by-side for architectural reference and business-rule parity.

**Translation of the two architectural pillars:**

| Tasks.md says | Here it is |
| :--- | :--- |
| RLS policies on every table | Per-function authorization; helpers in `convex/lib/authz.ts` called as the first line of every function. No database-level backstop — a missing check is a real hole. |
| Edge Functions + pg_cron | Convex `action`/`httpAction` + `convex/crons.ts`. Crons carry no identity, so each job is a public admin-gated function delegating to an `internal` twin. |

---

## §3 Authentication

| Requirement | Implementation |
| :--- | :--- |
| §3.1 Email/password login, JWT, silent refresh | `@convex-dev/auth` Password provider — `convex/auth.ts`, `convex/auth.config.ts`. UI: `app/(app)/login/page.tsx` |
| §3.1 Role-based landing (admin/teacher/parent) | `api.auth.me` → `roleHome()` redirect in `app/(app)/login/page.tsx` |
| §3.1 No self-registration; reset via emailed code | `convex/lib/resendOtp.ts` (6-digit code via Resend). Login page has three views: sign-in / request-code / enter-code, and can jump straight to code entry so an invite code isn't wasted |
| §3.1 Logout clears tokens; wrong-role URL blocked | `middleware.ts` (route protection) + per-function `require*` checks |
| §3.2 Invite teacher / parent | `convex/auth.ts` → `provisionAccount`. UI: **Academy setup → Teachers & parents** (`components/admin/PeopleView.tsx`) |
| §3.2 Parent account links to a `guardians` row at creation | `convex/auth.ts` → `finishProvisioning` creates the guardian when role is `parent` |
| §3.2 Deactivate blocks login, keeps history | `convex/staff.ts` → `deactivate` / `reactivate`; `requireProfile` rejects inactive |

## §4 Academy Setup

| Requirement | Implementation |
| :--- | :--- |
| §4.1 Batch CRUD (name, grade, days/timings, tuition, teachers) | `convex/batches.ts` → `create`, `update`, `listAllForAdmin`. UI: `components/admin/BatchesView.tsx` + `BatchModal.tsx` (same modal creates and edits; **Edit** on each batch card). Deactivate keeps history rather than deleting |
| §4.1 Subjects per batch (CRUD) | `convex/batches.ts` → `listSubjects`, `addSubject`, `renameSubject`, `removeSubject`. UI: subject chips on each batch row in `BatchesView.tsx`. Guards: can't delete a subject with assessments, can't leave a batch with zero |
| §4.1 Teacher assignment; teacher sees only their batches | `convex/batches.ts` → `assignTeacher` / `unassignTeacher`; enforced by `isTeacherOfBatch` / `teacherBatchIds` in `convex/lib/authz.ts` |
| §4.2 Fee rules (sibling discount, late fine flat **or %**, admission fee, generation/due day) | `convex/academy.ts` → `getFeeRules`, `updateFeeRules`. UI: `components/admin/SettingsView.tsx` — the flat/percentage toggle relabels the amount field |
| §4.2 Vouchers snapshot the rules used | `ruleSnapshot` written in `convex/model/vouchers.ts` at generation |
| §4.2 Per-student override with reason | `convex/students.ts` → `setFeeOverride` (reason required). UI: "Custom fee" card in `components/admin/StudentDrawer.tsx` |

## §5 Students & Guardians

| Requirement | Implementation |
| :--- | :--- |
| §5.1 Enroll student (name, grade, batch, joining date, status) | `convex/students.ts` → `enroll`. UI: `components/admin/EnrollStudentModal.tsx` — enrol against an existing guardian, or invite a brand-new parent in the same step (`auth.provisionAccount` returns the new `guardianId`, which the enrolment is written against) |
| §5.1 Student photo | `convex/files.ts` (`generateUploadUrl`, `savePhoto`, `getPhotoUrl`, `getPhotoUrls`) — **Convex storage, not R2**. UI: click the avatar in `StudentDrawer.tsx`; rendered by `components/ui/StudentAvatar.tsx` |
| §5.1 Guardian linking; sibling discount from shared guardian | `guardianStudents` in `convex/lib/authz.ts`; ranking in `convex/model/roster.ts` → `siblingRank` |
| §5.1 Mid-month enrollment flags first voucher for review | `needsFeeReview` set in `students.enroll`; banner in `StudentDrawer.tsx` offers **Adjust voucher** (posts the proration — §8.3) or **Clear**. Posting any adjustment clears the flag automatically |
| §5.1 Mark "left" stops vouchers, preserves history | `convex/students.ts` → `markLeft` / `reactivate`; "Left" filter in `components/admin/StudentsView.tsx` |
| Batch re-assignment for an enrolled student | `convex/students.ts` → `addEnrollment` / `endEnrollment`; Batches card in `StudentDrawer.tsx` |

## §6 Attendance

| Requirement | Implementation |
| :--- | :--- |
| §6.1 Roster marking, default all-present, save once | `convex/attendance.ts` → `getForBatch`, `save`. UI: `components/teacher/AttendanceView.tsx` |
| §6.1 One row per student/batch/date; teacher same-day only; admin corrects any date (logged) | Unique index `by_student_and_batch_and_date` in `convex/schema.ts`; date lock in `convex/attendance.ts`. Admin correction panel (batch + date picker, per-student toggles) at the bottom of `components/admin/AttendanceView.tsx`; changes stamp `correctedBy`/`correctedAt` and show as a `corrected` pill on the teacher's own screen |
| §6.1 Teacher restricted to their batches | `isTeacherOfBatch` in `convex/lib/authz.ts` |
| §6.1 Monthly attendance % per student; parent calendar | `convex/model/roster.ts` → `attendanceSummary`, `convex/attendance.ts` → `getCalendar` (mirrors the reference SQL function) |
| §6.1 Live "X/Y batches marked today" tile + cutoff flag | `convex/attendance.ts` → `getTodayOverview`; `components/admin/OverviewView.tsx` / `components/admin/AttendanceView.tsx`. Live by default — Convex `useQuery` is reactive, no bridge element needed |

## §7 Assessments & Marks

| Requirement | Implementation |
| :--- | :--- |
| §7 Test = batch + subject + date + max marks | `convex/assessments.ts` → `createAssessment`. UI: `components/teacher/CreateAssessmentModal.tsx` ("New test" in the Marks tab) |
| §7 Grid entry + absent flag; save as draft | `convex/assessments.ts` → `getMarksGrid`, `saveMarksDraft`. UI: `components/teacher/MarksView.tsx` |
| §7 Reach earlier tests (drafts stay editable) | `convex/assessments.ts` → `listForBatch`; test picker in `MarksView.tsx` |
| §7 Validation: obtained ≤ max; percentages, batch average | Client check in `MarksView.tsx`, authoritative check in `saveMarksDraft` |
| §7 Publish gate; parents see published only | `convex/assessments.ts` → `publish` (refuses until every roster student has a mark or absent flag) and `getPublishedResults`. UI: `components/teacher/PublishModal.tsx`, `components/parent/ResultsView.tsx` |

## §8 Fee Engine

| Requirement | Implementation |
| :--- | :--- |
| §8.1 Monthly generation: tuition − sibling discount + arrears + fines, itemized | `convex/model/vouchers.ts` → `computeVoucherForStudent`; `convex/vouchers.ts` → `generateVouchers` (admin) / `runGenerateVouchers` (cron) |
| §8.1 Idempotent per (student, period) | Unique-index lookup before insert in `createVoucherRecord`; re-runs report `skipped` |
| §8.1 Voucher email with breakdown + pay link | `convex/model/email.ts`; token pay-link resolved by `convex/http.ts` (`/pay/` prefix) |
| §8.1 Manual run + logged summary | "Generate vouchers" button (`components/admin/GenerateModal.tsx`); every run appends to `jobRuns`, shown in `SettingsView.tsx` |
| §8.2 Cash + partial payments, receipt number, receipt email | `convex/vouchers.ts` → `recordCashPayment`. UI: `components/admin/PayModal.tsx` |
| §8.2 Stripe Checkout for the outstanding amount | `convex/stripe.ts` → `createCheckoutSession`. UI: `components/parent/PayModal.tsx` |
| §8.2 Status/balance only from the ledger; Stripe rows only from the webhook | One set of helpers in `convex/model/ledger.ts` (`outstandingOf`, `voucherPaid`, `statusFor`) is the single definition of what a voucher still owes and what its status is — every screen, tool, reminder and payment path derives from them. `convex/stripe.ts` → `creditPaymentInternal` is the sole Stripe write path |
| §8.2 Late fine accrues as a ledger line | `convex/lateFines.ts` → `accrue` / `runAccrue` (one fine per voucher, ever) |
| §8.2 Live "today's collections" tile | `convex/ledger.ts` → `getTodayCollections`; `components/admin/PaymentsView.tsx` |
| §8.3 Append-only ledger, computed balances | Inserts only, from `convex/vouchers.ts` (voucher + cash payment), `convex/stripe.ts` (card), `convex/lateFines.ts` (fine), `convex/ledger.ts` (adjustments). A voucher's ledger charge is its **new** money only (`total − arrears`): the arrears are already on the account as the prior voucher's row, so charging `total` would bill the family twice — the reference backend avoids this by posting no voucher row at all |
| §8.3 Defaulters with aging buckets | `convex/ledger.ts` → `getAgingBuckets`, `getDefaulters`. UI: `components/admin/DefaultersView.tsx` — each row opens the family statement, sends a reminder, or pauses with a required reason |
| §8.3 Parent statement per child + family total; admin per-family statement | `convex/ledger.ts` → `listForGuardian` (parent) and `listForFamily` (admin), both from one `guardianStatement` helper. UI: `components/parent/DuesView.tsx`, `components/admin/FamilyStatementModal.tsx`. Corrections: `convex/ledger.ts` → `postAdjustment` (reason required) via `components/admin/AdjustmentModal.tsx`. Receipts render from the ledger row in `components/ui/ReceiptModal.tsx` |
| §8.4 Signature-verified webhook; 400 writes nothing | `convex/stripeWebhook.ts` (route in `convex/http.ts`). **Must use `constructEventAsync`** — Convex is WebCrypto-only, the sync variant always throws |
| §8.4 Idempotent on Stripe event id | `stripeEventId` checked before crediting; replays return `{duplicate:true}` |
| Post-payment confirmation screen | `app/(app)/pay/success/page.tsx` — polls for the webhook-written ledger row, with an explicit slow/timeout state |

## §9 AI Progress Remarks

| Requirement | Implementation |
| :--- | :--- |
| §9 Month-end job builds a data pack and drafts | `convex/model/remarks.ts` → `buildDataPack`; `convex/remarks.ts` → `draftForPeriod` (admin) / `runDraftForPeriod` (cron). An **action**, since model calls are external I/O |
| §9 Prompt contains only the data pack; nothing ungrounded | `convex/model/remarksAi.ts` → `GROUNDING_RULES`, `buildUserPayload`, plus reasoning-dump detection and defensive response parsing ported from the reference |
| §9 Low-data students flagged, not given vague text | `lowData` / `lowDataReason` in `buildDataPack`; those students never reach the model |
| §9 Language follows guardian preference; admin tone template | `remarkToneTemplates` table (versioned, insert-only); language from `guardians.languagePref`. UI: **Tone template** panel in `components/admin/RemarksView.tsx` → `remarks.activeToneTemplates` / `setToneTemplate` |
| §9 Teacher queue: approve / edit / regenerate / reject | `convex/remarks.ts` → `approve`, `editDraft`, `regenerate`, `reject`, `setLanguage`. UI: `components/teacher/RemarksQueueView.tsx`, `components/admin/RemarksView.tsx`. Both queues show `components/ui/FactChips.tsx` — the attendance %, each test score vs the batch average, and the month-on-month trend the draft was grounded in, so a reviewer checks the text against its source |
| §9 Only approved remarks are parent-visible | `getApprovedForStudent` filters on status; `components/parent/RemarksView.tsx` |
| §9 Approval stamps teacher + timestamp | `approvedBy` / `approvedAt` in `approve` |
| §9 Parents notified when the month publishes | `convex/remarks.ts` → `publishForBatch` (+ `getPublishStatus`); "Publish to parents" panel in `components/admin/RemarksView.tsx`. Gated until every student in the batch is approved; idempotent via `remarkNotificationLog` |
| Model plumbing | `convex/lib/ai.ts` (OpenRouter client, retry, JSON mode, tool calling). Audit trail in `remarkGenerationLog` |

## §10 Escalating Fee Follow-ups

| Requirement | Implementation |
| :--- | :--- |
| §10 Daily sweep, aging buckets, escalating sequence, admin escalation | `convex/model/reminders.ts` → `reminderBucketFor`; `convex/reminders.ts` → `sweep` (admin) / `runSweep` (cron). The 30-day final notice also emails every active admin (`escalateToAdmin`), riding on the same claim so it fires exactly once per voucher |
| §10 Locked, versioned, admin-approved templates per bucket + language | `reminderTemplates` (insert-only versioning via `setTemplate`). UI: `components/admin/RemindersView.tsx` shows all 4 buckets × 2 languages; `TemplateModal.tsx` views, previews with sample data, and edits — saving deactivates the current version and inserts version+1, and refuses a body missing `{{amount}}` or `{{payUrl}}`. Missing translation falls back to English rather than sending nothing |
| §10 Personalization inside the locked template | `convex/model/remindersAi.ts` — **off by default** behind `REMINDER_AI_PERSONALIZE`; output must keep the amount and pay link or the deterministic text is sent |
| §10 One message per family/bucket/voucher; halt on payment | Claim-then-send: `claimAndPrepareSend` inserts the log row first; `by_voucher_and_bucket_and_channel` index |
| §10 Every send logged with channel + template version | `messageLog` (+ `personalized` flag) |
| §10 Pause reminders per family with a reason | `guardians.remindersPaused` / `remindersPausedReason`; `convex/ledger.ts` → `togglePause`. The reason is required inline on the Defaulters row and shown wherever the family appears |
| §10 WhatsApp via Make.com | **Not built.** Email is the acceptance-critical channel; noted as the remaining §10 gap |

## §11 Parent Portal

| Requirement | Implementation |
| :--- | :--- |
| §11 Children overview; per child dues, vouchers, attendance, marks, remarks | `app/(app)/parent/page.tsx`, `components/parent/ParentApp.tsx` + `DuesView` / `AttendanceView` / `ResultsView` / `RemarksView` |
| §11 Every query scoped to the caller's own children | `requireGuardian` + `ownedStudentOrNull` (returns `null`, never throws — a guessed id is indistinguishable from a foreign one) |
| §11 Responsive; empty states; status flips only after webhook | Fluid layouts throughout; `app/(app)/pay/success/page.tsx` waits on the ledger row |

## §12 Agentic Parent Chatbot

| Requirement | Implementation |
| :--- | :--- |
| §12 Server-side tool loop with the parent's identity | `convex/chatbot.ts` → `sendMessage` (max 6 turns). No tool accepts a guardian id; every student-scoped tool re-checks ownership. **The configured free Nemotron model does not return OpenAI `tool_calls`** — it writes the call into `content` as JSON, so `parseEmulatedToolCall` recovers it and the loop executes it for real (name validated against `TOOL_DEFS`). Without this no tool ever ran and every answer was ungrounded |
| §12 The nine tools | `convex/model/chatbot.ts`; schemas in `convex/model/chatbotAi.ts` (`TOOL_DEFS`) |
| §12 Answers cite tool data; money answers can't be improvised | Fee questions force `get_outstanding_balance`; if the model never produced a usable turn the tool is run directly anyway, and any reply not quoting the real figure is replaced by `familyBalanceReply`. `isUsableReply` + `stripToolScaffolding` reject fragments and leaked tool JSON before they reach a parent |
| §12 Out-of-scope → inquiry + admin notification + inbox | `create_inquiry` → `fileInquiry`; email sent from the action. UI: `components/admin/InquiriesView.tsx` |
| §12 Guardian's language; conversation persisted; per-session token usage | `chatSessions` / `chatMessages`; real `total_tokens` accumulated per session and shown in the widget footer beside the daily quota (`chatbot.listSessionMessages` returns both) |
| §12 Rate limit per guardian per day | `chatUsage` keyed on the Karachi date; `CHAT_DAILY_LIMIT` (default 30) |
| §12 UI | `components/parent/ChatWidget.tsx` |
| §12 Stretch: WhatsApp | Not built (stretch goal) |

## §13 Marketing Landing Page

| Requirement | Implementation |
| :--- | :--- |
| §13 Next.js App Router, distinct design direction | `app/page.tsx` + `components/` (Hero, Problem, Features, HowItWorks, Stats, Pricing, UrduQuote, Faq, WaitlistCta, Footer) |
| §13 OG / meta tags | `app/layout.tsx` (`openGraph`, `twitter`, `metadataBase`, robots) + `app/opengraph-image.tsx`, which renders the 1200×630 card at request time |
| §13 Waitlist → table + confirmation | `convex/waitlist.ts` → `join` (public, anonymous) + `sendConfirmation` (internal action, scheduled by the mutation since a mutation cannot send mail), `listForAdmin`. UI: `components/WaitlistCta.tsx` |

## §14 Data Model

All tables in **`convex/schema.ts`**, same names as the PRD in camelCase (`ledger_entries` → `ledgerEntries`). Convex additions beyond the PRD list: `remarkGenerationLog` (model/token audit), `remarkNotificationLog`, `remarkToneTemplates`, `jobRuns` (cron history), plus `...authTables` from `@convex-dev/auth`.

Convex has **no** unique constraints or foreign keys. Every uniqueness rule in the PRD is enforced by an index lookup before insert:

| PRD constraint | Enforced by |
| :--- | :--- |
| unique (student, period) on vouchers | `by_student_and_period` check in `createVoucherRecord` |
| unique (student, batch, date) on attendance | `by_student_and_batch_and_date` in `convex/attendance.ts` |
| unique `stripe_event_id` on ledger | checked in `creditPaymentInternal` |
| one reminder per voucher/bucket/channel | `by_voucher_and_bucket_and_channel` claim in `claimAndPrepareSend` |
| one late fine per voucher, ever | `by_voucher_and_kind` in `convex/lateFines.ts` |

## §15 Business Rules → where each is enforced

| Rule | Enforced in |
| :--- | :--- |
| 1. Append-only ledger, computed balances | No `patch`/`delete` on `ledgerEntries` exists anywhere in `convex/`; every balance is recomputed by `computeOutstanding` |
| 2. Stripe only via verified, idempotent webhook | `convex/stripeWebhook.ts` + `creditPaymentInternal` |
| 3. Idempotent generation, snapshotted rules | `convex/model/vouchers.ts` |
| 4. No unreviewed AI text to parents | Remarks require approval; reminders send locked templates; chatbot is tool-grounded |
| 5. Approval before parent visibility | `getApprovedForStudent` filters on status server-side |
| 6. Chatbot reads only the caller's children | `convex/chatbot.ts` → `executeReadTool`; identity from the session, never conversation content |
| 7. Reminders halt on payment; one per bucket; logged | `findCandidates` skips paid; claim-then-send; `messageLog` |
| 8. Cross-role isolation server-side | `convex/lib/authz.ts` — UI conditionals are cosmetic |
| 9. Secrets server-only | Convex env vars; nothing in `NEXT_PUBLIC_*` except the Convex URL |
| 10. Files via storage service, DB stores keys | `convex/files.ts`; `students.photoStorageId` |

## Scheduling (replaces pg_cron)

`convex/crons.ts` — all times UTC (Asia/Karachi is UTC+5, no DST):

| Job | UTC | PKT | Entry point |
| :--- | :--- | :--- | :--- |
| generate-vouchers | 01:00 | 06:00 | `internal.vouchers.runGenerateVouchers` |
| accrue-late-fines | 03:00 | 08:00 | `internal.lateFines.runAccrue` |
| reminder-sweep | 04:00 | 09:00 | `internal.reminders.runSweep` |
| draft-remarks | 21:00 | 02:00 | `internal.remarks.runDraftForPeriod` |

Each is also runnable on demand from **Fee rules & jobs → Scheduled jobs → Run now**, through the same entry point, and every run appends to `jobRuns`.

## Environment variables (Convex deployment)

`JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL` (auth) · `RESEND_API_KEY`, `RESEND_FROM_EMAIL` · `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CURRENCY` · `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_CHAT_MODEL`, `CHAT_DAILY_LIMIT` · optional `REMINDER_AI_PERSONALIZE`, `APP_URL`.

## Dev / seeding utilities

| Purpose | Command |
| :--- | :--- |
| First-run academy + admin | `npx convex run seed:bootstrapAdmin` |
| Full demo dataset | `npx convex run seedDemo:seedDemoData '{}'` |
| Wipe demo data, keep admin + config | `npx convex run resetDemo:wipeDemoData '{}'` |
| Mint a test teacher/parent with a known password | `npx convex run seedDemo:devCreateAccount '{"email":"…","fullName":"…","role":"teacher"}'` |
| Remove one test account | `npx convex run seedDemo:devDeleteAccount '{"email":"…"}'` |

## Known gaps against Tasks.md

Re-verified end-to-end in a browser on 2026-09-07 against a throwaway batch, two students, a teacher and two parents — all since removed. Everything previously listed as an unmet criterion now passes; what remains is below.

**Not built (deliberate)**

1. **WhatsApp via Make.com (§8.1, §10, §12 stretch)** — the PRD names email as the acceptance-critical channel. `messageLog.channel` already carries `whatsapp`, so adding it is a sender, not a schema change.
2. **Reminder AI personalization (§10)** — built and guarded, off by default behind `REMINDER_AI_PERSONALIZE`; see the decision record in memory for why.

**Open**

3. **§13 "feature highlights with real screenshots"** — `HowItWorks` still uses illustrative SVGs in `public/screens/`. The component already swaps to a real image or autoplaying video per card, so this is a matter of dropping captures in — deliberately not done from test data, since the shots would be published publicly.
4. **§13 Lighthouse ≥90 mobile** — not measured.
5. **Aging/defaulter totals double-count carried-forward arrears.** The ledger is now correct (a voucher charges only its new money), but `getAgingBuckets` / `getDefaulters` / the reminder sweep sum *per voucher*, and a carried-forward month appears both in the old voucher's own balance and inside the new voucher's arrears line. Only bites a family more than one month behind. Fixing it properly needs a "superseded by carry-forward" voucher state, which is a schema change; the per-voucher unit is what §10 mandates for reminders, so it was left alone rather than half-changed.
6. **Chat model reliability.** `nvidia/nemotron-3-super-120b-a12b:free` frequently spends its whole budget on excluded reasoning and returns a truncated fragment, and never emits real `tool_calls`. The loop now recovers emulated calls, rejects fragments, and answers money questions from the ledger regardless — but a model with real function calling would make the rest of the chat (attendance, results, schedule) markedly better. Swap via `OPENROUTER_CHAT_MODEL`.
7. **§14 `guardians.phone` uniqueness** — indexed, not enforced. Only matters for the unbuilt WhatsApp phone→guardian mapping.
