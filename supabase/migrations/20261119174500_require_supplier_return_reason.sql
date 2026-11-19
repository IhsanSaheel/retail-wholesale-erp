create or replace function private.etihad_require_supplier_return_reason()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.collection = 'mberp_supplier_returns'
     and length(pg_catalog.btrim(coalesce(new.data->>'reason',''))) < 4 then
    raise exception 'Supplier return reason must contain at least 4 characters';
  end if;
  return new;
end;
$function$;

revoke all on function private.etihad_require_supplier_return_reason() from public, anon, authenticated;

drop trigger if exists etihad_supplier_return_reason_required on public.etihad_records;
create trigger etihad_supplier_return_reason_required
before insert or update of collection, data on public.etihad_records
for each row
when (new.collection = 'mberp_supplier_returns')
execute function private.etihad_require_supplier_return_reason();
