DO $migration$
DECLARE
  v_definition text;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(
    'public.etihad_create_sale(uuid,text,jsonb,numeric,numeric,numeric,numeric,text)'::regprocedure
  );
  IF position("if v_cash_received<0 or v_sale_advance<0 or v_sale_advance<>coalesce(p_advance_used,0)\n   or v_cash_received<coalesce(p_cash_applied,0) then raise exception 'Tender amounts do not match the payment allocation'; end if;" in v_definition)=0 THEN
    RAISE EXCEPTION 'Expected POS tender validation block was not found; migration stopped safely';
  END IF;
  v_definition := replace(v_definition, "if v_cash_received<0 or v_sale_advance<0 or v_sale_advance<>coalesce(p_advance_used,0)\n   or v_cash_received<coalesce(p_cash_applied,0) then raise exception 'Tender amounts do not match the payment allocation'; end if;", "if v_cash_received<0 or v_sale_advance<0 or v_sale_advance<>coalesce(p_advance_used,0)\n   or v_cash_received<coalesce(p_cash_applied,0)\n   or abs(coalesce(p_cash_applied,0)-least(v_cash_received,greatest(0,v_total-v_sale_advance)))>0.01 then\n   raise exception 'Cash payment record must exactly match the amount applied to this invoice';\n end if;");
  EXECUTE v_definition;
END;
$migration$;