do $migration$
declare
  v_definition text;
  v_replacement text := '(pg_catalog.now() at time zone ''Asia/Karachi'')::date';
begin
  select pg_catalog.pg_get_functiondef(
    'private.etihad_edit_sale(uuid,text,jsonb,numeric,numeric,text,text,numeric,text,numeric,numeric,text)'::regprocedure
  ) into v_definition;

  if pg_catalog.strpos(v_definition, 'current_date') = 0 then
    raise exception 'Expected database-date comparisons were not found; migration stopped';
  end if;

  v_definition := pg_catalog.replace(v_definition, 'current_date', v_replacement);
  execute v_definition;
end
$migration$;