-- =============================================================================
-- AcademyOS - Remove record_cash_payment_v2 text-amount overload
--
-- Two signatures (text, text) and (text, numeric) made PostgREST raise PGRST203
-- ("Could not choose the best candidate function"). Bubble's decimal amount
-- input can look like either a JSON number or a numeric string.
--
-- Keep a single function: p_voucher_id text, p_amount numeric.
-- =============================================================================

drop function if exists public.record_cash_payment_v2(text, text);
