-- Register the cash-closing email delivery collection and keep its branch scope.
alter table public.etihad_records drop constraint if exists etihad_records_collection_check;
alter table public.etihad_records add constraint etihad_records_collection_check
check (collection = any (array[
'mberp_branches','mberp_products','mberp_sales','mberp_payments','mberp_expenses',
'mberp_transfers','mberp_suppliers','mberp_purchases','mberp_supplier_payments',
'mberp_supplier_returns','mberp_sales_returns','mberp_customer_credit_limits',
'mberp_orders','mberp_open_orders','mberp_quotations','mberp_customer_account_credits',
'mberp_product_suppliers','mberp_product_taxes','mberp_stock_batches',
'mberp_stock_adjustments','mberp_cash_registers','mberp_cash_movements',
'etihad_backup_snapshots','mberp_stock_batch_movements',
'mberp_customer_credit_allocations','mberp_email_delivery'
]::text[]));
