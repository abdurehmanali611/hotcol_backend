import "dotenv/config";
import { createPrismaClient } from "../lib/prismaClient.js";

async function columns(prisma, table) {
  const rows = await prisma.$queryRawUnsafe(`SHOW COLUMNS FROM \`${table}\``);
  return rows.map((r) => r.Field);
}

async function main() {
  const prisma = createPrismaClient();
  try {
    console.log("user columns:", (await columns(prisma, "user")).join(", "));
    console.log(
      "ItemRegistration:",
      (await columns(prisma, "ItemRegistration")).join(", "),
    );
    console.log("ItemStatus:", (await columns(prisma, "ItemStatus")).join(", "));
    console.log(
      "PurchaseRequest:",
      (await columns(prisma, "PurchaseRequest")).join(", "),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
