import { createPrismaClient } from "../lib/prismaClient.js";

const ILLUSTRATION_NAME_NEEDLES = [
  "apex cafe and restaurant",
  "apexanalog cafe and restaurant",
  "apex hotel",
  "apexanalog hotel",
];

function normalizeHotel(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const prisma = createPrismaClient();

try {
  const users = await prisma.user.findMany({
    select: {
      HotelName: true,
      tinNumber: true,
      isIllustrationTenant: true,
      Role: true,
      businessType: true,
    },
  });

  const matched = users.filter((u) => {
    const h = normalizeHotel(u.HotelName);
    return (
      u.isIllustrationTenant === true ||
      ILLUSTRATION_NAME_NEEDLES.some((n) => h === n)
    );
  });

  console.log("Matched illustration users:");
  for (const u of matched) {
    console.log(
      JSON.stringify({
        HotelName: u.HotelName,
        tinNumber: u.tinNumber,
        isIllustrationTenant: u.isIllustrationTenant,
        Role: u.Role,
        businessType: u.businessType,
      }),
    );
  }

  const keys = new Set();
  for (const u of matched) {
    if (u.HotelName) {
      keys.add(u.HotelName);
      keys.add(normalizeHotel(u.HotelName));
    }
    if (u.tinNumber) keys.add(String(u.tinNumber).trim());
  }
  // Always include canonical names
  for (const n of ILLUSTRATION_NAME_NEEDLES) keys.add(n);

  console.log("\nKeys to scope:", [...keys]);

  for (const k of keys) {
    const [reg, status, purch, items, station, recipeCons, stockOut] =
      await Promise.all([
        prisma.itemRegistration.count({ where: { HotelName: k } }),
        prisma.itemStatus.count({ where: { HotelName: k } }),
        prisma.purchaseRequest.count({ where: { HotelName: k } }),
        prisma.item.count({ where: { HotelName: k } }),
        prisma.stationIngredientStock.count({ where: { HotelName: k } }),
        prisma.recipeStockConsumption.count({ where: { HotelName: k } }),
        prisma.stockOutRequest.count({ where: { HotelName: k } }),
      ]);
    const total =
      reg + status + purch + items + station + recipeCons + stockOut;
    if (total > 0) {
      console.log(
        JSON.stringify({
          k,
          reg,
          status,
          purch,
          items,
          station,
          recipeCons,
          stockOut,
        }),
      );
    }
  }
} finally {
  await prisma.$disconnect();
}
