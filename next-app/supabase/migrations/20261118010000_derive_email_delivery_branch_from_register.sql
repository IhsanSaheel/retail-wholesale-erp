-- Derive email delivery log branch from its saved cash register session.
-- This keeps email logs branch-scoped and avoids trusting incomplete client payloads.
create or replace function public.etihad_set_record_branch_ids()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
 v_branch_ids text[]:=array[]::text[];
 v_supplier_id text;
begin
 if jsonb_typeof(new.data)<>'object' then raise exception 'Record data must be a JSON object'; end if;
 case new.collection
  when 'mberp_customer_credit_limits' then v_branch_ids:=array[]::text[];
  when 'mberp_customer_account_credits' then v_branch_ids:=array[]::text[];
  when 'mberp_suppliers' then v_branch_ids:=array[]::text[];
  when 'mberp_customers' then v_branch_ids:=array[]::text[];
  when 'mberp_loyalty_settings' then v_branch_ids:=array[]::text[];
  when 'mberp_product_taxes' then v_branch_ids:=array[]::text[];
  when 'mberp_branches' then
   if nullif(new.data->>'id','') is null then raise exception 'Branch ID is required'; end if;
   v_branch_ids:=array[new.data->>'id'];
  when 'mberp_email_delivery' then
   select array(
    select distinct x from unnest(array[
     nullif(new.data->>'branchId',''),
     (select coalesce(nullif(s.data->>'branchId',''),s.branch_ids[1])
      from public.etihad_records s
      where s.org_id=new.org_id and s.collection='mberp_cash_registers'
       and s.record_id=new.data->>'sessionId'
      limit 1)
    ]) as refs(x) where x is not null and btrim(x)<>''
   ) into v_branch_ids;
   if coalesce(cardinality(v_branch_ids),0)=0 then
    raise exception 'Cash closing email must reference a saved register session with a valid branch';
   end if;
  when 'mberp_payments' then
   select r.branch_ids into v_branch_ids from public.etihad_records r
   where r.org_id=new.org_id and r.collection='mberp_sales' and r.record_id=new.data->>'saleId';
   if not found then raise exception 'Payment must reference an existing sale in this company'; end if;
  when 'mberp_supplier_payments' then
   select p.data->>'supplierId',p.branch_ids into v_supplier_id,v_branch_ids
   from public.etihad_records p
   where p.org_id=new.org_id and p.collection='mberp_purchases' and p.record_id=new.data->>'purchaseId';
   if not found or coalesce(v_supplier_id,'')='' then
    raise exception 'Supplier payment must reference a purchase linked to a registered supplier';
   end if;
   if nullif(new.data->>'supplierId','') is not null and new.data->>'supplierId'<>v_supplier_id then
    raise exception 'Supplier payment supplier does not match its purchase';
   end if;
   new.data:=new.data||jsonb_build_object('supplierId',v_supplier_id);
  else
   select array(
    select distinct x from jsonb_array_elements_text(jsonb_build_array(
     new.data->>'branchId',new.data->>'fromBranchId',new.data->>'toBranchId'
    )) as refs(x) where x is not null and btrim(x)<>''
   ) into v_branch_ids;
 end case;
 if new.collection not in ('mberp_customer_credit_limits','mberp_customer_account_credits','mberp_suppliers','mberp_customers','mberp_loyalty_settings','mberp_product_taxes')
 and coalesce(cardinality(v_branch_ids),0)=0 then
  raise exception 'A valid branch reference is required for this record';
 end if;
 if new.collection not in ('mberp_branches','mberp_suppliers','mberp_customer_credit_limits','mberp_customer_account_credits','mberp_customers','mberp_loyalty_settings','mberp_product_taxes')
 and exists(select 1 from unnest(v_branch_ids) as b(branch_id)
  where not exists(select 1 from public.etihad_records br
   where br.org_id=new.org_id and br.collection='mberp_branches' and br.record_id=b.branch_id)) then
  raise exception 'Record references a branch that does not exist in this company';
 end if;
 new.branch_ids:=coalesce(v_branch_ids,array[]::text[]);
 return new;
end;
$function$;
