/**
 * Backfill receipt snapshot fields on existing item registrations, purchase requests,
 * and stock movements. Also seeds dummy department leaders per hotel when missing.
 *
 * Run from BackEnd (requires DATABASE_URL in .env):
 *   node scripts/backfill-receipt-snapshots.js
 *   node scripts/backfill-receipt-snapshots.js --dry-run
 */
import "dotenv/config";
import { createPrismaClient } from "../lib/prismaClient.js";
import {
  fetchLeaderMap,
  HOTEL_DEPARTMENTS,
  REGISTRATION_RECEIVED_BY_DEPARTMENTS,
  REQUESTED_BY_DEPARTMENTS,
  registrationReceiptSnapshots,
  requestReceiptSnapshots,
} from "../lib/departmentLeaders.js";

const DUMMY_LEADER_NAMES = {
  KITCHEN: "Abebe Kitchen",
  BAR: "Sara Bar",
  HOUSE_KEEPING_ROOM: "Helen Housekeeping (Room)",
  HOUSE_KEEPING_PUBLIC: "Helen Housekeeping (Public)",
  SECURITY: "Tadesse Security",
  MAINTENANCE: "Dawit Maintenance",
  FINANCE: "Meron Finance",
  HR: "Yonas HR",
  GM: "General Manager Demo",
  FB_SERVICE: "Fikadu F&B",
  STORE: "Store Lead Demo",
};

const dryRun = process.argv.includes("--dry-run");
const BATCH_SIZE = 25;

function pickById(id, codes) {
  const n = Math.abs(Math.floor(Number(id) || 0));
  return codes[n % codes.length];
}

async function distinctHotels(prisma) {
  const sets = await Promise.all([
    prisma.itemRegistration.findMany({
      select: { HotelName: true },
      distinct: ["HotelName"],
    }),
    prisma.purchaseRequest.findMany({
      select: { HotelName: true },
      distinct: ["HotelName"],
    }),
    prisma.stockOutRequest.findMany({
      select: { HotelName: true },
      distinct: ["HotelName"],
    }),
    prisma.departmentLeader.findMany({
      select: { HotelName: true },
      distinct: ["HotelName"],
    }),
  ]);
  const names = new Set();
  for (const rows of sets) {
    for (const row of rows) {
      const h = String(row.HotelName ?? "").trim();
      if (h) names.add(h);
    }
  }
  return [...names];
}

async function ensureDummyLeadersForHotel(prisma, hotelName) {
  const existing = await prisma.departmentLeader.findMany({
    where: { HotelName: hotelName },
  });
  const have = new Set(existing.map((r) => r.department));
  const toCreate = HOTEL_DEPARTMENTS.filter((d) => !have.has(d)).map((d) => ({
    HotelName: hotelName,
    department: d,
    leaderName: DUMMY_LEADER_NAMES[d] ?? `${d} Demo`,
  }));

  if (toCreate.length && !dryRun) {
    await prisma.departmentLeader.createMany({
      data: toCreate,
      skipDuplicates: true,
    });
  }

  return {
    created: toCreate.length,
    map: await fetchLeaderMap(prisma, hotelName),
  };
}

function needsRegistrationBackfillWhere(hotelName) {
  return {
    HotelName: hotelName,
    OR: [
      { receivedByDepartment: null },
      { receivedByLeaderName: null },
      { financeDeptLeaderName: null },
      { gmDeptLeaderName: null },
      { receivedByDepartment: "" },
      { receivedByLeaderName: "" },
      { financeDeptLeaderName: "" },
      { gmDeptLeaderName: "" },
    ],
  };
}

function needsRequestBackfillWhere(hotelName) {
  return {
    HotelName: hotelName,
    OR: [
      { requestedByDepartment: null },
      { requestedByLeaderName: null },
      { preparedByLeaderName: null },
      { financeDeptLeaderName: null },
      { gmDeptLeaderName: null },
      { requestedByDepartment: "" },
      { requestedByLeaderName: "" },
      { preparedByLeaderName: "" },
      { financeDeptLeaderName: "" },
      { gmDeptLeaderName: "" },
    ],
  };
}

async function backfillRegistrations(prisma, hotelName, leaderMap) {
  const rows = await prisma.itemRegistration.findMany({
    where: needsRegistrationBackfillWhere(hotelName),
    select: { id: true },
  });

  if (dryRun) return rows.length;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(
      chunk.map((row) => {
        const dept = pickById(row.id, REGISTRATION_RECEIVED_BY_DEPARTMENTS);
        const snap = registrationReceiptSnapshots(leaderMap, dept);
        return prisma.itemRegistration.update({
          where: { id: row.id },
          data: snap,
        });
      }),
    );
  }
  return rows.length;
}

async function backfillPurchaseRequests(prisma, hotelName, leaderMap) {
  const rows = await prisma.purchaseRequest.findMany({
    where: needsRequestBackfillWhere(hotelName),
    select: { id: true },
  });

  if (dryRun) return rows.length;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(
      chunk.map((row) => {
        const dept = pickById(row.id, REQUESTED_BY_DEPARTMENTS);
        const snap = requestReceiptSnapshots(leaderMap, dept);
        return prisma.purchaseRequest.update({
          where: { id: row.id },
          data: snap,
        });
      }),
    );
  }
  return rows.length;
}

async function backfillStockOutRequests(prisma, hotelName, leaderMap) {
  const rows = await prisma.stockOutRequest.findMany({
    where: needsRequestBackfillWhere(hotelName),
    select: { id: true },
  });

  if (dryRun) return rows.length;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(
      chunk.map((row) => {
        const dept = pickById(row.id, REQUESTED_BY_DEPARTMENTS);
        const snap = requestReceiptSnapshots(leaderMap, dept);
        return prisma.stockOutRequest.update({
          where: { id: row.id },
          data: snap,
        });
      }),
    );
  }
  return rows.length;
}

async function main() {
  const prisma = createPrismaClient();
  const hotels = await distinctHotels(prisma);

  if (!hotels.length) {
    console.log("No hotel tenants found — nothing to backfill.");
    await prisma.$disconnect();
    return;
  }

  console.log(
    dryRun
      ? "[dry-run] Preview only — no writes."
      : "Backfilling receipt snapshots…",
  );
  console.log(`Hotels: ${hotels.join(", ")}`);

  let totalLeadersCreated = 0;
  let totalReg = 0;
  let totalPr = 0;
  let totalStock = 0;

  for (const hotelName of hotels) {
    const { created, map } = await ensureDummyLeadersForHotel(prisma, hotelName);
    totalLeadersCreated += created;

    const reg = await backfillRegistrations(prisma, hotelName, map);
    const pr = await backfillPurchaseRequests(prisma, hotelName, map);
    const stock = await backfillStockOutRequests(prisma, hotelName, map);

    totalReg += reg;
    totalPr += pr;
    totalStock += stock;

    console.log(
      `  ${hotelName}: +${created} leaders, ${reg} registrations, ${pr} purchases, ${stock} stock`,
    );
  }

  console.log("Done.");
  console.log(
    `  Department leaders created: ${totalLeadersCreated}`,
  );
  console.log(
    `  Item registrations updated: ${totalReg}`,
  );
  console.log(`  Purchase requests updated: ${totalPr}`);
  console.log(`  Stock movements updated: ${totalStock}`);

  if (dryRun) {
    console.log("Re-run without --dry-run to apply changes.");
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
