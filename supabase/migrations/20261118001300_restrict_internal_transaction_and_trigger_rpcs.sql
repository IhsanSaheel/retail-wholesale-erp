-- Restrict direct access to internal transaction and trigger functions.
-- Trigger functions remain attached to their triggers and continue to execute automatically.
revoke all on function private.etihad_create_supplier_return(uuid,text,numeric,numeric,text,text) from public, anon;
grant execute on function private.etihad_create_supplier_return(uuid,text,numeric,numeric,text,text) to authenticated;

revoke all on function private.etihad_transfer_stock_idempotent(uuid,text,text,text,numeric,text,text) from public, anon;
grant execute on function private.etihad_transfer_stock_idempotent(uuid,text,text,text,numeric,text,text) to authenticated;

revoke all on function private.etihad_capture_customer_advance_receipt() from public, anon, authenticated;
revoke all on function private.etihad_capture_customer_advance_usage() from public, anon, authenticated;
revoke all on function private.etihad_track_customer_credit_creation() from public, anon, authenticated;
revoke all on function private.etihad_track_sales_return_batch() from public, anon, authenticated;
revoke all on function private.etihad_track_stock_batch_receipt() from public, anon, authenticated;
