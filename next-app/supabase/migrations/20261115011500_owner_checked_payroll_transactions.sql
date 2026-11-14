-- Owner-checked payroll creation and settlement for Etihad Traders.
-- Both public RPC wrappers are SECURITY INVOKER. Privileged work is isolated
-- in private-schema SECURITY DEFINER routines with an explicit owner check.

create or replace function private.etihad_create_payroll(
 p_org_id uuid,p_employee_user_id uuid,p_period_month date,p_allowances numeric,p_deductions numeric
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_profile record;v_id uuid;v_base numeric;v_net numeric;
begin
 if auth.uid() is null or not public.etihad_is_owner(p_org_id) then raise exception 'Owner access required';end if;
 if coalesce(p_allowances,0)<0 or coalesce(p_deductions,0)<0 then raise exception 'Allowances and deductions cannot be negative';end if;
 select * into v_profile from public.etihad_employee_profiles where org_id=p_org_id and user_id=p_employee_user_id;
 if not found then raise exception 'Employee profile not found';end if;
 v_base:=v_profile.base_salary;v_net:=greatest(0,v_base+coalesce(p_allowances,0)-coalesce(p_deductions,0));
 insert into public.etihad_payroll(org_id,employee_user_id,employee_code,employee_name,period_month,base_salary,allowances,deductions,net_salary,payment_status,created_by)
 values(p_org_id,p_employee_user_id,v_profile.employee_code,v_profile.full_name,p_period_month,v_base,coalesce(p_allowances,0),coalesce(p_deductions,0),v_net,'unpaid',auth.uid())
 returning id into v_id;
 return pg_catalog.jsonb_build_object('success',true,'payroll_id',v_id,'net_salary',v_net);
end;$$;
revoke all on function private.etihad_create_payroll(uuid,uuid,date,numeric,numeric) from public,anon;
grant execute on function private.etihad_create_payroll(uuid,uuid,date,numeric,numeric) to authenticated;
create or replace function public.etihad_create_payroll(
 p_org_id uuid,p_employee_user_id uuid,p_period_month date,p_allowances numeric,p_deductions numeric
) returns jsonb language sql security invoker set search_path=''
as $$ select private.etihad_create_payroll(p_org_id,p_employee_user_id,p_period_month,p_allowances,p_deductions);$$;
revoke all on function public.etihad_create_payroll(uuid,uuid,date,numeric,numeric) from public,anon;
grant execute on function public.etihad_create_payroll(uuid,uuid,date,numeric,numeric) to authenticated;

create or replace function private.etihad_mark_payroll_paid(
 p_org_id uuid,p_payroll_id uuid,p_payment_method text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_row record;
begin
 if auth.uid() is null or not public.etihad_is_owner(p_org_id) then raise exception 'Owner access required';end if;
 select * into v_row from public.etihad_payroll where org_id=p_org_id and id=p_payroll_id for update;
 if not found then raise exception 'Payslip not found';end if;
 if v_row.payment_status='paid' then raise exception 'Payslip is already marked paid';end if;
 update public.etihad_payroll set payment_status='paid',payment_date=current_date,payment_method=coalesce(nullif(p_payment_method,''),'Cash')
 where id=p_payroll_id and org_id=p_org_id;
 return pg_catalog.jsonb_build_object('success',true,'payroll_id',p_payroll_id,'payment_status','paid');
end;$$;
revoke all on function private.etihad_mark_payroll_paid(uuid,uuid,text) from public,anon;
grant execute on function private.etihad_mark_payroll_paid(uuid,uuid,text) to authenticated;
create or replace function public.etihad_mark_payroll_paid(
 p_org_id uuid,p_payroll_id uuid,p_payment_method text
) returns jsonb language sql security invoker set search_path=''
as $$ select private.etihad_mark_payroll_paid(p_org_id,p_payroll_id,p_payment_method);$$;
revoke all on function public.etihad_mark_payroll_paid(uuid,uuid,text) from public,anon;
grant execute on function public.etihad_mark_payroll_paid(uuid,uuid,text) to authenticated;
