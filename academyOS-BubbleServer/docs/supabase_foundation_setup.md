# AcademyOS — Supabase Foundation Setup

> Document tracking all schema decisions, constraints, and infrastructure setup for the AcademyOS Supabase backend.  
> Last updated: 2026-07-29

---

## 1. Project & Connection Details

| Item | Value |
|------|-------|
| **Project name** | AcademyOS |
| **Project ref** | `<PROJECT_REF>` |
| **Region** | `ap-southeast-1` (Singapore) |
| **Status** | ACTIVE_HEALTHY |
| **Postgres version** | 17.6.1.147 |
| **Database host** | `db.<PROJECT_REF>.supabase.co` |
| **Linked locally** | Yes — `academyOS-server/supabase/` |

---

## 2. Extensions Enabled

| Extension | Schema | How Enabled | Purpose |
|-----------|--------|-------------|---------|
| `pgcrypto` | extensions | Supabase dashboard | Token generation (`gen_random_bytes`), UUID generation |
| `pg_cron` | extensions | Supabase dashboard | Scheduled jobs (voucher generation, reminders, remarks) |
| `pg_net` | extensions | SQL via MCP tool | HTTP calls from pg_cron to edge functions |

**Note:** Extensions live in the `extensions` schema. Functions like `gen_random_bytes` must be referenced as `extensions.gen_random_bytes()` in migrations run via `supabase db push` (the migration role doesn't have `extensions` in its `search_path`).

---

## 3. Migrations Applied

| # | File | Purpose |
|---|------|---------|
| 000 | `20260729075600_extensions.sql` | Ensures pgcrypto + pg_net exist (idempotent; makes repo self-contained for `db reset`) |
| 001 | `20260729075633_initial_schema.sql` | Full data model: 23 tables, enums, views, functions, triggers, sequences, realtime |
| 002 | `20260729080000_security_hardening.sql` | Pins `search_path` on SECURITY DEFINER functions; enables `security_invoker` on all views; adds metadata validation to `handle_new_user` |
| 003 | `20260729090000_rls_policies.sql` | Enables RLS on all 23 tables, 56 policies (per-role), 2 new helpers, `record_cash_payment` RPC, anon lockdown, template immutability |

The rationale for creating all tables upfront (even those not used until Week 4-5): costs nothing now, prevents migration churn later. Every downstream feature drops into an already-correct schema.

**Note on extensions migration:** `pg_cron` cannot be created via migration (managed by Supabase infrastructure). It must be enabled via the dashboard. This is the one manual step documented here.

---

## 4. Enum Types

All domain-specific values use PostgreSQL enums for type safety at the database level:

| Enum | Values | Used By |
|------|--------|---------|
| `user_role` | admin, teacher, parent | profiles.role |
| `student_status` | active, left | students.status |
| `attendance_status` | present, absent, late, leave | attendance.status |
| `voucher_status` | unpaid, partial, paid | vouchers.status |
| `ledger_kind` | voucher, payment, fine, discount, adjustment | ledger_entries.kind |
| `payment_method` | cash, stripe | ledger_entries.method |
| `remark_status` | draft, approved, rejected, low_data | remarks.status |
| `reminder_bucket` | due_date, 7d_gentle, 14d_firm, 30d_final | reminder_templates.bucket, message_log.bucket |
| `message_channel` | email, whatsapp | message_log.channel |
| `message_status` | pending, sent, failed | message_log.status |
| `inquiry_status` | open, resolved | inquiries.status |
| `language_pref` | en, ur | profiles, guardians, remarks |
| `late_fine_type` | flat, percentage | fee_rules.late_fine_type |

---

## 5. Tables (23 total)

### 5.1 academies
Single-tenant for v1, but `academy_id` is on every table for future multi-branch.

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, default gen_random_uuid() |
| name | text | NOT NULL |
| created_at | timestamptz | NOT NULL, default now() |

### 5.2 profiles
Mirrors `auth.users` — created automatically by the `handle_new_user` trigger.

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, FK → auth.users(id) ON DELETE CASCADE |
| academy_id | uuid | NOT NULL, FK → academies |
| role | user_role | NOT NULL |
| full_name | text | NOT NULL |
| email | text | NOT NULL |
| phone | text | |
| language_pref | language_pref | NOT NULL, default 'en' |
| active | boolean | NOT NULL, default true |
| created_at | timestamptz | NOT NULL, default now() |
| updated_at | timestamptz | NOT NULL, default now() (auto-refreshed by trigger) |

**Indexes:** academy_id, role

### 5.3 guardians
One guardian → many students. The link between a parent auth user and their children.

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK |
| profile_id | uuid | NOT NULL, UNIQUE, FK → profiles ON DELETE CASCADE |
| academy_id | uuid | NOT NULL, FK → academies |
| name | text | NOT NULL |
| phone | text | UNIQUE (for WhatsApp mapping) |
| email | text | |
| language_pref | language_pref | NOT NULL, default 'en' |
| verified | boolean | NOT NULL, default false |
| reminders_paused | boolean | NOT NULL, default false |
| reminders_paused_reason | text | |
| created_at | timestamptz | NOT NULL, default now() |

**Design decision:** `reminders_paused` lives here (not a separate table) because it's a simple per-family toggle with a reason. The reminder engine checks this flag directly.

### 5.4 students

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK |
| academy_id | uuid | NOT NULL, FK → academies |
| guardian_id | uuid | NOT NULL, FK → guardians |
| name | text | NOT NULL |
| photo_key | text | R2 object key only (not URL) |
| grade | text | |
| status | student_status | NOT NULL, default 'active' |
| joined_at | date | NOT NULL, default current_date |
| fee_override | numeric(10,2) | Custom fee (scholarship, etc.) |
| override_reason | text | Required context for overrides |
| needs_fee_review | boolean | NOT NULL, default false |
| created_at | timestamptz | NOT NULL, default now() |
| updated_at | timestamptz | NOT NULL, default now() |

**Design decisions:**
- `fee_override` replaces batch tuition when set — the voucher generator checks this first
- `needs_fee_review` is set on mid-month enrollments; admin clears it after manual adjustment
- `status = 'left'` stops future vouchers (voucher generator filters on `status = 'active'`)
- Sibling discount is **derived** at voucher time by counting active students sharing the same guardian — no stored flag

### 5.5 batches

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK |
| academy_id | uuid | NOT NULL, FK → academies |
| name | text | NOT NULL |
| grade_level | text | |
| days_of_week | text[] | Array of day names |
| start_time | time | |
| end_time | time | |
| monthly_tuition | numeric(10,2) | NOT NULL |
| active | boolean | NOT NULL, default true |
| created_at / updated_at | timestamptz | Auto-managed |

### 5.6 subjects

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK |
| academy_id | uuid | NOT NULL, FK → academies |
| batch_id | uuid | NOT NULL, FK → batches ON DELETE CASCADE |
| name | text | NOT NULL |

**Unique constraint:** (batch_id, name) — no duplicate subject names within a batch.

### 5.7 batch_teachers

Join table for teacher ↔ batch assignments. This is the foundation of teacher RLS — teachers can only access batches they're assigned to.

**Unique constraint:** (batch_id, teacher_id)

### 5.8 enrollments

| Column | Type | Constraints |
|--------|------|-------------|
| student_id | uuid | NOT NULL, FK → students ON DELETE CASCADE |
| batch_id | uuid | NOT NULL, FK → batches ON DELETE CASCADE |
| start_date | date | NOT NULL, default current_date |
| end_date | date | NULL means currently enrolled |

**Unique constraint:** (student_id, batch_id, start_date) — a student can re-enroll in a batch after leaving.

### 5.9 fee_rules

One row per academy. Configures the fee engine behavior.

| Column | Type | Constraints |
|--------|------|-------------|
| academy_id | uuid | NOT NULL, UNIQUE, FK → academies |
| sibling_discount_pct | numeric(5,2) | NOT NULL, default 0 |
| late_fine_type | late_fine_type | NOT NULL, default 'flat' |
| late_fine_value | numeric(10,2) | NOT NULL, default 0 |
| late_fine_grace_days | integer | NOT NULL, default 0 |
| generation_day | integer | NOT NULL, default 1, CHECK 1-28 |
| due_day | integer | NOT NULL, default 10, CHECK 1-28 |
| admission_fee | numeric(10,2) | NOT NULL, default 0 |

**Design decisions:**
- Days capped at 28 to avoid month-length issues
- `late_fine_grace_days` allows N days after due_date before fines accrue
- These values are **snapshotted** onto each voucher at generation time — later changes never mutate issued vouchers

### 5.10 attendance

| Column | Type | Constraints |
|--------|------|-------------|
| student_id | uuid | NOT NULL, FK → students |
| batch_id | uuid | NOT NULL, FK → batches |
| date | date | NOT NULL |
| status | attendance_status | NOT NULL, default 'present' |
| marked_by | uuid | NOT NULL, FK → profiles |
| corrected_by | uuid | FK → profiles |
| corrected_at | timestamptz | |

**Unique constraint:** (student_id, batch_id, date) — one record per student per batch per day.

**Design decisions:**
- Teachers can only edit same-day (enforced by RLS UPDATE policy, not UI)
- Admin corrections are logged via `corrected_by` / `corrected_at` (set by trigger)
- Default-all-present in the UI, but the DB only stores rows for students who were actually marked

### 5.11 assessments

| Column | Type | Constraints |
|--------|------|-------------|
| batch_id | uuid | NOT NULL, FK → batches |
| subject_id | uuid | NOT NULL, FK → subjects |
| date | date | NOT NULL |
| max_marks | numeric(6,2) | NOT NULL, CHECK > 0 |
| published | boolean | NOT NULL, default false |
| created_by | uuid | NOT NULL, FK → profiles |

**Design decision:** `published` lives on the assessment (not individual scores). Publishing makes ALL scores for that test visible to parents simultaneously.

### 5.12 scores

| Column | Type | Constraints |
|--------|------|-------------|
| assessment_id | uuid | NOT NULL, FK → assessments ON DELETE CASCADE |
| student_id | uuid | NOT NULL, FK → students |
| obtained | numeric(6,2) | CHECK >= 0 |
| absent | boolean | NOT NULL, default false |

**Unique constraint:** (assessment_id, student_id)

**Check constraint:** `(absent = true AND obtained IS NULL) OR (absent = false AND obtained IS NOT NULL)` — a student is either absent (no score) or present (must have a score).

**Trigger:** `trg_scores_check_max` validates `obtained <= assessment.max_marks` at the DB level — can't be bypassed by API calls.

### 5.13 vouchers

| Column | Type | Constraints |
|--------|------|-------------|
| student_id | uuid | NOT NULL, FK → students |
| guardian_id | uuid | NOT NULL, FK → guardians |
| period | date | NOT NULL (normalized to 1st of month) |
| line_items | jsonb | NOT NULL, default '[]' |
| tuition_amount | numeric(10,2) | NOT NULL |
| sibling_discount | numeric(10,2) | NOT NULL, default 0 |
| arrears | numeric(10,2) | NOT NULL, default 0 |
| fines | numeric(10,2) | NOT NULL, default 0 |
| total | numeric(10,2) | NOT NULL |
| due_date | date | NOT NULL |
| status | voucher_status | NOT NULL, default 'unpaid' |
| token | text | NOT NULL, UNIQUE, default 32-char hex |
| rule_snapshot | jsonb | NOT NULL |

**Unique constraint:** (student_id, period) — idempotent generation; same student same month = one voucher, ever.

**Design decisions:**
- `token` is 32 hex chars (from 16 random bytes) — exceeds the ≥20 char requirement for public pay links
- `rule_snapshot` captures the fee_rules values used at generation time — later rule changes never affect issued vouchers
- `status` is derived from ledger sums but stored for query efficiency; only the payment recording functions and webhook write it
- `line_items` JSONB stores the full itemized breakdown shown to parents

### 5.14 ledger_entries (APPEND-ONLY)

| Column | Type | Constraints |
|--------|------|-------------|
| guardian_id | uuid | NOT NULL, FK → guardians |
| student_id | uuid | NOT NULL, FK → students |
| voucher_id | uuid | FK → vouchers (nullable for adjustments) |
| kind | ledger_kind | NOT NULL |
| amount | numeric(10,2) | NOT NULL |
| method | payment_method | (for payments only) |
| stripe_event_id | text | UNIQUE (webhook idempotency) |
| receipt_number | text | UNIQUE (cash receipts) |
| reason | text | (for adjustments) |
| created_by | uuid | FK → profiles |

**Append-only enforcement (belt and braces):**
1. `REVOKE UPDATE, DELETE ON ledger_entries FROM authenticated, anon, service_role`
2. RLS policies will grant INSERT only (no UPDATE/DELETE policies exist)

**Design decisions:**
- This is the single source of truth for all money — balances are always computed from this table
- `stripe_event_id` UNIQUE makes webhook replays a no-op (catch the unique violation, return 200)
- Corrections are new rows with `kind = 'adjustment'` and a `reason`, never edits
- Receipt numbers come from a PostgreSQL sequence (`receipt_number_seq`, starts at 1001)

### 5.15 remarks

**Unique constraint:** (student_id, period) — one remark per student per month.

Status flow: `draft` → `approved` (teacher approves) or `rejected`. Special status `low_data` for students with insufficient data.

Parent visibility enforced by RLS: only `status = 'approved'` rows are readable.

### 5.16 reminder_templates

**Unique constraint:** (academy_id, bucket, language, template_version) — immutable versions; new versions are new rows with incremented version number.

Admins create new versions, never edit sent ones — preserves the audit trail of what was actually sent.

### 5.17 message_log

**Unique constraint:** (voucher_id, bucket, channel) — max one message per voucher per escalation bucket per channel. This is the "one message per bucket" rule enforced as a data constraint.

### 5.18 chat_sessions / chat_messages / chat_usage

- Sessions track per-guardian conversations with token usage
- Messages store the full conversation including tool calls and payloads
- `chat_usage` has unique (guardian_id, date) for daily rate limiting

### 5.19 inquiries

Chatbot escalations. Guardian asks something out of scope → chatbot creates an inquiry → admin sees it in their inbox.

### 5.20 waitlist

Landing page signups. Just email + source + timestamp. Will have anon INSERT-only RLS.

### 5.21 job_runs

Audit log for cron jobs. Stores the job name, period, and result JSON for every run.

---

## 6. Views (5)

**All views have `security_invoker = on`** — queries execute with the calling user's privileges, so RLS on base tables applies. Without this, views would run as the owner (`postgres`) and bypass RLS entirely. This is critical for `voucher_balances` and `guardian_balances` which parents query directly.

### voucher_balances
Computes per-voucher outstanding amount by summing payment ledger entries against the voucher total. Used everywhere a voucher balance is displayed.

### guardian_balances
Aggregates voucher_balances per guardian — total outstanding and count of unpaid vouchers.

### defaulters
Joins vouchers → voucher_balances → guardians. Filters to unpaid/partial vouchers past due date. Computes `days_overdue` and assigns a `reminder_bucket`. Also exposes `reminders_paused` flag.

**Critical:** This single view powers both the admin defaulter screen AND the reminder engine — they can never disagree because they read the same source.

### batches_marked_today
For the admin realtime tile: which active batches have at least one attendance row for today.

### monthly_collections
Payments grouped by month and method (cash/stripe) with count and total.

---

## 7. Functions (12)

### RLS Helpers (SECURITY DEFINER, stable, `search_path = public`)

All RLS helpers are `SECURITY DEFINER` with a pinned `search_path = public`. Without the pinned search_path, a SECURITY DEFINER function is a known privilege-escalation vector (attacker creates a schema with a malicious function of the same name earlier in the path).

| Function | Returns | Purpose |
|----------|---------|---------|
| `auth_role()` | text | Current user's role from profiles |
| `auth_guardian_id()` | uuid | Current user's guardian ID (for parents) |
| `auth_student_ids()` | setof uuid | All student IDs belonging to current guardian |
| `auth_teacher_batch_ids()` | setof uuid | All batch IDs assigned to current teacher |
| `auth_teacher_student_ids()` | setof uuid | All student IDs in batches assigned to current teacher (via enrollments) |
| `auth_child_batch_ids()` | setof uuid | All batch IDs that the current parent's children are enrolled in |

### Business Logic / RPCs
| Function | Purpose |
|----------|---------|
| `handle_new_user()` | Trigger function: creates profile row when auth.users row is inserted. **Fails loudly** (raises exception) if `academy_id` or `role` is missing from `raw_user_meta_data` — all users are admin-provisioned, so missing metadata means a bug in the invite flow |
| `attendance_summary(student_id, month)` | Returns attendance stats (total, present, absent, late, leave, %) for a student in a month |
| `update_updated_at()` | Generic trigger function for auto-refreshing updated_at |
| `check_score_max()` | Trigger function: validates obtained <= max_marks |
| `audit_attendance_correction()` | Trigger function: logs who corrected an attendance record |
| `record_cash_payment(voucher_id, amount)` | SECURITY DEFINER RPC: atomically records cash payment (ledger entry + receipt number + voucher status update). Validates admin role, blocks overpayment, uses `FOR UPDATE` row lock for concurrency safety. Only two code paths write voucher status: this RPC and the Stripe webhook. |

---

## 8. Triggers (10)

| Trigger | Table | Event | Purpose |
|---------|-------|-------|---------|
| `on_auth_user_created` | auth.users | AFTER INSERT | Auto-creates profile |
| `trg_profiles_updated_at` | profiles | BEFORE UPDATE | Refresh updated_at |
| `trg_students_updated_at` | students | BEFORE UPDATE | Refresh updated_at |
| `trg_batches_updated_at` | batches | BEFORE UPDATE | Refresh updated_at |
| `trg_assessments_updated_at` | assessments | BEFORE UPDATE | Refresh updated_at |
| `trg_scores_updated_at` | scores | BEFORE UPDATE | Refresh updated_at |
| `trg_remarks_updated_at` | remarks | BEFORE UPDATE | Refresh updated_at |
| `trg_fee_rules_updated_at` | fee_rules | BEFORE UPDATE | Refresh updated_at |
| `trg_scores_check_max` | scores | BEFORE INSERT/UPDATE | Validate score ≤ max |
| `trg_attendance_correction` | attendance | BEFORE UPDATE | Audit correction metadata |

---

## 9. Sequences

| Sequence | Starts At | Purpose |
|----------|-----------|---------|
| `receipt_number_seq` | 1001 | Auto-incrementing receipt numbers for cash payments |

---

## 10. Realtime

Enabled for three tables (added to `supabase_realtime` publication):

| Table | Use Case |
|-------|----------|
| `attendance` | Admin tile: "X/Y batches marked today" updates live |
| `ledger_entries` | Front-desk "today's collections" updates live; payment confirmation on parent portal |
| `vouchers` | Voucher status changes reflected in real time |

RLS applies to realtime subscriptions — parents only receive events for their own data.

**Important:** The Bubble realtime bridge must call `supabase.realtime.setAuth(userJwt)` on initialization AND after every silent token refresh. If the token expires on the socket, the subscription falls back to anon (which has no realtime access to these tables) and silently stops receiving events. Build the refresh hook into the bridge element from the start.

---

## 11. Key Design Principles Enforced

1. **Append-only ledger:** REVOKE UPDATE/DELETE + no such RLS policies. Money is never edited — corrections are adjustment rows.

2. **Idempotency everywhere:**
   - Voucher generation: UNIQUE (student_id, period)
   - Stripe webhooks: UNIQUE (stripe_event_id)
   - Reminders: UNIQUE (voucher_id, bucket, channel)
   - Attendance: UNIQUE (student_id, batch_id, date)

3. **Computed, not stored:** Balances are views over ledger_entries. Percentages/averages come from functions. Never a stored balance column that can drift.

4. **Snapshots for immutability:** Vouchers snapshot fee_rules at generation time. Reminder templates are versioned, never edited. History is preserved even when config changes.

5. **DB-level validation:** Score ≤ max_marks (trigger), fee days 1-28 (CHECK), score absent/obtained exclusivity (CHECK), enum types for all domain values.

6. **Security by default:** academy_id on every table, helper functions for RLS, SECURITY DEFINER with pinned search_path, security_invoker on views, token length exceeds requirements.

7. **Fail loudly on invalid state:** `handle_new_user` raises an exception if required metadata is missing. Silent defaults (e.g., defaulting to some role) are more dangerous than a failed insert — they create users with wrong permissions.

---

## 12. Gotchas & Notes for Future Development

- **`extensions.gen_random_bytes()`** — must be schema-qualified in migrations because the `supabase db push` role doesn't have `extensions` in its search_path
- **`pg_cron` lives in the `cron` schema** (not `extensions`) — use `cron.schedule()`, `cron.job`, etc. The dashboard says "extensions" but the actual schema is `cron`
- **`pg_cron` cannot be created via migration** — it's managed by Supabase infrastructure. Must be enabled via dashboard. This is the one manual step
- **`pg_net`** can be enabled in migrations with `create extension if not exists "pg_net" with schema "extensions"` — tested and working
- **Realtime + RLS** — subscriptions respect RLS policies, but ONLY if the client has called `setAuth(jwt)`. An expired token silently falls back to anon (no events). Always refresh the token on the socket after silent auth refresh
- **`service_role` REVOKE on ledger_entries** — edge functions using service_role that need to INSERT into ledger_entries will work (INSERT is still granted); they just can't UPDATE/DELETE either
- **Views and RLS** — all views have `security_invoker = on`. Without this, view queries run as the owner (postgres), bypassing RLS completely. Any new views added later MUST also set this
- **SECURITY DEFINER functions** — always pin `search_path = public`. This prevents search_path manipulation attacks. Any new SECURITY DEFINER functions MUST follow this pattern
- **`voucher.status` is stored-but-derived** — it's a cache of what the ledger says. The negative-test suite should assert `status` agrees with `voucher_balances.outstanding` after payment scenarios to catch drift mechanically

---

## 13. Security Hardening Applied (Migration 002)

After the initial schema, a security hardening pass was applied:

| Fix | Risk Mitigated |
|-----|---------------|
| `search_path = public` on all SECURITY DEFINER functions | Search-path manipulation privilege escalation |
| `security_invoker = on` on all views | Views bypassing RLS (running as postgres owner) |
| `handle_new_user` validates metadata before insert | Silent creation of users with wrong/missing roles |

These are patterns that MUST be followed for any future additions:
- New SECURITY DEFINER function → add `set search_path = public`
- New view → add `alter view X set (security_invoker = on)`
- New trigger creating rows from user-supplied data → validate required fields loudly

---

## 14. RLS Policies (Migration 003)

### Design Rules
1. **Default deny** — `enable row level security` on all tables first. No policy = zero access.
2. **Helpers, not joins** — SECURITY DEFINER helpers bypass RLS deliberately; avoids recursion and double-filtering.
3. **`(select ...)` wrapper** — e.g. `guardian_id = (select auth_guardian_id())` evaluates once per query (InitPlan), not per row.
4. **`to authenticated`** on every policy except waitlist (anon gets only INSERT there).
5. **Roles OR together** — separate permissive policies per role, never one mega-policy with role branches.
6. **No `FORCE ROW LEVEL SECURITY`** — postgres/service_role must bypass for triggers and edge functions.
7. **Money writes via RPCs/edge functions** — never direct PostgREST inserts (except admin adjustments with reason).
8. **Same-day rule uses PKT** — `(now() at time zone 'Asia/Karachi')::date` so 9 PM sessions work and post-midnight doesn't slip.

### Policy Count: 56 across 23 tables

### Key Access Controls
| Area | Rule |
|------|------|
| Parent cross-family | Every parent query scoped through `auth_guardian_id()` → their students. Impossible to reach another family. |
| Teacher batch isolation | All teacher access gated by `auth_teacher_batch_ids()`. Zero access to vouchers/ledger/guardians/fee_rules. |
| Publish gate (scores) | Parents see scores only where `assessment.published = true` — checked in the policy itself, not UI. |
| Approval gate (remarks) | Parents see remarks only where `status = 'approved'` — RLS enforcement per §15 Rule 5. |
| Ledger append-only | No UPDATE/DELETE policies + REVOKE. Admin INSERT limited to `kind IN ('adjustment','discount')` with mandatory `reason`. |
| Same-day attendance | Teachers can INSERT/UPDATE attendance only for `date = today (PKT)` in their assigned batches. |
| Anon lockdown | `REVOKE ALL` from anon; only `INSERT on waitlist` granted. |
| Template immutability | `REVOKE UPDATE, DELETE` on reminder_templates — new versions are new rows. |

### record_cash_payment RPC
Atomic SECURITY DEFINER function callable via `POST /rest/v1/rpc/record_cash_payment`:
- Validates caller is admin
- Locks voucher row (`FOR UPDATE`) to prevent concurrent double-recording
- Computes outstanding from ledger (source of truth)
- Blocks overpayment, blocks zero/negative amounts
- Inserts ledger entry with auto-generated receipt number
- Updates voucher status cache (`partial` or `paid`)
- Returns JSON: `{receipt_number, paid, remaining, status}`

---

## 15. Negative Test Suite (24 tests — all green)

**File:** `tests/rls/rls_negative_tests.sql`

Uses PostgREST impersonation pattern (`set local role` + `request.jwt.claims`). Each test is a `do $$` block that raises an exception on failure.

| # | As | Tests | Result |
|---|----|-------|--------|
| 1-4 | Parent A | Cannot see Family B's students, vouchers, ledger, attendance | PASS |
| 5-6 | Parent A | Views (voucher_balances, guardian_balances) respect security_invoker | PASS |
| 7 | Parent A | Cannot see unpublished assessment scores for own child | PASS |
| 8 | Parent A | Cannot see draft remarks | PASS |
| 9 | Parent A | Zero access to fee_rules, templates, message_log | PASS |
| 10 | Parent A | Cannot see Family B's chat sessions, messages, inquiries | PASS |
| 11 | Teacher 1 | Cannot see Teacher 2's batch attendance/scores | PASS |
| 12 | Teacher 1 | Zero access to vouchers, ledger, guardians, fee_rules | PASS |
| 13 | Teacher 1 | Cannot insert attendance for unassigned batch | PASS |
| 14 | Teacher 1 | Cannot insert attendance for yesterday (same-day rule) | PASS |
| 15 | Teacher 1 | Cannot update yesterday's attendance | PASS |
| 16 | Teacher 1 | Cannot see students from unassigned batches | PASS |
| 17 | Admin | Cannot UPDATE ledger entries (REVOKE enforced) | PASS |
| 18 | Admin | Cannot INSERT payment-kind ledger entry directly | PASS |
| 19 | Admin | Cannot INSERT adjustment without reason | PASS |
| 20 | Anon | Cannot SELECT any table (permission denied) | PASS |
| 21 | Anon | Can INSERT waitlist but cannot SELECT it back | PASS |
| 22 | Parent A | **Positive control** — sees exactly 2 students, 1 voucher, 1 score, 1 remark, 3 attendance | PASS |
| 23 | Admin | record_cash_payment blocks overpayment | PASS |
| 24 | Parent A | Cannot see other families in defaulters view | PASS |

**Test seed data** (already in the live DB):
- 1 academy, 5 users (admin + 2 teachers + 2 parents)
- 2 guardians, 3 students (1 sibling pair), 2 batches, teacher assignments
- Attendance (today + yesterday), 1 published + 1 unpublished assessment with scores
- 1 partial-paid + 1 unpaid voucher, 1 ledger payment, 1 approved + 1 draft remark
- Chat sessions, messages, inquiries, templates, message_log for both families

**Re-run this suite after every future migration.** RLS regressions are silent; the suite is what makes them loud.

---

## 16. What's Next

Schema + RLS + tests are deployed and verified. Next steps:

1. **Full seed data** — 150 students, 10 batches, 3 months of history (realistic data for Week 2+ features)
2. **Edge functions** — starting with `invite-user` (Week 1 deliverable)
3. **Bubble auth integration** — prove one authenticated PostgREST call works before building screens
