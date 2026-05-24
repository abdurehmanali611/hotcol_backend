/**
 * Apply tenant billing columns (safe if columns already exist).
 * Run: node scripts/applyTenantBillingFlags.js
 */
import { PrismaClient } from "../generated/prisma/index.js";

const prisma = new PrismaClient();

async function columnExists(table, column) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    table,
    column,
  );
  return Number(rows[0]?.c ?? 0) > 0;
}

async function addColumnIfMissing(table, column, ddl) {
  if (await columnExists(table, column)) {
    console.log(`[skip] ${table}.${column} exists`);
    return;
  }
  await prisma.$executeRawUnsafe(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`);
  console.log(`[add] ${table}.${column}`);
}

async function main() {
  await addColumnIfMissing(
    "user",
    "isIllustrationTenant",
    "`isIllustrationTenant` BOOLEAN NOT NULL DEFAULT false",
  );
  await addColumnIfMissing(
    "user",
    "billingHold",
    "`billingHold` BOOLEAN NOT NULL DEFAULT false",
  );
  await addColumnIfMissing(
    "user",
    "billingStartedAt",
    "`billingStartedAt` DATETIME(3) NULL",
  );
  await addColumnIfMissing(
    "user",
    "freeTrialEndsAt",
    "`freeTrialEndsAt` DATETIME(3) NULL",
  );
  await addColumnIfMissing("user", "billingNotes", "`billingNotes` TEXT NULL");

  await prisma.$executeRawUnsafe(`UPDATE \`user\` SET \`billingHold\` = true`);

  await prisma.$executeRawUnsafe(`
    UPDATE \`user\`
    SET
      \`isIllustrationTenant\` = true,
      \`billingHold\` = false,
      \`setupFeeApproved\` = true,
      \`subscriptionPaymentApproved\` = true,
      \`setupFeeETB\` = 0,
      \`quarterlyFeeETB\` = 0,
      \`paidQuartersCount\` = 0,
      \`subscriptionPaidUntil\` = NULL,
      \`billingNotes\` = 'Illustration / demo property — no payment'
    WHERE LOWER(TRIM(\`HotelName\`)) LIKE '%apex cafe%'
       OR LOWER(TRIM(\`HotelName\`)) = 'apex cafe and restaurant'
  `);

  await prisma.$executeRawUnsafe(`
    UPDATE \`user\`
    SET
      \`isIllustrationTenant\` = true,
      \`billingHold\` = false,
      \`setupFeeApproved\` = true,
      \`subscriptionPaymentApproved\` = true,
      \`setupFeeETB\` = 0,
      \`quarterlyFeeETB\` = 0,
      \`paidQuartersCount\` = 0,
      \`subscriptionPaidUntil\` = NULL,
      \`billingNotes\` = 'Illustration / demo property — no payment'
    WHERE LOWER(TRIM(\`HotelName\`)) LIKE '%apex hotel%'
  `);

  await prisma.$executeRawUnsafe(`
    UPDATE \`user\`
    SET \`setupFeeETB\` = 15000, \`setupFeeApproved\` = true,
        \`billingNotes\` = 'First café client — setup 15,000 ETB'
    WHERE LOWER(TRIM(\`HotelName\`)) LIKE '%hafina%'
  `);

  await prisma.$executeRawUnsafe(`
    UPDATE \`user\`
    SET \`setupFeeETB\` = 25000, \`setupFeeApproved\` = true,
        \`billingNotes\` = 'First hotel client — setup 25,000 ETB'
    WHERE LOWER(TRIM(\`HotelName\`)) LIKE '%gebretsadik%'
  `);

  await prisma.$executeRawUnsafe(`
    UPDATE \`user\`
    SET \`setupFeeETB\` = 25000, \`setupFeeApproved\` = true,
        \`billingNotes\` = 'First hotel client — setup 25,000 ETB'
    WHERE LOWER(TRIM(\`HotelName\`)) LIKE '%ella kitchen%'
  `);

  await prisma.$executeRawUnsafe(`
    UPDATE \`user\`
    SET \`billingStartedAt\` = NULL, \`paidQuartersCount\` = 0, \`subscriptionPaidUntil\` = NULL
    WHERE \`billingHold\` = true AND \`isIllustrationTenant\` = false
  `);

  console.log("Tenant billing flags applied.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
