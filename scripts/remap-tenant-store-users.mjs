/**
 * After a tenant TIN / legal-name change, inventory rows may already be on the
 * new TIN but still attributed to old Store / Finance / Manager logins, or to
 * cost-controller profile ids / display names from the previous tenant key.
 *
 * Note: `ccActorName` stores the Cost Controller *profile display name* (e.g.
 * "LAMESGIN TILAHUN"), not the login username (`gtCost` / `waCost`).
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
const OLD_TIN = argValue("--old-tin", "0000610789");

/** Old login → new login (same role, new company TIN). */
const USER_MAP = new Map(
  Object.entries({
    gtStore: "waStore",
    gtManager: "waManager",
    gtCost: "waCost",
    gtFinance: "waFinance",
  }),
);

/** Old CC profile display name → new (after re-registering on new TIN). */
const CC_DISPLAY_MAP = new Map(
  Object.entries({
    [argValue("--cc-display-from", "LAMESGIN TILAHUN")]: argValue(
      "--cc-display-to",
      "LAMESGEN TILAHUN",
    ),
  }),
);

const CC_PROFILE_FROM = Number(argValue("--cc-profile-from", "4"));
const CC_PROFILE_TO = Number(argValue("--cc-profile-to", "8"));

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

async function remapCcDisplayName(model) {
  let total = 0;
  for (const [from, to] of CC_DISPLAY_MAP) {
    if (!from || !to || from === to) continue;
    const where = { HotelName: TENANT, ccActorName: from };
    const count = await prisma[model].count({ where });
    if (count === 0) continue;
    if (apply) {
      const res = await prisma[model].updateMany({
        where,
        data: { ccActorName: to },
      });
      total += res.count;
      console.log(`  ${model}.ccActorName: ${from} → ${to} (${res.count})`);
    } else {
      console.log(`  ${model}.ccActorName: would ${from} → ${to} (${count})`);
      total += count;
    }
  }
  return total;
}

async function remapCcProfileId(model) {
  if (
    !Number.isFinite(CC_PROFILE_FROM) ||
    !Number.isFinite(CC_PROFILE_TO) ||
    CC_PROFILE_FROM === CC_PROFILE_TO
  ) {
    return 0;
  }
  const where = { HotelName: TENANT, ccProfileId: CC_PROFILE_FROM };
  const count = await prisma[model].count({ where });
  if (count === 0) return 0;
  if (apply) {
    const res = await prisma[model].updateMany({
      where,
      data: { ccProfileId: CC_PROFILE_TO },
    });
    console.log(
      `  ${model}.ccProfileId: ${CC_PROFILE_FROM} → ${CC_PROFILE_TO} (${res.count})`,
    );
    return res.count;
  }
  console.log(
    `  ${model}.ccProfileId: would ${CC_PROFILE_FROM} → ${CC_PROFILE_TO} (${count})`,
  );
  return count;
}

async function remapStaffLoginsOnTenant() {
  let total = 0;
  for (const [from, to] of USER_MAP) {
    const count = await prisma.user.count({
      where: { tinNumber: TENANT, UserName: from },
    });
    if (count === 0) continue;
    if (apply) {
      const res = await prisma.user.updateMany({
        where: { tinNumber: TENANT, UserName: from },
        data: { UserName: to },
      });
      total += res.count;
      console.log(`  user.UserName: ${from} → ${to} (${res.count})`);
    } else {
      console.log(`  user.UserName: would ${from} → ${to} (${count})`);
      total += count;
    }
  }
  return total;
}

async function migrateCostControllerProfiles() {
  let total = 0;
  for (const [from, to] of CC_DISPLAY_MAP) {
    if (!from || !to || from === to) continue;
    const oldRows = await prisma.costControllerProfile.findMany({
      where: { HotelName: OLD_TIN, displayName: from },
      select: { id: true },
    });
    for (const row of oldRows) {
      const dupOnTenant = await prisma.costControllerProfile.findFirst({
        where: { HotelName: TENANT, displayName: to },
        select: { id: true },
      });
      if (dupOnTenant) {
        const refs = await prisma.purchaseRequest.count({
          where: { HotelName: TENANT, ccProfileId: row.id },
        });
        const refsStock = await prisma.stockOutRequest.count({
          where: { HotelName: TENANT, ccProfileId: row.id },
        });
        const refsReg = await prisma.itemRegistration.count({
          where: { HotelName: TENANT, ccProfileId: row.id },
        });
        const refTotal = refs + refsStock + refsReg;
        if (refTotal === 0 && apply) {
          await prisma.costControllerProfile.delete({ where: { id: row.id } });
          console.log(`  costControllerProfile: deleted orphan id=${row.id}`);
          total += 1;
        } else if (refTotal === 0) {
          console.log(`  costControllerProfile: would delete orphan id=${row.id}`);
          total += 1;
        }
        continue;
      }
      if (apply) {
        await prisma.costControllerProfile.update({
          where: { id: row.id },
          data: { HotelName: TENANT, displayName: to },
        });
        console.log(
          `  costControllerProfile id=${row.id}: HotelName ${OLD_TIN} → ${TENANT}, display ${from} → ${to}`,
        );
        total += 1;
      } else {
        console.log(
          `  costControllerProfile id=${row.id}: would move to ${TENANT} as ${to}`,
        );
        total += 1;
      }
    }
  }
  return total;
}

const USERNAME_JOBS = [
  {
    model: "purchaseRequest",
    fields: ["storeUserName", "financeActorName", "managerActorName"],
  },
  {
    model: "stockOutRequest",
    fields: ["requestedByUserName", "financeActorName", "managerActorName"],
  },
  {
    model: "itemRegistration",
    fields: ["statusBy", "financeActorName", "managerActorName"],
  },
  { model: "itemStatus", fields: ["statusBy"] },
];

const CC_MODELS = ["purchaseRequest", "stockOutRequest", "itemRegistration"];

try {
  console.log(
    `${apply ? "APPLY" : "DRY-RUN"} remap store users on tenant ${JSON.stringify(TENANT)}`,
  );
  console.log("User map:", Object.fromEntries(USER_MAP));
  console.log("CC display map:", Object.fromEntries(CC_DISPLAY_MAP));
  console.log(`CC profile id: ${CC_PROFILE_FROM} → ${CC_PROFILE_TO}`);

  let grand = 0;

  console.log("\nuser (staff logins on destination TIN):");
  grand += await remapStaffLoginsOnTenant();

  for (const { model, fields } of USERNAME_JOBS) {
    console.log(`\n${model} (login usernames):`);
    for (const field of fields) {
      grand += await remapField(model, field);
    }
  }

  console.log("\nCost controller display names (ccActorName):");
  for (const model of CC_MODELS) {
    grand += await remapCcDisplayName(model);
  }

  console.log("\nCost controller profile ids (ccProfileId):");
  for (const model of CC_MODELS) {
    grand += await remapCcProfileId(model);
  }

  console.log("\ncostControllerProfile registry:");
  grand += await migrateCostControllerProfiles();

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
