/**
 * HARD SAFETY: deletes inventory demo data ONLY for illustration tenants
 * (Apex Cafe and Restaurant, ApexAnalog cafe and restaurant, Apex Hotel,
 * ApexAnalog Hotel — including their TIN HotelName keys).
 *
 *   node scripts/reset-illustration-tenant-inventory-data.mjs --dry-run
 *   node scripts/reset-illustration-tenant-inventory-data.mjs --confirm
 *
 * Resets:
 * - ItemRegistration
 * - ItemStatus (stock movement)
 * - PurchaseRequest
 * - StockOutRequest
 * - StationIngredientStock
 * - RecipeStockConsumption
 * - Item.recipeJson → empty ingredients (menu rows kept)
 */
import { createPrismaClient } from "../lib/prismaClient.js";

async function countItemsWithRecipe(prisma, hotelIn) {
  const items = await prisma.item.findMany({
    where: hotelIn,
    select: { recipeJson: true },
  });
  return items.filter((item) => item.recipeJson != null).length;
}

const ILLUSTRATION_DISPLAY = [
  "apex cafe and restaurant",
  "apexanalog cafe and restaurant",
  "apex hotel",
  "apexanalog hotel",
];

const ILLUSTRATION_TINS = [
  "4DtJvzSwGnYL",
  "TIN_1aZAQVXx3q79FkCk",
  "TIN_lXhLoXQVfEOXUVez",
  "TIN_ScxemuziHnkICOoz",
];

function normalizeDisplay(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run"),
    confirm: argv.includes("--confirm"),
  };
}

async function resolveIllustrationKeys(prisma) {
  const users = await prisma.user.findMany({
    select: { HotelName: true, tinNumber: true, isIllustrationTenant: true },
  });

  /** @type {Set<string>} */
  const keys = new Set();

  for (const tin of ILLUSTRATION_TINS) keys.add(tin);

  for (const u of users) {
    const display = normalizeDisplay(u.HotelName);
    const tin = String(u.tinNumber || "").trim();
    const named = ILLUSTRATION_DISPLAY.includes(display);
    const tinHit = tin && ILLUSTRATION_TINS.includes(tin);
    if (u.isIllustrationTenant === true || named || tinHit) {
      if (u.HotelName) {
        keys.add(u.HotelName);
        keys.add(normalizeDisplay(u.HotelName));
      }
      if (tin) keys.add(tin);
    }
  }

  // Always include canonical display strings
  for (const n of ILLUSTRATION_DISPLAY) keys.add(n);

  return [...keys].filter(Boolean);
}

async function countScoped(prisma, keys) {
  const hotelIn = { HotelName: { in: keys } };
  const [
    itemRegistration,
    itemStatus,
    purchaseRequest,
    stockOutRequest,
    stationIngredientStock,
    recipeStockConsumption,
    itemsWithRecipe,
  ] = await Promise.all([
    prisma.itemRegistration.count({ where: hotelIn }),
    prisma.itemStatus.count({ where: hotelIn }),
    prisma.purchaseRequest.count({ where: hotelIn }),
    prisma.stockOutRequest.count({ where: hotelIn }),
    prisma.stationIngredientStock.count({ where: hotelIn }),
    prisma.recipeStockConsumption.count({ where: hotelIn }),
    countItemsWithRecipe(prisma, hotelIn),
  ]);
  return {
    itemRegistration,
    itemStatus,
    purchaseRequest,
    stockOutRequest,
    stationIngredientStock,
    recipeStockConsumption,
    itemsWithRecipe,
  };
}

async function main() {
  const { dryRun, confirm } = parseArgs(process.argv.slice(2));
  if (!dryRun && !confirm) {
    console.error(
      "Refusing to run. Pass --dry-run (preview) or --confirm (execute deletes).",
    );
    process.exit(1);
  }

  const prisma = createPrismaClient();
  try {
    const keys = await resolveIllustrationKeys(prisma);
    console.log("Illustration HotelName keys in scope:");
    for (const k of keys) console.log(" -", k);

    // Safety: never allow empty key list
    if (keys.length === 0) {
      throw new Error("No illustration keys resolved — aborting");
    }

    // Safety: refuse if a key looks like it could be a real tenant brand without Apex
    for (const k of keys) {
      const n = normalizeDisplay(k);
      const ok =
        ILLUSTRATION_TINS.includes(k) ||
        ILLUSTRATION_DISPLAY.includes(n) ||
        n.includes("apex");
      if (!ok) {
        throw new Error(
          `Refusing unexpected key outside Apex illustration set: ${k}`,
        );
      }
    }

    const before = await countScoped(prisma, keys);
    console.log("\nCounts BEFORE:", before);

    if (dryRun) {
      console.log("\nDry run only — no deletes performed.");
      return;
    }

    const hotelIn = { HotelName: { in: keys } };

    const deleted = {
      recipeStockConsumption: (
        await prisma.recipeStockConsumption.deleteMany({ where: hotelIn })
      ).count,
      stationIngredientStock: (
        await prisma.stationIngredientStock.deleteMany({ where: hotelIn })
      ).count,
      stockOutRequest: (
        await prisma.stockOutRequest.deleteMany({ where: hotelIn })
      ).count,
      itemStatus: (await prisma.itemStatus.deleteMany({ where: hotelIn })).count,
      purchaseRequest: (
        await prisma.purchaseRequest.deleteMany({ where: hotelIn })
      ).count,
      itemRegistration: (
        await prisma.itemRegistration.deleteMany({ where: hotelIn })
      ).count,
    };

    // Clear recipe ingredients on menu items (keep menu rows)
    const items = await prisma.item.findMany({
      where: hotelIn,
      select: { id: true, recipeJson: true },
    });
    let recipesCleared = 0;
    for (const item of items) {
      if (item.recipeJson == null) continue;
      await prisma.item.update({
        where: { id: item.id },
        data: { recipeJson: { ingredients: [] } },
      });
      recipesCleared += 1;
    }
    deleted.recipesCleared = recipesCleared;

    const after = await countScoped(prisma, keys);
    console.log("\nDeleted:", deleted);
    console.log("Counts AFTER:", after);
    console.log("\nDone. Only illustration tenant keys were touched.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
