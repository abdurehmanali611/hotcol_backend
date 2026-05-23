/**
 * Sync HotelVoucherCounter to the highest voucher already issued per property.
 * Run once after deploying unified voucher sequencing:
 *
 *   cd BackEnd && node scripts/sync-voucher-counters.js
 */
import { PrismaClient } from "../generated/prisma/index.js";
import {
  UNIFIED_VOUCHER_TYPE,
  resolveMaxExistingVoucherNumber,
} from "../lib/hotelVoucher.js";

const prisma = new PrismaClient();

async function hotelKeysFromRows(rows) {
  const keys = new Set();
  for (const h of rows) {
    const s = String(h ?? "").trim();
    if (s) keys.add(s);
  }
  return [...keys];
}

async function main() {
  const hotels = await hotelKeysFromRows([
    ...(await prisma.purchaseRequest.findMany({ select: { HotelName: true } })).map(
      (r) => r.HotelName,
    ),
    ...(await prisma.itemRegistration.findMany({ select: { HotelName: true } })).map(
      (r) => r.HotelName,
    ),
    ...(await prisma.itemStatus.findMany({ select: { HotelName: true } })).map(
      (r) => r.HotelName,
    ),
    ...(await prisma.stockOutRequest.findMany({ select: { HotelName: true } })).map(
      (r) => r.HotelName,
    ),
  ]);

  console.log(`Syncing voucher counters for ${hotels.length} hotel key(s)...`);

  for (const hotel of hotels) {
    const max = await resolveMaxExistingVoucherNumber(prisma, [hotel]);
    await prisma.hotelVoucherCounter.upsert({
      where: {
        HotelName_voucherType: {
          HotelName: hotel,
          voucherType: UNIFIED_VOUCHER_TYPE,
        },
      },
      create: {
        HotelName: hotel,
        voucherType: UNIFIED_VOUCHER_TYPE,
        lastNumber: max,
      },
      update: {
        lastNumber: max,
      },
    });
    console.log(`  ${hotel}: counter set to ${max} (next voucher ${max + 1})`);
  }

  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
