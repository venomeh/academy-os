-- =============================================================================
-- AcademyOS - Accept JSON numbers for record_cash_payment_v2 amount
--
-- Bubble's decimal input (inp: rc-cash, content_format float_number) puts an
-- unquoted JSON number in the body: {"p_voucher_id":"...","p_amount":1000}.
-- PostgREST then calls record_cash_payment_v2(text, text) with a numeric
-- argument and Postgres raises 42804 datatype mismatch.
--
-- Add a (text, numeric) overload. The (text, text) function stays so a quoted
-- string amount still works. Money rules stay in record_cash_payment.
-- =============================================================================

create or replace function public.record_cash_payment_v2(
  p_voucher_id text,
  p_amount numeric
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_voucher_raw text := public.admin_clean_text(p_voucher_id);
  v_voucher_id uuid;
begin
  if v_voucher_raw is null then
    raise exception 'voucher id is required';
  end if;

  if p_amount is null then
    raise exception 'amount is required';
  end if;

  begin
    v_voucher_id := v_voucher_raw::uuid;
  exception when invalid_text_representation then
    raise exception 'voucher id is invalid';
  end;

  return public.record_cash_payment(v_voucher_id, p_amount);
end;
$$;

comment on function public.record_cash_payment_v2(text, numeric) is
  'Overload for Bubble number inputs. JSON {"p_amount": 1000} must hit this signature, not the text one.';

revoke all on function public.record_cash_payment_v2(text, numeric) from public;
grant execute on function public.record_cash_payment_v2(text, numeric) to authenticated;
revoke execute on function public.record_cash_payment_v2(text, numeric) from anon;
