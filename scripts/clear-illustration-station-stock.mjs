/**
 * Clear StationIngredientStock for illustration tenants only.
 * Keeps ItemRegistration (store) and recipes — cashier should block
 * until stock is moved to Kitchen/Bar via stock-out.
 *
 *   node scripts/clear-illustration-station-stock.mjs --dry-run
 *   node scripts/clear-illustration-station-stock.mjs --confirm
 */
import { createPrismaClient } from "../lib/prismaClient.js";

const ILLUSTRATION_KEYS = [
  "4DtJvzSwGnYL",
  "TIN_lXhLoXQVfEOXUVez",
  "TIN_1aZAQVXx3q79FkCk",
  "TIN_ScxemuziHnkICOoz",
  "Apex Cafe and Restaurant",
  "apex cafe and restaurant",
  "ApexAnalog cafe and restaurant",
  "apexanalog cafe and restaurant",
  "Apex Hotel",
  "apex hotel",
  "ApexAnalog Hotel",
  "apexanalog hotel",
];

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run"),
    confirm: argv.includes("--confirm"),
  };
}

async function main() {
  const { dryRun, confirm } = parseArgs(process.argv.slice(2));
  if (!dryRun && !confirm) {
    console.error("Pass --dry-run or --confirm");
    process.exit(1);
  }

  const prisma = createPrismaClient();
  try {
    const where = { HotelName: { in: ILLUSTRATION_KEYS } };
    const before = await prisma.stationIngredientStock.count({ where });
    console.log("StationIngredientStock rows in scope:", before);

    if (dryRun) {
      console.log("Dry run only — nothing deleted.");
      return;
    }

    const deleted = await prisma.stationIngredientStock.deleteMany({ where });
    console.log("Deleted:", deleted.count);
    console.log(
      "Store registrations + recipes kept. Ordering should block until Kitchen/Bar stock-out.",
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
