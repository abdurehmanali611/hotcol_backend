import { createPrismaClient } from "./prismaClient.js";

export function parseModulesJson(raw) {
  if (raw == null) return [];
  let arr = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr.map(String).filter(Boolean);
}

let _prisma;
function prisma() {
  if (!_prisma) _prisma = createPrismaClient();
  return _prisma;
}

/** Modules that change setup / quarterly tiers (matches signup UI & hardcoded matrix). */
const PRICING_TIER_MODULE_NAMES = new Set([
  "Inventory",
  "Financial Management",
  "Credit Management",
]);

export function modulesForPricingLookup(modules) {
  return parseModulesJson(modules).filter((m) =>
    PRICING_TIER_MODULE_NAMES.has(String(m).trim()),
  );
}

/** @deprecated internal — hardcoded fallback when DB rule missing */
export function calculateSignupPricingHardcoded(businessType, modules) {
  const set = new Set(modulesForPricingLookup(modules));
  const hasInv = set.has("Inventory");
  const hasFin = set.has("Financial Management");
  const hasCredit = set.has("Credit Management");
  const bt = businessType != null ? String(businessType).trim() : "";
  const lodging = ["Hotel", "Resort", "Pension"].includes(bt);

  if (bt === "Cafe and Restaurant") {
    if (hasCredit) return { setupFeeETB: 35_000, quarterlyFeeETB: 10_000 };
    if (hasInv) return { setupFeeETB: 30_000, quarterlyFeeETB: 7_000 };
    return { setupFeeETB: 25_000, quarterlyFeeETB: 5_000 };
  }
  if (lodging) {
    if (hasInv && hasFin && hasCredit) return { setupFeeETB: 35_000, quarterlyFeeETB: 15_000 };
    if (hasInv && hasCredit) return { setupFeeETB: 30_000, quarterlyFeeETB: 10_000 };
    if (hasCredit && !hasInv) return { setupFeeETB: 20_000, quarterlyFeeETB: 7_000 };
    if (hasInv && hasFin) return { setupFeeETB: 30_000, quarterlyFeeETB: 10_000 };
    if (hasInv) return { setupFeeETB: 25_000, quarterlyFeeETB: 10_000 };
    return { setupFeeETB: 0, quarterlyFeeETB: 0 };
  }
  return { setupFeeETB: 0, quarterlyFeeETB: 0 };
}

export function normalizePricingBusinessType(raw) {
  const s = String(raw || "").trim();
  const lower = s.toLowerCase();
  if (
    lower === "cafe" ||
    lower === "café" ||
    lower === "restaurant" ||
    lower === "cafe and restaurant"
  ) {
    return "Cafe and Restaurant";
  }
  if (lower === "hotel") return "Hotel";
  if (lower === "resort") return "Resort";
  if (lower === "pension") return "Pension";
  return s || "Cafe and Restaurant";
}

export function buildModulesKey(modules) {
  const list = modulesForPricingLookup(modules)
    .map((m) => String(m).trim())
    .filter(Boolean);
  return [...new Set(list)].sort((a, b) => a.localeCompare(b)).join("|");
}

export async function findPricingRule(businessType, modules) {
  const bt = normalizePricingBusinessType(businessType);
  const modulesKey = buildModulesKey(modules);
  if (!bt) return null;

  return prisma().subscription_pricing_rule.findFirst({
    where: { businessType: bt, modulesKey, isActive: true },
  });
}

/** Effective pricing: DB catalog first, else default matrix (signup + Apex apply). */
export async function resolveSignupPricing(businessType, modules) {
  const row = await findPricingRule(businessType, modules);
  if (row) {
    return {
      setupFeeETB: row.setupFeeETB,
      quarterlyFeeETB: row.quarterlyFeeETB,
      pricingRuleId: row.id,
      source: "catalog",
    };
  }
  const fees = calculateSignupPricingHardcoded(
    normalizePricingBusinessType(businessType),
    modules,
  );
  return { ...fees, pricingRuleId: null, source: "fallback" };
}

export function calculateSignupPricing(businessType, modules) {
  return calculateSignupPricingHardcoded(
    normalizePricingBusinessType(businessType),
    modules,
  );
}
