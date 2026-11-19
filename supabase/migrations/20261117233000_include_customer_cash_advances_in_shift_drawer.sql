do $migration$
declare v_def text; v_old text; v_new text;
begin
 select pg_catalog.pg_get_functiondef(p.oid) into v_def from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='etihad_close_cash_register';
 if v_def is null then raise exception 'Cash register close function not found'; end if;
 v_old:='v_cash_refunds numeric:=0;';
 v_new:='v_cash_advances numeric:=0; v_cash_refunds numeric:=0;';
 if position(v_old in v_def)=0 then raise exception 'Cash close declaration anchor missing'; end if;
 v_def:=replace(v_def,v_old,v_new);
 v_old:=$old$
 select coalesce(sum(coalesce(nullif(r.data->>'amount','')::numeric,0)),0) into v_cash_refunds
 from public.etihad_records r where r.org_id=p_org_id and r.collection='mberp_payments'
$old$;
 v_new:=$new$
 select coalesce(sum(coalesce(nullif(c.data->>'amount','')::numeric,0)),0)
 into v_cash_advances
 from public.etihad_records c
 left join public.etihad_records s on s.org_id=c.org_id and s.collection='mberp_sales'
  and s.record_id=c.data->>'sourceSaleId'
 where c.org_id=p_org_id and c.collection='mberp_customer_account_credits'
  and c.data->>'type'='overpayment_advance'
  and lower(coalesce(nullif(c.data->>'method',''),nullif(s.data->>'paymentMethod',''),''))='cash'
  and coalesce(c.data->>'branchId',c.branch_ids[1],s.data->>'branchId',s.branch_ids[1])=v_session.data->>'branchId'
  and coalesce(c.data->>'receivedBy',c.updated_by::text)=v_session.data->>'cashierId'
  and coalesce(c.data->>'receivedAt',c.data->>'date','')::timestamptz >= (v_session.data->>'openedAt')::timestamptz
  and coalesce(c.data->>'receivedAt',c.data->>'date','')::timestamptz <= v_now;
 select coalesce(sum(coalesce(nullif(r.data->>'amount','')::numeric,0)),0) into v_cash_refunds
 from public.etihad_records r where r.org_id=p_org_id and r.collection='mberp_payments'
$new$;
 if position(v_old in v_def)=0 then raise exception 'Cash close refund query anchor missing'; end if;
 v_def:=replace(v_def,v_old,v_new);
 v_old:='+v_cash_sales+v_cash_tips-v_cash_refunds+v_in-v_out';
 v_new:='+v_cash_sales+v_cash_advances+v_cash_tips-v_cash_refunds+v_in-v_out';
 if position(v_old in v_def)=0 then raise exception 'Cash close expected balance formula anchor missing'; end if;
 v_def:=replace(v_def,v_old,v_new);
 v_def:=replace(v_def,'''cashTips'',v_cash_tips','''cashTips'',v_cash_tips,''cashAdvances'',v_cash_advances');
 execute v_def;

 select pg_catalog.pg_get_functiondef(p.oid) into v_def from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='etihad_record_cash_movement';
 if v_def is null then raise exception 'Cash movement function not found'; end if;
 v_old:='v_cash_refunds numeric:=0;';
 v_new:='v_cash_advances numeric:=0; v_cash_refunds numeric:=0;';
 if position(v_old in v_def)=0 then raise exception 'Cash movement declaration anchor missing'; end if;
 v_def:=replace(v_def,v_old,v_new);
 v_old:=$old$
 select coalesce(sum(coalesce(nullif(r.data->>'amount','')::numeric,0)),0)
 into v_cash_refunds
 from public.etihad_records r
$old$;
 v_new:=$new$
 select coalesce(sum(coalesce(nullif(c.data->>'amount','')::numeric,0)),0)
 into v_cash_advances
 from public.etihad_records c
 left join public.etihad_records s on s.org_id=c.org_id and s.collection='mberp_sales'
  and s.record_id=c.data->>'sourceSaleId'
 where c.org_id=p_org_id and c.collection='mberp_customer_account_credits'
  and c.data->>'type'='overpayment_advance'
  and lower(coalesce(nullif(c.data->>'method',''),nullif(s.data->>'paymentMethod',''),''))='cash'
  and coalesce(c.data->>'branchId',c.branch_ids[1],s.data->>'branchId',s.branch_ids[1])=v_session.data->>'branchId'
  and coalesce(c.data->>'receivedBy',c.updated_by::text)=v_session.data->>'cashierId'
  and coalesce(c.data->>'receivedAt',c.data->>'date','')::timestamptz >= (v_session.data->>'openedAt')::timestamptz
  and coalesce(c.data->>'receivedAt',c.data->>'date','')::timestamptz <= v_now;
 select coalesce(sum(coalesce(nullif(r.data->>'amount','')::numeric,0)),0)
 into v_cash_refunds
 from public.etihad_records r
$new$;
 if position(v_old in v_def)=0 then raise exception 'Cash movement refund query anchor missing'; end if;
 v_def:=replace(v_def,v_old,v_new);
 v_old:='+v_cash_sales+v_cash_tips-v_cash_refunds+v_in-v_out';
 v_new:='+v_cash_sales+v_cash_advances+v_cash_tips-v_cash_refunds+v_in-v_out';
 if position(v_old in v_def)=0 then raise exception 'Cash movement expected balance formula anchor missing'; end if;
 v_def:=replace(v_def,v_old,v_new);
 execute v_def;
end;
$migration$;