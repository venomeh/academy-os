-- =============================================================================
-- AcademyOS - Ledger is the single source of truth (Tasks §8.3, Rule 1, Rule 3)
--
-- Before this migration:
--   * generate_vouchers wrote vouchers but no ledger "voucher" rows
--   * statements synthesized "Voucher issued" from vouchers.total
--   * outstanding was vouchers.total − payments
--   * accrue_late_fines edited vouchers.total / vouchers.fines
--   * next-month arrears copied prior total−payments while the old voucher
--     stayed open, so family totals double-counted
--
-- After this migration:
--   * signed ledger amount is the only balance input
--   * vouchers.total is the issued snapshot and is never edited after generate
--   * a late fine is a new ledger line only
--   * carry-forward credits the prior voucher so debt exists once
--   * generate is still idempotent on (student_id, period)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Ledger math
--
--   voucher, fine                 → +amount
--   payment, discount             → −amount
--   adjustment                    → amount as stored (negative = credit)
-- ---------------------------------------------------------------------------

create or replace function public.ledger_signed_amount(
  p_kind public.ledger_kind,
  p_amount numeric
)
returns numeric
language sql
immutable
as $$
  select case
    when p_kind in ('payment'::public.ledger_kind, 'discount'::public.ledger_kind)
      then -p_amount
    else p_amount
  end;
$$;

comment on function public.ledger_signed_amount(public.ledger_kind, numeric) is
  'Signed contribution of one ledger row to a running balance.';

create or replace function public.voucher_outstanding(p_voucher_id uuid)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    sum(public.ledger_signed_amount(le.kind, le.amount)),
    0
  )::numeric(10, 2)
  from public.ledger_entries le
  where le.voucher_id = p_voucher_id;
$$;

comment on function public.voucher_outstanding(uuid) is
  'Current amount owed on a voucher, computed only from ledger_entries.';

create or replace function public.refresh_voucher_status(p_voucher_id uuid)
returns public.voucher_status
language plpgsql
volatile
set search_path = public
as $$
declare
  v_outstanding numeric;
  v_status public.voucher_status;
  v_has_payment boolean;
begin
  v_outstanding := public.voucher_outstanding(p_voucher_id);
  v_has_payment := exists (
    select 1
    from public.ledger_entries le
    where le.voucher_id = p_voucher_id
      and le.kind = 'payment'
  );

  v_status := case
    when v_outstanding <= 0 then 'paid'::public.voucher_status
    when v_has_payment then 'partial'::public.voucher_status
    else 'unpaid'::public.voucher_status
  end;

  update public.vouchers
  set status = v_status
  where id = p_voucher_id;

  return v_status;
end;
$$;

comment on function public.refresh_voucher_status(uuid) is
  'Cache vouchers.status from ledger outstanding. Not a client RPC.';

create or replace function public.ledger_statement_description(
  p_kind public.ledger_kind,
  p_reason text
)
returns text
language sql
immutable
as $$
  select case
    when p_kind = 'voucher'::public.ledger_kind then 'Voucher issued'
    when p_kind = 'payment'::public.ledger_kind then 'Payment received'
    when p_kind = 'discount'::public.ledger_kind
      and p_reason = 'sibling_discount' then 'Sibling discount'
    when p_kind = 'discount'::public.ledger_kind then 'Discount'
    when p_kind = 'fine'::public.ledger_kind then 'Fine'
    when p_kind = 'adjustment'::public.ledger_kind
      and p_reason = 'carried_forward' then 'Carried forward'
    when p_kind = 'adjustment'::public.ledger_kind
      and p_reason = 'stale_arrears_reversed' then 'Arrears correction'
    when p_kind = 'adjustment'::public.ledger_kind
      and p_reason = 'carry_forward_reversed' then 'Carry-forward reversed'
    when p_kind = 'adjustment'::public.ledger_kind
      then coalesce(p_reason, 'Adjustment')
    else initcap(p_kind::text)
  end;
$$;

revoke all on function public.ledger_signed_amount(public.ledger_kind, numeric) from public;
revoke all on function public.voucher_outstanding(uuid) from public;
revoke all on function public.ledger_statement_description(public.ledger_kind, text) from public;
revoke all on function public.refresh_voucher_status(uuid) from public;

grant execute on function public.ledger_signed_amount(public.ledger_kind, numeric)
  to authenticated, service_role;
grant execute on function public.voucher_outstanding(uuid)
  to authenticated, service_role;
grant execute on function public.ledger_statement_description(public.ledger_kind, text)
  to authenticated, service_role;

revoke execute on function public.refresh_voucher_status(uuid) from anon, authenticated;
grant execute on function public.refresh_voucher_status(uuid) to service_role;

create unique index if not exists ledger_one_voucher_issue_per_voucher
  on public.ledger_entries (voucher_id)
  where kind = 'voucher'::public.ledger_kind;

-- ---------------------------------------------------------------------------
-- 2) Outstanding view — same columns Bubble / RPCs already bind
-- ---------------------------------------------------------------------------

create or replace view public.voucher_balances
  with (security_invoker = on)
as
select
  v.id as voucher_id,
  v.student_id,
  v.guardian_id,
  v.period,
  v.total as voucher_total,
  v.due_date,
  v.status,
  coalesce((
    select sum(le.amount)
    from public.ledger_entries le
    where le.voucher_id = v.id
      and le.kind = 'payment'
  ), 0) as total_paid,
  public.voucher_outstanding(v.id) as outstanding
from public.vouchers v;

comment on view public.voucher_balances is
  'Per-voucher paid/outstanding. outstanding is the signed ledger sum, not total−payments.';

grant select on public.voucher_balances to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Writers: cash, Stripe, late fines
-- ---------------------------------------------------------------------------

create or replace function public.record_cash_payment(
  p_voucher_id uuid,
  p_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_voucher public.vouchers;
  v_outstanding numeric;
  v_receipt text;
  v_status public.voucher_status;
begin
  if (select auth_role()) is distinct from 'admin' then
    raise exception 'only admin can record cash payments';
  end if;

  select * into v_voucher from public.vouchers where id = p_voucher_id for update;
  if not found then
    raise exception 'voucher not found';
  end if;

  v_outstanding := public.voucher_outstanding(p_voucher_id);

  if p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;
  if p_amount > v_outstanding then
    raise exception 'overpayment blocked: outstanding is %', v_outstanding;
  end if;

  v_receipt := 'R-' || nextval('receipt_number_seq');

  insert into public.ledger_entries (
    academy_id, guardian_id, student_id, voucher_id,
    kind, amount, method, receipt_number, created_by
  ) values (
    v_voucher.academy_id, v_voucher.guardian_id, v_voucher.student_id, p_voucher_id,
    'payment', p_amount, 'cash', v_receipt, auth.uid()
  );

  v_status := public.refresh_voucher_status(p_voucher_id);

  return jsonb_build_object(
    'receipt_number', v_receipt,
    'paid', p_amount,
    'remaining', v_outstanding - p_amount,
    'status', v_status::text
  );
end;
$$;

create or replace function public.record_stripe_payment(
  p_voucher_id uuid,
  p_amount numeric,
  p_stripe_event_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_voucher public.vouchers;
  v_outstanding numeric;
  v_receipt text;
  v_status public.voucher_status;
  v_pay numeric;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'only service role can record stripe payments';
  end if;

  if p_stripe_event_id is null or length(trim(p_stripe_event_id)) = 0 then
    raise exception 'stripe_event_id is required';
  end if;

  if exists (
    select 1 from public.ledger_entries where stripe_event_id = p_stripe_event_id
  ) then
    return jsonb_build_object(
      'duplicate', true,
      'stripe_event_id', p_stripe_event_id
    );
  end if;

  select * into v_voucher from public.vouchers where id = p_voucher_id for update;
  if not found then
    raise exception 'voucher not found';
  end if;

  v_outstanding := public.voucher_outstanding(p_voucher_id);

  if p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;

  if v_outstanding <= 0 then
    return jsonb_build_object(
      'skipped', true,
      'reason', 'already_paid',
      'outstanding', 0
    );
  end if;

  v_pay := least(p_amount, v_outstanding);
  v_receipt := 'S-' || nextval('receipt_number_seq');

  insert into public.ledger_entries (
    academy_id, guardian_id, student_id, voucher_id, kind, amount, method,
    stripe_event_id, receipt_number, created_by
  ) values (
    v_voucher.academy_id, v_voucher.guardian_id, v_voucher.student_id, p_voucher_id,
    'payment', v_pay, 'stripe', p_stripe_event_id, v_receipt, null
  );

  v_status := public.refresh_voucher_status(p_voucher_id);

  return jsonb_build_object(
    'receipt_number', v_receipt,
    'paid', v_pay,
    'remaining', v_outstanding - v_pay,
    'status', v_status::text,
    'stripe_event_id', p_stripe_event_id
  );
end;
$$;

comment on function public.record_stripe_payment(uuid, numeric, text) is
  'Service-role only. Inserts stripe ledger payment with idempotent stripe_event_id; status from ledger.';

revoke all on function public.record_stripe_payment(uuid, numeric, text) from public;
revoke all on function public.record_stripe_payment(uuid, numeric, text) from anon;
revoke all on function public.record_stripe_payment(uuid, numeric, text) from authenticated;
grant execute on function public.record_stripe_payment(uuid, numeric, text) to service_role;

create or replace function public.accrue_late_fines()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (timezone('Asia/Karachi', now()))::date;
  v_voucher public.vouchers%rowtype;
  v_type text;
  v_value numeric;
  v_grace integer;
  v_amount numeric;
  v_base numeric;
  v_admission numeric;
  v_accrued integer := 0;
  v_skipped integer := 0;
  v_total numeric := 0;
begin
  if not public.is_admin_or_service_role() then
    raise exception 'only admin can accrue late fines';
  end if;

  for v_voucher in
    select *
    from public.vouchers
    where status in ('unpaid', 'partial')
    order by due_date, id
  loop
    if public.voucher_outstanding(v_voucher.id) <= 0 then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if exists (
      select 1
      from public.ledger_entries le
      where le.voucher_id = v_voucher.id
        and le.kind = 'fine'
        and le.reason = 'late_fine'
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_type := coalesce(
      nullif(v_voucher.rule_snapshot->>'late_fine_type', ''),
      (
        select fr.late_fine_type::text
        from public.fee_rules fr
        where fr.academy_id = v_voucher.academy_id
        limit 1
      ),
      'flat'
    );

    v_value := coalesce(
      nullif(v_voucher.rule_snapshot->>'late_fine_value', '')::numeric,
      (
        select fr.late_fine_value
        from public.fee_rules fr
        where fr.academy_id = v_voucher.academy_id
        limit 1
      ),
      0
    );

    v_grace := coalesce(
      nullif(v_voucher.rule_snapshot->>'late_fine_grace_days', '')::integer,
      (
        select fr.late_fine_grace_days
        from public.fee_rules fr
        where fr.academy_id = v_voucher.academy_id
        limit 1
      ),
      0
    );

    if v_value is null or v_value <= 0 then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_today <= (v_voucher.due_date + v_grace) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- % of this month's charges only: tuition − sibling + admission.
    -- Never a percent of a total that already includes carried arrears.
    v_admission := coalesce((
      select sum((item->>'amount')::numeric)
      from jsonb_array_elements(coalesce(v_voucher.line_items, '[]'::jsonb)) item
      where item->>'code' = 'admission'
    ), 0);

    v_base := coalesce(v_voucher.tuition_amount, 0)
      - coalesce(v_voucher.sibling_discount, 0)
      + v_admission;

    if v_type = 'percentage' then
      v_amount := round(greatest(v_base, 0) * v_value / 100.0, 2);
    else
      v_amount := round(v_value, 2);
    end if;

    if v_amount <= 0 then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    begin
      insert into public.ledger_entries (
        academy_id, guardian_id, student_id, voucher_id,
        kind, amount, method, reason, created_by
      ) values (
        v_voucher.academy_id, v_voucher.guardian_id, v_voucher.student_id,
        v_voucher.id, 'fine', v_amount, null, 'late_fine', auth.uid()
      );
    exception
      when unique_violation then
        v_skipped := v_skipped + 1;
        continue;
    end;

    perform public.refresh_voucher_status(v_voucher.id);

    v_accrued := v_accrued + 1;
    v_total := v_total + v_amount;
  end loop;

  return jsonb_build_object(
    'accrued', v_accrued,
    'skipped', v_skipped,
    'total_fined', v_total,
    'as_of', v_today
  );
end;
$$;

comment on function public.accrue_late_fines() is
  'Admin or service_role. Appends one late_fine ledger row. Does not edit vouchers.total.';

grant execute on function public.accrue_late_fines() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) generate_vouchers — ledger issue + close prior vouchers
-- ---------------------------------------------------------------------------

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
  v_prep record;
  v_new_id uuid;
  v_old record;
  v_old_out numeric;
begin
  if not public.is_admin_or_service_role() then
    raise exception 'Admin only';
  end if;

  if public.auth_role() is not distinct from 'admin' then
    select p.academy_id
      into v_academy_id
    from public.profiles p
    where p.id = auth.uid();
  else
    select fr.academy_id
      into v_academy_id
    from public.fee_rules fr
    order by fr.updated_at desc
    limit 1;
  end if;

  if v_academy_id is null then
    raise exception 'Admin only';
  end if;

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

  -- Freeze prior-month vouchers so arrears and the later close see the same numbers.
  perform 1
  from public.vouchers v
  where v.academy_id = v_academy_id
    and v.period < v_period_start
  for update;

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

  for v_prep in
    with enrollment_bases as (
      select
        e.student_id,
        sum(b.monthly_tuition)::numeric(10, 2) as tuition_sum,
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
        coalesce(s.fee_override, eb.tuition_sum)::numeric(10, 2) as tuition,
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
          select sum(greatest(public.voucher_outstanding(v.id), 0))
          from public.vouchers v
          where v.student_id = r.student_id
            and v.period < v_period_start
        ), 0)::numeric(10, 2) as arrears
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
        end::numeric(10, 2) as sibling_discount,
        case
          when v_rule.admission_fee > 0
           and date_trunc('month', w.joined_at)::date = v_period_start
          then v_rule.admission_fee
          else 0
        end::numeric(10, 2) as admission,
        0::numeric(10, 2) as fines
      from with_arrears w
    ),
    prepared as (
      select
        c.*,
        (c.tuition - c.sibling_discount + c.arrears + c.fines + c.admission)::numeric(10, 2) as total,
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
    )
    select * from prepared
  loop
    v_new_id := null;

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
    ) values (
      v_academy_id,
      v_prep.student_id,
      v_prep.guardian_id,
      v_period_start,
      v_prep.line_items,
      v_prep.tuition,
      v_prep.sibling_discount,
      v_prep.arrears,
      v_prep.fines,
      v_prep.total,
      v_due_date,
      'unpaid',
      encode(extensions.gen_random_bytes(16), 'hex'),
      v_prep.rule_snapshot
    )
    on conflict (student_id, period) do nothing
    returning id into v_new_id;

    if v_new_id is null then
      v_skipped_existing := v_skipped_existing + 1;
      continue;
    end if;

    v_created := v_created + 1;
    if v_prep.needs_fee_review then
      v_review_needed := v_review_needed + 1;
    end if;

    insert into public.ledger_entries (
      academy_id, guardian_id, student_id, voucher_id,
      kind, amount, method, reason, created_by
    ) values (
      v_academy_id, v_prep.guardian_id, v_prep.student_id, v_new_id,
      'voucher',
      (v_prep.total + v_prep.sibling_discount)::numeric(10, 2),
      null,
      'issued',
      auth.uid()
    );

    if v_prep.sibling_discount > 0 then
      insert into public.ledger_entries (
        academy_id, guardian_id, student_id, voucher_id,
        kind, amount, method, reason, created_by
      ) values (
        v_academy_id, v_prep.guardian_id, v_prep.student_id, v_new_id,
        'discount',
        v_prep.sibling_discount,
        null,
        'sibling_discount',
        auth.uid()
      );
    end if;

    for v_old in
      select *
      from public.vouchers
      where student_id = v_prep.student_id
        and period < v_period_start
      order by period, id
    loop
      v_old_out := public.voucher_outstanding(v_old.id);
      if v_old_out > 0 then
        insert into public.ledger_entries (
          academy_id, guardian_id, student_id, voucher_id,
          kind, amount, method, reason, created_by
        ) values (
          v_old.academy_id, v_old.guardian_id, v_old.student_id, v_old.id,
          'adjustment',
          -v_old_out,
          null,
          'carried_forward',
          auth.uid()
        );
        perform public.refresh_voucher_status(v_old.id);
      end if;
    end loop;

    perform public.refresh_voucher_status(v_new_id);
  end loop;

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
  'Admin or service_role. Idempotent per student per month. Writes voucher/discount ledger rows and closes prior outstanding with carried_forward adjustments.';

revoke all on function public.generate_vouchers(date) from public;
grant execute on function public.generate_vouchers(date) to authenticated;
grant execute on function public.generate_vouchers(date) to service_role;
revoke execute on function public.generate_vouchers(date) from anon;

-- ---------------------------------------------------------------------------
-- 5) Statements are ledger-only (no synthesized voucher rows)
-- ---------------------------------------------------------------------------

create or replace function public.get_admin_guardian_statement(
  p_guardian_id uuid
)
returns table (
  entry_id text,
  entry_date timestamptz,
  entry_date_text text,
  guardian_id uuid,
  guardian_name text,
  student_id uuid,
  student_name text,
  voucher_id uuid,
  period_text text,
  kind text,
  description text,
  method text,
  receipt_number text,
  amount numeric,
  signed_amount numeric,
  running_balance numeric
)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if public.auth_role() is distinct from 'admin' then
    raise exception 'Admin only';
  end if;

  return query
  with statement_events as (
    select
      'ledger:' || le.id::text as entry_id,
      le.created_at as entry_date,
      le.guardian_id,
      g.name as guardian_name,
      le.student_id,
      st.name as student_name,
      le.voucher_id,
      coalesce(to_char(v.period, 'YYYY-MM'), '') as period_text,
      le.kind::text as kind,
      public.ledger_statement_description(le.kind, le.reason) as description,
      le.method::text as method,
      le.receipt_number,
      le.amount,
      public.ledger_signed_amount(le.kind, le.amount) as signed_amount
    from public.ledger_entries le
    join public.guardians g on g.id = le.guardian_id
    join public.students st on st.id = le.student_id
    left join public.vouchers v on v.id = le.voucher_id
    where le.guardian_id = p_guardian_id
  )
  select
    se.entry_id,
    se.entry_date,
    to_char(se.entry_date, 'YYYY-MM-DD HH24:MI') as entry_date_text,
    se.guardian_id,
    se.guardian_name,
    se.student_id,
    se.student_name,
    se.voucher_id,
    se.period_text,
    se.kind,
    se.description,
    se.method,
    se.receipt_number,
    se.amount,
    se.signed_amount,
    sum(se.signed_amount) over (
      order by se.entry_date, se.entry_id
      rows between unbounded preceding and current row
    ) as running_balance
  from statement_events se
  order by se.entry_date desc, se.entry_id desc;
end;
$$;

revoke all on function public.get_admin_guardian_statement(uuid) from public;
grant execute on function public.get_admin_guardian_statement(uuid) to authenticated;
revoke execute on function public.get_admin_guardian_statement(uuid) from anon;

create or replace function public.get_parent_statement(
  p_bust text default null
)
returns table (
  entry_id text,
  entry_date_text text,
  student_name text,
  period_text text,
  kind text,
  description text,
  method text,
  receipt_number text,
  amount numeric,
  signed_amount numeric,
  running_balance numeric
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_gid uuid := public.auth_guardian_id();
begin
  if public.auth_role() is distinct from 'parent' then
    raise exception 'Parent only';
  end if;

  if v_gid is null then
    return;
  end if;

  return query
  with statement_events as (
    select
      'ledger:' || le.id::text as entry_id,
      le.created_at as entry_date,
      coalesce(st.name, '') as student_name,
      coalesce(to_char(v.period, 'YYYY-MM'), '') as period_text,
      le.kind::text as kind,
      public.ledger_statement_description(le.kind, le.reason) as description,
      coalesce(le.method::text, '') as method,
      coalesce(le.receipt_number, '') as receipt_number,
      le.amount,
      public.ledger_signed_amount(le.kind, le.amount) as signed_amount
    from public.ledger_entries le
    join public.students st on st.id = le.student_id
    left join public.vouchers v on v.id = le.voucher_id
    where le.guardian_id = v_gid
  )
  select
    se.entry_id,
    to_char(se.entry_date, 'YYYY-MM-DD HH24:MI') as entry_date_text,
    se.student_name,
    se.period_text,
    se.kind,
    se.description,
    se.method,
    se.receipt_number,
    se.amount,
    se.signed_amount,
    sum(se.signed_amount) over (
      order by se.entry_date, se.entry_id
      rows between unbounded preceding and current row
    ) as running_balance
  from statement_events se
  order by se.entry_date desc, se.entry_id desc;
end;
$$;

comment on function public.get_parent_statement(text) is
  'Logged-in parent family statement from ledger_entries only. p_bust is unused and exists so Bubble can refetch.';

revoke all on function public.get_parent_statement(text) from public;
grant execute on function public.get_parent_statement(text) to authenticated;
revoke execute on function public.get_parent_statement(text) from anon;

-- ---------------------------------------------------------------------------
-- 6) Backfill existing vouchers (insert-only; never edit voucher money columns)
-- ---------------------------------------------------------------------------

do $backfill$
declare
  v_row public.vouchers%rowtype;
  v_later public.vouchers%rowtype;
  v_prior public.vouchers%rowtype;
  v_issue numeric;
  v_fine_sum numeric;
  v_remaining numeric;
  v_prior_out numeric;
  v_later_out numeric;
  v_credit numeric;
begin
  for v_row in
    select v.*
    from public.vouchers v
    where not exists (
      select 1
      from public.ledger_entries le
      where le.voucher_id = v.id
        and le.kind = 'voucher'
    )
    order by v.period, v.id
  loop
    select coalesce(sum(le.amount), 0)
      into v_fine_sum
    from public.ledger_entries le
    where le.voucher_id = v_row.id
      and le.kind = 'fine';

    -- Cached total already includes patched fines. The issued snapshot is the rest.
    v_issue := (v_row.total - v_fine_sum)::numeric(10, 2);
    if v_issue < 0 then
      v_issue := 0;
    end if;

    if v_issue = 0 and v_fine_sum = 0 and coalesce(v_row.total, 0) = 0 then
      continue;
    end if;

    insert into public.ledger_entries (
      academy_id, guardian_id, student_id, voucher_id,
      kind, amount, method, reason, created_by, created_at
    ) values (
      v_row.academy_id, v_row.guardian_id, v_row.student_id, v_row.id,
      'voucher', v_issue, null, 'issued', null, v_row.generated_at
    );
  end loop;

  if exists (
    select 1
    from public.ledger_entries
    where kind = 'adjustment'
      and reason in ('carried_forward', 'stale_arrears_reversed')
  ) then
    -- Already unwound. Keep this block idempotent.
    null;
  else
    for v_later in
      select v.*
      from public.vouchers v
      where v.arrears > 0
      order by v.period, v.id
    loop
      v_remaining := v_later.arrears;

      for v_prior in
        select v.*
        from public.vouchers v
        where v.student_id = v_later.student_id
          and v.period < v_later.period
          -- Skip vouchers created after the later issue (e.g. a back-dated July
          -- inserted after September). Those arrears were never in later.arrears.
          and v.generated_at <= v_later.generated_at
        order by v.period, v.id
      loop
        v_prior_out := public.voucher_outstanding(v_prior.id);
        if v_prior_out > 0 and v_remaining > 0 then
          v_credit := least(v_prior_out, v_remaining);
          insert into public.ledger_entries (
            academy_id, guardian_id, student_id, voucher_id,
            kind, amount, method, reason, created_by, created_at
          ) values (
            v_prior.academy_id, v_prior.guardian_id, v_prior.student_id, v_prior.id,
            'adjustment', -v_credit, null, 'carried_forward',
            null, v_later.generated_at
          );
          v_remaining := v_remaining - v_credit;
        end if;
      end loop;

      if v_remaining > 0 then
        v_later_out := public.voucher_outstanding(v_later.id);
        v_credit := least(greatest(v_later_out, 0), v_remaining);
        if v_credit > 0 then
          insert into public.ledger_entries (
            academy_id, guardian_id, student_id, voucher_id,
            kind, amount, method, reason, created_by, created_at
          ) values (
            v_later.academy_id, v_later.guardian_id, v_later.student_id, v_later.id,
            'adjustment', -v_credit, null, 'stale_arrears_reversed',
            null, v_later.generated_at
          );
        end if;
      end if;
    end loop;
  end if;

  update public.vouchers v
  set status = case
    when public.voucher_outstanding(v.id) <= 0 then 'paid'::public.voucher_status
    when exists (
      select 1
      from public.ledger_entries le
      where le.voucher_id = v.id
        and le.kind = 'payment'
    ) then 'partial'::public.voucher_status
    else 'unpaid'::public.voucher_status
  end;
end;
$backfill$;
