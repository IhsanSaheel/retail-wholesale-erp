ALTER FUNCTION public.etihad_collect_supplier_payment(uuid,text,numeric,text,text,text) SECURITY DEFINER;
ALTER FUNCTION public.etihad_collect_supplier_payment(uuid,text,numeric,text,text,text) SET search_path TO '';
REVOKE EXECUTE ON FUNCTION private.etihad_collect_supplier_payment(uuid,text,numeric,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.etihad_collect_supplier_payment(uuid,text,numeric,text,text,text) TO authenticated;

ALTER FUNCTION public.etihad_create_supplier_return(uuid,text,numeric,numeric,text,text) SECURITY DEFINER;
ALTER FUNCTION public.etihad_create_supplier_return(uuid,text,numeric,numeric,text,text) SET search_path TO '';
REVOKE EXECUTE ON FUNCTION private.etihad_create_supplier_return(uuid,text,numeric,numeric,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.etihad_create_supplier_return(uuid,text,numeric,numeric,text,text) TO authenticated;

ALTER FUNCTION public.etihad_open_cash_register(uuid,text,numeric,text,text,uuid) SECURITY DEFINER;
ALTER FUNCTION public.etihad_open_cash_register(uuid,text,numeric,text,text,uuid) SET search_path TO '';
ALTER FUNCTION public.etihad_open_cash_register(uuid,text,numeric,text,text) SECURITY DEFINER;
ALTER FUNCTION public.etihad_open_cash_register(uuid,text,numeric,text,text) SET search_path TO '';
REVOKE EXECUTE ON FUNCTION private.etihad_open_cash_register(uuid,text,numeric,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.etihad_open_cash_register(uuid,text,numeric,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.etihad_open_cash_register(uuid,text,numeric,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.etihad_open_cash_register(uuid,text,numeric,text,text) TO authenticated;

ALTER FUNCTION public.etihad_close_cash_register(uuid,text,numeric) SECURITY DEFINER;
ALTER FUNCTION public.etihad_close_cash_register(uuid,text,numeric) SET search_path TO '';
REVOKE EXECUTE ON FUNCTION private.etihad_close_cash_register(uuid,text,numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.etihad_close_cash_register(uuid,text,numeric) TO authenticated;

ALTER FUNCTION public.etihad_record_cash_movement(uuid,text,text,text,numeric,text) SECURITY DEFINER;
ALTER FUNCTION public.etihad_record_cash_movement(uuid,text,text,text,numeric,text) SET search_path TO '';
REVOKE EXECUTE ON FUNCTION private.etihad_record_cash_movement(uuid,text,text,text,numeric,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.etihad_record_cash_movement(uuid,text,text,text,numeric,text) TO authenticated;

ALTER FUNCTION public.etihad_create_payroll(uuid,uuid,date,numeric,numeric) SECURITY DEFINER;
ALTER FUNCTION public.etihad_create_payroll(uuid,uuid,date,numeric,numeric) SET search_path TO '';
REVOKE EXECUTE ON FUNCTION private.etihad_create_payroll(uuid,uuid,date,numeric,numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.etihad_create_payroll(uuid,uuid,date,numeric,numeric) TO authenticated;

ALTER FUNCTION public.etihad_mark_payroll_paid(uuid,uuid,text) SECURITY DEFINER;
ALTER FUNCTION public.etihad_mark_payroll_paid(uuid,uuid,text) SET search_path TO '';
REVOKE EXECUTE ON FUNCTION private.etihad_mark_payroll_paid(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.etihad_mark_payroll_paid(uuid,uuid,text) TO authenticated;