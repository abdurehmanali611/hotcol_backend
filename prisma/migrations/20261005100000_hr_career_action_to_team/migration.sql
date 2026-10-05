-- Target team for a promotion / transfer request (applied on Manager approve).
ALTER TABLE `hr_career_action` ADD COLUMN `toTeamId` INTEGER NULL;
