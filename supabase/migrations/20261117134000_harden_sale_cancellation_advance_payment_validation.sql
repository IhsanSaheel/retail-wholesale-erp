-- Refuse cancellation when an advance payment is not reflected in the invoice's
-- advanceUsed field, and require cash refund method to match recorded payments.
do $$
declare v_def text;
begin
 select pg_get_functiondef('private.etihad_cancel_sale(uuid,text,text)'::regprocedure) into v_def;
 v_def:=replace(v_def,
  'v_advance_payment_count integer:=0; v_sale_payment_methods integer:=0; v_sale_payment_total numeric:=0;',
  'v_advance_payment_count integer:=0; v_sale_payment_methods integer:=0; v_sale_payment_total numeric:=0; v_recorded_method text;');
 v_def:=replace(v_def,
  'if v_advance_used<0 then raise exception ''Invoice has an invalid customer advance amount''; end if;',
  'if v_advance_used<0 then raise exception ''Invoice has an invalid customer advance amount''; end if;
 if v_advance_used=0 and exists(select 1 from public.etihad_records ap
  where ap.org_id=p_org_id and ap.collection=''mberp_payments''
   and ap.data->>''saleId''=p_sale_id and ap.data->>''type''=''advance_applied''
   and coalesce(nullif(ap.data->>''amount'','''')::numeric,0)>0) then
  raise exception ''Invoice has an advance payment but no matching advanceUsed amount. Reconcile it before cancellation.'';
 end if;');
 v_def:=replace(v_def,
  'count(distinct data->>''method'') filter(where data->>''type''=''sale_payment'')
   into v_sale_payment_total,v_sale_payment_methods',
  'count(distinct data->>''method'') filter(where data->>''type''=''sale_payment''),
         max(data->>''method'') filter(where data->>''type''=''sale_payment'')
   into v_sale_payment_total,v_sale_payment_methods,v_recorded_method');
 v_def:=replace(v_def,
  'if abs(v_sale_payment_total-(v_paid-v_advance_used))>0.01 or v_sale_payment_methods>1 then',
  'if abs(v_sale_payment_total-(v_paid-v_advance_used))>0.01 or v_sale_payment_methods>1
    or (v_sale_payment_methods=1 and v_recorded_method is distinct from v_method) then');
 execute v_def;
end $$;
