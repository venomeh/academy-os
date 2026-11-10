-- =============================================================================
-- AcademyOS — Initial Schema (§14)
-- Migration 001: Tables, constraints, triggers, helper functions, views
-- Extensions: pgcrypto (enabled), pg_cron (enabled), pg_net (for cron HTTP calls)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions (pgcrypto, pg_cron, pg_net already enabled via Supabase dashboard)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ENUM types
-- ---------------------------------------------------------------------------
create type user_role as enum ('admin', 'teacher', 'parent');
create type student_status as enum ('active', 'left');
create type attendance_status as enum ('present', 'absent', 'late', 'leave');
create type voucher_status as enum ('unpaid', 'partial', 'paid');
create type ledger_kind as enum ('voucher', 'payment', 'fine', 'discount', 'adjustment');
create type payment_method as enum ('cash', 'stripe');
create type remark_status as enum ('draft', 'approved', 'rejected', 'low_data');
create type reminder_bucket as enum ('due_date', '7d_gentle', '14d_firm', '30d_final');
create type message_channel as enum ('email', 'whatsapp');
create type message_status as enum ('pending', 'sent', 'failed');
create type inquiry_status as enum ('open', 'resolved');
create type language_pref as enum ('en', 'ur');
create type late_fine_type as enum ('flat', 'percentage');

-- ---------------------------------------------------------------------------
-- 1. academies (single tenant v1, template-ready)
-- ---------------------------------------------------------------------------
create table academies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. profiles (mirrors auth.users)
-- ---------------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  academy_id uuid not null references academies(id),
  role user_role not null,
  full_name text not null,
  email text not null,
  phone text,
  language_pref language_pref not null default 'en',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_profiles_academy on profiles(academy_id);
create index idx_profiles_role on profiles(role);

-- ---------------------------------------------------------------------------
-- 3. guardians
-- ---------------------------------------------------------------------------
create table guardians (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references profiles(id) on delete cascade,
  academy_id uuid not null references academies(id),
  name text not null,
  phone text unique,
  email text,
  language_pref language_pref not null default 'en',
  verified boolean not null default false,
  reminders_paused boolean not null default false,
  reminders_paused_reason text,
  created_at timestamptz not null default now()
);

create index idx_guardians_academy on guardians(academy_id);

-- ---------------------------------------------------------------------------
-- 4. students
-- ---------------------------------------------------------------------------
create table students (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references academies(id),
  guardian_id uuid not null references guardians(id),
  name text not null,
  photo_key text,
  grade text,
  status student_status not null default 'active',
  joined_at date not null default current_date,
  fee_override numeric(10,2),
  override_reason text,
  needs_fee_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_students_guardian on students(guardian_id);
create index idx_students_academy on students(academy_id);
create index idx_students_status on students(status);

-- ---------------------------------------------------------------------------
-- 5. batches
-- ---------------------------------------------------------------------------
create table batches (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references academies(id),
  name text not null,
  grade_level text,
  days_of_week text[],
  start_time time,
  end_time time,
  monthly_tuition numeric(10,2) not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_batches_academy on batches(academy_id);

-- ---------------------------------------------------------------------------
-- 6. subjects
-- ---------------------------------------------------------------------------
create table subjects (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references academies(id),
  batch_id uuid not null references batches(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (batch_id, name)
);

-- ---------------------------------------------------------------------------
-- 7. batch_teachers (join table)
-- ---------------------------------------------------------------------------
create table batch_teachers (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references batches(id) on delete cascade,
  teacher_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (batch_id, teacher_id)
);

create index idx_batch_teachers_teacher on batch_teachers(teacher_id);

-- ---------------------------------------------------------------------------
-- 8. enrollments
-- ---------------------------------------------------------------------------
create table enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  batch_id uuid not null references batches(id) on delete cascade,
  start_date date not null default current_date,
  end_date date,
  created_at timestamptz not null default now(),
  unique (student_id, batch_id, start_date)
);

create index idx_enrollments_student on enrollments(student_id);
create index idx_enrollments_batch on enrollments(batch_id);

-- ---------------------------------------------------------------------------
-- 9. fee_rules (one per academy)
-- ---------------------------------------------------------------------------
create table fee_rules (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null unique references academies(id),
  sibling_discount_pct numeric(5,2) not null default 0,
  late_fine_type late_fine_type not null default 'flat',
  late_fine_value numeric(10,2) not null default 0,
  late_fine_grace_days integer not null default 0,
  generation_day integer not null default 1 check (generation_day between 1 and 28),
  due_day integer not null default 10 check (due_day between 1 and 28),
  admission_fee numeric(10,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 10. attendance
-- ---------------------------------------------------------------------------
create table attendance (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references academies(id),
  student_id uuid not null references students(id) on delete cascade,
  batch_id uuid not null references batches(id) on delete cascade,
  date date not null,
  status attendance_status not null default 'present',
  marked_by uuid not null references profiles(id),
  corrected_by uuid references profiles(id),
  corrected_at timestamptz,
  created_at timestamptz not null default now(),
  unique (student_id, batch_id, date)
);

create index idx_attendance_batch_date on attendance(batch_id, date);
create index idx_attendance_student on attendance(student_id);

-- ---------------------------------------------------------------------------
-- 11. assessments
-- ---------------------------------------------------------------------------
create table assessments (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references academies(id),
  batch_id uuid not null references batches(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete cascade,
  date date not null,
  max_marks numeric(6,2) not null check (max_marks > 0),
  published boolean not null default false,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_assessments_batch on assessments(batch_id);

-- ---------------------------------------------------------------------------
-- 12. scores
-- ---------------------------------------------------------------------------
create table scores (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  obtained numeric(6,2) check (obtained >= 0),
  absent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessment_id, student_id),
  constraint valid_score check (
    (absent = true and obtained is null) or
    (absent = false and obtained is not null)
  )
);

create index idx_scores_student on scores(student_id);

-- ---------------------------------------------------------------------------
-- 13. vouchers
-- ---------------------------------------------------------------------------
create table vouchers (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references academies(id),
  student_id uuid not null references students(id) on delete cascade,
  guardian_id uuid not null references guardians(id),
  period date not null,
  line_items jsonb not null default '[]',
  tuition_amount numeric(10,2) not null,
  sibling_discount numeric(10,2) not null default 0,
  arrears numeric(10,2) not null default 0,
  fines numeric(10,2) not null default 0,
  total numeric(10,2) not null,
  due_date date not null,
  status voucher_status not null default 'unpaid',
  token text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  rule_snapshot jsonb not null,
  generated_at timestamptz not null default now(),
  unique (student_id, period)
);

create index idx_vouchers_guardian on vouchers(guardian_id);
create index idx_vouchers_status on vouchers(status);
create index idx_vouchers_due_date on vouchers(due_date);
create index idx_vouchers_token on vouchers(token);

-- ---------------------------------------------------------------------------
-- 14. ledger_entries (APPEND-ONLY — no update/delete ever)
-- ---------------------------------------------------------------------------
create table ledger_entries (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references academies(id),
  guardian_id uuid not null references guardians(id),
  student_id uuid not null references students(id),
  voucher_id uuid references vouchers(id),
  kind ledger_kind not null,
  amount numeric(10,2) not null,
  method payment_method,
  stripe_event_id text unique,
  receipt_number text unique,
  reason text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index idx_ledger_guardian on ledger_entries(guardian_id);
create index idx_ledger_student on ledger_entries(student_id);
create index idx_ledger_voucher on ledger_entries(voucher_id);
create index idx_ledger_kind on ledger_entries(kind);

-- Belt-and-braces: revoke UPDATE and DELETE on ledger_entries for all roles
revoke update, delete on ledger_entries from authenticated;
revoke update, delete on ledger_entries from anon;
revoke update, delete on ledger_entries from service_role;

-- ---------------------------------------------------------------------------
-- 15. remarks
-- ---------------------------------------------------------------------------
create table remarks (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references academies(id),
  student_id uuid not null references students(id) on delete cascade,
  period date not null,
  draft_text text,
  final_text text,
  language language_pref not null default 'en',
  status remark_status not null default 'draft',
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, period)
);

create index idx_remarks_student on remarks(student_id);
create index idx_remarks_status on remarks(status);

-- ---------------------------------------------------------------------------
-- 16. reminder_templates
-- ---------------------------------------------------------------------------
create table reminder_templates (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references academies(id),
  bucket reminder_bucket not null,
  language language_pref not null default 'en',
  template_version integer not null default 1,
  subject_line text not null,
  body text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (academy_id, bucket, language, template_version)
);

-- ---------------------------------------------------------------------------
-- 17. message_log
-- ---------------------------------------------------------------------------
create table message_log (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references academies(id),
  guardian_id uuid not null references guardians(id),
  voucher_id uuid references vouchers(id),
  bucket reminder_bucket,
  channel message_channel not null,
  status message_status not null default 'pending',
  template_version integer,
  content text,
  error_detail text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (voucher_id, bucket, channel)
);

create index idx_message_log_guardian on message_log(guardian_id);
create index idx_message_log_voucher on message_log(voucher_id);

-- ---------------------------------------------------------------------------
-- 18. chat_sessions
-- ---------------------------------------------------------------------------
create table chat_sessions (
  id uuid primary key default gen_random_uuid(),
  guardian_id uuid not null references guardians(id) on delete cascade,
  started_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  token_usage integer not null default 0
);

create index idx_chat_sessions_guardian on chat_sessions(guardian_id);

-- ---------------------------------------------------------------------------
-- 19. chat_messages
-- ---------------------------------------------------------------------------
create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references chat_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content text not null,
  tool_name text,
  tool_payload jsonb,
  created_at timestamptz not null default now()
);

create index idx_chat_messages_session on chat_messages(session_id);

-- ---------------------------------------------------------------------------
-- 20. inquiries (chatbot escalations)
-- ---------------------------------------------------------------------------
create table inquiries (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references academies(id),
  guardian_id uuid not null references guardians(id),
  topic text not null,
  message text not null,
  status inquiry_status not null default 'open',
  resolved_by uuid references profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_inquiries_guardian on inquiries(guardian_id);
create index idx_inquiries_status on inquiries(status);

-- ---------------------------------------------------------------------------
-- 21. waitlist (landing page — anon insert only)
-- ---------------------------------------------------------------------------
create table waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  source text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 22. job_runs (cron job audit log)
-- ---------------------------------------------------------------------------
create table job_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  period date,
  result jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 23. chat_usage (rate limiting for chatbot)
-- ---------------------------------------------------------------------------
create table chat_usage (
  id uuid primary key default gen_random_uuid(),
  guardian_id uuid not null references guardians(id),
  date date not null default current_date,
  request_count integer not null default 0,
  unique (guardian_id, date)
);

-- ---------------------------------------------------------------------------
-- Receipt number sequence
-- ---------------------------------------------------------------------------
create sequence receipt_number_seq start 1001;

-- ===========================================================================
-- HELPER FUNCTIONS (used by RLS policies)
-- ===========================================================================

create or replace function auth_role()
returns text
language sql stable security definer set search_path = public
as $$
  select role::text from profiles where id = auth.uid()
$$;

create or replace function auth_guardian_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select id from guardians where profile_id = auth.uid()
$$;

-- Helper: get student IDs for the current guardian
create or replace function auth_student_ids()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select id from students where guardian_id = (
    select id from guardians where profile_id = auth.uid()
  )
$$;

-- Helper: get batch IDs for the current teacher
create or replace function auth_teacher_batch_ids()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select batch_id from batch_teachers where teacher_id = auth.uid()
$$;

-- ===========================================================================
-- TRIGGER: handle_new_user — creates profile on auth.users insert
-- ===========================================================================

create or replace function handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Fail loudly if required metadata is missing (all users are admin-provisioned via invite)
  if new.raw_user_meta_data ->> 'academy_id' is null then
    raise exception 'handle_new_user: academy_id missing from user metadata for %', new.email;
  end if;
  if new.raw_user_meta_data ->> 'role' is null then
    raise exception 'handle_new_user: role missing from user metadata for %', new.email;
  end if;

  insert into profiles (id, academy_id, role, full_name, email, phone)
  values (
    new.id,
    (new.raw_user_meta_data ->> 'academy_id')::uuid,
    (new.raw_user_meta_data ->> 'role')::user_role,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data ->> 'phone'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function handle_new_user();

-- ===========================================================================
-- TRIGGER: updated_at auto-refresh
-- ===========================================================================

create or replace function update_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_updated_at before update on profiles
  for each row execute function update_updated_at();
create trigger trg_students_updated_at before update on students
  for each row execute function update_updated_at();
create trigger trg_batches_updated_at before update on batches
  for each row execute function update_updated_at();
create trigger trg_assessments_updated_at before update on assessments
  for each row execute function update_updated_at();
create trigger trg_scores_updated_at before update on scores
  for each row execute function update_updated_at();
create trigger trg_remarks_updated_at before update on remarks
  for each row execute function update_updated_at();
create trigger trg_fee_rules_updated_at before update on fee_rules
  for each row execute function update_updated_at();

-- ===========================================================================
-- TRIGGER: enforce obtained <= max_marks at DB level
-- ===========================================================================

create or replace function check_score_max()
returns trigger
language plpgsql
as $$
declare
  v_max numeric;
begin
  if new.obtained is not null then
    select max_marks into v_max from assessments where id = new.assessment_id;
    if new.obtained > v_max then
      raise exception 'obtained (%) exceeds max_marks (%) for assessment %',
        new.obtained, v_max, new.assessment_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_scores_check_max
  before insert or update on scores
  for each row execute function check_score_max();

-- ===========================================================================
-- TRIGGER: attendance correction audit
-- ===========================================================================

create or replace function audit_attendance_correction()
returns trigger
language plpgsql
as $$
begin
  if old.status is distinct from new.status and old.marked_by is distinct from new.marked_by then
    new.corrected_by = new.marked_by;
    new.corrected_at = now();
  end if;
  return new;
end;
$$;

create trigger trg_attendance_correction
  before update on attendance
  for each row execute function audit_attendance_correction();

-- ===========================================================================
-- VIEWS — computed balances (never stored)
-- ===========================================================================

-- Balance per voucher (how much is still owed)
create or replace view voucher_balances as
select
  v.id as voucher_id,
  v.student_id,
  v.guardian_id,
  v.period,
  v.total as voucher_total,
  v.due_date,
  v.status,
  coalesce(sum(case when le.kind = 'payment' then le.amount else 0 end), 0) as total_paid,
  v.total - coalesce(sum(case when le.kind = 'payment' then le.amount else 0 end), 0) as outstanding
from vouchers v
left join ledger_entries le on le.voucher_id = v.id and le.kind = 'payment'
group by v.id;

-- Balance per guardian (total outstanding across all children)
create or replace view guardian_balances as
select
  g.id as guardian_id,
  g.name as guardian_name,
  sum(vb.outstanding) as total_outstanding,
  count(case when vb.outstanding > 0 then 1 end) as unpaid_vouchers
from guardians g
left join voucher_balances vb on vb.guardian_id = g.id
group by g.id, g.name;

-- Defaulters view with aging buckets (powers both admin screen and reminder engine)
create or replace view defaulters as
select
  v.id as voucher_id,
  v.student_id,
  v.guardian_id,
  v.period,
  v.total,
  v.due_date,
  v.status,
  vb.outstanding,
  (current_date - v.due_date) as days_overdue,
  case
    when (current_date - v.due_date) >= 30 then '30d_final'
    when (current_date - v.due_date) >= 14 then '14d_firm'
    when (current_date - v.due_date) >= 7 then '7d_gentle'
    else 'due_date'
  end::reminder_bucket as bucket,
  g.reminders_paused
from vouchers v
join voucher_balances vb on vb.voucher_id = v.id
join guardians g on g.id = v.guardian_id
where v.status in ('unpaid', 'partial')
  and current_date >= v.due_date;

-- Batches marked today (for admin realtime tile)
create or replace view batches_marked_today as
select
  b.id as batch_id,
  b.name as batch_name,
  case when exists (
    select 1 from attendance a where a.batch_id = b.id and a.date = current_date
  ) then true else false end as marked_today
from batches b
where b.active = true;

-- Monthly collections summary
create or replace view monthly_collections as
select
  date_trunc('month', le.created_at)::date as month,
  le.method,
  count(*) as payment_count,
  sum(le.amount) as total_collected
from ledger_entries le
where le.kind = 'payment'
group by date_trunc('month', le.created_at)::date, le.method;

-- ---------------------------------------------------------------------------
-- SECURITY: Views must use security_invoker so RLS on base tables applies
-- Without this, views execute as the owner (postgres) bypassing RLS entirely
-- ---------------------------------------------------------------------------
alter view voucher_balances set (security_invoker = on);
alter view guardian_balances set (security_invoker = on);
alter view defaulters set (security_invoker = on);
alter view batches_marked_today set (security_invoker = on);
alter view monthly_collections set (security_invoker = on);

-- ===========================================================================
-- FUNCTION: attendance_summary (reused in remarks, parent portal, reports)
-- ===========================================================================

create or replace function attendance_summary(
  p_student_id uuid,
  p_month date
)
returns table(
  total_days integer,
  present_days integer,
  absent_days integer,
  late_days integer,
  leave_days integer,
  attendance_pct numeric
)
language sql stable
as $$
  select
    count(*)::integer as total_days,
    count(*) filter (where status = 'present')::integer as present_days,
    count(*) filter (where status = 'absent')::integer as absent_days,
    count(*) filter (where status = 'late')::integer as late_days,
    count(*) filter (where status = 'leave')::integer as leave_days,
    case when count(*) > 0
      then round((count(*) filter (where status in ('present', 'late'))::numeric / count(*)::numeric) * 100, 1)
      else 0
    end as attendance_pct
  from attendance
  where student_id = p_student_id
    and date >= p_month
    and date < (p_month + interval '1 month')::date
$$;

-- ===========================================================================
-- Enable realtime for key tables
-- ===========================================================================

alter publication supabase_realtime add table attendance;
alter publication supabase_realtime add table ledger_entries;
alter publication supabase_realtime add table vouchers;
