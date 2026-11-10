-- =============================================================================
-- AcademyOS - Exclude left students from fee follow-up pool (Tasks §5.1 / §10)
--
-- Marking a student "left" must stop contact. New vouchers already skip left
-- (generate_vouchers). Historical unpaid vouchers still appeared on defaulters,
-- so send-reminders, Preview, Send this reminder, and the Fees table would
-- still email the guardian.
-- =============================================================================

create or replace view public.defaulters
  with (security_invoker = on)
as
select
  v.id as voucher_id,
  v.student_id,
  v.guardian_id,
  v.period,
  v.total,
  v.due_date,
  v.status,
  vb.outstanding,
  ((timezone('Asia/Karachi', now()))::date - v.due_date) as days_overdue,
  case
    when ((timezone('Asia/Karachi', now()))::date - v.due_date) >= 30 then '30d_final'
    when ((timezone('Asia/Karachi', now()))::date - v.due_date) >= 14 then '14d_firm'
    when ((timezone('Asia/Karachi', now()))::date - v.due_date) >= 7 then '7d_gentle'
    else 'due_date'
  end::reminder_bucket as bucket,
  g.reminders_paused
from public.vouchers v
join public.voucher_balances vb on vb.voucher_id = v.id
join public.guardians g on g.id = v.guardian_id
join public.students s on s.id = v.student_id
where v.status in ('unpaid', 'partial')
  and (timezone('Asia/Karachi', now()))::date >= v.due_date
  and vb.outstanding > 0
  and s.status = 'active';

comment on view public.defaulters is
  'Overdue unpaid/partial vouchers for active students only. Shared by admin UI and send-reminders. Left students are excluded so families are not contacted for leavers.';
