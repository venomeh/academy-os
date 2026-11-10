-- Assessment list: show "Ready" instead of "Ready to publish". Wording only.

create or replace function public.get_my_assessments(
  p_batch_id uuid default null
)
returns table (
  assessment_id uuid,
  batch_id uuid,
  batch_name text,
  subject_id uuid,
  subject_name text,
  assessment_date date,
  assessment_date_text text,
  max_marks numeric,
  published boolean,
  roster_count integer,
  scored_count integer,
  is_complete boolean,
  status_label text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    a.id as assessment_id,
    a.batch_id,
    b.name as batch_name,
    a.subject_id,
    s.name as subject_name,
    a.date as assessment_date,
    to_char(a.date, 'YYYY-MM-DD') as assessment_date_text,
    a.max_marks,
    a.published,
    coalesce(r.roster_count, 0)::integer as roster_count,
    coalesce(sc.scored_count, 0)::integer as scored_count,
    (coalesce(r.roster_count, 0) > 0
      and coalesce(sc.scored_count, 0) >= coalesce(r.roster_count, 0)) as is_complete,
    case
      when a.published then 'Published'
      when coalesce(sc.scored_count, 0) = 0 then 'Draft - no marks'
      when coalesce(sc.scored_count, 0) >= coalesce(r.roster_count, 0) then 'Ready'
      else 'Draft - partial'
    end as status_label
  from public.assessments a
  join public.batches b on b.id = a.batch_id
  join public.subjects s on s.id = a.subject_id
  left join lateral (
    select count(*)::integer as roster_count
    from public.batch_active_roster(a.batch_id, a.date)
  ) r on true
  left join lateral (
    select count(*)::integer as scored_count
    from public.scores x
    where x.assessment_id = a.id
      and (x.absent = true or x.obtained is not null)
  ) sc on true
  where (p_batch_id is null or a.batch_id = p_batch_id)
  order by a.date desc, b.name, s.name;
$$;
