-- Enforce explicit employee module permissions in row-level security.
-- Owner access remains unchanged. Empty permission objects retain role defaults
-- for compatibility with existing memberships created before granular access.

create or replace function public.etihad_record_access(
 p_org_id uuid,p_collection text,p_branch_ids text[],p_action text
) returns boolean
language plpgsql stable security definer set search_path='public','pg_temp'
as $function$
declare
 v_role text;v_branches text[];v_branch text;v_permissions jsonb;v_key text;
 v_reports_read boolean:=false;v_has_explicit boolean:=false;
begin
 if auth.uid() is null then return false; end if;
 select m.role,coalesce(m.branch_ids,array[]::text[]),coalesce(m.permissions,'{}'::jsonb)
 into v_role,v_branches,v_permissions
 from public.etihad_memberships m
 where m.org_id=p_org_id and m.user_id=auth.uid() and m.active=true;
 if not found then return false; end if;
 if v_role='owner' then return true; end if;

 v_has_explicit:=v_permissions<>'{}'::jsonb;
 v_key:=case p_collection
  when 'mberp_branches' then 'branches'
  when 'mberp_products' then 'products'
  when 'mberp_purchases' then 'purchases'
  when 'mberp_sales' then 'sales'
  when 'mberp_payments' then 'payments'
  when 'mberp_expenses' then 'expenses'
  when 'mberp_transfers' then 'stock'
  when 'mberp_suppliers' then 'suppliers'
  when 'mberp_supplier_payments' then 'supplier_payments'
  when 'mberp_supplier_returns' then 'supplier_returns'
  when 'mberp_sales_returns' then 'sales_returns'
  when 'mberp_customer_credit_limits' then 'customer_balances'
  when 'mberp_customer_account_credits' then 'customer_balances'
  when 'mberp_orders' then 'orders'
  when 'mberp_quotations' then 'quotations'
  else null end;

 v_reports_read:=p_action='read'
  and coalesce((v_permissions->>'reports')::boolean,false)
  and p_collection in ('mberp_sales','mberp_products','mberp_purchases','mberp_payments','mberp_expenses','mberp_sales_returns','mberp_suppliers','mberp_supplier_payments','mberp_supplier_returns');
 if v_has_explicit and v_key is not null
  and not coalesce((v_permissions->>v_key)::boolean,false)
  and not v_reports_read then return false; end if;
 if v_has_explicit and v_key is null then return false; end if;

 if p_collection='mberp_branches' then
  if p_action='read' then return true; end if;
  return v_role='manager' and p_action in ('insert','update','delete');
 end if;
 if p_collection in ('mberp_customer_credit_limits','mberp_customer_account_credits') then
  if p_action='read' then return true; end if;
  if p_action='delete' then return v_role='manager'; end if;
  return v_role in ('manager','cashier','accountant') and p_action in ('insert','update');
 end if;
 if p_collection='mberp_suppliers' then
  if p_action='read' then return true; end if;
  if p_action='delete' then return v_role='manager'; end if;
  return v_role in ('manager','accountant') and p_action in ('insert','update');
 end if;

 if coalesce(cardinality(p_branch_ids),0)=0 then return false; end if;
 if p_collection='mberp_supplier_payments' or p_action in ('insert','update') then
  foreach v_branch in array p_branch_ids loop
   if not(v_branch=any(v_branches)) then return false; end if;
  end loop;
 else
  if not exists(select 1 from unnest(p_branch_ids) as b(branch_id) where b.branch_id=any(v_branches)) then return false; end if;
 end if;
 if p_action='read' then return true; end if;
 if p_action='delete' then return v_role='manager'; end if;
 if v_role='manager' then return p_action in ('insert','update'); end if;
 if v_role='cashier' then
  return p_collection in ('mberp_sales','mberp_payments','mberp_sales_returns','mberp_orders','mberp_quotations','mberp_customer_account_credits')
   and p_action in ('insert','update');
 end if;
 if v_role='stockkeeper' then
  return p_collection in ('mberp_products','mberp_transfers','mberp_purchases')
   and p_action in ('insert','update');
 end if;
 if v_role='accountant' then
  return p_collection in ('mberp_payments','mberp_expenses','mberp_purchases','mberp_supplier_payments','mberp_supplier_returns','mberp_sales_returns')
   and p_action in ('insert','update');
 end if;
 return false;
end;
$function$;
revoke all on function public.etihad_record_access(uuid,text,text[],text) from public,anon;
grant execute on function public.etihad_record_access(uuid,text,text[],text) to authenticated;
