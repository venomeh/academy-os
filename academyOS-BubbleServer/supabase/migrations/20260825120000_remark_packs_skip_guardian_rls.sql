-- Teacher remark queue returned [] because get_remark_data_packs
-- inner-joined public.guardians. Teachers have no SELECT on guardians
-- (by design), so RLS dropped every roster row. Bubble Initialize then
-- sees an empty array and creates no `body` type.
--
-- Read language through a definer helper (en/ur only, no contact PII).

create or replace function public.guardian_language_pref(p_guardian_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(g.language_pref::text, 'en')
  from public.guardians g
  where g.id = p_guardian_id;
$$;

revoke all on function public.guardian_language_pref(uuid) from public, anon;
grant execute on function public.guardian_language_pref(uuid) to authenticated, service_role;

create or replace function public.get_remark_data_packs(
  p_batch_id text default null,
  p_month text default null,
  p_student_id text default null
)
returns table (
  academy_id uuid,
  student_id uuid,
  student_name text,
  batch_id uuid,
  batch_name text,
  period_date date,
  period_text text,
  guardian_id uuid,
  guardian_language text,
  joined_at_text text,
  joined_mid_month boolean,
  attendance_total_days integer,
  present_days integer,
  absent_days integer,
  late_days integer,
  leave_days integer,
  attendance_pct numeric,
  published_tests_count integer,
  tests_json jsonb,
  tests_summary text,
  current_month_avg_pct numeric,
  previous_month_avg_pct numeric,
  trend_text text,
  low_data boolean,
  low_data_reason text,
  existing_remark_id uuid,
  existing_status text
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_kind text := public.remark_caller_kind();
  v_month date := public.parse_year_month(p_month);
  v_batch uuid := public.parse_uuid_or_null(p_batch_id);
  v_student uuid := public.parse_uuid_or_null(p_student_id);
  v_as_of date;
begin
  if v_kind is null then
    raise exception 'Teacher or admin only';
  end if;

  if v_kind = 'teacher' then
    if v_batch is null then
      raise exception 'p_batch_id is required';
    end if;
    if v_batch not in (select public.auth_teacher_batch_ids()) then
      return;
    end if;
  elsif v_batch is not null
    and v_kind = 'admin'
    and not exists (select 1 from public.batches b where b.id = v_batch) then
    return;
  end if;

  if v_kind = 'teacher'
    and v_student is not null
    and v_student not in (select public.auth_teacher_student_ids()) then
    return;
  end if;

  v_as_of := least(
    public.pkt_today(),
    (v_month + interval '1 month' - interval '1 day')::date
  );

  return query
  with batches_in_scope as (
    select b.id, b.name, b.academy_id
    from public.batches b
    where b.active = true
      and (v_batch is null or b.id = v_batch)
      and (
        v_kind in ('admin', 'service')
        or b.id in (select public.auth_teacher_batch_ids())
      )
  ),
  roster as (
    select
      bis.id as batch_id,
      bis.name as batch_name,
      bis.academy_id,
      r.student_id,
      r.full_name,
      r.start_date as enrollment_start
    from batches_in_scope bis
    join lateral public.batch_active_roster(bis.id, v_as_of) r on true
    where v_student is null or r.student_id = v_student
  ),
  month_scores as (
    select
      sc.student_id,
      a.id as assessment_id,
      coalesce(sub.name, 'Test') as subject_name,
      a.date as assessment_date,
      sc.obtained,
      a.max_marks,
      sc.absent,
      case
        when sc.absent or a.max_marks <= 0 then null
        else round((sc.obtained / a.max_marks) * 100, 1)
      end as pct,
      (
        select round(avg(
          case
            when sc2.absent or a.max_marks <= 0 then null
            else (sc2.obtained / a.max_marks) * 100
          end
        ), 1)
        from public.scores sc2
        where sc2.assessment_id = a.id
          and sc2.absent = false
          and sc2.obtained is not null
      ) as batch_avg
    from public.scores sc
    join public.assessments a on a.id = sc.assessment_id
    join public.subjects sub on sub.id = a.subject_id
    where a.published = true
      and a.date >= v_month
      and a.date < (v_month + interval '1 month')::date
  ),
  prev_scores as (
    select
      sc.student_id,
      case
        when sc.absent or a.max_marks <= 0 then null
        else round((sc.obtained / a.max_marks) * 100, 1)
      end as pct
    from public.scores sc
    join public.assessments a on a.id = sc.assessment_id
    where a.published = true
      and a.date >= (v_month - interval '1 month')::date
      and a.date < v_month
  )
  select
    ro.academy_id,
    st.id,
    coalesce(st.name, ''),
    ro.batch_id,
    coalesce(ro.batch_name, ''),
    v_month,
    to_char(v_month, 'YYYY-MM'),
    st.guardian_id,
    coalesce(public.guardian_language_pref(st.guardian_id), 'en'),
    to_char(st.joined_at, 'YYYY-MM-DD'),
    (st.joined_at > v_month) as joined_mid_month,
    coalesce(att.total_days, 0),
    coalesce(att.present_days, 0),
    coalesce(att.absent_days, 0),
    coalesce(att.late_days, 0),
    coalesce(att.leave_days, 0),
    coalesce(att.attendance_pct, 0),
    coalesce(ms.published_tests_count, 0)::integer,
    coalesce(ms.tests_json, '[]'::jsonb),
    coalesce(ms.tests_summary, ''),
    ms.current_avg,
    ps.prev_avg,
    case
      when ms.current_avg is null or ps.prev_avg is null then ''
      when ms.current_avg > ps.prev_avg + 1 then 'improved'
      when ms.current_avg < ps.prev_avg - 1 then 'declined'
      else 'stable'
    end,
    (
      coalesce(ms.published_tests_count, 0) = 0
      or st.joined_at > v_month
      or coalesce(att.total_days, 0) = 0
    ),
    nullif(concat_ws(
      '; ',
      case when st.joined_at > v_month then 'Joined mid-month' else null end,
      case when coalesce(ms.published_tests_count, 0) = 0 then 'No published tests' else null end,
      case when coalesce(att.total_days, 0) = 0 then 'No attendance marked' else null end
    ), ''),
    rm.id,
    rm.status::text
  from roster ro
  join public.students st on st.id = ro.student_id
  left join lateral public.attendance_summary(st.id, v_month) att on true
  left join lateral (
    select
      count(*)::integer as published_tests_count,
      jsonb_agg(
        jsonb_build_object(
          'subject', x.subject_name,
          'date', to_char(x.assessment_date, 'YYYY-MM-DD'),
          'obtained', x.obtained,
          'max_marks', x.max_marks,
          'absent', x.absent,
          'percent', x.pct,
          'batch_average', x.batch_avg
        )
        order by x.assessment_date, x.subject_name
      ) as tests_json,
      string_agg(
        x.subject_name || ' ' || coalesce(x.pct::text || '%', 'absent')
          || coalesce(' (batch avg ' || x.batch_avg::text || '%)', ''),
        '; ' order by x.assessment_date, x.subject_name
      ) as tests_summary,
      round(avg(x.pct), 1) as current_avg
    from month_scores x
    where x.student_id = st.id
  ) ms on true
  left join lateral (
    select round(avg(p.pct), 1) as prev_avg
    from prev_scores p
    where p.student_id = st.id
  ) ps on true
  left join public.remarks rm
    on rm.student_id = st.id
   and rm.period = v_month
  order by ro.batch_name, st.name;
end;
$$;
