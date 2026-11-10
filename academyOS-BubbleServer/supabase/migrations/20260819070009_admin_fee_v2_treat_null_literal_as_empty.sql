-- =============================================================================
-- AcademyOS - Treat Bubble's "null" literal as an empty filter
--
-- Bubble serialises a blank API Connector body parameter as the four-character
-- string "null", not as an empty string or JSON null. Captured live from the
-- Fees list call:
--
--   got_status "all" | got_month "null" | got_overdue_only "yes"
--   got_search "null" | got_bust "null"
--
-- p_month was already harmless ("null" is unparseable, so it fell back to the
-- current month), but p_search survived cleaning and ran as
-- `st.name ilike '%null%'`, which matches no student and returned an empty array
-- with HTTP 200 -- indistinguishable from "no data" in the UI, and it starves the
-- API Connector of the sample row it needs to infer the response schema.
--
-- Treat the common empty sentinels as absent, alongside the unsubstituted
-- '<param>' placeholders handled in the previous migration.
-- =============================================================================

create or replace function public.admin_clean_text(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(
    case
      when lower(trim(coalesce(p_value, ''))) in ('null', 'undefined', 'nan', 'nil', 'none')
        then ''
      when trim(coalesce(p_value, '')) ~ '^<[A-Za-z0-9_]*>$'
        then ''
      else trim(coalesce(p_value, ''))
    end,
    ''
  );
$$;

comment on function public.admin_clean_text(text) is
  'Trims UI text and treats Bubble empties as NULL: the literal strings null/undefined/nan/nil/none and unsubstituted placeholders such as <p_search>.';

revoke all on function public.admin_clean_text(text) from public;
grant execute on function public.admin_clean_text(text) to authenticated;
