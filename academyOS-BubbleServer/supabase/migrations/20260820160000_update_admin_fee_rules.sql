-- =============================================================================
-- AcademyOS - Update admin fee rules (§4.2)
--
-- Admin-only. Updates the single academy fee_rules row.
-- Does NOT rewrite existing vouchers (rule_snapshot on issued vouchers stays).
-- =============================================================================

create or replace function public.update_admin_fee_rules(
  p_sibling_discount_pct numeric,
  p_late_fine_type text,
  p_late_fine_value numeric,
  p_late_fine_grace_days integer,
  p_generation_day integer,
  p_due_day integer,
  p_admission_fee numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.fee_rules%rowtype;
  v_type public.late_fine_type;
  v_type_text text;
begin
  if public.auth_role() is distinct from 'admin' then
    raise exception 'Admin only';
  end if;

  if p_sibling_discount_pct is null
     or p_sibling_discount_pct < 0
     or p_sibling_discount_pct > 100 then
    raise exception 'sibling_discount_pct must be between 0 and 100';
  end if;

  -- DB enum is flat | percentage (accept "percent" as alias)
  v_type_text := lower(coalesce(p_late_fine_type, ''));
  if v_type_text in ('percent', 'percentage') then
    v_type_text := 'percentage';
  end if;
  if v_type_text not in ('flat', 'percentage') then
    raise exception 'late_fine_type must be flat or percentage';
  end if;
  v_type := v_type_text::public.late_fine_type;

  if p_late_fine_value is null or p_late_fine_value < 0 then
    raise exception 'late_fine_value must be >= 0';
  end if;

  if v_type = 'percentage'::public.late_fine_type
     and p_late_fine_value > 100 then
    raise exception 'percentage late_fine_value must be <= 100';
  end if;

  if p_late_fine_grace_days is null or p_late_fine_grace_days < 0 then
    raise exception 'late_fine_grace_days must be >= 0';
  end if;

  if p_generation_day is null
     or p_generation_day < 1
     or p_generation_day > 28 then
    raise exception 'generation_day must be between 1 and 28';
  end if;

  if p_due_day is null or p_due_day < 1 or p_due_day > 28 then
    raise exception 'due_day must be between 1 and 28';
  end if;

  if p_admission_fee is null or p_admission_fee < 0 then
    raise exception 'admission_fee must be >= 0';
  end if;

  update public.fee_rules fr
  set
    sibling_discount_pct = round(p_sibling_discount_pct, 2),
    late_fine_type = v_type,
    late_fine_value = round(p_late_fine_value, 2),
    late_fine_grace_days = p_late_fine_grace_days,
    generation_day = p_generation_day,
    due_day = p_due_day,
    admission_fee = round(p_admission_fee, 2),
    updated_at = now()
  where fr.academy_id = (
    select p.academy_id
    from public.profiles p
    where p.id = auth.uid()
  )
  returning * into v_row;

  if not found then
    raise exception 'Fee rules not configured for this academy';
  end if;

  return jsonb_build_object(
    'fee_rule_id', v_row.id,
    'academy_id', v_row.academy_id,
    'sibling_discount_pct', v_row.sibling_discount_pct,
    'late_fine_type', v_row.late_fine_type::text,
    'late_fine_value', v_row.late_fine_value,
    'late_fine_grace_days', v_row.late_fine_grace_days,
    'generation_day', v_row.generation_day,
    'due_day', v_row.due_day,
    'admission_fee', v_row.admission_fee,
    'updated_at_text', to_char(v_row.updated_at, 'YYYY-MM-DD HH24:MI')
  );
end;
$$;

comment on function public.update_admin_fee_rules(
  numeric, text, numeric, integer, integer, integer, numeric
) is
  'Admin-only. Updates academy fee_rules. Existing voucher rule_snapshot rows are unchanged.';

revoke all on function public.update_admin_fee_rules(
  numeric, text, numeric, integer, integer, integer, numeric
) from public;
grant execute on function public.update_admin_fee_rules(
  numeric, text, numeric, integer, integer, integer, numeric
) to authenticated;
revoke execute on function public.update_admin_fee_rules(
  numeric, text, numeric, integer, integer, integer, numeric
) from anon;
