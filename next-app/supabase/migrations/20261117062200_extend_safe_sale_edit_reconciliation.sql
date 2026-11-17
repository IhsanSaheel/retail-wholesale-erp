CREATE OR REPLACE FUNCTION private.etihad_edit_sale(p_org_id uuid, p_sale_id text, p_items jsonb, p_subtotal numeric, p_discount numeric, p_tax_id text, p_tax_name text, p_tax_rate numeric, p_tax_type text, p_tax_amount numeric, p_total numeric, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_user uuid:=auth.uid(); v_role text; v_branches text[]; v_sale record;
 v_branch text; v_old_item record; v_new_item jsonb; v_product record;
 v_batch record; v_alloc record; v_qty numeric; v_left numeric; v_take numeric;
 v_old_qty numeric; v_restored numeric; v_current numeric; v_available numeric;
 v_batch_count integer; v_item_total numeric:=0; v_expected_tax numeric:=0; v_expected_total numeric; v_discount numeric:=0;
 v_paid numeric; v_payment_count integer; v_payment_total numeric;
 v_mov text; v_audit jsonb; v_now timestamptz:=pg_catalog.now();
begin
 if v_user is null then raise exception 'Authentication required'; end if;
 if p_org_id is null or coalesce(p_sale_id,'')='' or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then
  raise exception 'A valid invoice and at least one product are required';
 end if;
 if coalesce(p_subtotal,-1)<0 or coalesce(p_discount,-1)<0 or coalesce(p_tax_amount,-1)<0 or coalesce(p_tax_rate,-1)<0 or coalesce(p_total,-1)<0 then
  raise exception 'Invoice amounts and tax rates must be zero or greater';
 end if;
 select role,coalesce(branch_ids,array[]::text[]) into v_role,v_branches
 from public.etihad_memberships where org_id=p_org_id and user_id=v_user and active=true limit 1;
 if not found or v_role not in ('owner','manager') then
  raise exception 'Only an owner or manager can edit a completed sale';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org_id::text||':edit-sale:'||p_sale_id,0));
 select record_id,data,branch_ids into v_sale from public.etihad_records
 where org_id=p_org_id and collection='mberp_sales' and record_id=p_sale_id for update;
 if not found then raise exception 'Original invoice not found'; end if;
 if coalesce(v_sale.data->>'status','') in ('cancelled','draft','pending','pending_sync') then
  raise exception 'Only a confirmed, active invoice can be edited';
 end if;
 v_branch:=coalesce(v_sale.data->>'branchId',v_sale.branch_ids[1]);
 if v_role<>'owner' and not(v_branch=any(v_branches)) then raise exception 'You do not have access to the original sale branch'; end if;
 if exists(select 1 from public.etihad_records r where r.org_id=p_org_id and r.collection='mberp_sales_returns' and r.data->>'saleId'=p_sale_id) then
  raise exception 'This invoice has previous returns and cannot be edited. Use the return workflow for returned goods.';
 end if;
 if coalesce(nullif(v_sale.data->>'advanceUsed','')::numeric,0)>0
  or coalesce(nullif(v_sale.data->>'priorOutstandingApplied','')::numeric,0)>0
  or coalesce(nullif(v_sale.data->>'customerAdvance','')::numeric,0)>0
  or coalesce(nullif(v_sale.data->>'staffTip','')::numeric,0)>0 then
  raise exception 'This invoice includes an advance, prior-balance settlement or staff tip and needs specialist reconciliation before editing.';
 end if;
 v_paid:=coalesce(nullif(v_sale.data->>'paid','')::numeric,0);
 v_discount:=coalesce(nullif(v_sale.data->>'discount','')::numeric,0);
 if abs(p_discount-v_discount)>0.01 or p_discount>p_subtotal then raise exception 'The original invoice discount must be retained and cannot exceed the revised subtotal.'; end if;
 if p_total+0.01<v_paid then
  raise exception 'The revised total cannot be lower than the amount already paid. Process a refund or account credit first.';
 end if;
 if coalesce(p_tax_type,'none')='inclusive' then
  v_expected_tax:=case when p_tax_rate=0 then 0 else (p_subtotal-p_discount)*p_tax_rate/(100+p_tax_rate) end;
  v_expected_total:=p_subtotal-p_discount;
 elsif coalesce(p_tax_type,'none')='exclusive' then
  v_expected_tax:=(p_subtotal-p_discount)*p_tax_rate/100; v_expected_total:=p_subtotal-p_discount+v_expected_tax;
 elsif coalesce(p_tax_type,'none')='none' then
  v_expected_tax:=0; v_expected_total:=p_subtotal-p_discount;
 else raise exception 'Invalid tax type'; end if;
 if abs(p_tax_amount-v_expected_tax)>0.02 or abs(p_total-v_expected_total)>0.02 then
  raise exception 'Tax or total does not match the revised invoice lines';
 end if;
 select coalesce(sum(coalesce(nullif(x.value->>'qty','')::numeric,0)*coalesce(nullif(x.value->>'price','')::numeric,0)),0)
 into v_item_total from pg_catalog.jsonb_array_elements(p_items) x(value);
 if abs(v_item_total-p_subtotal)>0.02 then raise exception 'Invoice subtotal does not match its revised product lines'; end if;
 if exists(select 1 from pg_catalog.jsonb_array_elements(p_items) x(value)
  where coalesce(x.value->>'productId','')='' or coalesce(nullif(x.value->>'qty','')::numeric,0)<=0
   or coalesce(nullif(x.value->>'price','')::numeric,-1)<0) then
  raise exception 'Each product must have a valid ID, positive quantity and non-negative price';
 end if;
 select count(*),coalesce(sum(coalesce(nullif(r.data->>'amount','')::numeric,0)),0)
 into v_payment_count,v_payment_total
 from public.etihad_records r where r.org_id=p_org_id and r.collection='mberp_payments'
  and r.data->>'saleId'=p_sale_id and r.data->>'type'='sale_payment';
 if abs(v_payment_total-v_paid)>0.01 then
  raise exception 'Recorded payments do not add up to the invoice paid amount. Reconcile its payment history before editing.';
 end if;
 -- Restore the original stock and exact original batch allocations first.
 for v_old_item in
  select value->>'productId' product_id,coalesce(nullif(value->>'qty','')::numeric,0) qty,
   coalesce(value->>'name','Product') product_name
  from pg_catalog.jsonb_array_elements(v_sale.data->'items')
 loop
  if v_old_item.qty<=0 then raise exception 'Original invoice contains an invalid quantity'; end if;
  select record_id,data,branch_ids into v_product from public.etihad_records
   where org_id=p_org_id and collection='mberp_products' and record_id=v_old_item.product_id for update;
  if not found or coalesce(v_product.data->>'branchId',v_product.branch_ids[1])<>v_branch then
   raise exception 'Original product % is missing or no longer assigned to this branch',v_old_item.product_name;
  end if;
  update public.etihad_records set data=pg_catalog.jsonb_set(v_product.data,'{qty}',
   pg_catalog.to_jsonb(coalesce(nullif(v_product.data->>'qty','')::numeric,0)+v_old_item.qty),true),
   updated_by=v_user,updated_at=v_now
  where org_id=p_org_id and collection='mberp_products' and record_id=v_product.record_id;
  select count(*) into v_batch_count from public.etihad_records b
   where b.org_id=p_org_id and b.collection='mberp_stock_batches'
    and b.data->>'productId'=v_old_item.product_id
    and coalesce(b.data->>'branchId',b.branch_ids[1])=v_branch
    and coalesce(b.data->>'status','active')<>'cancelled';
  select coalesce(sum(abs(coalesce(nullif(m.data->>'qty','')::numeric,0))),0) into v_restored
   from public.etihad_records m where m.org_id=p_org_id and m.collection='mberp_stock_batch_movements'
    and m.data->>'type'='sale_deduction' and m.data->>'saleId'=p_sale_id
    and m.data->>'productId'=v_old_item.product_id;
  if v_batch_count>0 and abs(v_restored-v_old_item.qty)>0.000001 then
   raise exception 'Original batch allocation for % is incomplete. No changes were made; use stock reconciliation first.',v_old_item.product_name;
  end if;
  for v_alloc in select record_id,data from public.etihad_records
   where org_id=p_org_id and collection='mberp_stock_batch_movements'
    and data->>'type'='sale_deduction' and data->>'saleId'=p_sale_id
    and data->>'productId'=v_old_item.product_id for update
  loop
   select record_id,data into v_batch from public.etihad_records
    where org_id=p_org_id and collection='mberp_stock_batches'
     and record_id=v_alloc.data->>'batchId' for update;
   if not found then raise exception 'Original stock batch is missing. No changes were made'; end if;
   v_take:=abs(coalesce(nullif(v_alloc.data->>'qty','')::numeric,0));
   update public.etihad_records set data=v_batch.data||pg_catalog.jsonb_build_object(
    'remainingQty',coalesce(nullif(v_batch.data->>'remainingQty','')::numeric,0)+v_take,
    'status',case when coalesce(v_batch.data->>'expiryDate','9999-12-31')::date<current_date then 'expired' else 'active' end,
    'lastSaleEditAt',v_now),updated_by=v_user,updated_at=v_now
   where org_id=p_org_id and collection='mberp_stock_batches' and record_id=v_batch.record_id;
   update public.etihad_records set data=pg_catalog.jsonb_set(data,'{type}',to_jsonb('sale_edit_superseded'::text),true),
    updated_by=v_user,updated_at=v_now
   where org_id=p_org_id and collection='mberp_stock_batch_movements' and record_id=v_alloc.record_id;
   v_mov:=pg_catalog.gen_random_uuid()::text;
   insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
   values(p_org_id,'mberp_stock_batch_movements',v_mov,array[v_branch],
    pg_catalog.jsonb_build_object('id',v_mov,'type','sale_edit_restoration','date',v_now,
     'saleId',p_sale_id,'invoiceNo',v_sale.data->>'invoiceNo','productId',v_old_item.product_id,
     'productName',v_old_item.product_name,'batchId',v_batch.record_id,'batchNo',v_batch.data->>'batchNo',
     'branchId',v_branch,'qty',v_take,'sourceMovementId',v_alloc.record_id,
     'note','Original batch quantity restored during invoice edit'),v_user);
  end loop;
 end loop;
 -- Deduct the revised items and allocate tracked stock by FEFO.
 for v_new_item in select value from pg_catalog.jsonb_array_elements(p_items)
 loop
  v_qty:=coalesce(nullif(v_new_item->>'qty','')::numeric,0);
  select record_id,data,branch_ids into v_product from public.etihad_records
   where org_id=p_org_id and collection='mberp_products' and record_id=v_new_item->>'productId' for update;
  if not found or coalesce(v_product.data->>'branchId',v_product.branch_ids[1])<>v_branch
   or not(v_branch=any(v_product.branch_ids)) then
   raise exception 'Product % is not available at the original invoice branch',coalesce(v_new_item->>'name','');
  end if;
  v_current:=coalesce(nullif(v_product.data->>'qty','')::numeric,0);
  if v_current<v_qty then raise exception 'Insufficient stock for %. Available %, requested %',coalesce(v_new_item->>'name','product'),v_current,v_qty; end if;
  update public.etihad_records set data=pg_catalog.jsonb_set(v_product.data,'{qty}',to_jsonb(v_current-v_qty),true),
   updated_by=v_user,updated_at=v_now
  where org_id=p_org_id and collection='mberp_products' and record_id=v_product.record_id;
  select count(*) into v_batch_count from public.etihad_records b
   where b.org_id=p_org_id and b.collection='mberp_stock_batches'
    and b.data->>'productId'=v_new_item->>'productId'
    and coalesce(b.data->>'branchId',b.branch_ids[1])=v_branch
    and coalesce(b.data->>'status','active')<>'cancelled';
  if v_batch_count>0 then
   select coalesce(sum(coalesce(nullif(b.data->>'remainingQty','')::numeric,0)),0) into v_available
    from public.etihad_records b where b.org_id=p_org_id and b.collection='mberp_stock_batches'
     and b.data->>'productId'=v_new_item->>'productId'
     and coalesce(b.data->>'branchId',b.branch_ids[1])=v_branch
     and coalesce(b.data->>'status','active')='active'
     and coalesce(b.data->>'expiryDate','9999-12-31')::date>=current_date;
   if v_available<v_qty then raise exception 'Insufficient unexpired batch stock for %. Available %, requested %',coalesce(v_new_item->>'name','product'),v_available,v_qty; end if;
   v_left:=v_qty;
   for v_batch in select record_id,data from public.etihad_records b
    where b.org_id=p_org_id and b.collection='mberp_stock_batches'
     and b.data->>'productId'=v_new_item->>'productId'
     and coalesce(b.data->>'branchId',b.branch_ids[1])=v_branch
     and coalesce(b.data->>'status','active')='active'
     and coalesce(b.data->>'expiryDate','9999-12-31')::date>=current_date
     and coalesce(nullif(b.data->>'remainingQty','')::numeric,0)>0
    order by coalesce(b.data->>'expiryDate','9999-12-31'),coalesce(b.data->>'receivedDate','0001-01-01'),b.record_id for update
   loop
    exit when v_left<=0;
    v_take:=least(v_left,coalesce(nullif(v_batch.data->>'remainingQty','')::numeric,0));
    update public.etihad_records set data=v_batch.data||pg_catalog.jsonb_build_object(
     'remainingQty',coalesce(nullif(v_batch.data->>'remainingQty','')::numeric,0)-v_take,
     'lastSaleAt',v_now,'status',case when coalesce(nullif(v_batch.data->>'remainingQty','')::numeric,0)-v_take<=0 then 'depleted' else 'active' end),
     updated_by=v_user,updated_at=v_now
    where org_id=p_org_id and collection='mberp_stock_batches' and record_id=v_batch.record_id;
    v_mov:=pg_catalog.gen_random_uuid()::text;
    insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
    values(p_org_id,'mberp_stock_batch_movements',v_mov,array[v_branch],
     pg_catalog.jsonb_build_object('id',v_mov,'type','sale_deduction','date',v_now,'saleId',p_sale_id,
      'invoiceNo',v_sale.data->>'invoiceNo','productId',v_new_item->>'productId',
      'productName',v_new_item->>'name','batchId',v_batch.record_id,'batchNo',v_batch.data->>'batchNo',
      'branchId',v_branch,'branchName',v_sale.data->>'branchName','qty',-v_take,
      'remainingQtyAfter',coalesce(nullif(v_batch.data->>'remainingQty','')::numeric,0)-v_take,
      'note','FEFO allocation after invoice edit'),v_user);
    v_left:=v_left-v_take;
   end loop;
  end if;
 end loop;
 v_audit:=coalesce(v_sale.data->'editAudit','[]'::jsonb)||pg_catalog.jsonb_build_array(
  pg_catalog.jsonb_build_object('editedAt',v_now,'editedBy',v_user::text,
   'previousItems',v_sale.data->'items','previousSubtotal',v_sale.data->>'subtotal',
   'previousTaxAmount',v_sale.data->>'taxAmount','previousDiscount',v_sale.data->>'discount','previousTotal',v_sale.data->>'total',
   'newItems',p_items,'newSubtotal',p_subtotal,'newDiscount',p_discount,'newTaxAmount',p_tax_amount,'newTotal',p_total));
 update public.etihad_records set data=v_sale.data||pg_catalog.jsonb_build_object(
  'items',p_items,'subtotal',p_subtotal,'discount',p_discount,'taxId',nullif(p_tax_id,''),'taxName',coalesce(p_tax_name,''),
  'taxRate',p_tax_rate,'taxType',coalesce(p_tax_type,'none'),'taxAmount',p_tax_amount,
  'total',p_total,'balance',greatest(0,p_total-v_paid),'note',coalesce(p_note,''),
  'editedAt',v_now,'editedBy',v_user::text,'editAudit',v_audit),
  updated_by=v_user,updated_at=v_now
 where org_id=p_org_id and collection='mberp_sales' and record_id=p_sale_id;
 return pg_catalog.jsonb_build_object('success',true,'saleId',p_sale_id,'invoiceNo',v_sale.data->>'invoiceNo',
  'newTotal',p_total,'paid',v_paid,'balance',greatest(0,p_total-v_paid),'stockAdjusted',true);
end;
$function$
;
create or replace function public.etihad_edit_sale(p_org_id uuid,p_sale_id text,p_items jsonb,p_subtotal numeric,p_discount numeric,p_tax_id text,p_tax_name text,p_tax_rate numeric,p_tax_type text,p_tax_amount numeric,p_total numeric,p_note text)
returns jsonb language sql set search_path=''
as $function$ select private.etihad_edit_sale(p_org_id,p_sale_id,p_items,p_subtotal,p_discount,p_tax_id,p_tax_name,p_tax_rate,p_tax_type,p_tax_amount,p_total,p_note); $function$;
grant usage on schema private to authenticated;
grant execute on function private.etihad_edit_sale(uuid,text,jsonb,numeric,numeric,text,text,numeric,text,numeric,numeric,text) to authenticated,service_role;
revoke all on function private.etihad_edit_sale(uuid,text,jsonb,numeric,numeric,text,text,numeric,text,numeric,numeric,text) from public,anon;
revoke all on function public.etihad_edit_sale(uuid,text,jsonb,numeric,numeric,text,text,numeric,text,numeric,numeric,text) from public,anon;
grant execute on function public.etihad_edit_sale(uuid,text,jsonb,numeric,numeric,text,text,numeric,text,numeric,numeric,text) to authenticated,service_role;
