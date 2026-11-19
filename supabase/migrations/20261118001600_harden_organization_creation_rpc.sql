create or replace function public.etihad_create_organization(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Login required';
  end if;

  if pg_catalog.length(pg_catalog.btrim(p_name)) = 0 then
    raise exception 'Company name required';
  end if;

  insert into public.etihad_organizations(name, owner_user_id)
  values (pg_catalog.btrim(p_name), auth.uid())
  returning id into v_org_id;

  insert into public.etihad_memberships(org_id, user_id, role)
  values (v_org_id, auth.uid(), 'owner');

  return v_org_id;
end;
$function$;

revoke all on function public.etihad_create_organization(text) from public, anon;
grant execute on function public.etihad_create_organization(text) to authenticated;