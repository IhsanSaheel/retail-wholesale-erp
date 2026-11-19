do $$
declare
 v_definition text;
 v_old text := '''note'',coalesce(p_note,''''),''sourceBatchId'',nullif(p_batch_id,''''),''destinationBatchId'',v_destination_batch_id';
 v_new text := '''note'',coalesce(p_note,''''),''batchNo'',case when v_source_batch_count>0 then v_batch.data->>''batchNo'' else null end,''sourceBatchId'',nullif(p_batch_id,''''),''destinationBatchId'',v_destination_batch_id';
begin
 v_definition:=pg_catalog.pg_get_functiondef(
  'private.etihad_transfer_stock_batch_aware(uuid,text,text,text,numeric,text,text,text)'::regprocedure
 );
 if pg_catalog.strpos(v_definition,v_old)=0 then
  raise exception 'Expected transfer register batch reference was not found; refusing to modify function.';
 end if;
 v_definition:=pg_catalog.replace(v_definition,v_old,v_new);
 execute v_definition;
end
$$;
