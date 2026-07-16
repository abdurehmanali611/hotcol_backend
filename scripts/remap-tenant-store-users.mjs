/**
 * After a tenant TIN / legal-name change, inventory rows may already be on the
 * new TIN but still attributed to old Store / Finance / CC / Manager logins.
 * Request status only shows rows owned by the signed-in username.
 *
 * Usage (from BackEnd/):
 *   node scripts/remap-tenant-store-users.mjs
 *   node scripts/remap-tenant-store-users.mjs --apply
 *
 * Defaults: tenant 0108492685, Gebretsadik → Wa anga user renames.
 */
import { createPrismaClient } from "../lib/prismaClient.js";

const apply = process.argv.includes("--apply");

function argValue(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : fallback;
}

const TENANT = argValue("--tenant", "0108492685");

/** Old login → new login (same role, new company TIN). */
const USER_MAP = new Map(
  Object.entries({
    gtStore: "waStore",
    gtManager: "waManager",
    gtCost: "waCost",
    gtFinance: "waFinance",
  }),
);

const prisma = createPrismaClient();

async function remapField(model, field) {
  let total = 0;
  for (const [from, to] of USER_MAP) {
    const where = { HotelName: TENANT, [field]: from };
    const count = await prisma[model].count({ where });
    if (count === 0) continue;
    if (apply) {
      const res = await prisma[model].updateMany({
        where,
        data: { [field]: to },
      });
      total += res.count;
      console.log(`  ${model}.${field}: ${from} → ${to} (${res.count})`);
    } else {
      console.log(`  ${model}.${field}: would ${from} → ${to} (${count})`);
      total += count;
    }
  }
  return total;
}

const JOBS = [
  { model: "purchaseRequest", fields: ["storeUserName", "ccActorName", "financeActorName", "managerActorName"] },
  { model: "stockOutRequest", fields: ["requestedByUserName", "ccActorName", "financeActorName", "managerActorName"] },
  { model: "itemRegistration", fields: ["statusBy", "ccActorName", "financeActorName", "managerActorName"] },
  { model: "itemStatus", fields: ["statusBy"] },
];

try {
  console.log(
    `${apply ? "APPLY" : "DRY-RUN"} remap store users on tenant ${JSON.stringify(TENANT)}`,
  );
  console.log("User map:", Object.fromEntries(USER_MAP));

  let grand = 0;
  for (const { model, fields } of JOBS) {
    console.log(`\n${model}:`);
    for (const field of fields) {
      grand += await remapField(model, field);
    }
  }

  console.log(
    apply
      ? `\nDone. fieldsUpdated=${grand}`
      : `\nDry run. wouldUpdate=${grand}. Re-run with --apply.`,
  );
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
