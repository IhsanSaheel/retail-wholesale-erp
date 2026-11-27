CREATE OR REPLACE FUNCTION public.etihad_customer_lookup(p_org_id uuid, p_customer_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_user uuid:=auth.uid(); v_role text; v_permissions jsonb:='{}'::jsonb; v_phone text; v_profile jsonb;
 v_sales jsonb:='[]'::jsonb; v_payments jsonb:='[]'::jsonb; v_credits jsonb:='[]'::jsonb;
 v_points numeric:=0; v_outstanding numeric:=0; v_advance numeric:=0; v_lifetime numeric:=0; v_invoice_count integer:=0;
begin
 if v_user is null then raise exception 'Authentication required'; end if;
 v_phone:=private.normalize_customer_phone(p_customer_phone);
 if pg_catalog.length(v_phone)<7 or pg_catalog.length(v_phone)>15 then raise exception 'Enter a valid customer phone number'; end if;
 select m.role,coalesce(m.permissions,'{}'::jsonb) into v_role,v_permissions from public.etihad_memberships m
 where m.org_id=p_org_id and m.user_id=v_user and m.active=true limit 1;
 if not found then raise exception 'Active business membership required'; end if;
 if v_role not in ('owner','manager','accountant','cashier') then raise exception 'Your role cannot view customer accounts'; end if;
 if v_role='cashier' and (coalesce((v_permissions->>'sales')::boolean,false)=false or coalesce((v_permissions->>'payments')::boolean,false)=false) then
  raise exception 'Customer cross-branch history requires sales and payments permission'; end if;
 if not public.etihad_record_access(p_org_id,'mberp_customers',array[]::text[],'read') then raise exception 'Customer directory access is required'; end if;
 select c.data into v_profile from public.etihad_records c where c.org_id=p_org_id and c.collection='mberp_customers'
 and private.normalize_customer_phone(c.data->>'phone')=v_phone order by c.updated_at desc nulls last,c.record_id limit 1;
 with sale_rows as (
  select r.record_id,r.data,r.updated_at,coalesce(nullif(r.data->>'total','')::numeric,0) total,coalesce(nullif(r.data->>'paid','')::numeric,0) paid,
   coalesce(nullif(r.data->>'balance','')::numeric,0) stored_balance,coalesce(ret.applied,0) return_applied,lower(coalesce(r.data->>'status','')) status
  from public.etihad_records r left join lateral (
   select sum(case when x.data ? 'balanceApplied' and nullif(x.data->>'balanceApplied','') is not null then greatest(0,coalesce(nullif(x.data->>'balanceApplied','')::numeric,0))
    when x.data ? 'creditAmount' and nullif(x.data->>'creditAmount','') is not null then 0
    else greatest(0,coalesce(nullif(x.data->>'amount','')::numeric,0)-coalesce(nullif(x.data->>'refundAmount','')::numeric,0)-coalesce(nullif(x.data->>'cashRefund','')::numeric,0)) end) applied
   from public.etihad_records x where x.org_id=p_org_id and x.collection='mberp_sales_returns' and x.data->>'saleId'=r.record_id
  ) ret on true
  where r.org_id=p_org_id and r.collection='mberp_sales' and private.normalize_customer_phone(r.data->>'customerPhone')=v_phone and coalesce(r.data->>'recycleBinId','')=''
 ), balanced as (
  select *,case when status in ('cancelled','returned') then 0 when abs(total-paid-return_applied-stored_balance)>0.01 then greatest(0,total-paid-return_applied) else greatest(0,stored_balance) end server_balance from sale_rows
 )
 select coalesce(jsonb_agg(data||jsonb_build_object('serverBalance',server_balance,'balance',server_balance) order by coalesce(nullif(data->>'date','')::timestamptz,updated_at) desc nulls last),'[]'::jsonb),
  coalesce(sum(server_balance) filter(where status not in ('cancelled','returned')),0),coalesce(sum(total) filter(where status not in ('cancelled','returned')),0),
  count(*) filter(where status not in ('cancelled','returned')),
  coalesce(sum(floor(greatest(0,coalesce(nullif(data->>'loyaltyPointsEarned','')::numeric,0))*case when coalesce(nullif(data->>'loyaltyEligibleTotal','')::numeric,0)>0 then least(1,greatest(0,total/coalesce(nullif(data->>'loyaltyEligibleTotal','')::numeric,0))) else 1 end)
   -floor(greatest(0,coalesce(nullif(data->>'loyaltyPointsRedeemed','')::numeric,0))*case when coalesce(nullif(data->>'loyaltyEligibleTotal','')::numeric,0)>0 then least(1,greatest(0,total/coalesce(nullif(data->>'loyaltyEligibleTotal','')::numeric,0))) else 1 end))
   filter(where status not in ('cancelled','returned')),0)
 into v_sales,v_outstanding,v_lifetime,v_invoice_count,v_points from balanced;
 select coalesce(jsonb_agg(p.data order by coalesce(nullif(p.data->>'date','')::timestamptz,p.updated_at) desc nulls last),'[]'::jsonb) into v_payments
 from public.etihad_records p where p.org_id=p_org_id and p.collection='mberp_payments'
 and (private.normalize_customer_phone(p.data->>'customerPhone')=v_phone or p.data->>'saleId' in
  (select r.record_id from public.etihad_records r where r.org_id=p_org_id and r.collection='mberp_sales' and private.normalize_customer_phone(r.data->>'customerPhone')=v_phone))
 and coalesce(p.data->>'type','')<>'staff_tip';
 select coalesce(jsonb_agg(c.data order by coalesce(nullif(c.data->>'date','')::timestamptz,c.updated_at) desc nulls last),'[]'::jsonb),
  coalesce(sum(greatest(0,coalesce(nullif(c.data->>'balance','')::numeric,0))),0)
 into v_credits,v_advance from public.etihad_records c where c.org_id=p_org_id and c.collection='mberp_customer_account_credits'
 and private.normalize_customer_phone(c.data->>'customerPhone')=v_phone;
 if v_profile is null then
  select jsonb_build_object('id',null,'name',data->>'customerName','phone',data->>'customerPhone','active',true,'source','historical_sales') into v_profile
  from public.etihad_records where org_id=p_org_id and collection='mberp_sales' and private.normalize_customer_phone(data->>'customerPhone')=v_phone and coalesce(data->>'customerName','')<>''
  order by coalesce(nullif(data->>'date','')::timestamptz,updated_at) desc nulls last limit 1;
 end if;
 return jsonb_build_object('found',v_profile is not null,'profile',coalesce(v_profile,'null'::jsonb),'sales',v_sales,'payments',v_payments,'credits',v_credits,
  'loyaltyPoints',greatest(0,v_points),'outstanding',greatest(0,v_outstanding-v_advance),'advance',greatest(0,v_advance-v_outstanding),
  'grossOutstanding',v_outstanding,'grossAdvance',v_advance,'lifetimeSales',v_lifetime,'invoiceCount',v_invoice_count,'phoneNormalized',v_phone);
end; $function$;

revoke all on function public.etihad_customer_lookup(uuid,text) from public,anon;

grant execute on function public.etihad_customer_lookup(uuid,text) to authenticated;