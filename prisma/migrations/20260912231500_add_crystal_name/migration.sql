-- CreateTable
CREATE TABLE `crystal_name` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `amharic` VARCHAR(255) NOT NULL,
    `romanized` VARCHAR(255) NOT NULL,
    `english` VARCHAR(255) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `crystal_name_amharic_idx`(`amharic`),
    INDEX `crystal_name_romanized_idx`(`romanized`),
    INDEX `crystal_name_english_idx`(`english`),
    UNIQUE INDEX `crystal_name_triple_unique`(`amharic`, `romanized`, `english`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
