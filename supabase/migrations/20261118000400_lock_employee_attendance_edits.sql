-- Employees may create and view their own attendance records, but only owners
-- may correct or amend attendance history. The application has no employee edit flow.
drop policy if exists etihad_attendance_employee_update on public.etihad_attendance;