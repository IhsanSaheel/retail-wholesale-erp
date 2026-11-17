-- Employees may only record their own attendance for the current Pakistan business date.
-- Owners retain the existing owner-all policy for corrections and historical entry.
ALTER POLICY etihad_attendance_employee_insert ON public.etihad_attendance
WITH CHECK (
  employee_user_id = (SELECT auth.uid())
  AND recorded_by = (SELECT auth.uid())
  AND etihad_is_member(org_id)
  AND work_date = (now() AT TIME ZONE 'Asia/Karachi')::date
  AND attendance_status IN ('present','late','half_day')
  AND EXISTS (
    SELECT 1
    FROM public.etihad_employee_profiles p
    WHERE p.org_id = etihad_attendance.org_id
      AND p.user_id = (SELECT auth.uid())
      AND p.employee_code = etihad_attendance.employee_code
      AND p.full_name = etihad_attendance.employee_name
  )
);
