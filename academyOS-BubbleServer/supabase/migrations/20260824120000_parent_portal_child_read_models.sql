-- =============================================================================
-- AcademyOS - Parent portal per-child read models (Tasks §11)
--
-- Children overview already exists (get_parent_children). These RPCs power
-- the child sheet: voucher history + receipts, attendance calendar, published
-- marks with batch average, approved remarks.
--
-- Security: parent JWT only. Student id is text for Bubble. A guessed UUID
-- that is not this guardian's child returns zero rows (no error, no data).
-- p_bust is ignored; Bubble binds it to refetch.
-- =============================================================================

create or replace function public.parent_own_student_id(p_student_id text)
returns uuid
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_gid uuid := public.auth_guardian_id();
  v_raw text := public.admin_clean_text(p_student_id);
  v_sid uuid;
begin
  if public.auth_role() is distinct from 'parent' or v_gid is null or v_raw is null then
    return null;
  end if;
  begin
    v_sid := v_raw::uuid;
  exception when invalid_text_representation then
    return null;
  end;
  if not exists (
    select 1
    from public.students s
    where s.id = v_sid
      and s.guardian_id = v_gid
  ) then
    return null;
  end if;
  return v_sid;
end;
$$;

revoke all on function public.parent_own_student_id(text) from public;
grant execute on function public.parent_own_student_id(text) to authenticated;
revoke execute on function public.parent_own_student_id(text) from anon;

-- ---------------------------------------------------------------------------
-- All vouchers for one child (paid included) + latest payment receipt
-- ---------------------------------------------------------------------------
create or replace function public.get_parent_child_vouchers(
  p_student_id text default null,
  p_bust text default null
)
returns table (
  voucher_id uuid,
  student_id uuid,
  student_name text,
  period_text text,
  due_date_text text,
  total numeric,
  paid numeric,
  outstanding numeric,
  status text,
  status_label text,
  receipt_number text
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_sid uuid := public.parent_own_student_id(p_student_id);
begin
  if v_sid is null then
    return;
  end if;

  return query
  select
    v.id,
    st.id,
    coalesce(st.name, ''),
    to_char(v.period, 'YYYY-MM'),
    to_char(v.due_date, 'YYYY-MM-DD'),
    v.total,
    vb.total_paid,
    vb.outstanding,
    v.status::text,
    case
      when vb.outstanding <= 0 then 'Paid'
      when v.due_date < (timezone('Asia/Karachi', now()))::date then
        'Overdue'
      when v.status = 'partial' then 'Partial'
      else 'Unpaid'
    end,
    coalesce((
      select le.receipt_number
      from public.ledger_entries le
      where le.voucher_id = v.id
        and le.kind = 'payment'
        and le.receipt_number is not null
      order by le.created_at desc
      limit 1
    ), '')
  from public.vouchers v
  join public.voucher_balances vb on vb.voucher_id = v.id
  join public.students st on st.id = v.student_id
  where v.student_id = v_sid
  order by v.period desc, v.generated_at desc;
end;
$$;

comment on function public.get_parent_child_vouchers(text, text) is
  'Parent-only voucher history for one owned child, including paid rows and latest receipt number.';

revoke all on function public.get_parent_child_vouchers(text, text) from public;
grant execute on function public.get_parent_child_vouchers(text, text) to authenticated;
revoke execute on function public.get_parent_child_vouchers(text, text) from anon;

-- ---------------------------------------------------------------------------
-- Attendance days for one child + month (default: Karachi current month)
-- ---------------------------------------------------------------------------
create or replace function public.get_parent_attendance(
  p_student_id text default null,
  p_month text default null,
  p_bust text default null
)
returns table (
  student_id uuid,
  date_text text,
  weekday text,
  status text,
  attendance_pct numeric,
  present_days integer,
  total_days integer
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_sid uuid := public.parent_own_student_id(p_student_id);
  v_raw text := public.admin_clean_text(p_month);
  v_month date;
  v_pct numeric := 0;
  v_present integer := 0;
  v_total integer := 0;
begin
  if v_sid is null then
    return;
  end if;

  begin
    if v_raw is null then
      v_month := date_trunc('month', (timezone('Asia/Karachi', now()))::date)::date;
    elsif length(v_raw) = 7 then
      v_month := (v_raw || '-01')::date;
    else
      v_month := date_trunc('month', v_raw::date)::date;
    end if;
  exception when others then
    v_month := date_trunc('month', (timezone('Asia/Karachi', now()))::date)::date;
  end;

  select s.attendance_pct, s.present_days, s.total_days
    into v_pct, v_present, v_total
  from public.attendance_summary(v_sid, v_month) s;

  return query
  select
    a.student_id,
    to_char(a.date, 'YYYY-MM-DD'),
    to_char(a.date, 'Dy'),
    a.status::text,
    coalesce(v_pct, 0),
    coalesce(v_present, 0),
    coalesce(v_total, 0)
  from public.attendance a
  where a.student_id = v_sid
    and a.date >= v_month
    and a.date < (v_month + interval '1 month')::date
  order by a.date;
end;
$$;

comment on function public.get_parent_attendance(text, text, text) is
  'Parent-only attendance days for one owned child in p_month (YYYY-MM). Empty month = Karachi current month.';

revoke all on function public.get_parent_attendance(text, text, text) from public;
grant execute on function public.get_parent_attendance(text, text, text) to authenticated;
revoke execute on function public.get_parent_attendance(text, text, text) from anon;

-- ---------------------------------------------------------------------------
-- Published marks + batch average
-- ---------------------------------------------------------------------------
create or replace function public.get_parent_results(
  p_student_id text default null,
  p_bust text default null
)
returns table (
  score_id uuid,
  student_id uuid,
  assessment_date_text text,
  subject_name text,
  obtained_text text,
  max_marks numeric,
  percent_text text,
  batch_avg_text text,
  absent boolean
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_sid uuid := public.parent_own_student_id(p_student_id);
begin
  if v_sid is null then
    return;
  end if;

  return query
  select
    sc.id,
    sc.student_id,
    to_char(a.date, 'YYYY-MM-DD'),
    coalesce(sub.name, 'Test'),
    case
      when sc.absent then 'Absent'
      else to_char(sc.obtained, 'FM9990.00')
    end,
    a.max_marks,
    case
      when sc.absent or a.max_marks <= 0 then ''
      else to_char(round((sc.obtained / a.max_marks) * 100, 1), 'FM990.0') || '%'
    end,
    coalesce((
      select to_char(round(avg(sc2.obtained), 1), 'FM990.0')
      from public.scores sc2
      where sc2.assessment_id = a.id
        and sc2.absent = false
        and sc2.obtained is not null
    ), ''),
    sc.absent
  from public.scores sc
  join public.assessments a on a.id = sc.assessment_id
  join public.subjects sub on sub.id = a.subject_id
  where sc.student_id = v_sid
    and a.published = true
  order by a.date desc, sub.name;
end;
$$;

comment on function public.get_parent_results(text, text) is
  'Parent-only published scores for one owned child, with batch average. Unpublished tests never appear.';

revoke all on function public.get_parent_results(text, text) from public;
grant execute on function public.get_parent_results(text, text) to authenticated;
revoke execute on function public.get_parent_results(text, text) from anon;

-- ---------------------------------------------------------------------------
-- Approved remarks only (RLS also blocks drafts)
-- ---------------------------------------------------------------------------
create or replace function public.get_parent_remarks(
  p_student_id text default null,
  p_bust text default null
)
returns table (
  remark_id uuid,
  student_id uuid,
  period_text text,
  remark_text text,
  language text
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_sid uuid := public.parent_own_student_id(p_student_id);
begin
  if v_sid is null then
    return;
  end if;

  return query
  select
    r.id,
    r.student_id,
    to_char(r.period, 'YYYY-MM'),
    coalesce(r.final_text, r.draft_text, ''),
    r.language::text
  from public.remarks r
  where r.student_id = v_sid
    and r.status = 'approved'
  order by r.period desc;
end;
$$;

comment on function public.get_parent_remarks(text, text) is
  'Parent-only approved remarks for one owned child. Drafts never returned.';

revoke all on function public.get_parent_remarks(text, text) from public;
grant execute on function public.get_parent_remarks(text, text) to authenticated;
revoke execute on function public.get_parent_remarks(text, text) from anon;

-- One approved remark so the parent portal remarks list is not empty in demo.
-- The §9 draft pipeline can replace this later.
insert into public.remarks (
  academy_id, student_id, period, draft_text, final_text, language, status, approved_at
)
values (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-eeeeeeeeee01',
  '2026-08-01',
  'Ahmed attended regularly this month.',
  'Ahmed attended regularly this month and is keeping up with the batch on published tests.',
  'en',
  'approved',
  now()
)
on conflict (student_id, period) do update
set
  status = 'approved',
  final_text = excluded.final_text,
  approved_at = now();
