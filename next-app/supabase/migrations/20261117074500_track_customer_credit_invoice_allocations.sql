CREATE OR REPLACE FUNCTION private.etihad_create_sale_legacy(p_org_id uuid, p_branch_id text, p_sale jsonb, p_cash_applied numeric, p_advance_used numeric, p_customer_advance numeric, p_staff_tip numeric, p_method text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_branch_ids text[];
  v_item jsonb;
  v_product record;
  v_qty numeric;
  v_current numeric;
  v_credit record;
  v_remaining numeric;
  v_used numeric;
  v_payment_id text;
  v_allocation_id text;
  v_customer_phone text;
  v_customer_name text;
  v_sale_id text;
  v_invoice text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_org_id is null or coalesce(p_branch_id, '') = '' then raise exception 'Business and branch are required'; end if;
  if p_sale is null or jsonb_typeof(p_sale->'items') <> 'array' or jsonb_array_length(p_sale->'items') = 0 then
    raise exception 'A sale must contain at least one product';
  end if;
  if coalesce(p_cash_applied,0) < 0 or coalesce(p_advance_used,0) < 0
     or coalesce(p_customer_advance,0) < 0 or coalesce(p_staff_tip,0) < 0 then
    raise exception 'Payment amounts cannot be negative';
  end if;

  select m.role, coalesce(m.branch_ids, array[]::text[])
    into v_role, v_branch_ids
    from public.etihad_memberships m
   where m.org_id = p_org_id and m.user_id = v_user and m.active = true
   limit 1;
  if not found then raise exception 'Active business membership required'; end if;
  if v_role not in ('owner','manager','cashier') then
    raise exception 'Your role is not allowed to create sales';
  end if;
  if v_role <> 'owner' and not (p_branch_id = any(v_branch_ids)) then
    raise exception 'You do not have access to this branch';
  end if;
  if coalesce(p_sale->>'branchId','') <> p_branch_id then
    raise exception 'Sale branch does not match the selected branch';
  end if;

  v_sale_id := coalesce(nullif(p_sale->>'id',''), pg_catalog.gen_random_uuid()::text);
  v_invoice := coalesce(p_sale->>'invoiceNo','');
  v_customer_phone := coalesce(p_sale->>'customerPhone','');
  v_customer_name := coalesce(p_sale->>'customerName','Walk-in Customer');

  for v_item in select value from pg_catalog.jsonb_array_elements(p_sale->'items')
  loop
    if coalesce(v_item->>'productId','') = '' then raise exception 'A sale item is missing its product ID'; end if;
    v_qty := coalesce(nullif(v_item->>'qty','')::numeric,0);
    if v_qty <= 0 then raise exception 'Product quantity must be greater than zero'; end if;

    select r.record_id, r.data, r.branch_ids
      into v_product
      from public.etihad_records r
     where r.org_id = p_org_id
       and r.collection = 'mberp_products'
       and r.record_id = v_item->>'productId'
     for update;
    if not found then raise exception 'A selected product no longer exists'; end if;
    if coalesce(v_product.data->>'branchId','') <> p_branch_id
       or not (p_branch_id = any(v_product.branch_ids)) then
      raise exception 'Product % is not stocked at the selected branch. Transfer or receive stock first.', coalesce(v_item->>'name','');
    end if;
    v_current := coalesce(nullif(v_product.data->>'qty','')::numeric,0);
    if v_current < v_qty then
      raise exception 'Insufficient stock for %. Available: %, requested: %', coalesce(v_item->>'name','product'), v_current, v_qty;
    end if;

    update public.etihad_records
       set data = pg_catalog.jsonb_set(data, '{qty}', pg_catalog.to_jsonb(v_current - v_qty), true),
           updated_by = v_user,
           updated_at = pg_catalog.now()
     where org_id = p_org_id and collection = 'mberp_products' and record_id = v_product.record_id;
  end loop;

  if exists (
    select 1 from public.etihad_records
     where org_id = p_org_id and collection = 'mberp_sales' and record_id = v_sale_id
  ) then raise exception 'This sale has already been submitted'; end if;

  insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
  values (p_org_id,'mberp_sales',v_sale_id,array[p_branch_id],p_sale || pg_catalog.jsonb_build_object('id',v_sale_id),v_user);

  if coalesce(p_cash_applied,0) > 0 then
    v_payment_id := pg_catalog.gen_random_uuid()::text;
    insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
    values (p_org_id,'mberp_payments',v_payment_id,array[p_branch_id],
      pg_catalog.jsonb_build_object(
        'id',v_payment_id,'date',coalesce(p_sale->>'date',pg_catalog.now()::text),
        'amount',p_cash_applied,'method',coalesce(p_method,'Cash'),'type','sale_payment',
        'saleId',v_sale_id,'invoiceNo',v_invoice,'receiptNo','REC-'||v_invoice,
        'branchId',p_branch_id,'branchName',coalesce(p_sale->>'branchName',''),
        'customerName',v_customer_name,'customerPhone',v_customer_phone,
        'note','Payment received at point of sale'
      ),v_user);
  end if;

  if coalesce(p_advance_used,0) > 0 then
    if v_customer_phone = '' or v_customer_name = 'Walk-in Customer' then
      raise exception 'A saved customer is required to use an account advance';
    end if;
    v_remaining := p_advance_used;
    for v_credit in
      select r.record_id,r.data
        from public.etihad_records r
       where r.org_id = p_org_id
         and r.collection = 'mberp_customer_account_credits'
         and r.data->>'customerPhone' = v_customer_phone
         and coalesce((r.data->>'balance')::numeric,0) > 0
       order by r.updated_at,r.record_id
       for update
    loop
      exit when v_remaining <= 0;
      v_current := coalesce((v_credit.data->>'balance')::numeric,0);
      v_used := least(v_current,v_remaining);
      update public.etihad_records
         set data = v_credit.data || pg_catalog.jsonb_build_object(
           'balance',v_current-v_used,'lastAppliedAt',coalesce(p_sale->>'date',pg_catalog.now()::text),
           'lastAppliedSaleId',v_sale_id
         ), updated_by = v_user, updated_at = pg_catalog.now()
       where org_id = p_org_id and collection = 'mberp_customer_account_credits' and record_id = v_credit.record_id;
      v_allocation_id := pg_catalog.gen_random_uuid()::text;
      insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
      values(p_org_id,'mberp_customer_credit_allocations',v_allocation_id,array[]::text[],
        pg_catalog.jsonb_build_object(
          'id',v_allocation_id,'type','advance_applied','date',coalesce(p_sale->>'date',pg_catalog.now()::text),
          'saleId',v_sale_id,'sourceCreditId',v_credit.record_id,'amount',v_used,
          'customerName',v_customer_name,'customerPhone',v_customer_phone,
          'branchId',p_branch_id,'invoiceNo',v_invoice,'status','active',
          'note','Exact source customer-credit allocation captured at checkout.'
        ),v_user);
      v_remaining := v_remaining-v_used;
    end loop;
    if v_remaining > 0 then raise exception 'Customer account advance is insufficient'; end if;

    v_payment_id := pg_catalog.gen_random_uuid()::text;
    insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
    values (p_org_id,'mberp_payments',v_payment_id,array[p_branch_id],
      pg_catalog.jsonb_build_object(
        'id',v_payment_id,'date',coalesce(p_sale->>'date',pg_catalog.now()::text),
        'amount',p_advance_used,'method','Customer advance','type','advance_applied',
        'saleId',v_sale_id,'invoiceNo',v_invoice,'receiptNo','ADV-USE-'||v_invoice,
        'branchId',p_branch_id,'branchName',coalesce(p_sale->>'branchName',''),
        'customerName',v_customer_name,'customerPhone',v_customer_phone,
        'note','Saved customer advance applied to this bill.'
      ),v_user);
  end if;

  if coalesce(p_customer_advance,0) > 0 then
    if v_customer_phone = '' or v_customer_name = 'Walk-in Customer' then
      raise exception 'A named customer with a phone number is required to save an account advance';
    end if;
    v_payment_id := pg_catalog.gen_random_uuid()::text;
    insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
    values (p_org_id,'mberp_customer_account_credits',v_payment_id,array[]::text[],
      pg_catalog.jsonb_build_object(
        'id',v_payment_id,'key','phone:'||v_customer_phone,'customerName',v_customer_name,
        'customerPhone',v_customer_phone,'amount',p_customer_advance,'balance',p_customer_advance,
        'date',coalesce(p_sale->>'date',pg_catalog.now()::text),'type','overpayment_advance',
        'sourceSaleId',v_sale_id,'invoiceNo',v_invoice,'branchId',p_branch_id,
        'branchName',coalesce(p_sale->>'branchName',''),
        'note','Extra amount received and retained as customer account advance.'
      ),v_user);
  end if;

  if coalesce(p_staff_tip,0) > 0 then
    v_payment_id := pg_catalog.gen_random_uuid()::text;
    insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
    values (p_org_id,'mberp_payments',v_payment_id,array[p_branch_id],
      pg_catalog.jsonb_build_object(
        'id',v_payment_id,'date',coalesce(p_sale->>'date',pg_catalog.now()::text),
        'amount',p_staff_tip,'method',coalesce(p_method,'Cash'),'type','staff_tip',
        'saleId',v_sale_id,'invoiceNo',v_invoice,'receiptNo','TIP-'||v_invoice,
        'branchId',p_branch_id,'branchName',coalesce(p_sale->>'branchName',''),
        'customerName',v_customer_name,'customerPhone',v_customer_phone,
        'note','Staff tip; excluded from sales revenue.'
      ),v_user);
  end if;

  return pg_catalog.jsonb_build_object('success',true,'saleId',v_sale_id,'invoiceNo',v_invoice,'stockItemsDeducted',pg_catalog.jsonb_array_length(p_sale->'items'));
end;
$function$
;
CREATE OR REPLACE FUNCTION private.etihad_create_sale(p_org_id uuid, p_branch_id text, p_sale jsonb, p_cash_applied numeric, p_advance_used numeric, p_customer_advance numeric, p_staff_tip numeric, p_method text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_result jsonb; v_user uuid:=auth.uid(); v_role text; v_branches text[];
 v_phone text:=coalesce(p_sale->>'customerPhone','');
 v_remaining numeric:=coalesce(nullif(p_sale->>'priorOutstandingApplied','')::numeric,0);
 v_due record; v_due_balance numeric; v_due_paid numeric; v_apply numeric; v_payment_id text; v_allocation_id text;
 v_date text:=coalesce(p_sale->>'date',pg_catalog.now()::text);
 v_item jsonb; v_product_id text; v_need numeric; v_batch_count integer; v_available numeric;
 v_batch record; v_take numeric; v_batch_data jsonb; v_movement_id text;
begin
 if v_remaining < 0 then raise exception 'Previous outstanding settlement cannot be negative'; end if;
 select role,coalesce(branch_ids,array[]::text[]) into v_role,v_branches
 from public.etihad_memberships where org_id=p_org_id and user_id=v_user and active=true limit 1;
 if not found then raise exception 'Active business membership required'; end if;
 if v_remaining > 0 and (v_phone='' or coalesce(p_sale->>'customerName','Walk-in Customer')='Walk-in Customer') then
   raise exception 'Select a named customer before settling previous outstanding';
 end if;

 -- The legacy sale function remains responsible for invoice, payment and stock atomicity.
 v_result:=private.etihad_create_sale_legacy(
   p_org_id,p_branch_id,p_sale,p_cash_applied,p_advance_used,p_customer_advance,p_staff_tip,p_method
 );

 -- When a product has batch tracking enabled, enforce unexpired lot availability
 -- and deduct lots FEFO (earliest expiry first) in this same transaction.
 for v_item in select value from pg_catalog.jsonb_array_elements(p_sale->'items') loop
   v_product_id:=coalesce(v_item->>'productId','');
   v_need:=coalesce(nullif(v_item->>'qty','')::numeric,0);
   if v_product_id='' or v_need<=0 then continue; end if;
   select count(*) into v_batch_count
   from public.etihad_records r
   where r.org_id=p_org_id and r.collection='mberp_stock_batches'
     and coalesce(r.data->>'productId','')=v_product_id
     and coalesce(r.data->>'branchId',r.branch_ids[1])=p_branch_id
     and coalesce(r.data->>'status','active')<>'cancelled';
   if v_batch_count=0 then continue; end if;
   select coalesce(sum(coalesce(nullif(r.data->>'remainingQty','')::numeric,0)),0) into v_available
   from public.etihad_records r
   where r.org_id=p_org_id and r.collection='mberp_stock_batches'
     and coalesce(r.data->>'productId','')=v_product_id
     and coalesce(r.data->>'branchId',r.branch_ids[1])=p_branch_id
     and coalesce(r.data->>'status','active')='active'
     and coalesce(r.data->>'expiryDate','9999-12-31')::date>=current_date
     and coalesce(nullif(r.data->>'remainingQty','')::numeric,0)>0;
   if v_available+0.000001<v_need then
     raise exception 'Insufficient unexpired batch stock for product %. Required %, available %.',v_product_id,v_need,v_available;
   end if;
   for v_batch in
     select r.record_id,r.data from public.etihad_records r
     where r.org_id=p_org_id and r.collection='mberp_stock_batches'
       and coalesce(r.data->>'productId','')=v_product_id
       and coalesce(r.data->>'branchId',r.branch_ids[1])=p_branch_id
       and coalesce(r.data->>'status','active')='active'
       and coalesce(r.data->>'expiryDate','9999-12-31')::date>=current_date
       and coalesce(nullif(r.data->>'remainingQty','')::numeric,0)>0
     order by coalesce(r.data->>'expiryDate','9999-12-31'),coalesce(r.data->>'receivedDate','0001-01-01'),r.record_id
     for update
   loop
     exit when v_need<=0;
     v_take:=least(v_need,coalesce(nullif(v_batch.data->>'remainingQty','')::numeric,0));
     v_batch_data:=v_batch.data||pg_catalog.jsonb_build_object(
       'remainingQty',coalesce(nullif(v_batch.data->>'remainingQty','')::numeric,0)-v_take,
       'lastSaleAt',v_date,
       'status',case when coalesce(nullif(v_batch.data->>'remainingQty','')::numeric,0)-v_take<=0 then 'depleted' else 'active' end
     );
     update public.etihad_records set data=v_batch_data,updated_by=v_user,updated_at=pg_catalog.now()
     where org_id=p_org_id and collection='mberp_stock_batches' and record_id=v_batch.record_id;
     v_movement_id:=pg_catalog.gen_random_uuid()::text;
     insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
     values(p_org_id,'mberp_stock_batch_movements',v_movement_id,array[p_branch_id],
       pg_catalog.jsonb_build_object(
         'id',v_movement_id,'type','sale_deduction','date',v_date,
         'saleId',coalesce(v_result->>'saleId',p_sale->>'id'),
         'invoiceNo',coalesce(v_result->>'invoiceNo',p_sale->>'invoiceNo'),
         'productId',v_product_id,'productName',v_item->>'name',
         'batchId',v_batch.record_id,'batchNo',v_batch.data->>'batchNo',
         'branchId',p_branch_id,'branchName',v_batch.data->>'branchName',
         'qty',-v_take,'remainingQtyAfter',v_batch_data->>'remainingQty',
         'note','FEFO sale allocation'),v_user);
     v_need:=v_need-v_take;
   end loop;
 end loop;

 -- Allocate separately identified excess tender to earlier invoices, oldest first.
 for v_due in
   select r.record_id,r.data,r.branch_ids from public.etihad_records r
   where r.org_id=p_org_id and r.collection='mberp_sales'
     and r.record_id<>coalesce(p_sale->>'id','')
     and coalesce(r.data->>'customerPhone','')=v_phone
     and coalesce(nullif(r.data->>'balance','')::numeric,0)>0
     and (v_role='owner' or coalesce(r.data->>'branchId',r.branch_ids[1])=any(v_branches))
   order by coalesce(r.data->>'date',''),r.record_id for update
 loop
   exit when v_remaining<=0;
   v_due_balance:=coalesce(nullif(v_due.data->>'balance','')::numeric,0);
   v_due_paid:=coalesce(nullif(v_due.data->>'paid','')::numeric,0);
   v_apply:=least(v_due_balance,v_remaining);
   update public.etihad_records set data=v_due.data||pg_catalog.jsonb_build_object(
     'balance',v_due_balance-v_apply,'paid',v_due_paid+v_apply,'lastPaymentAt',v_date
   ),updated_by=v_user,updated_at=pg_catalog.now()
   where org_id=p_org_id and collection='mberp_sales' and record_id=v_due.record_id;
   v_payment_id:=pg_catalog.gen_random_uuid()::text;
   insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
   values(p_org_id,'mberp_payments',v_payment_id,coalesce(v_due.branch_ids,array[]::text[]),
     pg_catalog.jsonb_build_object('id',v_payment_id,'date',v_date,'amount',v_apply,
       'method',coalesce(p_method,'Cash'),'type','sale_payment','saleId',v_due.record_id,
       'invoiceNo',v_due.data->>'invoiceNo','receiptNo','REC-'||coalesce(v_due.data->>'invoiceNo',v_due.record_id),
       'branchId',v_due.data->>'branchId','branchName',v_due.data->>'branchName',
       'customerName',v_due.data->>'customerName','customerPhone',v_phone,
       'note','Extra POS tender allocated to previous customer outstanding.'),v_user);
   v_allocation_id:=pg_catalog.gen_random_uuid()::text;
   insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
   values(p_org_id,'mberp_customer_credit_allocations',v_allocation_id,array[]::text[],
     pg_catalog.jsonb_build_object(
       'id',v_allocation_id,'type','prior_balance_settlement','date',v_date,
       'saleId',coalesce(v_result->>'saleId',p_sale->>'id'),
       'settledSaleId',v_due.record_id,'paymentId',v_payment_id,
       'amount',v_apply,'method',coalesce(p_method,'Cash'),
       'customerName',v_due.data->>'customerName','customerPhone',v_phone,
       'branchId',v_due.data->>'branchId','invoiceNo',v_due.data->>'invoiceNo',
       'sourceInvoiceNo',coalesce(v_result->>'invoiceNo',p_sale->>'invoiceNo'),
       'status','active','note','Exact previous-invoice settlement allocation captured at checkout.'
     ),v_user);
   v_remaining:=v_remaining-v_apply;
 end loop;
 if v_remaining>0 then raise exception 'Previous outstanding changed during checkout. Refresh the customer account and try again.'; end if;
 return v_result||pg_catalog.jsonb_build_object('previousOutstandingPaid',coalesce(nullif(p_sale->>'priorOutstandingApplied','')::numeric,0));
end;
$function$
;
CREATE OR REPLACE FUNCTION public.etihad_record_access(p_org_id uuid, p_collection text, p_branch_ids text[], p_action text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
 v_role text;v_branches text[];v_branch text;v_permissions jsonb;v_key text;
 v_reports_read boolean:=false;v_has_explicit boolean:=false;
begin
 if auth.uid() is null then return false; end if;
 select m.role,coalesce(m.branch_ids,array[]::text[]),coalesce(m.permissions,'{}'::jsonb)
 into v_role,v_branches,v_permissions from public.etihad_memberships m
 where m.org_id=p_org_id and m.user_id=auth.uid() and m.active=true;
 if not found then return false; end if;
 if v_role='owner' then return true; end if;
 v_has_explicit:=v_permissions<>'{}'::jsonb;
 v_key:=case p_collection
  when 'mberp_branches' then 'branches' when 'mberp_products' then 'products' when 'mberp_product_suppliers' then 'products' when 'mberp_product_taxes' then 'products' when 'mberp_stock_batches' then 'products' when 'mberp_open_orders' then 'orders'
  when 'mberp_purchases' then 'purchases' when 'mberp_sales' then 'sales'
  when 'mberp_payments' then 'payments' when 'mberp_expenses' then 'expenses'
  when 'mberp_transfers' then 'stock' when 'mberp_stock_batch_movements' then 'stock' when 'mberp_suppliers' then 'suppliers'
  when 'mberp_supplier_payments' then 'supplier_payments'
  when 'mberp_supplier_returns' then 'supplier_returns'
  when 'mberp_sales_returns' then 'sales_returns'
  when 'mberp_customer_credit_limits' then 'customer_balances'
  when 'mberp_customer_account_credits' then 'customer_balances' when 'mberp_customer_credit_allocations' then 'customer_balances'
  when 'mberp_orders' then 'orders' when 'mberp_quotations' then 'quotations'
  else null end;
 v_reports_read:=p_action='read'
  and coalesce((v_permissions->>'reports')::boolean,false)
  and p_collection in ('mberp_sales','mberp_products','mberp_purchases','mberp_payments','mberp_expenses','mberp_sales_returns','mberp_suppliers','mberp_supplier_payments','mberp_supplier_returns');
 if v_has_explicit and v_key is not null
  and not coalesce((v_permissions->>v_key)::boolean,false)
  and not v_reports_read
  and not (p_collection='mberp_branches' and p_action='read') then return false; end if;
 if v_has_explicit and v_key is null then return false; end if;

 if p_collection='mberp_branches' then
  if p_action='read' then
   return coalesce(cardinality(p_branch_ids),0)>0
    and exists(select 1 from unnest(p_branch_ids) as b(branch_id) where b.branch_id=any(v_branches));
  end if;
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
  foreach v_branch in array p_branch_ids loop if not(v_branch=any(v_branches)) then return false; end if; end loop;
 else
  if not exists(select 1 from unnest(p_branch_ids) as b(branch_id) where b.branch_id=any(v_branches)) then return false; end if;
 end if;
 if p_action='read' then return true; end if;
 if p_action='delete' then return v_role='manager'; end if;
 if v_role='manager' then return p_action in ('insert','update'); end if;
 if v_role='cashier' then return p_collection in ('mberp_sales','mberp_payments','mberp_sales_returns','mberp_orders','mberp_open_orders','mberp_quotations','mberp_customer_account_credits') and p_action in ('insert','update'); end if;
 if v_role='stockkeeper' then return p_collection in ('mberp_products','mberp_product_suppliers','mberp_product_taxes','mberp_stock_batches','mberp_transfers','mberp_purchases') and p_action in ('insert','update'); end if;
 if v_role='accountant' then return p_collection in ('mberp_payments','mberp_expenses','mberp_purchases','mberp_supplier_payments','mberp_supplier_returns','mberp_sales_returns') and p_action in ('insert','update'); end if;
 return false;
end;
$function$
;
revoke all on function private.etihad_create_sale_legacy(uuid,text,jsonb,numeric,numeric,numeric,numeric,text) from public,anon;
revoke all on function private.etihad_create_sale(uuid,text,jsonb,numeric,numeric,numeric,numeric,text) from public,anon;
revoke all on function public.etihad_record_access(uuid,text,text[],text) from public,anon;
grant execute on function private.etihad_create_sale_legacy(uuid,text,jsonb,numeric,numeric,numeric,numeric,text) to authenticated,service_role;
grant execute on function private.etihad_create_sale(uuid,text,jsonb,numeric,numeric,numeric,numeric,text) to authenticated,service_role;
grant execute on function public.etihad_record_access(uuid,text,text[],text) to authenticated,service_role;
