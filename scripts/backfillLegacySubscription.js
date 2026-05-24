/**
 * One-time / repeatable backfill for legacy cafés & hotels:
 * - Copy Manager/Admin modules to staff rows missing modules
 * - Mark setup as paid; derive fees from module selection
 * - Anchor billing quarters to user.createdAt (day 1)
 *
 * Run from BackEnd/: node scripts/backfillLegacySubscription.js
 */
import { PrismaClient } from "../generated/prisma/index.js";
import {
  calculateSignupPricing,
  computeQuarterEndFromCreatedAt,
  modulesEmpty,
  paidQuartersFromCreatedAt,
  parseModulesJson,
  tenantKey,
} from "../lib/subscriptionPricing.js";

const prisma = new PrismaClient();

const LEGACY_HOTEL_HINTS = [
  "apex hotel",
  "gebretsadik",
  "ella kitchen",
];

function matchesLegacyHint(hotelName) {
  const h = String(hotelName || "").toLowerCase();
  return LEGACY_HOTEL_HINTS.some((hint) => h.includes(hint));
}

async function main() {
  const allUsers = await prisma.user.findMany({ orderBy: { id: "asc" } });
  const byTenant = new Map();

  for (const u of allUsers) {
    const key = tenantKey(u);
    if (!key) continue;
    if (!byTenant.has(key)) byTenant.set(key, []);
    byTenant.get(key).push(u);
  }

  let modulesCopied = 0;
  let tenantsBackfilled = 0;

  for (const [key, members] of byTenant) {
    const owner =
      members.find(
        (m) =>
          (m.Role === "Manager" || m.Role === "Admin") &&
          !modulesEmpty(m.modules),
      ) ||
      members.find((m) => m.Role === "Manager" || m.Role === "Admin");

    if (!owner) continue;

    const ownerModules = parseModulesJson(owner.modules);
    if (ownerModules.length === 0) {
      console.warn(`[skip] ${key}: owner has no modules — set Manager modules first`);
      continue;
    }

    for (const staff of members) {
      if (staff.id === owner.id) continue;
      if (!modulesEmpty(staff.modules)) continue;
      if (!["Store", "Finance", "CostControl", "HotelCashier", "Cashier", "Kitchen", "Barista"].includes(staff.Role)) {
        continue;
      }

      await prisma.user.update({
        where: { id: staff.id },
        data: { modules: ownerModules },
      });
      modulesCopied++;
      const label = `${staff.UserName} (${staff.Role}) @ ${staff.HotelName}`;
      console.log(`[modules] ${label} ← owner modules`);
      if (matchesLegacyHint(staff.HotelName)) {
        console.log(`  ↳ legacy property match: ${staff.HotelName}`);
      }
    }

    const anchor = owner.createdAt ? new Date(owner.createdAt) : new Date();
    const pricing = calculateSignupPricing(owner.businessType, ownerModules);
    const billingApplies = pricing.quarterlyFeeETB > 0;
    const paidQuarters = billingApplies
      ? paidQuartersFromCreatedAt(anchor)
      : 0;
    const paidUntil = billingApplies
      ? computeQuarterEndFromCreatedAt(anchor, paidQuarters)
      : null;

    const ownerUpdate = {
      modules: ownerModules,
      setupFeeETB: pricing.setupFeeETB,
      quarterlyFeeETB: pricing.quarterlyFeeETB,
      setupFeeApproved: true,
      subscriptionPaymentApproved: billingApplies,
      paidQuartersCount: billingApplies ? paidQuarters : 0,
      subscriptionPaidUntil: paidUntil,
    };

    await prisma.user.update({
      where: { id: owner.id },
      data: ownerUpdate,
    });

    for (const member of members) {
      if (member.id === owner.id) continue;
      const patch = {};
      if (modulesEmpty(member.modules)) {
        patch.modules = ownerModules;
      }
      if (member.Role === "Admin" || member.Role === "Manager") {
        Object.assign(patch, ownerUpdate);
      }
      if (Object.keys(patch).length > 0) {
        await prisma.user.update({ where: { id: member.id }, data: patch });
      }
    }

    tenantsBackfilled++;
    console.log(
      `[billing] ${owner.HotelName} (${key}): setup paid, ${ownerModules.join(", ")} → ${pricing.setupFeeETB}/${pricing.quarterlyFeeETB} ETB, Q${paidQuarters} until ${paidUntil?.toISOString?.() ?? "n/a"}`,
    );
  }

  console.log(
    `\nDone. Modules copied to ${modulesCopied} staff row(s); ${tenantsBackfilled} tenant(s) billing backfilled.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
