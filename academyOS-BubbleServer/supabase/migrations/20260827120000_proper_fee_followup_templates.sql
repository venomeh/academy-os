-- =============================================================================
-- AcademyOS - Production-ready fee follow-up templates (Tasks §10)
--
-- Replaces the connector-init stub (due_date/en), the 7-day test edit, and
-- the near-identical Urdu rows with four distinct tones × en/ur.
-- Versioned insert: deactivate previous active, insert next version.
-- Placeholders filled by send-reminders: guardian_name, student_name, amount,
-- due_date, days_overdue, period, itemization, pay_url.
-- Body MUST include {{amount}} and {{pay_url}}.
-- =============================================================================

update public.reminder_templates
set active = false
where academy_id = '00000000-0000-0000-0000-000000000001'
  and active = true;

insert into public.reminder_templates (
  academy_id, bucket, language, template_version, subject_line, body, active
)
values
  (
    '00000000-0000-0000-0000-000000000001',
    'due_date', 'en', 5,
    'Fee due today — {{student_name}}',
    $tmpl$Hi {{guardian_name}},

This is a reminder that fees for {{student_name}} ({{period}}) are due today ({{due_date}}).

{{itemization}}

Amount due: {{amount}}
Pay securely: {{pay_url}}

Thank you for settling this on time.

— Test Academy$tmpl$,
    true
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    '7d_gentle', 'en', 3,
    'Gentle reminder — {{student_name}} fees are overdue',
    $tmpl$Hi {{guardian_name}},

We hope you are well. Fees for {{student_name}} ({{period}}) are now {{days_overdue}} days overdue (due {{due_date}}).

{{itemization}}

Amount due: {{amount}}
Pay securely: {{pay_url}}

Please pay at your earliest convenience. If you have already paid, you can ignore this message.

— Test Academy$tmpl$,
    true
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    '14d_firm', 'en', 2,
    'Action needed — {{student_name}} fees are 14+ days overdue',
    $tmpl$Hi {{guardian_name}},

This is a firm notice. Fees for {{student_name}} ({{period}}) are {{days_overdue}} days overdue (due {{due_date}}).

{{itemization}}

Amount due: {{amount}}
Pay securely: {{pay_url}}

Please settle this balance this week to avoid a final notice and further follow-up from the office.

— Test Academy$tmpl$,
    true
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    '30d_final', 'en', 2,
    'Final notice — {{student_name}} fees are 30+ days overdue',
    $tmpl$Hi {{guardian_name}},

Final notice: fees for {{student_name}} ({{period}}) are {{days_overdue}} days overdue (due {{due_date}}).

{{itemization}}

Amount due: {{amount}}
Pay securely: {{pay_url}}

Please pay today, or contact the academy office if you need a payment plan. We want to resolve this with you.

— Test Academy$tmpl$,
    true
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    'due_date', 'ur', 2,
    'آج فیس واجب الادا — {{student_name}}',
    $tmpl$السلام علیکم {{guardian_name}}،

{{student_name}} ({{period}}) کی فیس آج واجب الادا ہے ({{due_date}})۔

{{itemization}}

واجب رقم: {{amount}}
آن لائن ادائیگی: {{pay_url}}

وقت پر ادا کرنے کا شکریہ۔

— Test Academy$tmpl$,
    true
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    '7d_gentle', 'ur', 2,
    'نرم یاددہانی — {{student_name}} کی فیس 7+ دن سے باقی',
    $tmpl$السلام علیکم {{guardian_name}}،

امید ہے آپ خیریت سے ہوں گے۔ {{student_name}} ({{period}}) کی فیس اب {{days_overdue}} دن سے باقی ہے (آخری تاریخ {{due_date}})۔

{{itemization}}

واجب رقم: {{amount}}
آن لائن ادائیگی: {{pay_url}}

براہ کرم جلد از جلد ادا فرما دیں۔ اگر آپ ادا کر چکے ہیں تو اس پیغام کو نظر انداز کر دیں۔

— Test Academy$tmpl$,
    true
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    '14d_firm', 'ur', 2,
    'فوری توجہ — {{student_name}} کی فیس 14+ دن سے باقی',
    $tmpl$السلام علیکم {{guardian_name}}،

یہ ایک سخت یاددہانی ہے۔ {{student_name}} ({{period}}) کی فیس {{days_overdue}} دن سے باقی ہے (آخری تاریخ {{due_date}})۔

{{itemization}}

واجب رقم: {{amount}}
آن لائن ادائیگی: {{pay_url}}

براہ کرم اس ہفتے اندر بقیہ رقم ادا کر دیں تاکہ آخری نوٹس اور مزید فالو اپ سے بچا جا سکے۔

— Test Academy$tmpl$,
    true
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    '30d_final', 'ur', 2,
    'آخری نوٹس — {{student_name}} کی فیس 30+ دن سے باقی',
    $tmpl$السلام علیکم {{guardian_name}}،

آخری نوٹس: {{student_name}} ({{period}}) کی فیس {{days_overdue}} دن سے باقی ہے (آخری تاریخ {{due_date}})۔

{{itemization}}

واجب رقم: {{amount}}
آن لائن ادائیگی: {{pay_url}}

براہ کرم آج ادا کریں، یا قسطوں کا پلان چاہیے ہو تو اکیڈمی آفس سے رابطہ کریں۔

— Test Academy$tmpl$,
    true
  )
on conflict (academy_id, bucket, language, template_version) do update
set
  subject_line = excluded.subject_line,
  body = excluded.body,
  active = true;
