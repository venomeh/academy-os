-- =============================================================================
-- AcademyOS — Academic integrity hardening (part 1: helpers)
-- Applied to live as academic_integrity_hardening
-- =============================================================================

create or replace function public.pkt_today()
returns date
language sql
stable
set search_path = public
as $$
  select (now() at time zone 'Asia/Karachi')::date;
$$;

create or replace function public.attendance_cutoff_time()
returns time
language sql
immutable
set search_path = public
as $$
  select time '21:00';
$$;

create or replace function public.is_actively_enrolled(
  p_student_id uuid,
  p_batch_id uuid,
  p_date date default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.enrollments e
    where e.student_id = p_student_id
      and e.batch_id = p_batch_id
      and e.start_date <= coalesce(p_date, public.pkt_today())
      and (e.end_date is null or e.end_date >= coalesce(p_date, public.pkt_today()))
  );
$$;

revoke all on function public.is_actively_enrolled(uuid, uuid, date) from public;
grant execute on function public.is_actively_enrolled(uuid, uuid, date) to authenticated;
