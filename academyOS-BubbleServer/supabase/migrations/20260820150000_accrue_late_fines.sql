-- =============================================================================
-- AcademyOS - Accrue late fines (admin manual / future cron)
--
-- Rules:
--   - One late fine per voucher (unique partial index on kind=fine, reason=late_fine)
--   - Amount from voucher.rule_snapshot (fallback fee_rules): flat or % of voucher.total
--   - Eligible when unpaid/partial and Karachi today > due_date + grace_days
--   - Ledger line is source of charge; vouchers.fines/total bumped as cache so
--     existing outstanding math (total - payments) keeps working for cash/Stripe
-- =============================================================================

create unique index if not exists ledger_one_late_fine_per_voucher
  on public.ledger_entries (voucher_id)
  where kind = 'fine' and reason = 'late_fine';

create or replace function public.accrue_late_fines()
returns jsonb
language plpgsql
volatile
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
  v_accrued integer := 0;
  v_skipped integer := 0;
  v_total numeric := 0;
begin
  if public.auth_role() is distinct from 'admin' then
    raise exception 'only admin can accrue late fines';
  end if;

  -- No SELECT FOR UPDATE: PostgREST rejects row locks if the call is opened
  -- read-only (e.g. Bubble "Use as: Data" / GET). Uniqueness of late fines is
  -- enforced by ledger_one_late_fine_per_voucher.
  for v_voucher in
    select *
    from public.vouchers
    where status in ('unpaid', 'partial')
    order by due_date, id
  loop
    -- Already has a late fine
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
      (select fr.late_fine_type::text
         from public.fee_rules fr
        where fr.academy_id = v_voucher.academy_id
        limit 1),
      'flat'
    );

    v_value := coalesce(
      nullif(v_voucher.rule_snapshot->>'late_fine_value', '')::numeric,
      (select fr.late_fine_value
         from public.fee_rules fr
        where fr.academy_id = v_voucher.academy_id
        limit 1),
      0
    );

    v_grace := coalesce(
      nullif(v_voucher.rule_snapshot->>'late_fine_grace_days', '')::integer,
      (select fr.late_fine_grace_days
         from public.fee_rules fr
        where fr.academy_id = v_voucher.academy_id
        limit 1),
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

    if v_type = 'percentage' then
      v_amount := round(v_voucher.total * v_value / 100.0, 2);
    else
      v_amount := round(v_value, 2);
    end if;

    if v_amount <= 0 then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.ledger_entries (
      academy_id, guardian_id, student_id, voucher_id,
      kind, amount, method, reason, created_by
    ) values (
      v_voucher.academy_id, v_voucher.guardian_id, v_voucher.student_id, v_voucher.id,
      'fine', v_amount, null, 'late_fine', auth.uid()
    );

    -- Cache so total - payments outstanding includes the fine
    update public.vouchers
    set
      fines = coalesce(fines, 0) + v_amount,
      total = total + v_amount
    where id = v_voucher.id;

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
  'Admin-only. Inserts one late_fine ledger row per overdue unpaid/partial voucher; bumps voucher fines/total cache.';

revoke all on function public.accrue_late_fines() from public;
grant execute on function public.accrue_late_fines() to authenticated;
revoke execute on function public.accrue_late_fines() from anon;
