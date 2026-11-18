create or replace function private.etihad_request_stock_adjustment_v2(
 p_org_id uuid,p_product_id text,p_delta numeric,p_reason text,p_request_id text,p_batch_id text default null
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
 v_user uuid:=auth.uid();v_role text;v_branches text[];v_product record;v_batch record;
 v_branch text;v_before numeric;v_after numeric;v_id text:=coalesce(nullif(p_request_id,''),pg_catalog.gen_random_uuid()::text);
 v_existing public.etihad_records%rowtype;v_batch_count integer;v_batch_total numeric;
 v_today date:=(pg_catalog.now() at time zone 'Asia/Karachi')::date;
begin
 if v_user is null then raise exception 'Authentication required';end if;
 if coalesce(p_product_id,'')='' or coalesce(p_delta,0)=0 then raise exception 'Select a product and enter a non-zero adjustment';end if;
 if length(pg_catalog.btrim(coalesce(p_reason,'')))<4 then raise exception 'Enter a reason of at least 4 characters';end if;
 select role,coalesce(branch_ids,array[]::text[]) into v_role,v_branches from public.etihad_memberships
 where org_id=p_org_id and user_id=v_user and active=true limit 1;
 if not found then raise exception 'Active business membership required';end if;
 if v_role not in ('owner','manager','stockkeeper') then raise exception 'Your role cannot request stock adjustments';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org_id::text||':stock-adjustment:'||v_id,0));
 select * into v_existing from public.etihad_records where org_id=p_org_id and collection='mberp_stock_adjustments' and record_id=v_id for update;
 if found then
  if v_existing.updated_by=v_user and v_existing.data->>'productId'=p_product_id
   and (v_existing.data->>'delta')::numeric=p_delta
   and coalesce(v_existing.data->>'reason','')=pg_catalog.btrim(p_reason)
   and v_existing.data->>'batchId' is not distinct from nullif(p_batch_id,'') then
   return pg_catalog.jsonb_build_object('success',true,'requestId',v_id,'status',v_existing.data->>'status','alreadyRecorded',true);
  end if;
  raise exception 'This adjustment reference already exists with different details';
 end if;
 select record_id,data,branch_ids into v_product from public.etihad_records
 where org_id=p_org_id and collection='mberp_products' and record_id=p_product_id for update;
 if not found then raise exception 'Product not found';end if;
 v_branch:=coalesce(v_product.data->>'branchId',v_product.branch_ids[1]);
 if v_branch is null or not(v_branch=any(v_product.branch_ids)) then raise exception 'Product branch assignment is invalid';end if;
 if v_role<>'owner' and not(v_branch=any(v_branches)) then raise exception 'You do not have access to this product branch';end if;
 v_before:=coalesce(nullif(v_product.data->>'qty','')::numeric,0);v_after:=v_before+p_delta;
 if v_after<0 then raise exception 'Adjustment would make stock negative. Available: %',v_before;end if;
 select count(*)::integer,coalesce(sum(coalesce(nullif(data->>'remainingQty','')::numeric,0)),0)
 into v_batch_count,v_batch_total from public.etihad_records
 where org_id=p_org_id and collection='mberp_stock_batches'
  and data->>'productId'=p_product_id
  and coalesce(data->>'branchId',branch_ids[1])=v_branch
  and coalesce(data->>'status','active')<>'cancelled';
 if v_batch_count>0 then
  if abs(v_batch_total-v_before)>0.000001 then
   raise exception 'Batch stock (%) does not reconcile with product stock (%). Reconcile batches before requesting an adjustment.',v_batch_total,v_before;
  end if;
  if coalesce(p_batch_id,'')='' then raise exception 'Select the batch / lot that this adjustment affects';end if;
  select record_id,data into v_batch from public.etihad_records
   where org_id=p_org_id and collection='mberp_stock_batches' and record_id=p_batch_id
    and data->>'productId'=p_product_id and coalesce(data->>'branchId',branch_ids[1])=v_branch
    and coalesce(data->>'status','active')<>'cancelled' for update;
  if not found then raise exception 'Selected batch does not belong to this product and branch';end if;
  if p_delta<0 and coalesce(nullif(v_batch.data->>'remainingQty','')::numeric,0)<abs(p_delta) then
   raise exception 'Selected batch has insufficient available quantity for this reduction';
  end if;
  if p_delta>0 and coalesce(nullif(v_batch.data->>'expiryDate','')::date,'9999-12-31'::date)<v_today then
   raise exception 'Expired batch stock cannot be increased';
  end if;
 elsif coalesce(p_batch_id,'')<>'' then
  raise exception 'This product has no tracked batch for the selected adjustment';
 end if;
 insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
 values(p_org_id,'mberp_stock_adjustments',v_id,array[v_branch],
  pg_catalog.jsonb_build_object('id',v_id,'requestNo','ADJ-'||to_char(pg_catalog.now(),'YYYY')||'-'||upper(substr(v_id,1,6)),
   'date',pg_catalog.now(),'productId',p_product_id,'productName',v_product.data->>'name',
   'sku',v_product.data->>'sku','branchId',v_branch,
   'branchName',(select data->>'name' from public.etihad_records where org_id=p_org_id and collection='mberp_branches' and record_id=v_branch limit 1),
   'batchId',nullif(p_batch_id,''),'batchNo',v_batch.data->>'batchNo',
   'delta',p_delta,'qtyBefore',v_before,'qtyAfterRequested',v_after,'reason',pg_catalog.btrim(p_reason),
   'status','pending','requestedBy',v_user,'requestedAt',pg_catalog.now()),v_user);
 return pg_catalog.jsonb_build_object('success',true,'requestId',v_id,'status','pending','qtyBefore',v_before,'qtyAfterRequested',v_after,'batchId',nullif(p_batch_id,''));
end;
$function$;

create or replace function public.etihad_request_stock_adjustment_v2(
 p_org_id uuid,p_product_id text,p_delta numeric,p_reason text,p_request_id text,p_batch_id text default null
) returns jsonb
language sql set search_path=''
as $function$
 select private.etihad_request_stock_adjustment_v2($1,$2,$3,$4,$5,$6);
$function$;

revoke all on function public.etihad_request_stock_adjustment(uuid,text,numeric,text,text) from public,anon,authenticated;
revoke all on function public.etihad_request_stock_adjustment_v2(uuid,text,numeric,text,text,text) from public,anon;
grant execute on function public.etihad_request_stock_adjustment_v2(uuid,text,numeric,text,text,text) to authenticated;

create or replace function private.etihad_review_stock_adjustment(
 p_org_id uuid,p_request_id text,p_decision text,p_note text default ''
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
 v_user uuid:=auth.uid();v_role text;v_request record;v_product record;v_batch record;v_branch text;
 v_before numeric;v_after numeric;v_delta numeric;v_batch_count integer;v_batch_total numeric;
 v_batch_before numeric;v_batch_after numeric;v_movement_id text;
 v_now timestamptz:=pg_catalog.now();v_today date:=(pg_catalog.now() at time zone 'Asia/Karachi')::date;
begin
 if v_user is null then raise exception 'Authentication required';end if;
 if p_decision not in ('approved','rejected') then raise exception 'Decision must be approved or rejected';end if;
 select role into v_role from public.etihad_memberships where org_id=p_org_id and user_id=v_user and active=true limit 1;
 if not found or v_role<>'owner' then raise exception 'Only an active owner can approve or reject stock adjustments';end if;
 select record_id,data,branch_ids into v_request from public.etihad_records
 where org_id=p_org_id and collection='mberp_stock_adjustments' and record_id=p_request_id for update;
 if not found then raise exception 'Stock adjustment request not found';end if;
 if v_request.data->>'status'<>'pending' then raise exception 'This request has already been reviewed';end if;
 v_branch:=v_request.data->>'branchId';v_delta:=coalesce(nullif(v_request.data->>'delta','')::numeric,0);
 if p_decision='approved' then
  select record_id,data,branch_ids into v_product from public.etihad_records
  where org_id=p_org_id and collection='mberp_products' and record_id=v_request.data->>'productId' for update;
  if not found then raise exception 'Product no longer exists; request remains pending';end if;
  if coalesce(v_product.data->>'branchId','')<>v_branch or not(v_branch=any(v_product.branch_ids)) then raise exception 'Product branch changed; cannot approve this request';end if;
  v_before:=coalesce(nullif(v_product.data->>'qty','')::numeric,0);v_after:=v_before+v_delta;
  if v_after<0 then raise exception 'Current stock is now too low to approve this adjustment';end if;
  select count(*)::integer,coalesce(sum(coalesce(nullif(data->>'remainingQty','')::numeric,0)),0)
   into v_batch_count,v_batch_total from public.etihad_records
   where org_id=p_org_id and collection='mberp_stock_batches'
    and data->>'productId'=v_request.data->>'productId'
    and coalesce(data->>'branchId',branch_ids[1])=v_branch
    and coalesce(data->>'status','active')<>'cancelled';
  if v_batch_count>0 then
   if abs(v_batch_total-v_before)>0.000001 then
    raise exception 'Batch stock (%) no longer reconciles with product stock (%). Reconcile batches before approval.',v_batch_total,v_before;
   end if;
   if coalesce(v_request.data->>'batchId','')='' then raise exception 'This request has no batch allocation. Submit a new batch-specific request';end if;
   select record_id,data into v_batch from public.etihad_records
    where org_id=p_org_id and collection='mberp_stock_batches' and record_id=v_request.data->>'batchId'
     and data->>'productId'=v_request.data->>'productId'
     and coalesce(data->>'branchId',branch_ids[1])=v_branch
     and coalesce(data->>'status','active')<>'cancelled' for update;
   if not found then raise exception 'Selected batch no longer exists; request remains pending';end if;
   v_batch_before:=coalesce(nullif(v_batch.data->>'remainingQty','')::numeric,0);
   if v_delta<0 and v_batch_before<abs(v_delta) then raise exception 'Selected batch no longer has enough stock to approve this reduction';end if;
   if v_delta>0 and coalesce(nullif(v_batch.data->>'expiryDate','')::date,'9999-12-31'::date)<v_today then
    raise exception 'Expired batch stock cannot be increased';
   end if;
   v_batch_after:=v_batch_before+v_delta;
   update public.etihad_records set data=v_batch.data||pg_catalog.jsonb_build_object(
    'remainingQty',v_batch_after,
    'status',case when v_batch_after<=0 then 'depleted'
      when coalesce(nullif(v_batch.data->>'expiryDate','')::date,'9999-12-31'::date)<v_today then 'expired'
      else 'active' end,
    'lastAdjustmentAt',v_now
   ),updated_by=v_user,updated_at=v_now
   where org_id=p_org_id and collection='mberp_stock_batches' and record_id=v_batch.record_id;
   v_movement_id:=pg_catalog.gen_random_uuid()::text;
   insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
   values(p_org_id,'mberp_stock_batch_movements',v_movement_id,array[v_branch],
    pg_catalog.jsonb_build_object('id',v_movement_id,'type','stock_adjustment','date',v_now,
     'adjustmentId',p_request_id,'requestNo',v_request.data->>'requestNo',
     'productId',v_request.data->>'productId','productName',v_request.data->>'productName',
     'batchId',v_batch.record_id,'batchNo',v_batch.data->>'batchNo',
     'branchId',v_branch,'branchName',v_request.data->>'branchName',
     'qty',v_delta,'remainingQtyAfter',v_batch_after,'note',coalesce(nullif(p_note,''),v_request.data->>'reason')),v_user);
  elsif coalesce(v_request.data->>'batchId','')<>'' then
   raise exception 'The batch linked to this request is no longer present';
  end if;
  update public.etihad_records set data=pg_catalog.jsonb_set(v_product.data,'{qty}',pg_catalog.to_jsonb(v_after),true),updated_by=v_user,updated_at=v_now
   where org_id=p_org_id and collection='mberp_products' and record_id=v_product.record_id;
 else
  v_before:=coalesce(nullif(v_request.data->>'qtyBefore','')::numeric,0);v_after:=v_before;
 end if;
 update public.etihad_records set data=data||pg_catalog.jsonb_build_object(
  'status',p_decision,'reviewedBy',v_user,'reviewedAt',v_now,
  'qtyBeforeApproval',v_before,'qtyAfter',v_after,'reviewNote',coalesce(p_note,'')
 ),updated_by=v_user,updated_at=v_now
 where org_id=p_org_id and collection='mberp_stock_adjustments' and record_id=p_request_id;
 return pg_catalog.jsonb_build_object('success',true,'requestId',p_request_id,'status',p_decision,'qtyBefore',v_before,'qtyAfter',v_after);
end;
$function$;
