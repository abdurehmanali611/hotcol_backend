/**
 * Renames legacy departmentLeader rows from HOUSE_KEEPING → HOUSE_KEEPING_ROOM.
 *
 * Run from BackEnd:
 *   node scripts/migrate-housekeeping-department-leaders.js
 *   node scripts/migrate-housekeeping-department-leaders.js --dry-run
 */
import "dotenv/config";
import { createPrismaClient } from "../lib/prismaClient.js";
import {
  LEGACY_HOUSE_KEEPING_CODE,
  migrateLegacyHouseKeepingDepartmentLeaders,
} from "../lib/departmentLeaders.js";

const dryRun = process.argv.includes("--dry-run");
const prisma = createPrismaClient();

async function main() {
  const legacyRows = await prisma.departmentLeader.findMany({
    where: { department: LEGACY_HOUSE_KEEPING_CODE },
    select: { id: true, HotelName: true, leaderName: true },
  });

  if (legacyRows.length === 0) {
    console.log("No legacy HOUSE_KEEPING department leaders found.");
    return;
  }

  console.log(
    `Found ${legacyRows.length} legacy HOUSE_KEEPING leader row(s) to migrate.`,
  );

  if (dryRun) {
    for (const row of legacyRows) {
      console.log(
        `  [dry-run] ${row.HotelName}: "${row.leaderName}" → HOUSE_KEEPING_ROOM`,
      );
    }
    return;
  }

  const hotels = [...new Set(legacyRows.map((r) => r.HotelName))];
  let migrated = 0;
  for (const hotelName of hotels) {
    const result = await migrateLegacyHouseKeepingDepartmentLeaders(
      prisma,
      hotelName,
    );
    if (result.migrated) {
      migrated += 1;
      console.log(`  ${hotelName}: ${result.action}`);
    }
  }

  console.log(`Done. Migrated ${migrated} propert${migrated === 1 ? "y" : "ies"}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
