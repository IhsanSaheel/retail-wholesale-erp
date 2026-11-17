-- Reconcile only historical customer advances whose source-credit totals
-- exactly equal recorded advance_applied payments for the same sale/customer.
with credit_groups as (
  select org_id,data->>'lastAppliedSaleId' sale_id,data->>'customerPhone' customer_phone,
         count(*) credit_count,sum(coalesce(nullif(data->>'amount','')::numeric,0)) credit_total
  from public.etihad_records
  where collection='mberp_customer_account_credits'
    and nullif(data->>'lastAppliedSaleId','') is not null
  group by org_id,data->>'lastAppliedSaleId',data->>'customerPhone'
),
payment_groups as (
  select org_id,data->>'saleId' sale_id,data->>'customerPhone' customer_phone,
         count(*) payment_count,sum(coalesce(nullif(data->>'amount','')::numeric,0)) payment_total,
         max(data->>'invoiceNo') invoice_no
  from public.etihad_records
  where collection='mberp_payments' and data->>'type'='advance_applied'
  group by org_id,data->>'saleId',data->>'customerPhone'
),
exact_groups as (
  select c.org_id,c.sale_id,c.customer_phone,p.invoice_no
  from credit_groups c join payment_groups p using(org_id,sale_id,customer_phone)
  where c.credit_count>=1 and p.payment_count>=1
    and abs(c.credit_total-p.payment_total)<0.005
    and exists(select 1 from public.etihad_records s
      where s.org_id=c.org_id and s.collection='mberp_sales'
       and s.record_id=c.sale_id and s.data->>'customerPhone'=c.customer_phone)
),
new_rows as (
  select c.org_id,c.record_id source_credit_id,c.data credit_data,
         g.sale_id,g.customer_phone,g.invoice_no,s.data sale_data,
         pg_catalog.gen_random_uuid() allocation_id
  from exact_groups g
  join public.etihad_records c on c.org_id=g.org_id
    and c.collection='mberp_customer_account_credits'
    and c.data->>'lastAppliedSaleId'=g.sale_id
    and c.data->>'customerPhone'=g.customer_phone
  join public.etihad_records s on s.org_id=g.org_id
    and s.collection='mberp_sales' and s.record_id=g.sale_id
  where not exists(select 1 from public.etihad_records a
    where a.org_id=c.org_id and a.collection='mberp_customer_credit_allocations'
     and a.data->>'type'='advance_applied'
     and a.data->>'sourceCreditId'=c.record_id
     and a.data->>'saleId'=g.sale_id
     and coalesce(a.data->>'status','active')='active')
),
inserted as (
  insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
  select org_id,'mberp_customer_credit_allocations',allocation_id,array[]::text[],
    pg_catalog.jsonb_build_object(
      'id',allocation_id,'type','advance_applied',
      'date',coalesce(credit_data->>'lastAppliedAt',sale_data->>'date',pg_catalog.now()::text),
      'saleId',sale_id,'sourceCreditId',source_credit_id,
      'amount',coalesce(nullif(credit_data->>'amount','')::numeric,0),
      'customerName',credit_data->>'customerName','customerPhone',customer_phone,
      'branchId',credit_data->>'branchId','invoiceNo',invoice_no,
      'status','active',
      'note','Historical allocation reconciled from exact source-credit lastAppliedSaleId, customer match, and matching aggregate advance_applied payment total.'
    ),null
  from new_rows returning record_id
)
update public.etihad_records created
set data=created.data||jsonb_build_object(
  'status','historical_usage_reconciled',
  'note','Historical source creation and exact subsequent usage are reconciled in customer credit allocation audit.'
)
where created.collection='mberp_customer_credit_allocations'
 and created.data->>'type'='advance_created'
 and created.data->>'sourceCreditId' in (
   select c.record_id from public.etihad_records c
   join exact_groups g on g.org_id=c.org_id
    and g.sale_id=c.data->>'lastAppliedSaleId'
    and g.customer_phone=c.data->>'customerPhone'
   where c.collection='mberp_customer_account_credits'
 );
