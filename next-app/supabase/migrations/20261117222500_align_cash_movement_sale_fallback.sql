-- Keep cash-movement pre-checks consistent with shift closing for legacy bulk customer payments.
-- This prevents a linked legacy sale from being counted again when calculating available drawer cash.
do $migration$
declare
 v_definition text;
 v_old text := $$and p2.data->>'type'='sale_payment' and p2.data->>'saleId'=s.record_id$$;
 v_new text := $$and (p2.data->>'type'='sale_payment' or (p2.data->>'type' is null and p2.data->>'note' like '%Bulk customer payment%')) and p2.data->>'saleId'=s.record_id$$;
begin
 select pg_get_functiondef('private.etihad_record_cash_movement(uuid,text,text,text,numeric,text)'::regprocedure)
 into v_definition;
 if position(v_new in v_definition)>0 then
  return;
 end if;
 if position(v_old in v_definition)=0 then
  raise exception 'Expected sale-payment fallback clause was not found; migration stopped without changing the function';
 end if;
 if position(v_old in substring(v_definition from position(v_old in v_definition)+length(v_old)))>0 then
  raise exception 'More than one matching clause found; migration stopped without changing the function';
 end if;
 execute replace(v_definition,v_old,v_new);
end;
$migration$;
