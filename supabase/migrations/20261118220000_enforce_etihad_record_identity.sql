-- Ensure each organisation record has one stable identity.
-- The live table was audited before this migration: no duplicate
-- (org_id, collection, record_id) keys were present.
do $$
begin
  if exists (
    select 1
    from public.etihad_records
    group by org_id, collection, record_id
    having count(*) > 1
  ) then
    raise exception 'Cannot add etihad_records identity index: duplicate record keys exist.';
  end if;
end
$$;

create unique index if not exists etihad_records_org_collection_record_uidx
  on public.etihad_records (org_id, collection, record_id);
