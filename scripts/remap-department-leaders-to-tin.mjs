import { createPrismaClient } from "../lib/prismaClient.js";

/**
 * Remap DepartmentLeader.HotelName from display business name → TIN so
 * registry reads stay tenant-isolated (display names are not unique).
 *
 * Safe rules:
 * - Only remaps when exactly one Admin/Manager TIN owns that display name.
 * - If TIN already has the department row, deletes the display-keyed duplicate.
 * - Shared brand names across TINs are left alone (logged) — managers re-save.
 *
 * Usage:
 *   node scripts/remap-department-leaders-to-tin.mjs
 *   node scripts/remap-department-leaders-to-tin.mjs --apply
 */
const apply = process.argv.includes("--apply");
const prisma = createPrismaClient();

function norm(v) {
  return String(v ?? "").trim();
}

try {
  const owners = await prisma.user.findMany({
    where: { Role: { in: ["Admin", "Manager"] } },
    select: { id: true, HotelName: true, tinNumber: true },
  });

  /** @type {Map<string, Set<string>>} display → set of TINs */
  const displayToTins = new Map();
  /** @type {Map<string, string>} tin → display */
  const tinToDisplay = new Map();

  for (const u of owners) {
    const tin = norm(u.tinNumber);
    const display = norm(u.HotelName);
    if (!tin || !display || tin === display) continue;
    tinToDisplay.set(tin, display);
    if (!displayToTins.has(display)) displayToTins.set(display, new Set());
    displayToTins.get(display).add(tin);
  }

  const leaderKeys = await prisma.departmentLeader.findMany({
    select: { HotelName: true },
    distinct: ["HotelName"],
  });

  let remapped = 0;
  let deletedDup = 0;
  let skippedCollision = 0;
  let skippedUnknown = 0;

    for (const { HotelName: key } of leaderKeys) {
    const hotelKey = norm(key);
    if (!hotelKey) continue;

    // Already a TIN key used by an owner — leave alone.
    if (tinToDisplay.has(hotelKey)) continue;

    const tins = displayToTins.get(hotelKey);
    if (!tins || tins.size === 0) {
      skippedUnknown += 1;
      console.log(`[skip-unknown] DepartmentLeader.HotelName=${JSON.stringify(hotelKey)}`);
      continue;
    }
    if (tins.size > 1) {
      skippedCollision += 1;
      console.log(
        `[skip-collision] display=${JSON.stringify(hotelKey)} tins=${[...tins].join(",")}`,
      );
      continue;
    }

    const tin = [...tins][0];
    const rows = await prisma.departmentLeader.findMany({
      where: { HotelName: hotelKey },
    });
    console.log(
      `[remap] ${JSON.stringify(hotelKey)} → ${JSON.stringify(tin)} (${rows.length} row(s))`,
    );

    for (const row of rows) {
      const existing = await prisma.departmentLeader.findUnique({
        where: {
          HotelName_department: { HotelName: tin, department: row.department },
        },
      });
      if (existing) {
        if (apply) {
          await prisma.departmentLeader.delete({ where: { id: row.id } });
        }
        deletedDup += 1;
      } else if (apply) {
        await prisma.departmentLeader.update({
          where: { id: row.id },
          data: { HotelName: tin },
        });
        remapped += 1;
      } else {
        remapped += 1;
      }
    }
  }

  console.log(
    apply
      ? `Done. remapped=${remapped} deletedDup=${deletedDup} skippedCollision=${skippedCollision} skippedUnknown=${skippedUnknown}`
      : `Dry run. wouldRemap=${remapped} wouldDeleteDup=${deletedDup} skippedCollision=${skippedCollision} skippedUnknown=${skippedUnknown}. Re-run with --apply.`,
  );
} finally {
  await prisma.$disconnect();
}
