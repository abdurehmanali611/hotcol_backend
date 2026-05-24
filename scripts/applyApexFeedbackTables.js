/**
 * Create apex feedback tables if missing.
 * Run: node scripts/applyApexFeedbackTables.js
 */
import { PrismaClient } from "../generated/prisma/index.js";

const prisma = new PrismaClient();

async function tableExists(name) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    name,
  );
  return Number(rows[0]?.c ?? 0) > 0;
}

async function columnExists(table, column) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    table,
    column,
  );
  return Number(rows[0]?.c ?? 0) > 0;
}

async function main() {
  if (!(await tableExists("apex_team_member"))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE \`apex_team_member\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`UserName\` VARCHAR(191) NOT NULL,
        \`Password\` VARCHAR(191) NOT NULL,
        \`displayName\` VARCHAR(191) NULL,
        \`role\` VARCHAR(191) NOT NULL DEFAULT 'support',
        \`isActive\` BOOLEAN NOT NULL DEFAULT true,
        \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`apex_team_member_UserName_key\` (\`UserName\`)
      )
    `);
    console.log("[create] apex_team_member");
  }

  if (!(await tableExists("tenant_feedback_thread"))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE \`tenant_feedback_thread\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`tinNumber\` VARCHAR(191) NOT NULL,
        \`hotelDisplayName\` VARCHAR(191) NOT NULL,
        \`businessType\` VARCHAR(191) NULL,
        \`status\` VARCHAR(191) NOT NULL DEFAULT 'open',
        \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`tenant_feedback_thread_tinNumber_key\` (\`tinNumber\`),
        INDEX \`tenant_feedback_thread_status_idx\` (\`status\`),
        INDEX \`tenant_feedback_thread_updatedAt_idx\` (\`updatedAt\`)
      )
    `);
    console.log("[create] tenant_feedback_thread");
  }

  if (!(await tableExists("tenant_feedback_message"))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE \`tenant_feedback_message\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`threadId\` INT NOT NULL,
        \`senderSide\` VARCHAR(191) NOT NULL,
        \`tenantUserId\` INT NULL,
        \`tenantUserName\` VARCHAR(191) NULL,
        \`tenantRole\` VARCHAR(191) NULL,
        \`apexMemberId\` INT NULL,
        \`apexDisplayName\` VARCHAR(191) NULL,
        \`body\` TEXT NOT NULL,
        \`imageUrl\` VARCHAR(2048) NULL,
        \`readByTenant\` BOOLEAN NOT NULL DEFAULT false,
        \`readByApex\` BOOLEAN NOT NULL DEFAULT false,
        \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        INDEX \`tenant_feedback_message_threadId_idx\` (\`threadId\`),
        INDEX \`tenant_feedback_message_createdAt_idx\` (\`createdAt\`),
        CONSTRAINT \`tenant_feedback_message_threadId_fkey\`
          FOREIGN KEY (\`threadId\`) REFERENCES \`tenant_feedback_thread\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT \`tenant_feedback_message_apexMemberId_fkey\`
          FOREIGN KEY (\`apexMemberId\`) REFERENCES \`apex_team_member\`(\`id\`) ON DELETE SET NULL ON UPDATE CASCADE
      )
    `);
    console.log("[create] tenant_feedback_message");
  }

  if (
    (await tableExists("tenant_feedback_message")) &&
    !(await columnExists("tenant_feedback_message", "imageUrl"))
  ) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE \`tenant_feedback_message\`
        ADD COLUMN \`imageUrl\` VARCHAR(2048) NULL AFTER \`body\`
    `);
    console.log("[alter] tenant_feedback_message.imageUrl");
  }

  console.log("Apex feedback tables ready.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
