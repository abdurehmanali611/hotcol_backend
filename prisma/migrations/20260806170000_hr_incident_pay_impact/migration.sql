-- AlterTable
ALTER TABLE `hr_incident` ADD COLUMN `salaryDeduct` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `amountETB` DOUBLE NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `hr_incident` MODIFY `kind` VARCHAR(191) NOT NULL DEFAULT 'other';
