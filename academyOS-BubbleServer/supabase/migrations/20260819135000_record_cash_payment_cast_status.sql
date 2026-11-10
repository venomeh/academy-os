-- =============================================================================
-- AcademyOS - Cast cash payment status to voucher_status
--
-- record_cash_payment updates vouchers.status with a CASE of untyped literals
-- 'paid' / 'partial'. Postgres infers those as text, so the UPDATE raises
-- 42804: column "status" is of type voucher_status but expression is of type
-- text. This was latent until the first live cash payment.
--
-- Money rules are unchanged: lock, overpay block, ledger method=cash.
-- =============================================================================

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
  v_academy_id uuid;
  v_status public.voucher_status;
begin
  if (select auth_role()) is distinct from 'admin' then
    raise exception 'only admin can record cash payments';
  end if;

  select * into v_voucher from vouchers where id = p_voucher_id for update;
  if not found then raise exception 'voucher not found'; end if;

  select v_voucher.total - coalesce(sum(amount), 0) into v_outstanding
  from ledger_entries
  where voucher_id = p_voucher_id and kind = 'payment';

  if p_amount <= 0 then raise exception 'amount must be positive'; end if;
  if p_amount > v_outstanding then
    raise exception 'overpayment blocked: outstanding is %', v_outstanding;
  end if;

  v_receipt := 'R-' || nextval('receipt_number_seq');
  v_academy_id := v_voucher.academy_id;
  v_status := case
    when p_amount >= v_outstanding then 'paid'::public.voucher_status
    else 'partial'::public.voucher_status
  end;

  insert into ledger_entries
    (academy_id, guardian_id, student_id, voucher_id, kind, amount, method, receipt_number, created_by)
  values
    (v_academy_id, v_voucher.guardian_id, v_voucher.student_id, p_voucher_id,
     'payment', p_amount, 'cash', v_receipt, (select auth.uid()));

  update vouchers
  set status = v_status
  where id = p_voucher_id;

  return jsonb_build_object(
    'receipt_number', v_receipt,
    'paid', p_amount,
    'remaining', v_outstanding - p_amount,
    'status', v_status::text
  );
end;
$$;
