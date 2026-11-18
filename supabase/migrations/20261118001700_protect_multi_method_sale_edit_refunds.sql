do $migration$
declare
  v_definition text;
  v_old text := ' v_cash_refund:=v_refund-v_advance_to_restore;';
  v_new text := ' v_cash_refund:=v_refund-v_advance_to_restore;
 if v_cash_refund>0 and coalesce(v_payment_method_count,0)>1 then
  raise exception ''This invoice was paid using multiple methods. Reconcile its original payment split before editing it to a lower total.'';
 end if;';
begin
  select pg_catalog.pg_get_functiondef(
    'private.etihad_edit_sale(uuid,text,jsonb,numeric,numeric,text,text,numeric,text,numeric,numeric,text)'::regprocedure
  ) into v_definition;

  if pg_catalog.strpos(v_definition, v_old)=0 then
    raise exception 'Expected refund calculation was not found; migration stopped';
  end if;

  if pg_catalog.strpos(v_definition, 'multiple methods. Reconcile its original payment split')>0 then
    raise exception 'Multiple-payment refund safeguard is already installed';
  end if;

  v_definition:=pg_catalog.replace(v_definition,v_old,v_new);
  execute v_definition;
end
$migration$;