-- Demo academic data for portal testing (attendance, published tests, remarks).
-- Idempotent. Leaves PKT today (2026-08-25) unmarked so teachers can still save attendance.

begin;

-- Test-roster students joined in August would always flag low_data. Backdate join
-- so Teacher One/Two queues show real draft text. Keep Zara Pervez as mid-month.
update public.students
set joined_at = timestamp '2026-07-01'
where id in (
  '2159da60-6edf-431f-b465-2e81dd084721', -- tester student 1
  'dba283d1-1b93-4c2f-be4c-c5bc254e81eb', -- tester student 2
  '7bff541c-668b-44b1-8751-68088211c597', -- tester student
  'aa74ca5b-16a6-4bd7-85cc-4d258b2e429f', -- Test B1
  '517fe562-6f8e-4313-b4aa-5860c8cdba4f', -- Test B2
  '6cd99d69-c778-45df-8077-801adee0a30e', -- Test B3
  '662c2e3b-f31d-4476-8810-02fab5edebea', -- Test B4
  'e1b7567d-b7ea-4092-a1a4-83cf0092ef95', -- Test B5
  '4d93de32-09a9-49de-be94-666adcdd888c', -- Test A1
  '65d4cac5-eee7-4098-8edd-0093eb5f6572', -- Test A2
  '26f3732b-3bc5-410c-965c-538d4aaac6ee', -- Test A3
  'd999494a-c0aa-4cef-9278-ad056df7ff46', -- Test A4
  'e64becd2-3fa1-4483-a672-785462811f99'  -- Test A5
);

-- ---------------------------------------------------------------------------
-- Attendance: weekdays 3–24 Aug 2026, skip the 25th
-- ---------------------------------------------------------------------------
insert into public.attendance (
  academy_id, student_id, batch_id, date, status, marked_by
)
select
  '00000000-0000-0000-0000-000000000001'::uuid,
  e.student_id,
  e.batch_id,
  d.day,
  case abs(hashtext(e.student_id::text || d.day::text)) % 10
    when 0 then 'absent'::public.attendance_status
    when 1 then 'late'::public.attendance_status
    when 2 then 'leave'::public.attendance_status
    else 'present'::public.attendance_status
  end,
  coalesce(
    (
      select bt.teacher_id
      from public.batch_teachers bt
      where bt.batch_id = e.batch_id
      order by bt.created_at
      limit 1
    ),
    '00000000-0000-0000-0000-aaaaaaaaaa01'::uuid
  )
from public.enrollments e
join public.students s on s.id = e.student_id
join lateral (
  select gs::date as day
  from generate_series(date '2026-08-03', date '2026-08-24', interval '1 day') gs
  where extract(dow from gs) between 1 and 5
) d on true
where s.status = 'active'
  and e.start_date <= d.day
  and (e.end_date is null or e.end_date >= d.day)
on conflict (student_id, batch_id, date) do nothing;

-- ---------------------------------------------------------------------------
-- One published 50-mark test per batch on 21 Aug 2026
-- ---------------------------------------------------------------------------
delete from public.scores
where assessment_id in (
  select id from public.assessments
  where id in (
    '82026082-0000-4000-a000-000000000001'::uuid,
    '82026082-0000-4000-a000-fffffffffffe'::uuid,
    '82026082-0000-4000-a000-ffffffffffff'::uuid,
    '82026082-0000-4000-a000-000000000004'::uuid,
    '82026082-0000-4000-a000-000000000006'::uuid,
    '82026082-0000-4000-a000-3bdb561c341b'::uuid,
    '82026082-0000-4000-a000-63fa60f0d45a'::uuid,
    '82026082-0000-4000-a000-6f9fea40cf62'::uuid
  )
);

delete from public.assessments
where id in (
  '82026082-0000-4000-a000-000000000001'::uuid,
  '82026082-0000-4000-a000-fffffffffffe'::uuid,
  '82026082-0000-4000-a000-ffffffffffff'::uuid,
  '82026082-0000-4000-a000-000000000004'::uuid,
  '82026082-0000-4000-a000-000000000006'::uuid,
  '82026082-0000-4000-a000-3bdb561c341b'::uuid,
  '82026082-0000-4000-a000-63fa60f0d45a'::uuid,
  '82026082-0000-4000-a000-6f9fea40cf62'::uuid
);

insert into public.assessments (
  id, academy_id, batch_id, subject_id, date, max_marks, published, created_by
)
select
  ('82026082-0000-4000-a000-' || right(b.id::text, 12))::uuid,
  b.academy_id,
  b.id,
  sub.subject_id,
  date '2026-08-21',
  50,
  false,
  '00000000-0000-0000-0000-aaaaaaaaaa01'::uuid
from public.batches b
join lateral (
  select s.id as subject_id
  from public.subjects s
  where s.batch_id = b.id
  order by s.name
  limit 1
) sub on true;

insert into public.scores (assessment_id, student_id, obtained, absent)
select
  a.id,
  e.student_id,
  case
    when abs(hashtext(e.student_id::text || a.id::text)) % 11 = 0 then null
    else (32 + abs(hashtext(e.student_id::text)) % 18)::numeric
  end,
  abs(hashtext(e.student_id::text || a.id::text)) % 11 = 0
from public.assessments a
join public.enrollments e
  on e.batch_id = a.batch_id
 and e.start_date <= a.date
 and (e.end_date is null or e.end_date >= a.date)
join public.students s on s.id = e.student_id and s.status = 'active'
where a.id in (
  '82026082-0000-4000-a000-000000000001'::uuid,
  '82026082-0000-4000-a000-fffffffffffe'::uuid,
  '82026082-0000-4000-a000-ffffffffffff'::uuid,
  '82026082-0000-4000-a000-000000000004'::uuid,
  '82026082-0000-4000-a000-000000000006'::uuid,
  '82026082-0000-4000-a000-3bdb561c341b'::uuid,
  '82026082-0000-4000-a000-63fa60f0d45a'::uuid,
  '82026082-0000-4000-a000-6f9fea40cf62'::uuid
)
on conflict (assessment_id, student_id) do update
  set obtained = excluded.obtained,
      absent = excluded.absent;

update public.assessments
set published = true
where id in (
  '82026082-0000-4000-a000-000000000001'::uuid,
  '82026082-0000-4000-a000-fffffffffffe'::uuid,
  '82026082-0000-4000-a000-ffffffffffff'::uuid,
  '82026082-0000-4000-a000-000000000004'::uuid,
  '82026082-0000-4000-a000-000000000006'::uuid,
  '82026082-0000-4000-a000-3bdb561c341b'::uuid,
  '82026082-0000-4000-a000-63fa60f0d45a'::uuid,
  '82026082-0000-4000-a000-6f9fea40cf62'::uuid
);

-- ---------------------------------------------------------------------------
-- August remarks: mix of approved (parent-visible), draft (teacher queue), rejected
-- ---------------------------------------------------------------------------
with roster as (
  select distinct s.id as student_id, s.name, s.academy_id
  from public.students s
  join public.enrollments e on e.student_id = s.id
  where s.status = 'active'
    and e.start_date <= date '2026-08-31'
    and (e.end_date is null or e.end_date >= date '2026-08-01')
),
classified as (
  select
    r.*,
    case r.student_id
      -- Parent A: visible immediately
      when '00000000-0000-0000-0000-eeeeeeeeee02' then 'approved' -- Sara Ali
      when 'dba283d1-1b93-4c2f-be4c-c5bc254e81eb' then 'approved' -- tester student 2
      when '4d93de32-09a9-49de-be94-666adcdd888c' then 'approved' -- Test A1
      when 'aa74ca5b-16a6-4bd7-85cc-4d258b2e429f' then 'approved' -- Test B1
      when '7bff541c-668b-44b1-8751-68088211c597' then 'approved' -- tester student
      -- Parent A: still in teacher queue
      when '00000000-0000-0000-0000-eeeeeeeeee01' then 'draft'    -- Ahmed Ali
      when '65d4cac5-eee7-4098-8edd-0093eb5f6572' then 'draft'    -- Test A2
      -- Parent A: skip mail
      when '26f3732b-3bc5-410c-965c-538d4aaac6ee' then 'rejected' -- Test A3
      when '517fe562-6f8e-4313-b4aa-5860c8cdba4f' then 'rejected' -- Test B2
      -- Parent B
      when '00000000-0000-0000-0000-eeeeeeeeee03' then 'approved' -- Hassan Khan
      when '00000000-0000-0000-0000-eeeeeeeeee04' then 'draft'    -- Noor Khan
      -- Mid-month genuine low_data
      when '1e20ad74-09de-4991-85fa-90521b3cbcd8' then 'low_data' -- Zara Pervez G8
      else 'draft'
    end as status
  from roster r
)
insert into public.remarks (
  academy_id, student_id, period, draft_text, final_text, language, status,
  approved_by, approved_at
)
select
  c.academy_id,
  c.student_id,
  date '2026-08-01',
  case c.status
    when 'low_data' then 'Joined mid-month'
    else
      c.name || ' had a solid August in class. Attendance was recorded on most weekdays, '
      || 'and the 21 Aug test was completed. Please keep a regular revision routine at home.'
  end,
  case c.status
    when 'approved' then
      c.name || ' had a solid August in class. Attendance was recorded on most weekdays, '
      || 'and the 21 Aug test was completed. Please keep a regular revision routine at home.'
    when 'rejected' then
      c.name || ' — teacher skipped this month. Not for parents.'
    else null
  end,
  'en'::public.language_pref,
  c.status::public.remark_status,
  case when c.status = 'approved' then '00000000-0000-0000-0000-bbbbbbbbbb01'::uuid else null end,
  case when c.status = 'approved' then now() else null end
from classified c
on conflict (student_id, period) do update
  set draft_text = excluded.draft_text,
      final_text = excluded.final_text,
      language = excluded.language,
      status = excluded.status,
      approved_by = excluded.approved_by,
      approved_at = excluded.approved_at;

commit;
