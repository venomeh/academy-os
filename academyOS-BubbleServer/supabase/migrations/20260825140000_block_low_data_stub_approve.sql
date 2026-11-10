-- Block approving a low_data flag unless the teacher typed a real remark.
--
-- Live incident (Test A1, test batch, 2026-08): the Bubble multiline was empty
-- (low_data initial content), but Review Teacher Remark has
-- allow_blank=false and Initialize default p_final_text =
-- 'Sara had a strong month in Grade 3'. Empty GetElement fell back to that
-- default. review_teacher_remark only blocked low_data when p_final_text was
-- NULL, so the stub row was approved with the Initialize sentence.
--
-- Also revert rows approved with the engine stub or that Initialize fallback.

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
          v_text is not distinct from v_row.draft_text
          or length(v_text) < 50
        )
      )
    );

  v_out := coalesce(v_text, v_row.final_text, v_row.draft_text, '');

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
  'Teacher/admin approve, edit, or reject a remark. low_data rows cannot be approved with empty, stub, or short leftover text.';

revoke all on function public.review_teacher_remark(text, text, text) from public, anon;
grant execute on function public.review_teacher_remark(text, text, text) to authenticated;

-- Restore rows that were approved with the engine stub or Bubble Initialize fallback
-- (empty multiline + allow_blank=false). Real AI/teacher remarks are longer and
-- do not use the Joined mid-month draft.
update public.remarks
set status = 'low_data',
    final_text = null,
    approved_by = null,
    approved_at = null,
    updated_at = now()
where status = 'approved'
  and draft_text ~* '^(joined mid-month|insufficient monthly data)'
  and (
    final_text is null
    or final_text = draft_text
    or final_text ~* '^(joined mid-month|insufficient monthly data)'
    or length(trim(final_text)) < 50
  );
