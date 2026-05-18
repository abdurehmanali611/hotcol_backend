/**
 * Copy voucher numbers from approved stock-out requests onto matching ItemStatus rows.
 * Run from BackEnd: node scripts/backfill-itemstatus-vouchers.js
 */
import { PrismaClient } from "../generated/prisma/index.js";

const prisma = new PrismaClient();

async function main() {
  const statuses = await prisma.itemStatus.findMany({
    where: { voucherNumber: null },
    orderBy: { id: "asc" },
  });
  let updated = 0;
  for (const st of statuses) {
    const typeMap = {
      "Stock Out": "STOCK_OUT",
      Wastage: "WASTAGE",
      "Returned to Supplier": "RETURN_SUPPLIER",
    };
    const movementType = typeMap[st.status];
    if (!movementType) continue;

    const req = await prisma.stockOutRequest.findFirst({
      where: {
        HotelName: st.HotelName,
        movementType,
        voucherNumber: { not: null },
        status: "APPROVED",
        amount: st.amount,
        itemNameSnapshot: st.name,
      },
      orderBy: { decidedAt: "desc" },
    });
    if (!req?.voucherNumber) continue;

    await prisma.itemStatus.update({
      where: { id: st.id },
      data: {
        voucherNumber: req.voucherNumber,
        stockOutRequestId: req.id,
      },
    });
    updated += 1;
  }
  console.log(`Updated ${updated} item status row(s) with stock movement vouchers.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
