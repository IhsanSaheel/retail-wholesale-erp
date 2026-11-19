-- Make purchase receiving idempotent and add atomic supplier balance settlement.
create or replace function private.etihad_create_purchase_idempotent(
 p_org_id uuid,p_branch_id text,p_purchase jsonb,p_paid numeric,p_method text
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
 v_user uuid:=auth.uid();v_role text;v_branches text[];v_existing public.etihad_records%rowtype;
 v_id text;v_expected jsonb;
begin
 if v_user is null then raise exception 'Authentication required'; end if;
 if p_purchase is null or coalesce(p_purchase->>'id','')='' then raise exception 'A stable purchase reference is required'; end if;
 select role,coalesce(branch_ids,array[]::text[]) into v_role,v_branches from public.etihad_memberships where org_id=p_org_id and user_id=v_user and active=true limit 1;
 if not found then raise exception 'Active business membership required'; end if;
 if v_role not in ('owner','manager','stockkeeper','accountant') then raise exception 'Your role cannot record purchases'; end if;
 if v_role<>'owner' and not(p_branch_id=any(v_branches)) then raise exception 'You do not have access to this branch'; end if;
 v_id:=p_purchase->>'id';
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org_id::text||':purchase:'||v_id,0));
 v_expected:=p_purchase||pg_catalog.jsonb_build_object('id',v_id,'paid',p_paid,'balance',greatest(0,coalesce(nullif(p_purchase->>'qty','')::numeric,0)*coalesce(nullif(p_purchase->>'cost','')::numeric,0)-p_paid));
 select * into v_existing from public.etihad_records where org_id=p_org_id and collection='mberp_purchases' and record_id=v_id for update;
 if found then
  if v_existing.updated_by=v_user and v_existing.data=v_expected then
   return pg_catalog.jsonb_build_object('success',true,'purchaseId',v_id,'alreadyRecorded',true,'stockAdded',0);
  end if;
  raise exception 'This purchase reference already exists with different or unauthorised details';
 end if;
 return private.etihad_create_purchase(p_org_id,p_branch_id,p_purchase,p_paid,p_method);
end;
$function$;
create or replace function public.etihad_create_purchase(p_org_id uuid,p_branch_id text,p_purchase jsonb,p_paid numeric,p_method text)
returns jsonb language sql set search_path='' as $function$
 select private.etihad_create_purchase_idempotent(p_org_id,p_branch_id,p_purchase,p_paid,p_method);
$function$;
create or replace function private.etihad_collect_supplier_payment(
 p_org_id uuid,p_purchase_id text,p_amount numeric,p_method text,p_note text,p_payment_id text
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
 v_user uuid:=auth.uid();v_role text;v_branches text[];v_purchase public.etihad_records%rowtype;
 v_existing public.etihad_records%rowtype;v_branch text;v_balance numeric;v_paid numeric;v_supplier text;
begin
 if v_user is null then raise exception 'Authentication required'; end if;
 if coalesce(p_purchase_id,'')='' or coalesce(p_payment_id,'')='' or coalesce(p_amount,0)<=0 then raise exception 'Purchase, payment reference and a positive amount are required'; end if;
 select role,coalesce(branch_ids,array[]::text[]) into v_role,v_branches from public.etihad_memberships where org_id=p_org_id and user_id=v_user and active=true limit 1;
 if not found then raise exception 'Active business membership required'; end if;
 if v_role not in ('owner','manager','accountant') then raise exception 'Your role cannot pay suppliers'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org_id::text||':supplier-payment:'||p_payment_id,0));
 select * into v_existing from public.etihad_records where org_id=p_org_id and collection='mberp_supplier_payments' and record_id=p_payment_id for update;
 if found then
  if v_existing.updated_by=v_user and v_existing.data->>'purchaseId'=p_purchase_id and (v_existing.data->>'amount')::numeric=p_amount
    and coalesce(v_existing.data->>'method','Cash')=coalesce(p_method,'Cash') and coalesce(v_existing.data->>'note','')=coalesce(p_note,'') then
   return pg_catalog.jsonb_build_object('success',true,'paymentId',p_payment_id,'alreadyRecorded',true,
    'balance',(select coalesce(nullif(data->>'balance','')::numeric,0) from public.etihad_records where org_id=p_org_id and collection='mberp_purchases' and record_id=p_purchase_id));
  end if;
  raise exception 'This supplier payment reference already exists with different details';
 end if;
 select * into v_purchase from public.etihad_records where org_id=p_org_id and collection='mberp_purchases' and record_id=p_purchase_id for update;
 if not found then raise exception 'Purchase record not found'; end if;
 v_branch:=coalesce(v_purchase.data->>'branchId',v_purchase.branch_ids[1]);
 if v_role<>'owner' and not(v_branch=any(v_branches)) then raise exception 'You do not have access to this purchase branch'; end if;
 v_balance:=coalesce(nullif(v_purchase.data->>'balance','')::numeric,0);v_paid:=coalesce(nullif(v_purchase.data->>'paid','')::numeric,0);
 if p_amount>v_balance then raise exception 'Payment exceeds the remaining supplier balance of %',v_balance; end if;
 v_supplier:=coalesce(v_purchase.data->>'supplierName','');
 update public.etihad_records set data=v_purchase.data||pg_catalog.jsonb_build_object('paid',v_paid+p_amount,'balance',v_balance-p_amount,'lastPaymentAt',pg_catalog.now()),updated_by=v_user,updated_at=pg_catalog.now()
 where org_id=p_org_id and collection='mberp_purchases' and record_id=p_purchase_id;
 insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
 values(p_org_id,'mberp_supplier_payments',p_payment_id,array[v_branch],
 pg_catalog.jsonb_build_object('id',p_payment_id,'date',pg_catalog.now(),'amount',p_amount,'method',coalesce(p_method,'Cash'),'type','purchase_payment','purchaseId',p_purchase_id,'supplierName',v_supplier,'branchId',v_branch,'branchName',v_purchase.data->>'branchName','note',coalesce(p_note,'')),v_user);
 return pg_catalog.jsonb_build_object('success',true,'paymentId',p_payment_id,'paid',v_paid+p_amount,'balance',v_balance-p_amount);
end;
$function$;
create or replace function public.etihad_collect_supplier_payment(p_org_id uuid,p_purchase_id text,p_amount numeric,p_method text,p_note text,p_payment_id text)
returns jsonb language sql set search_path='' as $function$
 select private.etihad_collect_supplier_payment(p_org_id,p_purchase_id,p_amount,p_method,p_note,p_payment_id);
$function$;
revoke all on function public.etihad_create_purchase(uuid,text,jsonb,numeric,text) from public,anon;
grant execute on function public.etihad_create_purchase(uuid,text,jsonb,numeric,text) to authenticated;
revoke all on function public.etihad_collect_supplier_payment(uuid,text,numeric,text,text,text) from public,anon;
grant execute on function public.etihad_collect_supplier_payment(uuid,text,numeric,text,text,text) to authenticated;
revoke all on function private.etihad_create_purchase_idempotent(uuid,text,jsonb,numeric,text) from public,anon;
grant execute on function private.etihad_create_purchase_idempotent(uuid,text,jsonb,numeric,text) to authenticated;
revoke all on function private.etihad_collect_supplier_payment(uuid,text,numeric,text,text,text) from public,anon;
grant execute on function private.etihad_collect_supplier_payment(uuid,text,numeric,text,text,text) to authenticated;
