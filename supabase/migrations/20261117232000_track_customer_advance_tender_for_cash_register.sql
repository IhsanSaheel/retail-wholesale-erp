create or replace function private.etihad_capture_customer_advance_receipt()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
 v_method text;
begin
 if new.collection<>'mberp_customer_account_credits'
  or new.data->>'type'<>'overpayment_advance'
  or coalesce(new.data->>'sourceSaleId','')='' then
  return new;
 end if;
 select s.data->>'paymentMethod' into v_method
 from public.etihad_records s
 where s.org_id=new.org_id and s.collection='mberp_sales'
  and s.record_id=new.data->>'sourceSaleId'
 limit 1;
 new.data:=new.data||pg_catalog.jsonb_build_object(
  'method',coalesce(nullif(new.data->>'method',''),nullif(v_method,''),'Unknown'),
  'receivedBy',coalesce(nullif(new.data->>'receivedBy',''),new.updated_by::text),
  'receivedAt',coalesce(nullif(new.data->>'receivedAt',''),new.data->>'date',pg_catalog.now()::text)
 );
 return new;
end;
$function$;

drop trigger if exists etihad_capture_customer_advance_receipt on public.etihad_records;
create trigger etihad_capture_customer_advance_receipt
before insert on public.etihad_records
for each row execute function private.etihad_capture_customer_advance_receipt();