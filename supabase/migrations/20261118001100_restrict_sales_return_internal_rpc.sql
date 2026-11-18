-- Keep the internal sales-return implementation callable by signed-in members only.
revoke all on function private.etihad_create_sales_return(uuid,text,text,numeric,numeric,text,text,numeric,numeric) from public, anon;
grant execute on function private.etihad_create_sales_return(uuid,text,text,numeric,numeric,text,text,numeric,numeric) to authenticated;
