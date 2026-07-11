import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client.ts";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

/**
 * Demote FreshBazaar rows that were created by the destination-kitchen backfill
 * (not true kitchen-received fresh bazaar). Marks receivedByDepartment = STORE
 * so payment & tax shows "Stocked out" instead of "Fresh bazaar".
 *
 * Usage:
 *   node scripts/demote-non-kitchen-fresh-bazaar.mjs --latest 62 [--apply]
 *   node scripts/demote-non-kitchen-fresh-bazaar.mjs --mismatched [--apply]
 *
 * --latest N  demote the N newest archives with no live registration
 *             (use after a known backfill of N rows).
 * --mismatched demote when archive qty matches kitchen-dest outs only and
 *             other approved outs exist (clear backfill signal).
 */
const apply = process.argv.includes("--apply");
const mismatched = process.argv.includes("--mismatched");
const latestIdx = process.argv.indexOf("--latest");
const latestN =
  latestIdx >= 0 ? Math.max(0, Number(process.argv[latestIdx + 1]) || 0) : 0;

const p = new PrismaClient({
  adapter: new PrismaMariaDb(process.env.DATABASE_URL),
});

function isKitchenDest(m) {
  const stake = String(m.stakeHolderOrReason ?? "").trim().toLowerCase();
  const dept = String(m.requestedByDepartment ?? "").trim().toUpperCase();
  return stake === "kitchen" || dept === "KITCHEN";
}

const archives = await p.freshBazaar.findMany({
  orderBy: { id: "desc" },
  select: {
    id: true,
    itemRegistrationId: true,
    name: true,
    supplierName: true,
    amount: true,
    receivedByDepartment: true,
    archivedAt: true,
  },
});

const regIds = archives.map((a) => a.itemRegistrationId);
const [liveRegs, moves] = await Promise.all([
  p.itemRegistration.findMany({
    where: { id: { in: regIds } },
    select: { id: true },
  }),
  p.stockOutRequest.findMany({
    where: {
      itemRegistrationId: { in: regIds },
      status: "APPROVED",
      movementType: "STOCK_OUT",
    },
    select: {
      itemRegistrationId: true,
      amount: true,
      stakeHolderOrReason: true,
      requestedByDepartment: true,
    },
  }),
]);
const live = new Set(liveRegs.map((r) => r.id));
const movesByReg = new Map();
for (const m of moves) {
  const list = movesByReg.get(m.itemRegistrationId) || [];
  list.push(m);
  movesByReg.set(m.itemRegistrationId, list);
}

let toDemote = [];

if (latestN > 0) {
  toDemote = archives
    .filter((a) => !live.has(a.itemRegistrationId))
    .slice(0, latestN);
} else if (mismatched) {
  for (const a of archives) {
    if (live.has(a.itemRegistrationId)) continue;
    const list = movesByReg.get(a.itemRegistrationId) || [];
    const kitchenMoves = list.filter(isKitchenDest);
    if (!kitchenMoves.length) continue;
    const kitchenSum = kitchenMoves.reduce(
      (s, m) => s + (Number(m.amount) || 0),
      0,
    );
    const allSum = list.reduce((s, m) => s + (Number(m.amount) || 0), 0);
    const archAmt = Number(a.amount) || 0;
    const matchesKitchenOnly = Math.abs(archAmt - kitchenSum) < 0.02;
    if (!matchesKitchenOnly) continue;
    if (Math.abs(allSum - kitchenSum) < 0.02) continue;
    toDemote.push(a);
  }
} else {
  console.error("Pass --latest N or --mismatched (and optionally --apply).");
  await p.$disconnect();
  process.exit(1);
}

console.log(
  apply
    ? `Demoting ${toDemote.length} archives to STORE…`
    : `Dry run: ${toDemote.length} archives would be demoted (pass --apply):`,
);
for (const a of toDemote.slice(0, 40)) {
  console.log({
    id: a.id,
    name: a.name,
    supplier: a.supplierName,
    amount: a.amount,
    dept: a.receivedByDepartment,
  });
}
if (toDemote.length > 40) console.log(`…and ${toDemote.length - 40} more`);

if (apply && toDemote.length) {
  await p.freshBazaar.updateMany({
    where: { id: { in: toDemote.map((a) => a.id) } },
    data: { receivedByDepartment: "STORE" },
  });
  console.log("Updated", toDemote.length);
}

await p.$disconnect();
