-- Add covering indexes for employee and audit foreign keys.
-- Composite org-scoped indexes remain in place for the common business queries;
-- these single-column indexes also support FK checks and user-scoped lookups.

create index if not exists etihad_attendance_employee_user_fk_idx on public.etihad_attendance(employee_user_id);
create index if not exists etihad_attendance_recorded_by_fk_idx on public.etihad_attendance(recorded_by);
create index if not exists etihad_employee_documents_employee_user_fk_idx on public.etihad_employee_documents(employee_user_id);
create index if not exists etihad_employee_documents_uploaded_by_fk_idx on public.etihad_employee_documents(uploaded_by);
create index if not exists etihad_employee_profiles_user_fk_idx on public.etihad_employee_profiles(user_id);
create index if not exists etihad_leave_employee_user_fk_idx on public.etihad_leave_requests(employee_user_id);
create index if not exists etihad_leave_reviewer_user_fk_idx on public.etihad_leave_requests(reviewer_user_id);
create index if not exists etihad_organizations_owner_user_fk_idx on public.etihad_organizations(owner_user_id);
create index if not exists etihad_payroll_created_by_fk_idx on public.etihad_payroll(created_by);
create index if not exists etihad_payroll_employee_user_fk_idx on public.etihad_payroll(employee_user_id);
create index if not exists etihad_performance_employee_user_fk_idx on public.etihad_performance_reviews(employee_user_id);
create index if not exists etihad_performance_reviewer_user_fk_idx on public.etihad_performance_reviews(reviewer_user_id);
