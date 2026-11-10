-- =============================================================================
-- AcademyOS — RLS Negative Test Suite
-- Run after every migration. Pass = no exceptions raised.
-- Uses PostgREST impersonation: set local role + jwt claims.
--
-- PREREQUISITE: Test seed must exist (run seed_test_data.sql first).
--
-- UUID Reference (all valid hex):
--   Academy:     00000000-0000-0000-0000-000000000001
--   Admin:       00000000-0000-0000-0000-aaaaaaaaaa01
--   Teacher 1:   00000000-0000-0000-0000-bbbbbbbbbb01  (assigned to batch1)
--   Teacher 2:   00000000-0000-0000-0000-bbbbbbbbbb02  (assigned to batch2)
--   Parent A:    00000000-0000-0000-0000-cccccccccc01
--   Parent B:    00000000-0000-0000-0000-cccccccccc02
--   Guardian A:  00000000-0000-0000-0000-dddddddddd01
--   Guardian B:  00000000-0000-0000-0000-dddddddddd02
--   Student A1:  00000000-0000-0000-0000-eeeeeeeeee01  (batch1, guardian A)
--   Student A2:  00000000-0000-0000-0000-eeeeeeeeee02  (batch2, guardian A)
--   Student B1:  00000000-0000-0000-0000-eeeeeeeeee03  (batch1, guardian B)
--   Batch 1:     00000000-0000-0000-0000-ffffffffffff
--   Batch 2:     00000000-0000-0000-0000-fffffffffffe
--   Assessment (published):   00000000-0000-0000-0002-aaaaaaaaaaaa
--   Assessment (unpublished): 00000000-0000-0000-0002-aaaaaaaaaaab
--   Voucher A:   00000000-0000-0000-0003-aaaaaaaaaaaa
--   Voucher B:   00000000-0000-0000-0003-aaaaaaaaaaab
--   Chat A:      00000000-0000-0000-0005-aaaaaaaaaaaa
--   Chat B:      00000000-0000-0000-0005-aaaaaaaaaaab
-- =============================================================================


-- ---------------------------------------------------------------------------
-- TESTS 1-4: Parent A cannot see Family B's core data
-- ---------------------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-cccccccccc01","role":"authenticated"}';

  -- TEST 1: Family B students
  select count(*) into v_count from students where guardian_id = '00000000-0000-0000-0000-dddddddddd02';
  if v_count > 0 then raise exception 'TEST 1 FAILED: Parent A sees Family B students (%)' , v_count; end if;
  raise notice 'TEST 1 PASSED: Parent A cannot see Family B students';

  -- TEST 2: Family B vouchers
  select count(*) into v_count from vouchers where id = '00000000-0000-0000-0003-aaaaaaaaaaab';
  if v_count > 0 then raise exception 'TEST 2 FAILED: Parent A sees Family B vouchers (%)' , v_count; end if;
  raise notice 'TEST 2 PASSED: Parent A cannot see Family B vouchers';

  -- TEST 3: Family B ledger
  select count(*) into v_count from ledger_entries where guardian_id = '00000000-0000-0000-0000-dddddddddd02';
  if v_count > 0 then raise exception 'TEST 3 FAILED: Parent A sees Family B ledger (%)' , v_count; end if;
  raise notice 'TEST 3 PASSED: Parent A cannot see Family B ledger entries';

  -- TEST 4: Family B attendance
  select count(*) into v_count from attendance where student_id = '00000000-0000-0000-0000-eeeeeeeeee03';
  if v_count > 0 then raise exception 'TEST 4 FAILED: Parent A sees Family B attendance (%)' , v_count; end if;
  raise notice 'TEST 4 PASSED: Parent A cannot see Family B attendance';
end;
$$;


-- ---------------------------------------------------------------------------
-- TESTS 5-6: Views respect RLS via security_invoker
-- ---------------------------------------------------------------------------
do $$
declare
  v_count integer;
  v_total integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-cccccccccc01","role":"authenticated"}';

  -- TEST 5: voucher_balances
  select count(*) into v_count from voucher_balances where guardian_id = '00000000-0000-0000-0000-dddddddddd02';
  select count(*) into v_total from voucher_balances;
  if v_count > 0 then raise exception 'TEST 5 FAILED: Parent A sees Family B in voucher_balances (%)' , v_count; end if;
  if v_total = 0 then raise exception 'TEST 5 FAILED: Parent A sees nothing (should see own)'; end if;
  raise notice 'TEST 5 PASSED: voucher_balances respects RLS via security_invoker';

  -- TEST 6: guardian_balances
  select count(*) into v_count from guardian_balances where guardian_id = '00000000-0000-0000-0000-dddddddddd02';
  if v_count > 0 then raise exception 'TEST 6 FAILED: Parent A sees Family B in guardian_balances (%)' , v_count; end if;
  raise notice 'TEST 6 PASSED: guardian_balances respects RLS via security_invoker';
end;
$$;


-- ---------------------------------------------------------------------------
-- TESTS 7-8: Publish gate and approval gate
-- ---------------------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-cccccccccc01","role":"authenticated"}';

  -- TEST 7: Unpublished scores not visible
  select count(*) into v_count from scores
  where assessment_id = '00000000-0000-0000-0002-aaaaaaaaaaab'
    and student_id = '00000000-0000-0000-0000-eeeeeeeeee01';
  if v_count > 0 then raise exception 'TEST 7 FAILED: Parent A sees unpublished scores (%)' , v_count; end if;
  raise notice 'TEST 7 PASSED: Parent A cannot see unpublished scores';

  -- TEST 8: Draft remarks not visible
  select count(*) into v_count from remarks where status = 'draft';
  if v_count > 0 then raise exception 'TEST 8 FAILED: Parent A sees draft remarks (%)' , v_count; end if;
  raise notice 'TEST 8 PASSED: Parent A cannot see draft remarks';
end;
$$;


-- ---------------------------------------------------------------------------
-- TESTS 9-10: Parent has zero access to admin tables; cannot see other family's chat
-- ---------------------------------------------------------------------------
do $$
declare
  v_fr integer; v_rt integer; v_ml integer;
  v_sessions integer; v_messages integer; v_inquiries integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-cccccccccc01","role":"authenticated"}';

  -- TEST 9: fee_rules, templates, message_log
  select count(*) into v_fr from fee_rules;
  select count(*) into v_rt from reminder_templates;
  select count(*) into v_ml from message_log;
  if v_fr > 0 or v_rt > 0 or v_ml > 0 then
    raise exception 'TEST 9 FAILED: Parent sees admin tables (fr=%, rt=%, ml=%)', v_fr, v_rt, v_ml;
  end if;
  raise notice 'TEST 9 PASSED: Parent has zero access to fee_rules, templates, message_log';

  -- TEST 10: Family B chat data
  select count(*) into v_sessions from chat_sessions where guardian_id = '00000000-0000-0000-0000-dddddddddd02';
  select count(*) into v_messages from chat_messages where session_id = '00000000-0000-0000-0005-aaaaaaaaaaab';
  select count(*) into v_inquiries from inquiries where guardian_id = '00000000-0000-0000-0000-dddddddddd02';
  if v_sessions > 0 or v_messages > 0 or v_inquiries > 0 then
    raise exception 'TEST 10 FAILED: Parent A sees Family B chat (s=%, m=%, i=%)', v_sessions, v_messages, v_inquiries;
  end if;
  raise notice 'TEST 10 PASSED: Parent A cannot see Family B chat/inquiry data';
end;
$$;


-- ---------------------------------------------------------------------------
-- TESTS 11-16: Teacher isolation
-- ---------------------------------------------------------------------------
do $$
declare
  v_att integer; v_scores integer;
  v_vouchers integer; v_ledger integer; v_guardians integer; v_fee integer;
  v_students integer; v_updated integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-bbbbbbbbbb01","role":"authenticated"}';

  -- TEST 11: Cannot see Teacher 2's batch data
  select count(*) into v_att from attendance where batch_id = '00000000-0000-0000-0000-fffffffffffe';
  select count(*) into v_scores from scores where student_id = '00000000-0000-0000-0000-eeeeeeeeee02';
  if v_att > 0 then raise exception 'TEST 11 FAILED: Teacher 1 sees batch 2 attendance (%)' , v_att; end if;
  if v_scores > 0 then raise exception 'TEST 11 FAILED: Teacher 1 sees batch 2 scores (%)' , v_scores; end if;
  raise notice 'TEST 11 PASSED: Teacher 1 cannot see Teacher 2 batch data';

  -- TEST 12: Zero access to money/guardian tables
  select count(*) into v_vouchers from vouchers;
  select count(*) into v_ledger from ledger_entries;
  select count(*) into v_guardians from guardians;
  select count(*) into v_fee from fee_rules;
  if v_vouchers > 0 or v_ledger > 0 or v_guardians > 0 or v_fee > 0 then
    raise exception 'TEST 12 FAILED: Teacher sees money data (v=%, l=%, g=%, f=%)', v_vouchers, v_ledger, v_guardians, v_fee;
  end if;
  raise notice 'TEST 12 PASSED: Teacher has zero access to vouchers, ledger, guardians, fee_rules';

  -- TEST 13: Cannot insert attendance for Teacher 2's batch
  begin
    insert into attendance (academy_id, student_id, batch_id, date, status, marked_by)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-eeeeeeeeee02',
            '00000000-0000-0000-0000-fffffffffffe', current_date, 'present', '00000000-0000-0000-0000-bbbbbbbbbb01');
    raise exception 'TEST 13 FAILED: Teacher 1 inserted into Teacher 2 batch';
  exception when insufficient_privilege or others then
    if sqlerrm like 'TEST 13 FAILED%' then raise; end if;
    raise notice 'TEST 13 PASSED: Teacher 1 cannot insert attendance for Teacher 2 batch';
  end;

  -- TEST 14: Cannot insert attendance for yesterday
  begin
    insert into attendance (academy_id, student_id, batch_id, date, status, marked_by)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-eeeeeeeeee01',
            '00000000-0000-0000-0000-ffffffffffff', current_date - 1, 'late', '00000000-0000-0000-0000-bbbbbbbbbb01');
    raise exception 'TEST 14 FAILED: Teacher 1 inserted attendance for yesterday';
  exception when insufficient_privilege or others then
    if sqlerrm like 'TEST 14 FAILED%' then raise; end if;
    raise notice 'TEST 14 PASSED: Teacher 1 cannot insert attendance for yesterday';
  end;

  -- TEST 15: Cannot update yesterday's attendance
  update attendance set status = 'late'
  where student_id = '00000000-0000-0000-0000-eeeeeeeeee01'
    and batch_id = '00000000-0000-0000-0000-ffffffffffff'
    and date = current_date - 1;
  get diagnostics v_updated = row_count;
  if v_updated > 0 then raise exception 'TEST 15 FAILED: Teacher updated yesterday (% rows)', v_updated; end if;
  raise notice 'TEST 15 PASSED: Teacher 1 cannot update yesterday attendance';

  -- TEST 16: Cannot see students from unassigned batches
  select count(*) into v_students from students where id = '00000000-0000-0000-0000-eeeeeeeeee02';
  if v_students > 0 then raise exception 'TEST 16 FAILED: Teacher 1 sees unassigned student (%)' , v_students; end if;
  raise notice 'TEST 16 PASSED: Teacher 1 cannot see students from unassigned batches';
end;
$$;


-- ---------------------------------------------------------------------------
-- TESTS 17-19: Admin ledger constraints (append-only)
-- ---------------------------------------------------------------------------
do $$
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-aaaaaaaaaa01","role":"authenticated"}';

  -- TEST 17: Cannot UPDATE ledger entries
  begin
    update ledger_entries set amount = 9999 where kind = 'payment';
    raise exception 'TEST 17 FAILED: Admin updated a ledger entry';
  exception when insufficient_privilege then
    raise notice 'TEST 17 PASSED: Admin cannot UPDATE ledger entries (REVOKE works)';
  end;

  -- TEST 18: Cannot INSERT a payment-kind entry directly
  begin
    insert into ledger_entries (academy_id, guardian_id, student_id, voucher_id, kind, amount, method, created_by)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-dddddddddd01',
            '00000000-0000-0000-0000-eeeeeeeeee01', '00000000-0000-0000-0003-aaaaaaaaaaaa',
            'payment', 1000, 'cash', '00000000-0000-0000-0000-aaaaaaaaaa01');
    raise exception 'TEST 18 FAILED: Admin inserted payment directly';
  exception when insufficient_privilege or others then
    if sqlerrm like 'TEST 18 FAILED%' then raise; end if;
    raise notice 'TEST 18 PASSED: Admin cannot INSERT payment-kind entry via PostgREST';
  end;

  -- TEST 19: Cannot INSERT adjustment without reason
  begin
    insert into ledger_entries (academy_id, guardian_id, student_id, voucher_id, kind, amount, reason, created_by)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-dddddddddd01',
            '00000000-0000-0000-0000-eeeeeeeeee01', '00000000-0000-0000-0003-aaaaaaaaaaaa',
            'adjustment', -500, null, '00000000-0000-0000-0000-aaaaaaaaaa01');
    raise exception 'TEST 19 FAILED: Admin inserted adjustment without reason';
  exception when insufficient_privilege or others then
    if sqlerrm like 'TEST 19 FAILED%' then raise; end if;
    raise notice 'TEST 19 PASSED: Admin cannot insert adjustment without reason';
  end;
end;
$$;


-- ---------------------------------------------------------------------------
-- TESTS 20-21: Anon access
-- ---------------------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  set local role anon;
  set local request.jwt.claims = '{}';

  -- TEST 20: Anon cannot SELECT students
  begin
    select count(*) into v_count from students;
    if v_count > 0 then raise exception 'TEST 20 FAILED: Anon sees students'; end if;
    raise notice 'TEST 20 PASSED: Anon sees 0 rows from students';
  exception when insufficient_privilege then
    raise notice 'TEST 20 PASSED: Anon gets permission denied on students (even stronger)';
  end;

  -- TEST 21: Anon can INSERT waitlist but cannot SELECT it back
  insert into waitlist (email, source) values ('rls_test_' || gen_random_uuid()::text || '@example.com', 'test');
  raise notice 'TEST 21a: Anon INSERT into waitlist succeeded';
  begin
    select count(*) into v_count from waitlist;
    if v_count > 0 then raise exception 'TEST 21 FAILED: Anon can SELECT from waitlist'; end if;
    raise notice 'TEST 21 PASSED: Anon inserted but SELECT returns 0';
  exception when insufficient_privilege then
    raise notice 'TEST 21 PASSED: Anon inserted but SELECT denied (even stronger)';
  end;
end;
$$;


-- ---------------------------------------------------------------------------
-- TEST 22: Positive control — Parent A sees correct own data
-- ---------------------------------------------------------------------------
do $$
declare
  v_students integer; v_vouchers integer; v_scores integer;
  v_remarks integer; v_attendance integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-cccccccccc01","role":"authenticated"}';

  select count(*) into v_students from students;
  select count(*) into v_vouchers from vouchers;
  select count(*) into v_scores from scores;
  select count(*) into v_remarks from remarks;
  select count(*) into v_attendance from attendance;

  if v_students <> 2 then raise exception 'TEST 22 FAILED: students=% (expected 2)', v_students; end if;
  if v_vouchers <> 1 then raise exception 'TEST 22 FAILED: vouchers=% (expected 1)', v_vouchers; end if;
  if v_scores <> 1 then raise exception 'TEST 22 FAILED: scores=% (expected 1)', v_scores; end if;
  if v_remarks <> 1 then raise exception 'TEST 22 FAILED: remarks=% (expected 1)', v_remarks; end if;
  if v_attendance <> 3 then raise exception 'TEST 22 FAILED: attendance=% (expected 3)', v_attendance; end if;

  raise notice 'TEST 22 PASSED: Parent A positive control — correct row counts';
end;
$$;


-- ---------------------------------------------------------------------------
-- TEST 23: record_cash_payment — overpayment blocked
-- ---------------------------------------------------------------------------
do $$
declare
  v_result jsonb;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-aaaaaaaaaa01","role":"authenticated"}';

  -- Voucher A: total=5000, paid=3000, outstanding=2000. Try paying 3000.
  begin
    select record_cash_payment('00000000-0000-0000-0003-aaaaaaaaaaaa'::uuid, 3000) into v_result;
    raise exception 'TEST 23 FAILED: Overpayment was not blocked';
  exception when others then
    if sqlerrm like '%overpayment blocked%' then
      raise notice 'TEST 23 PASSED: record_cash_payment blocks overpayment';
    else
      raise exception 'TEST 23 FAILED: Unexpected error: %', sqlerrm;
    end if;
  end;
end;
$$;


-- ---------------------------------------------------------------------------
-- TEST 24: Parent A cannot see other families in defaulters view
-- ---------------------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-cccccccccc01","role":"authenticated"}';

  select count(*) into v_count from defaulters
  where guardian_id = '00000000-0000-0000-0000-dddddddddd02';

  if v_count > 0 then raise exception 'TEST 24 FAILED: Parent A sees Family B in defaulters (%)' , v_count; end if;
  raise notice 'TEST 24 PASSED: Parent A cannot see other families in defaulters view';
end;
$$;


-- ===========================================================================
-- SUMMARY
-- ===========================================================================
do $$
begin
  raise notice '============================================';
  raise notice 'ALL 24 RLS TESTS PASSED';
  raise notice '============================================';
end;
$$;
