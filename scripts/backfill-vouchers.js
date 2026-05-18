/**
 * Assign sequential voucher numbers to existing rows missing voucherNumber.
 * Run from BackEnd: node scripts/backfill-vouchers.js
 */
import { PrismaClient } from "../generated/prisma/index.js";
import { VOUCHER_TYPES } from "../lib/hotelVoucher.js";

const prisma = new PrismaClient();

const SPECS = [
  {
    voucherType: VOUCHER_TYPES.PURCHASE_REQUEST,
    model: "purchaseRequest",
    orderBy: { createdAt: "asc" },
  },
  {
    voucherType: VOUCHER_TYPES.ITEM_REGISTRATION,
    model: "itemRegistration",
    orderBy: { registrationDate: "asc" },
  },
  {
    voucherType: VOUCHER_TYPES.STOCK_MOVEMENT,
    model: "stockOutRequest",
    orderBy: { createdAt: "asc" },
  },
];

async function backfillModel({ voucherType, model, orderBy }) {
  const hotels = await prisma[model].findMany({
    where: { voucherNumber: null },
    select: { HotelName: true },
    distinct: ["HotelName"],
  });

  for (const { HotelName: hotel } of hotels) {
    const rows = await prisma[model].findMany({
      where: { HotelName: hotel, voucherNumber: null },
      orderBy,
      select: { id: true },
    });
    if (rows.length === 0) continue;

    let counter = await prisma.hotelVoucherCounter.findUnique({
      where: {
        HotelName_voucherType: { HotelName: hotel, voucherType },
      },
    });
    let seq = counter?.lastNumber ?? 0;

    for (const row of rows) {
      seq += 1;
      await prisma[model].update({
        where: { id: row.id },
        data: { voucherNumber: seq },
      });
    }

    await prisma.hotelVoucherCounter.upsert({
      where: {
        HotelName_voucherType: { HotelName: hotel, voucherType },
      },
      create: { HotelName: hotel, voucherType, lastNumber: seq },
      update: { lastNumber: seq },
    });

    console.log(
      `${voucherType} @ ${hotel}: assigned ${rows.length} voucher(s), counter=${seq}`,
    );
  }
}

async function main() {
  for (const spec of SPECS) {
    await backfillModel(spec);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
