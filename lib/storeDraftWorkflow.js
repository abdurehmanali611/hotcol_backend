/** Store review step before requests reach cost control (first approver). */

export const PENDING_STORE = "PENDING_STORE";

export function assertStoreUser(context) {
  if (!context?.user) throw new Error("Not Authenticated");
  if (context.user.Role !== "Store") {
    throw new Error("Only store staff can manage draft requests");
  }
  return String(context.user.UserName ?? "").trim();
}

export function matchesStoreOwner(actualName, storeUserName) {
  return (
    String(actualName ?? "").trim() === String(storeUserName ?? "").trim()
  );
}

export function assertPurchasePendingStore(row) {
  if (row.status !== PENDING_STORE) {
    throw new Error("Request is not awaiting your review");
  }
}

export function assertStockPendingStore(row) {
  if (row.status !== PENDING_STORE) {
    throw new Error("Movement is not awaiting your review");
  }
}

export function assertRegistrationPendingStore(row) {
  if (row.approvalStatus !== PENDING_STORE) {
    throw new Error("Registration is not awaiting your review");
  }
}

export function assertPurchaseAuthorizedForManagerEdit(row) {
  const s = String(row?.status ?? "").trim().toUpperCase();
  if (s !== "AUTHORIZED" && s !== "APPROVED_FINANCE") {
    throw new Error("Only manager-authorized purchase requests can be changed");
  }
}
