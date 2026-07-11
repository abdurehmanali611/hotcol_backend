import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client.ts";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

/**
 * Rebuild FreshBazaar rows for fully depleted kitchen stock that only exists
 * in ItemStatus / StockOutRequest (archives created before FreshBazaar existed,
 * or archive failed). One FreshBazaar per itemRegistrationId.
 */
const p = new PrismaClient({
  adapter: new PrismaMariaDb(process.env.DATABASE_URL),
});

const orphanSos = await p.stockOutRequest.findMany({
  where: {
    status: "APPROVED",
    movementType: "STOCK_OUT",
  },
  select: {
    id: true,
    itemRegistrationId: true,
    HotelName: true,
    amount: true,
    stakeHolderOrReason: true,
    requestedByDepartment: true,
  },
  orderBy: { id: "asc" },
});

const regIds = [...new Set(orphanSos.map((r) => r.itemRegistrationId))];
const [existingRegs, existingFresh] = await Promise.all([
  p.itemRegistration.findMany({
    where: { id: { in: regIds } },
    select: { id: true },
  }),
  p.freshBazaar.findMany({
    where: { itemRegistrationId: { in: regIds } },
    select: { itemRegistrationId: true },
  }),
]);
const liveReg = new Set(existingRegs.map((r) => r.id));
const hasFresh = new Set(existingFresh.map((r) => r.itemRegistrationId));

const candidates = [
  ...new Set(
    orphanSos
      .filter((r) => !liveReg.has(r.itemRegistrationId) && !hasFresh.has(r.itemRegistrationId))
      .map((r) => r.itemRegistrationId),
  ),
];

console.log("Candidate registration ids missing FreshBazaar:", candidates.length);

let created = 0;
for (const regId of candidates) {
  const moves = orphanSos.filter((r) => r.itemRegistrationId === regId);
  if (!moves.length) continue;

  // Prefer kitchen destination stock-outs (fresh produce usage).
  const kitchenMoves = moves.filter((m) => {
    const stake = String(m.stakeHolderOrReason ?? "").trim().toLowerCase();
    const dept = String(m.requestedByDepartment ?? "").trim().toUpperCase();
    return stake === "kitchen" || dept === "KITCHEN";
  });
  const useMoves = kitchenMoves.length ? kitchenMoves : [];
  if (!useMoves.length) continue;

  const reqIds = useMoves.map((m) => m.id);
  const statuses = await p.itemStatus.findMany({
    where: { stockOutRequestId: { in: reqIds } },
    orderBy: { id: "asc" },
  });
  if (!statuses.length) continue;

  const amount = useMoves.reduce((s, m) => s + (Number(m.amount) || 0), 0);
  if (!(amount > 0)) continue;

  const lastStatus = statuses[statuses.length - 1];
  const firstStatus = statuses[0];
  const lastMove = useMoves[useMoves.length - 1];

  await p.freshBazaar.create({
    data: {
      HotelName: lastMove.HotelName,
      itemRegistrationId: regId,
      stockOutRequestId: lastMove.id,
      name: String(lastStatus.name || firstStatus.name || "").trim() || "Item",
      imageUrl: String(lastStatus.imageUrl ?? "").trim(),
      category: String(lastStatus.category ?? "").trim(),
      amount,
      measuredBy: String(lastStatus.measuredBy || firstStatus.measuredBy || "").trim() || "Unit",
      unitPrice: Number(lastStatus.unitPrice) || 0,
      purchaseWithVat: Boolean(lastStatus.purchaseWithVat),
      paidAmount: Number(lastStatus.paidAmount) || 0,
      supplierName: String(lastStatus.supplierName || "").trim(),
      supplierPhone: String(lastStatus.supplierPhone || "").trim(),
      Address: String(lastStatus.Address || "").trim(),
      supplierTinNumber: String(lastStatus.supplierTinNumber ?? "").trim(),
      registrationDate: firstStatus.actionDate ?? null,
      archivedAt: lastStatus.actionDate ?? new Date(),
    },
  });
  created += 1;
  console.log("created", {
    regId,
    name: lastStatus.name,
    supplier: lastStatus.supplierName,
    amount,
    paid: lastStatus.paidAmount,
  });
}

console.log("Done. Created:", created);
await p.$disconnect();
