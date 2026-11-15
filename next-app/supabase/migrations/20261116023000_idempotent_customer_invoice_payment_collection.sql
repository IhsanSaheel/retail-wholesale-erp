-- Idempotent customer invoice payments: a stable client reference makes
-- a retry after a lost response return the original payment instead of
-- reducing the invoice balance twice.
create or replace function private.etihad_collect_sale_payment_idempotent(
 p_org_id uuid,p_sale_id text,p_amount numeric,p_method text,p_note text,p_payment_id text
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
 v_user uuid:=auth.uid();v_role text;v_branches text[];v_sale record;v_existing public.etihad_records%rowtype;
 v_balance numeric;v_paid numeric;v_branch text;
begin
 if v_user is null then raise exception 'Authentication required'; end if;
 if coalesce(p_amount,0)<=0 or coalesce(p_payment_id,'')='' or coalesce(p_sale_id,'')='' then raise exception 'Invoice, payment reference and a positive amount are required'; end if;
 select role,coalesce(branch_ids,array[]::text[]) into v_role,v_branches from public.etihad_memberships where org_id=p_org_id and user_id=v_user and active=true limit 1;
 if not found then raise exception 'Active business membership required'; end if;
 if v_role not in ('owner','manager','cashier','accountant') then raise exception 'Your role cannot collect customer payments'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org_id::text||':customer-payment:'||p_payment_id,0));
 select * into v_existing from public.etihad_records where org_id=p_org_id and collection='mberp_payments' and record_id=p_payment_id for update;
 if found then
  if v_existing.updated_by=v_user and v_existing.data->>'type'='sale_payment' and v_existing.data->>'saleId'=p_sale_id
    and (v_existing.data->>'amount')::numeric=p_amount and coalesce(v_existing.data->>'method','Cash')=coalesce(p_method,'Cash')
    and coalesce(v_existing.data->>'note','')=coalesce(p_note,'') then
   return pg_catalog.jsonb_build_object('success',true,'paymentId',p_payment_id,'alreadyRecorded',true,
    'balance',(select coalesce(nullif(data->>'balance','')::numeric,0) from public.etihad_records where org_id=p_org_id and collection='mberp_sales' and record_id=p_sale_id));
  end if;
  raise exception 'This payment reference already exists with different details';
 end if;
 select record_id,data,branch_ids into v_sale from public.etihad_records where org_id=p_org_id and collection='mberp_sales' and record_id=p_sale_id for update;
 if not found then raise exception 'Invoice not found'; end if;
 v_branch:=coalesce(v_sale.data->>'branchId',v_sale.branch_ids[1]);
 if v_role<>'owner' and not(v_branch=any(v_branches)) then raise exception 'You do not have access to this invoice branch'; end if;
 v_balance:=coalesce(nullif(v_sale.data->>'balance','')::numeric,0);v_paid:=coalesce(nullif(v_sale.data->>'paid','')::numeric,0);
 if p_amount>v_balance then raise exception 'Payment exceeds the remaining invoice balance of %',v_balance; end if;
 update public.etihad_records set data=v_sale.data||pg_catalog.jsonb_build_object('paid',v_paid+p_amount,'balance',v_balance-p_amount,'lastPaymentAt',pg_catalog.now()),updated_by=v_user,updated_at=pg_catalog.now()
 where org_id=p_org_id and collection='mberp_sales' and record_id=p_sale_id;
 insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
 values(p_org_id,'mberp_payments',p_payment_id,array[v_branch],
 pg_catalog.jsonb_build_object('id',p_payment_id,'date',pg_catalog.now(),'amount',p_amount,'method',coalesce(p_method,'Cash'),'type','sale_payment',
 'saleId',p_sale_id,'invoiceNo',v_sale.data->>'invoiceNo','receiptNo','REC-'||coalesce(v_sale.data->>'invoiceNo',p_sale_id),
 'branchId',v_branch,'branchName',v_sale.data->>'branchName','customerName',v_sale.data->>'customerName',
 'customerPhone',v_sale.data->>'customerPhone','note',coalesce(p_note,'Additional payment received')),v_user);
 return pg_catalog.jsonb_build_object('success',true,'paymentId',p_payment_id,'paid',v_paid+p_amount,'balance',v_balance-p_amount);
end;
$function$;
create or replace function public.etihad_collect_sale_payment(
 p_org_id uuid,p_sale_id text,p_amount numeric,p_method text,p_note text,p_payment_id text
) returns jsonb language sql set search_path='' as $function$
 select private.etihad_collect_sale_payment_idempotent(p_org_id,p_sale_id,p_amount,p_method,p_note,p_payment_id);
$function$;
revoke all on function public.etihad_collect_sale_payment(uuid,text,numeric,text,text) from public,anon,authenticated;
revoke all on function public.etihad_collect_sale_payment(uuid,text,numeric,text,text,text) from public,anon;
revoke all on function private.etihad_collect_sale_payment(uuid,text,numeric,text,text) from public,anon,authenticated;
revoke all on function private.etihad_collect_sale_payment_idempotent(uuid,text,numeric,text,text,text) from public,anon;
grant execute on function public.etihad_collect_sale_payment(uuid,text,numeric,text,text,text) to authenticated;
grant execute on function private.etihad_collect_sale_payment_idempotent(uuid,text,numeric,text,text,text) to authenticated;