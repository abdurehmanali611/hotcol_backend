import { createPrismaClient } from "../lib/prismaClient.js";

const prisma = createPrismaClient();

try {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE hr_employee
      ADD COLUMN portalOtpLookup VARCHAR(191) NOT NULL DEFAULT ''
  `);
  console.log("added portalOtpLookup column");
} catch (e) {
  const msg = String(e?.message || e);
  if (/Duplicate column|already exists/i.test(msg)) {
    console.log("portalOtpLookup column already exists");
  } else {
    console.error(e);
    process.exitCode = 1;
  }
}

try {
  await prisma.$executeRawUnsafe(`
    CREATE INDEX hr_employee_portalOtpLookup_idx ON hr_employee (portalOtpLookup)
  `);
  console.log("added portalOtpLookup index");
} catch (e) {
  const msg = String(e?.message || e);
  if (/Duplicate|already exists/i.test(msg)) {
    console.log("portalOtpLookup index already exists");
  } else {
    console.warn("index:", msg);
  }
}

// Backfill lookup from still-visible preview codes (hire/reset not yet first-login).
const r = await prisma.$executeRawUnsafe(`
  UPDATE hr_employee
  SET portalOtpLookup = UPPER(TRIM(portalOtpPreview))
  WHERE portalOtpPreview <> ''
    AND (portalOtpLookup IS NULL OR portalOtpLookup = '')
    AND status <> 'terminated'
    AND CHAR_LENGTH(TRIM(portalOtpPreview)) = 6
`);
console.log(`backfilled portalOtpLookup from preview: ${r}`);

await prisma.$disconnect();
