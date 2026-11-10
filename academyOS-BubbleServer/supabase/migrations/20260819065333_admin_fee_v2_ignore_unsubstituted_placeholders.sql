-- =============================================================================
-- AcademyOS - Ignore Bubble's unsubstituted body-parameter placeholders
--
-- When an API Connector body parameter is left blank, Bubble does not send an
-- empty string: it ships the raw placeholder token from the body template.
-- Observed live on the Fees list initialise call -- the request body carried
-- p_search = the literal '<p_search>', which then ran through
-- `st.name ilike '%<p_search>%'`, matched nobody, and returned an empty array
-- with HTTP 200. That is indistinguishable from "no data" in the Bubble UI, and
-- it also starves the API Connector of the sample row it needs to infer the
-- response schema, so every _api_c2_* field on the repeating group comes up empty.
--
-- Any '<token>' shaped value is therefore treated as absent.
-- =============================================================================

create or replace function public.admin_clean_text(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(
    case
      when trim(coalesce(p_value, '')) ~ '^<[A-Za-z0-9_]*>$' then ''
      else trim(coalesce(p_value, ''))
    end,
    ''
  );
$$;

comment on function public.admin_clean_text(text) is
  'Trims UI text and treats an unsubstituted Bubble placeholder such as <p_search> as NULL.';

revoke all on function public.admin_clean_text(text) from public;
grant execute on function public.admin_clean_text(text) to authenticated;

-- A placeholder must also not be mistaken for a real month.
create or replace function public.admin_resolve_period(p_month text)
returns date
language plpgsql
stable
set search_path = public
as $$
declare
  v_raw  text := lower(public.admin_clean_text(p_month));
  v_date date;
begin
  if v_raw = 'all' then
    return null;
  end if;

  if v_raw is not null then
    if v_raw ~ '^\d{4}-\d{1,2}$' then
      v_raw := v_raw || '-01';
    end if;

    begin
      v_date := date_trunc('month', v_raw::date)::date;
    exception when others then
      v_date := null;
    end;
  end if;

  return coalesce(
    v_date,
    date_trunc('month', (timezone('Asia/Karachi', now()))::date)::date
  );
end;
$$;

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
  v_period_end   date;
  v_overdue boolean := public.admin_parse_bool(p_overdue_only);
  v_status_raw text := lower(coalesce(public.admin_clean_text(p_status), ''));
  v_status text := case
    when v_status_raw in ('unpaid', 'partial', 'paid') then v_status_raw
    else null
  end;
  v_search text := public.admin_clean_text(p_search);
begin
  if public.auth_role() is distinct from 'admin' then
    raise exception 'Admin only';
  end if;

  v_period_end := case
    when v_period_start is null then null
    else (v_period_start + interval '1 month')::date
  end;

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

revoke all on function public.get_admin_vouchers_v2(text, text, text, text, text) from public;
grant execute on function public.get_admin_vouchers_v2(text, text, text, text, text) to authenticated;
revoke execute on function public.get_admin_vouchers_v2(text, text, text, text, text) from anon;
