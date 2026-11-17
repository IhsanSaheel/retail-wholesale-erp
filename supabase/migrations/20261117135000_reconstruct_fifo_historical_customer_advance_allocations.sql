-- Backfill historical allocations where the legacy checkout's verified FIFO
-- rule and timestamps establish exact source-credit usage.
do $$
begin
 if not exists(select 1 from public.etihad_records c
  where c.collection='mberp_customer_account_credits'
   and c.record_id='bace555c-a816-4ff6-922c-ae32214877b9'
   and c.data->>'customerPhone'='03323222125'
   and coalesce(nullif(c.data->>'amount','')::numeric,0)=500
   and coalesce(nullif(c.data->>'balance','')::numeric,0)=0
   and c.data->>'lastAppliedSaleId'='d0db013729714') then
  raise exception 'Expected historical 500 customer credit not found; no allocation backfill applied';
 end if;
 if not exists(select 1 from public.etihad_records c
  where c.collection='mberp_customer_account_credits'
   and c.record_id='197dc9f6-4341-4814-a9e2-b3103a97c311'
   and c.data->>'customerPhone'='03323222125'
   and coalesce(nullif(c.data->>'amount','')::numeric,0)=10
   and coalesce(nullif(c.data->>'balance','')::numeric,0)=0
   and c.data->>'lastAppliedSaleId'='d0db013729714') then
  raise exception 'Expected historical 10 customer credit not found; no allocation backfill applied';
 end if;
 if (select sum(coalesce(nullif(data->>'amount','')::numeric,0)) from public.etihad_records
     where collection='mberp_payments' and data->>'type'='advance_applied'
      and data->>'saleId' in ('0b8cc3d5b63f4','0208e232d7414','d0db013729714')) <> 510 then
  raise exception 'Historical payment totals do not equal 510; no allocation backfill applied';
 end if;
 if exists(select 1 from public.etihad_records a
  where a.collection='mberp_customer_credit_allocations'
   and a.data->>'type'='advance_applied'
   and a.data->>'saleId' in ('0b8cc3d5b63f4','0208e232d7414','d0db013729714')) then
  raise exception 'Unexpected existing allocations found; review before backfill';
 end if;
end $$;

with expected(sale_id,source_credit_id,amount) as (
 values
  ('0b8cc3d5b63f4','bace555c-a816-4ff6-922c-ae32214877b9',250::numeric),
  ('0208e232d7414','bace555c-a816-4ff6-922c-ae32214877b9',25::numeric),
  ('d0db013729714','bace555c-a816-4ff6-922c-ae32214877b9',225::numeric),
  ('d0db013729714','197dc9f6-4341-4814-a9e2-b3103a97c311',10::numeric)
),
source_rows as (
 select e.sale_id,e.source_credit_id,e.amount,
  c.org_id,c.data credit_data,c.updated_by credit_updated_by,
  s.data sale_data,p.data payment_data,
  pg_catalog.gen_random_uuid()::text allocation_id
 from expected e
 join public.etihad_records c on c.collection='mberp_customer_account_credits'
  and c.record_id=e.source_credit_id
 join public.etihad_records s on s.org_id=c.org_id and s.collection='mberp_sales'
  and s.record_id=e.sale_id
 join public.etihad_records p on p.org_id=c.org_id and p.collection='mberp_payments'
  and p.data->>'saleId'=e.sale_id and p.data->>'type'='advance_applied'
 where c.data->>'customerPhone'=s.data->>'customerPhone'
  and c.data->>'customerPhone'=p.data->>'customerPhone'
  and coalesce(nullif(p.data->>'amount','')::numeric,0)=(
    select sum(x.amount) from expected x where x.sale_id=e.sale_id)
  and c.data->>'lastAppliedSaleId'='d0db013729714'
)
insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
select org_id,'mberp_customer_credit_allocations',allocation_id,array[]::text[],
 pg_catalog.jsonb_build_object(
  'id',allocation_id,'type','advance_applied',
  'date',payment_data->>'date','saleId',sale_id,
  'sourceCreditId',source_credit_id,'amount',amount,
  'customerName',payment_data->>'customerName',
  'customerPhone',payment_data->>'customerPhone',
  'branchId',payment_data->>'branchId',
  'invoiceNo',payment_data->>'invoiceNo','status','active',
  'note','Historical allocation reconstructed from verified oldest-updated-credit-first checkout order and exact credit/payment chronology.'
 ),credit_updated_by
from source_rows;

update public.etihad_records a
set data=a.data||jsonb_build_object(
 'status','historical_usage_reconciled',
 'note','Historical source creation and FIFO-reconstructed subsequent usage are reconciled in customer credit allocation audit.'
)
where a.collection='mberp_customer_credit_allocations'
 and a.data->>'type'='advance_created'
 and a.data->>'sourceCreditId' in (
  'bace555c-a816-4ff6-922c-ae32214877b9',
  '197dc9f6-4341-4814-a9e2-b3103a97c311'
);
