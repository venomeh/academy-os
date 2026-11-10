-- =============================================================================
-- AcademyOS - Bubble-proof admin fee read models (v2)
--
-- This app's Bubble custom date formatter does not emit ISO dates reliably:
-- both `mm` and `MM` render as MINUTES, and `YYYY` / `DD` are not tokens at all
-- (a "YYYY-MM-DD" format produced the literal string "YYYY-20-DD"). Any RPC that
-- declares a `date` argument is therefore one formatting quirk away from either
-- a 400 (invalid input syntax for type date) or a silently wrong month.
--
-- These v2 functions take TEXT for every argument and normalise defensively, so
-- no value Bubble is capable of sending can produce an error or a wrong filter.
--
-- Contract:
--   p_month         '' | null | unparseable -> current month (Asia/Karachi)
--                   'all'                   -> no period filter at all
--                   'YYYY-MM' | 'YYYY-M' | 'YYYY-MM-DD' | any parseable date
--                                           -> the month containing that date
--   p_status        'unpaid' | 'partial' | 'paid' -> filter; anything else -> all
--   p_overdue_only  'yes'|'true'|'t'|'1'|'on' (case-insensitive) -> true; else false
--   p_search        trimmed; empty -> no filter
--   p_bust          ignored. Exists so Bubble can force a refetch by changing a
--                   body param instead of abusing the PostgREST `limit` query arg.
--
-- Return columns are byte-identical to get_admin_vouchers / get_admin_fee_summary
-- so existing Bubble field mappings (_api_c2_*) keep working after re-initialising.
-- The v1 functions are left in place and untouched.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Shared, defensive input normalisers
-- ---------------------------------------------------------------------------

create or replace function public.admin_parse_bool(p_value text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select lower(trim(coalesce(p_value, ''))) in ('yes', 'true', 't', '1', 'on');
$$;

comment on function public.admin_parse_bool(text) is
  'Lenient text -> boolean for UI-supplied flags. Anything unrecognised is false.';

create or replace function public.admin_resolve_period(p_month text)
returns date
language plpgsql
stable
set search_path = public
as $$
declare
  v_raw  text := lower(nullif(trim(coalesce(p_month, '')), ''));
  v_date date;
begin
  -- Explicit opt-out of the period filter.
  if v_raw = 'all' then
    return null;
  end if;

  if v_raw is not null then
    -- Accept 'YYYY-MM' / 'YYYY-M' by pinning to the first of the month.
    if v_raw ~ '^\d{4}-\d{1,2}$' then
      v_raw := v_raw || '-01';
    end if;

    begin
      v_date := date_trunc('month', v_raw::date)::date;
    exception when others then
      -- Unparseable (e.g. 'YYYY-20-DD', '2026-23-Tu') -> fall through to default.
      v_date := null;
    end;
  end if;

  return coalesce(
    v_date,
    date_trunc('month', (timezone('Asia/Karachi', now()))::date)::date
  );
end;
$$;

comment on function public.admin_resolve_period(text) is
  'Text -> month start. NULL only for the literal ''all''. Unparseable input falls back to the current Karachi month rather than erroring.';

revoke all on function public.admin_parse_bool(text) from public;
revoke all on function public.admin_resolve_period(text) from public;
grant execute on function public.admin_parse_bool(text) to authenticated;
grant execute on function public.admin_resolve_period(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Voucher list for the admin Fees section (all-text arguments)
-- ---------------------------------------------------------------------------

create or replace function public.get_admin_vouchers_v2(
  p_status text default null,
  p_month text default null,
  p_overdue_only text default null,
  p_search text default null,
  p_bust text default null
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
  v_period_start date := public.admin_resolve_period(p_month);
  v_period_end   date := case
    when public.admin_resolve_period(p_month) is null then null
    else (public.admin_resolve_period(p_month) + interval '1 month')::date
  end;
  v_overdue boolean := public.admin_parse_bool(p_overdue_only);
  v_status_raw text := lower(trim(coalesce(p_status, '')));
  v_status text := case
    when v_status_raw in ('unpaid', 'partial', 'paid') then v_status_raw
    else null
  end;
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
    and (v_overdue is false or (vb.outstanding > 0 and v.due_date < current_date))
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

comment on function public.get_admin_vouchers_v2(text, text, text, text, text) is
  'Admin Fees list. All arguments are text and normalised defensively so malformed UI input degrades to a sensible default instead of erroring.';

revoke all on function public.get_admin_vouchers_v2(text, text, text, text, text) from public;
grant execute on function public.get_admin_vouchers_v2(text, text, text, text, text) to authenticated;
revoke execute on function public.get_admin_vouchers_v2(text, text, text, text, text) from anon;

-- ---------------------------------------------------------------------------
-- Fee summary cards for the admin Fees section (all-text arguments)
-- ---------------------------------------------------------------------------

create or replace function public.get_admin_fee_summary_v2(
  p_month text default null,
  p_bust text default null
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
  -- 'all' is meaningless for a per-month summary; fall back to current month.
  v_period_start date := coalesce(
    public.admin_resolve_period(p_month),
    date_trunc('month', (timezone('Asia/Karachi', now()))::date)::date
  );
  v_period_end date;
begin
  if public.auth_role() is distinct from 'admin' then
    raise exception 'Admin only';
  end if;

  v_period_end := (v_period_start + interval '1 month')::date;

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

comment on function public.get_admin_fee_summary_v2(text, text) is
  'Admin Fees summary cards. All arguments are text and normalised defensively.';

revoke all on function public.get_admin_fee_summary_v2(text, text) from public;
grant execute on function public.get_admin_fee_summary_v2(text, text) to authenticated;
revoke execute on function public.get_admin_fee_summary_v2(text, text) from anon;

-- ---------------------------------------------------------------------------
-- Voucher generation for the admin button (all-text arguments)
-- ---------------------------------------------------------------------------

create or replace function public.generate_vouchers_v2(
  p_month text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  -- generate_vouchers() re-checks admin itself; resolve the month defensively
  -- so a malformed UI string can never bill the wrong period.
  return public.generate_vouchers(public.admin_resolve_period(p_month));
end;
$$;

comment on function public.generate_vouchers_v2(text) is
  'Text-argument wrapper around generate_vouchers(date). Unparseable input resolves to the current Karachi month instead of erroring or billing a wrong period.';

revoke all on function public.generate_vouchers_v2(text) from public;
grant execute on function public.generate_vouchers_v2(text) to authenticated;
revoke execute on function public.generate_vouchers_v2(text) from anon;
