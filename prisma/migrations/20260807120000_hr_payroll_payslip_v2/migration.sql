-- Employee bank details
ALTER TABLE `hr_employee`
  ADD COLUMN `bankName` VARCHAR(191) NOT NULL DEFAULT '',
  ADD COLUMN `accountNumber` VARCHAR(191) NOT NULL DEFAULT '';

-- Payroll period: named month + flexible range uniqueness
ALTER TABLE `hr_payroll_period`
  ADD COLUMN `monthName` VARCHAR(191) NOT NULL DEFAULT '',
  ADD COLUMN `createdBy` VARCHAR(191) NOT NULL DEFAULT '';

DROP INDEX `hr_payroll_period_HotelName_periodKey_key` ON `hr_payroll_period`;

CREATE UNIQUE INDEX `hr_payroll_period_HotelName_fromYmd_toYmd_key` ON `hr_payroll_period`(`HotelName`, `fromYmd`, `toYmd`);
CREATE INDEX `hr_payroll_period_HotelName_periodKey_idx` ON `hr_payroll_period`(`HotelName`, `periodKey`);

-- Payslip enrichment + payment workflow
ALTER TABLE `hr_payslip`
  ADD COLUMN `payslipNumber` VARCHAR(191) NOT NULL DEFAULT '',
  ADD COLUMN `employeeName` VARCHAR(191) NOT NULL DEFAULT '',
  ADD COLUMN `jobTitle` VARCHAR(191) NOT NULL DEFAULT '',
  ADD COLUMN `taxPeriod` VARCHAR(191) NOT NULL DEFAULT '',
  ADD COLUMN `organizationLocation` VARCHAR(191) NOT NULL DEFAULT '',
  ADD COLUMN `payDate` VARCHAR(191) NOT NULL DEFAULT '',
  ADD COLUMN `hireDate` VARCHAR(191) NOT NULL DEFAULT '',
  ADD COLUMN `wageType` VARCHAR(191) NOT NULL DEFAULT '',
  ADD COLUMN `bankName` VARCHAR(191) NOT NULL DEFAULT '',
  ADD COLUMN `accountNumber` VARCHAR(191) NOT NULL DEFAULT '',
  ADD COLUMN `grossSalaryETB` DOUBLE NOT NULL DEFAULT 0,
  ADD COLUMN `totalEarningsETB` DOUBLE NOT NULL DEFAULT 0,
  ADD COLUMN `totalDeductionsETB` DOUBLE NOT NULL DEFAULT 0,
  ADD COLUMN `earningsJson` TEXT NULL,
  ADD COLUMN `deductionsJson` TEXT NULL,
  ADD COLUMN `paymentStatus` VARCHAR(191) NOT NULL DEFAULT 'unpaid',
  ADD COLUMN `hrMarkedPaidAt` DATETIME(3) NULL,
  ADD COLUMN `hrMarkedPaidBy` VARCHAR(191) NOT NULL DEFAULT '',
  ADD COLUMN `managerApprovedAt` DATETIME(3) NULL,
  ADD COLUMN `managerApprovedBy` VARCHAR(191) NOT NULL DEFAULT '';

UPDATE `hr_payslip` SET
  `earningsJson` = COALESCE(NULLIF(`earningsJson`, ''), '[]'),
  `deductionsJson` = COALESCE(NULLIF(`deductionsJson`, ''), '[]'),
  `grossSalaryETB` = `basePayETB`,
  `totalEarningsETB` = `basePayETB` + `overtimeETB` + `tipsETB`,
  `totalDeductionsETB` = `deductionsETB`,
  `payslipNumber` = CASE
    WHEN `payslipNumber` IS NULL OR `payslipNumber` = '' THEN CONCAT('LEGACY-', `id`)
    ELSE `payslipNumber`
  END;

CREATE UNIQUE INDEX `hr_payslip_HotelName_payslipNumber_key` ON `hr_payslip`(`HotelName`, `payslipNumber`);
CREATE INDEX `hr_payslip_HotelName_paymentStatus_idx` ON `hr_payslip`(`HotelName`, `paymentStatus`);

CREATE TABLE `hr_payroll_line_rule` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `HotelName` VARCHAR(191) NOT NULL,
  `kind` VARCHAR(191) NOT NULL,
  `label` VARCHAR(191) NOT NULL,
  `amountETB` DOUBLE NOT NULL DEFAULT 0,
  `whenMode` VARCHAR(191) NOT NULL DEFAULT 'always',
  `fromDay` INTEGER NULL,
  `toDay` INTEGER NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `hr_payroll_line_rule_HotelName_idx`(`HotelName`),
  INDEX `hr_payroll_line_rule_HotelName_kind_idx`(`HotelName`, `kind`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `hr_wage_pay_window` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `HotelName` VARCHAR(191) NOT NULL,
  `wageType` VARCHAR(191) NOT NULL,
  `fromDay` INTEGER NOT NULL,
  `toDay` INTEGER NOT NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `hr_wage_pay_window_HotelName_wageType_key`(`HotelName`, `wageType`),
  INDEX `hr_wage_pay_window_HotelName_idx`(`HotelName`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
