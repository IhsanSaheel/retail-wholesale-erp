-- Keep legacy invoices protected when an advance payment exists but its
-- original customer-credit source allocation cannot be proven.
do $$
declare
  v_def text;
  v_old text := $old$if coalesce(nullif(v_sale.data->>'customerAdvance','')::numeric,0)>0
  or coalesce(nullif(v_sale.data->>'staffTip','')::numeric,0)>0 then
  raise exception 'This invoice includes an unused customer advance or staff tip. Those allocations still require reconciliation before editing.';
 end if;$old$;
  v_new text := $new$if coalesce(nullif(v_sale.data->>'customerAdvance','')::numeric,0)>0
  or coalesce(nullif(v_sale.data->>'staffTip','')::numeric,0)>0
  or exists (
    select 1
    from public.etihad_records ap
    where ap.org_id=p_org_id
      and ap.collection='mberp_payments'
      and ap.data->>'saleId'=p_sale_id
      and ap.data->>'type'='advance_applied'
      and coalesce(nullif(ap.data->>'amount','')::numeric,0)>0
  ) then
  raise exception 'This invoice includes a customer advance or staff tip whose source allocation is not fully reconciled. It is protected from editing until its history is reconciled.';
 end if;$new$;
begin
 select pg_get_functiondef('private.etihad_edit_sale(uuid,text,jsonb,numeric,numeric,text,text,numeric,text,numeric,numeric,text)'::regprocedure) into v_def;
 if position(v_old in v_def)=0 then
   raise exception 'Expected invoice-edit protection block not found; no change applied';
 end if;
 v_def := replace(v_def,v_old,v_new);
 execute v_def;
end $$;
