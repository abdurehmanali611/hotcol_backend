/** Per-hotel sequential voucher numbers (display: 0001, 0010, 0100, …). */

export const VOUCHER_TYPES = {
  PURCHASE_REQUEST: "PURCHASE_REQUEST",
  ITEM_REGISTRATION: "ITEM_REGISTRATION",
  STOCK_MOVEMENT: "STOCK_MOVEMENT",
};

/** Minimum 4 digits with leading zeros; longer when number exceeds 9999. */
export function formatVoucherNumber(seq) {
  const n = Math.max(1, Math.floor(Number(seq) || 0));
  const s = String(n);
  return s.length >= 4 ? s : s.padStart(4, "0");
}

/**
 * Atomically allocate the next voucher sequence for a hotel + document type.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} hotelName
 * @param {string} voucherType
 */
export async function allocateVoucherNumber(prisma, hotelName, voucherType) {
  const hotel = String(hotelName || "").trim();
  if (!hotel) throw new Error("Hotel scope required for voucher");
  const type = String(voucherType || "").trim();
  if (!Object.values(VOUCHER_TYPES).includes(type)) {
    throw new Error(`Invalid voucher type: ${type}`);
  }

  const row = await prisma.$transaction(async (tx) => {
    const existing = await tx.hotelVoucherCounter.findUnique({
      where: { HotelName_voucherType: { HotelName: hotel, voucherType: type } },
    });
    if (existing) {
      return await tx.hotelVoucherCounter.update({
        where: { id: existing.id },
        data: { lastNumber: { increment: 1 } },
      });
    }
    return await tx.hotelVoucherCounter.create({
      data: { HotelName: hotel, voucherType: type, lastNumber: 1 },
    });
  });

  return {
    voucherNumber: row.lastNumber,
    voucherDisplay: formatVoucherNumber(row.lastNumber),
  };
}
