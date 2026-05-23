/** Shared hotel inventory approval + status normalization. */

export const ITEM_REG_AUTHORIZED = "AUTHORIZED";
export const ITEM_REG_VOID = "VOID";

/** Purchase request is fully authorized for store receiving. */
export function isPurchaseRequestAuthorized(status) {
  const s = String(status || "");
  return s === "AUTHORIZED" || s === "APPROVED_FINANCE";
}

export function isItemRegistrationActive(approvalStatus) {
  const s = String(approvalStatus || "");
  if (!s || s === ITEM_REG_AUTHORIZED) return true;
  return s === ITEM_REG_AUTHORIZED;
}

export function itemRegistrationInventoryWhere() {
  return {
    OR: [
      { approvalStatus: ITEM_REG_AUTHORIZED },
      /** Legacy rows created before approval workflow (empty string only). */
      { approvalStatus: "" },
    ],
  };
}

/** Map legacy stock status to new workflow codes. */
export function normalizeStockOutStatus(status) {
  if (status === "PENDING") return "PENDING_CC";
  return status;
}

export function isStockOutPendingCC(status) {
  const s = normalizeStockOutStatus(status);
  return s === "PENDING_CC";
}

export function isStockOutPendingFinance(status) {
  return status === "PENDING_FINANCE";
}

export function isStockOutPendingManager(status) {
  return status === "PENDING_MANAGER";
}

export function isCompanyAuthorized(row) {
  const s = String(row?.approvalStatus || "AUTHORIZED");
  return s === "AUTHORIZED" || s === "";
}
