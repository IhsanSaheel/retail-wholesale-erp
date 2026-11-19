do $$
declare
  v_definition text;
  v_old text := 'and p2.data->>''type''=''sale_payment'' and p2.data->>''saleId''=s.record_id';
  v_new text := 'and (p2.data->>''type''=''sale_payment'' or (p2.data->>''type'' is null and p2.data->>''note'' like ''%Bulk customer payment%'')) and p2.data->>''saleId''=s.record_id';
begin
  select pg_catalog.pg_get_functiondef(p.oid)
    into v_definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private'
    and p.proname='etihad_close_cash_register'
    and p.prokind='f';

  if v_definition is null then
    raise exception 'Cash register close function was not found';
  end if;
  if pg_catalog.position(v_old in v_definition)=0 then
    raise exception 'Expected sale-payment exclusion predicate was not found; migration stopped';
  end if;

  v_definition := pg_catalog.replace(v_definition,v_old,v_new);

  if pg_catalog.position('p2.data->>''note'' like ''%Bulk customer payment%''' in v_definition)=0 then
    raise exception 'Legacy bulk-payment exclusion was not added; migration stopped';
  end if;

  execute v_definition;
end
$$;