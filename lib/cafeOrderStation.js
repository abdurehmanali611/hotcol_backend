/** Shared kitchen/bar routing — keep in sync with `lib/cafeOrderStation.ts` on the frontend. */

export function orderCategoryKey(category) {
  return String(category ?? "").trim().toLowerCase();
}

/** Food queue (Chef terminal): category food/others, or non-bar type. */
export function isKitchenStationOrder(order) {
  const c = orderCategoryKey(order?.category);
  if (c === "food" || c === "others") return true;
  const t = String(order?.type ?? "").trim().toLowerCase();
  if (t === "bar" || t === "beverage") return false;
  if (t === "kitchen" || t === "food") return true;
  return false;
}

/** Beverage queue (Bar terminal). */
export function isBarStationOrder(order) {
  const c = orderCategoryKey(order?.category);
  if (c === "beverage") return true;
  const t = String(order?.type ?? "").trim().toLowerCase();
  return t === "bar" || t === "beverage";
}
