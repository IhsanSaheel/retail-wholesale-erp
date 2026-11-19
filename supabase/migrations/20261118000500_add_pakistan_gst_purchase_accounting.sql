create or replace function private.etihad_create_purchase(
 p_org_id uuid,p_branch_id text,p_purchase jsonb,p_paid numeric,p_method text
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
 v_user uuid:=auth.uid();v_role text;v_branches text[];v_product record;
 v_qty numeric;v_cost numeric;v_stock numeric;v_id text;v_payment_id text;v_batch_id text;
 v_batch_no text;v_expiry text;v_subtotal numeric;v_rate numeric;v_tax numeric;
 v_recoverable boolean;v_input_tax numeric;v_nonrecoverable numeric;v_inventory_cost numeric;v_total numeric;
begin
 if v_user is null then raise exception 'Authentication required'; end if;
 if coalesce(p_branch_id,'')='' or coalesce(p_purchase->>'productId','')='' then raise exception 'Branch and product are required'; end if;
 select role,coalesce(branch_ids,array[]::text[]) into v_role,v_branches from public.etihad_memberships
 where org_id=p_org_id and user_id=v_user and active=true limit 1;
 if not found then raise exception 'Active business membership required'; end if;
 if v_role not in ('owner','manager','stockkeeper','accountant') then raise exception 'Your role cannot record purchases'; end if;
 if v_role<>'owner' and not(p_branch_id=any(v_branches)) then raise exception 'You do not have access to this branch'; end if;
 v_qty:=coalesce(nullif(p_purchase->>'qty','')::numeric,0);
 v_cost:=coalesce(nullif(p_purchase->>'cost','')::numeric,0);
 v_rate:=coalesce(nullif(p_purchase->>'taxRate','')::numeric,0);
 v_recoverable:=coalesce((p_purchase->>'inputTaxRecoverable')::boolean,false);
 v_subtotal:=round(v_qty*v_cost,2);
 if v_qty<=0 or v_cost<0 or v_rate<0 or v_rate>100 then raise exception 'Check purchase quantity, unit cost and GST rate'; end if;
 if coalesce(p_purchase->>'taxType','None') not in ('None','GST') then raise exception 'Unsupported purchase tax type'; end if;
 if coalesce(p_purchase->>'taxType','None')='None' and v_rate<>0 then raise exception 'Tax rate must be zero when GST is not applied'; end if;
 v_tax:=round(v_subtotal*v_rate/100,2);
 if v_recoverable and (v_tax<=0 or coalesce(btrim(p_purchase->>'supplierStrn'),'')='' or coalesce(btrim(p_purchase->>'buyerStrn'),'')='' or coalesce(btrim(p_purchase->>'taxInvoiceNo'),'')='') then
  raise exception 'Recoverable input tax requires supplier STRN, buyer STRN and tax invoice reference';
 end if;
 v_input_tax:=case when v_recoverable then v_tax else 0 end;
 v_nonrecoverable:=v_tax-v_input_tax;
 v_inventory_cost:=round(v_cost+(v_nonrecoverable/nullif(v_qty,0)),4);
 v_total:=v_subtotal+v_tax;
 if abs(coalesce(nullif(p_purchase->>'total','')::numeric,-1)-v_total)>0.01 then raise exception 'Purchase total does not match subtotal plus GST'; end if;
 if coalesce(p_paid,0)<0 or p_paid>v_total then raise exception 'Purchase payment must be between zero and purchase total'; end if;
 v_batch_no:=nullif(pg_catalog.btrim(coalesce(p_purchase->>'batchNo','')),'');
 v_expiry:=nullif(pg_catalog.btrim(coalesce(p_purchase->>'expiryDate','')),'');
 if (v_batch_no is null)<>(v_expiry is null) then raise exception 'Enter both batch / lot number and expiry date, or leave both blank'; end if;
 if v_expiry is not null and v_expiry::date<coalesce(nullif(p_purchase->>'date','')::date,current_date) then raise exception 'Expiry date cannot be earlier than the purchase date'; end if;
 select record_id,data,branch_ids into v_product from public.etihad_records
 where org_id=p_org_id and collection='mberp_products' and record_id=p_purchase->>'productId' for update;
 if not found then raise exception 'Selected product does not exist'; end if;
 if coalesce(v_product.data->>'branchId','')<>p_branch_id or not(p_branch_id=any(v_product.branch_ids)) then raise exception 'Selected product is not assigned to this branch'; end if;
 v_stock:=coalesce(nullif(v_product.data->>'qty','')::numeric,0);
 update public.etihad_records set data=pg_catalog.jsonb_set(
  pg_catalog.jsonb_set(v_product.data,'{qty}',pg_catalog.to_jsonb(v_stock+v_qty),true),
  '{cost}',pg_catalog.to_jsonb(v_inventory_cost),true
 ),updated_by=v_user,updated_at=pg_catalog.now()
 where org_id=p_org_id and collection='mberp_products' and record_id=v_product.record_id;
 v_id:=coalesce(nullif(p_purchase->>'id',''),pg_catalog.gen_random_uuid()::text);
 insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
 values(p_org_id,'mberp_purchases',v_id,array[p_branch_id],
  p_purchase||pg_catalog.jsonb_build_object('id',v_id,'subtotal',v_subtotal,'taxAmount',v_tax,
   'inputTax',v_input_tax,'nonRecoverableTax',v_nonrecoverable,'inventoryUnitCost',v_inventory_cost,
   'total',v_total,'paid',p_paid,'balance',v_total-p_paid),v_user);
 if v_batch_no is not null then
  v_batch_id:=pg_catalog.gen_random_uuid()::text;
  insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
  values(p_org_id,'mberp_stock_batches',v_batch_id,array[p_branch_id],
   pg_catalog.jsonb_build_object('id',v_batch_id,'productId',p_purchase->>'productId',
    'productName',p_purchase->>'productName','branchId',p_branch_id,'branchName',p_purchase->>'branchName',
    'batchNo',v_batch_no,'qty',v_qty,'remainingQty',v_qty,'receivedDate',coalesce(nullif(p_purchase->>'date',''),current_date::text),
    'expiryDate',v_expiry,'purchaseId',v_id,'supplierId',p_purchase->>'supplierId',
    'supplierName',p_purchase->>'supplierName','status','active'),v_user);
 end if;
 if coalesce(p_paid,0)>0 then
  v_payment_id:=pg_catalog.gen_random_uuid()::text;
  insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
  values(p_org_id,'mberp_supplier_payments',v_payment_id,array[p_branch_id],
   pg_catalog.jsonb_build_object('id',v_payment_id,'date',p_purchase->>'date','amount',p_paid,'method',coalesce(p_method,'Cash'),
    'type','purchase_payment','purchaseId',v_id,'supplierName',coalesce(p_purchase->>'supplierName',''),
    'supplierId',coalesce(p_purchase->>'supplierId',''),'branchId',p_branch_id,'branchName',coalesce(p_purchase->>'branchName','')),v_user);
 end if;
 return pg_catalog.jsonb_build_object('success',true,'purchaseId',v_id,'stockAdded',v_qty,'batchCreated',v_batch_no is not null);
end;$function$;

create or replace function private.etihad_create_purchase_idempotent(
 p_org_id uuid,p_branch_id text,p_purchase jsonb,p_paid numeric,p_method text
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
 v_user uuid:=auth.uid();v_role text;v_branches text[];v_existing public.etihad_records%rowtype;
 v_id text;v_expected jsonb;v_qty numeric;v_cost numeric;v_subtotal numeric;v_total numeric;
 v_rate numeric;v_tax numeric;v_recoverable boolean;v_input_tax numeric;v_inventory_cost numeric;v_supplier_id text;
begin
 if v_user is null then raise exception 'Authentication required'; end if;
 if p_purchase is null or coalesce(p_purchase->>'id','')='' then raise exception 'A stable purchase reference is required'; end if;
 if coalesce(p_branch_id,'')='' or coalesce(p_purchase->>'branchId','')<>p_branch_id then raise exception 'Purchase branch does not match the selected branch'; end if;
 v_qty:=coalesce(nullif(p_purchase->>'qty','')::numeric,0);v_cost:=coalesce(nullif(p_purchase->>'cost','')::numeric,0);
 v_rate:=coalesce(nullif(p_purchase->>'taxRate','')::numeric,0);v_recoverable:=coalesce((p_purchase->>'inputTaxRecoverable')::boolean,false);
 v_subtotal:=round(v_qty*v_cost,2);v_tax:=round(v_subtotal*v_rate/100,2);
 v_input_tax:=case when v_recoverable then v_tax else 0 end;
 v_inventory_cost:=round(v_cost+((v_tax-v_input_tax)/nullif(v_qty,0)),4);
 v_total:=v_subtotal+v_tax;
 if v_qty<=0 or v_cost<0 or v_rate<0 or v_rate>100 or coalesce(nullif(p_purchase->>'total','')::numeric,-1)<>v_total
  or abs(coalesce(nullif(p_purchase->>'subtotal','')::numeric,-1)-v_subtotal)>0.01
  or abs(coalesce(nullif(p_purchase->>'taxAmount','')::numeric,-1)-v_tax)>0.01
  or abs(coalesce(nullif(p_purchase->>'inventoryUnitCost','')::numeric,-1)-v_inventory_cost)>0.01 then
  raise exception 'Purchase subtotal, GST and total do not match the entered quantities and rates';
 end if;
 if coalesce(p_purchase->>'taxType','None') not in ('None','GST') or (coalesce(p_purchase->>'taxType','None')='None' and v_rate<>0) then raise exception 'Invalid purchase GST selection'; end if;
 if v_recoverable and (v_tax<=0 or coalesce(btrim(p_purchase->>'supplierStrn'),'')='' or coalesce(btrim(p_purchase->>'buyerStrn'),'')='' or coalesce(btrim(p_purchase->>'taxInvoiceNo'),'')='') then raise exception 'Recoverable input tax requires supplier STRN, buyer STRN and tax invoice reference'; end if;
 if coalesce(p_paid,0)<0 or p_paid>v_total then raise exception 'Purchase payment must be between zero and purchase total'; end if;
 v_supplier_id:=coalesce(p_purchase->>'supplierId','');if v_supplier_id='' then raise exception 'Select a registered supplier before recording a purchase'; end if;
 if not exists(select 1 from public.etihad_records s where s.org_id=p_org_id and s.collection='mberp_suppliers' and s.record_id=v_supplier_id and coalesce((s.data->>'active')::boolean,true)) then raise exception 'Selected supplier does not exist or is inactive'; end if;
 select role,coalesce(branch_ids,array[]::text[]) into v_role,v_branches from public.etihad_memberships where org_id=p_org_id and user_id=v_user and active=true limit 1;
 if not found then raise exception 'Active business membership required'; end if;
 if v_role not in ('owner','manager','stockkeeper','accountant') then raise exception 'Your role cannot record purchases'; end if;
 if v_role<>'owner' and not(p_branch_id=any(v_branches)) then raise exception 'You do not have access to this branch'; end if;
 v_id:=p_purchase->>'id';perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org_id::text||':purchase:'||v_id,0));
 v_expected:=p_purchase||pg_catalog.jsonb_build_object('id',v_id,'subtotal',v_subtotal,'taxAmount',v_tax,
  'inputTax',v_input_tax,'nonRecoverableTax',v_tax-v_input_tax,'inventoryUnitCost',v_inventory_cost,
  'total',v_total,'paid',p_paid,'balance',v_total-p_paid);
 select * into v_existing from public.etihad_records where org_id=p_org_id and collection='mberp_purchases' and record_id=v_id for update;
 if found then
  if v_existing.updated_by=v_user and v_existing.data=v_expected then return pg_catalog.jsonb_build_object('success',true,'purchaseId',v_id,'alreadyRecorded',true,'stockAdded',0); end if;
  raise exception 'This purchase reference already exists with different or unauthorised details';
 end if;
 return private.etihad_create_purchase(p_org_id,p_branch_id,p_purchase,p_paid,p_method);
end;$function$;

revoke all on function private.etihad_create_purchase(uuid,text,jsonb,numeric,text) from public,anon,authenticated;
revoke all on function private.etihad_create_purchase_idempotent(uuid,text,jsonb,numeric,text) from public,anon,authenticated;
grant execute on function public.etihad_create_purchase(uuid,text,jsonb,numeric,text) to authenticated;

-- The public API wrapper must run with its owner privileges to invoke private helpers.
create or replace function public.etihad_create_purchase(
 p_org_id uuid,p_branch_id text,p_purchase jsonb,p_paid numeric,p_method text
) returns jsonb language sql security definer set search_path = '' as $function$
 select private.etihad_create_purchase_idempotent(p_org_id,p_branch_id,p_purchase,p_paid,p_method);
$function$;
revoke all on function public.etihad_create_purchase(uuid,text,jsonb,numeric,text) from public,anon;
grant execute on function public.etihad_create_purchase(uuid,text,jsonb,numeric,text) to authenticated;
