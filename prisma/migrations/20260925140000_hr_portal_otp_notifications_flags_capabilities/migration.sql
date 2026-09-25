-- AlterTable
ALTER TABLE `tenant_account` ADD COLUMN `hrSoloManagerEnabled` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `tenant_account` ADD COLUMN `hrBiometricsEnabled` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `hr_employee` ADD COLUMN `portalOtpHash` VARCHAR(191) NOT NULL DEFAULT '';
ALTER TABLE `hr_employee` ADD COLUMN `portalOtpPreview` VARCHAR(191) NOT NULL DEFAULT '';
ALTER TABLE `hr_employee` ADD COLUMN `portalOtpViewer` VARCHAR(191) NOT NULL DEFAULT 'none';
ALTER TABLE `hr_employee` ADD COLUMN `mustChangeOtp` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `hr_employee` ADD COLUMN `portalOtpIssuedAt` DATETIME(3) NULL;
ALTER TABLE `hr_employee` ADD COLUMN `portalFirstLoginAt` DATETIME(3) NULL;
ALTER TABLE `hr_employee` ADD COLUMN `profileImageUrl` VARCHAR(191) NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE `hr_employee_capability` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `HotelName` VARCHAR(191) NOT NULL,
    `employeeId` INTEGER NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `scopeJson` JSON NULL,
    `grantedBy` VARCHAR(191) NOT NULL DEFAULT '',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hr_otp_reset_request` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `HotelName` VARCHAR(191) NOT NULL,
    `employeeId` INTEGER NOT NULL,
    `requestedBy` VARCHAR(191) NOT NULL DEFAULT '',
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `decidedBy` VARCHAR(191) NOT NULL DEFAULT '',
    `decidedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hr_notification` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `HotelName` VARCHAR(191) NOT NULL,
    `recipientRole` VARCHAR(191) NOT NULL DEFAULT '',
    `employeeId` INTEGER NULL,
    `kind` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `href` VARCHAR(191) NOT NULL DEFAULT '',
    `actionStatus` VARCHAR(191) NOT NULL DEFAULT '',
    `createdBy` VARCHAR(191) NOT NULL DEFAULT '',
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hr_biometric_device` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `HotelName` VARCHAR(191) NOT NULL,
    `vendor` VARCHAR(191) NOT NULL DEFAULT 'other',
    `deviceKey` VARCHAR(191) NOT NULL DEFAULT '',
    `label` VARCHAR(191) NOT NULL DEFAULT '',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `lastSyncAt` DATETIME(3) NULL,
    `notes` VARCHAR(191) NOT NULL DEFAULT '',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `hr_employee_capability_HotelName_idx` ON `hr_employee_capability`(`HotelName`);
CREATE INDEX `hr_employee_capability_employeeId_idx` ON `hr_employee_capability`(`employeeId`);
CREATE INDEX `hr_employee_capability_HotelName_code_active_idx` ON `hr_employee_capability`(`HotelName`, `code`, `active`);
CREATE UNIQUE INDEX `hr_employee_capability_HotelName_employeeId_code_key` ON `hr_employee_capability`(`HotelName`, `employeeId`, `code`);

CREATE INDEX `hr_otp_reset_request_HotelName_idx` ON `hr_otp_reset_request`(`HotelName`);
CREATE INDEX `hr_otp_reset_request_employeeId_idx` ON `hr_otp_reset_request`(`employeeId`);
CREATE INDEX `hr_otp_reset_request_HotelName_status_idx` ON `hr_otp_reset_request`(`HotelName`, `status`);

CREATE INDEX `hr_notification_HotelName_idx` ON `hr_notification`(`HotelName`);
CREATE INDEX `hr_notification_HotelName_recipientRole_idx` ON `hr_notification`(`HotelName`, `recipientRole`);
CREATE INDEX `hr_notification_employeeId_idx` ON `hr_notification`(`employeeId`);
CREATE INDEX `hr_notification_HotelName_createdAt_idx` ON `hr_notification`(`HotelName`, `createdAt`);

CREATE INDEX `hr_biometric_device_HotelName_idx` ON `hr_biometric_device`(`HotelName`);
CREATE UNIQUE INDEX `hr_biometric_device_HotelName_deviceKey_key` ON `hr_biometric_device`(`HotelName`, `deviceKey`);

-- AddForeignKey
ALTER TABLE `hr_employee_capability` ADD CONSTRAINT `hr_employee_capability_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `hr_employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `hr_otp_reset_request` ADD CONSTRAINT `hr_otp_reset_request_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `hr_employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
