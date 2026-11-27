create or replace function private.sync_mberp_sale_loyalty_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings jsonb := '{}'::jsonb;
  v_enabled boolean := true;
  v_earn_amount numeric := 1;
  v_earn_points numeric := 1;
  v_total numeric := 0;
  v_earned numeric := 0;
  v_phone text := '';
  v_name text := '';
begin
  if new.collection <> 'mberp_sales' then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.collection = 'mberp_sales'
     and new.org_id = old.org_id
     and new.data->>'total' is not distinct from old.data->>'total'
     and new.data->'items' is not distinct from old.data->'items'
     and new.data->>'customerPhone' is not distinct from old.data->>'customerPhone'
     and new.data->>'customerName' is not distinct from old.data->>'customerName'
     and new.data->>'loyaltyPointsEarned' is not distinct from old.data->>'loyaltyPointsEarned'
     and new.data->>'loyaltyEligibleTotal' is not distinct from old.data->>'loyaltyEligibleTotal'
  then
    return new;
  end if;

  select coalesce(r.data, '{}'::jsonb)
    into v_settings
  from public.etihad_records r
  where r.org_id = new.org_id
    and r.collection = 'mberp_loyalty_settings'
  order by r.updated_at desc nulls last, r.record_id
  limit 1;

  v_enabled := case
    when lower(coalesce(v_settings->>'enabled', 'true')) in ('false', '0', 'no') then false
    else true
  end;

  if coalesce(v_settings->>'earnAmount', '') ~ '^[0-9]+([.][0-9]+)?$' then
    v_earn_amount := (v_settings->>'earnAmount')::numeric;
  end if;
  if coalesce(v_settings->>'earnPoints', '') ~ '^[0-9]+([.][0-9]+)?$' then
    v_earn_points := (v_settings->>'earnPoints')::numeric;
  end if;

  v_total := greatest(0, coalesce(nullif(new.data->>'total', '')::numeric, 0));
  v_phone := btrim(coalesce(new.data->>'customerPhone', ''));
  v_name := btrim(coalesce(new.data->>'customerName', ''));

  if v_enabled
     and v_earn_amount > 0
     and v_earn_points > 0
     and v_phone <> ''
     and lower(v_name) not in ('walk-in customer', 'walk in customer')
  then
    v_earned := floor((v_total / v_earn_amount) * v_earn_points);
  end if;

  new.data := coalesce(new.data, '{}'::jsonb)
    || jsonb_build_object(
      'loyaltyEligibleTotal', v_total,
      'loyaltyPointsEarned', v_earned
    );

  return new;
end;
$$;

revoke all on function private.sync_mberp_sale_loyalty_fields() from public, anon, authenticated;

drop trigger if exists etihad_sync_sale_loyalty_fields on public.etihad_records;
create trigger etihad_sync_sale_loyalty_fields
before insert or update of data, collection, org_id
on public.etihad_records
for each row
execute function private.sync_mberp_sale_loyalty_fields();

-- The one-off repair of invoice 4ea477759c2c4 was performed separately after this trigger was installed.
