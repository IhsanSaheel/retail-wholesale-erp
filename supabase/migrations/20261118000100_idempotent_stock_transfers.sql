create table if not exists private.etihad_operation_idempotency (
  org_id uuid not null,
  operation text not null,
  operation_id text not null,
  request_data jsonb not null,
  response_data jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (org_id, operation, operation_id)
);
revoke all on table private.etihad_operation_idempotency from public, anon, authenticated;

create or replace function private.etihad_transfer_stock_idempotent(
  p_org_id uuid, p_from_branch text, p_to_branch text, p_product_id text,
  p_qty numeric, p_note text, p_transfer_id text
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_request jsonb;
  v_existing record;
  v_response jsonb;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if coalesce(p_transfer_id, '') = '' then raise exception 'A stable transfer reference is required'; end if;
  v_request := pg_catalog.jsonb_build_object(
    'fromBranch', p_from_branch, 'toBranch', p_to_branch,
    'productId', p_product_id, 'quantity', p_qty, 'note', coalesce(p_note, '')
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::text || ':stock-transfer:' || p_transfer_id, 0)
  );
  select request_data, response_data, created_by
    into v_existing
    from private.etihad_operation_idempotency
    where org_id = p_org_id and operation = 'stock_transfer' and operation_id = p_transfer_id
    for update;
  if found then
    if v_existing.created_by = v_user and v_existing.request_data = v_request then
      return v_existing.response_data || pg_catalog.jsonb_build_object('alreadyRecorded', true);
    end if;
    raise exception 'This transfer reference already exists with different or unauthorised details';
  end if;
  v_response := private.etihad_transfer_stock(
    p_org_id, p_from_branch, p_to_branch, p_product_id, p_qty, p_note
  );
  if coalesce((v_response->>'success')::boolean, false) is not true then
    raise exception 'Stock transfer was not confirmed';
  end if;
  insert into private.etihad_operation_idempotency(
    org_id, operation, operation_id, request_data, response_data, created_by
  ) values (p_org_id, 'stock_transfer', p_transfer_id, v_request, v_response, v_user);
  return v_response || pg_catalog.jsonb_build_object('alreadyRecorded', false);
end;
$function$;

create or replace function public.etihad_transfer_stock(
  p_org_id uuid, p_from_branch text, p_to_branch text, p_product_id text,
  p_qty numeric, p_note text, p_transfer_id text
) returns jsonb
language sql security definer set search_path = ''
as $function$
  select private.etihad_transfer_stock_idempotent(
    p_org_id, p_from_branch, p_to_branch, p_product_id, p_qty, p_note, p_transfer_id
  );
$function$;
revoke all on function public.etihad_transfer_stock(uuid,text,text,text,numeric,text,text) from public, anon;
grant execute on function public.etihad_transfer_stock(uuid,text,text,text,numeric,text,text) to authenticated;