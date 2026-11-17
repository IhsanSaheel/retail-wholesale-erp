-- Trigger functions are invoked by PostgreSQL triggers; clients do not need EXECUTE.
-- Keep the branch-integrity trigger attached while preventing direct RPC invocation.
REVOKE EXECUTE ON FUNCTION public.etihad_set_record_branch_ids() FROM authenticated;
