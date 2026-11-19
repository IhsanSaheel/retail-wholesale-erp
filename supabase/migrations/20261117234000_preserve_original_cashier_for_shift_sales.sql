-- Keep cashier shift totals tied to the cashier who completed the sale,
-- even when a manager later edits the invoice (which updates etihad_records.updated_by).
-- Legacy sales without cashierId continue to use updated_by as their fallback.
DO $migration$
DECLARE
  v_oid oid;
  v_definition text;
  v_old constant text := 's.updated_by::text=v_session.data->>''cashierId''';
  v_new constant text := 'coalesce(nullif(s.data->>''cashierId'',''''),s.updated_by::text)=v_session.data->>''cashierId''';
BEGIN
  FOR v_oid IN
    SELECT p.oid
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='private'
      AND p.proname IN ('etihad_close_cash_register','etihad_record_cash_movement')
  LOOP
    v_definition := pg_catalog.pg_get_functiondef(v_oid);
    IF (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old) <> 1 THEN
      RAISE EXCEPTION 'Expected exactly one legacy sale cashier check in function OID %', v_oid;
    END IF;
    v_definition := replace(v_definition,v_old,v_new);
    EXECUTE v_definition;
  END LOOP;
END
$migration$;
