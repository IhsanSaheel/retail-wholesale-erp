create or replace function private.etihad_transfer_stock_batch_aware(
 p_org_id uuid,p_from_branch text,p_to_branch text,p_product_id text,p_qty numeric,p_note text,p_transfer_id text,p_batch_id text
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
 v_user uuid:=auth.uid();v_role text;v_branches text[];v_source record;v_target record;v_batch record;
 v_source_qty numeric;v_target_qty numeric;v_new_id text;v_transfer_record_id text;v_transfer_no text;v_sku text;v_name text;
 v_source_batch_count integer;v_source_batch_total numeric;v_target_batch_count integer;v_target_batch_total numeric;
 v_batch_before numeric;v_batch_after numeric;v_destination_batch_id text;v_movement_id text;
 v_branch_name text;v_today date:=(pg_catalog.now() at time zone 'Asia/Karachi')::date;v_expiry date;
begin
 if v_user is null then raise exception 'Authentication required';end if;
 if coalesce(p_transfer_id,'')='' then raise exception 'A stable transfer reference is required';end if;
 if p_from_branch=p_to_branch or coalesce(p_from_branch,'')='' or coalesce(p_to_branch,'')='' then raise exception 'Choose two different branches';end if;
 if coalesce(p_qty,0)<=0 then raise exception 'Transfer quantity must be greater than zero';end if;
 select role,coalesce(branch_ids,array[]::text[]) into v_role,v_branches from public.etihad_memberships
  where org_id=p_org_id and user_id=v_user and active=true limit 1;
 if not found then raise exception 'Active business membership required';end if;
 if v_role not in ('owner','manager','stockkeeper') then raise exception 'Your role cannot transfer stock';end if;
 if v_role<>'owner' and (not(p_from_branch=any(v_branches)) or not(p_to_branch=any(v_branches))) then
  raise exception 'You need access to both source and destination branches';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org_id::text||':stock-transfer:'||p_transfer_id,0));
 select record_id,data,branch_ids into v_source from public.etihad_records
  where org_id=p_org_id and collection='mberp_products' and record_id=p_product_id for update;
 if not found then raise exception 'Source product not found';end if;
 if coalesce(v_source.data->>'branchId','')<>p_from_branch or not(p_from_branch=any(v_source.branch_ids)) then
  raise exception 'Product does not belong to the source branch';
 end if;
 v_source_qty:=coalesce(nullif(v_source.data->>'qty','')::numeric,0);
 if v_source_qty<p_qty then raise exception 'Insufficient source stock. Available: %',v_source_qty;end if;
 select count(*)::integer,coalesce(sum(coalesce(nullif(data->>'remainingQty','')::numeric,0)),0)
  into v_source_batch_count,v_source_batch_total from public.etihad_records
  where org_id=p_org_id and collection='mberp_stock_batches' and data->>'productId'=p_product_id
   and coalesce(data->>'branchId',branch_ids[1])=p_from_branch and coalesce(data->>'status','active')<>'cancelled';
 if v_source_batch_count>0 then
  if abs(v_source_batch_total-v_source_qty)>0.000001 then
   raise exception 'Source batch stock (%) does not reconcile with product stock (%). Reconcile it before transferring.',v_source_batch_total,v_source_qty;
  end if;
  if coalesce(p_batch_id,'')='' then raise exception 'Select the batch / lot to transfer';end if;
  select record_id,data into v_batch from public.etihad_records
   where org_id=p_org_id and collection='mberp_stock_batches' and record_id=p_batch_id
    and data->>'productId'=p_product_id and coalesce(data->>'branchId',branch_ids[1])=p_from_branch
    and coalesce(data->>'status','active')<>'cancelled' for update;
  if not found then raise exception 'Selected batch does not belong to the source product and branch';end if;
  v_batch_before:=coalesce(nullif(v_batch.data->>'remainingQty','')::numeric,0);
  if v_batch_before<p_qty then raise exception 'Selected batch has insufficient quantity. Available: %',v_batch_before;end if;
 else
  if coalesce(p_batch_id,'')<>'' then raise exception 'Selected batch does not belong to a batch-tracked source product';end if;
  v_batch_before:=0;v_batch_after:=0;
 end if;
 v_sku:=coalesce(v_source.data->>'sku','');v_name:=coalesce(v_source.data->>'name','Product');
 update public.etihad_records set data=pg_catalog.jsonb_set(v_source.data,'{qty}',pg_catalog.to_jsonb(v_source_qty-p_qty),true),
  updated_by=v_user,updated_at=pg_catalog.now()
  where org_id=p_org_id and collection='mberp_products' and record_id=p_product_id;
 select record_id,data,branch_ids into v_target from public.etihad_records
  where org_id=p_org_id and collection='mberp_products' and data->>'branchId'=p_to_branch
   and ((v_sku<>'' and data->>'sku'=v_sku) or (v_sku='' and lower(data->>'name')=lower(v_name)))
  order by updated_at desc limit 1 for update;
 if found then
  v_target_qty:=coalesce(nullif(v_target.data->>'qty','')::numeric,0);
  select count(*)::integer,coalesce(sum(coalesce(nullif(data->>'remainingQty','')::numeric,0)),0)
   into v_target_batch_count,v_target_batch_total from public.etihad_records
   where org_id=p_org_id and collection='mberp_stock_batches' and data->>'productId'=v_target.record_id
    and coalesce(data->>'branchId',branch_ids[1])=p_to_branch and coalesce(data->>'status','active')<>'cancelled';
  if v_source_batch_count>0 and v_target_qty>0 and v_target_batch_count=0 then
   raise exception 'Destination product has existing untracked stock. Reconcile its batch records before transferring a tracked lot';
  end if;
  if v_target_batch_count>0 and abs(v_target_batch_total-v_target_qty)>0.000001 then
   raise exception 'Destination batch stock (%) does not reconcile with product stock (%). Reconcile it before transferring.',v_target_batch_total,v_target_qty;
  end if;
  if v_source_batch_count=0 and v_target_batch_count>0 then
   raise exception 'Destination product is batch-tracked but source stock has no batch identity; transfer is blocked';
  end if;
  v_new_id:=v_target.record_id;
  update public.etihad_records set data=pg_catalog.jsonb_set(v_target.data,'{qty}',pg_catalog.to_jsonb(v_target_qty+p_qty),true),
   updated_by=v_user,updated_at=pg_catalog.now()
   where org_id=p_org_id and collection='mberp_products' and record_id=v_target.record_id;
 else
  v_new_id:=pg_catalog.gen_random_uuid()::text;
  insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
  values(p_org_id,'mberp_products',v_new_id,array[p_to_branch],
   v_source.data||pg_catalog.jsonb_build_object('id',v_new_id,'branchId',p_to_branch,'qty',p_qty),v_user);
  v_target_qty:=0;v_target_batch_count:=0;
 end if;
 v_transfer_record_id:=pg_catalog.gen_random_uuid()::text;
 v_transfer_no:='TRF-'||to_char(pg_catalog.now(),'YYYY')||'-'||upper(substr(v_transfer_record_id,1,6));
 select data->>'name' into v_branch_name from public.etihad_records
  where org_id=p_org_id and collection='mberp_branches' and record_id=p_to_branch limit 1;
 if v_source_batch_count>0 then
  v_batch_after:=v_batch_before-p_qty;
  v_expiry:=coalesce(nullif(v_batch.data->>'expiryDate','')::date,null);
  update public.etihad_records set data=v_batch.data||pg_catalog.jsonb_build_object(
   'remainingQty',v_batch_after,'status',case when v_batch_after<=0 then 'depleted' when v_expiry is not null and v_expiry<v_today then 'expired' else 'active' end,
   'lastTransferAt',pg_catalog.now()),updated_by=v_user,updated_at=pg_catalog.now()
   where org_id=p_org_id and collection='mberp_stock_batches' and record_id=v_batch.record_id;
  v_destination_batch_id:=pg_catalog.gen_random_uuid()::text;
  insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
  values(p_org_id,'mberp_stock_batches',v_destination_batch_id,array[p_to_branch],
   v_batch.data||pg_catalog.jsonb_build_object('id',v_destination_batch_id,'productId',v_new_id,'productName',v_name,
    'branchId',p_to_branch,'branchName',v_branch_name,'qty',p_qty,'remainingQty',p_qty,
    'status',case when v_expiry is not null and v_expiry<v_today then 'expired' else 'active' end,
    'sourceBatchId',v_batch.record_id,'transferId',v_transfer_record_id,'receivedDate',v_today),v_user);
  v_movement_id:=pg_catalog.gen_random_uuid()::text;
  insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
  values(p_org_id,'mberp_stock_batch_movements',v_movement_id,array[p_from_branch],
   pg_catalog.jsonb_build_object('id',v_movement_id,'type','stock_transfer_out','date',pg_catalog.now(),
    'transferId',v_transfer_record_id,'transferNo',v_transfer_no,'productId',p_product_id,'productName',v_name,
    'batchId',v_batch.record_id,'batchNo',v_batch.data->>'batchNo','branchId',p_from_branch,
    'branchName',v_batch.data->>'branchName','qty',-p_qty,'remainingQtyAfter',v_batch_after,'note',coalesce(p_note,'')),v_user);
  v_movement_id:=pg_catalog.gen_random_uuid()::text;
  insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
  values(p_org_id,'mberp_stock_batch_movements',v_movement_id,array[p_to_branch],
   pg_catalog.jsonb_build_object('id',v_movement_id,'type','stock_transfer_in','date',pg_catalog.now(),
    'transferId',v_transfer_record_id,'transferNo',v_transfer_no,'productId',v_new_id,'productName',v_name,
    'batchId',v_destination_batch_id,'sourceBatchId',v_batch.record_id,'batchNo',v_batch.data->>'batchNo',
    'branchId',p_to_branch,'branchName',v_branch_name,'qty',p_qty,'remainingQtyAfter',p_qty,'note',coalesce(p_note,'')),v_user);
 end if;
 insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
 values(p_org_id,'mberp_transfers',v_transfer_record_id,array[p_from_branch,p_to_branch],
  pg_catalog.jsonb_build_object('id',v_transfer_record_id,'transferNo',v_transfer_no,'date',pg_catalog.now(),
   'productId',v_new_id,'sourceProductId',p_product_id,'productName',v_name,'sku',v_sku,'qty',p_qty,
   'fromBranchId',p_from_branch,'toBranchId',p_to_branch,
   'fromBranchName',(select data->>'name' from public.etihad_records where org_id=p_org_id and collection='mberp_branches' and record_id=p_from_branch limit 1),
   'toBranchName',v_branch_name,'note',coalesce(p_note,''),'sourceBatchId',nullif(p_batch_id,''),'destinationBatchId',v_destination_batch_id),v_user);
 return pg_catalog.jsonb_build_object('success',true,'transferId',v_transfer_record_id,'destinationProductId',v_new_id,
  'stockTransferred',p_qty,'sourceBatchId',nullif(p_batch_id,''),'destinationBatchId',v_destination_batch_id);
end;
$function$;

create or replace function private.etihad_transfer_stock_idempotent_v2(
 p_org_id uuid,p_from_branch text,p_to_branch text,p_product_id text,p_qty numeric,p_note text,p_transfer_id text,p_batch_id text default null
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare v_user uuid:=auth.uid();v_request jsonb;v_existing record;v_response jsonb;
begin
 if v_user is null then raise exception 'Authentication required';end if;
 if coalesce(p_transfer_id,'')='' then raise exception 'A stable transfer reference is required';end if;
 v_request:=pg_catalog.jsonb_build_object('fromBranch',p_from_branch,'toBranch',p_to_branch,'productId',p_product_id,
  'quantity',p_qty,'note',coalesce(p_note,''),'batchId',nullif(p_batch_id,''));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org_id::text||':stock-transfer:'||p_transfer_id,0));
 select request_data,response_data,created_by into v_existing from private.etihad_operation_idempotency
  where org_id=p_org_id and operation='stock_transfer' and operation_id=p_transfer_id for update;
 if found then
  if v_existing.created_by=v_user and v_existing.request_data=v_request then
   return v_existing.response_data||pg_catalog.jsonb_build_object('alreadyRecorded',true);
  end if;
  raise exception 'This transfer reference already exists with different or unauthorised details';
 end if;
 v_response:=private.etihad_transfer_stock_batch_aware(p_org_id,p_from_branch,p_to_branch,p_product_id,p_qty,p_note,p_transfer_id,p_batch_id);
 if coalesce((v_response->>'success')::boolean,false) is not true then raise exception 'Stock transfer was not confirmed';end if;
 insert into private.etihad_operation_idempotency(org_id,operation,operation_id,request_data,response_data,created_by)
 values(p_org_id,'stock_transfer',p_transfer_id,v_request,v_response,v_user);
 return v_response||pg_catalog.jsonb_build_object('alreadyRecorded',false);
end;
$function$;

create or replace function public.etihad_transfer_stock_v2(
 p_org_id uuid,p_from_branch text,p_to_branch text,p_product_id text,p_qty numeric,p_note text,p_transfer_id text,p_batch_id text default null
) returns jsonb
language sql security definer set search_path=''
as $function$
 select private.etihad_transfer_stock_idempotent_v2($1,$2,$3,$4,$5,$6,$7,$8);
$function$;

revoke all on function private.etihad_transfer_stock_batch_aware(uuid,text,text,text,numeric,text,text,text) from public,anon,authenticated;
revoke all on function private.etihad_transfer_stock_idempotent_v2(uuid,text,text,text,numeric,text,text,text) from public,anon,authenticated;
revoke all on function public.etihad_transfer_stock(uuid,text,text,text,numeric,text,text) from public,anon,authenticated;
revoke all on function public.etihad_transfer_stock_v2(uuid,text,text,text,numeric,text,text,text) from public,anon;
grant execute on function public.etihad_transfer_stock_v2(uuid,text,text,text,numeric,text,text,text) to authenticated;
