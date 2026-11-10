-- =============================================================================
-- AcademyOS - Escalating fee reminders (Tasks §10)
-- Locked templates, Karachi defaulters buckets, admin pause RPC.
-- Sends happen in the send-reminders edge function (Resend). WhatsApp later.
-- =============================================================================

-- Defaulters must use Karachi "today", same as generate / accrue.
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
where v.status in ('unpaid', 'partial')
  and (timezone('Asia/Karachi', now()))::date >= v.due_date
  and vb.outstanding > 0;

comment on view public.defaulters is
  'Overdue unpaid/partial vouchers with aging bucket. Shared by admin UI and send-reminders.';

-- Latest active template per bucket + language (new versions = new rows).
insert into public.reminder_templates (
  academy_id, bucket, language, template_version, subject_line, body, active
)
values
  (
    '00000000-0000-0000-0000-000000000001',
    'due_date', 'en', 2,
    'Fee due today — {{student_name}}',
    'Hi {{guardian_name}},' || E'\n\n'
    || 'This is a reminder that fees for {{student_name}} ({{period}}) are due today ({{due_date}}).' || E'\n\n'
    || '{{itemization}}' || E'\n\n'
    || 'Amount due: {{amount}}' || E'\n'
    || 'Pay securely: {{pay_url}}' || E'\n\n'
    || '— AcademyOS',
    true
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    '7d_gentle', 'en', 1,
    'Gentle reminder — {{student_name}} fees are 7+ days overdue',
    'Hi {{guardian_name}},' || E'\n\n'
    || 'Fees for {{student_name}} ({{period}}) are {{days_overdue}} days overdue (due {{due_date}}).' || E'\n\n'
    || '{{itemization}}' || E'\n\n'
    || 'Amount due: {{amount}}' || E'\n'
    || 'Pay securely: {{pay_url}}' || E'\n\n'
    || 'Please pay at your earliest convenience.' || E'\n\n'
    || '— AcademyOS',
    true
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    '14d_firm', 'en', 1,
    'Action needed — {{student_name}} fees are 14+ days overdue',
    'Hi {{guardian_name}},' || E'\n\n'
    || 'This is a firm notice: fees for {{student_name}} ({{period}}) are {{days_overdue}} days overdue (due {{due_date}}).' || E'\n\n'
    || '{{itemization}}' || E'\n\n'
    || 'Amount due: {{amount}}' || E'\n'
    || 'Pay securely: {{pay_url}}' || E'\n\n'
    || 'Please settle this balance to avoid further follow-up.' || E'\n\n'
    || '— AcademyOS',
    true
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    '30d_final', 'en', 1,
    'Final notice — {{student_name}} fees are 30+ days overdue',
    'Hi {{guardian_name}},' || E'\n\n'
    || 'Final notice: fees for {{student_name}} ({{period}}) are {{days_overdue}} days overdue (due {{due_date}}).' || E'\n\n'
    || '{{itemization}}' || E'\n\n'
    || 'Amount due: {{amount}}' || E'\n'
    || 'Pay securely: {{pay_url}}' || E'\n\n'
    || 'Please contact the academy office if you need a payment plan.' || E'\n\n'
    || '— AcademyOS',
    true
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    'due_date', 'ur', 1,
    'Fee due today — {{student_name}}',
    'Assalamualaikum {{guardian_name}},' || E'\n\n'
    || '{{student_name}} ({{period}}) ki fee aaj due hai ({{due_date}}).' || E'\n\n'
    || '{{itemization}}' || E'\n\n'
    || 'Raqam: {{amount}}' || E'\n'
    || 'Payment: {{pay_url}}' || E'\n\n'
    || '— AcademyOS',
    true
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    '7d_gentle', 'ur', 1,
    'Gentle reminder — {{student_name}}',
    'Assalamualaikum {{guardian_name}},' || E'\n\n'
    || '{{student_name}} ({{period}}) ki fee {{days_overdue}} din overdue hai (due {{due_date}}).' || E'\n\n'
    || '{{itemization}}' || E'\n\n'
    || 'Raqam: {{amount}}' || E'\n'
    || 'Payment: {{pay_url}}' || E'\n\n'
    || '— AcademyOS',
    true
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    '14d_firm', 'ur', 1,
    'Action needed — {{student_name}}',
    'Assalamualaikum {{guardian_name}},' || E'\n\n'
    || '{{student_name}} ({{period}}) ki fee {{days_overdue}} din overdue hai (due {{due_date}}).' || E'\n\n'
    || '{{itemization}}' || E'\n\n'
    || 'Raqam: {{amount}}' || E'\n'
    || 'Payment: {{pay_url}}' || E'\n\n'
    || '— AcademyOS',
    true
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    '30d_final', 'ur', 1,
    'Final notice — {{student_name}}',
    'Assalamualaikum {{guardian_name}},' || E'\n\n'
    || 'Final notice: {{student_name}} ({{period}}) ki fee {{days_overdue}} din overdue hai.' || E'\n\n'
    || '{{itemization}}' || E'\n\n'
    || 'Raqam: {{amount}}' || E'\n'
    || 'Payment: {{pay_url}}' || E'\n\n'
    || '— AcademyOS',
    true
  )
on conflict (academy_id, bucket, language, template_version) do nothing;

create or replace function public.update_admin_reminder_pause(
  p_guardian_id uuid,
  p_paused boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_reason text;
begin
  if public.auth_role() is distinct from 'admin' then
    raise exception 'only admin can pause reminders';
  end if;

  if p_guardian_id is null then
    raise exception 'guardian_id required';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if p_paused and v_reason is null then
    raise exception 'reason required when pausing reminders';
  end if;

  update public.guardians
  set
    reminders_paused = p_paused,
    reminders_paused_reason = case when p_paused then v_reason else null end
  where id = p_guardian_id;

  if not found then
    raise exception 'guardian not found';
  end if;

  return jsonb_build_object(
    'guardian_id', p_guardian_id,
    'reminders_paused', p_paused,
    'reminders_paused_reason', case when p_paused then v_reason else null end
  );
end;
$$;

comment on function public.update_admin_reminder_pause(uuid, boolean, text) is
  'Admin-only. Pause/resume escalating fee emails for one family. Reason required to pause.';

revoke all on function public.update_admin_reminder_pause(uuid, boolean, text) from public;
grant execute on function public.update_admin_reminder_pause(uuid, boolean, text) to authenticated;
revoke execute on function public.update_admin_reminder_pause(uuid, boolean, text) from anon;

create or replace function public.get_admin_message_log(
  p_bust text default null
)
returns table (
  id uuid,
  created_at timestamptz,
  sent_at timestamptz,
  guardian_name text,
  student_name text,
  period_text text,
  bucket text,
  channel text,
  status text,
  template_version integer,
  error_detail text
)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if public.auth_role() is distinct from 'admin' then
    raise exception 'only admin can view message log';
  end if;

  return query
  select
    ml.id,
    ml.created_at,
    ml.sent_at,
    g.name::text,
    s.name::text,
    to_char(v.period, 'YYYY-MM'),
    ml.bucket::text,
    ml.channel::text,
    ml.status::text,
    ml.template_version,
    ml.error_detail
  from public.message_log ml
  join public.guardians g on g.id = ml.guardian_id
  left join public.vouchers v on v.id = ml.voucher_id
  left join public.students s on s.id = v.student_id
  order by ml.created_at desc
  limit 100;
end;
$$;

revoke all on function public.get_admin_message_log(text) from public;
grant execute on function public.get_admin_message_log(text) to authenticated;
revoke execute on function public.get_admin_message_log(text) from anon;
