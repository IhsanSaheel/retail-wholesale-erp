-- Safe cancellation support for invoices that settled prior customer balances.
-- Exact destination invoices are reopened and their linked payment/allocation
-- records reversed. The prior settlement is refunded separately from the new
-- invoice's own payment. Any mismatch or destination return blocks cancellation.

CREATE OR REPLACE FUNCTION private.etihad_cancel_sale(p_org_id uuid, p_sale_id text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_user uuid:=auth.uid(); v_role text; v_branches text[];
 v_sale record; v_item record; v_product record; v_alloc record; v_batch record;
 v_branch text; v_qty numeric; v_left numeric; v_take numeric; v_current numeric;
 v_paid numeric; v_method text; v_refund_id text; v_movement_id text;
 v_advance_used numeric:=0; v_cash_refund numeric:=0; v_advance_restored numeric:=0;
 v_advance_allocation_total numeric:=0;
 v_advance_payment record; v_advance_alloc record; v_credit record;
 v_advance_payment_count integer:=0; v_sale_payment_methods integer:=0; v_sale_payment_total numeric:=0; v_recorded_method text;
 v_prior_alloc record; v_prior_payment record; v_prior_sale record;
 v_prior_total numeric:=0; v_prior_amount numeric:=0; v_prior_refund numeric:=0; v_prior_method text;
 v_audit jsonb; v_now timestamptz:=pg_catalog.now();
begin
 if v_user is null then raise exception 'Authentication required'; end if;
 if coalesce(p_sale_id,'')='' or length(btrim(coalesce(p_reason,'')))<3 then
  raise exception 'A sale reference and cancellation reason (at least 3 characters) are required';
 end if;
 select role,coalesce(branch_ids,array[]::text[]) into v_role,v_branches
 from public.etihad_memberships where org_id=p_org_id and user_id=v_user and active=true limit 1;
 if not found or v_role not in ('owner','manager') then
  raise exception 'Only an owner or manager can cancel a completed sale';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org_id::text||':cancel-sale:'||p_sale_id,0));
 select record_id,data,branch_ids into v_sale from public.etihad_records
 where org_id=p_org_id and collection='mberp_sales' and record_id=p_sale_id for update;
 if not found then raise exception 'Original invoice not found'; end if;
 if v_sale.data->>'status'='cancelled' then
  return pg_catalog.jsonb_build_object('success',true,'alreadyCancelled',true,'saleId',p_sale_id);
 end if;
 v_branch:=coalesce(v_sale.data->>'branchId',v_sale.branch_ids[1]);
 if v_role<>'owner' and not(v_branch=any(v_branches)) then
  raise exception 'You do not have access to the original sale branch';
 end if;
 if exists(select 1 from public.etihad_records r where r.org_id=p_org_id
  and r.collection='mberp_sales_returns' and r.data->>'saleId'=p_sale_id) then
  raise exception 'This invoice has previous returns. Reconcile those returns before cancelling the remaining sale.';
 end if;
 if coalesce(nullif(v_sale.data->>'customerAdvance','')::numeric,0)>0
  or coalesce(nullif(v_sale.data->>'staffTip','')::numeric,0)>0 then
  raise exception 'This invoice includes an unused customer advance or staff tip. It needs specialist account reconciliation and cannot be cancelled by this action.';
 end if;
 if coalesce(v_sale.data->>'status','') in ('draft','pending','pending_sync') then
  raise exception 'Only a confirmed cloud sale can be cancelled';
 end if;
 v_paid:=coalesce(nullif(v_sale.data->>'paid','')::numeric,0);
 if v_paid<0 then raise exception 'Invoice has an invalid paid amount'; end if;
 v_method:=coalesce(nullif(v_sale.data->>'paymentMethod',''),'Cash');
 v_cash_refund:=v_paid;
 v_advance_used:=coalesce(nullif(v_sale.data->>'advanceUsed','')::numeric,0);
 if v_advance_used<0 then raise exception 'Invoice has an invalid customer advance amount'; end if;
 if v_advance_used=0 and exists(select 1 from public.etihad_records ap
  where ap.org_id=p_org_id and ap.collection='mberp_payments'
   and ap.data->>'saleId'=p_sale_id and ap.data->>'type'='advance_applied'
   and coalesce(nullif(ap.data->>'amount','')::numeric,0)>0) then
  raise exception 'Invoice has an advance payment but no matching advanceUsed amount. Reconcile it before cancellation.';
 end if;
 if v_advance_used>0 then
  select count(*),coalesce(sum(coalesce(nullif(data->>'amount','')::numeric,0)),0)
   into v_advance_payment_count,v_cash_refund
  from public.etihad_records where org_id=p_org_id and collection='mberp_payments'
   and data->>'saleId'=p_sale_id and data->>'type'='advance_applied';
  if v_advance_payment_count<>1 or abs(v_cash_refund-v_advance_used)>0.01 then
   raise exception 'Customer advance payment history is incomplete. Reconcile it before cancelling this invoice.';
  end if;
  select coalesce(sum(coalesce(nullif(data->>'amount','')::numeric,0)),0)
   into v_advance_allocation_total
  from public.etihad_records where org_id=p_org_id
   and collection='mberp_customer_credit_allocations'
   and data->>'saleId'=p_sale_id and data->>'type'='advance_applied'
   and coalesce(data->>'status','active')='active';
  if abs(v_advance_allocation_total-v_advance_used)>0.01 then
   raise exception 'Customer advance source allocations are incomplete. Reconcile them before cancelling this invoice.';
  end if;
  if exists(select 1 from public.etihad_records a
   where a.org_id=p_org_id and a.collection='mberp_customer_credit_allocations'
    and a.data->>'saleId'=p_sale_id and a.data->>'type'='advance_applied'
    and coalesce(a.data->>'status','active')='active'
    and (coalesce(a.data->>'sourceCreditId','')=''
     or not exists(select 1 from public.etihad_records c
      where c.org_id=p_org_id and c.collection='mberp_customer_account_credits'
       and c.record_id=a.data->>'sourceCreditId'
       and c.data->>'customerPhone'=v_sale.data->>'customerPhone'))) then
   raise exception 'A customer advance source record is missing or belongs to another customer.';
  end if;
  select coalesce(sum(coalesce(nullif(data->>'amount','')::numeric,0)),0),
         count(distinct data->>'method') filter(where data->>'type'='sale_payment'),
         max(data->>'method') filter(where data->>'type'='sale_payment')
   into v_sale_payment_total,v_sale_payment_methods,v_recorded_method
  from public.etihad_records where org_id=p_org_id and collection='mberp_payments'
   and data->>'saleId'=p_sale_id and data->>'type'='sale_payment';
  if abs(v_sale_payment_total-(v_paid-v_advance_used))>0.01 or v_sale_payment_methods>1
    or (v_sale_payment_methods=1 and v_recorded_method is distinct from v_method) then
   raise exception 'Cash and customer-advance payment history does not reconcile. Reconcile payment methods before cancelling this invoice.';
  end if;
  v_cash_refund:=greatest(0,v_paid-v_advance_used);
 end if;

 -- Reverse exact prior-invoice settlements recorded against this checkout.
 -- The destination invoice is reopened and the original tender is refunded.
 v_prior_total:=coalesce((
  select sum(coalesce(nullif(a.data->>'amount','')::numeric,0))
  from public.etihad_records a
  where a.org_id=p_org_id and a.collection='mberp_customer_credit_allocations'
   and a.data->>'saleId'=p_sale_id
   and a.data->>'type'='prior_balance_settlement'
   and coalesce(a.data->>'status','active')='active'
 ),0);
 if abs(v_prior_total-coalesce(nullif(v_sale.data->>'priorOutstandingApplied','')::numeric,0))>0.01 then
  raise exception 'Previous-invoice settlement allocations do not reconcile. Cancellation stopped.';
 end if;
 if v_prior_total>0 then
  select coalesce(sum(coalesce(nullif(data->>'amount','')::numeric,0)),0),
         count(distinct data->>'method') filter(where data->>'type'='sale_payment'),
         max(data->>'method') filter(where data->>'type'='sale_payment')
   into v_sale_payment_total,v_sale_payment_methods,v_recorded_method
  from public.etihad_records
  where org_id=p_org_id and collection='mberp_payments'
   and data->>'saleId'=p_sale_id and data->>'type'='sale_payment';
  if abs(v_sale_payment_total-(v_paid-v_advance_used))>0.01
    or v_sale_payment_methods>1
    or (v_sale_payment_methods=1 and v_recorded_method is distinct from v_method) then
   raise exception 'The source invoice cash payment history does not reconcile. Cancellation stopped.';
  end if;

  for v_prior_alloc in
   select a.record_id,a.data
   from public.etihad_records a
   where a.org_id=p_org_id and a.collection='mberp_customer_credit_allocations'
    and a.data->>'saleId'=p_sale_id
    and a.data->>'type'='prior_balance_settlement'
    and coalesce(a.data->>'status','active')='active'
   order by coalesce(a.data->>'date',''),a.record_id
   for update
  loop
   v_prior_amount:=coalesce(nullif(v_prior_alloc.data->>'amount','')::numeric,0);
   if v_prior_amount<=0 then raise exception 'A prior-balance allocation has an invalid amount.'; end if;

   select record_id,data into v_prior_payment
   from public.etihad_records
   where org_id=p_org_id and collection='mberp_payments'
    and record_id=v_prior_alloc.data->>'paymentId'
   for update;
   if not found
    or v_prior_payment.data->>'type'<>'sale_payment'
    or v_prior_payment.data->>'saleId' is distinct from v_prior_alloc.data->>'settledSaleId'
    or abs(coalesce(nullif(v_prior_payment.data->>'amount','')::numeric,0)-v_prior_amount)>0.01 then
    raise exception 'A linked previous-invoice payment is missing or no longer matches its allocation.';
   end if;

   select record_id,data,branch_ids into v_prior_sale
   from public.etihad_records
   where org_id=p_org_id and collection='mberp_sales'
    and record_id=v_prior_alloc.data->>'settledSaleId'
   for update;
   if not found then raise exception 'The invoice settled by this payment no longer exists.'; end if;
   if v_prior_sale.data->>'status'='cancelled'
     or coalesce(v_prior_sale.data->>'status','') in ('draft','pending','pending_sync') then
    raise exception 'A destination invoice is not eligible for settlement reversal.';
   end if;
   if v_role<>'owner'
     and coalesce(v_prior_sale.data->>'branchId',v_prior_sale.branch_ids[1])<>any(v_branches) then
    raise exception 'You do not have access to a destination invoice branch required for this cancellation.';
   end if;
   if exists(select 1 from public.etihad_records r
     where r.org_id=p_org_id and r.collection='mberp_sales_returns'
      and r.data->>'saleId'=v_prior_sale.record_id) then
    raise exception 'A destination invoice has returns. Reconcile that invoice before reversing its settlement.';
   end if;
   if coalesce(nullif(v_prior_sale.data->>'paid','')::numeric,0)+0.01<v_prior_amount then
    raise exception 'The destination invoice paid total is insufficient to reverse this settlement.';
   end if;

   update public.etihad_records
   set data=v_prior_sale.data||pg_catalog.jsonb_build_object(
     'paid',coalesce(nullif(v_prior_sale.data->>'paid','')::numeric,0)-v_prior_amount,
     'balance',coalesce(nullif(v_prior_sale.data->>'balance','')::numeric,0)+v_prior_amount,
     'lastSettlementReversedAt',v_now,
     'lastSettlementReversedFrom',p_sale_id
   ),updated_by=v_user,updated_at=v_now
   where org_id=p_org_id and collection='mberp_sales' and record_id=v_prior_sale.record_id;

   update public.etihad_records
   set data=v_prior_payment.data||pg_catalog.jsonb_build_object(
     'originalAmount',v_prior_amount,'amount',0,'type','prior_balance_reversed',
     'reversedAmount',v_prior_amount,'lastReversedAt',v_now,
     'note',coalesce(v_prior_payment.data->>'note','')||' Reversed because source checkout was cancelled.'
   ),updated_by=v_user,updated_at=v_now
   where org_id=p_org_id and collection='mberp_payments' and record_id=v_prior_payment.record_id;

   update public.etihad_records
   set data=v_prior_alloc.data||pg_catalog.jsonb_build_object(
     'originalAmount',v_prior_amount,'amount',0,'status','reversed',
     'reversedAmount',v_prior_amount,'reversedAt',v_now,
     'reversalReason',btrim(p_reason)
   ),updated_by=v_user,updated_at=v_now
   where org_id=p_org_id and collection='mberp_customer_credit_allocations'
    and record_id=v_prior_alloc.record_id;

   v_prior_method:=coalesce(nullif(v_prior_payment.data->>'method',''),v_method);
   v_refund_id:=pg_catalog.gen_random_uuid()::text;
   insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
   values(p_org_id,'mberp_payments',v_refund_id,array[v_branch],
    pg_catalog.jsonb_build_object(
     'id',v_refund_id,'date',v_now,'amount',v_prior_amount,
     'method',v_prior_method,'type','sales_return_refund',
     'saleId',p_sale_id,'invoiceNo',v_sale.data->>'invoiceNo',
     'customerName',v_sale.data->>'customerName',
     'customerPhone',v_sale.data->>'customerPhone',
     'branchId',v_branch,'branchName',v_sale.data->>'branchName',
     'note','Refund of previous-invoice settlement after source invoice cancellation.',
     'cancellation',true,'priorBalanceSettlementReversal',true,
     'originalPaymentId',v_prior_payment.record_id
    ),v_user);
   v_prior_refund:=v_prior_refund+v_prior_amount;
  end loop;
 end if;

 for v_item in
  select value->>'productId' as product_id,
   coalesce(max(value->>'name'),'Product') as product_name,
   sum(coalesce(nullif(value->>'qty','')::numeric,0)) as qty
  from pg_catalog.jsonb_array_elements(v_sale.data->'items')
  group by value->>'productId'
 loop
  if coalesce(v_item.product_id,'')='' or v_item.qty<=0 then
   raise exception 'Invoice contains an invalid product line; no changes were made';
  end if;
  select record_id,data,branch_ids into v_product from public.etihad_records
  where org_id=p_org_id and collection='mberp_products' and record_id=v_item.product_id for update;
  if not found then raise exception 'Product % no longer exists; cancellation was stopped',v_item.product_name; end if;
  if coalesce(v_product.data->>'branchId',v_product.branch_ids[1])<>v_branch
   or not(v_branch=any(v_product.branch_ids)) then
   raise exception 'Product % is not assigned to the original sale branch; cancellation was stopped',v_item.product_name;
  end if;
  v_current:=coalesce(nullif(v_product.data->>'qty','')::numeric,0);
  update public.etihad_records set data=pg_catalog.jsonb_set(v_product.data,'{qty}',
   pg_catalog.to_jsonb(v_current+v_item.qty),true),updated_by=v_user,updated_at=v_now
  where org_id=p_org_id and collection='mberp_products' and record_id=v_product.record_id;

  v_left:=v_item.qty;
  for v_alloc in
   select record_id,data from public.etihad_records
   where org_id=p_org_id and collection='mberp_stock_batch_movements'
    and data->>'type'='sale_deduction' and data->>'saleId'=p_sale_id
    and data->>'productId'=v_item.product_id
   order by coalesce(data->>'date',''),record_id for update
  loop
   exit when v_left<=0;
   select record_id,data into v_batch from public.etihad_records
   where org_id=p_org_id and collection='mberp_stock_batches'
    and record_id=v_alloc.data->>'batchId' for update;
   if not found then continue; end if;
   v_take:=least(v_left,abs(coalesce(nullif(v_alloc.data->>'qty','')::numeric,0)));
   if v_take<=0 then continue; end if;
   update public.etihad_records set data=v_batch.data||pg_catalog.jsonb_build_object(
    'remainingQty',coalesce(nullif(v_batch.data->>'remainingQty','')::numeric,0)+v_take,
    'status',case when coalesce(v_batch.data->>'expiryDate','9999-12-31')::date<current_date then 'expired' else 'active' end,
    'lastCancellationAt',v_now
   ),updated_by=v_user,updated_at=v_now
   where org_id=p_org_id and collection='mberp_stock_batches' and record_id=v_batch.record_id;
   v_movement_id:=pg_catalog.gen_random_uuid()::text;
   insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
   values(p_org_id,'mberp_stock_batch_movements',v_movement_id,array[v_branch],
    pg_catalog.jsonb_build_object('id',v_movement_id,'type','sale_cancel_restoration',
     'date',v_now,'saleId',p_sale_id,'invoiceNo',v_sale.data->>'invoiceNo',
     'productId',v_item.product_id,'productName',v_item.product_name,
     'batchId',v_batch.record_id,'batchNo',v_batch.data->>'batchNo',
     'branchId',v_branch,'branchName',v_sale.data->>'branchName','qty',v_take,
     'sourceMovementId',v_alloc.record_id,'note','Stock restored after sale cancellation'),v_user);
   v_left:=v_left-v_take;
  end loop;
  if v_left>0 then
   v_movement_id:=pg_catalog.gen_random_uuid()::text;
   insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
   values(p_org_id,'mberp_stock_batch_movements',v_movement_id,array[v_branch],
    pg_catalog.jsonb_build_object('id',v_movement_id,'type','unallocated_cancel_restoration',
     'date',v_now,'saleId',p_sale_id,'invoiceNo',v_sale.data->>'invoiceNo',
     'productId',v_item.product_id,'productName',v_item.product_name,
     'branchId',v_branch,'branchName',v_sale.data->>'branchName','qty',v_left,
     'note','Sale cancelled; quantity restored to product stock but original batch allocation was unavailable'),v_user);
  end if;
 end loop;

 if v_advance_used>0 then
  for v_advance_alloc in select a.record_id,a.data
   from public.etihad_records a
   where a.org_id=p_org_id and a.collection='mberp_customer_credit_allocations'
    and a.data->>'saleId'=p_sale_id and a.data->>'type'='advance_applied'
    and coalesce(a.data->>'status','active')='active'
   order by coalesce(a.data->>'date',''),a.record_id for update
  loop
   if exists(select 1 from public.etihad_records later
    where later.org_id=p_org_id and later.collection='mberp_customer_credit_allocations'
     and later.data->>'sourceCreditId'=v_advance_alloc.data->>'sourceCreditId'
     and later.record_id<>v_advance_alloc.record_id
     and later.data->>'type'='advance_applied'
     and coalesce(later.data->>'status','active')='active') then
    raise exception 'This customer advance was used by another invoice after this sale. Reconcile the later invoice first.';
   end if;
   select record_id,data into v_credit from public.etihad_records
    where org_id=p_org_id and collection='mberp_customer_account_credits'
     and record_id=v_advance_alloc.data->>'sourceCreditId' for update;
   if not found then raise exception 'The original customer advance record is missing.'; end if;
   v_take:=coalesce(nullif(v_advance_alloc.data->>'amount','')::numeric,0);
   if v_take<=0 then raise exception 'The customer advance allocation has an invalid amount.'; end if;
   if coalesce(nullif(v_credit.data->>'balance','')::numeric,0)+v_take >
      coalesce(nullif(v_credit.data->>'amount','')::numeric,0)+0.01 then
    raise exception 'Restoring this advance would exceed its original credit amount. Reconcile its balance first.';
   end if;
   update public.etihad_records set data=v_credit.data||pg_catalog.jsonb_build_object(
    'balance',coalesce(nullif(v_credit.data->>'balance','')::numeric,0)+v_take,
    'lastReversedAt',v_now,'lastReversedSaleId',p_sale_id),
    updated_by=v_user,updated_at=v_now
   where org_id=p_org_id and collection='mberp_customer_account_credits' and record_id=v_credit.record_id;
   update public.etihad_records set data=data||pg_catalog.jsonb_build_object(
    'originalAmount',coalesce(nullif(data->>'originalAmount','')::numeric,nullif(data->>'amount','')::numeric),
    'amount',0,'status','reversed',
    'reversedAmount',coalesce(nullif(data->>'reversedAmount','')::numeric,0)+v_take,
    'lastReversedAt',v_now),
    updated_by=v_user,updated_at=v_now
   where org_id=p_org_id and collection='mberp_customer_credit_allocations' and record_id=v_advance_alloc.record_id;
   v_movement_id:=pg_catalog.gen_random_uuid()::text;
   insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
   values(p_org_id,'mberp_customer_credit_allocations',v_movement_id,array[]::text[],
    pg_catalog.jsonb_build_object('id',v_movement_id,'type','advance_reversal','date',v_now,
     'saleId',p_sale_id,'originalAllocationId',v_advance_alloc.record_id,
     'sourceCreditId',v_credit.record_id,'amount',v_take,
     'customerName',v_sale.data->>'customerName','customerPhone',v_sale.data->>'customerPhone',
     'branchId',v_branch,'invoiceNo',v_sale.data->>'invoiceNo','status','reversed',
     'note','Customer advance returned to its original credit balance after invoice cancellation.'),v_user);
   v_advance_restored:=v_advance_restored+v_take;
  end loop;
  if abs(v_advance_restored-v_advance_used)>0.01 then
   raise exception 'Customer advance could not be restored in full. Cancellation stopped.';
  end if;
  select record_id,data into v_advance_payment from public.etihad_records
   where org_id=p_org_id and collection='mberp_payments'
    and data->>'saleId'=p_sale_id and data->>'type'='advance_applied' for update;
  if not found then raise exception 'Customer advance payment record disappeared during cancellation.'; end if;
  update public.etihad_records set data=data||pg_catalog.jsonb_build_object(
   'amount',0,'type','advance_reversed','reversedAmount',v_advance_used,'lastReversedAt',v_now),
   updated_by=v_user,updated_at=v_now
  where org_id=p_org_id and collection='mberp_payments' and record_id=v_advance_payment.record_id;
 end if;
 if v_cash_refund>0 then
  v_refund_id:=pg_catalog.gen_random_uuid()::text;
  insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
  values(p_org_id,'mberp_payments',v_refund_id,array[v_branch],
   pg_catalog.jsonb_build_object('id',v_refund_id,'date',v_now,'amount',v_cash_refund,
    'method',v_method,'type','sales_return_refund','saleId',p_sale_id,
    'invoiceNo',v_sale.data->>'invoiceNo','customerName',v_sale.data->>'customerName',
    'customerPhone',v_sale.data->>'customerPhone','branchId',v_branch,
    'branchName',v_sale.data->>'branchName','note','Cash payment reversal for cancelled invoice',
    'cancellation',true,'invoiceEditRefund',false),v_user);
 end if;
 v_audit:=coalesce(v_sale.data->'cancellationAudit','[]'::jsonb)||
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
   'cancelledAt',v_now,'cancelledBy',v_user::text,'reason',btrim(p_reason),
   'refundAmount',v_cash_refund+v_prior_refund,'advanceRestored',v_advance_restored,'stockRestored',true));
 update public.etihad_records set data=v_sale.data||pg_catalog.jsonb_build_object(
  'status','cancelled','paid',0,'balance',0,'cancelledAt',v_now,
  'cancelledBy',v_user::text,'cancellationReason',btrim(p_reason),
  'cancellationRefundAmount',v_cash_refund,'cancellationAdvanceRestored',v_advance_restored,'advanceUsed',0,'cancellationAudit',v_audit
 ),updated_by=v_user,updated_at=v_now
 where org_id=p_org_id and collection='mberp_sales' and record_id=p_sale_id;
 return pg_catalog.jsonb_build_object('success',true,'saleId',p_sale_id,
  'invoiceNo',v_sale.data->>'invoiceNo','stockRestored',true,'refundAmount',v_cash_refund+v_prior_refund,'advanceRestored',v_advance_restored,
  'refundMethod',v_method);
end;
$function$;
