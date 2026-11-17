-- Permit edits involving an applied customer advance only when its payment
-- amount, invoice advanceUsed amount, active allocations, and source-credit
-- customer links all reconcile exactly. Unused advances and staff tips remain
-- protected pending their own reversal logic.
do $$
declare
  v_def text;
  v_old text := $old$if coalesce(nullif(v_sale.data->>'customerAdvance','')::numeric,0)>0
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
 end if;$old$;
  v_new text := $new$if coalesce(nullif(v_sale.data->>'customerAdvance','')::numeric,0)>0
  or coalesce(nullif(v_sale.data->>'staffTip','')::numeric,0)>0
  or (
    exists (select 1 from public.etihad_records ap
      where ap.org_id=p_org_id and ap.collection='mberp_payments'
       and ap.data->>'saleId'=p_sale_id and ap.data->>'type'='advance_applied'
       and coalesce(nullif(ap.data->>'amount','')::numeric,0)>0)
    and (
      (select count(*) from public.etihad_records ap where ap.org_id=p_org_id
       and ap.collection='mberp_payments' and ap.data->>'saleId'=p_sale_id
       and ap.data->>'type'='advance_applied')<>1
      or abs(coalesce(nullif(v_sale.data->>'advanceUsed','')::numeric,0)-
       (select coalesce(sum(coalesce(nullif(ap.data->>'amount','')::numeric,0)),0)
        from public.etihad_records ap where ap.org_id=p_org_id
         and ap.collection='mberp_payments' and ap.data->>'saleId'=p_sale_id
         and ap.data->>'type'='advance_applied'))>0.01
      or abs(
       (select coalesce(sum(coalesce(nullif(a.data->>'amount','')::numeric,0)),0)
        from public.etihad_records a where a.org_id=p_org_id
         and a.collection='mberp_customer_credit_allocations'
         and a.data->>'saleId'=p_sale_id and a.data->>'type'='advance_applied'
         and coalesce(a.data->>'status','active')='active')
       -
       (select coalesce(sum(coalesce(nullif(ap.data->>'amount','')::numeric,0)),0)
        from public.etihad_records ap where ap.org_id=p_org_id
         and ap.collection='mberp_payments' and ap.data->>'saleId'=p_sale_id
         and ap.data->>'type'='advance_applied'))>0.01
      or exists(select 1 from public.etihad_records a where a.org_id=p_org_id
       and a.collection='mberp_customer_credit_allocations'
       and a.data->>'saleId'=p_sale_id and a.data->>'type'='advance_applied'
       and coalesce(a.data->>'status','active')='active'
       and (coalesce(a.data->>'sourceCreditId','')=''
        or not exists(select 1 from public.etihad_records c
         where c.org_id=p_org_id and c.collection='mberp_customer_account_credits'
          and c.record_id=a.data->>'sourceCreditId'
          and c.data->>'customerPhone'=v_sale.data->>'customerPhone')))
    )
  ) then
  raise exception 'This invoice includes a customer advance or staff tip whose source allocation is not fully reconciled. It is protected from editing until its history is reconciled.';
 end if;$new$;
begin
 select pg_get_functiondef('private.etihad_edit_sale(uuid,text,jsonb,numeric,numeric,text,text,numeric,text,numeric,numeric,text)'::regprocedure) into v_def;
 if position(v_old in v_def)=0 then raise exception 'Expected guard block not found; no change applied'; end if;
 execute replace(v_def,v_old,v_new);
end $$;
