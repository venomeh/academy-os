-- Strip model chain-of-thought dumps from remark text.
-- stealth/ox-alpha was storing checklists / "I'll output the JSON" as draft_text.
-- That blob also breaks Bubble's Review Teacher Remark body (PGRST102).

create or replace function public.remark_parent_facing_text(p_text text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text := trim(coalesce(p_text, ''));
  v_dump boolean;
  v_field text;
  v_numbered text;
begin
  if v = '' then
    return null;
  end if;

  v_dump :=
    v ~* 'i[''’]?ll output the json'
    or v ~* 'check constraints'
    or v ~* 'mentions actual numbers'
    or v ~* 'final check of the draft_text'
    or v ~* 'ensure i don'
    or v ~* 'language en:\s*yes'
    or (length(v) > 800 and v like '%"grounding"%');

  if not v_dump and left(v, 1) <> '{' and v not like '%"draft_text"%' then
    return v;
  end if;

  v_field := (regexp_match(
    v,
    '.*"draft_text"\s*:\s*"((?:\\.|[^"\\])*)"'
  ))[1];
  if v_field is not null then
    v_field := trim(replace(replace(v_field, E'\\n', ' '), E'\\"', '"'));
    if v_field <> ''
      and length(v_field) <= 800
      and v_field !~* 'i[''’]?ll output the json'
      and v_field !~* 'check constraints' then
      return v_field;
    end if;
  end if;

  select nullif(trim(string_agg(trim(m[1]), ' ')), '')
    into v_numbered
  from regexp_matches(v, '\d+[.)]\s+([^\n\r]+)', 'g') as m
  where length(trim(m[1])) > 20
    and trim(m[1]) !~* '^(mentions|does not|language|check|grounding)';
  if v_numbered is not null then
    return v_numbered;
  end if;

  if not v_dump then
    return v;
  end if;
  return null;
end;
$$;

comment on function public.remark_parent_facing_text(text) is
  'Returns only the parent-facing remark, dropping model reasoning / JSON dumps.';

revoke all on function public.remark_parent_facing_text(text) from public, anon;
grant execute on function public.remark_parent_facing_text(text) to authenticated, service_role;

update public.remarks
set
  draft_text = coalesce(public.remark_parent_facing_text(draft_text), draft_text),
  final_text = case
    when final_text is null then null
    else coalesce(public.remark_parent_facing_text(final_text), final_text)
  end,
  updated_at = now()
where draft_text ~* 'i[''’]?ll output the json'
   or draft_text ~* 'check constraints'
   or draft_text ~* 'mentions actual numbers'
   or draft_text ~* 'final check of the draft_text'
   or coalesce(final_text, '') ~* 'i[''’]?ll output the json'
   or coalesce(final_text, '') ~* 'check constraints';

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
    coalesce(
      public.remark_parent_facing_text(r.draft_text),
      r.draft_text,
      ''
    ),
    coalesce(
      public.remark_parent_facing_text(r.final_text),
      r.final_text,
      ''
    ),
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

revoke all on function public.get_teacher_remark_queue(text, text, text, text) from public, anon;
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
  v_text text := public.remark_parent_facing_text(public.admin_clean_text(p_final_text));
  v_row public.remarks;
  v_out text;
  v_stub boolean;
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

  v_stub :=
    v_text is not null
    and (
      v_text ~* '^(joined mid-month|insufficient monthly data)'
      or (
        v_row.status = 'low_data'
        and (
          v_text is not distinct from coalesce(
            public.remark_parent_facing_text(v_row.draft_text),
            v_row.draft_text
          )
          or length(v_text) < 50
        )
      )
    );

  v_out := coalesce(
    v_text,
    public.remark_parent_facing_text(v_row.final_text),
    public.remark_parent_facing_text(v_row.draft_text),
    v_row.final_text,
    v_row.draft_text,
    ''
  );

  if v_action = 'save_edit' then
    if v_text is null or v_stub then
      raise exception 'final_text is required';
    end if;
    update public.remarks
    set final_text = v_text,
        status = case when v_row.status = 'low_data' then 'draft'::public.remark_status else v_row.status end,
        updated_at = now()
    where id = v_id;
    return jsonb_build_object('success', true, 'action', 'save_edit', 'remark_id', v_id);

  elsif v_action = 'approve' then
    if v_row.status = 'low_data' then
      if v_text is null or v_stub then
        raise exception 'Cannot approve a low-data flag. Type a real remark first.';
      end if;
      v_out := v_text;
    end if;
    if length(trim(v_out)) = 0 then
      raise exception 'Cannot approve an empty remark';
    end if;
    if public.remark_parent_facing_text(v_out) is null
      and (
        v_out ~* 'i[''’]?ll output the json'
        or v_out ~* 'check constraints'
      ) then
      raise exception 'Cannot approve model reasoning. Keep only the parent-facing remark.';
    end if;
    v_out := coalesce(public.remark_parent_facing_text(v_out), v_out);
    update public.remarks
    set final_text = v_out,
        draft_text = case
          when public.remark_parent_facing_text(v_row.draft_text) is not null
            then public.remark_parent_facing_text(v_row.draft_text)
          else v_row.draft_text
        end,
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
  'Teacher/admin approve, edit, or reject a remark. Strips model reasoning dumps. low_data rows cannot be approved with empty, stub, or short leftover text.';

revoke all on function public.review_teacher_remark(text, text, text) from public, anon;
grant execute on function public.review_teacher_remark(text, text, text) to authenticated;
