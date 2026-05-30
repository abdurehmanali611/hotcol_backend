import "dotenv/config";
import { createPrismaClient } from "../lib/prismaClient.js";
import {
  buildModulesKey,
  calculateSignupPricingHardcoded,
  normalizePricingBusinessType,
} from "../lib/pricingRules.js";

const prisma = createPrismaClient();
const BUSINESS_TYPES = ["Cafe and Restaurant", "Hotel", "Resort", "Pension"];

function moduleSetsForBusinessType(bt) {
  if (bt === "Cafe and Restaurant") {
    return [[], ["Inventory"], ["Credit Management"], ["Inventory", "Credit Management"]];
  }
  return [
    [],
    ["Inventory"],
    ["Financial Management"],
    ["Credit Management"],
    ["Inventory", "Financial Management"],
    ["Inventory", "Credit Management"],
    ["Inventory", "Financial Management", "Credit Management"],
  ];
}

async function main() {
  let n = 0;
  for (const bt of BUSINESS_TYPES) {
    for (const modules of moduleSetsForBusinessType(bt)) {
      const normalized = normalizePricingBusinessType(bt);
      const modulesKey = buildModulesKey(modules);
      const fees = calculateSignupPricingHardcoded(normalized, modules);
      const description = modules.length
        ? modules.join(", ")
        : "Base (no add-on modules)";

      await prisma.subscription_pricing_rule.upsert({
        where: {
          businessType_modulesKey: {
            businessType: normalized,
            modulesKey,
          },
        },
        create: {
          businessType: normalized,
          modulesKey,
          modules,
          setupFeeETB: fees.setupFeeETB,
          quarterlyFeeETB: fees.quarterlyFeeETB,
          description,
          sortOrder: n++,
          isActive: true,
        },
        update: {
          modules,
          setupFeeETB: fees.setupFeeETB,
          quarterlyFeeETB: fees.quarterlyFeeETB,
          description,
          isActive: true,
        },
      });
    }
  }
  const count = await prisma.subscription_pricing_rule.count();
  console.log(`Pricing catalog ready: ${count} rules`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
