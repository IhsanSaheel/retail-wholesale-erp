-- Source recovery for the already-applied Supabase migration
-- 20261116151332_validate_pos_previous_outstanding_allocation.
-- The live database already contains this exact function; this file restores
-- the migration source to Git so future environments can reproduce it.
--
-- POS excess tender is allocated to earlier invoices oldest-first. Each
-- destination receives its own payment record and a linked allocation record.
-- Any unallocated remainder aborts checkout atomically; the current sale's
-- payment is not counted again as a prior-invoice payment.

CREATE OR REPLACE FUNCTION private.etihad_create_sale(p_org_id uuid, p_branch_id text, p_sale jsonb, p_cash_applied numeric, p_advance_used numeric, p_customer_advance numeric, p_staff_tip numeric, p_method text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_result jsonb; v_user uuid:=auth.uid(); v_role text; v_branches text[];
 v_phone text:=coalesce(p_sale->>'customerPhone','');
 v_remaining numeric:=coalesce(nullif(p_sale->>'priorOutstandingApplied','')::numeric,0);
 v_due record; v_due_balance numeric; v_due_paid numeric; v_apply numeric; v_payment_id text; v_allocation_id text;
 v_date text:=coalesce(p_sale->>'date',pg_catalog.now()::text);
 v_item jsonb; v_product_id text; v_need numeric; v_batch_count integer; v_available numeric;
 v_batch record; v_take numeric; v_batch_data jsonb; v_movement_id text;
begin
 if v_remaining < 0 then raise exception 'Previous outstanding settlement cannot be negative'; end if;
 select role,coalesce(branch_ids,array[]::text[]) into v_role,v_branches
 from public.etihad_memberships where org_id=p_org_id and user_id=v_user and active=true limit 1;
 if not found then raise exception 'Active business membership required'; end if;
 if v_remaining > 0 and (v_phone='' or coalesce(p_sale->>'customerName','Walk-in Customer')='Walk-in Customer') then
   raise exception 'Select a named customer before settling previous outstanding';
 end if;

 -- The legacy sale function remains responsible for invoice, payment and stock atomicity.
 v_result:=private.etihad_create_sale_legacy(
   p_org_id,p_branch_id,p_sale,p_cash_applied,p_advance_used,p_customer_advance,p_staff_tip,p_method
 );

 -- When a product has batch tracking enabled, enforce unexpired lot availability
 -- and deduct lots FEFO (earliest expiry first) in this same transaction.
 for v_item in select value from pg_catalog.jsonb_array_elements(p_sale->'items') loop
   v_product_id:=coalesce(v_item->>'productId','');
   v_need:=coalesce(nullif(v_item->>'qty','')::numeric,0);
   if v_product_id='' or v_need<=0 then continue; end if;
   select count(*) into v_batch_count
   from public.etihad_records r
   where r.org_id=p_org_id and r.collection='mberp_stock_batches'
     and coalesce(r.data->>'productId','')=v_product_id
     and coalesce(r.data->>'branchId',r.branch_ids[1])=p_branch_id
     and coalesce(r.data->>'status','active')<>'cancelled';
   if v_batch_count=0 then continue; end if;
   select coalesce(sum(coalesce(nullif(r.data->>'remainingQty','')::numeric,0)),0) into v_available
   from public.etihad_records r
   where r.org_id=p_org_id and r.collection='mberp_stock_batches'
     and coalesce(r.data->>'productId','')=v_product_id
     and coalesce(r.data->>'branchId',r.branch_ids[1])=p_branch_id
     and coalesce(r.data->>'status','active')='active'
     and coalesce(r.data->>'expiryDate','9999-12-31')::date>=current_date
     and coalesce(nullif(r.data->>'remainingQty','')::numeric,0)>0;
   if v_available+0.000001<v_need then
     raise exception 'Insufficient unexpired batch stock for product %. Required %, available %.',v_product_id,v_need,v_available;
   end if;
   for v_batch in
     select r.record_id,r.data from public.etihad_records r
     where r.org_id=p_org_id and r.collection='mberp_stock_batches'
       and coalesce(r.data->>'productId','')=v_product_id
       and coalesce(r.data->>'branchId',r.branch_ids[1])=p_branch_id
       and coalesce(r.data->>'status','active')='active'
       and coalesce(r.data->>'expiryDate','9999-12-31')::date>=current_date
       and coalesce(nullif(r.data->>'remainingQty','')::numeric,0)>0
     order by coalesce(r.data->>'expiryDate','9999-12-31'),coalesce(r.data->>'receivedDate','0001-01-01'),r.record_id
     for update
   loop
     exit when v_need<=0;
     v_take:=least(v_need,coalesce(nullif(v_batch.data->>'remainingQty','')::numeric,0));
     v_batch_data:=v_batch.data||pg_catalog.jsonb_build_object(
       'remainingQty',coalesce(nullif(v_batch.data->>'remainingQty','')::numeric,0)-v_take,
       'lastSaleAt',v_date,
       'status',case when coalesce(nullif(v_batch.data->>'remainingQty','')::numeric,0)-v_take<=0 then 'depleted' else 'active' end
     );
     update public.etihad_records set data=v_batch_data,updated_by=v_user,updated_at=pg_catalog.now()
     where org_id=p_org_id and collection='mberp_stock_batches' and record_id=v_batch.record_id;
     v_movement_id:=pg_catalog.gen_random_uuid()::text;
     insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
     values(p_org_id,'mberp_stock_batch_movements',v_movement_id,array[p_branch_id],
       pg_catalog.jsonb_build_object(
         'id',v_movement_id,'type','sale_deduction','date',v_date,
         'saleId',coalesce(v_result->>'saleId',p_sale->>'id'),
         'invoiceNo',coalesce(v_result->>'invoiceNo',p_sale->>'invoiceNo'),
         'productId',v_product_id,'productName',v_item->>'name',
         'batchId',v_batch.record_id,'batchNo',v_batch.data->>'batchNo',
         'branchId',p_branch_id,'branchName',v_batch.data->>'branchName',
         'qty',-v_take,'remainingQtyAfter',v_batch_data->>'remainingQty',
         'note','FEFO sale allocation'),v_user);
     v_need:=v_need-v_take;
   end loop;
 end loop;

 -- Allocate separately identified excess tender to earlier invoices, oldest first.
 for v_due in
   select r.record_id,r.data,r.branch_ids from public.etihad_records r
   where r.org_id=p_org_id and r.collection='mberp_sales'
     and r.record_id<>coalesce(p_sale->>'id','')
     and coalesce(r.data->>'customerPhone','')=v_phone
     and coalesce(nullif(r.data->>'balance','')::numeric,0)>0
     and (v_role='owner' or coalesce(r.data->>'branchId',r.branch_ids[1])=any(v_branches))
   order by coalesce(r.data->>'date',''),r.record_id for update
 loop
   exit when v_remaining<=0;
   v_due_balance:=coalesce(nullif(v_due.data->>'balance','')::numeric,0);
   v_due_paid:=coalesce(nullif(v_due.data->>'paid','')::numeric,0);
   v_apply:=least(v_due_balance,v_remaining);
   update public.etihad_records set data=v_due.data||pg_catalog.jsonb_build_object(
     'balance',v_due_balance-v_apply,'paid',v_due_paid+v_apply,'lastPaymentAt',v_date
   ),updated_by=v_user,updated_at=pg_catalog.now()
   where org_id=p_org_id and collection='mberp_sales' and record_id=v_due.record_id;
   v_payment_id:=pg_catalog.gen_random_uuid()::text;
   insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
   values(p_org_id,'mberp_payments',v_payment_id,coalesce(v_due.branch_ids,array[]::text[]),
     pg_catalog.jsonb_build_object('id',v_payment_id,'date',v_date,'amount',v_apply,
       'method',coalesce(p_method,'Cash'),'type','sale_payment','saleId',v_due.record_id,
       'invoiceNo',v_due.data->>'invoiceNo','receiptNo','REC-'||coalesce(v_due.data->>'invoiceNo',v_due.record_id),
       'branchId',v_due.data->>'branchId','branchName',v_due.data->>'branchName',
       'customerName',v_due.data->>'customerName','customerPhone',v_phone,
       'note','Extra POS tender allocated to previous customer outstanding.'),v_user);
   v_allocation_id:=pg_catalog.gen_random_uuid()::text;
   insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
   values(p_org_id,'mberp_customer_credit_allocations',v_allocation_id,array[]::text[],
     pg_catalog.jsonb_build_object(
       'id',v_allocation_id,'type','prior_balance_settlement','date',v_date,
       'saleId',coalesce(v_result->>'saleId',p_sale->>'id'),
       'settledSaleId',v_due.record_id,'paymentId',v_payment_id,
       'amount',v_apply,'method',coalesce(p_method,'Cash'),
       'customerName',v_due.data->>'customerName','customerPhone',v_phone,
       'branchId',v_due.data->>'branchId','invoiceNo',v_due.data->>'invoiceNo',
       'sourceInvoiceNo',coalesce(v_result->>'invoiceNo',p_sale->>'invoiceNo'),
       'status','active','note','Exact previous-invoice settlement allocation captured at checkout.'
     ),v_user);
   v_remaining:=v_remaining-v_apply;
 end loop;
 if v_remaining>0 then raise exception 'Previous outstanding changed during checkout. Refresh the customer account and try again.'; end if;
 return v_result||pg_catalog.jsonb_build_object('previousOutstandingPaid',coalesce(nullif(p_sale->>'priorOutstandingApplied','')::numeric,0));
end;
$function$;
