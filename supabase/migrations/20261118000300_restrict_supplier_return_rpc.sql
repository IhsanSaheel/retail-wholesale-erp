-- Supplier returns require an authenticated member and must not be exposed to anonymous API clients.
revoke all on function public.etihad_create_supplier_return(uuid,text,numeric,numeric,text,text) from public, anon;
grant execute on function public.etihad_create_supplier_return(uuid,text,numeric,numeric,text,text) to authenticated;