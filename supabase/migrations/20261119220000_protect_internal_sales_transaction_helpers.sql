ALTER FUNCTION public.etihad_edit_sale(uuid,text,jsonb,numeric,numeric,text,text,numeric,text,numeric,numeric,text) SECURITY DEFINER;
ALTER FUNCTION public.etihad_edit_sale(uuid,text,jsonb,numeric,numeric,text,text,numeric,text,numeric,numeric,text) SET search_path TO '';
REVOKE EXECUTE ON FUNCTION private.etihad_edit_sale(uuid,text,jsonb,numeric,numeric,text,text,numeric,text,numeric,numeric,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.etihad_edit_sale(uuid,text,jsonb,numeric,numeric,text,text,numeric,text,numeric,numeric,text) TO authenticated;

ALTER FUNCTION public.etihad_collect_sale_payment(uuid,text,numeric,text,text,text) SECURITY DEFINER;
ALTER FUNCTION public.etihad_collect_sale_payment(uuid,text,numeric,text,text,text) SET search_path TO '';
REVOKE EXECUTE ON FUNCTION private.etihad_collect_sale_payment_idempotent(uuid,text,numeric,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.etihad_collect_sale_payment(uuid,text,numeric,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.etihad_collect_sale_payment(uuid,text,numeric,text,text,text) TO authenticated;

ALTER FUNCTION public.etihad_create_sales_return(uuid,text,text,numeric,numeric,text,text,numeric,numeric) SECURITY DEFINER;
ALTER FUNCTION public.etihad_create_sales_return(uuid,text,text,numeric,numeric,text,text,numeric,numeric) SET search_path TO '';
ALTER FUNCTION public.etihad_create_sales_return(uuid,text,text,numeric,numeric,text,text) SECURITY DEFINER;
ALTER FUNCTION public.etihad_create_sales_return(uuid,text,text,numeric,numeric,text,text) SET search_path TO '';
REVOKE EXECUTE ON FUNCTION private.etihad_create_sales_return(uuid,text,text,numeric,numeric,text,text,numeric,numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.etihad_create_sales_return(uuid,text,text,numeric,numeric,text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.etihad_create_sales_return(uuid,text,text,numeric,numeric,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.etihad_create_sales_return(uuid,text,text,numeric,numeric,text,text,numeric,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.etihad_create_sales_return(uuid,text,text,numeric,numeric,text,text) TO authenticated;