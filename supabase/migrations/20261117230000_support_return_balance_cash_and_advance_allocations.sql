create or replace function private.etihad_create_sales_return(
 p_org_id uuid,p_sale_id text,p_product_id text,p_qty numeric,p_refund numeric,
 p_reason text,p_return_id text,p_cash_refund numeric,p_apply_to_balance numeric
) returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
 v_user uuid:=auth.uid(); v_role text; v_branches text[]; v_sale record; v_item jsonb; v_product record;
 v_sold numeric:=0; v_returned numeric:=0; v_price numeric:=0; v_cost numeric:=0;
 v_branch text; v_payment_id text; v_credit_id text; v_credit numeric:=coalesce(p_refund,0);
 v_total numeric; v_paid numeric; v_balance numeric; v_apply numeric;
 v_cash_refund numeric:=coalesce(p_cash_refund,0); v_advance numeric;
 v_new_total numeric; v_new_paid numeric; v_new_balance numeric;
 v_old_subtotal numeric; v_new_subtotal numeric; v_existing public.etihad_records%rowtype;
 v_now timestamptz:=pg_catalog.now();
begin
 if v_user is null then raise exception 'Authentication required'; end if;
 if coalesce(p_return_id,'')='' or coalesce(p_sale_id,'')='' or coalesce(p_product_id,'')='' then raise exception 'A stable return reference, invoice and product are required'; end if;
 if coalesce(p_qty,0)<=0 or v_credit<0 or v_cash_refund<0 or coalesce(p_apply_to_balance,0)<0 then raise exception 'Return quantity and allocation amounts are invalid'; end if;
 select role,coalesce(branch_ids,array[]::text[]) into v_role,v_branches from public.etihad_memberships where org_id=p_org_id and user_id=v_user and active=true limit 1;
 if not found then raise exception 'Active business membership required'; end if;
 if v_role not in ('owner','manager','cashier','accountant') then raise exception 'Your role cannot process sales returns'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org_id::text||':sales-return:'||p_return_id,0));
 select * into v_existing from public.etihad_records where org_id=p_org_id and collection='mberp_sales_returns' and record_id=p_return_id for update;
 if found then
  if v_existing.updated_by=v_user and v_existing.data->>'saleId'=p_sale_id and v_existing.data->>'productId'=p_product_id
   and (v_existing.data->>'qty')::numeric=p_qty
   and coalesce((v_existing.data->>'creditAmount')::numeric,(v_existing.data->>'refund')::numeric,0)=v_credit
   and coalesce((v_existing.data->>'cashRefund')::numeric,0)=v_cash_refund
   and coalesce((v_existing.data->>'balanceApplied')::numeric,0)=coalesce(p_apply_to_balance,0)
   and coalesce(v_existing.data->>'reason','')=coalesce(p_reason,'') then
   return pg_catalog.jsonb_build_object('success',true,'returnId',p_return_id,'alreadyRecorded',true,'stockRestocked',p_qty,
    'creditAmount',v_credit,'cashRefund',coalesce((v_existing.data->>'cashRefund')::numeric,0),
    'advanceCreated',coalesce((v_existing.data->>'advanceCreated')::numeric,0),
    'balanceApplied',coalesce((v_existing.data->>'balanceApplied')::numeric,0),
    'revisedTotal',coalesce((v_existing.data->>'totalAfter')::numeric,0),
    'balance',coalesce((v_existing.data->>'balanceAfter')::numeric,0));
  end if;
  raise exception 'This return reference already exists with different or unauthorised details';
 end if;
 select record_id,data,branch_ids into v_sale from public.etihad_records where org_id=p_org_id and collection='mberp_sales' and record_id=p_sale_id for update;
 if not found then raise exception 'Original invoice not found'; end if;
 v_branch:=coalesce(v_sale.data->>'branchId',v_sale.branch_ids[1]);
 if v_role<>'owner' and not(v_branch=any(v_branches)) then raise exception 'You do not have access to the original sale branch'; end if;
 select value into v_item from pg_catalog.jsonb_array_elements(v_sale.data->'items') where value->>'productId'=p_product_id limit 1;
 if v_item is null then raise exception 'Product is not part of this invoice'; end if;
 v_sold:=coalesce(nullif(v_item->>'qty','')::numeric,0); v_price:=coalesce(nullif(v_item->>'price','')::numeric,0); v_cost:=coalesce(nullif(v_item->>'cost','')::numeric,0);
 select coalesce(sum((r.data->>'qty')::numeric),0) into v_returned from public.etihad_records r where r.org_id=p_org_id and r.collection='mberp_sales_returns' and r.data->>'saleId'=p_sale_id and r.data->>'productId'=p_product_id;
 if v_returned+p_qty>v_sold then raise exception 'Return quantity exceeds the quantity sold. Remaining returnable: %',v_sold-v_returned; end if;
 if v_credit>p_qty*v_price then raise exception 'Return credit cannot exceed the returned items selling value'; end if;
 v_total:=coalesce(nullif(v_sale.data->>'total','')::numeric,0); v_paid:=coalesce(nullif(v_sale.data->>'paid','')::numeric,0); v_balance:=greatest(0,v_total-v_paid);
 if v_paid<0 or v_total<0 or v_paid>v_total+0.01 then raise exception 'Original invoice payment totals do not reconcile. Reconcile the invoice before processing this return.'; end if;
 if abs(coalesce(nullif(v_sale.data->>'balance','')::numeric,v_balance)-v_balance)>0.01 then raise exception 'Original invoice balance does not reconcile with its paid and total amounts.'; end if;
 if v_credit>v_total then raise exception 'Return credit cannot exceed the remaining invoice total'; end if;
 v_apply:=coalesce(p_apply_to_balance,least(v_balance,v_credit));
 if v_apply>v_balance+0.01 then raise exception 'Amount applied to invoice balance cannot exceed the outstanding balance'; end if;
 if v_apply+v_cash_refund>v_credit+0.01 then raise exception 'Balance adjustment plus cash refund cannot exceed the return credit'; end if;
 v_advance:=greatest(0,v_credit-v_apply-v_cash_refund);
 if v_advance>0 and (coalesce(v_sale.data->>'customerPhone','')='' or coalesce(v_sale.data->>'customerName','') in ('','Walk-in Customer')) then raise exception 'A saved customer with a phone number is required to retain a return as customer advance'; end if;
 v_new_total:=greatest(0,v_total-v_credit); v_new_paid:=v_paid-(v_credit-v_apply);
 if v_new_paid< -0.01 or v_new_paid>v_new_total+0.01 then raise exception 'Selected return allocation would make invoice payment totals invalid'; end if;
 v_new_paid:=greatest(0,least(v_new_total,v_new_paid)); v_new_balance:=greatest(0,v_new_total-v_new_paid);
 v_old_subtotal:=coalesce(nullif(v_sale.data->>'subtotal','')::numeric,v_total); v_new_subtotal:=greatest(0,v_old_subtotal-v_credit);
 select record_id,data,branch_ids into v_product from public.etihad_records where org_id=p_org_id and collection='mberp_products' and record_id=p_product_id for update;
 if not found then raise exception 'Product record not found'; end if;
 if coalesce(v_product.data->>'branchId','')<>v_branch or not(v_branch=any(v_product.branch_ids)) then raise exception 'Returned product branch does not match the original invoice branch'; end if;
 update public.etihad_records set data=pg_catalog.jsonb_set(v_product.data,'{qty}',pg_catalog.to_jsonb(coalesce(nullif(v_product.data->>'qty','')::numeric,0)+p_qty),true),updated_by=v_user,updated_at=v_now where org_id=p_org_id and collection='mberp_products' and record_id=p_product_id;
 update public.etihad_records set data=v_sale.data||pg_catalog.jsonb_build_object('subtotal',v_new_subtotal,'total',v_new_total,'paid',v_new_paid,'balance',v_new_balance,
  'returnedTotal',coalesce(nullif(v_sale.data->>'returnedTotal','')::numeric,0)+v_credit,'lastReturnAt',v_now,'lastReturnId',p_return_id,
  'status',case when v_new_total=0 then 'returned' when coalesce(nullif(v_sale.data->>'returnedTotal','')::numeric,0)+v_credit>0 then 'partially_returned' else coalesce(v_sale.data->>'status','completed') end),
  updated_by=v_user,updated_at=v_now where org_id=p_org_id and collection='mberp_sales' and record_id=p_sale_id;
 if v_advance>0 then
  v_credit_id:=pg_catalog.gen_random_uuid()::text;
  insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
  values(p_org_id,'mberp_customer_account_credits',v_credit_id,array[]::text[],
   pg_catalog.jsonb_build_object('id',v_credit_id,'key','phone:'||(v_sale.data->>'customerPhone'),
    'customerName',v_sale.data->>'customerName','customerPhone',v_sale.data->>'customerPhone',
    'amount',v_advance,'balance',v_advance,'date',v_now,'type','return_advance',
    'sourceSaleId',p_sale_id,'sourceReturnId',p_return_id,'invoiceNo',v_sale.data->>'invoiceNo',
    'branchId',v_branch,'branchName',v_sale.data->>'branchName','note','Return value retained as customer account advance.'),v_user);
 end if;
 insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
 values(p_org_id,'mberp_sales_returns',p_return_id,array[v_branch],
  pg_catalog.jsonb_build_object('id',p_return_id,'saleId',p_sale_id,'invoiceNo',v_sale.data->>'invoiceNo',
   'productId',p_product_id,'productName',v_item->>'name','qty',p_qty,'refund',v_credit,'creditAmount',v_credit,
   'cashRefund',v_cash_refund,'advanceCreated',v_advance,'balanceApplied',v_apply,'date',v_now,
   'branchId',v_branch,'branchName',v_sale.data->>'branchName','customerName',v_sale.data->>'customerName',
   'customerPhone',v_sale.data->>'customerPhone','reason',coalesce(p_reason,''),'unitPrice',v_price,'unitCost',v_cost,
   'totalBefore',v_total,'totalAfter',v_new_total,'paidBefore',v_paid,'paidAfter',v_new_paid,
   'balanceBefore',v_balance,'balanceAfter',v_new_balance),v_user);
 if v_cash_refund>0 then
  v_payment_id:=pg_catalog.gen_random_uuid()::text;
  insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
  values(p_org_id,'mberp_payments',v_payment_id,array[v_branch],
   pg_catalog.jsonb_build_object('id',v_payment_id,'date',v_now,'amount',v_cash_refund,'method','Cash',
    'type','sales_return_refund','saleId',p_sale_id,'returnId',p_return_id,
    'invoiceNo',v_sale.data->>'invoiceNo','customerName',v_sale.data->>'customerName',
    'customerPhone',v_sale.data->>'customerPhone','branchId',v_branch,'branchName',v_sale.data->>'branchName',
    'note','Cash refund paid for returned goods'),v_user);
 end if;
 return pg_catalog.jsonb_build_object('success',true,'returnId',p_return_id,'alreadyRecorded',false,
  'stockRestocked',p_qty,'creditAmount',v_credit,'cashRefund',v_cash_refund,'advanceCreated',v_advance,
  'balanceApplied',v_apply,'revisedTotal',v_new_total,'paid',v_new_paid,'balance',v_new_balance);
end;
$function$;

create or replace function private.etihad_create_sales_return(
 p_org_id uuid,p_sale_id text,p_product_id text,p_qty numeric,p_refund numeric,p_reason text,p_return_id text
) returns jsonb language sql security definer set search_path to ''
as $function$
 select private.etihad_create_sales_return(p_org_id,p_sale_id,p_product_id,p_qty,p_refund,p_reason,p_return_id,0,null);
$function$;

create or replace function public.etihad_create_sales_return(
 p_org_id uuid,p_sale_id text,p_product_id text,p_qty numeric,p_refund numeric,
 p_reason text,p_return_id text,p_cash_refund numeric,p_apply_to_balance numeric
) returns jsonb language sql set search_path to ''
as $function$
 select private.etihad_create_sales_return(p_org_id,p_sale_id,p_product_id,p_qty,p_refund,p_reason,p_return_id,p_cash_refund,p_apply_to_balance);
$function$;

revoke all on function public.etihad_create_sales_return(uuid,text,text,numeric,numeric,text,text,numeric,numeric) from public,anon;
grant execute on function public.etihad_create_sales_return(uuid,text,text,numeric,numeric,text,text,numeric,numeric) to authenticated,service_role;