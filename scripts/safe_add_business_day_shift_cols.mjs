/**
 * Non-destructive: add lodging_business_day.fromAt / toAt, backfill from
 * businessDate, then set NOT NULL. Never drops tables or truncates data.
 *
 * Usage (from BackEnd):
 *   node scripts/safe_add_business_day_shift_cols.mjs
 * then:
 *   npx prisma db push
 */
import { createPrismaClient } from "../lib/prismaClient.js";

const prisma = createPrismaClient();

async function columnExists(table, column) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = '${table}'
       AND COLUMN_NAME = '${column}'`,
  );
  return Number(rows?.[0]?.c || 0) > 0;
}

async function indexExists(name) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS c
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'lodging_business_day'
       AND INDEX_NAME = '${name}'`,
  );
  return Number(rows?.[0]?.c || 0) > 0;
}

async function main() {
  console.log("Checking lodging_business_day (no data will be deleted)…");

  const before = await prisma.$queryRawUnsafe(
    `SELECT id, HotelName, businessDate, status FROM lodging_business_day ORDER BY id`,
  );
  console.log(`Existing rows: ${before.length}`);
  for (const r of before) {
    console.log(`  #${r.id} ${r.HotelName} ${r.businessDate} (${r.status})`);
  }

  if (!(await columnExists("lodging_business_day", "fromAt"))) {
    console.log("Adding nullable fromAt…");
    await prisma.$executeRawUnsafe(
      `ALTER TABLE lodging_business_day ADD COLUMN fromAt DATETIME NULL`,
    );
  } else {
    console.log("fromAt already exists");
  }

  if (!(await columnExists("lodging_business_day", "toAt"))) {
    console.log("Adding nullable toAt…");
    await prisma.$executeRawUnsafe(
      `ALTER TABLE lodging_business_day ADD COLUMN toAt DATETIME NULL`,
    );
  } else {
    console.log("toAt already exists");
  }

  if (!(await columnExists("lodging_business_day", "label"))) {
    console.log("Adding label with default ''…");
    await prisma.$executeRawUnsafe(
      `ALTER TABLE lodging_business_day ADD COLUMN label VARCHAR(191) NOT NULL DEFAULT ''`,
    );
  }

  console.log(
    "Backfilling fromAt/toAt from businessDate (calendar day 00:00–23:59)…",
  );
  const updated = await prisma.$executeRawUnsafe(`
    UPDATE lodging_business_day
    SET
      fromAt = COALESCE(
        fromAt,
        STR_TO_DATE(CONCAT(businessDate, ' 00:00:00'), '%Y-%m-%d %H:%i:%s')
      ),
      toAt = COALESCE(
        toAt,
        STR_TO_DATE(CONCAT(businessDate, ' 23:59:59'), '%Y-%m-%d %H:%i:%s')
      )
    WHERE fromAt IS NULL OR toAt IS NULL
  `);
  console.log(`Backfill affected rows: ${updated}`);

  const nulls = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) AS c FROM lodging_business_day
    WHERE fromAt IS NULL OR toAt IS NULL
  `);
  if (Number(nulls?.[0]?.c || 0) > 0) {
    throw new Error(
      "Some rows still have NULL fromAt/toAt — check businessDate values",
    );
  }

  console.log("Setting fromAt/toAt NOT NULL…");
  await prisma.$executeRawUnsafe(`
    ALTER TABLE lodging_business_day
      MODIFY COLUMN fromAt DATETIME NOT NULL,
      MODIFY COLUMN toAt DATETIME NOT NULL
  `);

  // Old unique (HotelName, businessDate) blocks overlapping shifts — drop if present.
  for (const name of [
    "lodging_business_day_HotelName_businessDate_key",
    "HotelName_businessDate",
  ]) {
    if (await indexExists(name)) {
      console.log(`Dropping unique index ${name} (keeps all rows)…`);
      await prisma.$executeRawUnsafe(
        `ALTER TABLE lodging_business_day DROP INDEX \`${name}\``,
      );
    }
  }

  if (!(await indexExists("lodging_business_day_HotelName_fromAt_idx"))) {
    console.log("Adding index (HotelName, fromAt)…");
    await prisma.$executeRawUnsafe(`
      CREATE INDEX lodging_business_day_HotelName_fromAt_idx
      ON lodging_business_day (HotelName, fromAt)
    `);
  }

  const after = await prisma.$queryRawUnsafe(
    `SELECT id, businessDate, fromAt, toAt, status FROM lodging_business_day ORDER BY id`,
  );
  console.log("After backfill:");
  for (const r of after) {
    console.log(
      `  #${r.id} ${r.businessDate} ${r.fromAt} → ${r.toAt} (${r.status})`,
    );
  }

  console.log("\nDone. No rows deleted. Next run: npx prisma db push");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
