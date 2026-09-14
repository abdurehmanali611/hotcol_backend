import { createPrismaClient } from "../lib/prismaClient.js";

const prisma = createPrismaClient();
try {
  const rows = await prisma.crystalName.findMany({
    select: { id: true, romanized: true },
  });
  let n = 0;
  for (const row of rows) {
    if (!/takeaway/i.test(row.romanized) || /Takeaway/.test(row.romanized)) {
      // still fix if mixed lowercase remains
      if (!/takeaway/.test(row.romanized)) continue;
    }
    const romanized = row.romanized.replace(/takeaway/gi, "Takeaway");
    if (romanized === row.romanized) continue;
    await prisma.crystalName.update({
      where: { id: row.id },
      data: { romanized },
    });
    console.log(row.id, row.romanized, "→", romanized);
    n += 1;
  }
  console.log("updated", n);
} finally {
  await prisma.$disconnect();
}
