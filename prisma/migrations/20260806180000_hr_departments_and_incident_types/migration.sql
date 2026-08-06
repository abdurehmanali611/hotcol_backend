-- CreateTable
CREATE TABLE `hr_department` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `HotelName` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `hr_department_HotelName_idx`(`HotelName`),
    UNIQUE INDEX `hr_department_HotelName_code_key`(`HotelName`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hr_incident_type` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `HotelName` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `deduct` BOOLEAN NOT NULL DEFAULT false,
    `amountETB` DOUBLE NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `hr_incident_type_HotelName_idx`(`HotelName`),
    UNIQUE INDEX `hr_incident_type_HotelName_code_key`(`HotelName`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
