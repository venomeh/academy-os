-- =============================================================================
-- AcademyOS - Admin-editable escalating fee follow-up templates (Tasks §10)
--
-- reminder_templates is versioned and insert-only for authenticated (no UPDATE
-- grant). The editor RPC is SECURITY DEFINER: deactivate the previous active
-- row, insert the next version. send-reminders already loads
-- active = true ORDER BY template_version DESC LIMIT 1.
--
-- Also deactivates the leftover due_date/en v1 that is still active next to v2.
-- =============================================================================

update public.reminder_templates
set active = false
where academy_id = '00000000-0000-0000-0000-000000000001'
  and bucket = 'due_date'
  and language = 'en'
  and template_version = 1
  and active = true;

create or replace function public.get_admin_reminder_templates(
  p_language text default null,
  p_bust text default null
)
returns table (
  bucket text,
  bucket_label text,
  language text,
  template_version integer,
  subject_line text,
  body text
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_lang text := lower(coalesce(public.admin_clean_text(p_language), ''));
begin
  if public.auth_role() is distinct from 'admin' then
    raise exception 'only admin can view reminder templates';
  end if;

  if v_lang in ('urdu') then
    v_lang := 'ur';
  elsif v_lang in ('english') then
    v_lang := 'en';
  end if;
  if v_lang not in ('en', 'ur') then
    v_lang := null;
  end if;

  return query
  select
    t.bucket::text,
    case t.bucket
      when 'due_date' then 'Due today'
      when '7d_gentle' then '7-day gentle'
      when '14d_firm' then '14-day firm'
      when '30d_final' then '30-day final'
      else t.bucket::text
    end as bucket_label,
    t.language::text,
    t.template_version,
    t.subject_line,
    t.body
  from public.reminder_templates t
  where t.active = true
    and t.academy_id = (
      select p.academy_id
      from public.profiles p
      where p.id = auth.uid()
    )
    and (v_lang is null or t.language = v_lang::public.language_pref)
  order by
    t.language,
    case t.bucket
      when 'due_date' then 1
      when '7d_gentle' then 2
      when '14d_firm' then 3
      when '30d_final' then 4
      else 9
    end;
end;
$$;

comment on function public.get_admin_reminder_templates(text, text) is
  'Admin-only. Active reminder templates for the academy. p_language en|ur filters; blank returns both. p_bust ignored.';

revoke all on function public.get_admin_reminder_templates(text, text) from public, anon;
grant execute on function public.get_admin_reminder_templates(text, text) to authenticated;

create or replace function public.update_admin_reminder_template(
  p_bucket text,
  p_language text,
  p_subject_line text,
  p_body text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_bucket text;
  v_lang text;
  v_subject text;
  v_body text;
  v_academy uuid;
  v_next integer;
begin
  if public.auth_role() is distinct from 'admin' then
    raise exception 'only admin can edit reminder templates';
  end if;

  v_bucket := lower(coalesce(public.admin_clean_text(p_bucket), ''));
  v_bucket := replace(replace(v_bucket, ' ', '_'), '-', '_');
  if v_bucket in ('due', 'due_today', 'duedate') then
    v_bucket := 'due_date';
  elsif v_bucket in ('7d', 'gentle', '7_day', '7d_gentle') then
    v_bucket := '7d_gentle';
  elsif v_bucket in ('14d', 'firm', '14_day', '14d_firm') then
    v_bucket := '14d_firm';
  elsif v_bucket in ('30d', 'final', '30_day', '30d_final') then
    v_bucket := '30d_final';
  end if;
  if v_bucket not in ('due_date', '7d_gentle', '14d_firm', '30d_final') then
    raise exception 'bucket must be due_date, 7d_gentle, 14d_firm, or 30d_final';
  end if;

  v_lang := lower(coalesce(public.admin_clean_text(p_language), 'en'));
  if v_lang in ('urdu') then
    v_lang := 'ur';
  elsif v_lang in ('english') then
    v_lang := 'en';
  end if;
  if v_lang not in ('en', 'ur') then
    raise exception 'language must be en or ur';
  end if;

  v_subject := public.admin_clean_text(p_subject_line);
  v_body := public.admin_clean_text(p_body);
  if v_subject is null or length(v_subject) < 4 then
    raise exception 'subject_line is required';
  end if;
  if v_body is null or length(v_body) < 20 then
    raise exception 'body is required';
  end if;
  if v_body !~ '\{\{\s*amount\s*\}\}' then
    raise exception 'body must include {{amount}}';
  end if;
  if v_body !~ '\{\{\s*pay_url\s*\}\}' then
    raise exception 'body must include {{pay_url}}';
  end if;

  select p.academy_id into v_academy
  from public.profiles p
  where p.id = auth.uid();

  if v_academy is null then
    raise exception 'only admin can edit reminder templates';
  end if;

  update public.reminder_templates
  set active = false
  where academy_id = v_academy
    and bucket = v_bucket::public.reminder_bucket
    and language = v_lang::public.language_pref
    and active = true;

  select coalesce(max(template_version), 0) + 1 into v_next
  from public.reminder_templates
  where academy_id = v_academy
    and bucket = v_bucket::public.reminder_bucket
    and language = v_lang::public.language_pref;

  insert into public.reminder_templates (
    academy_id, bucket, language, template_version, subject_line, body, active
  ) values (
    v_academy,
    v_bucket::public.reminder_bucket,
    v_lang::public.language_pref,
    v_next,
    v_subject,
    v_body,
    true
  );

  return jsonb_build_object(
    'success', true,
    'bucket', v_bucket,
    'language', v_lang,
    'template_version', v_next
  );
end;
$$;

comment on function public.update_admin_reminder_template(text, text, text, text) is
  'Admin-only. Versioned save of one reminder template (bucket + language). Deactivates the previous active row.';

revoke all on function public.update_admin_reminder_template(text, text, text, text) from public, anon;
grant execute on function public.update_admin_reminder_template(text, text, text, text) to authenticated;
