-- =============================================================================
-- AcademyOS - Monthly voucher generation (Tasks 8.1, 15 Rule 3)
--
-- Admin-only SECURITY DEFINER RPC. Voucher INSERT is not allowed through RLS
-- (client policies are SELECT-only), so generation must run as definer after an
-- explicit admin check. This does not insert ledger rows: the statement read
-- model already synthesizes "Voucher issued" from vouchers. Re-running a month
-- is idempotent via UNIQUE (student_id, period).
-- =============================================================================

create or replace function public.generate_vouchers(
  p_period date default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_academy_id uuid;
  v_rule public.fee_rules%rowtype;
  v_period_start date;
  v_period_end date;
  v_due_date date;
  v_created integer := 0;
  v_skipped_existing integer := 0;
  v_skipped_no_enrollment integer := 0;
  v_skipped_left integer := 0;
  v_review_needed integer := 0;
  v_job_run_id uuid;
  v_result jsonb;
begin
  -- Do not copy `<> 'admin'`: NULL role would skip the check.
  if public.auth_role() is distinct from 'admin' then
    raise exception 'Admin only';
  end if;

  select p.academy_id
    into v_academy_id
  from public.profiles p
  where p.id = auth.uid();

  if v_academy_id is null then
    raise exception 'Admin only';
  end if;

  -- Serialize concurrent runs for the same academy. Unique (student_id, period)
  -- is still the correctness guard; this keeps summary counts stable.
  perform pg_advisory_xact_lock(
    20260818,
    hashtext('generate_vouchers:' || v_academy_id::text)
  );

  v_period_start := date_trunc(
    'month',
    coalesce(p_period, (timezone('Asia/Karachi', now()))::date)
  )::date;
  v_period_end := (v_period_start + interval '1 month' - interval '1 day')::date;

  select fr.*
    into v_rule
  from public.fee_rules fr
  where fr.academy_id = v_academy_id;

  if not found then
    raise exception 'Fee rules not configured';
  end if;

  v_due_date := v_period_start + (v_rule.due_day - 1);

  select count(*)::integer
    into v_skipped_no_enrollment
  from public.students s
  where s.academy_id = v_academy_id
    and s.status = 'active'
    and not exists (
      select 1
      from public.enrollments e
      join public.batches b on b.id = e.batch_id
      where e.student_id = s.id
        and b.active = true
        and b.academy_id = v_academy_id
        and e.start_date <= v_period_end
        and (e.end_date is null or e.end_date >= v_period_start)
    );

  select count(*)::integer
    into v_skipped_left
  from public.students s
  where s.academy_id = v_academy_id
    and s.status = 'left'
    and exists (
      select 1
      from public.enrollments e
      join public.batches b on b.id = e.batch_id
      where e.student_id = s.id
        and b.active = true
        and b.academy_id = v_academy_id
        and e.start_date <= v_period_end
        and (e.end_date is null or e.end_date >= v_period_start)
    );

  with enrollment_bases as (
    select
      e.student_id,
      sum(b.monthly_tuition)::numeric(10,2) as tuition_sum,
      jsonb_object_agg(b.id::text, b.monthly_tuition) as batch_tuitions,
      jsonb_agg(b.id) as batch_ids
    from (
      select distinct on (en.student_id, en.batch_id)
        en.student_id,
        en.batch_id
      from public.enrollments en
      where en.start_date <= v_period_end
        and (en.end_date is null or en.end_date >= v_period_start)
      order by en.student_id, en.batch_id, en.start_date desc
    ) e
    join public.batches b
      on b.id = e.batch_id
     and b.active = true
     and b.academy_id = v_academy_id
    group by e.student_id
  ),
  eligible as (
    select
      s.id as student_id,
      s.guardian_id,
      s.name as student_name,
      s.joined_at,
      s.fee_override,
      s.needs_fee_review,
      coalesce(s.fee_override, eb.tuition_sum)::numeric(10,2) as tuition,
      eb.batch_tuitions,
      eb.batch_ids
    from public.students s
    join enrollment_bases eb on eb.student_id = s.id
    where s.academy_id = v_academy_id
      and s.status = 'active'
  ),
  ranked as (
    select
      e.*,
      row_number() over (
        partition by e.guardian_id
        order by e.joined_at, e.student_name, e.student_id
      ) as sibling_rank
    from eligible e
  ),
  with_arrears as (
    select
      r.*,
      coalesce((
        select sum(
          greatest(
            v.total - coalesce((
              select sum(le.amount)
              from public.ledger_entries le
              where le.voucher_id = v.id
                and le.kind = 'payment'
            ), 0),
            0
          )
        )
        from public.vouchers v
        where v.student_id = r.student_id
          and v.period < v_period_start
      ), 0)::numeric(10,2) as arrears
    from ranked r
  ),
  computed as (
    select
      w.*,
      case
        when w.sibling_rank > 1 and w.tuition > 0 then
          least(
            w.tuition,
            round(w.tuition * v_rule.sibling_discount_pct / 100, 2)
          )
        else 0
      end::numeric(10,2) as sibling_discount,
      case
        when v_rule.admission_fee > 0
         and date_trunc('month', w.joined_at)::date = v_period_start
        then v_rule.admission_fee
        else 0
      end::numeric(10,2) as admission,
      0::numeric(10,2) as fines
    from with_arrears w
  ),
  prepared as (
    select
      c.*,
      (c.tuition - c.sibling_discount + c.arrears + c.fines + c.admission)::numeric(10,2) as total,
      (
        jsonb_build_array(
          jsonb_build_object(
            'code', 'tuition',
            'label', 'Tuition',
            'amount', c.tuition
          )
        )
        || case
          when c.sibling_discount > 0 then jsonb_build_array(
            jsonb_build_object(
              'code', 'sibling_discount',
              'label', 'Sibling discount',
              'amount', -c.sibling_discount
            )
          )
          else '[]'::jsonb
        end
        || case
          when c.arrears > 0 then jsonb_build_array(
            jsonb_build_object(
              'code', 'arrears',
              'label', 'Arrears',
              'amount', c.arrears
            )
          )
          else '[]'::jsonb
        end
        || case
          when c.fines > 0 then jsonb_build_array(
            jsonb_build_object(
              'code', 'fines',
              'label', 'Late fine',
              'amount', c.fines
            )
          )
          else '[]'::jsonb
        end
        || case
          when c.admission > 0 then jsonb_build_array(
            jsonb_build_object(
              'code', 'admission',
              'label', 'Admission fee',
              'amount', c.admission
            )
          )
          else '[]'::jsonb
        end
      ) as line_items,
      jsonb_build_object(
        'fee_rule_id', v_rule.id,
        'sibling_discount_pct', v_rule.sibling_discount_pct,
        'due_day', v_rule.due_day,
        'generation_day', v_rule.generation_day,
        'late_fine_type', v_rule.late_fine_type::text,
        'late_fine_value', v_rule.late_fine_value,
        'late_fine_grace_days', v_rule.late_fine_grace_days,
        'admission_fee', v_rule.admission_fee,
        'batch_ids', c.batch_ids,
        'batch_tuitions', c.batch_tuitions,
        'fee_override', c.fee_override
      ) as rule_snapshot
    from computed c
  ),
  ins as (
    insert into public.vouchers (
      academy_id,
      student_id,
      guardian_id,
      period,
      line_items,
      tuition_amount,
      sibling_discount,
      arrears,
      fines,
      total,
      due_date,
      status,
      token,
      rule_snapshot
    )
    select
      v_academy_id,
      f.student_id,
      f.guardian_id,
      v_period_start,
      f.line_items,
      f.tuition,
      f.sibling_discount,
      f.arrears,
      f.fines,
      f.total,
      v_due_date,
      'unpaid',
      encode(extensions.gen_random_bytes(16), 'hex'),
      f.rule_snapshot
    from prepared f
    on conflict (student_id, period) do nothing
    returning student_id
  )
  select
    (select count(*) from ins)::integer,
    (
      (select count(*) from eligible)
      - (select count(*) from ins)
    )::integer,
    (
      select count(*)
      from ins i
      join public.students s on s.id = i.student_id
      where s.needs_fee_review
    )::integer
  into v_created, v_skipped_existing, v_review_needed;

  v_job_run_id := gen_random_uuid();
  v_result := jsonb_build_object(
    'period', v_period_start,
    'created', v_created,
    'skipped_existing', v_skipped_existing,
    'skipped_no_enrollment', v_skipped_no_enrollment,
    'skipped_left', v_skipped_left,
    'errors', 0,
    'error_details', '[]'::jsonb,
    'review_needed', v_review_needed,
    'job_run_id', v_job_run_id
  );

  insert into public.job_runs (id, job_name, period, result)
  values (v_job_run_id, 'generate_vouchers', v_period_start, v_result);

  return v_result;
end;
$$;

comment on function public.generate_vouchers(date) is
  'Admin-only. Creates one voucher per eligible active student for the month of p_period (Karachi current month if null). Idempotent per student per month. Does not write ledger rows.';

revoke all on function public.generate_vouchers(date) from public;
grant execute on function public.generate_vouchers(date) to authenticated;
grant execute on function public.generate_vouchers(date) to service_role;
revoke execute on function public.generate_vouchers(date) from anon;
