create or replace function private.etihad_create_sales_return(
 p_org_id uuid,p_sale_id text,p_product_id text,p_qty numeric,p_refund numeric,p_reason text,p_return_id text
) returns jsonb
language sql
security definer
set search_path to ''
as $function$
 select private.etihad_create_sales_return(
  p_org_id,p_sale_id,p_product_id,p_qty,p_refund,p_reason,p_return_id,
  coalesce((select (r.data->>'cashRefund')::numeric from public.etihad_records r
   where r.org_id=p_org_id and r.collection='mberp_sales_returns' and r.record_id=p_return_id),0),
  (select (r.data->>'balanceApplied')::numeric from public.etihad_records r
   where r.org_id=p_org_id and r.collection='mberp_sales_returns' and r.record_id=p_return_id)
 );
$function$;