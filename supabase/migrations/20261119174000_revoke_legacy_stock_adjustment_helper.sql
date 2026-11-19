REVOKE EXECUTE ON FUNCTION private.etihad_request_stock_adjustment(uuid,text,numeric,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.etihad_request_stock_adjustment_v2(uuid,text,numeric,text,text,text) TO authenticated;
REVOKE EXECUTE ON FUNCTION private.etihad_request_stock_adjustment_v2(uuid,text,numeric,text,text,text) FROM PUBLIC, anon;
