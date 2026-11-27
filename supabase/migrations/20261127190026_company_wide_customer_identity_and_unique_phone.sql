CREATE OR REPLACE FUNCTION private.normalize_customer_phone(p_phone text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$ declare v_digits text; begin
 v_digits:=pg_catalog.regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
 if v_digits like '00%' then v_digits:=pg_catalog.substr(v_digits,3); end if;
 if v_digits like '0%' and pg_catalog.length(v_digits) between 10 and 11 then v_digits:='92'||pg_catalog.substr(v_digits,2); end if;
 return v_digits;
end; $function$;

revoke all on function private.normalize_customer_phone(text) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.etihad_record_access(p_org_id uuid, p_collection text, p_branch_ids text[], p_action text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_role text; v_branches text[]; v_branch text; v_permissions jsonb; v_key text; v_reports_read boolean := false; v_has_explicit boolean := false;
begin
  if auth.uid() is null then return false; end if;
  select m.role, coalesce(m.branch_ids, array[]::text[]), coalesce(m.permissions, '{}'::jsonb)
    into v_role, v_branches, v_permissions
  from public.etihad_memberships m
  where m.org_id = p_org_id and m.user_id = auth.uid() and m.active = true;
  if not found then return false; end if;
  if v_role = 'owner' then return true; end if;
  v_has_explicit := v_permissions <> '{}'::jsonb;
  v_key := case p_collection
    when 'mberp_branches' then 'branches'
    when 'mberp_products' then 'products'
    when 'mberp_product_suppliers' then 'products'
    when 'mberp_product_taxes' then 'products'
    when 'mberp_stock_batches' then 'products'
    when 'mberp_open_orders' then 'orders'
    when 'mberp_purchases' then 'purchases'
    when 'mberp_sales' then 'sales'
    when 'mberp_payments' then 'payments'
    when 'mberp_expenses' then 'expenses'
    when 'mberp_transfers' then 'stock'
    when 'mberp_stock_batch_movements' then 'stock'
    when 'mberp_suppliers' then 'suppliers'
    when 'mberp_supplier_payments' then 'supplier_payments'
    when 'mberp_supplier_returns' then 'supplier_returns'
    when 'mberp_sales_returns' then 'sales_returns'
    when 'mberp_customer_credit_limits' then 'customer_balances'
    when 'mberp_customer_account_credits' then 'customer_balances'
    when 'mberp_customer_credit_allocations' then 'customer_balances'
    when 'mberp_customers' then 'sales'
    when 'mberp_orders' then 'orders'
    when 'mberp_quotations' then 'quotations'
    else null end;
  v_reports_read := p_action = 'read' and coalesce((v_permissions->>'reports')::boolean, false)
    and p_collection in ('mberp_sales','mberp_products','mberp_purchases','mberp_payments','mberp_expenses','mberp_sales_returns','mberp_suppliers','mberp_supplier_payments','mberp_supplier_returns');
  if v_has_explicit and v_key is not null and not coalesce((v_permissions->>v_key)::boolean, false)
    and not v_reports_read and not (p_collection = 'mberp_branches' and p_action = 'read') then return false; end if;
  if v_has_explicit and v_key is null then return false; end if;
  if p_collection = 'mberp_customers' then
    if p_action = 'read' then return v_role in ('manager','accountant','cashier'); end if;
    if p_action in ('insert','update') then return v_role in ('manager','accountant'); end if;
    return false;
  end if;
  if p_collection = 'mberp_branches' then
    if p_action = 'read' then return coalesce(cardinality(p_branch_ids), 0) > 0 and exists (select 1 from unnest(p_branch_ids) as b(branch_id) where b.branch_id = any(v_branches)); end if;
    return false;
  end if;
  if p_collection in ('mberp_customer_credit_limits','mberp_customer_account_credits') then
    if p_action = 'read' then return true; end if;
    if p_action = 'delete' then return v_role = 'manager' and p_collection = 'mberp_customer_credit_limits'; end if;
    return v_role in ('manager','cashier','accountant') and p_action in ('insert','update');
  end if;
  if p_collection = 'mberp_suppliers' then
    if p_action = 'read' then return true; end if;
    if p_action = 'delete' then return v_role = 'manager'; end if;
    return v_role in ('manager','accountant') and p_action in ('insert','update');
  end if;
  if coalesce(cardinality(p_branch_ids), 0) = 0 then return false; end if;
  if p_collection = 'mberp_supplier_payments' or p_action in ('insert','update') then
    foreach v_branch in array p_branch_ids loop if not (v_branch = any(v_branches)) then return false; end if; end loop;
  else
    if not exists (select 1 from unnest(p_branch_ids) as b(branch_id) where b.branch_id = any(v_branches)) then return false; end if;
  end if;
  if p_action = 'read' then return true; end if;
  if p_action = 'delete' then return v_role = 'manager' and p_collection in ('mberp_products','mberp_product_suppliers','mberp_product_taxes','mberp_open_orders','mberp_orders','mberp_quotations'); end if;
  if v_role = 'manager' then return p_action in ('insert','update'); end if;
  if v_role = 'cashier' then return p_collection in ('mberp_sales','mberp_payments','mberp_sales_returns','mberp_orders','mberp_open_orders','mberp_quotations','mberp_customer_account_credits') and p_action in ('insert','update'); end if;
  if v_role = 'stockkeeper' then return p_collection in ('mberp_products','mberp_product_suppliers','mberp_product_taxes','mberp_stock_batches','mberp_transfers','mberp_purchases') and p_action in ('insert','update'); end if;
  if v_role = 'accountant' then return p_collection in ('mberp_payments','mberp_expenses','mberp_purchases','mberp_supplier_payments','mberp_supplier_returns','mberp_sales_returns') and p_action in ('insert','update'); end if;
  return false;
end;
$function$;

CREATE OR REPLACE FUNCTION private.enforce_company_customer_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ declare v_phone text; begin
 if new.collection<>'mberp_customers' then return new; end if;
 v_phone:=private.normalize_customer_phone(new.data->>'phone');
 if pg_catalog.length(v_phone)<7 or pg_catalog.length(v_phone)>15 then raise exception 'A valid customer phone number is required'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.org_id::text||':customer-phone:'||v_phone,0));
 if exists(select 1 from public.etihad_records r where r.org_id=new.org_id and r.collection='mberp_customers' and r.record_id<>new.record_id and private.normalize_customer_phone(r.data->>'phone')=v_phone) then
  raise exception 'This phone number already belongs to an existing customer'; end if;
 new.branch_ids:=array[]::text[];
 new.data:=coalesce(new.data,'{}'::jsonb)||pg_catalog.jsonb_build_object('id',coalesce(nullif(new.data->>'id',''),new.record_id),'phoneNormalized',v_phone);
 return new;
end; $function$;

revoke all on function private.enforce_company_customer_identity() from public,anon,authenticated;

drop trigger if exists etihad_enforce_company_customer_identity on public.etihad_records;

create trigger etihad_enforce_company_customer_identity before insert or update of data,collection,org_id,branch_ids on public.etihad_records for each row execute function private.enforce_company_customer_identity();

-- Normalize existing profiles and make sure they are not branch-scoped.
update public.etihad_records set data=data where collection='mberp_customers';

with latest as (
 select distinct on (private.normalize_customer_phone(data->>'customerPhone'))
 org_id,private.normalize_customer_phone(data->>'customerPhone') normalized_phone,btrim(data->>'customerPhone') phone,btrim(data->>'customerName') customer_name,
 coalesce(nullif(data->>'date','')::timestamptz,updated_at,pg_catalog.now()) created_at
 from public.etihad_records where collection='mberp_sales' and coalesce(data->>'customerPhone','')<>'' and coalesce(data->>'customerName','')<>''
 and lower(btrim(coalesce(data->>'customerName',''))) not in ('walk-in customer','walk in customer') and coalesce(data->>'recycleBinId','')=''
 order by private.normalize_customer_phone(data->>'customerPhone'),coalesce(nullif(data->>'date','')::timestamptz,updated_at) desc nulls last,record_id desc
)
insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by,updated_at)
select l.org_id,'mberp_customers','legacy-'||pg_catalog.substr(pg_catalog.md5(l.org_id::text||':'||l.normalized_phone),1,20),array[]::text[],
 pg_catalog.jsonb_build_object('id','legacy-'||pg_catalog.substr(pg_catalog.md5(l.org_id::text||':'||l.normalized_phone),1,20),'name',l.customer_name,'phone',l.phone,
 'address','','email','','photoUrl','','notes','Imported from existing sales history; original invoices remain unchanged.','active',true,'createdAt',l.created_at,'updatedAt',pg_catalog.now(),'source','historical_sales_backfill'),
 null,pg_catalog.now() from latest l where not exists(select 1 from public.etihad_records c where c.org_id=l.org_id and c.collection='mberp_customers' and private.normalize_customer_phone(c.data->>'phone')=l.normalized_phone)
on conflict(org_id,collection,record_id) do nothing;

create unique index if not exists etihad_customers_org_normalized_phone_uidx on public.etihad_records(org_id,private.normalize_customer_phone(data->>'phone')) where collection='mberp_customers' and private.normalize_customer_phone(data->>'phone')<>'';