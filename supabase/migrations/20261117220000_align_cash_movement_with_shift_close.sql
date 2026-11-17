create or replace function private.etihad_record_cash_movement(
 p_org_id uuid,
 p_session_id text,
 p_movement_id text,
 p_type text,
 p_amount numeric,
 p_note text
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
 v_user uuid:=auth.uid();
 v_role text;
 v_branches text[];
 v_session record;
 v_old record;
 v_cash_sales numeric:=0;
 v_cash_tips numeric:=0;
 v_cash_refunds numeric:=0;
 v_in numeric:=0;
 v_out numeric:=0;
 v_expected numeric;
 v_data jsonb;
 v_now timestamptz:=pg_catalog.now();
begin
 if v_user is null then raise exception 'Authentication required'; end if;
 if coalesce(p_session_id,'')='' or coalesce(p_movement_id,'')='' or p_amount is null or p_amount<=0 or p_type not in ('cash_in','cash_out') then
  raise exception 'A valid session, movement reference, type and positive amount are required';
 end if;
 select role,coalesce(branch_ids,array[]::text[]) into v_role,v_branches
 from public.etihad_memberships where org_id=p_org_id and user_id=v_user and active=true limit 1;
 if not found or v_role not in ('owner','manager','cashier','accountant') then
  raise exception 'Active authorised business membership required';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org_id::text||':cash-session:'||p_session_id,0));
 select record_id,data,branch_ids into v_session from public.etihad_records
 where org_id=p_org_id and collection='mberp_cash_registers' and record_id=p_session_id for update;
 if not found or v_session.data->>'status'<>'open' then raise exception 'Open cash register session not found'; end if;
 if v_role<>'owner' and not(coalesce(v_session.data->>'branchId',v_session.branch_ids[1])=any(v_branches)) then
  raise exception 'You do not have access to this register branch';
 end if;
 if v_role='cashier' and v_session.data->>'cashierId'<>v_user::text then
  raise exception 'You can only record movements on your own register';
 end if;
 select record_id,data into v_old from public.etihad_records
 where org_id=p_org_id and collection='mberp_cash_movements' and record_id=p_movement_id;
 if found then
  if v_old.data->>'sessionId'=p_session_id and v_old.data->>'recordedBy'=v_user::text
   and v_old.data->>'type'=p_type and coalesce((v_old.data->>'amount')::numeric,0)=p_amount then
   return pg_catalog.jsonb_build_object('success',true,'alreadyRecorded',true,'movementId',p_movement_id);
  end if;
  raise exception 'Movement reference already exists with different details';
 end if;

 select coalesce(sum(coalesce(nullif(p.data->>'amount','')::numeric,0)),0)
 into v_cash_sales
 from public.etihad_records p
 where p.org_id=p_org_id and p.collection='mberp_payments'
  and (p.data->>'type'='sale_payment' or (p.data->>'type' is null and p.data->>'note' like '%Bulk customer payment%'))
  and lower(coalesce(p.data->>'method',''))='cash'
  and coalesce(p.data->>'branchId',p.branch_ids[1])=v_session.data->>'branchId'
  and p.updated_by::text=v_session.data->>'cashierId'
  and coalesce(p.data->>'date','')::timestamptz >= (v_session.data->>'openedAt')::timestamptz
  and coalesce(p.data->>'date','')::timestamptz <= v_now;

 v_cash_sales:=v_cash_sales+coalesce((
  select sum(greatest(0,
   coalesce(nullif(s.data->>'cashReceived','')::numeric,0)-coalesce(nullif(s.data->>'changeReturned','')::numeric,0)))
  from public.etihad_records s
  where s.org_id=p_org_id and s.collection='mberp_sales'
   and coalesce(s.data->>'branchId',s.branch_ids[1])=v_session.data->>'branchId'
   and s.updated_by::text=v_session.data->>'cashierId'
   and lower(coalesce(s.data->>'paymentMethod',''))='cash'
   and coalesce(s.data->>'status','')<>'cancelled'
   and coalesce(s.data->>'date','')::timestamptz >= (v_session.data->>'openedAt')::timestamptz
   and coalesce(s.data->>'date','')::timestamptz <= v_now
   and not exists(
    select 1 from public.etihad_records p2
    where p2.org_id=s.org_id and p2.collection='mberp_payments'
     and p2.data->>'type'='sale_payment' and p2.data->>'saleId'=s.record_id
   )
 ),0);

 select coalesce(sum(coalesce(nullif(t.data->>'amount','')::numeric,0)),0)
 into v_cash_tips
 from public.etihad_records t
 where t.org_id=p_org_id and t.collection='mberp_payments'
  and t.data->>'type'='staff_tip' and lower(coalesce(t.data->>'method',''))='cash'
  and coalesce(t.data->>'branchId',t.branch_ids[1])=v_session.data->>'branchId'
  and t.updated_by::text=v_session.data->>'cashierId'
  and coalesce(t.data->>'date','')::timestamptz >= (v_session.data->>'openedAt')::timestamptz
  and coalesce(t.data->>'date','')::timestamptz <= v_now;

 select coalesce(sum(coalesce(nullif(r.data->>'amount','')::numeric,0)),0)
 into v_cash_refunds
 from public.etihad_records r
 where r.org_id=p_org_id and r.collection='mberp_payments'
  and r.data->>'type'='sales_return_refund'
  and lower(coalesce(r.data->>'method',''))='cash'
  and coalesce(r.data->>'branchId',r.branch_ids[1])=v_session.data->>'branchId'
  and r.updated_by::text=v_session.data->>'cashierId'
  and coalesce(r.data->>'date','')::timestamptz >= (v_session.data->>'openedAt')::timestamptz
  and coalesce(r.data->>'date','')::timestamptz <= v_now;

 select coalesce(sum(case when data->>'type'='cash_in' then (data->>'amount')::numeric else 0 end),0),
        coalesce(sum(case when data->>'type'='cash_out' then (data->>'amount')::numeric else 0 end),0)
 into v_in,v_out
 from public.etihad_records
 where org_id=p_org_id and collection='mberp_cash_movements' and data->>'sessionId'=p_session_id;

 v_expected:=coalesce((v_session.data->>'openingFloat')::numeric,0)
  +v_cash_sales+v_cash_tips-v_cash_refunds+v_in-v_out;
 if p_type='cash_out' and p_amount>v_expected then
  raise exception 'Cash-out exceeds the expected drawer balance';
 end if;

 v_data:=pg_catalog.jsonb_build_object(
  'id',p_movement_id,'sessionId',p_session_id,
  'branchId',v_session.data->>'branchId','branchName',v_session.data->>'branchName',
  'type',p_type,'amount',p_amount,'note',coalesce(p_note,''),'date',v_now,'recordedBy',v_user::text
 );
 insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
 values(p_org_id,'mberp_cash_movements',p_movement_id,array[v_session.data->>'branchId'],v_data,v_user);
 return pg_catalog.jsonb_build_object('success',true,'movementId',p_movement_id,'expectedCash',v_expected);
end;
$function$;