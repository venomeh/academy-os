-- =============================================================================
-- AcademyOS — AI remarks engine (Tasks §9)
--
-- Existing (do not replace): remarks table, parent RLS (approved only),
-- teacher SELECT/UPDATE, get_parent_remarks.
-- Teachers cannot INSERT remarks; drafts are written by the draft-remarks
-- edge function using the service role after JWT / CRON_SECRET checks.
-- =============================================================================

create or replace function public.parse_year_month(p_month text)
returns date
language plpgsql
stable
set search_path = public
as $$
declare
  v_raw text := public.admin_clean_text(p_month);
  v_month date;
begin
  begin
    if v_raw is null then
      v_month := date_trunc('month', public.pkt_today()::timestamp)::date;
    elsif length(v_raw) = 7 then
      v_month := (v_raw || '-01')::date;
    else
      v_month := date_trunc('month', v_raw::date)::date;
    end if;
  exception when others then
    v_month := date_trunc('month', public.pkt_today()::timestamp)::date;
  end;
  return v_month;
end;
$$;

revoke all on function public.parse_year_month(text) from public;
grant execute on function public.parse_year_month(text) to authenticated, service_role;

create or replace function public.parse_uuid_or_null(p_value text)
returns uuid
language plpgsql
stable
set search_path = public
as $$
declare
  v_raw text := public.admin_clean_text(p_value);
  v_id uuid;
begin
  if v_raw is null then
    return null;
  end if;
  begin
    v_id := v_raw::uuid;
  exception when invalid_text_representation then
    return null;
  end;
  return v_id;
end;
$$;

revoke all on function public.parse_uuid_or_null(text) from public;
grant execute on function public.parse_uuid_or_null(text) to authenticated, service_role;

create or replace function public.remark_caller_kind()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce(auth.jwt() ->> 'role', '') = 'service_role' then 'service'
    when public.auth_role() = 'admin' then 'admin'
    when public.auth_role() = 'teacher' then 'teacher'
    else null
  end;
$$;

comment on function public.remark_caller_kind() is
  'admin / teacher / service, else null. Used by remarks engine RPCs.';

revoke all on function public.remark_caller_kind() from public;
grant execute on function public.remark_caller_kind() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Admin-fixed tone templates (versioned, like reminder_templates)
-- ---------------------------------------------------------------------------

create table if not exists public.remark_tone_templates (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id),
  language public.language_pref not null default 'en',
  template_version integer not null default 1,
  tone_text text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (academy_id, language, template_version)
);

alter table public.remark_tone_templates enable row level security;

create policy "remark_tone_admin_all" on public.remark_tone_templates
  for all to authenticated
  using ((select public.auth_role()) = 'admin')
  with check ((select public.auth_role()) = 'admin');

insert into public.remark_tone_templates (
  academy_id, language, template_version, tone_text, active
)
values
  (
    '00000000-0000-0000-0000-000000000001',
    'en',
    1,
    'Write a short parent-facing monthly progress remark. Be supportive, specific, and professional. Mention strengths first, then one practical area for improvement. Use 2 to 4 sentences.',
    true
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    'ur',
    1,
    'Walidain ke liye mukhtasir maheena taraqqi remark likhein. Andaz pur-amal, wazih aur professional ho. Pehle khubiyan, phir ek amali behtari. 2 se 4 jumle.',
    true
  )
on conflict (academy_id, language, template_version) do nothing;

create table if not exists public.remark_generation_log (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id),
  student_id uuid not null references public.students(id) on delete cascade,
  period date not null,
  remark_id uuid references public.remarks(id) on delete set null,
  provider text not null default 'openrouter',
  model text not null,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  cost numeric,
  status text not null,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_remark_generation_log_student
  on public.remark_generation_log (student_id, period);

alter table public.remark_generation_log enable row level security;

create policy "remark_generation_log_admin_select" on public.remark_generation_log
  for select to authenticated
  using ((select public.auth_role()) = 'admin');

create table if not exists public.remark_notification_log (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id),
  guardian_id uuid not null references public.guardians(id),
  batch_id uuid not null references public.batches(id),
  period date not null,
  channel public.message_channel not null default 'email',
  status public.message_status not null default 'pending',
  error_detail text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (guardian_id, batch_id, period, channel)
);

alter table public.remark_notification_log enable row level security;

create policy "remark_notification_log_admin_select" on public.remark_notification_log
  for select to authenticated
  using ((select public.auth_role()) = 'admin');

grant execute on function public.admin_clean_text(text) to service_role;
grant execute on function public.attendance_summary(uuid, date) to service_role;
grant execute on function public.batch_active_roster(uuid, date) to service_role;

-- ---------------------------------------------------------------------------
-- Structured data packs. Prompt input only — no free-form teacher text.
-- ---------------------------------------------------------------------------

create or replace function public.get_remark_data_packs(
  p_batch_id text default null,
  p_month text default null,
  p_student_id text default null
)
returns table (
  academy_id uuid,
  student_id uuid,
  student_name text,
  batch_id uuid,
  batch_name text,
  period_date date,
  period_text text,
  guardian_id uuid,
  guardian_language text,
  joined_at_text text,
  joined_mid_month boolean,
  attendance_total_days integer,
  present_days integer,
  absent_days integer,
  late_days integer,
  leave_days integer,
  attendance_pct numeric,
  published_tests_count integer,
  tests_json jsonb,
  tests_summary text,
  current_month_avg_pct numeric,
  previous_month_avg_pct numeric,
  trend_text text,
  low_data boolean,
  low_data_reason text,
  existing_remark_id uuid,
  existing_status text
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_kind text := public.remark_caller_kind();
  v_month date := public.parse_year_month(p_month);
  v_batch uuid := public.parse_uuid_or_null(p_batch_id);
  v_student uuid := public.parse_uuid_or_null(p_student_id);
  v_as_of date;
begin
  if v_kind is null then
    raise exception 'Teacher or admin only';
  end if;

  if v_kind = 'teacher' then
    if v_batch is null then
      raise exception 'p_batch_id is required';
    end if;
    if v_batch not in (select public.auth_teacher_batch_ids()) then
      return;
    end if;
  elsif v_batch is not null
    and v_kind = 'admin'
    and not exists (select 1 from public.batches b where b.id = v_batch) then
    return;
  end if;

  if v_kind = 'teacher'
    and v_student is not null
    and v_student not in (select public.auth_teacher_student_ids()) then
    return;
  end if;

  v_as_of := least(
    public.pkt_today(),
    (v_month + interval '1 month' - interval '1 day')::date
  );

  return query
  with batches_in_scope as (
    select b.id, b.name, b.academy_id
    from public.batches b
    where b.active = true
      and (v_batch is null or b.id = v_batch)
      and (
        v_kind in ('admin', 'service')
        or b.id in (select public.auth_teacher_batch_ids())
      )
  ),
  roster as (
    select
      bis.id as batch_id,
      bis.name as batch_name,
      bis.academy_id,
      r.student_id,
      r.full_name,
      r.start_date as enrollment_start
    from batches_in_scope bis
    join lateral public.batch_active_roster(bis.id, v_as_of) r on true
    where v_student is null or r.student_id = v_student
  ),
  month_scores as (
    select
      sc.student_id,
      a.id as assessment_id,
      coalesce(sub.name, 'Test') as subject_name,
      a.date as assessment_date,
      sc.obtained,
      a.max_marks,
      sc.absent,
      case
        when sc.absent or a.max_marks <= 0 then null
        else round((sc.obtained / a.max_marks) * 100, 1)
      end as pct,
      (
        select round(avg(
          case
            when sc2.absent or a.max_marks <= 0 then null
            else (sc2.obtained / a.max_marks) * 100
          end
        ), 1)
        from public.scores sc2
        where sc2.assessment_id = a.id
          and sc2.absent = false
          and sc2.obtained is not null
      ) as batch_avg
    from public.scores sc
    join public.assessments a on a.id = sc.assessment_id
    join public.subjects sub on sub.id = a.subject_id
    where a.published = true
      and a.date >= v_month
      and a.date < (v_month + interval '1 month')::date
  ),
  prev_scores as (
    select
      sc.student_id,
      case
        when sc.absent or a.max_marks <= 0 then null
        else round((sc.obtained / a.max_marks) * 100, 1)
      end as pct
    from public.scores sc
    join public.assessments a on a.id = sc.assessment_id
    where a.published = true
      and a.date >= (v_month - interval '1 month')::date
      and a.date < v_month
  )
  select
    ro.academy_id,
    st.id,
    coalesce(st.name, ''),
    ro.batch_id,
    coalesce(ro.batch_name, ''),
    v_month,
    to_char(v_month, 'YYYY-MM'),
    st.guardian_id,
    g.language_pref::text,
    to_char(st.joined_at, 'YYYY-MM-DD'),
    (st.joined_at > v_month) as joined_mid_month,
    coalesce(att.total_days, 0),
    coalesce(att.present_days, 0),
    coalesce(att.absent_days, 0),
    coalesce(att.late_days, 0),
    coalesce(att.leave_days, 0),
    coalesce(att.attendance_pct, 0),
    coalesce(ms.published_tests_count, 0)::integer,
    coalesce(ms.tests_json, '[]'::jsonb),
    coalesce(ms.tests_summary, ''),
    ms.current_avg,
    ps.prev_avg,
    case
      when ms.current_avg is null or ps.prev_avg is null then ''
      when ms.current_avg > ps.prev_avg + 1 then 'improved'
      when ms.current_avg < ps.prev_avg - 1 then 'declined'
      else 'stable'
    end,
    (
      coalesce(ms.published_tests_count, 0) = 0
      or st.joined_at > v_month
      or coalesce(att.total_days, 0) = 0
    ),
    nullif(concat_ws(
      '; ',
      case when st.joined_at > v_month then 'Joined mid-month' else null end,
      case when coalesce(ms.published_tests_count, 0) = 0 then 'No published tests' else null end,
      case when coalesce(att.total_days, 0) = 0 then 'No attendance marked' else null end
    ), ''),
    rm.id,
    rm.status::text
  from roster ro
  join public.students st on st.id = ro.student_id
  join public.guardians g on g.id = st.guardian_id
  left join lateral public.attendance_summary(st.id, v_month) att on true
  left join lateral (
    select
      count(*)::integer as published_tests_count,
      jsonb_agg(
        jsonb_build_object(
          'subject', x.subject_name,
          'date', to_char(x.assessment_date, 'YYYY-MM-DD'),
          'obtained', x.obtained,
          'max_marks', x.max_marks,
          'absent', x.absent,
          'percent', x.pct,
          'batch_average', x.batch_avg
        )
        order by x.assessment_date, x.subject_name
      ) as tests_json,
      string_agg(
        x.subject_name || ' ' || coalesce(x.pct::text || '%', 'absent')
          || coalesce(' (batch avg ' || x.batch_avg::text || '%)', ''),
        '; ' order by x.assessment_date, x.subject_name
      ) as tests_summary,
      round(avg(x.pct), 1) as current_avg
    from month_scores x
    where x.student_id = st.id
  ) ms on true
  left join lateral (
    select round(avg(p.pct), 1) as prev_avg
    from prev_scores p
    where p.student_id = st.id
  ) ps on true
  left join public.remarks rm
    on rm.student_id = st.id
   and rm.period = v_month
  order by ro.batch_name, st.name;
end;
$$;

comment on function public.get_remark_data_packs(text, text, text) is
  'Structured monthly remark packs for one batch (teacher) or all batches (admin/cron).';

revoke all on function public.get_remark_data_packs(text, text, text) from public;
grant execute on function public.get_remark_data_packs(text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Teacher review queue
-- ---------------------------------------------------------------------------

create or replace function public.get_teacher_remark_queue(
  p_batch_id text default null,
  p_month text default null,
  p_status text default null,
  p_bust text default null
)
returns table (
  remark_id uuid,
  student_id uuid,
  student_name text,
  batch_id uuid,
  batch_name text,
  period_text text,
  status text,
  language text,
  draft_text text,
  final_text text,
  low_data boolean,
  low_data_reason text,
  attendance_pct numeric,
  attendance_total_days integer,
  published_tests_count integer,
  tests_summary text,
  trend_text text,
  approved_at_text text,
  approved_by_name text
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_status text := lower(coalesce(public.admin_clean_text(p_status), ''));
begin
  if public.remark_caller_kind() is null then
    raise exception 'Teacher or admin only';
  end if;

  return query
  select
    p.existing_remark_id,
    p.student_id,
    p.student_name,
    p.batch_id,
    p.batch_name,
    p.period_text,
    coalesce(p.existing_status, 'missing'),
    coalesce(r.language::text, p.guardian_language),
    coalesce(r.draft_text, ''),
    coalesce(r.final_text, ''),
    p.low_data,
    coalesce(p.low_data_reason, ''),
    p.attendance_pct,
    p.attendance_total_days,
    p.published_tests_count,
    p.tests_summary,
    p.trend_text,
    coalesce(to_char(r.approved_at, 'YYYY-MM-DD HH24:MI'), ''),
    coalesce(pr.full_name, '')
  from public.get_remark_data_packs(p_batch_id, p_month, null) p
  left join public.remarks r on r.id = p.existing_remark_id
  left join public.profiles pr on pr.id = r.approved_by
  where v_status in ('', 'all', 'null')
     or (v_status = 'missing' and p.existing_status is null)
     or coalesce(p.existing_status, 'missing') = v_status
  order by p.student_name;
end;
$$;

comment on function public.get_teacher_remark_queue(text, text, text, text) is
  'Per-batch teacher remark review queue. p_bust is unused and exists so Bubble can refetch.';

revoke all on function public.get_teacher_remark_queue(text, text, text, text) from public;
grant execute on function public.get_teacher_remark_queue(text, text, text, text) to authenticated;

create or replace function public.review_teacher_remark(
  p_remark_id text,
  p_action text,
  p_final_text text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_kind text := public.remark_caller_kind();
  v_id uuid := public.parse_uuid_or_null(p_remark_id);
  v_action text := lower(coalesce(public.admin_clean_text(p_action), ''));
  v_text text := public.admin_clean_text(p_final_text);
  v_row public.remarks;
  v_out text;
begin
  if v_kind not in ('teacher', 'admin') then
    raise exception 'Teacher or admin only';
  end if;
  if v_id is null then
    raise exception 'remark_id is required';
  end if;

  select * into v_row from public.remarks where id = v_id;
  if not found then
    raise exception 'Remark not found';
  end if;

  if v_kind = 'teacher'
    and v_row.student_id not in (select public.auth_teacher_student_ids()) then
    raise exception 'Remark is not in your assigned batches';
  end if;

  v_out := coalesce(v_text, v_row.final_text, v_row.draft_text, '');

  if v_action = 'save_edit' then
    if v_text is null then
      raise exception 'final_text is required';
    end if;
    update public.remarks
    set final_text = v_text,
        status = case when v_row.status = 'low_data' then 'draft'::public.remark_status else v_row.status end,
        updated_at = now()
    where id = v_id;
    return jsonb_build_object('success', true, 'action', 'save_edit', 'remark_id', v_id);

  elsif v_action = 'approve' then
    if v_row.status = 'low_data' and v_text is null then
      raise exception 'Cannot approve a low-data flag. Edit the remark first.';
    end if;
    if length(trim(v_out)) = 0 then
      raise exception 'Cannot approve an empty remark';
    end if;
    update public.remarks
    set final_text = v_out,
        status = 'approved',
        approved_by = auth.uid(),
        approved_at = now(),
        updated_at = now()
    where id = v_id;
    return jsonb_build_object('success', true, 'action', 'approve', 'remark_id', v_id);

  elsif v_action = 'reject' then
    update public.remarks
    set status = 'rejected',
        approved_by = null,
        approved_at = null,
        updated_at = now()
    where id = v_id;
    return jsonb_build_object('success', true, 'action', 'reject', 'remark_id', v_id);
  end if;

  raise exception 'Unknown action. Use save_edit, approve, or reject';
end;
$$;

comment on function public.review_teacher_remark(text, text, text) is
  'Teacher/admin approve, edit, or reject a remark. Approve stamps auth.uid() and approved_at.';

revoke all on function public.review_teacher_remark(text, text, text) from public;
grant execute on function public.review_teacher_remark(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Tone admin RPCs
-- ---------------------------------------------------------------------------

create or replace function public.get_admin_remark_tone(
  p_language text default 'en'
)
returns table (
  language text,
  template_version integer,
  tone_text text,
  active boolean
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_lang text := lower(coalesce(public.admin_clean_text(p_language), 'en'));
begin
  if public.auth_role() is distinct from 'admin' then
    raise exception 'Admin only';
  end if;
  if v_lang not in ('en', 'ur') then
    v_lang := 'en';
  end if;

  return query
  select
    t.language::text,
    t.template_version,
    t.tone_text,
    t.active
  from public.remark_tone_templates t
  where t.language = v_lang::public.language_pref
    and t.active = true
  order by t.template_version desc
  limit 1;
end;
$$;

revoke all on function public.get_admin_remark_tone(text) from public;
grant execute on function public.get_admin_remark_tone(text) to authenticated;

create or replace function public.update_admin_remark_tone(
  p_language text,
  p_tone_text text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_lang text := lower(coalesce(public.admin_clean_text(p_language), 'en'));
  v_text text := public.admin_clean_text(p_tone_text);
  v_academy uuid;
  v_next integer;
begin
  if public.auth_role() is distinct from 'admin' then
    raise exception 'Admin only';
  end if;
  if v_lang not in ('en', 'ur') then
    raise exception 'language must be en or ur';
  end if;
  if v_text is null or length(v_text) < 8 then
    raise exception 'tone_text is required';
  end if;

  select p.academy_id into v_academy
  from public.profiles p
  where p.id = auth.uid();

  if v_academy is null then
    raise exception 'Admin only';
  end if;

  update public.remark_tone_templates
  set active = false
  where academy_id = v_academy
    and language = v_lang::public.language_pref
    and active = true;

  select coalesce(max(template_version), 0) + 1 into v_next
  from public.remark_tone_templates
  where academy_id = v_academy
    and language = v_lang::public.language_pref;

  insert into public.remark_tone_templates (
    academy_id, language, template_version, tone_text, active
  ) values (
    v_academy, v_lang::public.language_pref, v_next, v_text, true
  );

  return jsonb_build_object(
    'success', true,
    'language', v_lang,
    'template_version', v_next
  );
end;
$$;

revoke all on function public.update_admin_remark_tone(text, text) from public;
grant execute on function public.update_admin_remark_tone(text, text) to authenticated;

create or replace function public.get_active_remark_tone(
  p_academy_id uuid,
  p_language text
)
returns table (
  tone_text text,
  template_version integer,
  language text
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_kind text := public.remark_caller_kind();
  v_lang text := lower(coalesce(public.admin_clean_text(p_language), 'en'));
begin
  if v_kind is null then
    raise exception 'Teacher or admin only';
  end if;
  if v_lang not in ('en', 'ur') then
    v_lang := 'en';
  end if;

  return query
  select t.tone_text, t.template_version, t.language::text
  from public.remark_tone_templates t
  where t.academy_id = p_academy_id
    and t.language = v_lang::public.language_pref
    and t.active = true
  order by t.template_version desc
  limit 1;
end;
$$;

revoke all on function public.get_active_remark_tone(uuid, text) from public;
grant execute on function public.get_active_remark_tone(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Month-end cron: reuse CRON_SECRET already stored on run-finance-jobs-daily
-- ---------------------------------------------------------------------------

do $cron$
declare
  v_secret text;
  v_base_url text;
  v_url text;
  v_jobid bigint;
begin
  select
    substring(command from 'Bearer ([A-Za-z0-9]+)'),
    substring(command from '(https://[a-z0-9-]+\.supabase\.co)')
    into v_secret, v_base_url
  from cron.job
  where jobname = 'run-finance-jobs-daily'
  limit 1;

  v_url := coalesce(v_base_url, 'https://<PROJECT_REF>.supabase.co') || '/functions/v1/draft-remarks';

  if v_secret is null or length(v_secret) < 16 then
    raise notice 'draft-remarks cron skipped: CRON_SECRET not found on run-finance-jobs-daily';
    return;
  end if;

  for v_jobid in select jobid from cron.job where jobname = 'draft-remarks-daily'
  loop
    perform cron.unschedule(v_jobid);
  end loop;

  perform cron.schedule(
    'draft-remarks-daily',
    '25 19 * * *',
    format(
      $cmd$
      select net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer %s'
        ),
        body := '{"source":"cron"}'::jsonb
      );
      $cmd$,
      v_url,
      v_secret
    )
  );
end;
$cron$;
