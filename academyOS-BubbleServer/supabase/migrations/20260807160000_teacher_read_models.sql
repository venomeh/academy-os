-- =============================================================================
-- AcademyOS — Teacher read-model RPCs (Tasks §6.1 Attendance, §7 Assessments)
--
-- Goal: ONE call per screen. No client-side joins in Bubble.
-- All "always shown" fields are NOT NULL by construction (coalesce) so Bubble's
-- Initialize always detects them and the API type never drifts.
--
-- Security: SECURITY INVOKER everywhere — existing RLS decides what a teacher
-- can see. Teachers automatically get only their assigned batches.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) FIX: allow partial draft marks (Tasks §7 "partial entry can be saved as draft")
--    Blank obtained + absent=false now means "not entered yet" (row removed),
--    instead of raising an error.
-- ---------------------------------------------------------------------------

create or replace function public.upsert_assessment_scores(
  p_assessment_id uuid,
  p_scores jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_role text := public.auth_role();
  v_actor uuid := auth.uid();
  v_assessment public.assessments;
  v_item jsonb;
  v_student_id uuid;
  v_obtained numeric;
  v_absent boolean;
  v_saved integer := 0;
  v_cleared integer := 0;
begin
  if v_actor is null then
    raise exception 'not authenticated';
  end if;

  if v_role not in ('teacher', 'admin') then
    raise exception 'only teacher or admin can save scores';
  end if;

  select * into v_assessment
  from public.assessments
  where id = p_assessment_id;

  if not found then
    raise exception 'assessment not found';
  end if;

  if v_assessment.published then
    raise exception 'cannot edit scores on a published assessment';
  end if;

  if v_role = 'teacher'
     and v_assessment.batch_id not in (select public.auth_teacher_batch_ids()) then
    raise exception 'assessment batch not assigned to this teacher';
  end if;

  if jsonb_typeof(p_scores) <> 'array' then
    raise exception 'p_scores must be a JSON array of {student_id, obtained?, absent?}';
  end if;

  for v_item in select * from jsonb_array_elements(p_scores)
  loop
    v_student_id := (v_item ->> 'student_id')::uuid;
    v_absent := coalesce((v_item ->> 'absent')::boolean, false);
    v_obtained := nullif(btrim(coalesce(v_item ->> 'obtained', '')), '')::numeric;

    if v_student_id is null then
      raise exception 'each score requires student_id';
    end if;

    if v_absent then
      -- absent for test: no mark stored
      insert into public.scores (assessment_id, student_id, obtained, absent)
      values (p_assessment_id, v_student_id, null, true)
      on conflict (assessment_id, student_id)
      do update set obtained = null, absent = true, updated_at = now();
      v_saved := v_saved + 1;

    elsif v_obtained is null then
      -- blank = not entered yet -> keep the sheet a valid draft
      delete from public.scores
      where assessment_id = p_assessment_id
        and student_id = v_student_id;
      v_cleared := v_cleared + 1;

    else
      insert into public.scores (assessment_id, student_id, obtained, absent)
      values (p_assessment_id, v_student_id, v_obtained, false)
      on conflict (assessment_id, student_id)
      do update set obtained = excluded.obtained, absent = false, updated_at = now();
      v_saved := v_saved + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'assessment_id', p_assessment_id,
    'saved', v_saved,
    'cleared', v_cleared
  );
end;
$$;

revoke all on function public.upsert_assessment_scores(uuid, jsonb) from public;
grant execute on function public.upsert_assessment_scores(uuid, jsonb) to authenticated;
revoke execute on function public.upsert_assessment_scores(uuid, jsonb) from anon;

-- ---------------------------------------------------------------------------
-- 2) Teacher home: my batches for today with marking progress
--    RLS on batches already scopes this to assigned batches for teachers.
-- ---------------------------------------------------------------------------

create or replace function public.get_my_batches_today(
  p_date date default null
)
returns table (
  batch_id uuid,
  batch_name text,
  grade_level text,
  days_text text,
  start_time_text text,
  end_time_text text,
  attendance_date date,
  attendance_date_text text,
  roster_count integer,
  marked_count integer,
  is_complete boolean,
  is_overdue boolean,
  status_label text
)
language sql
stable
security invoker
set search_path = public
as $$
  with d as (
    select coalesce(p_date, public.pkt_today()) as the_date
  )
  select
    b.id as batch_id,
    b.name as batch_name,
    coalesce(b.grade_level, '') as grade_level,
    coalesce(array_to_string(b.days_of_week, ', '), '') as days_text,
    coalesce(b.start_time::text, '') as start_time_text,
    coalesce(b.end_time::text, '') as end_time_text,
    d.the_date as attendance_date,
    to_char(d.the_date, 'YYYY-MM-DD') as attendance_date_text,
    coalesce(r.roster_count, 0)::integer as roster_count,
    coalesce(m.marked_count, 0)::integer as marked_count,
    (coalesce(r.roster_count, 0) > 0
      and coalesce(m.marked_count, 0) >= coalesce(r.roster_count, 0)) as is_complete,
    (coalesce(r.roster_count, 0) > 0
      and coalesce(m.marked_count, 0) < coalesce(r.roster_count, 0)
      and d.the_date = public.pkt_today()
      and (now() at time zone 'Asia/Karachi')::time >= public.attendance_cutoff_time()
    ) as is_overdue,
    case
      when coalesce(r.roster_count, 0) = 0 then 'No students'
      when coalesce(m.marked_count, 0) >= coalesce(r.roster_count, 0) then 'Marked'
      when coalesce(m.marked_count, 0) > 0 then 'Partial'
      else 'Not marked'
    end as status_label
  from public.batches b
  cross join d
  left join lateral (
    select count(*)::integer as roster_count
    from public.batch_active_roster(b.id, d.the_date)
  ) r on true
  left join lateral (
    select count(*)::integer as marked_count
    from public.attendance a
    where a.batch_id = b.id
      and a.date = d.the_date
  ) m on true
  where b.active = true
  order by b.start_time nulls last, b.name;
$$;

revoke all on function public.get_my_batches_today(date) from public;
grant execute on function public.get_my_batches_today(date) to authenticated;
revoke execute on function public.get_my_batches_today(date) from anon;

-- ---------------------------------------------------------------------------
-- 3) Attendance sheet: roster + existing marks in ONE call
--    status defaults to 'present' (Tasks §6.1 "default all-present")
-- ---------------------------------------------------------------------------

create or replace function public.get_attendance_sheet(
  p_batch_id uuid,
  p_date date default null
)
returns table (
  batch_id uuid,
  attendance_date date,
  attendance_date_text text,
  student_id uuid,
  student_name text,
  status text,
  is_marked boolean,
  attendance_id uuid,
  is_corrected boolean,
  roster_count integer,
  marked_count integer,
  can_edit boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with d as (
    select coalesce(p_date, public.pkt_today()) as the_date
  ),
  roster as (
    select r.student_id, r.full_name
    from d, public.batch_active_roster(p_batch_id, d.the_date) r
  ),
  marks as (
    select a.student_id, a.status::text as status, a.id, a.corrected_at
    from d
    join public.attendance a
      on a.batch_id = p_batch_id
     and a.date = d.the_date
  ),
  totals as (
    select
      (select count(*)::integer from roster) as roster_count,
      (select count(*)::integer from marks) as marked_count
  )
  select
    p_batch_id as batch_id,
    d.the_date as attendance_date,
    to_char(d.the_date, 'YYYY-MM-DD') as attendance_date_text,
    r.student_id,
    r.full_name as student_name,
    coalesce(m.status, 'present') as status,
    (m.student_id is not null) as is_marked,
    m.id as attendance_id,
    (m.corrected_at is not null) as is_corrected,
    t.roster_count,
    t.marked_count,
    (
      (select public.auth_role()) = 'admin'
      or d.the_date = public.pkt_today()
    ) as can_edit
  from d
  cross join totals t
  join roster r on true
  left join marks m on m.student_id = r.student_id
  order by r.full_name;
$$;

revoke all on function public.get_attendance_sheet(uuid, date) from public;
grant execute on function public.get_attendance_sheet(uuid, date) to authenticated;
revoke execute on function public.get_attendance_sheet(uuid, date) from anon;

-- ---------------------------------------------------------------------------
-- 4) Create assessment (forces created_by = caller, validates batch/subject)
-- ---------------------------------------------------------------------------

create or replace function public.create_assessment(
  p_batch_id uuid,
  p_subject_id uuid,
  p_date date,
  p_max_marks numeric
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_role text := public.auth_role();
  v_actor uuid := auth.uid();
  v_academy_id uuid;
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'not authenticated';
  end if;

  if v_role not in ('teacher', 'admin') then
    raise exception 'only teacher or admin can create assessments';
  end if;

  if p_max_marks is null or p_max_marks <= 0 then
    raise exception 'max_marks must be greater than 0';
  end if;

  if p_date is null then
    raise exception 'date is required';
  end if;

  if v_role = 'teacher'
     and p_batch_id not in (select public.auth_teacher_batch_ids()) then
    raise exception 'batch not assigned to this teacher';
  end if;

  select academy_id into v_academy_id
  from public.batches
  where id = p_batch_id;

  if v_academy_id is null then
    raise exception 'batch not found';
  end if;

  -- subject/batch match is also enforced by trigger; fail early with clear text
  if not exists (
    select 1 from public.subjects s
    where s.id = p_subject_id and s.batch_id = p_batch_id
  ) then
    raise exception 'subject does not belong to this batch';
  end if;

  insert into public.assessments (
    academy_id, batch_id, subject_id, date, max_marks, published, created_by
  ) values (
    v_academy_id, p_batch_id, p_subject_id, p_date, p_max_marks, false, v_actor
  )
  returning id into v_id;

  return jsonb_build_object(
    'assessment_id', v_id,
    'batch_id', p_batch_id,
    'subject_id', p_subject_id,
    'max_marks', p_max_marks,
    'published', false
  );
end;
$$;

revoke all on function public.create_assessment(uuid, uuid, date, numeric) from public;
grant execute on function public.create_assessment(uuid, uuid, date, numeric) to authenticated;
revoke execute on function public.create_assessment(uuid, uuid, date, numeric) from anon;

-- ---------------------------------------------------------------------------
-- 5) Assessment list for teacher/admin with entry progress
-- ---------------------------------------------------------------------------

create or replace function public.get_my_assessments(
  p_batch_id uuid default null
)
returns table (
  assessment_id uuid,
  batch_id uuid,
  batch_name text,
  subject_id uuid,
  subject_name text,
  assessment_date date,
  assessment_date_text text,
  max_marks numeric,
  published boolean,
  roster_count integer,
  scored_count integer,
  is_complete boolean,
  status_label text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    a.id as assessment_id,
    a.batch_id,
    b.name as batch_name,
    a.subject_id,
    s.name as subject_name,
    a.date as assessment_date,
    to_char(a.date, 'YYYY-MM-DD') as assessment_date_text,
    a.max_marks,
    a.published,
    coalesce(r.roster_count, 0)::integer as roster_count,
    coalesce(sc.scored_count, 0)::integer as scored_count,
    (coalesce(r.roster_count, 0) > 0
      and coalesce(sc.scored_count, 0) >= coalesce(r.roster_count, 0)) as is_complete,
    case
      when a.published then 'Published'
      when coalesce(sc.scored_count, 0) = 0 then 'Draft — no marks'
      when coalesce(sc.scored_count, 0) >= coalesce(r.roster_count, 0) then 'Ready to publish'
      else 'Draft — partial'
    end as status_label
  from public.assessments a
  join public.batches b on b.id = a.batch_id
  join public.subjects s on s.id = a.subject_id
  left join lateral (
    select count(*)::integer as roster_count
    from public.batch_active_roster(a.batch_id, a.date)
  ) r on true
  left join lateral (
    select count(*)::integer as scored_count
    from public.scores x
    where x.assessment_id = a.id
      and (x.absent = true or x.obtained is not null)
  ) sc on true
  where (p_batch_id is null or a.batch_id = p_batch_id)
  order by a.date desc, b.name, s.name;
$$;

revoke all on function public.get_my_assessments(uuid) from public;
grant execute on function public.get_my_assessments(uuid) to authenticated;
revoke execute on function public.get_my_assessments(uuid) from anon;

-- ---------------------------------------------------------------------------
-- 6) Marks sheet: roster + marks + percentage + batch average in ONE call
--    (Tasks §7 "percentages and batch average computed")
-- ---------------------------------------------------------------------------

create or replace function public.get_marks_sheet(
  p_assessment_id uuid
)
returns table (
  assessment_id uuid,
  batch_id uuid,
  batch_name text,
  subject_name text,
  assessment_date_text text,
  max_marks numeric,
  published boolean,
  student_id uuid,
  student_name text,
  obtained numeric,
  obtained_display text,
  absent boolean,
  pct numeric,
  pct_display text,
  is_entered boolean,
  roster_count integer,
  scored_count integer,
  batch_average numeric,
  batch_average_display text
)
language sql
stable
security invoker
set search_path = public
as $$
  with a as (
    select
      x.id, x.batch_id, x.subject_id, x.date, x.max_marks, x.published
    from public.assessments x
    where x.id = p_assessment_id
  ),
  roster as (
    select r.student_id, r.full_name
    from a, public.batch_active_roster(a.batch_id, a.date) r
  ),
  marks as (
    select s.student_id, s.obtained, s.absent
    from public.scores s
    where s.assessment_id = p_assessment_id
  ),
  agg as (
    select
      (select count(*)::integer from roster) as roster_count,
      (select count(*)::integer from marks m
        where m.absent = true or m.obtained is not null) as scored_count,
      (select round(avg(m.obtained), 2) from marks m
        where m.obtained is not null) as avg_obtained
  )
  select
    a.id as assessment_id,
    a.batch_id,
    b.name as batch_name,
    sub.name as subject_name,
    to_char(a.date, 'YYYY-MM-DD') as assessment_date_text,
    a.max_marks,
    a.published,
    r.student_id,
    r.full_name as student_name,
    m.obtained,
    coalesce(m.obtained::text, '') as obtained_display,
    coalesce(m.absent, false) as absent,
    case
      when m.obtained is not null and a.max_marks > 0
        then round((m.obtained / a.max_marks) * 100, 1)
      else null
    end as pct,
    case
      when coalesce(m.absent, false) then 'Absent'
      when m.obtained is not null and a.max_marks > 0
        then round((m.obtained / a.max_marks) * 100, 1)::text || '%'
      else ''
    end as pct_display,
    (m.student_id is not null
      and (m.absent = true or m.obtained is not null)) as is_entered,
    g.roster_count,
    g.scored_count,
    coalesce(g.avg_obtained, 0) as batch_average,
    case
      when g.avg_obtained is null then '—'
      when a.max_marks > 0
        then g.avg_obtained::text || ' / ' || a.max_marks::text
          || ' (' || round((g.avg_obtained / a.max_marks) * 100, 1)::text || '%)'
      else g.avg_obtained::text
    end as batch_average_display
  from a
  cross join agg g
  join public.batches b on b.id = a.batch_id
  join public.subjects sub on sub.id = a.subject_id
  join roster r on true
  left join marks m on m.student_id = r.student_id
  order by r.full_name;
$$;

revoke all on function public.get_marks_sheet(uuid) from public;
grant execute on function public.get_marks_sheet(uuid) to authenticated;
revoke execute on function public.get_marks_sheet(uuid) from anon;

-- ---------------------------------------------------------------------------
-- 7) Bubble-friendly TEXT variants of the save RPCs
--    Bubble can mangle nested JSON built from a RepeatingGroup. These accept a
--    flat delimited string that Bubble builds with ":join with ,".
--
--    Attendance format : "<student_uuid>|<status>,<student_uuid>|<status>"
--    Marks format      : "<student_uuid>|<obtained>|<absent>" where obtained may
--                        be empty (= not entered) and absent is true/false
-- ---------------------------------------------------------------------------

create or replace function public.save_batch_attendance_text(
  p_batch_id uuid,
  p_date date,
  p_marks text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_pair text;
  v_parts text[];
  v_json jsonb := '[]'::jsonb;
begin
  if coalesce(btrim(p_marks), '') = '' then
    raise exception 'p_marks is empty';
  end if;

  foreach v_pair in array string_to_array(p_marks, ',')
  loop
    v_pair := btrim(v_pair);
    continue when v_pair = '';

    v_parts := string_to_array(v_pair, '|');
    if array_length(v_parts, 1) <> 2 then
      raise exception 'bad mark entry "%": expected student_id|status', v_pair;
    end if;

    v_json := v_json || jsonb_build_array(
      jsonb_build_object(
        'student_id', btrim(v_parts[1]),
        'status', btrim(v_parts[2])
      )
    );
  end loop;

  return public.save_batch_attendance(p_batch_id, p_date, v_json);
end;
$$;

revoke all on function public.save_batch_attendance_text(uuid, date, text) from public;
grant execute on function public.save_batch_attendance_text(uuid, date, text) to authenticated;
revoke execute on function public.save_batch_attendance_text(uuid, date, text) from anon;

create or replace function public.upsert_assessment_scores_text(
  p_assessment_id uuid,
  p_scores text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row text;
  v_parts text[];
  v_json jsonb := '[]'::jsonb;
begin
  if coalesce(btrim(p_scores), '') = '' then
    raise exception 'p_scores is empty';
  end if;

  foreach v_row in array string_to_array(p_scores, ',')
  loop
    v_row := btrim(v_row);
    continue when v_row = '';

    v_parts := string_to_array(v_row, '|');
    if array_length(v_parts, 1) < 2 then
      raise exception 'bad score entry "%": expected student_id|obtained|absent', v_row;
    end if;

    v_json := v_json || jsonb_build_array(
      jsonb_build_object(
        'student_id', btrim(v_parts[1]),
        'obtained', btrim(coalesce(v_parts[2], '')),
        'absent', (lower(btrim(coalesce(v_parts[3], 'false'))) in ('true', 'yes', '1'))
      )
    );
  end loop;

  return public.upsert_assessment_scores(p_assessment_id, v_json);
end;
$$;

revoke all on function public.upsert_assessment_scores_text(uuid, text) from public;
grant execute on function public.upsert_assessment_scores_text(uuid, text) to authenticated;
revoke execute on function public.upsert_assessment_scores_text(uuid, text) from anon;
