-- Harden teacher review: do not approve a low_data flag as parent-facing text.
-- Editing a low_data row turns it into a real draft. Revoke anon EXECUTE.

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

drop policy if exists "remarks_teacher_update" on public.remarks;
create policy "remarks_teacher_update" on public.remarks
  for update to authenticated
  using (
    (select public.auth_role()) = 'teacher'
    and student_id in (select public.auth_teacher_student_ids())
  )
  with check (
    student_id in (select public.auth_teacher_student_ids())
    and status in ('draft', 'approved', 'rejected', 'low_data')
    and (status <> 'approved' or approved_by = (select auth.uid()))
  );

revoke all on function public.get_remark_data_packs(text, text, text) from public, anon;
grant execute on function public.get_remark_data_packs(text, text, text) to authenticated, service_role;

revoke all on function public.get_teacher_remark_queue(text, text, text, text) from public, anon;
grant execute on function public.get_teacher_remark_queue(text, text, text, text) to authenticated;

revoke all on function public.review_teacher_remark(text, text, text) from public, anon;
grant execute on function public.review_teacher_remark(text, text, text) to authenticated;

revoke all on function public.get_active_remark_tone(uuid, text) from public, anon;
grant execute on function public.get_active_remark_tone(uuid, text) to authenticated, service_role;

revoke all on function public.get_admin_remark_tone(text) from public, anon;
grant execute on function public.get_admin_remark_tone(text) to authenticated;

revoke all on function public.update_admin_remark_tone(text, text) from public, anon;
grant execute on function public.update_admin_remark_tone(text, text) to authenticated;

revoke all on table public.remark_generation_log from anon;
revoke all on table public.remark_notification_log from anon;
revoke all on table public.remark_tone_templates from anon;
