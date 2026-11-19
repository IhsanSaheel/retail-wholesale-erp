-- Validate supplier identity, branch and amount before any purchase stock update.
create or replace function private.etihad_create_purchase_idempotent(
 p_org_id uuid,p_branch_id text,p_purchase jsonb,p_paid numeric,p_method text
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
 v_user uuid:=auth.uid();v_role text;v_branches text[];v_existing public.etihad_records%rowtype;
 v_id text;v_expected jsonb;v_qty numeric;v_cost numeric;v_total numeric;v_supplier_id text;
begin
 if v_user is null then raise exception 'Authentication required'; end if;
 if p_purchase is null or coalesce(p_purchase->>'id','')='' then raise exception 'A stable purchase reference is required'; end if;
 if coalesce(p_branch_id,'')='' or coalesce(p_purchase->>'branchId','')<>p_branch_id then raise exception 'Purchase branch does not match the selected branch'; end if;
 v_qty:=coalesce(nullif(p_purchase->>'qty','')::numeric,0);v_cost:=coalesce(nullif(p_purchase->>'cost','')::numeric,0);v_total:=coalesce(nullif(p_purchase->>'total','')::numeric,-1);
 if v_qty<=0 or v_cost<0 or v_total<0 or abs(v_total-v_qty*v_cost)>0.01 then raise exception 'Purchase total must equal received quantity multiplied by unit cost'; end if;
 if coalesce(p_paid,0)<0 or p_paid>v_qty*v_cost then raise exception 'Purchase payment must be between zero and purchase total'; end if;
 v_supplier_id:=coalesce(p_purchase->>'supplierId','');
 if v_supplier_id='' then raise exception 'Select a registered supplier before recording a purchase'; end if;
 if not exists(select 1 from public.etihad_records s where s.org_id=p_org_id and s.collection='mberp_suppliers' and s.record_id=v_supplier_id and coalesce((s.data->>'active')::boolean,true)) then raise exception 'Selected supplier does not exist or is inactive'; end if;
 select role,coalesce(branch_ids,array[]::text[]) into v_role,v_branches from public.etihad_memberships where org_id=p_org_id and user_id=v_user and active=true limit 1;
 if not found then raise exception 'Active business membership required'; end if;
 if v_role not in ('owner','manager','stockkeeper','accountant') then raise exception 'Your role cannot record purchases'; end if;
 if v_role<>'owner' and not(p_branch_id=any(v_branches)) then raise exception 'You do not have access to this branch'; end if;
 v_id:=p_purchase->>'id';perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org_id::text||':purchase:'||v_id,0));
 v_expected:=p_purchase||pg_catalog.jsonb_build_object('id',v_id,'paid',p_paid,'balance',greatest(0,v_qty*v_cost-p_paid));
 select * into v_existing from public.etihad_records where org_id=p_org_id and collection='mberp_purchases' and record_id=v_id for update;
 if found then
  if v_existing.updated_by=v_user and v_existing.data=v_expected then return pg_catalog.jsonb_build_object('success',true,'purchaseId',v_id,'alreadyRecorded',true,'stockAdded',0); end if;
  raise exception 'This purchase reference already exists with different or unauthorised details';
 end if;
 return private.etihad_create_purchase(p_org_id,p_branch_id,p_purchase,p_paid,p_method);
end;
$function$;
revoke all on function private.etihad_create_purchase_idempotent(uuid,text,jsonb,numeric,text) from public,anon;
grant execute on function private.etihad_create_purchase_idempotent(uuid,text,jsonb,numeric,text) to authenticated;