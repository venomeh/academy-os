-- =============================================================================
-- AcademyOS - Parent portal "My Children" read model (Tasks 11)
--
-- One row per child, so the parent_children page can render a card per child
-- without N+1 calls from Bubble.
--
-- Conventions carried over from the admin v2 read models:
--   * every argument is text (p_bust), so Bubble's "null" literal and
--     unsubstituted <placeholder> tokens are harmless
--   * security invoker, so RLS does the scoping -- students are limited to this
--     guardian's children, scores to published assessments, remarks to approved
-- =============================================================================

create or replace function public.get_parent_children(
  p_bust text default null
)
returns table (
  student_id uuid,
  student_name text,
  grade text,
  status text,
  joined_at_text text,
  batch_id uuid,
  batch_name text,
  outstanding numeric,
  unpaid_vouchers integer,
  next_due_date_text text,
  attendance_pct numeric,
  present_days integer,
  total_days integer,
  published_results integer,
  latest_remark text,
  latest_remark_period text
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_gid uuid := public.auth_guardian_id();
  v_month date := date_trunc('month', (timezone('Asia/Karachi', now()))::date)::date;
begin
  if public.auth_role() is distinct from 'parent' then
    raise exception 'Parent only';
  end if;

  if v_gid is null then
    return;
  end if;

  return query
  select
    s.id                                            as student_id,
    coalesce(s.name, '')                            as student_name,
    coalesce(s.grade, '')                           as grade,
    s.status::text                                  as status,
    to_char(s.joined_at, 'YYYY-MM-DD')              as joined_at_text,
    b.id                                            as batch_id,
    coalesce(b.name, '')                            as batch_name,
    coalesce(vsum.outstanding, 0)::numeric          as outstanding,
    coalesce(vsum.unpaid_cnt, 0)::integer           as unpaid_vouchers,
    coalesce(to_char(vsum.next_due, 'YYYY-MM-DD'), '') as next_due_date_text,
    coalesce(att.attendance_pct, 0)::numeric        as attendance_pct,
    coalesce(att.present_days, 0)::integer          as present_days,
    coalesce(att.total_days, 0)::integer            as total_days,
    coalesce(res.cnt, 0)::integer                   as published_results,
    coalesce(rm.txt, '')                            as latest_remark,
    coalesce(rm.period_text, '')                    as latest_remark_period
  from public.students s
  left join lateral (
    select e.batch_id
    from public.enrollments e
    where e.student_id = s.id
      and e.start_date <= current_date
      and (e.end_date is null or e.end_date >= current_date)
    order by e.start_date desc
    limit 1
  ) enr on true
  left join public.batches b on b.id = enr.batch_id
  left join lateral (
    select
      sum(vb.outstanding)                                  as outstanding,
      count(*) filter (where vb.outstanding > 0)           as unpaid_cnt,
      min(vb.due_date) filter (where vb.outstanding > 0)   as next_due
    from public.voucher_balances vb
    where vb.student_id = s.id
  ) vsum on true
  left join lateral (
    select * from public.attendance_summary(s.id, v_month)
  ) att on true
  left join lateral (
    select count(*) as cnt
    from public.scores sc
    join public.assessments a on a.id = sc.assessment_id
    where sc.student_id = s.id
      and a.published = true
  ) res on true
  left join lateral (
    select
      coalesce(r.final_text, r.draft_text) as txt,
      to_char(r.period, 'YYYY-MM')         as period_text
    from public.remarks r
    where r.student_id = s.id
      and r.status = 'approved'
    order by r.period desc
    limit 1
  ) rm on true
  where s.guardian_id = v_gid
  order by s.name;
end;
$$;

comment on function public.get_parent_children(text) is
  'One row per child for the parent portal: batch, outstanding, next due date, this month attendance, published result count and latest approved remark.';

revoke all on function public.get_parent_children(text) from public;
grant execute on function public.get_parent_children(text) to authenticated;
revoke execute on function public.get_parent_children(text) from anon;
