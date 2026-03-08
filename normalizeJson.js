/*
  Run this one‑off script from the BackEnd folder to normalise existing waiter/table
  JSON fields. It will convert any `{}` stored in the columns to empty arrays.

  Usage:
    node normalizeJson.js
*/

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  console.log("Updating waiter records...");
  const waiters = await prisma.waiter.findMany();
  for (const w of waiters) {
    const update = {};
    if (w.payment && typeof w.payment === "object" && !Array.isArray(w.payment)) {
      update.payment = [];
    }
    if (w.tablesServed && typeof w.tablesServed === "object" && !Array.isArray(w.tablesServed)) {
      update.tablesServed = [];
    }
    if (w.price && typeof w.price === "object" && !Array.isArray(w.price)) {
      update.price = [];
    }
    if (Object.keys(update).length > 0) {
      await prisma.waiter.update({ where: { id: w.id }, data: update });
      console.log("normalized waiter", w.id);
    }
  }

  console.log("Updating table records...");
  const tables = await prisma.table.findMany();
  for (const t of tables) {
    const update = {};
    if (t.payment && typeof t.payment === "object" && !Array.isArray(t.payment)) {
      update.payment = [];
    }
    if (t.price && typeof t.price === "object" && !Array.isArray(t.price)) {
      update.price = [];
    }
    if (Object.keys(update).length > 0) {
      await prisma.table.update({ where: { id: t.id }, data: update });
      console.log("normalized table", t.id);
    }
  }
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
