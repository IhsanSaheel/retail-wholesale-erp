-- Keep stock mutation helpers private to trusted SECURITY DEFINER entry points.
-- Public wrappers retain the application's existing RPC interface and delegate to
-- helpers that independently validate auth.uid(), active membership, role and branch scope.

ALTER FUNCTION public.etihad_request_stock_adjustment_v2(uuid, text, numeric, text, text, text)
  SECURITY DEFINER;
ALTER FUNCTION public.etihad_review_stock_adjustment(uuid, text, text, text)
  SECURITY DEFINER;
ALTER FUNCTION public.etihad_transfer_stock(uuid, text, text, text, numeric, text)
  SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION private.etihad_request_stock_adjustment_v2(uuid, text, numeric, text, text, text)
  FROM authenticated;
REVOKE EXECUTE ON FUNCTION private.etihad_review_stock_adjustment(uuid, text, text, text)
  FROM authenticated;
REVOKE EXECUTE ON FUNCTION private.etihad_transfer_stock(uuid, text, text, text, numeric, text)
  FROM authenticated;
REVOKE EXECUTE ON FUNCTION private.etihad_transfer_stock_idempotent(uuid, text, text, text, numeric, text, text)
  FROM authenticated;
