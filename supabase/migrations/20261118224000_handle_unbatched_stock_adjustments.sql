do $$
declare
  v_definition text;
  v_old text := '''batchNo'',v_batch.data->>''batchNo''';
  v_new text := '''batchNo'',case when v_batch_count>0 then v_batch.data->>''batchNo'' else null end';
begin
  v_definition:=pg_catalog.pg_get_functiondef(
    'private.etihad_request_stock_adjustment_v2(uuid,text,numeric,text,text,text)'::regprocedure
  );
  if pg_catalog.strpos(v_definition,v_old)=0 then
    raise exception 'Expected unbatched adjustment batchNo expression was not found; refusing to alter function.';
  end if;
  v_definition:=pg_catalog.replace(v_definition,v_old,v_new);
  execute v_definition;
end
$$;
