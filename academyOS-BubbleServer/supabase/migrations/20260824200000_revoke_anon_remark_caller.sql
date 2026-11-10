-- remark_caller_kind is an internal helper; keep it off the anon Data API.
revoke execute on function public.remark_caller_kind() from anon;
