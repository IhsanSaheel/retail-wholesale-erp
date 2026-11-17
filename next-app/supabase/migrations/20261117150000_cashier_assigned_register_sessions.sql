-- Allow an authorised owner or manager to open a cashier's shift.
-- Cashiers remain restricted to opening their own register and their assigned branches.
create or replace function private.etihad_open_cash_register(
 p_org_id uuid,
 p_branch_id text,
 p_opening_float numeric,
 p_session_id text,
 p_cashier_name text default '',
 p_cashier_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
 v_user uuid := auth.uid();
 v_cashier uuid := coalesce(p_cashier_id, auth.uid());
 v_role text;
 v_branches text[];
 v_target_role text;
 v_target_branches text[];
 v_existing record;
 v_branch record;
 v_profile_name text;
 v_data jsonb;
 v_now timestamptz := pg_catalog.now();
begin
 if v_user is null then raise exception 'Authentication required'; end if;
 if coalesce(p_branch_id,'')='' or coalesce(p_session_id,'')='' or coalesce(p_opening_float,-1)<0 then
  raise exception 'A branch, session reference and non-negative opening float are required';
 end if;
 select role, coalesce(branch_ids,array[]::text[]) into v_role,v_branches
 from public.etihad_memberships
 where org_id=p_org_id and user_id=v_user and active=true limit 1;
 if not found or v_role not in ('owner','manager','cashier','accountant') then
  raise exception 'Active authorised business membership required';
 end if;
 if v_role<>'owner' and not(p_branch_id=any(v_branches)) then
  raise exception 'You do not have access to this branch';
 end if;
 select role,coalesce(branch_ids,array[]::text[]) into v_target_role,v_target_branches
 from public.etihad_memberships
 where org_id=p_org_id and user_id=v_cashier and active=true limit 1;
 if not found then raise exception 'Selected cashier is not an active business employee'; end if;
 if v_cashier<>v_user then
  if v_role not in ('owner','manager') then
   raise exception 'Only an owner or manager can open a register for another cashier';
  end if;
  if v_target_role<>'cashier' then raise exception 'Select an employee with the cashier role'; end if;
  if not(p_branch_id=any(v_target_branches)) then
   raise exception 'Selected cashier is not assigned to this branch';
  end if;
 end if;
 perform pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(p_org_id::text||':cash-register:'||p_branch_id||':'||v_cashier::text,0)
 );
 select record_id,data into v_existing
 from public.etihad_records
 where org_id=p_org_id and collection='mberp_cash_registers'
  and data->>'branchId'=p_branch_id and data->>'cashierId'=v_cashier::text
  and data->>'status'='open'
 for update;
 if found then raise exception 'An open register already exists for this cashier and branch'; end if;
 select record_id,data into v_branch
 from public.etihad_records
 where org_id=p_org_id and collection='mberp_branches' and record_id=p_branch_id;
 if not found or coalesce(v_branch.data->>'active','true')='false' then
  raise exception 'The selected branch is unavailable';
 end if;
 select full_name into v_profile_name
 from public.etihad_employee_profiles
 where org_id=p_org_id and user_id=v_cashier;
 v_data:=pg_catalog.jsonb_build_object(
  'id',p_session_id,'branchId',p_branch_id,
  'branchName',coalesce(v_branch.data->>'name',''),
  'cashierId',v_cashier::text,
  'cashierName',coalesce(nullif(v_profile_name,''),nullif(p_cashier_name,''),v_cashier::text),
  'openedBy',v_user::text,'openedAt',v_now,
  'openingFloat',p_opening_float,'status','open'
 );
 insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
 values(p_org_id,'mberp_cash_registers',p_session_id,array[p_branch_id],v_data,v_user);
 return pg_catalog.jsonb_build_object('success',true,'session',v_data);
end;
$function$;

create or replace function public.etihad_open_cash_register(
 p_org_id uuid,
 p_branch_id text,
 p_opening_float numeric,
 p_session_id text,
 p_cashier_name text default '',
 p_cashier_id uuid default null
)
returns jsonb
language sql
set search_path = ''
as $function$
 select private.etihad_open_cash_register(
  p_org_id,p_branch_id,p_opening_float,p_session_id,p_cashier_name,p_cashier_id
 );
$function$;

revoke all on function private.etihad_open_cash_register(uuid,text,numeric,text,text,uuid) from public, anon;
grant execute on function private.etihad_open_cash_register(uuid,text,numeric,text,text,uuid) to authenticated;
revoke all on function public.etihad_open_cash_register(uuid,text,numeric,text,text,uuid) from public, anon;
grant execute on function public.etihad_open_cash_register(uuid,text,numeric,text,text,uuid) to authenticated;
