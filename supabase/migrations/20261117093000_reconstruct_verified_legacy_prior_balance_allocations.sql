-- Reconstruct exact legacy prior-outstanding allocations from contemporaneous POS
-- payment records. This is safe only where source sale timestamp/customer match
-- the extra-tender payment and the sum exactly equals priorOutstandingApplied.
-- No sale balances or payment records are modified; this adds audit links only.

DO $migration$
DECLARE
  v_expected integer;
  v_matched integer;
  v_source record;
  v_payment record;
  v_id text;
BEGIN
  SELECT count(*) INTO v_expected
  FROM public.etihad_records s
  WHERE s.collection='mberp_sales'
    AND coalesce(nullif(s.data->>'priorOutstandingApplied','')::numeric,0)>0
    AND s.data->>'invoiceNo' IN ('INV-2026-152904','INV-2026-FCDCC4','INV-2026-87C344');

  IF v_expected <> 3 THEN
    RAISE EXCEPTION 'Expected exactly three known legacy source invoices; found %',v_expected;
  END IF;

  SELECT count(*) INTO v_matched
  FROM public.etihad_records s
  JOIN public.etihad_records p
    ON p.org_id=s.org_id
   AND p.collection='mberp_payments'
   AND p.data->>'date'=s.data->>'date'
   AND p.data->>'customerPhone'=s.data->>'customerPhone'
   AND p.data->>'note' LIKE 'Extra POS tender allocated to previous customer outstanding%'
  WHERE s.collection='mberp_sales'
    AND s.data->>'invoiceNo' IN ('INV-2026-152904','INV-2026-FCDCC4','INV-2026-87C344')
    AND coalesce(nullif(s.data->>'priorOutstandingApplied','')::numeric,0)>0;

  IF v_matched <> 5 THEN
    RAISE EXCEPTION 'Expected five contemporaneous extra-tender payment records; found %',v_matched;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.etihad_records s
    LEFT JOIN LATERAL (
      SELECT coalesce(sum(nullif(p.data->>'amount','')::numeric),0) amount
      FROM public.etihad_records p
      WHERE p.org_id=s.org_id AND p.collection='mberp_payments'
        AND p.data->>'date'=s.data->>'date'
        AND p.data->>'customerPhone'=s.data->>'customerPhone'
        AND p.data->>'note' LIKE 'Extra POS tender allocated to previous customer outstanding%'
    ) x ON true
    WHERE s.collection='mberp_sales'
      AND s.data->>'invoiceNo' IN ('INV-2026-152904','INV-2026-FCDCC4','INV-2026-87C344')
      AND x.amount<>coalesce(nullif(s.data->>'priorOutstandingApplied','')::numeric,0)
  ) THEN
    RAISE EXCEPTION 'Historical payment evidence does not exactly equal source settlement amount; aborting.';
  END IF;

  FOR v_source IN
    SELECT s.org_id,s.record_id source_id,s.data source_data,s.branch_ids
    FROM public.etihad_records s
    WHERE s.collection='mberp_sales'
      AND s.data->>'invoiceNo' IN ('INV-2026-152904','INV-2026-FCDCC4','INV-2026-87C344')
      AND coalesce(nullif(s.data->>'priorOutstandingApplied','')::numeric,0)>0
  LOOP
    FOR v_payment IN
      SELECT p.record_id payment_id,p.data payment_data,d.record_id destination_id,d.data destination_data
      FROM public.etihad_records p
      JOIN public.etihad_records d
        ON d.org_id=p.org_id AND d.collection='mberp_sales'
       AND d.record_id=p.data->>'saleId'
      WHERE p.org_id=v_source.org_id
        AND p.collection='mberp_payments'
        AND p.data->>'date'=v_source.source_data->>'date'
        AND p.data->>'customerPhone'=v_source.source_data->>'customerPhone'
        AND p.data->>'note' LIKE 'Extra POS tender allocated to previous customer outstanding%'
    LOOP
      v_id := 'legacy-prior-' || v_payment.payment_id;
      INSERT INTO public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
      VALUES(
        v_source.org_id,
        'mberp_customer_credit_allocations',
        v_id,
        coalesce(v_source.branch_ids,array[]::text[]),
        jsonb_build_object(
          'id',v_id,
          'type','prior_balance_settlement',
          'date',v_payment.payment_data->>'date',
          'saleId',v_source.source_id,
          'sourceInvoiceNo',v_source.source_data->>'invoiceNo',
          'settledSaleId',v_payment.destination_id,
          'invoiceNo',v_payment.destination_data->>'invoiceNo',
          'paymentId',v_payment.payment_id,
          'amount',nullif(v_payment.payment_data->>'amount','')::numeric,
          'method',coalesce(v_payment.payment_data->>'method','Cash'),
          'customerName',v_source.source_data->>'customerName',
          'customerPhone',v_source.source_data->>'customerPhone',
          'branchId',v_source.source_data->>'branchId',
          'status','active',
          'note','Legacy settlement allocation reconstructed from matching POS timestamp, customer, exact payment destination saleId, and contemporaneous extra-tender payment record.'
        ),
        auth.uid()
      )
      ON CONFLICT (org_id,collection,record_id) DO NOTHING;
    END LOOP;
  END LOOP;
END;
$migration$;
