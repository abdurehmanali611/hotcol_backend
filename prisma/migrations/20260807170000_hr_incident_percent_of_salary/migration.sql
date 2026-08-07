-- Incident pay impact as % of salary (replaces fixed ETB in the UI).
ALTER TABLE `hr_incident_type`
  ADD COLUMN `percentOfSalary` DOUBLE NOT NULL DEFAULT 0;
ALTER TABLE `hr_incident`
  ADD COLUMN `percentOfSalary` DOUBLE NOT NULL DEFAULT 0;
