import { createPrismaClient } from "../lib/prismaClient.js";

/**
 * Re-tag FreshBazaar rows whose stock-out went to Kitchen/Bar as KITCHEN/BAR
 * (fresh bazaar). Staff destination / (staff) names stay STORE (not fresh bazaar).
 *
 * Usage: node scripts/promote-kitchen-dest-fresh-bazaar.mjs [--apply]
 */
const apply = process.argv.includes("--apply");
const p = createPrismaClient();

function destCode(req) {
  const requested = String(req.requestedByDepartment ?? "")
    .trim()
    .toUpperCase();
  if (requested) return requested;
  const stake = String(req.stakeHolderOrReason ?? "").trim().toLowerCase();
  if (stake === "kitchen") return "KITCHEN";
  if (stake === "barista" || stake === "bar") return "BAR";
  if (stake === "staff") return "STAFF";
  return "";
}

const archives = await p.freshBazaar.findMany({
  select: {
    id: true,
    itemRegistrationId: true,
    name: true,
    supplierName: true,
    receivedByDepartment: true,
    stockOutRequestId: true,
  },
});

const regIds = archives.map((a) => a.itemRegistrationId);
const moves = await p.stockOutRequest.findMany({
  where: {
    itemRegistrationId: { in: regIds },
    status: "APPROVED",
    movementType: "STOCK_OUT",
  },
  orderBy: { id: "asc" },
});

const lastByReg = new Map();
for (const m of moves) {
  lastByReg.set(m.itemRegistrationId, m);
}

const toKitchen = [];
const toBar = [];
const toStore = [];

for (const a of archives) {
  const name = String(a.name ?? "").toLowerCase();
  const last = lastByReg.get(a.itemRegistrationId);
  const dest = last ? destCode(last) : "";
  if (/\(staff\)/.test(name) || dest === "STAFF") {
    if (a.receivedByDepartment !== "STORE") toStore.push(a);
    continue;
  }
  if (dest === "KITCHEN") {
    if (a.receivedByDepartment !== "KITCHEN") toKitchen.push({ ...a, dest });
  } else if (dest === "BAR") {
    if (a.receivedByDepartment !== "BAR") toBar.push({ ...a, dest });
  }
}

console.log(
  apply ? "Applying…" : "Dry run (pass --apply):",
  `→KITCHEN ${toKitchen.length}, →BAR ${toBar.length}, →STORE(staff) ${toStore.length}`,
);
for (const a of [...toKitchen, ...toBar].slice(0, 30)) {
  console.log({
    id: a.id,
    name: a.name,
    supplier: a.supplierName,
    from: a.receivedByDepartment,
    to: a.dest,
  });
}

if (apply) {
  if (toKitchen.length) {
    await p.freshBazaar.updateMany({
      where: { id: { in: toKitchen.map((a) => a.id) } },
      data: { receivedByDepartment: "KITCHEN" },
    });
  }
  if (toBar.length) {
    await p.freshBazaar.updateMany({
      where: { id: { in: toBar.map((a) => a.id) } },
      data: { receivedByDepartment: "BAR" },
    });
  }
  if (toStore.length) {
    await p.freshBazaar.updateMany({
      where: { id: { in: toStore.map((a) => a.id) } },
      data: { receivedByDepartment: "STORE" },
    });
  }
  console.log("Done.");
}

await p.$disconnect();
