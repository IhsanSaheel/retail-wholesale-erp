-- Set invoice return status from returned quantities, not refund value.
-- Preserve the existing protected/idempotent RPC implementation and privileges.
do $migration$
declare
  v_signature regprocedure := 'private.etihad_create_sales_return(uuid,text,text,numeric,numeric,text,text,numeric,numeric)'::regprocedure;
  v_definition text;
  v_old text := $old$'status',case when v_new_total=0 then 'returned' when coalesce(nullif(v_sale.data->>'returnedTotal','')::numeric,0)+v_credit>0 then 'partially_returned' else coalesce(v_sale.data->>'status','completed') end$old$;
  v_new text := $new$'status',case when not exists (
    select 1
    from (
      select sold_item->>'productId' as product_id,
             sum(coalesce(nullif(sold_item->>'qty','')::numeric,0)) as sold_qty
      from pg_catalog.jsonb_array_elements(v_sale.data->'items') as sold_item
      group by sold_item->>'productId'
    ) as sold
    where coalesce((
      select sum(coalesce(nullif(r.data->>'qty','')::numeric,0))
      from public.etihad_records as r
      where r.org_id=p_org_id
        and r.collection='mberp_sales_returns'
        and r.data->>'saleId'=p_sale_id
        and r.data->>'productId'=sold.product_id
    ),0) + case when sold.product_id=p_product_id then p_qty else 0 end < sold.sold_qty
  ) then 'returned' else 'partially_returned' end$new$;
begin
  v_definition := pg_catalog.pg_get_functiondef(v_signature);
  if pg_catalog.strpos(v_definition,v_old)=0 then
    raise exception 'Expected sales-return status expression not found; migration stopped without changing the function';
  end if;
  v_definition := pg_catalog.replace(v_definition,v_old,v_new);
  execute v_definition;
end;
$migration$;
