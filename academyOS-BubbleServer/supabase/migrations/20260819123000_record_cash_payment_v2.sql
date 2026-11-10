-- =============================================================================
-- AcademyOS - Text wrapper around record_cash_payment for Bubble
--
-- Does not change money rules. The existing record_cash_payment(uuid, numeric)
-- stays the writer: admin-only, row lock, overpay blocked, ledger method=cash,
-- voucher status cache updated.
--
-- Bubble cannot reliably send uuid/numeric JSON types, and blank connector
-- params arrive as "null" or "<p_amount>". This wrapper cleans those to text,
-- casts, then calls the original function.
-- =============================================================================

create or replace function public.record_cash_payment_v2(
  p_voucher_id text,
  p_amount text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_voucher_raw text := public.admin_clean_text(p_voucher_id);
  v_amount_raw text := public.admin_clean_text(p_amount);
  v_voucher_id uuid;
  v_amount numeric;
begin
  if v_voucher_raw is null then
    raise exception 'voucher id is required';
  end if;

  if v_amount_raw is null then
    raise exception 'amount is required';
  end if;

  -- Allow "5000" or "5,000.00"; reject everything else via the numeric cast.
  v_amount_raw := replace(v_amount_raw, ',', '');

  begin
    v_voucher_id := v_voucher_raw::uuid;
  exception when invalid_text_representation then
    raise exception 'voucher id is invalid';
  end;

  begin
    v_amount := v_amount_raw::numeric;
  exception when invalid_text_representation then
    raise exception 'amount is invalid';
  end;

  return public.record_cash_payment(v_voucher_id, v_amount);
end;
$$;

comment on function public.record_cash_payment_v2(text, text) is
  'Bubble-safe wrapper around record_cash_payment. Cleans text args, then records a cash ledger payment without changing money rules.';

revoke all on function public.record_cash_payment_v2(text, text) from public;
grant execute on function public.record_cash_payment_v2(text, text) to authenticated;
revoke execute on function public.record_cash_payment_v2(text, text) from anon;
