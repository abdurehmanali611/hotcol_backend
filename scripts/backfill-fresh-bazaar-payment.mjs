import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client.ts";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

const adapter = new PrismaMariaDb(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter });

const rows = await prisma.freshBazaar.findMany();
console.log("Fresh bazaar rows:", rows.length);

let updated = 0;
for (const row of rows) {
  const moves = await prisma.stockOutRequest.findMany({
    where: {
      itemRegistrationId: row.itemRegistrationId,
      status: "APPROVED",
    },
    select: { id: true, amount: true },
  });
  let amount = moves.reduce((s, m) => s + (Number(m.amount) || 0), 0);
  const reqIds = [
    ...new Set(
      [
        ...moves.map((m) => m.id),
        row.stockOutRequestId != null ? row.stockOutRequestId : null,
      ].filter((id) => id != null && Number(id) > 0),
    ),
  ];
  const statuses = reqIds.length
    ? await prisma.itemStatus.findMany({
        where: { stockOutRequestId: { in: reqIds } },
        select: {
          amount: true,
          paidAmount: true,
          actionDate: true,
          unitPrice: true,
        },
        orderBy: { id: "asc" },
      })
    : [];
  if (!(amount > 0)) {
    amount = statuses.reduce((s, st) => s + (Number(st.amount) || 0), 0);
  }
  let paidAmount = Number(row.paidAmount) || 0;
  if (!(paidAmount > 0) && statuses.length) {
    paidAmount = Number(statuses[statuses.length - 1].paidAmount) || 0;
  }
  let registrationDate = row.registrationDate;
  if (registrationDate == null && statuses.length) {
    registrationDate = statuses[0].actionDate ?? row.archivedAt;
  }
  if (!(amount > 0) && !(paidAmount > 0) && registrationDate == null) {
    continue;
  }
  await prisma.freshBazaar.update({
    where: { id: row.id },
    data: {
      amount,
      paidAmount,
      registrationDate,
    },
  });
  updated += 1;
  console.log("updated", row.id, row.name, { amount, paidAmount });
}

console.log("Done. Updated:", updated);
await prisma.$disconnect();
