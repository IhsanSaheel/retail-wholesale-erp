do $migration$
declare
  v_definition text;
  v_old text := '::date<current_date';
  v_new text := '::date < (pg_catalog.now() at time zone ''Asia/Karachi'')::date';
begin
  select pg_catalog.pg_get_functiondef(
    'private.etihad_cancel_sale(uuid,text,text)'::regprocedure
  ) into v_definition;

  if pg_catalog.strpos(v_definition, v_old) = 0 then
    raise exception 'Expected cancellation expiry comparison was not found; migration stopped';
  end if;

  v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  execute v_definition;
end
$migration$;