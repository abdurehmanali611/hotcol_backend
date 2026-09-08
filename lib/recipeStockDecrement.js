/**
 * Recipe → station stock decrement when kitchen/bar completes an order line.
 * Keep ingredient parse helpers aligned with cafeRecipe.js.
 */

import {
  isBarStationOrder,
  isKitchenStationOrder,
} from "./cafeOrderStation.js";
import { parseMenuRecipe } from "./cafeRecipe.js";

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function normalizeItemNameKey(name) {
  return String(name ?? "")
    .trim()
    .toLowerCase();
}

/** Station that owns the finished menu line (KITCHEN | BAR). */
export function stationKeyForCompletedOrder(order) {
  if (isBarStationOrder(order)) return "BAR";
  if (isKitchenStationOrder(order)) return "KITCHEN";
  return "KITCHEN";
}

/** True when a stock-out destination should feed station ingredient stock. */
export function isRecipeStationKey(stationKey) {
  return stationKey === "KITCHEN" || stationKey === "BAR";
}

async function findStationStockRow(client, hotelName, station, itemName) {
  const key = normalizeItemNameKey(itemName);
  if (!key) return null;
  const rows = await client.stationIngredientStock.findMany({
    where: { HotelName: hotelName, station },
  });
  return (
    rows.find((r) => normalizeItemNameKey(r.itemName) === key) || null
  );
}

async function findMenuItemRecipe(client, hotelName, title) {
  const key = normalizeItemNameKey(title);
  if (!key) return null;
  const items = await client.item.findMany({
    where: { HotelName: hotelName },
    select: { recipeJson: true, name: true },
  });
  const menuItem = items.find((i) => normalizeItemNameKey(i.name) === key);
  if (!menuItem) return null;
  return { menuItem, recipe: parseMenuRecipe(menuItem.recipeJson) };
}

/**
 * One-time (per empty ledger) rebuild from historical stock-outs − consumptions
 * so existing kitchens are not starting from a blank on-hand after deploy.
 */
export async function ensureStationIngredientStockSeeded(
  client,
  hotelName,
  normalizeStation,
) {
  const hotel = String(hotelName || "").trim();
  if (!hotel || typeof normalizeStation !== "function") return;

  const existing = await client.stationIngredientStock.count({
    where: { HotelName: hotel },
  });
  if (existing > 0) return;

  /** @type {Map<string, { station: string, itemName: string, measuredBy: string, unitPrice: number, amount: number }>} */
  const map = new Map();

  const bump = (stationKey, itemName, amount, measuredBy, unitPrice, sign) => {
    const station = String(stationKey || "").trim().toUpperCase();
    if (!isRecipeStationKey(station)) return;
    const name = String(itemName || "").trim();
    const qty = round2(Number(amount) || 0);
    if (!name || !(qty > 0)) return;
    const key = `${station}\t${normalizeItemNameKey(name)}`;
    const row = map.get(key) || {
      station,
      itemName: name,
      measuredBy: String(measuredBy || "").trim(),
      unitPrice: Number(unitPrice) || 0,
      amount: 0,
    };
    row.amount = round2(row.amount + sign * qty);
    if (measuredBy) row.measuredBy = String(measuredBy).trim();
    if (Number(unitPrice) > 0) row.unitPrice = Number(unitPrice);
    map.set(key, row);
  };

  const cafeStatuses = await client.itemStatus.findMany({
    where: {
      HotelName: hotel,
      status: "Stock Out",
      stockOutRequestId: null,
    },
    select: {
      name: true,
      amount: true,
      measuredBy: true,
      unitPrice: true,
      statusBy: true,
    },
  });
  for (const s of cafeStatuses) {
    bump(
      normalizeStation(s.statusBy),
      s.name,
      s.amount,
      s.measuredBy,
      s.unitPrice,
      1,
    );
  }

  const hotelOuts = await client.stockOutRequest.findMany({
    where: {
      HotelName: hotel,
      status: "APPROVED",
      movementType: "STOCK_OUT",
    },
    select: {
      itemNameSnapshot: true,
      amount: true,
      stakeHolderOrReason: true,
      itemRegistrationId: true,
    },
  });
  const regIds = [
    ...new Set(
      hotelOuts
        .map((r) => Number(r.itemRegistrationId))
        .filter((id) => id > 0),
    ),
  ];
  const regs =
    regIds.length > 0
      ? await client.itemRegistration.findMany({
          where: { id: { in: regIds } },
          select: { id: true, name: true, unitPrice: true, measuredBy: true },
        })
      : [];
  const regById = new Map(regs.map((r) => [r.id, r]));
  for (const o of hotelOuts) {
    const reg = regById.get(Number(o.itemRegistrationId));
    const itemName =
      String(o.itemNameSnapshot || "").trim() ||
      String(reg?.name || "").trim();
    bump(
      normalizeStation(o.stakeHolderOrReason),
      itemName,
      o.amount,
      reg?.measuredBy,
      reg?.unitPrice,
      1,
    );
  }

  const consumptions = await client.recipeStockConsumption.findMany({
    where: { HotelName: hotel },
    select: {
      station: true,
      ingredientName: true,
      amount: true,
      measuredBy: true,
      unitPrice: true,
    },
  });
  for (const c of consumptions) {
    bump(
      c.station,
      c.ingredientName,
      c.amount,
      c.measuredBy,
      c.unitPrice,
      -1,
    );
  }

  const rows = [...map.values()].map((r) => ({
    HotelName: hotel,
    station: r.station,
    itemName: r.itemName,
    measuredBy: r.measuredBy,
    unitPrice: r.unitPrice,
    amount: round2(Math.max(0, r.amount)),
  }));
  if (rows.length === 0) return;
  await client.stationIngredientStock.createMany({ data: rows });
}

/**
 * Increase on-hand at kitchen/bar after store stocks out ingredients.
 */
export async function creditStationIngredientStock(
  client,
  {
    hotelName,
    stationKey,
    itemName,
    amount,
    measuredBy = "",
    unitPrice = 0,
    normalizeStation,
  },
) {
  const station = String(stationKey || "").trim().toUpperCase();
  if (!isRecipeStationKey(station)) return null;
  const name = String(itemName || "").trim();
  const qty = round2(Number(amount) || 0);
  if (!name || !(qty > 0)) return null;

  if (typeof normalizeStation === "function") {
    const before = await client.stationIngredientStock.count({
      where: { HotelName: hotelName },
    });
    if (before === 0) {
      await ensureStationIngredientStockSeeded(
        client,
        hotelName,
        normalizeStation,
      );
      const after = await client.stationIngredientStock.count({
        where: { HotelName: hotelName },
      });
      // History rebuild already includes this stock-out — don't double-credit.
      if (after > 0) {
        return findStationStockRow(client, hotelName, station, name);
      }
    }
  }

  const existing = await findStationStockRow(client, hotelName, station, name);

  if (existing) {
    return client.stationIngredientStock.update({
      where: { id: existing.id },
      data: {
        amount: round2(Number(existing.amount) + qty),
        measuredBy: String(measuredBy || existing.measuredBy || "").trim(),
        unitPrice:
          Number(unitPrice) > 0
            ? Number(unitPrice)
            : Number(existing.unitPrice) || 0,
        itemName: name,
      },
    });
  }

  return client.stationIngredientStock.create({
    data: {
      HotelName: hotelName,
      station,
      itemName: name,
      measuredBy: String(measuredBy || "").trim(),
      unitPrice: Number(unitPrice) || 0,
      amount: qty,
    },
  });
}

/**
 * Deduct recipe qty from station stock. Clamps at 0; returns shortfall.
 */
export async function debitStationIngredientStock(
  client,
  {
    hotelName,
    stationKey,
    itemName,
    amount,
    measuredBy = "",
    unitPrice = 0,
    normalizeStation,
  },
) {
  const station = String(stationKey || "").trim().toUpperCase();
  const name = String(itemName || "").trim();
  const needed = round2(Number(amount) || 0);
  if (!isRecipeStationKey(station) || !name || !(needed > 0)) {
    return { applied: 0, shortfall: needed > 0 ? needed : 0 };
  }

  if (typeof normalizeStation === "function") {
    await ensureStationIngredientStockSeeded(
      client,
      hotelName,
      normalizeStation,
    );
  }

  const existing = await findStationStockRow(client, hotelName, station, name);

  if (!existing) {
    await client.stationIngredientStock.create({
      data: {
        HotelName: hotelName,
        station,
        itemName: name,
        measuredBy: String(measuredBy || "").trim(),
        unitPrice: Number(unitPrice) || 0,
        amount: 0,
      },
    });
    return { applied: 0, shortfall: needed };
  }

  const onHand = round2(Number(existing.amount) || 0);
  const applied = round2(Math.min(onHand, needed));
  const shortfall = round2(Math.max(0, needed - applied));
  const next = round2(Math.max(0, onHand - applied));

  await client.stationIngredientStock.update({
    where: { id: existing.id },
    data: {
      amount: next,
      measuredBy:
        String(measuredBy || existing.measuredBy || "").trim() ||
        existing.measuredBy,
      unitPrice:
        Number(unitPrice) > 0
          ? Number(unitPrice)
          : Number(existing.unitPrice) || 0,
    },
  });

  return { applied, shortfall };
}

/**
 * When a daily-count row exists for this station+ingredient+day, bump salesDay
 * so hotel closing on-hand stays aligned with recipe consumption.
 */
export async function bumpKitchenBarSalesForRecipe(
  client,
  {
    hotelName,
    stationKey,
    itemName,
    calendarDateYmd,
    qty,
    normalizeStation,
    kitchenBarStationPrismaWhere,
    sumApprovedStockOutToStation,
    findPreviousKitchenBarRow,
    computeClosingOnHand,
  },
) {
  const station = String(stationKey || "").trim().toUpperCase();
  const name = String(itemName || "").trim();
  const day = String(calendarDateYmd || "").trim().slice(0, 10);
  const delta = round2(Number(qty) || 0);
  if (!isRecipeStationKey(station) || !name || !day || !(delta > 0)) return;

  const stationNorm = normalizeStation(station);
  const candidates = await client.kitchenBarBeginning.findMany({
    where: {
      HotelName: hotelName,
      calendarDate: day,
      ...kitchenBarStationPrismaWhere(stationNorm),
    },
  });
  const key = normalizeItemNameKey(name);
  const row = candidates.find(
    (r) => normalizeItemNameKey(r.itemName) === key,
  );
  if (!row) return;

  const currentSales =
    row.salesDay != null && Number.isFinite(Number(row.salesDay))
      ? round2(Number(row.salesDay) || 0)
      : 0;
  const nextSales = round2(currentSales + delta);
  const sum = await sumApprovedStockOutToStation(
    client,
    hotelName,
    stationNorm,
    String(row.itemName).trim(),
    day,
  );
  const prev = await findPreviousKitchenBarRow(
    client,
    hotelName,
    stationNorm,
    String(row.itemName).trim(),
    day,
  );
  const closing = round2(
    computeClosingOnHand(
      Number(row.amount),
      sum,
      Number(row.managementTakenDay ?? 0),
      prev,
      Number(row.invitationTakenDay ?? 0),
      nextSales,
    ),
  );

  await client.kitchenBarBeginning.update({
    where: { id: row.id },
    data: {
      salesDay: nextSales,
      stockOutDay: round2(sum),
      closingOnHand: closing,
    },
  });
}

/**
 * Apply recipe stock deduction for a newly completed café order line.
 * Idempotent per orderId. No-ops when Inventory module is off or no recipe.
 */
export async function applyRecipeStockDecrementOnComplete(
  client,
  {
    order,
    completedBy = "",
    modules,
    tenantHasModule,
    calendarDateYmd,
    normalizeStation,
    kitchenBarStationPrismaWhere,
    sumApprovedStockOutToStation,
    findPreviousKitchenBarRow,
    computeClosingOnHand,
  },
) {
  if (!order?.id) return { skipped: true, reason: "no-order" };
  if (!tenantHasModule(modules, "Inventory")) {
    return { skipped: true, reason: "no-inventory-module" };
  }

  const already = await client.recipeStockConsumption.count({
    where: { orderId: order.id },
  });
  if (already > 0) return { skipped: true, reason: "already-consumed" };

  const hotelName = String(order.HotelName || "").trim();
  if (!hotelName) return { skipped: true, reason: "no-hotel" };

  const title = String(order.title || "").trim();
  const servings = Math.max(0, Math.floor(Number(order.orderAmount) || 0));
  if (!title || servings <= 0) {
    return { skipped: true, reason: "empty-line" };
  }

  const found = await findMenuItemRecipe(client, hotelName, title);
  const recipe = found?.recipe;
  if (!recipe?.ingredients?.length) {
    return { skipped: true, reason: "no-recipe" };
  }

  const station = stationKeyForCompletedOrder(order);
  const day = String(calendarDateYmd || "").trim().slice(0, 10);
  const actor = String(completedBy || "").trim();
  const created = [];

  await ensureStationIngredientStockSeeded(
    client,
    hotelName,
    normalizeStation,
  );

  for (const ing of recipe.ingredients) {
    const ingredientName = String(ing.name || "").trim();
    const perServing = round2(Number(ing.amount) || 0);
    if (!ingredientName || !(perServing > 0)) continue;

    const totalQty = round2(perServing * servings);
    const { shortfall } = await debitStationIngredientStock(client, {
      hotelName,
      stationKey: station,
      itemName: ingredientName,
      amount: totalQty,
      measuredBy: ing.measuredBy,
      unitPrice: ing.unitPrice,
      normalizeStation,
    });

    await bumpKitchenBarSalesForRecipe(client, {
      hotelName,
      stationKey: station,
      itemName: ingredientName,
      calendarDateYmd: day,
      qty: totalQty,
      normalizeStation,
      kitchenBarStationPrismaWhere,
      sumApprovedStockOutToStation,
      findPreviousKitchenBarRow,
      computeClosingOnHand,
    });

    const row = await client.recipeStockConsumption.create({
      data: {
        HotelName: hotelName,
        orderId: order.id,
        menuItemTitle: title,
        orderAmount: servings,
        station,
        ingredientName,
        amount: totalQty,
        measuredBy: String(ing.measuredBy || "").trim(),
        unitPrice: Number(ing.unitPrice) || 0,
        shortfallAmount: shortfall,
        completedBy: actor,
      },
    });
    created.push(row);
  }

  return { skipped: false, rows: created, station };
}

export { normalizeItemNameKey, round2 as roundRecipeStock2 };
