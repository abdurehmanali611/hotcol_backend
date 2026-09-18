/**
 * HARD SAFETY: wipe inventory workflow data ONLY for Shambalala International
 * Hotel — TIN 0045905798. Refuses any other tenant key.
 *
 * From BackEnd/:
 *   node scripts/reset-shambalala-inventory-data.mjs --dry-run
 *   node scripts/reset-shambalala-inventory-data.mjs --confirm
 *
 * Deletes (HotelName scoped to resolved keys for this TIN only):
 *   RecipeStockConsumption, StationIngredientStock, FreshBazaar,
 *   ItemStatus, StockOutRequest, PurchaseRequest, ItemRegistration,
 *   KitchenBarBeginning, KitchenBarMonthlySnapshot, HotelVoucherCounter
 *
 * Does NOT touch: users, orders, menu items, credit, lodging, other tenants.
 */
import { createPrismaClient } from "../lib/prismaClient.js";

const TARGET_TIN = "0045905798";
const EXPECTED_NAME_FRAGMENT = "shambalala";

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run"),
    confirm: argv.includes("--confirm"),
  };
}

function norm(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function looksLikeTin(value) {
  const v = String(value || "").trim();
  return /^\d{10}$/.test(v) || /^TIN_/i.test(v);
}

async function resolveTargetKeys(prisma) {
  const users = await prisma.user.findMany({
    where: { tinNumber: TARGET_TIN },
    select: {
      id: true,
      UserName: true,
      Role: true,
      HotelName: true,
      tinNumber: true,
    },
  });

  if (users.length === 0) {
    throw new Error(
      `No user rows found with tinNumber=${TARGET_TIN}. Aborting.`,
    );
  }

  const displayNames = [
    ...new Set(
      users
        .map((u) => String(u.HotelName || "").trim())
        .filter(Boolean),
    ),
  ];

  const nameHit = displayNames.some((n) =>
    norm(n).includes(EXPECTED_NAME_FRAGMENT),
  );
  if (!nameHit) {
    throw new Error(
      `TIN ${TARGET_TIN} users exist but HotelName does not include "${EXPECTED_NAME_FRAGMENT}". ` +
        `Found displays: ${displayNames.join(" | ") || "(empty)"}. Aborting.`,
    );
  }

  /** @type {Set<string>} */
  const keys = new Set([TARGET_TIN]);
  for (const n of displayNames) {
    keys.add(n);
    // Legacy rows sometimes stored normalized / alternate casing.
    keys.add(norm(n));
  }

  // Discover any inventory HotelName values that equal this TIN or its displays
  // (already covered) — do NOT broaden to unrelated keys.
  const candidateKeys = [...keys].filter(Boolean);

  // Safety: no other tenant may own any of these keys as their tinNumber
  // (except TARGET_TIN itself).
  const foreignOwners = await prisma.user.findMany({
    where: {
      AND: [
        { tinNumber: { not: TARGET_TIN } },
        {
          OR: [
            { tinNumber: { in: candidateKeys } },
            { HotelName: { in: candidateKeys } },
          ],
        },
      ],
    },
    select: { id: true, HotelName: true, tinNumber: true },
    take: 20,
  });

  // HotelName collision across tenants is common for brand strings in theory;
  // if another tenant's tinNumber equals one of our keys, that is fatal.
  const foreignTinCollision = foreignOwners.filter((u) =>
    candidateKeys.includes(String(u.tinNumber || "").trim()),
  );
  if (foreignTinCollision.length > 0) {
    throw new Error(
      `Refusing: another tenant's tinNumber collides with target keys: ${JSON.stringify(foreignTinCollision)}`,
    );
  }

  // If another tenant uses the same display HotelName, only delete rows keyed
  // by TARGET_TIN — never by shared display name.
  const sharedDisplayUsers = foreignOwners.filter((u) => {
    const hn = String(u.HotelName || "").trim();
    return displayNames.includes(hn) || displayNames.map(norm).includes(norm(hn));
  });

  let safeKeys;
  if (sharedDisplayUsers.length > 0) {
    console.warn(
      "WARNING: display HotelName is shared with other tenants. " +
        "Scoping deletes to TIN key only:",
      TARGET_TIN,
    );
    console.warn(
      "Other tenants sharing display:",
      sharedDisplayUsers.map((u) => ({
        id: u.id,
        HotelName: u.HotelName,
        tinNumber: u.tinNumber,
      })),
    );
    safeKeys = [TARGET_TIN];
  } else {
    safeKeys = candidateKeys;
  }

  // Final hard gate: every key must be TARGET_TIN or one of this tenant's displays.
  for (const k of safeKeys) {
    const isTargetTin = k === TARGET_TIN;
    const isDisplay =
      displayNames.includes(k) || displayNames.map(norm).includes(norm(k));
    if (!isTargetTin && !isDisplay) {
      throw new Error(`Refusing unexpected key outside target tenant: ${k}`);
    }
    // Never allow a different 10-digit TIN into the key list.
    if (looksLikeTin(k) && k !== TARGET_TIN) {
      throw new Error(`Refusing foreign TIN-like key: ${k}`);
    }
  }

  if (safeKeys.length === 0) {
    throw new Error("No safe HotelName keys resolved — aborting");
  }

  return {
    users,
    displayNames,
    keys: safeKeys,
    scopedToTinOnly: sharedDisplayUsers.length > 0,
  };
}

async function countScoped(prisma, keys) {
  const hotelIn = { HotelName: { in: keys } };
  const [
    recipeStockConsumption,
    stationIngredientStock,
    freshBazaar,
    itemStatus,
    stockOutRequest,
    purchaseRequest,
    itemRegistration,
    kitchenBarBeginning,
    kitchenBarMonthlySnapshot,
    hotelVoucherCounter,
  ] = await Promise.all([
    prisma.recipeStockConsumption.count({ where: hotelIn }),
    prisma.stationIngredientStock.count({ where: hotelIn }),
    prisma.freshBazaar.count({ where: hotelIn }),
    prisma.itemStatus.count({ where: hotelIn }),
    prisma.stockOutRequest.count({ where: hotelIn }),
    prisma.purchaseRequest.count({ where: hotelIn }),
    prisma.itemRegistration.count({ where: hotelIn }),
    prisma.kitchenBarBeginning.count({ where: hotelIn }),
    prisma.kitchenBarMonthlySnapshot.count({ where: hotelIn }),
    prisma.hotelVoucherCounter.count({ where: hotelIn }),
  ]);
  return {
    recipeStockConsumption,
    stationIngredientStock,
    freshBazaar,
    itemStatus,
    stockOutRequest,
    purchaseRequest,
    itemRegistration,
    kitchenBarBeginning,
    kitchenBarMonthlySnapshot,
    hotelVoucherCounter,
  };
}

async function countGlobal(prisma) {
  const [
    recipeStockConsumption,
    stationIngredientStock,
    freshBazaar,
    itemStatus,
    stockOutRequest,
    purchaseRequest,
    itemRegistration,
    kitchenBarBeginning,
    kitchenBarMonthlySnapshot,
    hotelVoucherCounter,
  ] = await Promise.all([
    prisma.recipeStockConsumption.count(),
    prisma.stationIngredientStock.count(),
    prisma.freshBazaar.count(),
    prisma.itemStatus.count(),
    prisma.stockOutRequest.count(),
    prisma.purchaseRequest.count(),
    prisma.itemRegistration.count(),
    prisma.kitchenBarBeginning.count(),
    prisma.kitchenBarMonthlySnapshot.count(),
    prisma.hotelVoucherCounter.count(),
  ]);
  return {
    recipeStockConsumption,
    stationIngredientStock,
    freshBazaar,
    itemStatus,
    stockOutRequest,
    purchaseRequest,
    itemRegistration,
    kitchenBarBeginning,
    kitchenBarMonthlySnapshot,
    hotelVoucherCounter,
  };
}

function assertGlobalDelta(beforeGlobal, afterGlobal, beforeScoped) {
  for (const key of Object.keys(beforeScoped)) {
    const expected = beforeGlobal[key] - beforeScoped[key];
    const actual = afterGlobal[key];
    if (actual !== expected) {
      throw new Error(
        `SAFETY FAIL on ${key}: expected remaining ${expected}, got ${actual}. ` +
          `Other tenants may have been affected — investigate immediately.`,
      );
    }
  }
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
    const resolved = await resolveTargetKeys(prisma);
    console.log(`Target TIN: ${TARGET_TIN}`);
    console.log("Users for this TIN:");
    for (const u of resolved.users) {
      console.log(
        ` - id=${u.id} role=${u.Role} user=${u.UserName} HotelName=${u.HotelName} tin=${u.tinNumber}`,
      );
    }
    console.log("Display names:", resolved.displayNames);
    console.log(
      resolved.scopedToTinOnly
        ? "HotelName keys in scope (TIN only — display shared):"
        : "HotelName keys in scope:",
    );
    for (const k of resolved.keys) console.log(" -", k);

    const beforeScoped = await countScoped(prisma, resolved.keys);
    const beforeGlobal = await countGlobal(prisma);
    console.log("\nCounts BEFORE (scoped):", beforeScoped);
    console.log("Counts BEFORE (global):", beforeGlobal);

    if (dryRun) {
      console.log("\nDry run only — no deletes performed.");
      return;
    }

    const hotelIn = { HotelName: { in: resolved.keys } };

    const deleted = {
      recipeStockConsumption: (
        await prisma.recipeStockConsumption.deleteMany({ where: hotelIn })
      ).count,
      stationIngredientStock: (
        await prisma.stationIngredientStock.deleteMany({ where: hotelIn })
      ).count,
      freshBazaar: (await prisma.freshBazaar.deleteMany({ where: hotelIn }))
        .count,
      itemStatus: (await prisma.itemStatus.deleteMany({ where: hotelIn })).count,
      stockOutRequest: (
        await prisma.stockOutRequest.deleteMany({ where: hotelIn })
      ).count,
      purchaseRequest: (
        await prisma.purchaseRequest.deleteMany({ where: hotelIn })
      ).count,
      itemRegistration: (
        await prisma.itemRegistration.deleteMany({ where: hotelIn })
      ).count,
      kitchenBarBeginning: (
        await prisma.kitchenBarBeginning.deleteMany({ where: hotelIn })
      ).count,
      kitchenBarMonthlySnapshot: (
        await prisma.kitchenBarMonthlySnapshot.deleteMany({ where: hotelIn })
      ).count,
      hotelVoucherCounter: (
        await prisma.hotelVoucherCounter.deleteMany({ where: hotelIn })
      ).count,
    };

    const afterScoped = await countScoped(prisma, resolved.keys);
    const afterGlobal = await countGlobal(prisma);

    assertGlobalDelta(beforeGlobal, afterGlobal, beforeScoped);

    console.log("\nDeleted:", deleted);
    console.log("Counts AFTER (scoped):", afterScoped);
    console.log("Counts AFTER (global):", afterGlobal);
    console.log(
      `\nDone. Only HotelName keys for TIN ${TARGET_TIN} were touched.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
