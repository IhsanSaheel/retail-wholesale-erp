create or replace function private.etihad_request_stock_adjustment(p_org_id uuid,p_product_id text,p_delta numeric,p_reason text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); r text; bs text[]; p record; b text; oldq numeric; newq numeric; rid text:=coalesce(nullif(p_request_id,''),gen_random_uuid()::text); ex public.etihad_records%rowtype;
begin
 if u is null then raise exception 'Authentication required';end if;
 if coalesce(p_delta,0)=0 or length(btrim(coalesce(p_reason,'')))<4 then raise exception 'Enter a non-zero adjustment and a reason of at least 4 characters';end if;
 select role,coalesce(branch_ids,array[]::text[]) into r,bs from public.etihad_memberships where org_id=p_org_id and user_id=u and active=true limit 1;
 if not found or r not in ('owner','manager','stockkeeper') then raise exception 'Active authorised membership required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':stock-adjustment:'||rid,0));
 select * into ex from public.etihad_records where org_id=p_org_id and collection='mberp_stock_adjustments' and record_id=rid for update;
 if found then
  if ex.updated_by=u and ex.data->>'productId'=p_product_id and (ex.data->>'delta')::numeric=p_delta and coalesce(ex.data->>'reason','')=btrim(p_reason) then return jsonb_build_object('success',true,'requestId',rid,'status',ex.data->>'status','alreadyRecorded',true);end if;
  raise exception 'Adjustment reference already exists with different details';
 end if;
 select record_id,data,branch_ids into p from public.etihad_records where org_id=p_org_id and collection='mberp_products' and record_id=p_product_id for update;
 if not found then raise exception 'Product not found';end if;
 b:=coalesce(p.data->>'branchId',p.branch_ids[1]);
 if b is null or not(b=any(p.branch_ids)) or (r<>'owner' and not(b=any(bs))) then raise exception 'Product branch is not accessible';end if;
 oldq:=coalesce(nullif(p.data->>'qty','')::numeric,0);newq:=oldq+p_delta;
 if newq<0 then raise exception 'Adjustment would make stock negative';end if;
 insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
 values(p_org_id,'mberp_stock_adjustments',rid,array[b],jsonb_build_object('id',rid,'requestNo','ADJ-'||to_char(now(),'YYYY')||'-'||upper(substr(rid,1,6)),'date',now(),'requestedAt',now(),'productId',p_product_id,'productName',p.data->>'name','branchId',b,'branchName',(select data->>'name' from public.etihad_records where org_id=p_org_id and collection='mberp_branches' and record_id=b limit 1),'delta',p_delta,'qtyBefore',oldq,'qtyAfterRequested',newq,'reason',btrim(p_reason),'status','pending','requestedBy',u),u);
 return jsonb_build_object('success',true,'requestId',rid,'status','pending','qtyBefore',oldq,'qtyAfterRequested',newq);
end $$;
create or replace function private.etihad_review_stock_adjustment(p_org_id uuid,p_request_id text,p_decision text,p_note text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); r text; q record; p record; b text; oldq numeric; newq numeric; d numeric;
begin
 if u is null then raise exception 'Authentication required';end if;
 if p_decision not in ('approved','rejected') then raise exception 'Invalid review decision';end if;
 select role into r from public.etihad_memberships where org_id=p_org_id and user_id=u and active=true limit 1;
 if not found or r<>'owner' then raise exception 'Only an active owner may review stock adjustments';end if;
 select record_id,data,branch_ids into q from public.etihad_records where org_id=p_org_id and collection='mberp_stock_adjustments' and record_id=p_request_id for update;
 if not found or q.data->>'status'<>'pending' then raise exception 'Pending adjustment request not found';end if;
 b:=q.data->>'branchId';d:=(q.data->>'delta')::numeric;
 if p_decision='approved' then
  select record_id,data,branch_ids into p from public.etihad_records where org_id=p_org_id and collection='mberp_products' and record_id=q.data->>'productId' for update;
  if not found then raise exception 'Product no longer exists';end if;
  if coalesce(p.data->>'branchId','')<>b or not(b=any(p.branch_ids)) then raise exception 'Product branch changed; cannot approve';end if;
  oldq:=coalesce(nullif(p.data->>'qty','')::numeric,0);newq:=oldq+d;
  if newq<0 then raise exception 'Current stock is too low to approve';end if;
  update public.etihad_records set data=jsonb_set(p.data,'{qty}',to_jsonb(newq),true),updated_by=u,updated_at=now() where org_id=p_org_id and collection='mberp_products' and record_id=p.record_id;
 else oldq:=coalesce((q.data->>'qtyBefore')::numeric,0);newq:=oldq;end if;
 update public.etihad_records set data=data||jsonb_build_object('status',p_decision,'reviewedBy',u,'reviewedAt',now(),'qtyBeforeApproval',oldq,'qtyAfter',newq,'reviewNote',coalesce(p_note,'')),updated_by=u,updated_at=now() where org_id=p_org_id and collection='mberp_stock_adjustments' and record_id=p_request_id;
 return jsonb_build_object('success',true,'requestId',p_request_id,'status',p_decision,'qtyBefore',oldq,'qtyAfter',newq);
end $$;
create or replace function public.etihad_request_stock_adjustment(uuid,text,numeric,text,text) returns jsonb language sql set search_path='' as $$ select private.etihad_request_stock_adjustment($1,$2,$3,$4,$5) $$;
create or replace function public.etihad_review_stock_adjustment(uuid,text,text,text default '') returns jsonb language sql set search_path='' as $$ select private.etihad_review_stock_adjustment($1,$2,$3,$4) $$;
revoke all on function private.etihad_request_stock_adjustment(uuid,text,numeric,text,text) from public,anon,authenticated;
revoke all on function private.etihad_review_stock_adjustment(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.etihad_request_stock_adjustment(uuid,text,numeric,text,text) from public,anon,authenticated;
revoke all on function public.etihad_review_stock_adjustment(uuid,text,text,text) from public,anon,authenticated;
grant execute on function private.etihad_request_stock_adjustment(uuid,text,numeric,text,text) to authenticated;
grant execute on function private.etihad_review_stock_adjustment(uuid,text,text,text) to authenticated;
grant execute on function public.etihad_request_stock_adjustment(uuid,text,numeric,text,text) to authenticated;
grant execute on function public.etihad_review_stock_adjustment(uuid,text,text,text) to authenticated;