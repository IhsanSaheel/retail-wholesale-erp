-- Disable legacy public RPC overloads that do not require an idempotency reference.
-- Current application calls the protected 7-argument transfer and 7/9-argument return RPCs.
revoke all on function public.etihad_transfer_stock(uuid,text,text,text,numeric,text) from public, anon, authenticated;
revoke all on function public.etihad_create_sales_return(uuid,text,text,numeric,numeric,text) from public, anon, authenticated;

-- Ensure the protected transfer and return RPCs remain available only to authenticated users.
revoke all on function public.etihad_transfer_stock(uuid,text,text,text,numeric,text,text) from public, anon;
grant execute on function public.etihad_transfer_stock(uuid,text,text,text,numeric,text,text) to authenticated;
revoke all on function public.etihad_create_sales_return(uuid,text,text,numeric,numeric,text,text) from public, anon;
grant execute on function public.etihad_create_sales_return(uuid,text,text,numeric,numeric,text,text) to authenticated;
revoke all on function public.etihad_create_sales_return(uuid,text,text,numeric,numeric,text,text,numeric,numeric) from public, anon;
grant execute on function public.etihad_create_sales_return(uuid,text,text,numeric,numeric,text,text,numeric,numeric) to authenticated;