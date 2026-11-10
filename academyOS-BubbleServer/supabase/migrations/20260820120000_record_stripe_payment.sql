-- =============================================================================
-- AcademyOS - Record Stripe payment (service_role only)
--
-- Called by stripe-webhook after signature verification. Mirrors cash rules:
-- row lock, overpay blocked, ledger method=stripe, stripe_event_id idempotent,
-- voucher status cast to voucher_status.
-- =============================================================================

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
    select 1 from ledger_entries where stripe_event_id = p_stripe_event_id
  ) then
    return jsonb_build_object(
      'duplicate', true,
      'stripe_event_id', p_stripe_event_id
    );
  end if;

  select * into v_voucher from vouchers where id = p_voucher_id for update;
  if not found then raise exception 'voucher not found'; end if;

  select v_voucher.total - coalesce(sum(amount), 0) into v_outstanding
  from ledger_entries
  where voucher_id = p_voucher_id and kind = 'payment';

  if p_amount <= 0 then raise exception 'amount must be positive'; end if;

  -- Charge may exceed outstanding if cash landed between Checkout and webhook.
  -- Credit only what is still owed; never overpay.
  if v_outstanding <= 0 then
    return jsonb_build_object(
      'skipped', true,
      'reason', 'already_paid',
      'outstanding', 0
    );
  end if;

  v_pay := least(p_amount, v_outstanding);

  v_receipt := 'S-' || nextval('receipt_number_seq');
  v_status := case
    when v_pay >= v_outstanding then 'paid'::public.voucher_status
    else 'partial'::public.voucher_status
  end;

  insert into ledger_entries
    (academy_id, guardian_id, student_id, voucher_id, kind, amount, method,
     stripe_event_id, receipt_number, created_by)
  values
    (v_voucher.academy_id, v_voucher.guardian_id, v_voucher.student_id, p_voucher_id,
     'payment', v_pay, 'stripe', p_stripe_event_id, v_receipt, null);

  update vouchers
  set status = v_status
  where id = p_voucher_id;

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
  'Service-role only. Inserts stripe ledger payment with idempotent stripe_event_id; updates voucher status.';

revoke all on function public.record_stripe_payment(uuid, numeric, text) from public;
revoke all on function public.record_stripe_payment(uuid, numeric, text) from anon;
revoke all on function public.record_stripe_payment(uuid, numeric, text) from authenticated;
grant execute on function public.record_stripe_payment(uuid, numeric, text) to service_role;
