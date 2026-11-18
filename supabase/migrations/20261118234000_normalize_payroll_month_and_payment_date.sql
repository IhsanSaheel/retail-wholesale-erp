do $$
declare v_create text;v_paid text;
begin
 v_create:=pg_catalog.pg_get_functiondef('private.etihad_create_payroll(uuid,uuid,date,numeric,numeric)'::regprocedure);
 if pg_catalog.strpos(v_create,'p_period_month,')=0 then
  raise exception 'Expected payroll period insert expression not found; refusing to modify function';
 end if;
 v_create:=pg_catalog.replace(v_create,'p_period_month,','date_trunc(''month'',p_period_month)::date,');
 if pg_catalog.strpos(v_create,'if p_period_month is null')=0 then
  v_create:=pg_catalog.replace(v_create,
   'if coalesce(p_allowances,0)<0',
   'if p_period_month is null then raise exception ''Payroll month is required'';end if; if coalesce(p_allowances,0)<0');
 end if;
 execute v_create;
 v_paid:=pg_catalog.pg_get_functiondef('private.etihad_mark_payroll_paid(uuid,uuid,text)'::regprocedure);
 if pg_catalog.strpos(v_paid,'payment_date=current_date')=0 then
  raise exception 'Expected payroll payment date expression not found; refusing to modify function';
 end if;
 v_paid:=pg_catalog.replace(v_paid,'payment_date=current_date','payment_date=(pg_catalog.now() at time zone ''Asia/Karachi'')::date');
 execute v_paid;
end
$$;
do $$
begin
 if not exists(select 1 from pg_constraint where conrelid='public.etihad_payroll'::regclass and conname='etihad_payroll_period_month_start_check') then
  alter table public.etihad_payroll add constraint etihad_payroll_period_month_start_check check (extract(day from period_month)=1);
 end if;
end
$$;