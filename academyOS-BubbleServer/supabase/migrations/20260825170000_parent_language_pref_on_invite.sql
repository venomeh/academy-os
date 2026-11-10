-- =============================================================================
-- AcademyOS - Parent language preference on invite (Tasks §1 / §3.2 / §10 / §14)
--
-- profiles.language_pref and guardians.language_pref both exist. Invite was
-- ignoring the admin choice: handle_new_user omitted the column (always 'en')
-- and invite-user hardcoded guardians.language_pref = 'en'.
-- Remarks already read guardians via guardian_language_pref(); reminders
-- must follow the same guardian value after this.
-- =============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lang text;
begin
  if new.raw_user_meta_data ->> 'academy_id' is null then
    raise exception 'handle_new_user: academy_id missing from user metadata for %', new.email;
  end if;
  if new.raw_user_meta_data ->> 'role' is null then
    raise exception 'handle_new_user: role missing from user metadata for %', new.email;
  end if;

  v_lang := lower(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'language_pref'), ''), 'en'));
  if v_lang in ('urdu') then
    v_lang := 'ur';
  elsif v_lang in ('english') then
    v_lang := 'en';
  end if;
  if v_lang not in ('en', 'ur') then
    v_lang := 'en';
  end if;

  insert into public.profiles (
    id, academy_id, role, full_name, email, phone, language_pref
  ) values (
    new.id,
    (new.raw_user_meta_data ->> 'academy_id')::uuid,
    (new.raw_user_meta_data ->> 'role')::public.user_role,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data ->> 'phone',
    v_lang::public.language_pref
  );
  return new;
end;
$$;

create or replace function public.update_admin_guardian_language(
  p_guardian_id uuid,
  p_language text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_lang text;
  v_profile uuid;
begin
  if public.auth_role() is distinct from 'admin' then
    raise exception 'only admin can set parent language';
  end if;

  if p_guardian_id is null then
    raise exception 'guardian_id required';
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

  update public.guardians
  set language_pref = v_lang::public.language_pref
  where id = p_guardian_id
  returning profile_id into v_profile;

  if not found then
    raise exception 'guardian not found';
  end if;

  if v_profile is not null then
    update public.profiles
    set language_pref = v_lang::public.language_pref
    where id = v_profile;
  end if;

  return jsonb_build_object(
    'success', true,
    'guardian_id', p_guardian_id,
    'language_pref', v_lang
  );
end;
$$;

comment on function public.update_admin_guardian_language(uuid, text) is
  'Admin-only. Sets guardians.language_pref and matching profiles.language_pref (en|ur).';

revoke all on function public.update_admin_guardian_language(uuid, text) from public, anon;
grant execute on function public.update_admin_guardian_language(uuid, text) to authenticated;
