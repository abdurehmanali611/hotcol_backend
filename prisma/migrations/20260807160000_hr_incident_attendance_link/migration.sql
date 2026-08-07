-- Link incident types to attendance statuses for payroll auto-deduction.
ALTER TABLE `hr_incident_type`
  ADD COLUMN `attendanceLink` VARCHAR(191) NOT NULL DEFAULT '';
