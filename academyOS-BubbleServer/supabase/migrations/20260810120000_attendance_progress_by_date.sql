-- Admin attendance list for any date (PKT calendar day).
-- Teachers remain restricted to today via save_batch_attendance_text.

create or replace function public.get_attendance_progress(p_date date default null)
returns table (
  batch_id uuid,
  batch_name text,
  roster_count integer,
  marked_count integer,
  is_complete boolean,
  marked_today boolean,
  is_overdue boolean,
  attendance_date date
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_date date := coalesce(p_date, public.pkt_today());
  v_is_today boolean := (v_date = public.pkt_today());
begin
  if public.auth_role() is distinct from 'admin' then
    raise exception 'Admin only';
  end if;

  return query
  select
    b.id as batch_id,
    b.name as batch_name,
    coalesce(r.roster_count, 0)::integer as roster_count,
    coalesce(m.marked_count, 0)::integer as marked_count,
    case
      when coalesce(r.roster_count, 0) > 0
        and coalesce(m.marked_count, 0) >= coalesce(r.roster_count, 0)
      then true
      else false
    end as is_complete,
    case
      when coalesce(r.roster_count, 0) > 0
        and coalesce(m.marked_count, 0) >= coalesce(r.roster_count, 0)
      then true
      when coalesce(m.marked_count, 0) > 0
      then true
      else false
    end as marked_today,
    case
      when coalesce(r.roster_count, 0) > 0
        and coalesce(m.marked_count, 0) < coalesce(r.roster_count, 0)
        and (
          (v_is_today and (now() at time zone 'Asia/Karachi')::time >= public.attendance_cutoff_time())
          or (not v_is_today and v_date < public.pkt_today())
        )
      then true
      else false
    end as is_overdue,
    v_date as attendance_date
  from public.batches b
  left join lateral (
    select count(*)::integer as roster_count
    from public.batch_active_roster(b.id, v_date)
  ) r on true
  left join lateral (
    select count(*)::integer as marked_count
    from public.attendance a
    where a.batch_id = b.id
      and a.date = v_date
  ) m on true
  where b.active = true
  order by b.name;
end;
$$;

revoke all on function public.get_attendance_progress(date) from public;
grant execute on function public.get_attendance_progress(date) to authenticated;

-- Keep old name as thin wrapper for existing Bubble calls.
create or replace function public.get_attendance_progress_today()
returns table (
  batch_id uuid,
  batch_name text,
  roster_count integer,
  marked_count integer,
  is_complete boolean,
  marked_today boolean,
  is_overdue boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.batch_id,
    p.batch_name,
    p.roster_count,
    p.marked_count,
    p.is_complete,
    p.marked_today,
    p.is_overdue
  from public.get_attendance_progress(public.pkt_today()) p;
$$;
