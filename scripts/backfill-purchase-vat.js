/**
 * Set purchaseWithVat on existing purchase requests (alternating with / without VAT).
 *
 *   cd BackEnd
 *   npm run db:backfill-purchase-vat
 *   npm run db:backfill-purchase-vat:dry
 */
import "dotenv/config";
import { createPrismaClient } from "../lib/prismaClient.js";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const prisma = createPrismaClient();
  const count = await prisma.purchaseRequest.count();

  if (count === 0) {
    console.log("No purchase requests found.");
    await prisma.$disconnect();
    return;
  }

  if (dryRun) {
    const withVat = await prisma.purchaseRequest.count({
      where: { id: { not: { equals: 0 } } },
    });
    console.log(`[dry-run] Would set purchaseWithVat on ${count} rows (even id → with VAT, odd → without).`);
    void withVat;
    await prisma.$disconnect();
    return;
  }

  // One statement — avoids per-row pool timeouts on remote DB.
  const updated = await prisma.$executeRaw`
    UPDATE PurchaseRequest
    SET purchaseWithVat = (MOD(id, 2) = 0)
  `;

  const withVatCount = await prisma.purchaseRequest.count({
    where: { purchaseWithVat: true },
  });
  const withoutVatCount = await prisma.purchaseRequest.count({
    where: { purchaseWithVat: false },
  });

  console.log(`Updated purchase requests (rows affected: ${Number(updated)}).`);
  console.log(`  With VAT (15%): ${withVatCount}`);
  console.log(`  Without VAT: ${withoutVatCount}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
