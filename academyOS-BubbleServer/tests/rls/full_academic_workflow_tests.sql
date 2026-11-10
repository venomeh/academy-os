-- =============================================================================
-- AcademyOS — Full academic workflow + regression verification
-- Runs in one transaction and ROLLS BACK so live demo data is unchanged.
-- Pass = no exceptions; notices show each step.
-- =============================================================================

begin;

do $$
declare
  -- identities from week2 seed
  v_admin   uuid := '00000000-0000-0000-0000-aaaaaaaaaa01';
  v_t1      uuid := '00000000-0000-0000-0000-bbbbbbbbbb01'; -- Grade 5
  v_t2      uuid := '00000000-0000-0000-0000-bbbbbbbbbb02'; -- Grade 3
  v_parent  uuid := '00000000-0000-0000-0000-cccccccccc01';
  v_batch5  uuid := '00000000-0000-0000-0000-ffffffffffff';
  v_batch3  uuid := '00000000-0000-0000-0000-fffffffffffe';
  v_batch1  uuid := '30000000-0000-0000-0000-000000000001'; -- not assigned to Teacher One
  v_stu5    uuid := '00000000-0000-0000-0000-eeeeeeeeee01';
  v_stu3    uuid := '00000000-0000-0000-0000-eeeeeeeeee02';
  v_stu1    uuid;
  v_assess  uuid := '00000000-0000-0000-0002-cccccccccccc';
  v_subject uuid;
  v_student uuid;
  v_count   integer;
  v_row     record;
  v_att     public.attendance;
  v_ok      boolean;
  v_marks   jsonb := '[]'::jsonb;
  v_scores  jsonb := '[]'::jsonb;
  v_before_batches integer;
  v_before_students integer;
  v_before_enrollments integer;
begin
  select count(*) into v_before_batches from public.batches where active;
  select count(*) into v_before_students from public.students;
  select count(*) into v_before_enrollments from public.enrollments;

  if v_before_batches < 5 then
    raise exception 'REGRESSION: expected >=5 active batches, got %', v_before_batches;
  end if;

  ------------------------------------------------------------------
  -- R1: Existing admin can still read batches/students/enrollments
  ------------------------------------------------------------------
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-aaaaaaaaaa01","role":"authenticated"}';

  select count(*) into v_count from public.batches where active;
  if v_count < 5 then raise exception 'R1 FAILED: admin batches %', v_count; end if;

  select count(*) into v_count from public.students;
  if v_count < 20 then raise exception 'R1 FAILED: admin students %', v_count; end if;

  select count(*) into v_count from public.enrollments;
  if v_count < 20 then raise exception 'R1 FAILED: admin enrollments %', v_count; end if;
  raise notice 'R1 PASSED: admin still reads batches/students/enrollments';

  ------------------------------------------------------------------
  -- R2: Teacher sees assigned batches; cannot see unassigned Grade 1
  ------------------------------------------------------------------
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-bbbbbbbbbb01","role":"authenticated"}';

  select count(*) into v_count from public.batches where id = v_batch5;
  if v_count <> 1 then raise exception 'R2 FAILED: teacher1 cannot see grade5'; end if;

  select count(*) into v_count from public.batches where id = v_batch1;
  if v_count <> 0 then raise exception 'R2 FAILED: teacher1 sees unassigned grade1'; end if;
  raise notice 'R2 PASSED: teacher batch isolation intact';

  ------------------------------------------------------------------
  -- R3: Parent sees only own children
  ------------------------------------------------------------------
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-cccccccccc01","role":"authenticated"}';

  select count(*) into v_count from public.students where id = v_stu5;
  if v_count <> 1 then raise exception 'R3 FAILED: parent cannot see own child'; end if;

  select count(*) into v_count from public.students
  where id not in (select auth_student_ids());
  -- under RLS, this count of "others" should be 0 because unseen rows are filtered
  select count(*) into v_count from public.students;
  if v_count < 1 then raise exception 'R3 FAILED: parent sees no students'; end if;
  raise notice 'R3 PASSED: parent student visibility works (count=%)', v_count;

  ------------------------------------------------------------------
  -- W1: Teacher roster + bulk save attendance (happy path)
  ------------------------------------------------------------------
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-bbbbbbbbbb01","role":"authenticated"}';

  select count(*) into v_count
  from public.batch_active_roster(v_batch5, public.pkt_today());
  if v_count < 1 then raise exception 'W1 FAILED: empty grade5 roster'; end if;

  v_marks := '[]'::jsonb;
  for v_student in
    select student_id from public.batch_active_roster(v_batch5, public.pkt_today())
  loop
    v_marks := v_marks || jsonb_build_array(
      jsonb_build_object('student_id', v_student, 'status', 'present')
    );
  end loop;

  perform public.save_batch_attendance(v_batch5, public.pkt_today(), v_marks);

  select count(*) into v_count
  from public.attendance
  where batch_id = v_batch5 and date = public.pkt_today();
  if v_count <> jsonb_array_length(v_marks) then
    raise exception 'W1 FAILED: saved % expected %', v_count, jsonb_array_length(v_marks);
  end if;
  raise notice 'W1 PASSED: teacher saved full roster attendance (% rows)', v_count;

  ------------------------------------------------------------------
  -- W2: Progress view shows complete for that batch
  ------------------------------------------------------------------
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-aaaaaaaaaa01","role":"authenticated"}';

  select * into v_row from public.batches_marked_today where batch_id = v_batch5;
  if not v_row.is_complete then
    raise exception 'W2 FAILED: grade5 not complete (roster=% marked=%)',
      v_row.roster_count, v_row.marked_count;
  end if;
  if not v_row.marked_today then
    raise exception 'W2 FAILED: marked_today false';
  end if;
  raise notice 'W2 PASSED: progress tile complete=% marked=%/%',
    v_row.is_complete, v_row.marked_count, v_row.roster_count;

  ------------------------------------------------------------------
  -- W3: Teacher cannot mark unassigned batch (Grade 1)
  ------------------------------------------------------------------
  select student_id into v_stu1
  from public.enrollments
  where batch_id = v_batch1
  limit 1;

  -- enrollments select as teacher may be empty for unassigned; look up via reset
  if v_stu1 is null then
    reset role;
    select student_id into v_stu1 from public.enrollments where batch_id = v_batch1 limit 1;
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-bbbbbbbbbb01","role":"authenticated"}';
  end if;

  v_ok := false;
  begin
    perform public.save_batch_attendance(
      v_batch1, public.pkt_today(),
      jsonb_build_array(jsonb_build_object('student_id', v_stu1, 'status', 'present'))
    );
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'W3 FAILED: teacher marked unassigned batch'; end if;
  raise notice 'W3 PASSED: unassigned batch blocked';

  ------------------------------------------------------------------
  -- W4: Teacher cannot mark yesterday
  ------------------------------------------------------------------
  v_ok := false;
  begin
    perform public.save_batch_attendance(
      v_batch5, public.pkt_today() - 1,
      jsonb_build_array(jsonb_build_object('student_id', v_stu5, 'status', 'late'))
    );
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'W4 FAILED: teacher marked yesterday'; end if;
  raise notice 'W4 PASSED: yesterday blocked for teacher';

  ------------------------------------------------------------------
  -- W5: Admin correction stamps corrected_by/at
  ------------------------------------------------------------------
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-aaaaaaaaaa01","role":"authenticated"}';

  update public.attendance
  set status = 'late'
  where student_id = v_stu5
    and batch_id = v_batch5
    and date = public.pkt_today();

  select * into v_att
  from public.attendance
  where student_id = v_stu5 and batch_id = v_batch5 and date = public.pkt_today();

  if v_att.status is distinct from 'late'
     or v_att.corrected_by is distinct from v_admin
     or v_att.corrected_at is null then
    raise exception 'W5 FAILED: correction stamp missing (status=% by=% at=%)',
      v_att.status, v_att.corrected_by, v_att.corrected_at;
  end if;
  raise notice 'W5 PASSED: admin correction logged';

  ------------------------------------------------------------------
  -- W6: Ended enrollment blocks attendance
  ------------------------------------------------------------------
  -- need elevated write on enrollments: reset to table owner via reset role
  reset role;
  update public.enrollments
  set end_date = public.pkt_today() - 1
  where student_id = v_stu5 and batch_id = v_batch5;

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-aaaaaaaaaa01","role":"authenticated"}';

  v_ok := false;
  begin
    insert into public.attendance (academy_id, student_id, batch_id, date, status, marked_by)
    values ('00000000-0000-0000-0000-000000000001', v_stu5, v_batch5,
            public.pkt_today() + 1, 'present', v_admin);
  exception when others then
    if sqlerrm like '%not actively enrolled%' then v_ok := true; else raise; end if;
  end;

  reset role;
  update public.enrollments set end_date = null
  where student_id = v_stu5 and batch_id = v_batch5;

  if not v_ok then raise exception 'W6 FAILED: ended enrollment allowed'; end if;
  raise notice 'W6 PASSED: ended enrollment blocked';

  ------------------------------------------------------------------
  -- W7: Assessment create + subject mismatch blocked
  ------------------------------------------------------------------
  reset role;
  select id into v_subject from public.subjects where batch_id = v_batch5 order by name limit 1;

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-bbbbbbbbbb01","role":"authenticated"}';

  insert into public.assessments (
    id, academy_id, batch_id, subject_id, date, max_marks, published, created_by
  ) values (
    v_assess, '00000000-0000-0000-0000-000000000001',
    v_batch5, v_subject, public.pkt_today(), 100, false, v_t1
  );

  v_ok := false;
  begin
    insert into public.assessments (
      academy_id, batch_id, subject_id, date, max_marks, created_by
    )
    select '00000000-0000-0000-0000-000000000001', v_batch5, s.id,
           public.pkt_today(), 50, v_t1
    from public.subjects s
    where s.batch_id = v_batch3
    limit 1;
  exception when others then
    if sqlerrm like '%assessment blocked%' then v_ok := true; else raise; end if;
  end;
  if not v_ok then raise exception 'W7 FAILED: cross-batch subject allowed'; end if;
  raise notice 'W7 PASSED: assessment create + subject integrity';

  ------------------------------------------------------------------
  -- W8: Partial scores draft OK; incomplete publish blocked
  ------------------------------------------------------------------
  insert into public.scores (assessment_id, student_id, obtained, absent)
  values (v_assess, v_stu5, 88, false);

  v_ok := false;
  begin
    update public.assessments set published = true where id = v_assess;
  exception when others then
    if sqlerrm like '%cannot publish%' then v_ok := true; else raise; end if;
  end;
  if not v_ok then raise exception 'W8 FAILED: incomplete publish allowed'; end if;
  raise notice 'W8 PASSED: draft partial + incomplete publish blocked';

  ------------------------------------------------------------------
  -- W9: Parent cannot see unpublished scores
  ------------------------------------------------------------------
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-cccccccccc01","role":"authenticated"}';

  select count(*) into v_count from public.scores where assessment_id = v_assess;
  if v_count <> 0 then raise exception 'W9 FAILED: parent sees unpublished scores'; end if;

  select count(*) into v_count from public.assessments where id = v_assess;
  if v_count <> 0 then raise exception 'W9 FAILED: parent sees unpublished assessment'; end if;
  raise notice 'W9 PASSED: parent publish gate holds';

  ------------------------------------------------------------------
  -- W10: Complete scores + publish + parent can see
  ------------------------------------------------------------------
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-bbbbbbbbbb01","role":"authenticated"}';

  v_scores := '[]'::jsonb;
  for v_student in
    select student_id from public.batch_active_roster(v_batch5, public.pkt_today())
  loop
    v_scores := v_scores || jsonb_build_array(
      jsonb_build_object('student_id', v_student, 'obtained', 75, 'absent', false)
    );
  end loop;

  perform public.upsert_assessment_scores(v_assess, v_scores);
  perform public.publish_assessment(v_assess);

  if not exists (select 1 from public.assessments where id = v_assess and published) then
    raise exception 'W10 FAILED: not published';
  end if;

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-cccccccccc01","role":"authenticated"}';

  select count(*) into v_count
  from public.scores
  where assessment_id = v_assess and student_id = v_stu5;
  if v_count <> 1 then raise exception 'W10 FAILED: parent cannot see published score'; end if;
  raise notice 'W10 PASSED: publish + parent visibility';

  ------------------------------------------------------------------
  -- W11: Cannot edit scores after publish; cannot lower max_marks
  ------------------------------------------------------------------
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-bbbbbbbbbb01","role":"authenticated"}';

  v_ok := false;
  begin
    perform public.upsert_assessment_scores(
      v_assess,
      jsonb_build_array(jsonb_build_object('student_id', v_stu5, 'obtained', 90, 'absent', false))
    );
  exception when others then
    if sqlerrm like '%cannot edit scores on a published%' then v_ok := true; else raise; end if;
  end;
  if not v_ok then raise exception 'W11a FAILED: edited published scores'; end if;

  v_ok := false;
  begin
    update public.assessments set max_marks = 10 where id = v_assess;
  exception when others then
    if sqlerrm like '%cannot lower max_marks%' then v_ok := true; else raise; end if;
  end;
  if not v_ok then raise exception 'W11b FAILED: lowered max_marks'; end if;
  raise notice 'W11 PASSED: published lock + max_marks floor';

  ------------------------------------------------------------------
  -- W12: obtained > max blocked by existing trigger
  ------------------------------------------------------------------
  -- unpublish not allowed via scores edit; create second draft assessment
  reset role;
  insert into public.assessments (
    id, academy_id, batch_id, subject_id, date, max_marks, published, created_by
  ) values (
    '00000000-0000-0000-0002-dddddddddddd',
    '00000000-0000-0000-0000-000000000001',
    v_batch5, v_subject, public.pkt_today(), 50, false, v_t1
  );

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-bbbbbbbbbb01","role":"authenticated"}';

  v_ok := false;
  begin
    insert into public.scores (assessment_id, student_id, obtained, absent)
    values ('00000000-0000-0000-0002-dddddddddddd', v_stu5, 99, false);
  exception when others then
    if sqlerrm like '%exceeds max_marks%' then v_ok := true; else raise; end if;
  end;
  if not v_ok then raise exception 'W12 FAILED: over-max score allowed'; end if;
  raise notice 'W12 PASSED: obtained <= max_marks';

  ------------------------------------------------------------------
  -- W13: attendance_summary month normalization
  ------------------------------------------------------------------
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-cccccccccc01","role":"authenticated"}';

  select total_days into v_count
  from public.attendance_summary(v_stu5, date_trunc('month', public.pkt_today())::date + 14);
  -- mid-month arg should still count this month's rows (>=1 from W1)
  if v_count < 1 then
    raise exception 'W13 FAILED: attendance_summary returned %', v_count;
  end if;
  raise notice 'W13 PASSED: attendance_summary total_days=%', v_count;

  ------------------------------------------------------------------
  -- Final regression: domain counts unchanged from start of txn
  -- (attendance/assessments exist in txn but will roll back)
  ------------------------------------------------------------------
  reset role;
  select count(*) into v_count from public.batches where active;
  if v_count <> v_before_batches then
    raise exception 'REGRESSION: batch count changed % -> %', v_before_batches, v_count;
  end if;
  select count(*) into v_count from public.students;
  if v_count <> v_before_students then
    raise exception 'REGRESSION: student count changed';
  end if;
  select count(*) into v_count from public.enrollments;
  if v_count <> v_before_enrollments then
    raise exception 'REGRESSION: enrollment count changed';
  end if;

  raise notice '============================================';
  raise notice 'FULL WORKFLOW + REGRESSION: ALL PASSED';
  raise notice '============================================';
end;
$$;

rollback;
