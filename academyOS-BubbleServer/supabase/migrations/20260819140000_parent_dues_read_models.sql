-- =============================================================================
-- AcademyOS — Parent dues read models
--
-- Parents must never call admin finance RPCs (those raise 'Admin only' and
-- would let a client pass another guardian_id). These RPCs take no family id:
-- they scope to auth_guardian_id() and require auth_role() = 'parent'.
--
-- SECURITY INVOKER so vouchers / ledger / students RLS still applies.
-- p_bust is ignored; Bubble binds it so a state bump refetches.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) One-row summary for the logged-in parent's header card
-- ---------------------------------------------------------------------------

create or replace function public.get_parent_fee_summary(
  p_bust text default null
)
returns table (
  guardian_name text,
  children_count integer,
  unpaid_vouchers integer,
  overdue_vouchers integer,
  total_outstanding numeric
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_gid uuid := public.auth_guardian_id();
begin
  if public.auth_role() is distinct from 'parent' then
    raise exception 'Parent only';
  end if;

  return query
  select
    coalesce(g.name, '') as guardian_name,
    (
      select count(*)::integer
      from public.students s
      where s.guardian_id = v_gid
    ) as children_count,
    count(vb.voucher_id) filter (where vb.outstanding > 0)::integer as unpaid_vouchers,
    count(vb.voucher_id) filter (
      where vb.outstanding > 0 and vb.due_date < current_date
    )::integer as overdue_vouchers,
    coalesce(sum(vb.outstanding), 0)::numeric as total_outstanding
  from public.guardians g
  left join public.voucher_balances vb on vb.guardian_id = g.id
  where g.id = v_gid
  group by g.id, g.name;
end;
$$;

comment on function public.get_parent_fee_summary(text) is
  'Logged-in parent fee header. Scopes to auth_guardian_id(); p_bust is unused and exists so Bubble can refetch.';

revoke all on function public.get_parent_fee_summary(text) from public;
grant execute on function public.get_parent_fee_summary(text) to authenticated;
revoke execute on function public.get_parent_fee_summary(text) from anon;

-- ---------------------------------------------------------------------------
-- 2) Outstanding vouchers for this guardian (dues list)
-- ---------------------------------------------------------------------------

create or replace function public.get_parent_dues(
  p_bust text default null
)
returns table (
  voucher_id uuid,
  student_id uuid,
  student_name text,
  batch_name text,
  period_text text,
  due_date_text text,
  total numeric,
  paid numeric,
  outstanding numeric,
  status text,
  status_label text,
  days_overdue integer
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_gid uuid := public.auth_guardian_id();
begin
  if public.auth_role() is distinct from 'parent' then
    raise exception 'Parent only';
  end if;

  if v_gid is null then
    return;
  end if;

  return query
  select
    v.id as voucher_id,
    st.id as student_id,
    coalesce(st.name, '') as student_name,
    coalesce(b.name, '') as batch_name,
    to_char(v.period, 'YYYY-MM') as period_text,
    to_char(v.due_date, 'YYYY-MM-DD') as due_date_text,
    v.total,
    vb.total_paid as paid,
    vb.outstanding,
    v.status::text as status,
    case
      when vb.outstanding <= 0 then 'Paid'
      when v.due_date < current_date then
        'Overdue - ' || (current_date - v.due_date)::text || 'd'
      when v.status = 'partial' then 'Partial'
      else 'Unpaid'
    end as status_label,
    greatest(current_date - v.due_date, 0)::integer as days_overdue
  from public.vouchers v
  join public.voucher_balances vb on vb.voucher_id = v.id
  join public.students st on st.id = v.student_id
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
  where v.guardian_id = v_gid
    and vb.outstanding > 0
  order by
    v.due_date asc,
    st.name;
end;
$$;

comment on function public.get_parent_dues(text) is
  'Logged-in parent outstanding vouchers. No client-supplied guardian_id. p_bust is unused and exists so Bubble can refetch.';

revoke all on function public.get_parent_dues(text) from public;
grant execute on function public.get_parent_dues(text) to authenticated;
revoke execute on function public.get_parent_dues(text) from anon;

-- ---------------------------------------------------------------------------
-- 3) Family statement (vouchers + ledger), same idea as admin statement
--    but always scoped to auth_guardian_id()
-- ---------------------------------------------------------------------------

create or replace function public.get_parent_statement(
  p_bust text default null
)
returns table (
  entry_id text,
  entry_date_text text,
  student_name text,
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
declare
  v_gid uuid := public.auth_guardian_id();
begin
  if public.auth_role() is distinct from 'parent' then
    raise exception 'Parent only';
  end if;

  if v_gid is null then
    return;
  end if;

  return query
  with statement_events as (
    select
      'voucher:' || v.id::text as entry_id,
      v.generated_at as entry_date,
      coalesce(st.name, '') as student_name,
      to_char(v.period, 'YYYY-MM') as period_text,
      'voucher'::text as kind,
      'Voucher issued'::text as description,
      ''::text as method,
      ''::text as receipt_number,
      v.total as amount,
      v.total as signed_amount
    from public.vouchers v
    join public.students st on st.id = v.student_id
    where v.guardian_id = v_gid

    union all

    select
      'ledger:' || le.id::text as entry_id,
      le.created_at as entry_date,
      coalesce(st.name, '') as student_name,
      coalesce(to_char(v.period, 'YYYY-MM'), '') as period_text,
      le.kind::text as kind,
      case
        when le.kind = 'payment' then 'Payment received'
        when le.kind = 'discount' then 'Discount'
        when le.kind = 'fine' then 'Fine'
        when le.kind = 'adjustment' then coalesce(le.reason, 'Adjustment')
        else initcap(le.kind::text)
      end as description,
      coalesce(le.method::text, '') as method,
      coalesce(le.receipt_number, '') as receipt_number,
      le.amount,
      case
        when le.kind in ('payment', 'discount') then -le.amount
        else le.amount
      end as signed_amount
    from public.ledger_entries le
    join public.students st on st.id = le.student_id
    left join public.vouchers v on v.id = le.voucher_id
    where le.guardian_id = v_gid
      and le.kind <> 'voucher'
  )
  select
    se.entry_id,
    to_char(se.entry_date, 'YYYY-MM-DD HH24:MI') as entry_date_text,
    se.student_name,
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

comment on function public.get_parent_statement(text) is
  'Logged-in parent family statement. No client-supplied guardian_id. p_bust is unused and exists so Bubble can refetch.';

revoke all on function public.get_parent_statement(text) from public;
grant execute on function public.get_parent_statement(text) to authenticated;
revoke execute on function public.get_parent_statement(text) from anon;
