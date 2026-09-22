/**
 * Non-destructive: lodging_receptionist table + business_day receptionist cols.
 *
 * Usage (from BackEnd):
 *   node scripts/safe_add_lodging_receptionist.mjs
 */
import { createPrismaClient } from "../lib/prismaClient.js";

const prisma = createPrismaClient();

async function columnExists(table, column) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}' AND COLUMN_NAME = '${column}'`,
  );
  return Number(rows?.[0]?.c || 0) > 0;
}

async function tableExists(table) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`,
  );
  return Number(rows?.[0]?.c || 0) > 0;
}

async function indexExists(name) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND INDEX_NAME = '${name}'`,
  );
  return Number(rows?.[0]?.c || 0) > 0;
}

async function main() {
  if (!(await tableExists("lodging_receptionist"))) {
    console.log("Creating lodging_receptionist…");
    await prisma.$executeRawUnsafe(`
      CREATE TABLE lodging_receptionist (
        id INT NOT NULL AUTO_INCREMENT,
        HotelName VARCHAR(191) NOT NULL,
        firstName VARCHAR(191) NOT NULL,
        lastName VARCHAR(191) NOT NULL,
        passwordHash VARCHAR(255) NOT NULL,
        isActive BOOLEAN NOT NULL DEFAULT TRUE,
        createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updatedAt DATETIME(3) NOT NULL,
        updatedBy VARCHAR(191) NOT NULL DEFAULT '',
        PRIMARY KEY (id),
        INDEX lodging_receptionist_HotelName_idx (HotelName),
        INDEX lodging_receptionist_HotelName_isActive_idx (HotelName, isActive)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  } else {
    console.log("lodging_receptionist already exists");
  }

  if (!(await columnExists("lodging_business_day", "receptionistId"))) {
    console.log("Adding receptionistId…");
    await prisma.$executeRawUnsafe(
      `ALTER TABLE lodging_business_day ADD COLUMN receptionistId INT NULL`,
    );
  } else {
    console.log("receptionistId already exists");
  }
  if (!(await columnExists("lodging_business_day", "receptionistName"))) {
    console.log("Adding receptionistName…");
    await prisma.$executeRawUnsafe(
      `ALTER TABLE lodging_business_day ADD COLUMN receptionistName VARCHAR(191) NOT NULL DEFAULT ''`,
    );
  } else {
    console.log("receptionistName already exists");
  }
  if (!(await indexExists("lodging_business_day_HotelName_receptionistId_idx"))) {
    console.log("Adding receptionistId index…");
    await prisma.$executeRawUnsafe(`
      CREATE INDEX lodging_business_day_HotelName_receptionistId_idx
      ON lodging_business_day (HotelName, receptionistId)
    `);
  } else {
    console.log("receptionistId index already exists");
  }

  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
