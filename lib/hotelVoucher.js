/** Per-hotel sequential voucher numbers (display: 0001, 0010, 0100, …). */

/** One shared sequence per property for PRs, registrations, movements, and status rows. */
export const UNIFIED_VOUCHER_TYPE = "HOTEL";

/** @deprecated Use {@link UNIFIED_VOUCHER_TYPE} — kept for imports that reference legacy names. */
export const VOUCHER_TYPES = {
  PURCHASE_REQUEST: UNIFIED_VOUCHER_TYPE,
  ITEM_REGISTRATION: UNIFIED_VOUCHER_TYPE,
  STOCK_MOVEMENT: UNIFIED_VOUCHER_TYPE,
};

/** Minimum 4 digits with leading zeros; longer when number exceeds 9999. */
export function formatVoucherNumber(seq) {
  const n = Math.max(1, Math.floor(Number(seq) || 0));
  const s = String(n);
  return s.length >= 4 ? s : s.padStart(4, "0");
}

function normalizeHotelKeys(hotelName, hotelNameAliases) {
  const keys = new Set();
  const add = (v) => {
    const s = String(v ?? "").trim();
    if (s) keys.add(s);
  };
  add(hotelName);
  if (Array.isArray(hotelNameAliases)) {
    for (const a of hotelNameAliases) add(a);
  }
  const list = [...keys];
  if (list.length === 0) throw new Error("Hotel scope required for voucher");
  return list;
}

/**
 * Highest voucher sequence already stored for this property (any document table).
 * Includes legacy per-type counter rows so migrations never restart at 0001.
 */
export async function resolveMaxExistingVoucherNumber(tx, hotelNames) {
  const where = { HotelName: { in: hotelNames } };
  const [pr, reg, stat, stock, counters] = await Promise.all([
    tx.purchaseRequest.aggregate({ where, _max: { voucherNumber: true } }),
    tx.itemRegistration.aggregate({ where, _max: { voucherNumber: true } }),
    tx.itemStatus.aggregate({ where, _max: { voucherNumber: true } }),
    tx.stockOutRequest.aggregate({ where, _max: { voucherNumber: true } }),
    tx.hotelVoucherCounter.findMany({ where: { HotelName: { in: hotelNames } } }),
  ]);

  let max = 0;
  for (const agg of [pr, reg, stat, stock]) {
    max = Math.max(max, Math.floor(Number(agg._max?.voucherNumber) || 0));
  }
  for (const c of counters) {
    max = Math.max(max, Math.floor(Number(c.lastNumber) || 0));
  }
  return max;
}

/**
 * Atomically allocate the next voucher sequence for a hotel (shared across document types).
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} hotelName — canonical tenant key (usually TIN)
 * @param {string} [_legacyType] — ignored; kept for call-site compatibility
 * @param {string[]} [hotelNameAliases] — TIN, display name, legacy keys for seeding max
 */
export async function allocateVoucherNumber(
  prisma,
  hotelName,
  _legacyType,
  hotelNameAliases,
) {
  const names = normalizeHotelKeys(hotelName, hotelNameAliases);
  const hotelKey = names[0];

  const row = await prisma.$transaction(async (tx) => {
    const existing = await tx.hotelVoucherCounter.findUnique({
      where: {
        HotelName_voucherType: {
          HotelName: hotelKey,
          voucherType: UNIFIED_VOUCHER_TYPE,
        },
      },
    });
    if (existing) {
      return await tx.hotelVoucherCounter.update({
        where: { id: existing.id },
        data: { lastNumber: { increment: 1 } },
      });
    }

    const seed = await resolveMaxExistingVoucherNumber(tx, names);
    return await tx.hotelVoucherCounter.create({
      data: {
        HotelName: hotelKey,
        voucherType: UNIFIED_VOUCHER_TYPE,
        lastNumber: seed + 1,
      },
    });
  });

  return {
    voucherNumber: row.lastNumber,
    voucherDisplay: formatVoucherNumber(row.lastNumber),
  };
}
