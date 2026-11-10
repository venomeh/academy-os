-- =============================================================================
-- AcademyOS — Academic integrity negative tests
-- Run after academic_integrity_hardening migration (single transaction preferred).
-- Uses Week 2 seed UUIDs. Pass = no exceptions raised.
-- =============================================================================

-- Fixed test assessment id
--   00000000-0000-0000-0002-bbbbbbbbbbbb

begin;

-- ---------------------------------------------------------------------------
-- SETUP
-- ---------------------------------------------------------------------------
do $$
declare
  v_subject_g5 uuid;
begin
  update public.enrollments
  set end_date = public.pkt_today() - 1
  where student_id = '00000000-0000-0000-0000-eeeeeeeeee01'
    and batch_id = '00000000-0000-0000-0000-ffffffffffff';

  select id into v_subject_g5 from public.subjects
  where batch_id = '00000000-0000-0000-0000-ffffffffffff'
  order by name limit 1;

  if v_subject_g5 is null then
    raise exception 'SETUP FAILED: missing Grade 5 subject';
  end if;

  insert into public.assessments (
    id, academy_id, batch_id, subject_id, date, max_marks, published, created_by
  ) values (
    '00000000-0000-0000-0002-bbbbbbbbbbbb',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-ffffffffffff',
    v_subject_g5,
    public.pkt_today(),
    100,
    false,
    '00000000-0000-0000-0000-aaaaaaaaaa01'
  )
  on conflict (id) do update set
    published = false,
    max_marks = 100,
    subject_id = excluded.subject_id,
    date = excluded.date;
end;
$$;

-- A1: ended enrollment blocks attendance
do $$
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-aaaaaaaaaa01","role":"authenticated"}';

  begin
    insert into public.attendance (
      academy_id, student_id, batch_id, date, status, marked_by
    ) values (
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-eeeeeeeeee01',
      '00000000-0000-0000-0000-ffffffffffff',
      public.pkt_today(),
      'present',
      '00000000-0000-0000-0000-aaaaaaaaaa01'
    );
    raise exception 'TEST A1 FAILED: attendance allowed for ended enrollment';
  exception when others then
    if sqlerrm like 'TEST A1 FAILED%' then raise; end if;
    if sqlerrm not like '%not actively enrolled%' then
      raise exception 'TEST A1 FAILED: unexpected error: %', sqlerrm;
    end if;
    raise notice 'TEST A1 PASSED: ended enrollment blocks attendance';
  end;
end;
$$;

-- A2: cross-batch subject blocked
do $$
declare
  v_subject_g3 uuid;
begin
  select id into v_subject_g3 from public.subjects
  where batch_id = '00000000-0000-0000-0000-fffffffffffe'
  order by name limit 1;

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-aaaaaaaaaa01","role":"authenticated"}';

  begin
    insert into public.assessments (
      academy_id, batch_id, subject_id, date, max_marks, created_by
    ) values (
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-ffffffffffff',
      v_subject_g3,
      public.pkt_today(),
      50,
      '00000000-0000-0000-0000-aaaaaaaaaa01'
    );
    raise exception 'TEST A2 FAILED: cross-batch subject allowed';
  exception when others then
    if sqlerrm like 'TEST A2 FAILED%' then raise; end if;
    if sqlerrm not like '%assessment blocked%' then
      raise exception 'TEST A2 FAILED: unexpected error: %', sqlerrm;
    end if;
    raise notice 'TEST A2 PASSED: cross-batch subject blocked';
  end;
end;
$$;

-- A3: cross-batch score blocked
do $$
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-aaaaaaaaaa01","role":"authenticated"}';

  begin
    insert into public.scores (assessment_id, student_id, obtained, absent)
    values (
      '00000000-0000-0000-0002-bbbbbbbbbbbb',
      '00000000-0000-0000-0000-eeeeeeeeee02',
      80, false
    );
    raise exception 'TEST A3 FAILED: cross-batch score allowed';
  exception when others then
    if sqlerrm like 'TEST A3 FAILED%' then raise; end if;
    if sqlerrm not like '%not actively enrolled%' and sqlerrm not like '%score blocked%' then
      raise exception 'TEST A3 FAILED: unexpected error: %', sqlerrm;
    end if;
    raise notice 'TEST A3 PASSED: cross-batch score blocked';
  end;
end;
$$;

-- A4: incomplete publish blocked; complete publish works
do $$
declare
  v_assessment uuid := '00000000-0000-0000-0002-bbbbbbbbbbbb';
  v_student uuid;
  v_count integer := 0;
begin
  -- Restore enrollment for roster completeness
  update public.enrollments
  set end_date = null
  where student_id = '00000000-0000-0000-0000-eeeeeeeeee01'
    and batch_id = '00000000-0000-0000-0000-ffffffffffff';

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-aaaaaaaaaa01","role":"authenticated"}';

  begin
    update public.assessments set published = true where id = v_assessment;
    raise exception 'TEST A4 FAILED: incomplete publish allowed';
  exception when others then
    if sqlerrm like 'TEST A4 FAILED%' then raise; end if;
    if sqlerrm not like '%cannot publish%' then
      raise exception 'TEST A4 FAILED: unexpected error: %', sqlerrm;
    end if;
    raise notice 'TEST A4a PASSED: incomplete publish blocked';
  end;

  -- Fill scores for full active roster, then publish as admin JWT
  for v_student in
    select student_id from public.batch_active_roster(
      '00000000-0000-0000-0000-ffffffffffff', public.pkt_today()
    )
  loop
    insert into public.scores (assessment_id, student_id, obtained, absent)
    values (v_assessment, v_student, 70, false)
    on conflict (assessment_id, student_id) do update
      set obtained = 70, absent = false;
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'TEST A4 FAILED: empty roster unexpectedly';
  end if;

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-aaaaaaaaaa01","role":"authenticated"}';
  perform public.publish_assessment(v_assessment);

  if not exists (
    select 1 from public.assessments where id = v_assessment and published = true
  ) then
    raise exception 'TEST A4 FAILED: publish_assessment did not publish';
  end if;

  raise notice 'TEST A4b PASSED: complete publish succeeds (% students)', v_count;
end;
$$;

-- A5: max_marks floor
do $$
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-aaaaaaaaaa01","role":"authenticated"}';

  begin
    update public.assessments
    set max_marks = 50
    where id = '00000000-0000-0000-0002-bbbbbbbbbbbb';
    raise exception 'TEST A5 FAILED: lowered max_marks below scores';
  exception when others then
    if sqlerrm like 'TEST A5 FAILED%' then raise; end if;
    if sqlerrm not like '%cannot lower max_marks%' then
      raise exception 'TEST A5 FAILED: unexpected error: %', sqlerrm;
    end if;
    raise notice 'TEST A5 PASSED: max_marks floor enforced';
  end;
end;
$$;

-- A6: admin correction stamp
do $$
declare
  v_student uuid;
  v_row public.attendance;
begin
  select student_id into v_student
  from public.batch_active_roster(
    '00000000-0000-0000-0000-ffffffffffff', public.pkt_today()
  )
  limit 1;

  if v_student is null then
    raise exception 'TEST A6 FAILED: no roster student';
  end if;

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-bbbbbbbbbb01","role":"authenticated"}';

  perform public.save_batch_attendance(
    '00000000-0000-0000-0000-ffffffffffff',
    public.pkt_today(),
    jsonb_build_array(jsonb_build_object('student_id', v_student, 'status', 'present'))
  );

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-aaaaaaaaaa01","role":"authenticated"}';

  update public.attendance
  set status = 'late'
  where student_id = v_student
    and batch_id = '00000000-0000-0000-0000-ffffffffffff'
    and date = public.pkt_today();

  select * into v_row
  from public.attendance
  where student_id = v_student
    and batch_id = '00000000-0000-0000-0000-ffffffffffff'
    and date = public.pkt_today();

  if v_row.corrected_by is distinct from '00000000-0000-0000-0000-aaaaaaaaaa01'
     or v_row.corrected_at is null
     or v_row.status is distinct from 'late' then
    raise exception
      'TEST A6 FAILED: correction not stamped (by=%, at=%, status=%)',
      v_row.corrected_by, v_row.corrected_at, v_row.status;
  end if;

  raise notice 'TEST A6 PASSED: admin correction stamped';
end;
$$;

-- A7: teacher RPC blocked for other batch
do $$
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-bbbbbbbbbb01","role":"authenticated"}';

  begin
    perform public.save_batch_attendance(
      '00000000-0000-0000-0000-fffffffffffe',
      public.pkt_today(),
      jsonb_build_array(jsonb_build_object(
        'student_id', '00000000-0000-0000-0000-eeeeeeeeee02',
        'status', 'present'
      ))
    );
    raise exception 'TEST A7 FAILED: teacher saved unassigned batch';
  exception when others then
    if sqlerrm like 'TEST A7 FAILED%' then raise; end if;
    raise notice 'TEST A7 PASSED: teacher RPC blocked for unassigned batch';
  end;
end;
$$;

-- A8: progress view completeness
do $$
declare
  v_row record;
  v_roster integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-aaaaaaaaaa01","role":"authenticated"}';

  select * into v_row
  from public.batches_marked_today
  where batch_id = '00000000-0000-0000-0000-ffffffffffff';

  select count(*)::integer into v_roster
  from public.batch_active_roster(
    '00000000-0000-0000-0000-ffffffffffff', public.pkt_today()
  );

  if v_row.roster_count is distinct from v_roster then
    raise exception 'TEST A8 FAILED: roster_count mismatch (% vs %)',
      v_row.roster_count, v_roster;
  end if;

  if v_roster > 1 and v_row.is_complete then
    raise exception 'TEST A8 FAILED: is_complete true with partial marks';
  end if;

  if v_row.marked_count < 1 then
    raise exception 'TEST A8 FAILED: marked_count expected >= 1';
  end if;

  raise notice 'TEST A8 PASSED: progress view roster=% marked=% complete=%',
    v_row.roster_count, v_row.marked_count, v_row.is_complete;
end;
$$;

-- CLEANUP
delete from public.scores where assessment_id = '00000000-0000-0000-0002-bbbbbbbbbbbb';
delete from public.assessments where id = '00000000-0000-0000-0002-bbbbbbbbbbbb';
delete from public.attendance
where batch_id = '00000000-0000-0000-0000-ffffffffffff'
  and date = public.pkt_today();
update public.enrollments
set end_date = null
where student_id = '00000000-0000-0000-0000-eeeeeeeeee01'
  and batch_id = '00000000-0000-0000-0000-ffffffffffff';

do $$
begin
  raise notice '============================================';
  raise notice 'ACADEMIC INTEGRITY TESTS A1-A8 PASSED';
  raise notice '============================================';
end;
$$;

rollback;
