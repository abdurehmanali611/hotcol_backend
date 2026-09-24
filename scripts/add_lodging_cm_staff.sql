-- Add CM cleaner/maintainer roster (MySQL).
-- Safe to re-run: creates table only if missing.

CREATE TABLE IF NOT EXISTS `lodging_cm_staff` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `HotelName` VARCHAR(191) NOT NULL,
  `role` VARCHAR(191) NOT NULL,
  `firstName` VARCHAR(191) NOT NULL,
  `lastName` VARCHAR(191) NOT NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `updatedBy` VARCHAR(191) NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  UNIQUE INDEX `lodging_cm_staff_HotelName_role_firstName_lastName_key` (`HotelName`, `role`, `firstName`, `lastName`),
  INDEX `lodging_cm_staff_HotelName_idx` (`HotelName`),
  INDEX `lodging_cm_staff_HotelName_role_idx` (`HotelName`, `role`),
  INDEX `lodging_cm_staff_HotelName_role_isActive_idx` (`HotelName`, `role`, `isActive`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
