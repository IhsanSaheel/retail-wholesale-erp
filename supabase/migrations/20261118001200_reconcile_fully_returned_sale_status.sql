-- Correct only invoice status metadata where every sold product quantity is fully returned.
-- No totals, payments, balances, stock quantities, or return records are changed.
with sale_items as (
  select s.org_id,s.record_id,item->>'productId' as product_id,
         sum(coalesce(nullif(item->>'qty','')::numeric,0)) as sold_qty
  from public.etihad_records s
  cross join lateral pg_catalog.jsonb_array_elements(s.data->'items') as item
  where s.collection='mberp_sales'
  group by s.org_id,s.record_id,item->>'productId'
), returned_items as (
  select r.org_id,r.data->>'saleId' as sale_id,r.data->>'productId' as product_id,
         sum(coalesce(nullif(r.data->>'qty','')::numeric,0)) as returned_qty
  from public.etihad_records r
  where r.collection='mberp_sales_returns'
  group by r.org_id,r.data->>'saleId',r.data->>'productId'
), complete_sales as (
  select si.org_id,si.record_id
  from sale_items si
  left join returned_items ri
    on ri.org_id=si.org_id and ri.sale_id=si.record_id and ri.product_id=si.product_id
  group by si.org_id,si.record_id
  having bool_and(coalesce(ri.returned_qty,0)>=si.sold_qty)
)
update public.etihad_records s
set data=pg_catalog.jsonb_set(s.data,'{status}','"returned"'::jsonb,true),
    updated_at=pg_catalog.now()
from complete_sales c
where s.org_id=c.org_id
  and s.record_id=c.record_id
  and s.collection='mberp_sales'
  and s.data->>'status'='partially_returned';
