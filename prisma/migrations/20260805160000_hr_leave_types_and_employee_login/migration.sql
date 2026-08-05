-- CreateTable
CREATE TABLE `hr_leave_type` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `HotelName` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `paid` BOOLEAN NOT NULL DEFAULT true,
    `defaultDays` DOUBLE NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `hr_leave_type_HotelName_idx`(`HotelName`),
    UNIQUE INDEX `hr_leave_type_HotelName_code_key`(`HotelName`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `hr_employee_HotelName_credentialUserName_idx` ON `hr_employee`(`HotelName`, `credentialUserName`);
