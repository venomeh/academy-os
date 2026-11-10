-- =============================================================================
-- AcademyOS - Allow finance RPCs from cron (service_role) as well as admin JWT
--
-- pg_cron has no admin user. The run-finance-jobs edge function calls these
-- RPCs with the service role key after checking CRON_SECRET.
-- Existing Bubble admin buttons keep working (auth_role() = admin).
-- =============================================================================

create or replace function public.is_admin_or_service_role()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.auth_role() is not distinct from 'admin'
    or coalesce(auth.jwt() ->> 'role', '') = 'service_role';
$$;

comment on function public.is_admin_or_service_role() is
  'True for academy admin JWT or service_role (cron / edge).';

revoke all on function public.is_admin_or_service_role() from public;
grant execute on function public.is_admin_or_service_role() to postgres, service_role;

-- ---------------------------------------------------------------------------
-- generate_vouchers: service_role uses the single fee_rules academy
-- ---------------------------------------------------------------------------
do $patch$
declare
  src text;
  old_block text;
  new_block text;
begin
  src := pg_get_functiondef('public.generate_vouchers(date)'::regprocedure);

  old_block := $old$  -- Do not copy `<> 'admin'`: NULL role would skip the check.
  if public.auth_role() is distinct from 'admin' then
    raise exception 'Admin only';
  end if;

  select p.academy_id
    into v_academy_id
  from public.profiles p
  where p.id = auth.uid();

  if v_academy_id is null then
    raise exception 'Admin only';
  end if;$old$;

  new_block := $new$  if not public.is_admin_or_service_role() then
    raise exception 'Admin only';
  end if;

  if public.auth_role() is not distinct from 'admin' then
    select p.academy_id
      into v_academy_id
    from public.profiles p
    where p.id = auth.uid();
  else
    select fr.academy_id
      into v_academy_id
    from public.fee_rules fr
    order by fr.updated_at desc
    limit 1;
  end if;

  if v_academy_id is null then
    raise exception 'Admin only';
  end if;$new$;

  if position(old_block in src) = 0 then
    raise exception 'generate_vouchers auth block not found; aborting patch';
  end if;

  execute replace(src, old_block, new_block);
end;
$patch$;

-- ---------------------------------------------------------------------------
-- accrue_late_fines: same caller gate; created_by stays null on cron
-- ---------------------------------------------------------------------------
do $patch$
declare
  src text;
  old_block text;
  new_block text;
begin
  src := pg_get_functiondef('public.accrue_late_fines()'::regprocedure);

  old_block := $old$  if public.auth_role() is distinct from 'admin' then
    raise exception 'only admin can accrue late fines';
  end if;$old$;

  new_block := $new$  if not public.is_admin_or_service_role() then
    raise exception 'only admin can accrue late fines';
  end if;$new$;

  if position(old_block in src) = 0 then
    raise exception 'accrue_late_fines auth block not found; aborting patch';
  end if;

  execute replace(src, old_block, new_block);
end;
$patch$;

grant execute on function public.accrue_late_fines() to service_role;
grant execute on function public.generate_vouchers(date) to service_role;
