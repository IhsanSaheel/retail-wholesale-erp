-- Etihad Traders intentionally permits POS sales beyond on-hand stock.
-- Product quantity is the authoritative running inventory and may become negative.
-- Batch-tracked products still consume available, unexpired lots FEFO; any shortage
-- is recorded as an unallocated negative-inventory movement for a complete audit trail.

DO $migration$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  -- 1) Permit product-level stock to move below zero on confirmed POS sales.
  SELECT pg_catalog.pg_get_functiondef(
    'private.etihad_create_sale_legacy(uuid,text,jsonb,numeric,numeric,numeric,numeric,text)'::regprocedure
  ) INTO v_def;

  v_old := $old$    if v_current < v_qty then
      raise exception 'Insufficient stock for %. Available: %, requested: %', coalesce(v_item->>'name','product'), v_current, v_qty;
    end if;$old$;
  IF pg_catalog.strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'Could not locate the legacy sale stock guard; migration stopped safely.';
  END IF;
  v_def := pg_catalog.replace(v_def, v_old,
    '    -- Negative inventory is permitted for this demo/POS workflow.');
  EXECUTE v_def;

  -- 2) Keep FEFO batch allocation, but allow the unfilled quantity to go negative
  -- at product level and record the unallocated part explicitly.
  SELECT pg_catalog.pg_get_functiondef(
    'private.etihad_create_sale(uuid,text,jsonb,numeric,numeric,numeric,numeric,text)'::regprocedure
  ) INTO v_def;

  v_old := $old$   if v_available+0.000001<v_need then
     raise exception 'Insufficient unexpired batch stock for product %. Required %, available %.',v_product_id,v_need,v_available;
   end if;$old$;
  IF pg_catalog.strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'Could not locate the sale batch stock guard; migration stopped safely.';
  END IF;
  v_def := pg_catalog.replace(v_def, v_old,
    '   -- Continue with available unexpired batches; any shortage is recorded below.');

  v_old := $old$     v_need:=v_need-v_take;
   end loop;
 end loop;$old$;
  v_new := $new$     v_need:=v_need-v_take;
   end loop;
   if v_need>0.000001 then
     v_movement_id:=pg_catalog.gen_random_uuid()::text;
     insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
     values(p_org_id,'mberp_stock_batch_movements',v_movement_id,array[p_branch_id],
       pg_catalog.jsonb_build_object(
         'id',v_movement_id,'type','sale_deduction','date',v_date,
         'saleId',coalesce(v_result->>'saleId',p_sale->>'id'),
         'invoiceNo',coalesce(v_result->>'invoiceNo',p_sale->>'invoiceNo'),
         'productId',v_product_id,'productName',v_item->>'name',
         'branchId',p_branch_id,'qty',-v_need,
         'note','Unallocated negative inventory: sale exceeded unexpired batch stock'
       ),v_user);
   end if;
 end loop;$new$;
  IF pg_catalog.strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'Could not locate the sale batch allocation tail; migration stopped safely.';
  END IF;
  v_def := pg_catalog.replace(v_def, v_old, v_new);
  EXECUTE v_def;

  -- 3) Apply the same rule when an owner/manager edits an existing invoice.
  SELECT pg_catalog.pg_get_functiondef(
    'private.etihad_edit_sale(uuid,text,jsonb,numeric,numeric,text,text,numeric,text,numeric,numeric,text)'::regprocedure
  ) INTO v_def;

  v_old := $old$  if v_current<v_qty then raise exception 'Insufficient stock for %. Available %, requested %',coalesce(v_new_item->>'name','product'),v_current,v_qty; end if;$old$;
  IF pg_catalog.strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'Could not locate the sale-edit product stock guard; migration stopped safely.';
  END IF;
  v_def := pg_catalog.replace(v_def, v_old,
    '  -- Negative inventory is permitted; product quantity remains the authoritative balance.');

  v_old := $old$   if v_available<v_qty then raise exception 'Insufficient unexpired batch stock for %. Available %, requested %',coalesce(v_new_item->>'name','product'),v_available,v_qty; end if;$old$;
  IF pg_catalog.strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'Could not locate the sale-edit batch stock guard; migration stopped safely.';
  END IF;
  v_def := pg_catalog.replace(v_def, v_old,
    '   -- Consume available unexpired batches and record any remainder as unallocated.');

  -- Unallocated deduction rows have no batch ID. During invoice edits, supersede
  -- those rows and record their product-level restoration without touching a lot.
  v_old := $old$   select record_id,data into v_batch from public.etihad_records
    where org_id=p_org_id and collection='mberp_stock_batches'
     and record_id=v_alloc.data->>'batchId' for update;
   if not found then raise exception 'Original stock batch is missing. No changes were made'; end if;
   v_take:=abs(coalesce(nullif(v_alloc.data->>'qty','')::numeric,0));$old$;
  v_new := $new$   v_take:=abs(coalesce(nullif(v_alloc.data->>'qty','')::numeric,0));
   if coalesce(v_alloc.data->>'batchId','')='' then
    update public.etihad_records
     set data=pg_catalog.jsonb_set(data,'{type}',to_jsonb('sale_edit_superseded'::text),true),
         updated_by=v_user,updated_at=v_now
     where org_id=p_org_id and collection='mberp_stock_batch_movements' and record_id=v_alloc.record_id;
    v_mov:=pg_catalog.gen_random_uuid()::text;
    insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
    values(p_org_id,'mberp_stock_batch_movements',v_mov,array[v_branch],
     pg_catalog.jsonb_build_object('id',v_mov,'type','sale_edit_unallocated_restoration',
      'date',v_now,'saleId',p_sale_id,'invoiceNo',v_sale.data->>'invoiceNo',
      'productId',v_old_item.product_id,'productName',v_old_item.product_name,
      'branchId',v_branch,'qty',v_take,'sourceMovementId',v_alloc.record_id,
      'note','Unallocated negative inventory restored during invoice edit'),v_user);
    continue;
   end if;
   select record_id,data into v_batch from public.etihad_records
    where org_id=p_org_id and collection='mberp_stock_batches'
     and record_id=v_alloc.data->>'batchId' for update;
   if not found then raise exception 'Original stock batch is missing. No changes were made'; end if;$new$;
  IF pg_catalog.strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'Could not locate the sale-edit batch restoration block; migration stopped safely.';
  END IF;
  v_def := pg_catalog.replace(v_def, v_old, v_new);

  v_old := $old$    v_left:=v_left-v_take;
   end loop;
  end if;
 end loop;
 if v_advance_to_restore>0 then$old$;
  v_new := $new$    v_left:=v_left-v_take;
   end loop;
   if v_left>0.000001 then
    v_mov:=pg_catalog.gen_random_uuid()::text;
    insert into public.etihad_records(org_id,collection,record_id,branch_ids,data,updated_by)
    values(p_org_id,'mberp_stock_batch_movements',v_mov,array[v_branch],
     pg_catalog.jsonb_build_object('id',v_mov,'type','sale_deduction','date',v_now,
      'saleId',p_sale_id,'invoiceNo',v_sale.data->>'invoiceNo',
      'productId',v_new_item->>'productId','productName',v_new_item->>'name',
      'branchId',v_branch,'branchName',v_sale.data->>'branchName','qty',-v_left,
      'note','Unallocated negative inventory: edited invoice exceeded unexpired batch stock'),v_user);
   end if;
  end if;
 end loop;
 if v_advance_to_restore>0 then$new$;
  IF pg_catalog.strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'Could not locate the sale-edit batch allocation tail; migration stopped safely.';
  END IF;
  v_def := pg_catalog.replace(v_def, v_old, v_new);
  EXECUTE v_def;
END
$migration$;
