-- Make retrying an offline checkout safe after a lost response.
-- A sale with the same stable ID and identical authenticated payload returns
-- its prior success without running the stock/payment transaction a second time.

create or replace function public.etihad_create_sale(
 p_org_id uuid,p_branch_id text,p_sale jsonb,p_cash_applied numeric,
 p_advance_used numeric,p_customer_advance numeric,p_staff_tip numeric,p_method text
) returns jsonb
language plpgsql
set search_path=''
as $function$
declare
 v_total numeric;v_paid numeric;v_balance numeric;v_item_total numeric;v_tender numeric;v_extra numeric;
 v_resolution text;v_role text;v_branches text[];v_existing public.etihad_records%rowtype;
 v_sale_id text;v_user uuid:=auth.uid();
begin
 if v_user is null then raise exception 'Authentication required'; end if;
 if p_sale is null or jsonb_typeof(p_sale->'items')<>'array' then raise exception 'Invalid sale details'; end if;
 v_total:=coalesce(nullif(p_sale->>'total','')::numeric,-1);
 v_paid:=coalesce(nullif(p_sale->>'paid','')::numeric,-1);
 v_balance:=coalesce(nullif(p_sale->>'balance','')::numeric,-1);
 v_tender:=coalesce(p_cash_applied,0)+coalesce(p_advance_used,0);
 v_extra:=greatest(0,v_tender-v_total);
 v_resolution:=coalesce(p_sale->>'overpaymentResolution','none');
 select role,coalesce(branch_ids,array[]::text[]) into v_role,v_branches
 from public.etihad_memberships where org_id=p_org_id and user_id=v_user and active=true limit 1;
 if not found then raise exception 'Active business membership required'; end if;
 if v_role not in ('owner','manager','cashier') then raise exception 'Your role cannot create sales'; end if;
 if v_role<>'owner' and not(p_branch_id=any(v_branches)) then raise exception 'You do not have access to this branch'; end if;
 if v_total<0 or v_paid<0 or v_balance<0 then raise exception 'Invalid invoice amounts'; end if;
 select coalesce(sum(coalesce(nullif(value->>'qty','')::numeric,0)*coalesce(nullif(value->>'price','')::numeric,0)),0)
 into v_item_total from jsonb_array_elements(p_sale->'items');
 if abs(v_item_total-v_total)>0.01 then raise exception 'Invoice total does not match its line items'; end if;
 if abs(v_paid-least(v_total,v_tender))>0.01 or abs(v_balance-greatest(0,v_total-v_tender))>0.01 then
  raise exception 'Payment allocation does not match the invoice total'; end if;
 if coalesce(p_customer_advance,0)<0 or coalesce(p_staff_tip,0)<0 or coalesce(p_cash_applied,0)<0 or coalesce(p_advance_used,0)<0 then
  raise exception 'Payment amounts cannot be negative'; end if;
 if v_resolution='advance' and (abs(coalesce(p_customer_advance,0)-v_extra)>0.01 or coalesce(p_staff_tip,0)<>0) then
  raise exception 'Customer advance must equal the extra received amount';
 elsif v_resolution='tip' and (abs(coalesce(p_staff_tip,0)-v_extra)>0.01 or coalesce(p_customer_advance,0)<>0) then
  raise exception 'Staff tip must equal the extra received amount';
 elsif v_resolution in ('change','none') and (coalesce(p_customer_advance,0)<>0 or coalesce(p_staff_tip,0)<>0) then
  raise exception 'Change cannot also be saved as advance or tip';
 elsif v_resolution not in ('advance','tip','change','none') then
  raise exception 'Invalid overpayment resolution';
 end if;

 v_sale_id:=coalesce(nullif(p_sale->>'id',''),'');
 if v_sale_id<>'' then
  select * into v_existing from public.etihad_records
   where org_id=p_org_id and collection='mberp_sales' and record_id=v_sale_id for update;
  if found then
   if v_existing.updated_by=v_user
      and v_existing.data=p_sale || jsonb_build_object('id',v_sale_id) then
    return jsonb_build_object('success',true,'saleId',v_sale_id,
      'invoiceNo',coalesce(p_sale->>'invoiceNo',''),'alreadyRecorded',true,
      'stockItemsDeducted',0);
   end if;
   raise exception 'This sale reference already exists with different or unauthorised details';
  end if;
 end if;
 return private.etihad_create_sale(p_org_id,p_branch_id,p_sale,p_cash_applied,p_advance_used,p_customer_advance,p_staff_tip,p_method);
end;
$function$;
revoke all on function public.etihad_create_sale(uuid,text,jsonb,numeric,numeric,numeric,numeric,text) from public,anon;
grant execute on function public.etihad_create_sale(uuid,text,jsonb,numeric,numeric,numeric,numeric,text) to authenticated;
