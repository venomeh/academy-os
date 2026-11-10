-- Reverse a backfill carry-forward that landed on a voucher created after
-- the later month was issued (Noor Khan July, generated 27 Aug after Sep).

insert into public.ledger_entries (
  academy_id, guardian_id, student_id, voucher_id,
  kind, amount, method, reason, created_by
)
select
  le.academy_id,
  le.guardian_id,
  le.student_id,
  le.voucher_id,
  'adjustment'::public.ledger_kind,
  -le.amount,
  null,
  'carry_forward_reversed',
  null
from public.ledger_entries le
join public.vouchers v on v.id = le.voucher_id
where le.kind = 'adjustment'
  and le.reason = 'carried_forward'
  and v.generated_at > le.created_at
  and not exists (
    select 1
    from public.ledger_entries rev
    where rev.voucher_id = le.voucher_id
      and rev.kind = 'adjustment'
      and rev.reason = 'carry_forward_reversed'
      and rev.amount = -le.amount
  );

update public.vouchers v
set status = case
  when public.voucher_outstanding(v.id) <= 0 then 'paid'::public.voucher_status
  when exists (
    select 1 from public.ledger_entries le
    where le.voucher_id = v.id and le.kind = 'payment'
  ) then 'partial'::public.voucher_status
  else 'unpaid'::public.voucher_status
end
where v.id in (
  select le.voucher_id
  from public.ledger_entries le
  where le.reason = 'carry_forward_reversed'
);
