do $migration$
declare
  v_definition text;
  v_old text := $old$  v_cash_refund:=greatest(0,v_paid-v_advance_used);
 end if;

 -- Reverse exact prior-invoice settlements recorded against this checkout.$old$;
  v_new text := $new$  v_cash_refund:=greatest(0,v_paid-v_advance_used);
 else
  -- A cash refund is permitted only when the original tender ledger reconciles.
  -- Legacy invoices with missing payment rows or mixed tender methods are held for review.
  select coalesce(sum(coalesce(nullif(data->>'amount','')::numeric,0)),0),
         count(distinct data->>'method') filter(where data->>'type'='sale_payment'),
         max(data->>'method') filter(where data->>'type'='sale_payment')
   into v_sale_payment_total,v_sale_payment_methods,v_recorded_method
  from public.etihad_records
  where org_id=p_org_id and collection='mberp_payments'
   and data->>'saleId'=p_sale_id and data->>'type'='sale_payment';
  if abs(v_sale_payment_total-v_paid)>0.01 or v_sale_payment_methods>1
    or (v_sale_payment_methods=1 and v_recorded_method is distinct from v_method) then
   raise exception 'Recorded payment history does not reconcile with this invoice. Reconcile its original payment method before cancellation.';
  end if;
 end if;

 -- Reverse exact prior-invoice settlements recorded against this checkout.$new$;
begin
  select pg_catalog.pg_get_functiondef('private.etihad_cancel_sale(uuid,text,text)'::regprocedure)
    into v_definition;
  if pg_catalog.strpos(v_definition,v_old)=0 then
    raise exception 'Expected cancellation payment block was not found; migration stopped.';
  end if;
  if pg_catalog.length(v_definition)-pg_catalog.length(pg_catalog.replace(v_definition,v_old,'')) <> pg_catalog.length(v_old) then
    raise exception 'Cancellation payment block is not unique; migration stopped.';
  end if;
  execute pg_catalog.replace(v_definition,v_old,v_new);
end
$migration$;