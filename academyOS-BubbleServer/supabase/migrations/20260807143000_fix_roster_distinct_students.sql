-- =============================================================================
-- AcademyOS — Fix roster distinct students + clean duplicate enrollment
-- Bug: overlapping enrollments for same student/batch inflated roster_count,
-- so batches_marked_today never reached is_complete for that batch.
-- =============================================================================

create or replace function public.batch_active_roster(
  p_batch_id uuid,
  p_date date default null
)
returns table (
  student_id uuid,
  full_name text,
  enrollment_id uuid,
  start_date date,
  end_date date
)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct on (s.id)
    s.id as student_id,
    s.name as full_name,
    e.id as enrollment_id,
    e.start_date,
    e.end_date
  from public.enrollments e
  join public.students s on s.id = e.student_id
  where e.batch_id = p_batch_id
    and e.start_date <= coalesce(p_date, public.pkt_today())
    and (e.end_date is null or e.end_date >= coalesce(p_date, public.pkt_today()))
    and s.status = 'active'
  order by s.id, e.start_date desc, e.id desc;
$$;

drop view if exists public.batches_marked_today;
create view public.batches_marked_today
with (security_invoker = on)
as
select
  b.id as batch_id,
  b.name as batch_name,
  coalesce(r.roster_count, 0)::integer as roster_count,
  coalesce(m.marked_count, 0)::integer as marked_count,
  case
    when coalesce(r.roster_count, 0) > 0
      and coalesce(m.marked_count, 0) >= coalesce(r.roster_count, 0)
    then true else false
  end as is_complete,
  case
    when coalesce(r.roster_count, 0) > 0
      and coalesce(m.marked_count, 0) >= coalesce(r.roster_count, 0)
    then true
    when coalesce(m.marked_count, 0) > 0 then true
    else false
  end as marked_today,
  case
    when coalesce(r.roster_count, 0) > 0
      and coalesce(m.marked_count, 0) < coalesce(r.roster_count, 0)
      and (now() at time zone 'Asia/Karachi')::time >= public.attendance_cutoff_time()
    then true else false
  end as is_overdue
from public.batches b
left join lateral (
  select count(*)::integer as roster_count
  from public.batch_active_roster(b.id, public.pkt_today())
) r on true
left join lateral (
  select count(*)::integer as marked_count
  from public.attendance a
  where a.batch_id = b.id
    and a.date = public.pkt_today()
) m on true
where b.active = true;

create or replace function public.enforce_assessment_publish_complete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_missing integer;
begin
  if new.published is true and coalesce(old.published, false) is distinct from true then
    select count(*)::integer into v_missing
    from (
      select distinct e.student_id
      from public.enrollments e
      join public.students s on s.id = e.student_id
      where e.batch_id = new.batch_id
        and e.start_date <= new.date
        and (e.end_date is null or e.end_date >= new.date)
        and s.status = 'active'
    ) roster
    where not exists (
      select 1
      from public.scores sc
      where sc.assessment_id = new.id
        and sc.student_id = roster.student_id
        and (sc.absent = true or sc.obtained is not null)
    );

    if v_missing > 0 then
      raise exception
        'cannot publish assessment %: % roster student(s) missing marks or absent flag',
        new.id, v_missing;
    end if;
  end if;
  return new;
end;
$$;

-- Idempotent cleanup of known duplicate (Student A1 / Grade 5)
delete from public.enrollments e
using public.enrollments keep
where e.student_id = '00000000-0000-0000-0000-eeeeeeeeee01'
  and e.batch_id = '00000000-0000-0000-0000-ffffffffffff'
  and keep.student_id = e.student_id
  and keep.batch_id = e.batch_id
  and keep.start_date < e.start_date;
