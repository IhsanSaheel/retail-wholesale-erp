-- The table primary key already enforces this identity; remove the redundant
-- secondary unique index introduced by the preceding migration.
drop index if exists public.etihad_records_org_collection_record_uidx;
