/** Shared hotel inventory approval + status normalization. */

export const ITEM_REG_AUTHORIZED = "AUTHORIZED";
export const ITEM_REG_VOID = "VOID";

/** Purchase request is fully authorized for store receiving. */
export function isPurchaseRequestAuthorized(status) {
  const s = String(status || "");
  return s === "AUTHORIZED" || s === "APPROVED_FINANCE";
}

export function isPurchasePendingStore(status) {
  return String(status || "") === "PENDING_STORE";
}

export function isItemRegistrationActive(approvalStatus) {
  const s = String(approvalStatus || "");
  if (!s || s === ITEM_REG_AUTHORIZED) return true;
  return s === ITEM_REG_AUTHORIZED;
}

function normRegistrationStr(value) {
  return String(value ?? "").trim();
}

function normRegistrationNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** True when incoming payload matches the row except for a lower on-hand quantity. */
export function isStoreInventoryQuantityAdjustment(existing, newAmount, incoming) {
  if (!isItemRegistrationActive(existing.approvalStatus)) return false;
  const previous = normRegistrationNum(existing.amount);
  const next = normRegistrationNum(newAmount);
  if (!(next >= 0 && next < previous)) return false;

  const sameDate = (a, b) =>
    new Date(a).getTime() === new Date(b).getTime();

  return (
    normRegistrationStr(existing.name) === normRegistrationStr(incoming.name) &&
    normRegistrationStr(existing.imageUrl) ===
      normRegistrationStr(incoming.imageUrl) &&
    normRegistrationStr(existing.category) ===
      normRegistrationStr(incoming.category) &&
    normRegistrationStr(existing.measuredBy) ===
      normRegistrationStr(incoming.measuredBy) &&
    normRegistrationNum(existing.unitPrice) ===
      normRegistrationNum(incoming.unitPrice) &&
    sameDate(existing.registrationDate, incoming.registrationDate) &&
    sameDate(existing.expireDate, incoming.expireDate) &&
    normRegistrationStr(existing.supplierName) ===
      normRegistrationStr(incoming.supplierName) &&
    normRegistrationStr(existing.supplierPhone) ===
      normRegistrationStr(incoming.supplierPhone) &&
    normRegistrationStr(existing.Address) === normRegistrationStr(incoming.Address) &&
    Boolean(existing.purchaseWithVat !== false) ===
      Boolean(incoming.purchaseWithVat !== false) &&
    normRegistrationStr(existing.supplierTinNumber) ===
      normRegistrationStr(incoming.supplierTinNumber) &&
    normRegistrationNum(existing.paidAmount) ===
      normRegistrationNum(incoming.paidAmount)
  );
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

/** Store terminal: inventory, drafts, and in-pipeline rows for request status. */
export function itemRegistrationStoreReadWhere() {
  return {
    NOT: { approvalStatus: ITEM_REG_VOID },
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
