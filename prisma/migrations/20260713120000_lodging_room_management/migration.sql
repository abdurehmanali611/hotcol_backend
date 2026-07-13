-- Lodging Room Management + Cleaning & Maintenance
CREATE TABLE `lodging_room` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `HotelName` VARCHAR(191) NOT NULL,
    `roomNumber` VARCHAR(191) NOT NULL,
    `roomType` VARCHAR(191) NOT NULL,
    `floor` VARCHAR(191) NOT NULL DEFAULT '',
    `pricePerNightETB` DOUBLE NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'vacant_clean',
    `maintenanceUntil` DATETIME(3) NULL,
    `notes` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NOT NULL DEFAULT '',
    `updatedBy` VARCHAR(191) NOT NULL DEFAULT '',

    INDEX `lodging_room_HotelName_idx`(`HotelName`),
    INDEX `lodging_room_HotelName_status_idx`(`HotelName`, `status`),
    INDEX `lodging_room_HotelName_roomType_idx`(`HotelName`, `roomType`),
    UNIQUE INDEX `lodging_room_HotelName_roomNumber_key`(`HotelName`, `roomNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `lodging_guest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `HotelName` VARCHAR(191) NOT NULL,
    `firstName` VARCHAR(191) NOT NULL,
    `lastName` VARCHAR(191) NOT NULL,
    `sex` VARCHAR(191) NOT NULL DEFAULT '',
    `phone` VARCHAR(191) NOT NULL,
    `phoneSecondary` VARCHAR(191) NOT NULL DEFAULT '',
    `email` VARCHAR(191) NOT NULL DEFAULT '',
    `isEthiopian` BOOLEAN NOT NULL DEFAULT true,
    `nationalId` VARCHAR(191) NOT NULL DEFAULT '',
    `passportNumber` VARCHAR(191) NOT NULL DEFAULT '',
    `country` VARCHAR(191) NOT NULL DEFAULT 'Ethiopia',
    `stateRegion` VARCHAR(191) NOT NULL DEFAULT '',
    `addressLine` VARCHAR(191) NOT NULL DEFAULT '',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `lodging_guest_HotelName_idx`(`HotelName`),
    INDEX `lodging_guest_HotelName_phone_idx`(`HotelName`, `phone`),
    INDEX `lodging_guest_HotelName_nationalId_idx`(`HotelName`, `nationalId`),
    INDEX `lodging_guest_HotelName_passportNumber_idx`(`HotelName`, `passportNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `lodging_stay` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `HotelName` VARCHAR(191) NOT NULL,
    `voucherCode` VARCHAR(191) NOT NULL,
    `guestId` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'checked_in',
    `arrivalAt` DATETIME(3) NOT NULL,
    `departureAt` DATETIME(3) NOT NULL,
    `nights` INTEGER NOT NULL DEFAULT 1,
    `adults` INTEGER NOT NULL DEFAULT 1,
    `children` INTEGER NOT NULL DEFAULT 0,
    `preferredRoomType` VARCHAR(191) NOT NULL DEFAULT '',
    `notes` TEXT NOT NULL,
    `checkedInBy` VARCHAR(191) NOT NULL DEFAULT '',
    `checkedOutBy` VARCHAR(191) NOT NULL DEFAULT '',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `lodging_stay_HotelName_idx`(`HotelName`),
    INDEX `lodging_stay_HotelName_status_idx`(`HotelName`, `status`),
    INDEX `lodging_stay_guestId_idx`(`guestId`),
    INDEX `lodging_stay_arrivalAt_idx`(`arrivalAt`),
    INDEX `lodging_stay_departureAt_idx`(`departureAt`),
    UNIQUE INDEX `lodging_stay_HotelName_voucherCode_key`(`HotelName`, `voucherCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `lodging_stay_room` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `stayId` INTEGER NOT NULL,
    `roomId` INTEGER NOT NULL,
    `roomType` VARCHAR(191) NOT NULL DEFAULT '',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `lodging_stay_room_roomId_idx`(`roomId`),
    UNIQUE INDEX `lodging_stay_room_stayId_roomId_key`(`stayId`, `roomId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `lodging_bill` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `HotelName` VARCHAR(191) NOT NULL,
    `stayId` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'open',
    `totalETB` DOUBLE NOT NULL DEFAULT 0,
    `settledAt` DATETIME(3) NULL,
    `settledBy` VARCHAR(191) NOT NULL DEFAULT '',
    `receiptNumber` VARCHAR(191) NOT NULL DEFAULT '',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `lodging_bill_stayId_key`(`stayId`),
    INDEX `lodging_bill_HotelName_idx`(`HotelName`),
    INDEX `lodging_bill_HotelName_status_idx`(`HotelName`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `lodging_bill_line` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `billId` INTEGER NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `quantity` DOUBLE NOT NULL DEFAULT 1,
    `unitPriceETB` DOUBLE NOT NULL DEFAULT 0,
    `amountETB` DOUBLE NOT NULL DEFAULT 0,
    `roomNumber` VARCHAR(191) NOT NULL DEFAULT '',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdBy` VARCHAR(191) NOT NULL DEFAULT '',

    INDEX `lodging_bill_line_billId_idx`(`billId`),
    INDEX `lodging_bill_line_kind_idx`(`kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `lodging_service_item` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `HotelName` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `unitPriceETB` DOUBLE NOT NULL DEFAULT 0,
    `unitLabel` VARCHAR(191) NOT NULL DEFAULT 'pcs',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `lodging_service_item_HotelName_idx`(`HotelName`),
    INDEX `lodging_service_item_HotelName_kind_idx`(`HotelName`, `kind`),
    UNIQUE INDEX `lodging_service_item_HotelName_kind_name_key`(`HotelName`, `kind`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `lodging_cm_assignment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `HotelName` VARCHAR(191) NOT NULL,
    `roomId` INTEGER NOT NULL,
    `workKind` VARCHAR(191) NOT NULL,
    `assigneeName` VARCHAR(191) NOT NULL,
    `notes` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'open',
    `assignedBy` VARCHAR(191) NOT NULL DEFAULT '',
    `completedBy` VARCHAR(191) NOT NULL DEFAULT '',
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `lodging_cm_assignment_HotelName_idx`(`HotelName`),
    INDEX `lodging_cm_assignment_HotelName_status_idx`(`HotelName`, `status`),
    INDEX `lodging_cm_assignment_roomId_idx`(`roomId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `lodging_action_log` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `HotelName` VARCHAR(191) NOT NULL,
    `actorRole` VARCHAR(191) NOT NULL DEFAULT '',
    `actorName` VARCHAR(191) NOT NULL DEFAULT '',
    `action` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NOT NULL DEFAULT '',
    `entityId` INTEGER NULL,
    `stayId` INTEGER NULL,
    `detailJson` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `lodging_action_log_HotelName_idx`(`HotelName`),
    INDEX `lodging_action_log_HotelName_createdAt_idx`(`HotelName`, `createdAt`),
    INDEX `lodging_action_log_stayId_idx`(`stayId`),
    INDEX `lodging_action_log_actorName_idx`(`actorName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `lodging_stay` ADD CONSTRAINT `lodging_stay_guestId_fkey` FOREIGN KEY (`guestId`) REFERENCES `lodging_guest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `lodging_stay_room` ADD CONSTRAINT `lodging_stay_room_stayId_fkey` FOREIGN KEY (`stayId`) REFERENCES `lodging_stay`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `lodging_stay_room` ADD CONSTRAINT `lodging_stay_room_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `lodging_room`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `lodging_bill` ADD CONSTRAINT `lodging_bill_stayId_fkey` FOREIGN KEY (`stayId`) REFERENCES `lodging_stay`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `lodging_bill_line` ADD CONSTRAINT `lodging_bill_line_billId_fkey` FOREIGN KEY (`billId`) REFERENCES `lodging_bill`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `lodging_cm_assignment` ADD CONSTRAINT `lodging_cm_assignment_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `lodging_room`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `lodging_action_log` ADD CONSTRAINT `lodging_action_log_stayId_fkey` FOREIGN KEY (`stayId`) REFERENCES `lodging_stay`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

