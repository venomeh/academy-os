-- =============================================================================
-- AcademyOS — Security Hardening
-- Fixes applied to the live database (original migration already ran):
-- 1. Pin search_path on all SECURITY DEFINER functions
-- 2. Add security_invoker = on to all views (prevents RLS bypass)
-- 3. Make handle_new_user fail loudly on missing metadata
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Fix SECURITY DEFINER helpers — pin search_path
-- ---------------------------------------------------------------------------

create or replace function auth_role()
returns text
language sql stable security definer set search_path = public
as $$
  select role::text from profiles where id = auth.uid()
$$;

create or replace function auth_guardian_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select id from guardians where profile_id = auth.uid()
$$;

create or replace function auth_student_ids()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select id from students where guardian_id = (
    select id from guardians where profile_id = auth.uid()
  )
$$;

create or replace function auth_teacher_batch_ids()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select batch_id from batch_teachers where teacher_id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- 2. Fix handle_new_user — fail loudly on missing metadata
-- ---------------------------------------------------------------------------

create or replace function handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.raw_user_meta_data ->> 'academy_id' is null then
    raise exception 'handle_new_user: academy_id missing from user metadata for %', new.email;
  end if;
  if new.raw_user_meta_data ->> 'role' is null then
    raise exception 'handle_new_user: role missing from user metadata for %', new.email;
  end if;

  insert into profiles (id, academy_id, role, full_name, email, phone)
  values (
    new.id,
    (new.raw_user_meta_data ->> 'academy_id')::uuid,
    (new.raw_user_meta_data ->> 'role')::user_role,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data ->> 'phone'
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Views — enable security_invoker (RLS applies to querying user)
-- ---------------------------------------------------------------------------

alter view voucher_balances set (security_invoker = on);
alter view guardian_balances set (security_invoker = on);
alter view defaulters set (security_invoker = on);
alter view batches_marked_today set (security_invoker = on);
alter view monthly_collections set (security_invoker = on);
