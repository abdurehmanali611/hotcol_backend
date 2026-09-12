import { createPrismaClient } from "../lib/prismaClient.js";

const prisma = createPrismaClient();

try {
  const before = await prisma.crystalName.count();
  console.log("crystal_name rows before:", before);

  const created = await prisma.crystalName.create({
    data: { amharic: "ዳቦ", romanized: "Dabo", english: "Bread" },
  });
  console.log("created:", created);

  const updated = await prisma.crystalName.update({
    where: { id: created.id },
    data: { english: "Bread loaf" },
  });
  console.log("updated:", updated);

  const listed = await prisma.crystalName.findMany({
    where: { romanized: "Dabo" },
  });
  console.log("listed:", listed.length);

  await prisma.crystalName.delete({ where: { id: created.id } });
  console.log("deleted id", created.id);

  console.log("CRUD smoke OK");
} catch (err) {
  console.error("CRUD smoke FAILED:", err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
