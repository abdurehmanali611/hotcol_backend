/** Mirrors `lib/subscriptionModules.ts` pricing tiers for backend / scripts. */

const LODGING_TYPES = new Set(["Hotel", "Resort", "Pension"]);

export function isLodgingBusinessType(businessType) {
  return businessType != null && LODGING_TYPES.has(String(businessType).trim());
}

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

export function modulesEmpty(raw) {
  const list = parseModulesJson(raw);
  return list.length === 0;
}

export function calculateSignupPricing(businessType, modules) {
  const set = new Set(modules);
  const hasInv = set.has("Inventory");
  const hasFin = set.has("Financial Management");
  const hasCredit = set.has("Credit Management");
  const bt = businessType != null ? String(businessType).trim() : "";

  if (bt === "Cafe and Restaurant") {
    if (hasCredit) return { setupFeeETB: 35_000, quarterlyFeeETB: 10_000 };
    if (hasInv) return { setupFeeETB: 30_000, quarterlyFeeETB: 7_000 };
    return { setupFeeETB: 25_000, quarterlyFeeETB: 5_000 };
  }

  if (isLodgingBusinessType(bt)) {
    if (hasInv && hasFin && hasCredit) {
      return { setupFeeETB: 35_000, quarterlyFeeETB: 15_000 };
    }
    if (hasInv && hasCredit) {
      return { setupFeeETB: 30_000, quarterlyFeeETB: 10_000 };
    }
    if (hasCredit && !hasInv) {
      return { setupFeeETB: 20_000, quarterlyFeeETB: 7_000 };
    }
    if (hasInv && hasFin) {
      return { setupFeeETB: 30_000, quarterlyFeeETB: 10_000 };
    }
    if (hasInv) return { setupFeeETB: 25_000, quarterlyFeeETB: 10_000 };
    return { setupFeeETB: 0, quarterlyFeeETB: 0 };
  }

  return { setupFeeETB: 0, quarterlyFeeETB: 0 };
}

export function tenantKey(user) {
  const tin =
    user.tinNumber != null && String(user.tinNumber).trim() !== ""
      ? String(user.tinNumber).trim()
      : "";
  return tin || String(user.HotelName || "").trim();
}

export const SUBSCRIPTION_QUARTER_DAYS = 90;

export function daysBetweenCalendar(start, end) {
  const a = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const b = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

export function computeQuarterEndFromCreatedAt(createdAt, paidQuartersCount) {
  const end = new Date(createdAt.getTime());
  end.setDate(end.getDate() + paidQuartersCount * SUBSCRIPTION_QUARTER_DAYS);
  return end;
}

export function paidQuartersFromCreatedAt(createdAt, now = new Date()) {
  const days = Math.max(0, daysBetweenCalendar(createdAt, now));
  return Math.floor(days / SUBSCRIPTION_QUARTER_DAYS) + 1;
}
