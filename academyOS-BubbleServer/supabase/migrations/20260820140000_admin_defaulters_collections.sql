-- =============================================================================
-- AcademyOS - Admin defaulters + collections read models
--
-- Powers Fees §8.3 admin views. Views defaulters / monthly_collections already
-- exist; these RPCs add names + Bubble-safe p_bust and admin-only gates.
-- =============================================================================

create or replace function public.get_admin_defaulters(
  p_bust text default null
)
returns table (
  voucher_id uuid,
  student_id uuid,
  student_name text,
  guardian_id uuid,
  guardian_name text,
  guardian_email text,
  guardian_phone text,
  batch_name text,
  period date,
  period_text text,
  due_date date,
  due_date_text text,
  status text,
  total numeric,
  outstanding numeric,
  days_overdue integer,
  aging_bucket text,
  reminders_paused boolean
)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if public.auth_role() is distinct from 'admin' then
    raise exception 'only admin can view defaulters';
  end if;

  return query
  select
    d.voucher_id,
    d.student_id,
    s.name::text as student_name,
    d.guardian_id,
    g.name::text as guardian_name,
    g.email::text as guardian_email,
    g.phone::text as guardian_phone,
    (
      select b.name::text
      from public.enrollments e
      join public.batches b on b.id = e.batch_id
      where e.student_id = d.student_id
        and e.end_date is null
      order by e.start_date desc nulls last
      limit 1
    ) as batch_name,
    d.period,
    to_char(d.period, 'YYYY-MM') as period_text,
    d.due_date,
    to_char(d.due_date, 'YYYY-MM-DD') as due_date_text,
    d.status::text,
    d.total,
    d.outstanding,
    d.days_overdue::integer,
    d.bucket::text as aging_bucket,
    d.reminders_paused
  from public.defaulters d
  join public.students s on s.id = d.student_id
  join public.guardians g on g.id = d.guardian_id
  order by d.days_overdue desc, g.name, s.name;
end;
$$;

comment on function public.get_admin_defaulters(text) is
  'Admin-only overdue voucher list with aging buckets. p_bust ignored (Bubble refetch).';

revoke all on function public.get_admin_defaulters(text) from public;
grant execute on function public.get_admin_defaulters(text) to authenticated;
revoke execute on function public.get_admin_defaulters(text) from anon;

create or replace function public.get_admin_collections(
  p_bust text default null
)
returns table (
  month date,
  month_text text,
  method text,
  payment_count bigint,
  total_collected numeric,
  is_current_month boolean,
  is_today_slice boolean
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_today date := (timezone('Asia/Karachi', now()))::date;
  v_month date := date_trunc('month', v_today)::date;
begin
  if public.auth_role() is distinct from 'admin' then
    raise exception 'only admin can view collections';
  end if;

  -- Monthly rolls (cash / stripe), newest first
  return query
  select
    mc.month,
    to_char(mc.month, 'YYYY-MM') as month_text,
    coalesce(mc.method::text, 'unknown') as method,
    mc.payment_count,
    mc.total_collected,
    (mc.month = v_month) as is_current_month,
    false as is_today_slice
  from public.monthly_collections mc
  order by mc.month desc, mc.method;

  -- Extra rows: today's collections by method (for the live tile)
  return query
  select
    v_today as month,
    to_char(v_today, 'YYYY-MM-DD') as month_text,
    coalesce(le.method::text, 'unknown') as method,
    count(*)::bigint as payment_count,
    coalesce(sum(le.amount), 0)::numeric as total_collected,
    true as is_current_month,
    true as is_today_slice
  from public.ledger_entries le
  where le.kind = 'payment'
    and (timezone('Asia/Karachi', le.created_at))::date = v_today
  group by le.method;
end;
$$;

comment on function public.get_admin_collections(text) is
  'Admin-only monthly collections plus today-by-method rows (is_today_slice=true). p_bust ignored.';

revoke all on function public.get_admin_collections(text) from public;
grant execute on function public.get_admin_collections(text) to authenticated;
revoke execute on function public.get_admin_collections(text) from anon;
