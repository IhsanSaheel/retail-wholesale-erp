-- Keep auth identity lookups stable within each statement for RLS evaluation.
-- This preserves every existing authorization predicate and only avoids per-row auth.uid() calls.

ALTER POLICY "Users can manage their own ERP data" ON public.erp_cloud_data
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

ALTER POLICY etihad_attendance_employee_insert ON public.etihad_attendance
  WITH CHECK (employee_user_id = (SELECT auth.uid()) AND etihad_is_member(org_id));
ALTER POLICY etihad_attendance_employee_read ON public.etihad_attendance
  USING (employee_user_id = (SELECT auth.uid()) AND etihad_is_member(org_id));

ALTER POLICY etihad_deletion_events_insert ON public.etihad_deletion_events
  WITH CHECK (deleted_by = (SELECT auth.uid()) AND etihad_record_access(org_id, collection, branch_ids, 'delete'::text));

ALTER POLICY etihad_documents_employee_insert ON public.etihad_employee_documents
  WITH CHECK (employee_user_id = (SELECT auth.uid()) AND uploaded_by = (SELECT auth.uid()) AND etihad_is_member(org_id));
ALTER POLICY etihad_documents_employee_read ON public.etihad_employee_documents
  USING (employee_user_id = (SELECT auth.uid()) AND etihad_is_member(org_id));

ALTER POLICY etihad_hr_profiles_employee_read ON public.etihad_employee_profiles
  USING (user_id = (SELECT auth.uid()) AND etihad_is_member(org_id));

ALTER POLICY etihad_leave_employee_insert ON public.etihad_leave_requests
  WITH CHECK (employee_user_id = (SELECT auth.uid()) AND etihad_is_member(org_id)
    AND request_status = 'pending'::text AND reviewer_user_id IS NULL);
ALTER POLICY etihad_leave_employee_read ON public.etihad_leave_requests
  USING (employee_user_id = (SELECT auth.uid()) AND etihad_is_member(org_id));

ALTER POLICY etihad_hr_payroll_employee_read ON public.etihad_payroll
  USING (employee_user_id = (SELECT auth.uid()) AND etihad_is_member(org_id));

ALTER POLICY etihad_performance_employee_read ON public.etihad_performance_reviews
  USING (employee_user_id = (SELECT auth.uid()) AND review_status = 'final'::text AND etihad_is_member(org_id));
