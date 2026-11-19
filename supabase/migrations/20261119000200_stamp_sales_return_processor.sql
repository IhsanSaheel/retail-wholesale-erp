create or replace function private.etihad_stamp_sales_return_processor()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_actor text;
begin
  if new.collection = 'mberp_payments'
     and new.data->>'type' = 'sales_return_refund' then
    if tg_op = 'UPDATE' then
      v_actor := coalesce(
        nullif(old.data->>'processedBy',''),
        old.updated_by::text,
        nullif(new.data->>'processedBy',''),
        auth.uid()::text,
        new.updated_by::text
      );
    else
      v_actor := coalesce(
        nullif(new.data->>'processedBy',''),
        auth.uid()::text,
        new.updated_by::text
      );
    end if;
    if v_actor is not null then
      new.data := jsonb_set(new.data, '{processedBy}', to_jsonb(v_actor), true);
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function private.etihad_stamp_sales_return_processor() from public, anon, authenticated;

drop trigger if exists etihad_stamp_sales_return_processor on public.etihad_records;
create trigger etihad_stamp_sales_return_processor
before insert or update of collection, data, updated_by
on public.etihad_records
for each row
when (new.collection = 'mberp_payments')
execute function private.etihad_stamp_sales_return_processor();