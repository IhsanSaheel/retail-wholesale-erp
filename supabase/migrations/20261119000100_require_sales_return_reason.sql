create or replace function private.etihad_require_sales_return_reason()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.collection = 'mberp_sales_returns'
     and pg_catalog.length(pg_catalog.btrim(coalesce(new.data->>'reason', ''))) < 4 then
    raise exception 'A sales return reason of at least 4 characters is required';
  end if;
  return new;
end;
$$;

revoke all on function private.etihad_require_sales_return_reason() from public, anon, authenticated;

drop trigger if exists etihad_sales_return_reason_required on public.etihad_records;
create trigger etihad_sales_return_reason_required
before insert or update of collection, data on public.etihad_records
for each row
execute function private.etihad_require_sales_return_reason();

comment on function private.etihad_require_sales_return_reason() is
'Requires a meaningful reason on new or updated sales return records; historical rows are not modified.';