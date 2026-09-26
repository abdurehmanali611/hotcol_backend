-- Manager-pending actions for F06 terminate, F12 attendance correction, F17 payroll generate
CREATE TABLE IF NOT EXISTS `hr_manager_pending_action` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `HotelName` VARCHAR(191) NOT NULL,
  `kind` VARCHAR(191) NOT NULL,
  `employeeId` INTEGER NULL,
  `payloadJson` JSON NULL,
  `requestedBy` VARCHAR(191) NOT NULL DEFAULT '',
  `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
  `decidedBy` VARCHAR(191) NOT NULL DEFAULT '',
  `decidedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `hr_manager_pending_action_HotelName_status_idx`(`HotelName`, `status`),
  INDEX `hr_manager_pending_action_HotelName_kind_idx`(`HotelName`, `kind`),
  INDEX `hr_manager_pending_action_employeeId_idx`(`employeeId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
