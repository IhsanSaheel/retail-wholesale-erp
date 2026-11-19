-- Enable safe cancellation for sales whose customer advance usage is fully
-- reconciled. Restore the exact source credits and refund only cash collected.
do $$
declare
  v_def text;
  v_old_decl text := 'v_paid numeric; v_method text; v_refund_id text; v_movement_id text;';
  v_new_decl text := 'v_paid numeric; v_method text; v_refund_id text; v_movement_id text;
 v_advance_used numeric:=0; v_cash_refund numeric:=0; v_advance_restored numeric:=0;
 v_advance_allocation_total numeric:=0;
 v_advance_payment record; v_advance_alloc record; v_credit record;
 v_advance_payment_count integer:=0; v_sale_payment_methods integer:=0; v_sale_payment_total numeric:=0;';
  v_old_guard text := $old$if coalesce(nullif(v_sale.data->>'advanceUsed','')::numeric,0)>0
  or coalesce(nullif(v_sale.data->>'priorOutstandingApplied','')::numeric,0)>0
  or coalesce(nullif(v_sale.data->>'customerAdvance','')::numeric,0)>0
  or coalesce(nullif(v_sale.data->>'staffTip','')::numeric,0)>0 then
  raise exception 'This invoice includes customer advances, previous-balance settlement or staff tips. It needs specialist account reconciliation and cannot be cancelled by this action.';
 end if;$old$;
  v_new_guard text := $new$if coalesce(nullif(v_sale.data->>'priorOutstandingApplied','')::numeric,0)>0
  or coalesce(nullif(v_sale.data->>'customerAdvance','')::numeric,0)>0
  or coalesce(nullif(v_sale.data->>'staffTip','')::numeric,0)>0 then
  raise exception 'This invoice includes a previous-balance settlement, unused customer advance or staff tip. It needs specialist account reconciliation and cannot be cancelled by this action.';
 end if;$new$;
  v_old_payment text := $old$v_paid:=coalesce(nullif(v_sale.data->>'paid','')::numeric,0);
 if v_paid<0 then raise exception 'Invoice has an invalid paid amount'; end if;
 v_method:=coalesce(nullif(v_sale.data->>'paymentMethod',''),'Cash');$old$;
  v_new_payment text := $new$v_paid:=coalesce(nullif(v_sale.data->>'paid','')::numeric,0);
 if v_paid<0 then raise exception 'Invoice has an invalid paid amount'; end if;
 v_method:=coalesce(nullif(v_sale.data->>'paymentMethod',''),'Cash');
 v_cash_refund:=v_paid;
 v_advance_used:=coalesce(nullif(v_sale.data->>'advanceUsed','')::numeric,0);
 if v_advance_used<0 then raise exception 'Invoice has an invalid customer advance amount'; end if;
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
         count(distinct data->>'method') filter(where data->>'type'='sale_payment')
   into v_sale_payment_total,v_sale_payment_methods
  from public.etihad_records where org_id=p_org_id and collection='mberp_payments'
   and data->>'saleId'=p_sale_id and data->>'type'='sale_payment';
  if abs(v_sale_payment_total-(v_paid-v_advance_used))>0.01 or v_sale_payment_methods>1 then
   raise exception 'Cash and customer-advance payment history does not reconcile. Reconcile payment methods before cancelling this invoice.';
  end if;
  v_cash_refund:=greatest(0,v_paid-v_advance_used);
 end if;$new$;
  v_old_refund text := $old$if v_paid>0 then
  v_refund_id:=pg_catalog.gen_random_uuid()::text;
  insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
  values(p_org_id,'mberp_payments',v_refund_id,array[v_branch],
   pg_catalog.jsonb_build_object('id',v_refund_id,'date',v_now,'amount',v_paid,
    'method',v_method,'type','sales_return_refund','saleId',p_sale_id,
    'invoiceNo',v_sale.data->>'invoiceNo','customerName',v_sale.data->>'customerName',
    'customerPhone',v_sale.data->>'customerPhone','branchId',v_branch,
    'branchName',v_sale.data->>'branchName','note','Full payment reversal for cancelled invoice',
    'cancellation',true),v_user);
 end if;$old$;
  v_new_refund text := $new$if v_advance_used>0 then
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
 end if;$new$;
begin
 select pg_get_functiondef('private.etihad_cancel_sale(uuid,text,text)'::regprocedure) into v_def;
 if position(v_old_decl in v_def)=0 or position(v_old_guard in v_def)=0
    or position(v_old_payment in v_def)=0 or position(v_old_refund in v_def)=0 then
  raise exception 'Expected cancellation function blocks not found; no change applied';
 end if;
 v_def:=replace(v_def,v_old_decl,v_new_decl);
 v_def:=replace(v_def,v_old_guard,v_new_guard);
 v_def:=replace(v_def,v_old_payment,v_new_payment);
 v_def:=replace(v_def,v_old_refund,v_new_refund);
 v_def:=replace(v_def,'''refundAmount'',v_paid',
  '''refundAmount'',v_cash_refund,''advanceRestored'',v_advance_restored');
 v_def:=replace(v_def,'''cancellationRefundAmount'',v_paid,''cancellationAudit'',v_audit',
  '''cancellationRefundAmount'',v_cash_refund,''cancellationAdvanceRestored'',v_advance_restored,''advanceUsed'',0,''cancellationAudit'',v_audit');
 execute v_def;
end $$;
