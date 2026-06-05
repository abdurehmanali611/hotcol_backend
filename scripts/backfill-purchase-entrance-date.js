/**
 * Set entranceDate = createdAt on existing purchase requests (send / entry day).
 *
 *   cd BackEnd
 *   npm run db:backfill-purchase-entrance-date
 *   npm run db:backfill-purchase-entrance-date:dry
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

  const [{ mismatched }] = await prisma.$queryRaw`
    SELECT COUNT(*) AS mismatched
    FROM PurchaseRequest
    WHERE entranceDate <> createdAt
  `;

  if (dryRun) {
    const sample = await prisma.purchaseRequest.findMany({
      take: 5,
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        itemName: true,
        createdAt: true,
        entranceDate: true,
      },
    });
    console.log(
      `[dry-run] Would set entranceDate = createdAt on ${count} purchase request row(s).`,
    );
    console.log(
      `[dry-run] Rows where entranceDate differs from createdAt: ${Number(mismatched)}.`,
    );
    for (const row of sample) {
      console.log(
        `  #${row.id} ${row.itemName}: created=${row.createdAt.toISOString()} entrance=${row.entranceDate.toISOString()}`,
      );
    }
    await prisma.$disconnect();
    return;
  }

  const updated = await prisma.$executeRaw`
    UPDATE PurchaseRequest
    SET entranceDate = createdAt
  `;

  console.log(
    `Backfill complete. entranceDate set to createdAt (rows affected: ${Number(updated)}).`,
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
