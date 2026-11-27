CREATE OR REPLACE FUNCTION public.etihad_collect_customer_payment(p_org_id uuid, p_sale_id text, p_amount numeric, p_method text, p_note text, p_payment_id text, p_collecting_branch_id text, p_customer_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid:=auth.uid(); v_role text; v_sale record; v_existing public.etihad_records%rowtype;
 v_invoice_branch text; v_collecting_branch text; v_collecting_branch_name text; v_balance numeric; v_paid numeric; v_total numeric; v_return_applied numeric:=0; v_phone text;
begin
 if v_user is null then raise exception 'Authentication required'; end if;
 if coalesce(p_amount,0)<=0 or coalesce(p_payment_id,'')='' or coalesce(p_sale_id,'')='' then raise exception 'Invoice, payment reference and a positive amount are required'; end if;
 select m.role into v_role from public.etihad_memberships m where m.org_id=p_org_id and m.user_id=v_user and m.active=true limit 1;
 if not found then raise exception 'Active business membership required'; end if;
 if v_role not in ('owner','manager','cashier','accountant') then raise exception 'Your role cannot collect customer payments'; end if;
 v_collecting_branch:=btrim(coalesce(p_collecting_branch_id,''));
 if v_collecting_branch='' or not public.etihad_record_access(p_org_id,'mberp_payments',array[v_collecting_branch]::text[],'insert') then
  raise exception 'You do not have permission to collect payments at this branch'; end if;
 select b.data->>'name' into v_collecting_branch_name from public.etihad_records b where b.org_id=p_org_id and b.collection='mberp_branches'
 and coalesce(b.data->>'id',b.record_id)=v_collecting_branch and coalesce(b.data->>'active','true')<>'false' limit 1;
 if v_collecting_branch_name is null then raise exception 'Select a valid active collection branch'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org_id::text||':customer-payment:'||p_payment_id,0));
 select * into v_existing from public.etihad_records where org_id=p_org_id and collection='mberp_payments' and record_id=p_payment_id for update;
 if found then
  if v_existing.updated_by=v_user and v_existing.data->>'type'='sale_payment' and v_existing.data->>'saleId'=p_sale_id
   and coalesce(nullif(v_existing.data->>'amount','')::numeric,0)=p_amount and coalesce(v_existing.data->>'method','Cash')=coalesce(p_method,'Cash')
   and coalesce(v_existing.data->>'collectingBranchId','')=v_collecting_branch then
   return jsonb_build_object('success',true,'paymentId',p_payment_id,'alreadyRecorded',true,'balance',
    (select coalesce(nullif(data->>'balance','')::numeric,0) from public.etihad_records where org_id=p_org_id and collection='mberp_sales' and record_id=p_sale_id));
  end if;
  raise exception 'This payment reference already exists with different details';
 end if;
 select r.record_id,r.data,r.branch_ids into v_sale from public.etihad_records r where r.org_id=p_org_id and r.collection='mberp_sales' and r.record_id=p_sale_id for update;
 if not found then raise exception 'Invoice not found'; end if;
 if lower(coalesce(v_sale.data->>'status','')) in ('cancelled','returned') then raise exception 'Cancelled or fully returned invoices cannot receive payments'; end if;
 v_phone:=private.normalize_customer_phone(v_sale.data->>'customerPhone');
 if v_phone='' or v_phone<>private.normalize_customer_phone(p_customer_phone) then raise exception 'The selected invoice does not belong to this customer'; end if;
 v_invoice_branch:=coalesce(v_sale.data->>'branchId',v_sale.branch_ids[1]);
 v_balance:=coalesce(nullif(v_sale.data->>'balance','')::numeric,0); v_paid:=coalesce(nullif(v_sale.data->>'paid','')::numeric,0); v_total:=coalesce(nullif(v_sale.data->>'total','')::numeric,0);
 select coalesce(sum(case when data ? 'balanceApplied' and nullif(data->>'balanceApplied','') is not null then greatest(0,coalesce(nullif(data->>'balanceApplied','')::numeric,0))
  when data ? 'creditAmount' and nullif(data->>'creditAmount','') is not null then 0 else greatest(0,coalesce(nullif(data->>'amount','')::numeric,0)-coalesce(nullif(data->>'refundAmount','')::numeric,0)-coalesce(nullif(data->>'cashRefund','')::numeric,0)) end),0)
 into v_return_applied from public.etihad_records where org_id=p_org_id and collection='mberp_sales_returns' and data->>'saleId'=p_sale_id;
 if abs(v_total-v_paid-v_return_applied-v_balance)>0.01 then v_balance:=greatest(0,v_total-v_paid-v_return_applied); end if;
 if v_balance<=0.009 then raise exception 'This invoice has no outstanding balance'; end if;
 if p_amount>v_balance then raise exception 'Payment exceeds the remaining invoice balance of %',v_balance; end if;
 update public.etihad_records set data=v_sale.data||pg_catalog.jsonb_build_object('paid',v_paid+p_amount,'balance',v_balance-p_amount,'lastPaymentAt',pg_catalog.now()),
  updated_by=v_user,updated_at=pg_catalog.now() where org_id=p_org_id and collection='mberp_sales' and record_id=p_sale_id;
 insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
 values(p_org_id,'mberp_payments',p_payment_id,array[v_collecting_branch],pg_catalog.jsonb_build_object(
  'id',p_payment_id,'date',pg_catalog.now(),'amount',p_amount,'method',coalesce(p_method,'Cash'),'type','sale_payment','saleId',p_sale_id,
  'invoiceNo',v_sale.data->>'invoiceNo','receiptNo','REC-'||coalesce(v_sale.data->>'invoiceNo',p_sale_id),
  'branchId',v_collecting_branch,'branchName',v_collecting_branch_name,'collectingBranchId',v_collecting_branch,'collectingBranchName',v_collecting_branch_name,
  'invoiceBranchId',v_invoice_branch,'invoiceBranchName',v_sale.data->>'branchName','customerName',v_sale.data->>'customerName',
  'customerPhone',v_sale.data->>'customerPhone','note',coalesce(p_note,'Customer payment collected at another branch')),v_user);
 return jsonb_build_object('success',true,'paymentId',p_payment_id,'paid',v_paid+p_amount,'balance',v_balance-p_amount,
  'collectingBranchId',v_collecting_branch,'invoiceBranchId',v_invoice_branch);
end; $function$;

revoke all on function public.etihad_collect_customer_payment(uuid,text,numeric,text,text,text,text,text) from public,anon;

grant execute on function public.etihad_collect_customer_payment(uuid,text,numeric,text,text,text,text,text) to authenticated;