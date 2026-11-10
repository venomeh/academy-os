# AcademyOS — Supabase Week 1 Structure (Complete Reference)

> Snapshot date: 2026-08-04  
> Project ref: `<PROJECT_REF>`  
> Supabase URL: `https://<PROJECT_REF>.supabase.co`  
> Bubble app: `<YOUR_BUBBLE_APP>.bubbleapps.io/version-test`

---

## 1. Project Architecture

```
academyOS-BubbleServer/
├── .env.example                      # Environment variables template
├── supabase/
│   ├── config.toml                   # Local dev config (port 54321, Postgres 17)
│   ├── migrations/
│   │   ├── 20260729075600_extensions.sql       # pgcrypto, pg_net
│   │   ├── 20260729075633_initial_schema.sql   # 23 tables, views, triggers, functions
│   │   ├── 20260729080000_security_hardening.sql # search_path pins, security_invoker
│   │   └── 20260729090000_rls_policies.sql     # 56 RLS policies, cash payment RPC
│   └── functions/
│       ├── invite-user/index.ts      # Admin invites teacher/parent
│       ├── verify-token/index.ts     # OTP verification + redirect
│       └── forgot-password/index.ts  # Password reset via magiclink
└── tests/rls/
    └── rls_negative_tests.sql        # 24 passing tests
```

---

## 2. Extensions Enabled

| Extension | Schema | Purpose |
|-----------|--------|---------|
| `pgcrypto` | extensions | `gen_random_uuid()`, `gen_random_bytes()` |
| `pg_net` | extensions | HTTP calls from within Postgres (cron → edge functions) |
| `pg_cron` | — | Scheduled jobs (enabled via dashboard, not migration) |

---

## 3. Enum Types

```sql
user_role:        'admin' | 'teacher' | 'parent'
student_status:   'active' | 'left'
attendance_status:'present' | 'absent' | 'late' | 'leave'
voucher_status:   'unpaid' | 'partial' | 'paid'
ledger_kind:      'voucher' | 'payment' | 'fine' | 'discount' | 'adjustment'
payment_method:   'cash' | 'stripe'
remark_status:    'draft' | 'approved' | 'rejected' | 'low_data'
reminder_bucket:  'due_date' | '7d_gentle' | '14d_firm' | '30d_final'
message_channel:  'email' | 'whatsapp'
message_status:   'pending' | 'sent' | 'failed'
inquiry_status:   'open' | 'resolved'
language_pref:    'en' | 'ur'
late_fine_type:   'flat' | 'percentage'
```

---

## 4. Tables (23 total)

### 4.1. academies
```sql
id          uuid PK default gen_random_uuid()
name        text NOT NULL
created_at  timestamptz NOT NULL default now()
```
Single tenant v1. Every other table references `academy_id`.

---

### 4.2. profiles
```sql
id              uuid PK references auth.users(id) ON DELETE CASCADE
academy_id      uuid NOT NULL FK → academies
role            user_role NOT NULL
full_name       text NOT NULL
email           text NOT NULL
phone           text
language_pref   language_pref NOT NULL default 'en'
active          boolean NOT NULL default true
created_at      timestamptz NOT NULL default now()
updated_at      timestamptz NOT NULL default now()  -- auto-trigger
```
**Indexes:** `idx_profiles_academy(academy_id)`, `idx_profiles_role(role)`  
**Trigger:** `trg_profiles_updated_at` → auto-sets `updated_at`  
**Created by:** `handle_new_user()` trigger on `auth.users` INSERT

---

### 4.3. guardians
```sql
id                      uuid PK default gen_random_uuid()
profile_id              uuid NOT NULL UNIQUE FK → profiles ON DELETE CASCADE
academy_id              uuid NOT NULL FK → academies
name                    text NOT NULL
phone                   text UNIQUE
email                   text
language_pref           language_pref NOT NULL default 'en'
verified                boolean NOT NULL default false
reminders_paused        boolean NOT NULL default false
reminders_paused_reason text
created_at              timestamptz NOT NULL default now()
```
**Index:** `idx_guardians_academy(academy_id)`  
**Relationship:** 1 guardian → N students (via `students.guardian_id`)  
**Created by:** `invite-user` edge function when role='parent'

---

### 4.4. students
```sql
id              uuid PK default gen_random_uuid()
academy_id      uuid NOT NULL FK → academies
guardian_id     uuid NOT NULL FK → guardians
name            text NOT NULL
photo_key       text              -- R2 object key
grade           text
status          student_status NOT NULL default 'active'
joined_at       date NOT NULL default current_date
fee_override    numeric(10,2)     -- custom fee (scholarship)
override_reason text
needs_fee_review boolean NOT NULL default false  -- mid-month enrollment flag
created_at      timestamptz NOT NULL default now()
updated_at      timestamptz NOT NULL default now()  -- auto-trigger
```
**Indexes:** `idx_students_guardian(guardian_id)`, `idx_students_academy(academy_id)`, `idx_students_status(status)`  
**Sibling logic:** Multiple students with same `guardian_id` = siblings. Fee engine counts active students per guardian for discount.

---

### 4.5. batches
```sql
id              uuid PK default gen_random_uuid()
academy_id      uuid NOT NULL FK → academies
name            text NOT NULL
grade_level     text
days_of_week    text[]            -- e.g. ['Mon','Wed','Fri']
start_time      time
end_time        time
monthly_tuition numeric(10,2) NOT NULL
active          boolean NOT NULL default true
created_at      timestamptz NOT NULL default now()
updated_at      timestamptz NOT NULL default now()  -- auto-trigger
```
**Index:** `idx_batches_academy(academy_id)`

---

### 4.6. subjects
```sql
id          uuid PK default gen_random_uuid()
academy_id  uuid NOT NULL FK → academies
batch_id    uuid NOT NULL FK → batches ON DELETE CASCADE
name        text NOT NULL
created_at  timestamptz NOT NULL default now()
```
**Constraint:** `UNIQUE (batch_id, name)`

---

### 4.7. batch_teachers
```sql
id          uuid PK default gen_random_uuid()
batch_id    uuid NOT NULL FK → batches ON DELETE CASCADE
teacher_id  uuid NOT NULL FK → profiles ON DELETE CASCADE
created_at  timestamptz NOT NULL default now()
```
**Constraint:** `UNIQUE (batch_id, teacher_id)`  
**Index:** `idx_batch_teachers_teacher(teacher_id)`  
**Purpose:** Foundation of teacher RLS — all teacher access is gated through this join.

---

### 4.8. enrollments
```sql
id          uuid PK default gen_random_uuid()
student_id  uuid NOT NULL FK → students ON DELETE CASCADE
batch_id    uuid NOT NULL FK → batches ON DELETE CASCADE
start_date  date NOT NULL default current_date
end_date    date              -- NULL = currently enrolled
created_at  timestamptz NOT NULL default now()
```
**Constraint:** `UNIQUE (student_id, batch_id, start_date)`  
**Indexes:** `idx_enrollments_student(student_id)`, `idx_enrollments_batch(batch_id)`

---

### 4.9. fee_rules
```sql
id                  uuid PK default gen_random_uuid()
academy_id          uuid NOT NULL UNIQUE FK → academies
sibling_discount_pct numeric(5,2) NOT NULL default 0
late_fine_type      late_fine_type NOT NULL default 'flat'
late_fine_value     numeric(10,2) NOT NULL default 0
late_fine_grace_days integer NOT NULL default 0
generation_day      integer NOT NULL default 1 CHECK (1..28)
due_day             integer NOT NULL default 10 CHECK (1..28)
admission_fee       numeric(10,2) NOT NULL default 0
created_at          timestamptz NOT NULL default now()
updated_at          timestamptz NOT NULL default now()  -- auto-trigger
```
One row per academy. Snapshotted onto vouchers at generation time.

---

### 4.10. attendance
```sql
id           uuid PK default gen_random_uuid()
academy_id   uuid NOT NULL FK → academies
student_id   uuid NOT NULL FK → students ON DELETE CASCADE
batch_id     uuid NOT NULL FK → batches ON DELETE CASCADE
date         date NOT NULL
status       attendance_status NOT NULL default 'present'
marked_by    uuid NOT NULL FK → profiles
corrected_by uuid FK → profiles
corrected_at timestamptz
created_at   timestamptz NOT NULL default now()
```
**Constraint:** `UNIQUE (student_id, batch_id, date)`  
**Indexes:** `idx_attendance_batch_date(batch_id, date)`, `idx_attendance_student(student_id)`  
**Trigger:** `trg_attendance_correction` — auto-stamps `corrected_by`/`corrected_at` on status change  
**Realtime:** Enabled (in `supabase_realtime` publication)

---

### 4.11. assessments
```sql
id          uuid PK default gen_random_uuid()
academy_id  uuid NOT NULL FK → academies
batch_id    uuid NOT NULL FK → batches ON DELETE CASCADE
subject_id  uuid NOT NULL FK → subjects ON DELETE CASCADE
date        date NOT NULL
max_marks   numeric(6,2) NOT NULL CHECK (> 0)
published   boolean NOT NULL default false
created_by  uuid NOT NULL FK → profiles
created_at  timestamptz NOT NULL default now()
updated_at  timestamptz NOT NULL default now()  -- auto-trigger
```
**Index:** `idx_assessments_batch(batch_id)`  
**Gate:** Parents only see rows where `published = true` (RLS enforced)

---

### 4.12. scores
```sql
id             uuid PK default gen_random_uuid()
assessment_id  uuid NOT NULL FK → assessments ON DELETE CASCADE
student_id     uuid NOT NULL FK → students ON DELETE CASCADE
obtained       numeric(6,2) CHECK (>= 0)
absent         boolean NOT NULL default false
created_at     timestamptz NOT NULL default now()
updated_at     timestamptz NOT NULL default now()  -- auto-trigger
```
**Constraints:**
- `UNIQUE (assessment_id, student_id)`
- `valid_score`: if `absent=true` then `obtained` must be NULL; if `absent=false` then `obtained` must be NOT NULL

**Index:** `idx_scores_student(student_id)`  
**Trigger:** `trg_scores_check_max` — DB-level enforcement that `obtained <= max_marks`

---

### 4.13. vouchers
```sql
id               uuid PK default gen_random_uuid()
academy_id       uuid NOT NULL FK → academies
student_id       uuid NOT NULL FK → students ON DELETE CASCADE
guardian_id      uuid NOT NULL FK → guardians
period           date NOT NULL
line_items       jsonb NOT NULL default '[]'
tuition_amount   numeric(10,2) NOT NULL
sibling_discount numeric(10,2) NOT NULL default 0
arrears          numeric(10,2) NOT NULL default 0
fines            numeric(10,2) NOT NULL default 0
total            numeric(10,2) NOT NULL
due_date         date NOT NULL
status           voucher_status NOT NULL default 'unpaid'
token            text NOT NULL UNIQUE default encode(gen_random_bytes(16), 'hex')
rule_snapshot    jsonb NOT NULL
generated_at     timestamptz NOT NULL default now()
```
**Constraint:** `UNIQUE (student_id, period)` — idempotent generation  
**Indexes:** `idx_vouchers_guardian`, `idx_vouchers_status`, `idx_vouchers_due_date`, `idx_vouchers_token`  
**Realtime:** Enabled

---

### 4.14. ledger_entries (APPEND-ONLY)
```sql
id              uuid PK default gen_random_uuid()
academy_id      uuid NOT NULL FK → academies
guardian_id     uuid NOT NULL FK → guardians
student_id      uuid NOT NULL FK → students
voucher_id      uuid FK → vouchers
kind            ledger_kind NOT NULL
amount          numeric(10,2) NOT NULL
method          payment_method
stripe_event_id text UNIQUE          -- idempotency for webhooks
receipt_number  text UNIQUE          -- auto from sequence
reason          text                 -- mandatory for adjustments/discounts
created_by      uuid FK → profiles
created_at      timestamptz NOT NULL default now()
```
**Indexes:** `idx_ledger_guardian`, `idx_ledger_student`, `idx_ledger_voucher`, `idx_ledger_kind`  
**Security:** `REVOKE UPDATE, DELETE` from authenticated, anon, AND service_role  
**Realtime:** Enabled  
**Sequence:** `receipt_number_seq` starts at 1001 → "R-1001", "R-1002", etc.

---

### 4.15. remarks
```sql
id          uuid PK default gen_random_uuid()
academy_id  uuid NOT NULL FK → academies
student_id  uuid NOT NULL FK → students ON DELETE CASCADE
period      date NOT NULL
draft_text  text
final_text  text
language    language_pref NOT NULL default 'en'
status      remark_status NOT NULL default 'draft'
approved_by uuid FK → profiles
approved_at timestamptz
created_at  timestamptz NOT NULL default now()
updated_at  timestamptz NOT NULL default now()  -- auto-trigger
```
**Constraint:** `UNIQUE (student_id, period)`  
**Index:** `idx_remarks_student`, `idx_remarks_status`  
**Gate:** Parents only see `status = 'approved'` (RLS enforced)

---

### 4.16. reminder_templates
```sql
id               uuid PK default gen_random_uuid()
academy_id       uuid NOT NULL FK → academies
bucket           reminder_bucket NOT NULL
language         language_pref NOT NULL default 'en'
template_version integer NOT NULL default 1
subject_line     text NOT NULL
body             text NOT NULL
active           boolean NOT NULL default true
created_at       timestamptz NOT NULL default now()
```
**Constraint:** `UNIQUE (academy_id, bucket, language, template_version)`  
**Security:** `REVOKE UPDATE, DELETE` from authenticated, anon — templates are IMMUTABLE once created

---

### 4.17. message_log
```sql
id               uuid PK default gen_random_uuid()
academy_id       uuid NOT NULL FK → academies
guardian_id      uuid NOT NULL FK → guardians
voucher_id       uuid FK → vouchers
bucket           reminder_bucket
channel          message_channel NOT NULL
status           message_status NOT NULL default 'pending'
template_version integer
content          text
error_detail     text
sent_at          timestamptz
created_at       timestamptz NOT NULL default now()
```
**Constraint:** `UNIQUE (voucher_id, bucket, channel)` — one message per bucket per voucher per channel  
**Indexes:** `idx_message_log_guardian`, `idx_message_log_voucher`

---

### 4.18. chat_sessions
```sql
id              uuid PK default gen_random_uuid()
guardian_id     uuid NOT NULL FK → guardians ON DELETE CASCADE
started_at      timestamptz NOT NULL default now()
last_message_at timestamptz NOT NULL default now()
token_usage     integer NOT NULL default 0
```
**Index:** `idx_chat_sessions_guardian`

---

### 4.19. chat_messages
```sql
id           uuid PK default gen_random_uuid()
session_id   uuid NOT NULL FK → chat_sessions ON DELETE CASCADE
role         text NOT NULL CHECK (role in ('user', 'assistant', 'tool'))
content      text NOT NULL
tool_name    text
tool_payload jsonb
created_at   timestamptz NOT NULL default now()
```
**Index:** `idx_chat_messages_session`

---

### 4.20. chat_usage (rate limiting)
```sql
id             uuid PK default gen_random_uuid()
guardian_id    uuid NOT NULL FK → guardians
date           date NOT NULL default current_date
request_count  integer NOT NULL default 0
```
**Constraint:** `UNIQUE (guardian_id, date)`

---

### 4.21. inquiries
```sql
id          uuid PK default gen_random_uuid()
academy_id  uuid NOT NULL FK → academies
guardian_id uuid NOT NULL FK → guardians
topic       text NOT NULL
message     text NOT NULL
status      inquiry_status NOT NULL default 'open'
resolved_by uuid FK → profiles
resolved_at timestamptz
created_at  timestamptz NOT NULL default now()
```
**Indexes:** `idx_inquiries_guardian`, `idx_inquiries_status`

---

### 4.22. waitlist
```sql
id         uuid PK default gen_random_uuid()
email      text NOT NULL UNIQUE
source     text
created_at timestamptz NOT NULL default now()
```
**Access:** Anon INSERT only. No SELECT for anon.

---

### 4.23. job_runs
```sql
id         uuid PK default gen_random_uuid()
job_name   text NOT NULL
period     date
result     jsonb
created_at timestamptz NOT NULL default now()
```
Admin-only visibility. Audit log for cron jobs.

---

## 5. Views (5 total, all `security_invoker = on`)

### 5.1. voucher_balances
```sql
-- Per-voucher outstanding from ledger sums
SELECT v.id, v.student_id, v.guardian_id, v.period, v.total as voucher_total,
       v.due_date, v.status, sum(payments) as total_paid, 
       v.total - sum(payments) as outstanding
FROM vouchers v LEFT JOIN ledger_entries ...
```

### 5.2. guardian_balances
```sql
-- Per-guardian total outstanding across all children
SELECT g.id, g.name, sum(outstanding), count(unpaid_vouchers)
FROM guardians g LEFT JOIN voucher_balances ...
```

### 5.3. defaulters
```sql
-- Unpaid/partial vouchers past due with aging buckets
-- Columns: voucher_id, student_id, guardian_id, period, total, due_date,
--          status, outstanding, days_overdue, bucket (enum), reminders_paused
-- Bucket logic: >=30d → '30d_final', >=14d → '14d_firm', >=7d → '7d_gentle', else 'due_date'
```

### 5.4. batches_marked_today
```sql
-- Admin realtime tile: which batches have attendance marked today
SELECT b.id, b.name, EXISTS(attendance today) as marked_today
FROM batches b WHERE active = true
```

### 5.5. monthly_collections
```sql
-- Payments by month/method
SELECT month, method, count, sum(amount)
FROM ledger_entries WHERE kind = 'payment'
GROUP BY month, method
```

---

## 6. Helper Functions (used by RLS)

| Function | Returns | Purpose |
|----------|---------|---------|
| `auth_role()` | text | Current user's role from profiles |
| `auth_guardian_id()` | uuid | Guardian ID for current parent user |
| `auth_student_ids()` | setof uuid | Student IDs for current parent |
| `auth_teacher_batch_ids()` | setof uuid | Batch IDs assigned to current teacher |
| `auth_teacher_student_ids()` | setof uuid | Student IDs visible to current teacher (via enrollments) |
| `auth_child_batch_ids()` | setof uuid | Batch IDs where parent's children are enrolled |

All are `SECURITY DEFINER` with `SET search_path = public` (hardened).

---

## 7. Application Functions

### 7.1. record_cash_payment(p_voucher_id uuid, p_amount numeric) → jsonb
- **Security:** DEFINER, checks `auth_role() = 'admin'`
- **Logic:** Locks voucher row, computes outstanding from ledger, validates no overpayment, inserts ledger entry with receipt number, updates voucher status cache
- **Returns:** `{receipt_number, paid, remaining, status}`
- **Revoked from:** anon

### 7.2. attendance_summary(p_student_id uuid, p_month date) → table
- **Returns:** total_days, present_days, absent_days, late_days, leave_days, attendance_pct
- **Used by:** Remarks engine, parent portal, reports

---

## 8. Triggers

| Trigger | Table | Event | Function | Purpose |
|---------|-------|-------|----------|---------|
| `on_auth_user_created` | auth.users | AFTER INSERT | `handle_new_user()` | Auto-creates profile row from user metadata |
| `trg_profiles_updated_at` | profiles | BEFORE UPDATE | `update_updated_at()` | Timestamp |
| `trg_students_updated_at` | students | BEFORE UPDATE | `update_updated_at()` | Timestamp |
| `trg_batches_updated_at` | batches | BEFORE UPDATE | `update_updated_at()` | Timestamp |
| `trg_assessments_updated_at` | assessments | BEFORE UPDATE | `update_updated_at()` | Timestamp |
| `trg_scores_updated_at` | scores | BEFORE UPDATE | `update_updated_at()` | Timestamp |
| `trg_remarks_updated_at` | remarks | BEFORE UPDATE | `update_updated_at()` | Timestamp |
| `trg_fee_rules_updated_at` | fee_rules | BEFORE UPDATE | `update_updated_at()` | Timestamp |
| `trg_scores_check_max` | scores | BEFORE INSERT/UPDATE | `check_score_max()` | obtained ≤ max_marks enforcement |
| `trg_attendance_correction` | attendance | BEFORE UPDATE | `audit_attendance_correction()` | Stamps corrected_by/corrected_at |

---

## 9. RLS Policies (56 total)

### 9.1. Access Matrix Summary

| Table | Admin | Teacher | Parent | Anon |
|-------|-------|---------|--------|------|
| academies | ALL | SELECT | SELECT | — |
| profiles | ALL | own SELECT | own SELECT | — |
| guardians | ALL | — | own SELECT | — |
| students | ALL | batch-scoped SELECT | own SELECT | — |
| batches | ALL | assigned SELECT | child-batch SELECT | — |
| subjects | ALL | batch-scoped SELECT | child-batch SELECT | — |
| batch_teachers | ALL | own SELECT | — | — |
| enrollments | ALL | batch-scoped SELECT | own SELECT | — |
| fee_rules | ALL | — | — | — |
| attendance | ALL | batch+today INSERT/UPDATE, batch SELECT | own SELECT | — |
| assessments | ALL | batch ALL (own insert) | published+batch SELECT | — |
| scores | ALL | batch ALL (check student in batch) | published+own SELECT | — |
| vouchers | SELECT | — | own SELECT | — |
| ledger_entries | SELECT + adjustment INSERT | — | own SELECT | — |
| remarks | ALL | student SELECT + UPDATE | approved+own SELECT | — |
| reminder_templates | SELECT + INSERT | — | — | — |
| message_log | SELECT | — | — | — |
| chat_sessions | SELECT | — | own SELECT | — |
| chat_messages | SELECT | — | own SELECT | — |
| chat_usage | SELECT | — | own SELECT | — |
| inquiries | SELECT + UPDATE | — | own SELECT | — |
| waitlist | SELECT | — | — | INSERT only |
| job_runs | SELECT | — | — | — |

### 9.2. Key RLS Rules

- **Teacher same-day rule:** Attendance INSERT/UPDATE restricted to `date = (now() AT TIME ZONE 'Asia/Karachi')::date`
- **Publish gate:** Scores visible to parents only when the assessment's `published = true`
- **Approval gate:** Remarks visible to parents only when `status = 'approved'`
- **Ledger write restriction:** Admin can only INSERT `kind IN ('adjustment', 'discount')` with non-null `reason` and `created_by = auth.uid()`
- **Teacher isolation:** Zero access to vouchers, ledger, guardians, fee_rules, templates, message_log
- **Anon lockdown:** `REVOKE ALL` then only `GRANT INSERT ON waitlist`

---

## 10. Realtime

### Tables in `supabase_realtime` publication:
1. `attendance` — powers "batches marked today" admin tile
2. `ledger_entries` — powers "today's collections" admin tile
3. `vouchers` — payment status updates

### Tables NOT yet in realtime (needed for Week 2+):
- `profiles` — needed for live user list on invite
- `students` — needed for live student list
- `guardians` — needed for live guardian list
- `batches` — needed for live batch list

---

## 11. Edge Functions (3 deployed)

### 11.1. invite-user
- **Path:** `POST /functions/v1/invite-user`
- **Auth:** Bearer token (validates caller is admin)
- **Body:** `{email, role, full_name, phone, action?}`
- **Logic:**
  1. Validates admin role via JWT → profile lookup
  2. Checks for existing user (deactivated, pending invite, active)
  3. Creates auth user with metadata `{academy_id, role, full_name, phone}`
  4. For parents: creates `guardians` row
  5. Generates magiclink via `admin.generateLink()`
  6. Sends invite email via Resend
  7. Supports `action: "resend"` for pending invites
- **Returns:** `{success, error, user_id, role, message}`

### 11.2. verify-token
- **Path:** `GET /functions/v1/verify-token?token=<hash>&type=magiclink&redirect_to=<url>`
- **Auth:** None (public endpoint)
- **Logic:** Verifies OTP hash → creates session → redirects to app with `?access_token=<jwt>`
- **Used by:** Invite emails and password reset emails

### 11.3. forgot-password
- **Path:** `POST /functions/v1/forgot-password`
- **Auth:** None (public endpoint)
- **Body:** `{email}`
- **Logic:**
  1. Does NOT reveal whether email exists (always returns success message)
  2. Generates magiclink for existing user
  3. Sends reset email via Resend
- **Returns:** `{success, error, message}`

### 11.4. Not yet implemented (planned):
- `generate-vouchers` — monthly fee voucher generation (pg_cron trigger)
- `send-reminders` — escalating fee follow-ups
- `draft-remarks` — AI progress remark generation
- `chatbot` — agentic parent chatbot (Claude tool-use loop)
- `r2-presign` — Cloudflare R2 presigned URL generation
- `stripe-webhook` — Stripe payment webhook handler
- `resolve-voucher-token` — public pay link resolution

---

## 12. Bubble App State

### 12.1. Pages (6)
| Page | Purpose |
|------|---------|
| `index` | Login/home page |
| `reset_pw` | Password set/reset (receives `?access_token=`) |
| `404` | Not found |
| `admin_dashboard` | Admin landing |
| `teacher_today` | Teacher landing (today's attendance) |
| `parent_children` | Parent landing (children overview) |

### 12.2. Reusable Elements
- **AuthGuard** — JavaScript-to-Bubble bridge for token management
  - Custom states: `access_token` (text), `refresh_token` (text), `expires_at` (number), `login_role` (text), `active` (boolean)
  - Workflows: Load Session, Refresh Session, Ensure Fresh Token, Load Profile, Clear Session

### 12.3. API Connector Configuration

**Service 1: Supabase Auth** (`bTGLo0`)
- Shared headers: `apikey` (anon key), `Content-Type: application/json`

| Call | Method | URL |
|------|--------|-----|
| Login | POST | `/auth/v1/token?grant_type=password` |
| Refresh Token | POST | `/auth/v1/token?grant_type=refresh_token` |
| Logout | POST | `/auth/v1/logout` |
| Update Password | PUT | `/auth/v1/user` |
| Invite User | POST | `/functions/v1/invite-user` |
| Forgot Password | POST | `/functions/v1/forgot-password` |

**Service 2: Supabase Data** (`bTGMS0`)
- Shared headers: `apikey` (anon key), `Content-Type: application/json`

| Call | Method | URL | Purpose |
|------|--------|-----|---------|
| Get My Profile Data | GET | `/rest/v1/profiles?select=id,role,full_name,language_pref,active` | AuthGuard profile load |
| Get My Profile Action | GET | `/rest/v1/profiles?select=id,role,full_name,language_pref,active` | Duplicate for action context |
| Get All Profiles | GET | `/rest/v1/profiles?select=id,full_name,email,phone,role,active,created_at&order=role,full_name` | Admin user list |
| Get All Students (with guardian embedded) | GET | `/rest/v1/students?select=id,name,grade,status,joined_at,fee_override,guardian_id,guardians(name,email,phone)&order=name` | Admin student list |
| Get All Guardians (with children embedded) | GET | `/rest/v1/guardians?select=id,name,email,phone,verified,profile_id,students(id,name,grade,status)&order=name` | Admin guardian list |
| Get My Students | GET | `/rest/v1/students?select=id,name,grade,status,guardian_id` | Parent portal |

---

## 13. Auth Flow (complete)

```
Admin invites → invite-user edge function
  → createUser (with metadata: academy_id, role, full_name, phone)
  → handle_new_user trigger fires → inserts profiles row
  → (if parent) inserts guardians row
  → generates magiclink → sends invite email via Resend

User clicks invite link → verify-token edge function
  → verifies OTP hash → creates session
  → redirects to /reset_pw?access_token=<jwt>

Bubble /reset_pw page:
  → captures access_token from URL
  → calls PUT /auth/v1/user with {password} using that token
  → redirects to login

Login flow:
  → POST /auth/v1/token?grant_type=password
  → stores access_token, refresh_token, expires_at in custom states
  → calls GET /rest/v1/profiles to get role
  → routes to role-specific page

Token refresh:
  → before each API call, checks if expires_at is near
  → if so, calls POST /auth/v1/token?grant_type=refresh_token
  → updates stored tokens
```

---

## 14. Security Hardening Applied

1. **search_path pinned** on all SECURITY DEFINER functions (prevents search_path injection)
2. **security_invoker = on** on all views (RLS applies to the querying user, not the view owner)
3. **handle_new_user fails loudly** if metadata (academy_id, role) is missing
4. **Ledger is append-only** — REVOKE UPDATE/DELETE from ALL roles including service_role
5. **Reminder templates are immutable** — REVOKE UPDATE/DELETE from authenticated, anon
6. **Anon completely locked out** — REVOKE ALL then only grant INSERT on waitlist
7. **No secrets in browser** — service_role key, Stripe secret, Resend API key, Claude key all live in edge function env only

---

## 15. Sequences

| Sequence | Starts | Format | Purpose |
|----------|--------|--------|---------|
| `receipt_number_seq` | 1001 | "R-{n}" | Auto-generated receipt numbers for cash payments |

---

## 16. Indexes (all)

| Index | Table | Column(s) |
|-------|-------|-----------|
| idx_profiles_academy | profiles | academy_id |
| idx_profiles_role | profiles | role |
| idx_guardians_academy | guardians | academy_id |
| idx_students_guardian | students | guardian_id |
| idx_students_academy | students | academy_id |
| idx_students_status | students | status |
| idx_batches_academy | batches | academy_id |
| idx_batch_teachers_teacher | batch_teachers | teacher_id |
| idx_enrollments_student | enrollments | student_id |
| idx_enrollments_batch | enrollments | batch_id |
| idx_attendance_batch_date | attendance | batch_id, date |
| idx_attendance_student | attendance | student_id |
| idx_assessments_batch | assessments | batch_id |
| idx_scores_student | scores | student_id |
| idx_vouchers_guardian | vouchers | guardian_id |
| idx_vouchers_status | vouchers | status |
| idx_vouchers_due_date | vouchers | due_date |
| idx_vouchers_token | vouchers | token |
| idx_ledger_guardian | ledger_entries | guardian_id |
| idx_ledger_student | ledger_entries | student_id |
| idx_ledger_voucher | ledger_entries | voucher_id |
| idx_ledger_kind | ledger_entries | kind |
| idx_remarks_student | remarks | student_id |
| idx_remarks_status | remarks | status |
| idx_message_log_guardian | message_log | guardian_id |
| idx_message_log_voucher | message_log | voucher_id |
| idx_chat_sessions_guardian | chat_sessions | guardian_id |
| idx_chat_messages_session | chat_messages | session_id |
| idx_inquiries_guardian | inquiries | guardian_id |
| idx_inquiries_status | inquiries | status |

---

## 17. RLS Test Suite (24 tests, all passing)

**Test data UUIDs:**
```
Academy:     00000000-0000-0000-0000-000000000001
Admin:       00000000-0000-0000-0000-aaaaaaaaaa01
Teacher 1:   00000000-0000-0000-0000-bbbbbbbbbb01 (batch1)
Teacher 2:   00000000-0000-0000-0000-bbbbbbbbbb02 (batch2)
Parent A:    00000000-0000-0000-0000-cccccccccc01
Parent B:    00000000-0000-0000-0000-cccccccccc02
Guardian A:  00000000-0000-0000-0000-dddddddddd01
Guardian B:  00000000-0000-0000-0000-dddddddddd02
Student A1:  00000000-0000-0000-0000-eeeeeeeeee01 (batch1, guardian A)
Student A2:  00000000-0000-0000-0000-eeeeeeeeee02 (batch2, guardian A)
Student B1:  00000000-0000-0000-0000-eeeeeeeeee03 (batch1, guardian B)
Batch 1:     00000000-0000-0000-0000-ffffffffffff
Batch 2:     00000000-0000-0000-0000-fffffffffffe
```

| # | Test | Asserts |
|---|------|---------|
| 1 | Parent A → Family B students | 0 rows |
| 2 | Parent A → Family B vouchers | 0 rows |
| 3 | Parent A → Family B ledger | 0 rows |
| 4 | Parent A → Family B attendance | 0 rows |
| 5 | voucher_balances respects RLS | Own only |
| 6 | guardian_balances respects RLS | Own only |
| 7 | Unpublished scores invisible | 0 rows |
| 8 | Draft remarks invisible | 0 rows |
| 9 | Parent → admin tables (fee_rules, templates, message_log) | 0 rows each |
| 10 | Parent A → Family B chat data | 0 rows |
| 11 | Teacher 1 → Teacher 2's batch data | 0 rows |
| 12 | Teacher → money tables (vouchers, ledger, guardians, fee_rules) | 0 rows each |
| 13 | Teacher 1 → INSERT attendance for Teacher 2's batch | DENIED |
| 14 | Teacher 1 → INSERT attendance for yesterday | DENIED |
| 15 | Teacher 1 → UPDATE yesterday's attendance | 0 rows affected |
| 16 | Teacher 1 → students from unassigned batches | 0 rows |
| 17 | Admin → UPDATE ledger entries | DENIED (REVOKE) |
| 18 | Admin → INSERT payment-kind directly | DENIED (policy) |
| 19 | Admin → INSERT adjustment without reason | DENIED (policy) |
| 20 | Anon → SELECT students | 0 rows or DENIED |
| 21 | Anon → INSERT waitlist (OK) then SELECT waitlist (DENIED) | Insert works, select blocked |
| 22 | Parent A positive control — correct own data counts | 2 students, 1 voucher, 1 score, 1 remark, 3 attendance |
| 23 | record_cash_payment — overpayment blocked | Exception raised |
| 24 | Parent A → other family in defaulters view | 0 rows |

---

## 18. Environment Variables

| Variable | Value/Status | Used By |
|----------|-------------|---------|
| `SUPABASE_URL` | Set (<PROJECT_REF>) | All edge functions |
| `SUPABASE_ANON_KEY` | Set | Bubble shared headers, verify-token |
| `SUPABASE_SERVICE_ROLE_KEY` | Set | invite-user, forgot-password |
| `STRIPE_SECRET_KEY` | Set (sk_test_...) | stripe-webhook (not yet) |
| `STRIPE_WEBHOOK_SECRET` | Empty | stripe-webhook (not yet) |
| `RESEND_API_KEY` | Set (re_...) | invite-user, forgot-password |
| `APP_URL` | Set (bubble URL) | All edge functions (redirects) |
| `RESEND_FROM_EMAIL` | "AcademyOS <noreply@example.com>" | Email sender |
| `CLAUDE_API_KEY` | Empty | draft-remarks, chatbot (not yet) |
| `R2_*` | Empty | r2-presign (not yet) |
| `CRON_SECRET` | Empty | Cron job auth (not yet) |

---

## 19. MCP Configuration

```json
{
  "mcpServers": {
    "supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp?project_ref=<PROJECT_REF>&features=docs,account,database,debugging,development,functions,branching"
    }
  }
}
```

---

## 20. What's Missing (planned for Weeks 2-5)

### Database additions needed:
- Enable realtime on `profiles`, `students`, `guardians`, `batches` (for live UI updates)
- pg_cron jobs: voucher generation, reminder sweep, remark drafting

### Edge functions to build:
- `generate-vouchers` — monthly voucher generation
- `stripe-webhook` — payment confirmation
- `send-reminders` — escalating fee follow-ups
- `draft-remarks` — AI remark generation
- `chatbot` — Claude tool-use agentic loop
- `r2-presign` — file upload/download URLs
- `resolve-voucher-token` — public pay link resolution

### Bubble API calls to configure:
- Batch CRUD (GET/POST/PATCH)
- Subject CRUD
- Teacher assignment (POST/DELETE batch_teachers)
- Student CRUD (POST/PATCH)
- Enrollment CRUD (POST/PATCH)
- Attendance marking (POST/PATCH)
- Assessment + scores (POST/PATCH)
- Fee rules (GET/PATCH)
- Voucher listing
- Ledger views
- Remark approval (PATCH)

### Bubble realtime bridge:
- supabase-js HTML element for websocket subscriptions
- Event bridge: Supabase channel events → Bubble custom events → RG refresh
