-- =============================================================================
-- AcademyOS — RLS Policies (§14 Policy Summary)
-- Migration 003: Enable RLS, helper functions, per-role policies, cash RPC
-- Principle: default deny. Every policy below is an explicit grant of the minimum.
-- =============================================================================

-- ===========================================================================
-- 1. NEW HELPER FUNCTIONS
-- ===========================================================================

-- All student IDs a teacher can see (via their batch assignments → enrollments)
create or replace function public.auth_teacher_student_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select distinct e.student_id
  from enrollments e
  where e.batch_id in (select auth_teacher_batch_ids());
$$;

-- All batch IDs a parent's children are enrolled in (for schedule/subjects)
create or replace function public.auth_child_batch_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select distinct e.batch_id
  from enrollments e
  where e.student_id in (select auth_student_ids());
$$;

-- ===========================================================================
-- 2. ENABLE RLS ON ALL 23 TABLES (default deny — no policy = zero access)
-- ===========================================================================

alter table public.academies          enable row level security;
alter table public.profiles           enable row level security;
alter table public.guardians          enable row level security;
alter table public.students           enable row level security;
alter table public.batches            enable row level security;
alter table public.subjects           enable row level security;
alter table public.batch_teachers     enable row level security;
alter table public.enrollments        enable row level security;
alter table public.fee_rules          enable row level security;
alter table public.attendance         enable row level security;
alter table public.assessments        enable row level security;
alter table public.scores             enable row level security;
alter table public.vouchers           enable row level security;
alter table public.ledger_entries     enable row level security;
alter table public.remarks            enable row level security;
alter table public.reminder_templates enable row level security;
alter table public.message_log        enable row level security;
alter table public.chat_sessions      enable row level security;
alter table public.chat_messages      enable row level security;
alter table public.chat_usage         enable row level security;
alter table public.inquiries          enable row level security;
alter table public.waitlist           enable row level security;
alter table public.job_runs           enable row level security;

-- ===========================================================================
-- 3. LOCK ANON DOWN — only waitlist insert
-- ===========================================================================

revoke all on all tables in schema public from anon;
grant insert on public.waitlist to anon;
grant usage on schema public to anon;

-- Immutability for templates (mirrors the ledger approach)
revoke update, delete on public.reminder_templates from authenticated, anon;

-- ===========================================================================
-- 4. POLICIES — ACADEMIES & PROFILES
-- ===========================================================================

-- academies: everyone logged in can read (single tenant v1)
create policy "academies_authenticated_select" on public.academies
  for select to authenticated using (true);

create policy "academies_admin_all" on public.academies
  for all to authenticated
  using ((select auth_role()) = 'admin')
  with check ((select auth_role()) = 'admin');

-- profiles: own row readable; admin manages everything
create policy "profiles_own_select" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy "profiles_admin_all" on public.profiles
  for all to authenticated
  using ((select auth_role()) = 'admin')
  with check ((select auth_role()) = 'admin');

-- ===========================================================================
-- 5. POLICIES — GUARDIANS, STUDENTS, BATCHES, SUBJECTS, BATCH_TEACHERS, ENROLLMENTS
-- ===========================================================================

-- guardians
create policy "guardians_own_select" on public.guardians
  for select to authenticated
  using (profile_id = (select auth.uid()));

create policy "guardians_admin_all" on public.guardians
  for all to authenticated
  using ((select auth_role()) = 'admin')
  with check ((select auth_role()) = 'admin');

-- students
create policy "students_parent_select" on public.students
  for select to authenticated
  using (guardian_id = (select auth_guardian_id()));

create policy "students_teacher_select" on public.students
  for select to authenticated
  using (id in (select auth_teacher_student_ids()));

create policy "students_admin_all" on public.students
  for all to authenticated
  using ((select auth_role()) = 'admin')
  with check ((select auth_role()) = 'admin');

-- batches
create policy "batches_teacher_select" on public.batches
  for select to authenticated
  using (id in (select auth_teacher_batch_ids()));

create policy "batches_parent_select" on public.batches
  for select to authenticated
  using (id in (select auth_child_batch_ids()));

create policy "batches_admin_all" on public.batches
  for all to authenticated
  using ((select auth_role()) = 'admin')
  with check ((select auth_role()) = 'admin');

-- subjects
create policy "subjects_teacher_select" on public.subjects
  for select to authenticated
  using (batch_id in (select auth_teacher_batch_ids()));

create policy "subjects_parent_select" on public.subjects
  for select to authenticated
  using (batch_id in (select auth_child_batch_ids()));

create policy "subjects_admin_all" on public.subjects
  for all to authenticated
  using ((select auth_role()) = 'admin')
  with check ((select auth_role()) = 'admin');

-- batch_teachers: teacher sees own rows only
create policy "batch_teachers_own_select" on public.batch_teachers
  for select to authenticated
  using (teacher_id = (select auth.uid()));

create policy "batch_teachers_admin_all" on public.batch_teachers
  for all to authenticated
  using ((select auth_role()) = 'admin')
  with check ((select auth_role()) = 'admin');

-- enrollments
create policy "enrollments_parent_select" on public.enrollments
  for select to authenticated
  using (student_id in (select auth_student_ids()));

create policy "enrollments_teacher_select" on public.enrollments
  for select to authenticated
  using (batch_id in (select auth_teacher_batch_ids()));

create policy "enrollments_admin_all" on public.enrollments
  for all to authenticated
  using ((select auth_role()) = 'admin')
  with check ((select auth_role()) = 'admin');

-- ===========================================================================
-- 6. POLICIES — FEE RULES (admin only)
-- ===========================================================================

create policy "fee_rules_admin_all" on public.fee_rules
  for all to authenticated
  using ((select auth_role()) = 'admin')
  with check ((select auth_role()) = 'admin');

-- ===========================================================================
-- 7. POLICIES — ATTENDANCE (same-day rule in PKT)
-- ===========================================================================

create policy "attendance_parent_select" on public.attendance
  for select to authenticated
  using (student_id in (select auth_student_ids()));

create policy "attendance_teacher_select" on public.attendance
  for select to authenticated
  using (batch_id in (select auth_teacher_batch_ids()));

-- INSERT: own batch, today (PKT), marked_by = self
create policy "attendance_teacher_insert" on public.attendance
  for insert to authenticated
  with check (
    (select auth_role()) = 'teacher'
    and batch_id in (select auth_teacher_batch_ids())
    and date = (now() at time zone 'Asia/Karachi')::date
    and marked_by = (select auth.uid())
  );

-- UPDATE: same-day only, own batch
create policy "attendance_teacher_update" on public.attendance
  for update to authenticated
  using (
    (select auth_role()) = 'teacher'
    and batch_id in (select auth_teacher_batch_ids())
    and date = (now() at time zone 'Asia/Karachi')::date
  )
  with check (
    batch_id in (select auth_teacher_batch_ids())
    and date = (now() at time zone 'Asia/Karachi')::date
  );

create policy "attendance_admin_all" on public.attendance
  for all to authenticated
  using ((select auth_role()) = 'admin')
  with check ((select auth_role()) = 'admin');

-- ===========================================================================
-- 8. POLICIES — ASSESSMENTS & SCORES (publish gate in policy)
-- ===========================================================================

-- assessments
create policy "assessments_teacher_all" on public.assessments
  for all to authenticated
  using (
    (select auth_role()) = 'teacher'
    and batch_id in (select auth_teacher_batch_ids())
  )
  with check (
    batch_id in (select auth_teacher_batch_ids())
    and created_by = (select auth.uid())
  );

create policy "assessments_parent_select" on public.assessments
  for select to authenticated
  using (
    published = true
    and batch_id in (select auth_child_batch_ids())
  );

create policy "assessments_admin_all" on public.assessments
  for all to authenticated
  using ((select auth_role()) = 'admin')
  with check ((select auth_role()) = 'admin');

-- scores: parents see own children + published only (re-checks published directly)
create policy "scores_parent_select" on public.scores
  for select to authenticated
  using (
    student_id in (select auth_student_ids())
    and exists (
      select 1 from public.assessments a
      where a.id = scores.assessment_id
        and a.published = true
    )
  );

create policy "scores_teacher_all" on public.scores
  for all to authenticated
  using (
    (select auth_role()) = 'teacher'
    and assessment_id in (
      select a.id from public.assessments a
      where a.batch_id in (select auth_teacher_batch_ids())
    )
  )
  with check (
    assessment_id in (
      select a.id from public.assessments a
      where a.batch_id in (select auth_teacher_batch_ids())
    )
    and student_id in (select auth_teacher_student_ids())
  );

create policy "scores_admin_all" on public.scores
  for all to authenticated
  using ((select auth_role()) = 'admin')
  with check ((select auth_role()) = 'admin');

-- ===========================================================================
-- 9. POLICIES — VOUCHERS & LEDGER (money tables)
-- ===========================================================================

-- vouchers: read-only for client. Writes via service_role only (edge functions).
create policy "vouchers_parent_select" on public.vouchers
  for select to authenticated
  using (guardian_id = (select auth_guardian_id()));

create policy "vouchers_admin_select" on public.vouchers
  for select to authenticated
  using ((select auth_role()) = 'admin');

-- ledger_entries: SELECT for parent (own) and admin (all).
-- Only client-side write: admin adjustments/discounts with mandatory reason.
create policy "ledger_parent_select" on public.ledger_entries
  for select to authenticated
  using (guardian_id = (select auth_guardian_id()));

create policy "ledger_admin_select" on public.ledger_entries
  for select to authenticated
  using ((select auth_role()) = 'admin');

create policy "ledger_admin_insert_adjustments" on public.ledger_entries
  for insert to authenticated
  with check (
    (select auth_role()) = 'admin'
    and kind in ('adjustment', 'discount')
    and reason is not null
    and created_by = (select auth.uid())
  );

-- ===========================================================================
-- 10. POLICIES — REMARKS (approval gate enforced here, not UI)
-- ===========================================================================

-- parents: approved only, own children only (§15 Rule 5)
create policy "remarks_parent_select" on public.remarks
  for select to authenticated
  using (
    student_id in (select auth_student_ids())
    and status = 'approved'
  );

-- teachers: read all statuses for their students
create policy "remarks_teacher_select" on public.remarks
  for select to authenticated
  using (student_id in (select auth_teacher_student_ids()));

-- teachers: update (approve/edit/reject) for their students
create policy "remarks_teacher_update" on public.remarks
  for update to authenticated
  using (
    (select auth_role()) = 'teacher'
    and student_id in (select auth_teacher_student_ids())
  )
  with check (
    student_id in (select auth_teacher_student_ids())
    and status in ('draft', 'approved', 'rejected')
    and (status <> 'approved' or approved_by = (select auth.uid()))
  );

create policy "remarks_admin_all" on public.remarks
  for all to authenticated
  using ((select auth_role()) = 'admin')
  with check ((select auth_role()) = 'admin');

-- ===========================================================================
-- 11. POLICIES — REMINDER TEMPLATES & MESSAGE LOG
-- ===========================================================================

create policy "templates_admin_select" on public.reminder_templates
  for select to authenticated
  using ((select auth_role()) = 'admin');

create policy "templates_admin_insert" on public.reminder_templates
  for insert to authenticated
  with check ((select auth_role()) = 'admin');

create policy "message_log_admin_select" on public.message_log
  for select to authenticated
  using ((select auth_role()) = 'admin');

-- ===========================================================================
-- 12. POLICIES — CHATBOT TABLES & INQUIRIES
-- ===========================================================================

create policy "chat_sessions_parent_select" on public.chat_sessions
  for select to authenticated
  using (guardian_id = (select auth_guardian_id()));

create policy "chat_sessions_admin_select" on public.chat_sessions
  for select to authenticated
  using ((select auth_role()) = 'admin');

create policy "chat_messages_parent_select" on public.chat_messages
  for select to authenticated
  using (
    session_id in (
      select cs.id from public.chat_sessions cs
      where cs.guardian_id = (select auth_guardian_id())
    )
  );

create policy "chat_messages_admin_select" on public.chat_messages
  for select to authenticated
  using ((select auth_role()) = 'admin');

create policy "chat_usage_parent_select" on public.chat_usage
  for select to authenticated
  using (guardian_id = (select auth_guardian_id()));

create policy "chat_usage_admin_select" on public.chat_usage
  for select to authenticated
  using ((select auth_role()) = 'admin');

-- inquiries
create policy "inquiries_parent_select" on public.inquiries
  for select to authenticated
  using (guardian_id = (select auth_guardian_id()));

create policy "inquiries_admin_select" on public.inquiries
  for select to authenticated
  using ((select auth_role()) = 'admin');

create policy "inquiries_admin_update" on public.inquiries
  for update to authenticated
  using ((select auth_role()) = 'admin')
  with check ((select auth_role()) = 'admin');

-- ===========================================================================
-- 13. POLICIES — WAITLIST & JOB_RUNS
-- ===========================================================================

-- anon may insert; may not read anything back
create policy "waitlist_anon_insert" on public.waitlist
  for insert to anon
  with check (true);

create policy "waitlist_admin_select" on public.waitlist
  for select to authenticated
  using ((select auth_role()) = 'admin');

create policy "job_runs_admin_select" on public.job_runs
  for select to authenticated
  using ((select auth_role()) = 'admin');

-- ===========================================================================
-- 14. RECORD CASH PAYMENT — SECURITY DEFINER RPC
-- Atomic: ledger row + receipt number + voucher status update
-- Two code paths write voucher status: this RPC and the Stripe webhook.
-- ===========================================================================

create or replace function public.record_cash_payment(
  p_voucher_id uuid,
  p_amount numeric
)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_voucher public.vouchers;
  v_outstanding numeric;
  v_receipt text;
  v_academy_id uuid;
begin
  -- Only admin can record cash payments
  if (select auth_role()) <> 'admin' then
    raise exception 'only admin can record cash payments';
  end if;

  -- Lock the voucher row to prevent concurrent double-recording
  select * into v_voucher from vouchers where id = p_voucher_id for update;
  if not found then raise exception 'voucher not found'; end if;

  -- Compute current outstanding from ledger (source of truth)
  select v_voucher.total - coalesce(sum(amount), 0) into v_outstanding
  from ledger_entries
  where voucher_id = p_voucher_id and kind = 'payment';

  -- Validations
  if p_amount <= 0 then raise exception 'amount must be positive'; end if;
  if p_amount > v_outstanding then
    raise exception 'overpayment blocked: outstanding is %', v_outstanding;
  end if;

  -- Generate receipt number
  v_receipt := 'R-' || nextval('receipt_number_seq');

  -- Get academy_id from voucher
  v_academy_id := v_voucher.academy_id;

  -- Insert ledger entry
  insert into ledger_entries
    (academy_id, guardian_id, student_id, voucher_id, kind, amount, method, receipt_number, created_by)
  values
    (v_academy_id, v_voucher.guardian_id, v_voucher.student_id, p_voucher_id,
     'payment', p_amount, 'cash', v_receipt, (select auth.uid()));

  -- Update voucher status cache
  update vouchers set status =
    case when p_amount >= v_outstanding then 'paid' else 'partial' end
  where id = p_voucher_id;

  return jsonb_build_object(
    'receipt_number', v_receipt,
    'paid', p_amount,
    'remaining', v_outstanding - p_amount,
    'status', case when p_amount >= v_outstanding then 'paid' else 'partial' end
  );
end;
$$;

-- Anon must never call this
revoke execute on function public.record_cash_payment from anon;

-- ===========================================================================
-- 15. POLICY-SUPPORTING INDEXES (idempotent — some already exist)
-- ===========================================================================

create index if not exists idx_students_guardian     on public.students (guardian_id);
create index if not exists idx_vouchers_guardian     on public.vouchers (guardian_id);
create index if not exists idx_ledger_guardian       on public.ledger_entries (guardian_id);
create index if not exists idx_ledger_voucher        on public.ledger_entries (voucher_id);
create index if not exists idx_enrollments_student   on public.enrollments (student_id);
create index if not exists idx_enrollments_batch     on public.enrollments (batch_id);
create index if not exists idx_attendance_student    on public.attendance (student_id);
create index if not exists idx_scores_student        on public.scores (student_id);
create index if not exists idx_remarks_student       on public.remarks (student_id);
create index if not exists idx_chat_messages_session on public.chat_messages (session_id);
