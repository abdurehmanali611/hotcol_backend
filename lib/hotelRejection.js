/** Rejection reason is required for hotel workflow reject mutations. */
export function requireRejectionReason(reason) {
  const text = String(reason ?? "").trim();
  if (!text) {
    throw new Error("Rejection reason is required");
  }
  if (text.length > 2000) {
    throw new Error("Rejection reason is too long (max 2000 characters)");
  }
  return text;
}
