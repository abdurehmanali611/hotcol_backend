/**
 * Legacy tenant billing backfill:
 * - Copy Manager modules to staff missing modules
 * - Apply name-based policies (illustration, discounts)
 * - On-hold tenants: no quarter counting until ReleaseTenantBillingHold
 *
 * Run from BackEnd/: node scripts/backfillLegacySubscription.js
 */
import { PrismaClient } from "../generated/prisma/index.js";
import {
  calculateSignupPricing,
  computeQuarterEndFromCreatedAt,
  modulesEmpty,
  parseModulesJson,
  tenantKey,
} from "../lib/subscriptionPricing.js";
import {
  tenantNamePolicy,
  resolveBillingAnchor,
  paidQuartersFromAnchor,
} from "../lib/tenantBilling.js";

const prisma = new PrismaClient();

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
  let tenantsUpdated = 0;

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
      console.warn(`[skip] ${key}: owner has no modules`);
      continue;
    }

    for (const staff of members) {
      if (staff.id === owner.id) continue;
      if (!modulesEmpty(staff.modules)) continue;
      if (
        ![
          "Store",
          "Finance",
          "CostControl",
          "HotelCashier",
          "Cashier",
          "Kitchen",
          "Barista",
        ].includes(staff.Role)
      ) {
        continue;
      }

      await prisma.user.update({
        where: { id: staff.id },
        data: { modules: ownerModules },
      });
      modulesCopied++;
      console.log(
        `[modules] ${staff.UserName} (${staff.Role}) @ ${staff.HotelName}`,
      );
    }

    const policy = tenantNamePolicy(owner.HotelName) ?? {};
    const pricing = calculateSignupPricing(owner.businessType, ownerModules);
    const isIllustration = Boolean(policy.isIllustrationTenant);

    let setupFeeETB =
      policy.setupFeeETB != null ? policy.setupFeeETB : pricing.setupFeeETB;
    let quarterlyFeeETB = isIllustration ? 0 : pricing.quarterlyFeeETB;
    let billingHold = owner.billingHold;
    let billingStartedAt = owner.billingStartedAt;
    let paidQuartersCount = owner.paidQuartersCount ?? 0;
    let subscriptionPaidUntil = owner.subscriptionPaidUntil;
    let subscriptionPaymentApproved = owner.subscriptionPaymentApproved;

    if (isIllustration) {
      billingHold = false;
      setupFeeETB = 0;
      quarterlyFeeETB = 0;
      paidQuartersCount = 0;
      subscriptionPaidUntil = null;
      subscriptionPaymentApproved = true;
      billingStartedAt = null;
    } else if (billingHold) {
      billingStartedAt = null;
      paidQuartersCount = 0;
      subscriptionPaidUntil = null;
    } else {
      const anchor = resolveBillingAnchor({
        billingHold: false,
        billingStartedAt,
        createdAt: owner.createdAt,
      });
      if (anchor && quarterlyFeeETB > 0) {
        paidQuartersCount = paidQuartersFromAnchor(anchor);
        subscriptionPaidUntil = computeQuarterEndFromCreatedAt(
          anchor,
          paidQuartersCount,
        );
        subscriptionPaymentApproved = true;
      }
    }

    const ownerUpdate = {
      modules: ownerModules,
      setupFeeETB,
      quarterlyFeeETB,
      setupFeeApproved: isIllustration || setupFeeETB === 0 || true,
      isIllustrationTenant: isIllustration,
      billingHold,
      billingStartedAt,
      billingNotes: policy.billingNotes ?? owner.billingNotes,
      subscriptionPaymentApproved,
      paidQuartersCount,
      subscriptionPaidUntil,
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

    tenantsUpdated++;
    console.log(
      `[billing] ${owner.HotelName}: illustration=${isIllustration} hold=${billingHold} setup=${setupFeeETB} quarterly=${quarterlyFeeETB}`,
    );
  }

  console.log(
    `\nDone. ${modulesCopied} staff module(s); ${tenantsUpdated} tenant(s) updated.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
