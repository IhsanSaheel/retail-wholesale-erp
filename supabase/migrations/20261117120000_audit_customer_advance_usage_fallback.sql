-- Audit exact customer-advance usage as a fallback.
-- The primary sale RPC already writes advance_applied allocations. This deferred
-- trigger only fills the gap if a credit balance is reduced and the primary
-- allocation row was not written in the same transaction.

create or replace function private.etihad_capture_customer_advance_usage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used numeric;
  v_sale_id text;
  v_id text;
begin
  if new.collection <> 'mberp_customer_account_credits'
     or old.collection <> 'mberp_customer_account_credits' then
    return new;
  end if;

  v_sale_id := nullif(new.data->>'lastAppliedSaleId','');
  if v_sale_id is null
     or v_sale_id is not distinct from nullif(old.data->>'lastAppliedSaleId','') then
    return new;
  end if;

  v_used := coalesce(nullif(old.data->>'balance','')::numeric,0)
            - coalesce(nullif(new.data->>'balance','')::numeric,0);
  if v_used <= 0 then
    return new;
  end if;

  if exists (
    select 1 from public.etihad_records a
    where a.org_id = new.org_id
      and a.collection = 'mberp_customer_credit_allocations'
      and a.data->>'type' = 'advance_applied'
      and a.data->>'sourceCreditId' = new.record_id
      and a.data->>'saleId' = v_sale_id
      and coalesce(a.data->>'status','active') = 'active'
  ) then
    return new;
  end if;

  v_id := pg_catalog.gen_random_uuid()::text;
  insert into public.etihad_records
    (org_id, collection, record_id, branch_ids, data, updated_by)
  values
    (new.org_id, 'mberp_customer_credit_allocations', v_id, array[]::text[],
     pg_catalog.jsonb_build_object(
       'id', v_id,
       'type', 'advance_applied',
       'date', coalesce(new.data->>'lastAppliedAt',pg_catalog.now()::text),
       'saleId', v_sale_id,
       'sourceCreditId', new.record_id,
       'amount', v_used,
       'customerName', new.data->>'customerName',
       'customerPhone', new.data->>'customerPhone',
       'branchId', new.data->>'branchId',
       'invoiceNo', new.data->>'lastAppliedInvoiceNo',
       'status', 'active',
       'note', 'Fallback exact balance-delta allocation captured by deferred audit trigger.'
     ),
     new.updated_by);
  return new;
end;
$$;

drop trigger if exists etihad_customer_advance_usage_audit on public.etihad_records;
create constraint trigger etihad_customer_advance_usage_audit
after update on public.etihad_records
deferrable initially deferred
for each row
when (new.collection = 'mberp_customer_account_credits')
execute function private.etihad_capture_customer_advance_usage();
