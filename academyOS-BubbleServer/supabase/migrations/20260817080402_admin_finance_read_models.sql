-- =============================================================================
-- AcademyOS - Admin Finance Read Models (Tasks 8.2, 8.3, 15)
-- Phase 1: Bubble-friendly, read-only finance RPCs.
--
-- These functions do not write money state. They expose the current voucher /
-- ledger picture to the admin dashboard while preserving the existing model:
-- vouchers are generated server-side, payments go through payment-specific RPCs
-- or webhooks, and ledger rows remain append-only.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Fee rules for the admin finance setup panel
-- ---------------------------------------------------------------------------

create or replace function public.get_admin_fee_rules()
returns table (
  fee_rule_id uuid,
  academy_id uuid,
  sibling_discount_pct numeric,
  late_fine_type text,
  late_fine_value numeric,
  late_fine_grace_days integer,
  generation_day integer,
  due_day integer,
  admission_fee numeric,
  updated_at_text text
)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if public.auth_role() is distinct from 'admin' then
    raise exception 'Admin only';
  end if;

  return query
  select
    fr.id as fee_rule_id,
    fr.academy_id,
    fr.sibling_discount_pct,
    fr.late_fine_type::text,
    fr.late_fine_value,
    fr.late_fine_grace_days,
    fr.generation_day,
    fr.due_day,
    fr.admission_fee,
    to_char(fr.updated_at, 'YYYY-MM-DD HH24:MI') as updated_at_text
  from public.fee_rules fr
  order by fr.updated_at desc
  limit 1;
end;
$$;

revoke all on function public.get_admin_fee_rules() from public;
grant execute on function public.get_admin_fee_rules() to authenticated;
revoke execute on function public.get_admin_fee_rules() from anon;

-- ---------------------------------------------------------------------------
-- 2) Admin finance dashboard summary for a selected month
-- ---------------------------------------------------------------------------

create or replace function public.get_admin_fee_summary(
  p_period date default null
)
returns table (
  period_start date,
  period_text text,
  total_vouchers integer,
  unpaid_vouchers integer,
  partial_vouchers integer,
  paid_vouchers integer,
  overdue_vouchers integer,
  total_billed numeric,
  total_paid numeric,
  total_outstanding numeric,
  overdue_outstanding numeric,
  collected_this_month numeric,
  cash_collected_this_month numeric,
  stripe_collected_this_month numeric
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_period_start date := date_trunc('month', coalesce(p_period, current_date))::date;
  v_period_end date := (date_trunc('month', coalesce(p_period, current_date)) + interval '1 month')::date;
begin
  if public.auth_role() is distinct from 'admin' then
    raise exception 'Admin only';
  end if;

  return query
  with voucher_scope as (
    select
      vb.voucher_id,
      vb.voucher_total,
      vb.total_paid,
      vb.outstanding,
      vb.due_date,
      vb.status
    from public.voucher_balances vb
    where vb.period >= v_period_start
      and vb.period < v_period_end
  ),
  payment_scope as (
    select
      le.amount,
      le.method
    from public.ledger_entries le
    where le.kind = 'payment'
      and le.created_at >= v_period_start
      and le.created_at < v_period_end
  )
  select
    v_period_start as period_start,
    to_char(v_period_start, 'YYYY-MM') as period_text,
    count(vs.voucher_id)::integer as total_vouchers,
    count(*) filter (where vs.status = 'unpaid')::integer as unpaid_vouchers,
    count(*) filter (where vs.status = 'partial')::integer as partial_vouchers,
    count(*) filter (where vs.status = 'paid')::integer as paid_vouchers,
    count(*) filter (
      where vs.outstanding > 0 and vs.due_date < current_date
    )::integer as overdue_vouchers,
    coalesce(sum(vs.voucher_total), 0)::numeric as total_billed,
    coalesce(sum(vs.total_paid), 0)::numeric as total_paid,
    coalesce(sum(vs.outstanding), 0)::numeric as total_outstanding,
    coalesce(sum(vs.outstanding) filter (
      where vs.outstanding > 0 and vs.due_date < current_date
    ), 0)::numeric as overdue_outstanding,
    coalesce((select sum(ps.amount) from payment_scope ps), 0)::numeric as collected_this_month,
    coalesce((select sum(ps.amount) from payment_scope ps where ps.method = 'cash'), 0)::numeric
      as cash_collected_this_month,
    coalesce((select sum(ps.amount) from payment_scope ps where ps.method = 'stripe'), 0)::numeric
      as stripe_collected_this_month
  from voucher_scope vs;
end;
$$;

revoke all on function public.get_admin_fee_summary(date) from public;
grant execute on function public.get_admin_fee_summary(date) to authenticated;
revoke execute on function public.get_admin_fee_summary(date) from anon;

-- ---------------------------------------------------------------------------
-- 3) Voucher list for the admin Fees section
-- ---------------------------------------------------------------------------

create or replace function public.get_admin_vouchers(
  p_status text default null,
  p_period date default null,
  p_overdue_only boolean default false,
  p_search text default null
)
returns table (
  voucher_id uuid,
  student_id uuid,
  student_name text,
  guardian_id uuid,
  guardian_name text,
  guardian_phone text,
  guardian_email text,
  batch_id uuid,
  batch_name text,
  period date,
  period_text text,
  tuition_amount numeric,
  sibling_discount numeric,
  arrears numeric,
  fines numeric,
  total numeric,
  paid numeric,
  outstanding numeric,
  due_date date,
  due_date_text text,
  status text,
  status_label text,
  days_overdue integer,
  aging_bucket text,
  reminders_paused boolean
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_period_start date := case
    when p_period is null then null
    else date_trunc('month', p_period)::date
  end;
  v_period_end date := case
    when p_period is null then null
    else (date_trunc('month', p_period) + interval '1 month')::date
  end;
  v_status text := nullif(lower(coalesce(p_status, 'all')), 'all');
  v_search text := nullif(trim(coalesce(p_search, '')), '');
begin
  if public.auth_role() is distinct from 'admin' then
    raise exception 'Admin only';
  end if;

  return query
  select
    v.id as voucher_id,
    st.id as student_id,
    st.name as student_name,
    g.id as guardian_id,
    g.name as guardian_name,
    g.phone as guardian_phone,
    g.email as guardian_email,
    b.id as batch_id,
    b.name as batch_name,
    v.period,
    to_char(v.period, 'YYYY-MM') as period_text,
    v.tuition_amount,
    v.sibling_discount,
    v.arrears,
    v.fines,
    v.total,
    vb.total_paid as paid,
    vb.outstanding,
    v.due_date,
    to_char(v.due_date, 'YYYY-MM-DD') as due_date_text,
    v.status::text as status,
    case
      when vb.outstanding <= 0 then 'Paid'
      when v.due_date < current_date then
        'Overdue - ' || (current_date - v.due_date)::text || 'd'
      when v.status = 'partial' then 'Partial'
      else 'Unpaid'
    end as status_label,
    greatest(current_date - v.due_date, 0)::integer as days_overdue,
    case
      when vb.outstanding <= 0 then null
      when current_date < v.due_date then null
      when (current_date - v.due_date) >= 30 then '30d_final'
      when (current_date - v.due_date) >= 14 then '14d_firm'
      when (current_date - v.due_date) >= 7 then '7d_gentle'
      else 'due_date'
    end as aging_bucket,
    g.reminders_paused
  from public.vouchers v
  join public.voucher_balances vb on vb.voucher_id = v.id
  join public.students st on st.id = v.student_id
  join public.guardians g on g.id = v.guardian_id
  left join lateral (
    select e.batch_id
    from public.enrollments e
    where e.student_id = v.student_id
      and e.start_date <= (v.period + interval '1 month - 1 day')::date
      and (e.end_date is null or e.end_date >= v.period)
    order by e.start_date desc
    limit 1
  ) active_enrollment on true
  left join public.batches b on b.id = active_enrollment.batch_id
  where (v_status is null or v.status::text = v_status)
    and (v_period_start is null or (v.period >= v_period_start and v.period < v_period_end))
    and (not p_overdue_only or (vb.outstanding > 0 and v.due_date < current_date))
    and (
      v_search is null
      or st.name ilike '%' || v_search || '%'
      or g.name ilike '%' || v_search || '%'
      or coalesce(g.phone, '') ilike '%' || v_search || '%'
      or coalesce(g.email, '') ilike '%' || v_search || '%'
    )
  order by
    case when vb.outstanding > 0 then 0 else 1 end,
    v.due_date asc,
    g.name,
    st.name;
end;
$$;

revoke all on function public.get_admin_vouchers(text, date, boolean, text) from public;
grant execute on function public.get_admin_vouchers(text, date, boolean, text) to authenticated;
revoke execute on function public.get_admin_vouchers(text, date, boolean, text) from anon;

-- ---------------------------------------------------------------------------
-- 4) Single-voucher detail, including JSON line-item fields for a details popup
-- ---------------------------------------------------------------------------

create or replace function public.get_admin_voucher_detail(
  p_voucher_id uuid
)
returns table (
  voucher_id uuid,
  student_id uuid,
  student_name text,
  guardian_id uuid,
  guardian_name text,
  guardian_phone text,
  guardian_email text,
  period date,
  period_text text,
  tuition_amount numeric,
  sibling_discount numeric,
  arrears numeric,
  fines numeric,
  total numeric,
  paid numeric,
  outstanding numeric,
  due_date date,
  due_date_text text,
  status text,
  status_label text,
  line_items jsonb,
  rule_snapshot jsonb,
  token text,
  generated_at_text text
)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if public.auth_role() is distinct from 'admin' then
    raise exception 'Admin only';
  end if;

  return query
  select
    v.id as voucher_id,
    st.id as student_id,
    st.name as student_name,
    g.id as guardian_id,
    g.name as guardian_name,
    g.phone as guardian_phone,
    g.email as guardian_email,
    v.period,
    to_char(v.period, 'YYYY-MM') as period_text,
    v.tuition_amount,
    v.sibling_discount,
    v.arrears,
    v.fines,
    v.total,
    vb.total_paid as paid,
    vb.outstanding,
    v.due_date,
    to_char(v.due_date, 'YYYY-MM-DD') as due_date_text,
    v.status::text as status,
    case
      when vb.outstanding <= 0 then 'Paid'
      when v.due_date < current_date then
        'Overdue - ' || (current_date - v.due_date)::text || 'd'
      when v.status = 'partial' then 'Partial'
      else 'Unpaid'
    end as status_label,
    v.line_items,
    v.rule_snapshot,
    v.token,
    to_char(v.generated_at, 'YYYY-MM-DD HH24:MI') as generated_at_text
  from public.vouchers v
  join public.voucher_balances vb on vb.voucher_id = v.id
  join public.students st on st.id = v.student_id
  join public.guardians g on g.id = v.guardian_id
  where v.id = p_voucher_id;
end;
$$;

revoke all on function public.get_admin_voucher_detail(uuid) from public;
grant execute on function public.get_admin_voucher_detail(uuid) to authenticated;
revoke execute on function public.get_admin_voucher_detail(uuid) from anon;

-- ---------------------------------------------------------------------------
-- 5) Guardian statement for a family popup / parent portal reuse later
-- ---------------------------------------------------------------------------

create or replace function public.get_admin_guardian_statement(
  p_guardian_id uuid
)
returns table (
  entry_id text,
  entry_date timestamptz,
  entry_date_text text,
  guardian_id uuid,
  guardian_name text,
  student_id uuid,
  student_name text,
  voucher_id uuid,
  period_text text,
  kind text,
  description text,
  method text,
  receipt_number text,
  amount numeric,
  signed_amount numeric,
  running_balance numeric
)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if public.auth_role() is distinct from 'admin' then
    raise exception 'Admin only';
  end if;

  return query
  with statement_events as (
    select
      'voucher:' || v.id::text as entry_id,
      v.generated_at as entry_date,
      v.guardian_id,
      g.name as guardian_name,
      v.student_id,
      st.name as student_name,
      v.id as voucher_id,
      to_char(v.period, 'YYYY-MM') as period_text,
      'voucher'::text as kind,
      'Voucher issued'::text as description,
      null::text as method,
      null::text as receipt_number,
      v.total as amount,
      v.total as signed_amount
    from public.vouchers v
    join public.guardians g on g.id = v.guardian_id
    join public.students st on st.id = v.student_id
    where v.guardian_id = p_guardian_id

    union all

    select
      'ledger:' || le.id::text as entry_id,
      le.created_at as entry_date,
      le.guardian_id,
      g.name as guardian_name,
      le.student_id,
      st.name as student_name,
      le.voucher_id,
      to_char(v.period, 'YYYY-MM') as period_text,
      le.kind::text as kind,
      case
        when le.kind = 'payment' then 'Payment received'
        when le.kind = 'discount' then 'Discount'
        when le.kind = 'fine' then 'Fine'
        when le.kind = 'adjustment' then coalesce(le.reason, 'Adjustment')
        else initcap(le.kind::text)
      end as description,
      le.method::text as method,
      le.receipt_number,
      le.amount,
      case
        when le.kind in ('payment', 'discount') then -le.amount
        else le.amount
      end as signed_amount
    from public.ledger_entries le
    join public.guardians g on g.id = le.guardian_id
    join public.students st on st.id = le.student_id
    left join public.vouchers v on v.id = le.voucher_id
    where le.guardian_id = p_guardian_id
      and le.kind <> 'voucher'
  )
  select
    se.entry_id,
    se.entry_date,
    to_char(se.entry_date, 'YYYY-MM-DD HH24:MI') as entry_date_text,
    se.guardian_id,
    se.guardian_name,
    se.student_id,
    se.student_name,
    se.voucher_id,
    se.period_text,
    se.kind,
    se.description,
    se.method,
    se.receipt_number,
    se.amount,
    se.signed_amount,
    sum(se.signed_amount) over (
      order by se.entry_date, se.entry_id
      rows between unbounded preceding and current row
    ) as running_balance
  from statement_events se
  order by se.entry_date desc, se.entry_id desc;
end;
$$;

revoke all on function public.get_admin_guardian_statement(uuid) from public;
grant execute on function public.get_admin_guardian_statement(uuid) to authenticated;
revoke execute on function public.get_admin_guardian_statement(uuid) from anon;
