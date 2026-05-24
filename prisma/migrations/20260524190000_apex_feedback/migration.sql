CREATE TABLE IF NOT EXISTS `apex_team_member` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `UserName` VARCHAR(191) NOT NULL,
  `Password` VARCHAR(191) NOT NULL,
  `displayName` VARCHAR(191) NULL,
  `role` VARCHAR(191) NOT NULL DEFAULT 'support',
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `apex_team_member_UserName_key` (`UserName`)
);

CREATE TABLE IF NOT EXISTS `tenant_feedback_thread` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `tinNumber` VARCHAR(191) NOT NULL,
  `hotelDisplayName` VARCHAR(191) NOT NULL,
  `businessType` VARCHAR(191) NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'open',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `tenant_feedback_thread_tinNumber_key` (`tinNumber`),
  INDEX `tenant_feedback_thread_status_idx` (`status`),
  INDEX `tenant_feedback_thread_updatedAt_idx` (`updatedAt`)
);

CREATE TABLE IF NOT EXISTS `tenant_feedback_message` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `threadId` INT NOT NULL,
  `senderSide` VARCHAR(191) NOT NULL,
  `tenantUserId` INT NULL,
  `tenantUserName` VARCHAR(191) NULL,
  `tenantRole` VARCHAR(191) NULL,
  `apexMemberId` INT NULL,
  `apexDisplayName` VARCHAR(191) NULL,
  `body` TEXT NOT NULL,
  `imageUrl` VARCHAR(2048) NULL,
  `readByTenant` BOOLEAN NOT NULL DEFAULT false,
  `readByApex` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `tenant_feedback_message_threadId_idx` (`threadId`),
  INDEX `tenant_feedback_message_createdAt_idx` (`createdAt`),
  CONSTRAINT `tenant_feedback_message_threadId_fkey`
    FOREIGN KEY (`threadId`) REFERENCES `tenant_feedback_thread`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `tenant_feedback_message_apexMemberId_fkey`
    FOREIGN KEY (`apexMemberId`) REFERENCES `apex_team_member`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
);
