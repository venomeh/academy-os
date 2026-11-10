-- =============================================================================
-- AcademyOS — Academic integrity hardening (part 2: triggers, policies, RPCs)
-- Depends on part 1 helpers: pkt_today, attendance_cutoff_time, is_actively_enrolled
-- Does not alter batch/student/guardian schemas. Safe with empty academic tables.
--
-- Live project applied this as three migrations for reviewability:
--   academic_integrity_guards_triggers
--   academic_integrity_view_policies
--   academic_integrity_rpcs
-- Content here is the canonical combined form for the repo.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Roster helper
-- ---------------------------------------------------------------------------

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
  select
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
  order by s.name;
$$;

revoke all on function public.batch_active_roster(uuid, date) from public;
grant execute on function public.batch_active_roster(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Fix attendance correction audit
-- ---------------------------------------------------------------------------

create or replace function public.audit_attendance_correction()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_role text;
  v_actor uuid;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  v_actor := coalesce(auth.uid(), new.marked_by);
  v_role := public.auth_role();

  if v_role = 'admin' then
    new.corrected_by := v_actor;
    new.corrected_at := now();
  elsif old.marked_by is distinct from v_actor then
    new.corrected_by := v_actor;
    new.corrected_at := now();
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Attendance enrollment integrity
-- ---------------------------------------------------------------------------

create or replace function public.enforce_attendance_enrollment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_actively_enrolled(new.student_id, new.batch_id, new.date) then
    raise exception
      'attendance blocked: student % is not actively enrolled in batch % on %',
      new.student_id, new.batch_id, new.date;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_attendance_enrollment on public.attendance;
create trigger trg_attendance_enrollment
  before insert or update of student_id, batch_id, date
  on public.attendance
  for each row
  execute function public.enforce_attendance_enrollment();

-- ---------------------------------------------------------------------------
-- Assessment subject must match batch
-- ---------------------------------------------------------------------------

create or replace function public.enforce_assessment_subject_batch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subject_batch uuid;
begin
  select s.batch_id into v_subject_batch
  from public.subjects s
  where s.id = new.subject_id;

  if v_subject_batch is null then
    raise exception 'assessment blocked: subject % not found', new.subject_id;
  end if;

  if v_subject_batch is distinct from new.batch_id then
    raise exception
      'assessment blocked: subject % belongs to batch %, not %',
      new.subject_id, v_subject_batch, new.batch_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_assessment_subject_batch on public.assessments;
create trigger trg_assessment_subject_batch
  before insert or update of subject_id, batch_id
  on public.assessments
  for each row
  execute function public.enforce_assessment_subject_batch();

-- ---------------------------------------------------------------------------
-- Cannot lower max_marks below existing scores
-- ---------------------------------------------------------------------------

create or replace function public.enforce_assessment_max_marks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_top numeric;
begin
  if tg_op = 'UPDATE'
     and new.max_marks is distinct from old.max_marks
     and new.max_marks < old.max_marks then
    select max(obtained) into v_top
    from public.scores
    where assessment_id = new.id
      and obtained is not null;

    if v_top is not null and new.max_marks < v_top then
      raise exception
        'cannot lower max_marks to %: existing score % exceeds it',
        new.max_marks, v_top;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_assessment_max_marks on public.assessments;
create trigger trg_assessment_max_marks
  before update of max_marks
  on public.assessments
  for each row
  execute function public.enforce_assessment_max_marks();

-- ---------------------------------------------------------------------------
-- Score student must be enrolled in assessment batch on assessment date
-- ---------------------------------------------------------------------------

create or replace function public.enforce_score_enrollment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_date date;
begin
  select a.batch_id, a.date
    into v_batch_id, v_date
  from public.assessments a
  where a.id = new.assessment_id;

  if v_batch_id is null then
    raise exception 'score blocked: assessment % not found', new.assessment_id;
  end if;

  if not public.is_actively_enrolled(new.student_id, v_batch_id, v_date) then
    raise exception
      'score blocked: student % is not actively enrolled in assessment batch % on %',
      new.student_id, v_batch_id, v_date;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_score_enrollment on public.scores;
create trigger trg_score_enrollment
  before insert or update of assessment_id, student_id
  on public.scores
  for each row
  execute function public.enforce_score_enrollment();

-- ---------------------------------------------------------------------------
-- Publish only when every active roster student has marks or absent
-- ---------------------------------------------------------------------------

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
    from public.enrollments e
    join public.students s on s.id = e.student_id
    where e.batch_id = new.batch_id
      and e.start_date <= new.date
      and (e.end_date is null or e.end_date >= new.date)
      and s.status = 'active'
      and not exists (
        select 1
        from public.scores sc
        where sc.assessment_id = new.id
          and sc.student_id = e.student_id
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

drop trigger if exists trg_assessment_publish_complete on public.assessments;
create trigger trg_assessment_publish_complete
  before update of published
  on public.assessments
  for each row
  execute function public.enforce_assessment_publish_complete();

-- ---------------------------------------------------------------------------
-- Normalize attendance_summary() to month start
-- ---------------------------------------------------------------------------

create or replace function public.attendance_summary(
  p_student_id uuid,
  p_month date
)
returns table(
  total_days integer,
  present_days integer,
  absent_days integer,
  late_days integer,
  leave_days integer,
  attendance_pct numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with bounds as (
    select date_trunc('month', p_month::timestamp)::date as month_start
  )
  select
    count(*)::integer as total_days,
    count(*) filter (where a.status = 'present')::integer as present_days,
    count(*) filter (where a.status = 'absent')::integer as absent_days,
    count(*) filter (where a.status = 'late')::integer as late_days,
    count(*) filter (where a.status = 'leave')::integer as leave_days,
    case when count(*) > 0
      then round(
        (count(*) filter (where a.status in ('present', 'late'))::numeric
          / count(*)::numeric) * 100,
        1
      )
      else 0
    end as attendance_pct
  from public.attendance a, bounds b
  where a.student_id = p_student_id
    and a.date >= b.month_start
    and a.date < (b.month_start + interval '1 month')::date;
$$;

revoke all on function public.attendance_summary(uuid, date) from public;
grant execute on function public.attendance_summary(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Upgrade batches_marked_today (PKT + completeness + overdue)
-- ---------------------------------------------------------------------------

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
      and (now() at time zone 'Asia/Karachi')::time >= public.attendance_cutoff_time()
    then true
    else false
  end as is_overdue
from public.batches b
left join lateral (
  select count(*)::integer as roster_count
  from public.enrollments e
  join public.students s on s.id = e.student_id
  where e.batch_id = b.id
    and e.start_date <= public.pkt_today()
    and (e.end_date is null or e.end_date >= public.pkt_today())
    and s.status = 'active'
) r on true
left join lateral (
  select count(*)::integer as marked_count
  from public.attendance a
  where a.batch_id = b.id
    and a.date = public.pkt_today()
) m on true
where b.active = true;

-- ---------------------------------------------------------------------------
-- Tighten teacher attendance / score policies with enrollment checks
-- ---------------------------------------------------------------------------

drop policy if exists "attendance_teacher_insert" on public.attendance;
create policy "attendance_teacher_insert" on public.attendance
  for insert to authenticated
  with check (
    (select auth_role()) = 'teacher'
    and batch_id in (select auth_teacher_batch_ids())
    and date = public.pkt_today()
    and marked_by = (select auth.uid())
    and public.is_actively_enrolled(student_id, batch_id, date)
  );

drop policy if exists "attendance_teacher_update" on public.attendance;
create policy "attendance_teacher_update" on public.attendance
  for update to authenticated
  using (
    (select auth_role()) = 'teacher'
    and batch_id in (select auth_teacher_batch_ids())
    and date = public.pkt_today()
  )
  with check (
    batch_id in (select auth_teacher_batch_ids())
    and date = public.pkt_today()
    and public.is_actively_enrolled(student_id, batch_id, date)
  );

drop policy if exists "scores_teacher_all" on public.scores;
create policy "scores_teacher_all" on public.scores
  for all to authenticated
  using (
    (select auth_role()) = 'teacher'
    and assessment_id in (
      select a.id from public.assessments a
      where a.batch_id in (select auth_teacher_batch_ids())
    )
  )
  with check (
    assessment_id in (
      select a.id from public.assessments a
      where a.batch_id in (select auth_teacher_batch_ids())
    )
    and exists (
      select 1
      from public.assessments a
      where a.id = assessment_id
        and public.is_actively_enrolled(student_id, a.batch_id, a.date)
    )
  );

-- ---------------------------------------------------------------------------
-- RPCs (SECURITY INVOKER — existing RLS still applies)
-- ---------------------------------------------------------------------------

create or replace function public.save_batch_attendance(
  p_batch_id uuid,
  p_date date,
  p_marks jsonb
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
  v_item jsonb;
  v_student_id uuid;
  v_status public.attendance_status;
  v_saved integer := 0;
begin
  if v_actor is null then
    raise exception 'not authenticated';
  end if;

  if v_role not in ('teacher', 'admin') then
    raise exception 'only teacher or admin can save attendance';
  end if;

  if v_role = 'teacher' and p_date is distinct from public.pkt_today() then
    raise exception 'teachers can only mark attendance for today (PKT)';
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

  if jsonb_typeof(p_marks) <> 'array' then
    raise exception 'p_marks must be a JSON array of {student_id, status}';
  end if;

  for v_item in select * from jsonb_array_elements(p_marks)
  loop
    v_student_id := (v_item ->> 'student_id')::uuid;
    v_status := (v_item ->> 'status')::public.attendance_status;

    if v_student_id is null or v_item ->> 'status' is null then
      raise exception 'each mark requires student_id and status';
    end if;

    if not public.is_actively_enrolled(v_student_id, p_batch_id, p_date) then
      raise exception
        'student % is not actively enrolled in batch % on %',
        v_student_id, p_batch_id, p_date;
    end if;

    insert into public.attendance as a (
      academy_id, student_id, batch_id, date, status, marked_by
    ) values (
      v_academy_id, v_student_id, p_batch_id, p_date, v_status, v_actor
    )
    on conflict (student_id, batch_id, date)
    do update set
      status = excluded.status,
      marked_by = case
        when v_role = 'admin' then a.marked_by
        else excluded.marked_by
      end;

    v_saved := v_saved + 1;
  end loop;

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'date', p_date,
    'saved', v_saved
  );
end;
$$;

revoke all on function public.save_batch_attendance(uuid, date, jsonb) from public;
grant execute on function public.save_batch_attendance(uuid, date, jsonb) to authenticated;
revoke execute on function public.save_batch_attendance(uuid, date, jsonb) from anon;

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
    v_obtained := nullif(v_item ->> 'obtained', '')::numeric;

    if v_student_id is null then
      raise exception 'each score requires student_id';
    end if;

    if v_absent then
      v_obtained := null;
    elsif v_obtained is null then
      raise exception 'obtained is required when absent is false for student %', v_student_id;
    end if;

    insert into public.scores (assessment_id, student_id, obtained, absent)
    values (p_assessment_id, v_student_id, v_obtained, v_absent)
    on conflict (assessment_id, student_id)
    do update set
      obtained = excluded.obtained,
      absent = excluded.absent,
      updated_at = now();

    v_saved := v_saved + 1;
  end loop;

  return jsonb_build_object(
    'assessment_id', p_assessment_id,
    'saved', v_saved
  );
end;
$$;

revoke all on function public.upsert_assessment_scores(uuid, jsonb) from public;
grant execute on function public.upsert_assessment_scores(uuid, jsonb) to authenticated;
revoke execute on function public.upsert_assessment_scores(uuid, jsonb) from anon;

create or replace function public.publish_assessment(
  p_assessment_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_role text := public.auth_role();
  v_assessment public.assessments;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if v_role not in ('teacher', 'admin') then
    raise exception 'only teacher or admin can publish assessments';
  end if;

  select * into v_assessment
  from public.assessments
  where id = p_assessment_id
  for update;

  if not found then
    raise exception 'assessment not found';
  end if;

  if v_role = 'teacher'
     and v_assessment.batch_id not in (select public.auth_teacher_batch_ids()) then
    raise exception 'assessment batch not assigned to this teacher';
  end if;

  if v_assessment.published then
    return jsonb_build_object(
      'assessment_id', p_assessment_id,
      'published', true,
      'already_published', true
    );
  end if;

  update public.assessments
  set published = true,
      updated_at = now()
  where id = p_assessment_id;

  return jsonb_build_object(
    'assessment_id', p_assessment_id,
    'published', true,
    'already_published', false
  );
end;
$$;

revoke all on function public.publish_assessment(uuid) from public;
grant execute on function public.publish_assessment(uuid) to authenticated;
revoke execute on function public.publish_assessment(uuid) from anon;

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
security invoker
set search_path = public
as $$
  select
    v.batch_id,
    v.batch_name,
    v.roster_count,
    v.marked_count,
    v.is_complete,
    v.marked_today,
    v.is_overdue
  from public.batches_marked_today v
  order by v.batch_name;
$$;

revoke all on function public.get_attendance_progress_today() from public;
grant execute on function public.get_attendance_progress_today() to authenticated;
revoke execute on function public.get_attendance_progress_today() from anon;
