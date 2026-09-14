/**
 * Seed illustration HOTEL tenants only:
 * - ItemRegistration (AUTHORIZED)
 * - StationIngredientStock (KITCHEN + BAR)
 * - Item.recipeJson for existing menu items
 *
 * Tenants:
 *   Apex Hotel         → TIN_1aZAQVXx3q79FkCk
 *   ApexAnalog Hotel   → TIN_ScxemuziHnkICOoz
 *
 *   node scripts/seed-illustration-hotel-stock-recipes.mjs --dry-run
 *   node scripts/seed-illustration-hotel-stock-recipes.mjs --confirm
 */
import { createPrismaClient } from "../lib/prismaClient.js";

const HOTEL_TENANTS = [
  {
    label: "Apex Hotel",
    tin: "TIN_1aZAQVXx3q79FkCk",
    hotelKeys: ["TIN_1aZAQVXx3q79FkCk", "Apex Hotel", "apex hotel"],
  },
  {
    label: "ApexAnalog Hotel",
    tin: "TIN_ScxemuziHnkICOoz",
    hotelKeys: ["TIN_ScxemuziHnkICOoz", "ApexAnalog Hotel", "apexanalog hotel"],
  },
];

/** @typedef {{ name: string, category: string, amount: number, measuredBy: string, unitPrice: number, station: 'KITCHEN'|'BAR'|'BOTH' }} StockRow */

/** @type {StockRow[]} */
const STOCK = [
  { name: "ቡና|Buna|Coffee", category: "Food", amount: 5, measuredBy: "Kilogram", unitPrice: 800, station: "BAR" },
  { name: "ወተት|Wetet|Milk", category: "Food", amount: 40, measuredBy: "Litre", unitPrice: 80, station: "BOTH" },
  { name: "ስኳር|Sukar|Sugar", category: "Food", amount: 10, measuredBy: "Kilogram", unitPrice: 90, station: "BOTH" },
  { name: "አቮካዶ|Avocado|Avocado", category: "Food", amount: 30, measuredBy: "Piece", unitPrice: 40, station: "BAR" },
  { name: "ውሃ|Wuha|Water 1 liter", category: "Beverage", amount: 48, measuredBy: "Piece", unitPrice: 25, station: "BAR" },
  { name: "እንቁላል|Enqulal|Egg", category: "Food", amount: 60, measuredBy: "Piece", unitPrice: 12, station: "KITCHEN" },
  { name: "ቲማቲም|Timatim|Tomato", category: "Food", amount: 10, measuredBy: "Kilogram", unitPrice: 60, station: "KITCHEN" },
  { name: "ሽንኩርት|Shenkurt|Onion", category: "Food", amount: 10, measuredBy: "Kilogram", unitPrice: 50, station: "KITCHEN" },
  { name: "ነጭ ሽንኩርት|Nech Shnkurt|Garlic", category: "Food", amount: 3, measuredBy: "Kilogram", unitPrice: 120, station: "KITCHEN" },
  { name: "ዘይት|Zeyt|Oil", category: "Food", amount: 10, measuredBy: "Litre", unitPrice: 220, station: "KITCHEN" },
  { name: "ቅቤ|Kibe|Butter", category: "Food", amount: 5, measuredBy: "Kilogram", unitPrice: 450, station: "KITCHEN" },
  { name: "ንጥር ቅቤ|Niter Kibe|Spiced clarified butter", category: "Food", amount: 3, measuredBy: "Kilogram", unitPrice: 550, station: "KITCHEN" },
  { name: "ድንች|Dinich|Potato", category: "Food", amount: 20, measuredBy: "Kilogram", unitPrice: 40, station: "KITCHEN" },
  { name: "ካሮት|Karot|Carrot", category: "Food", amount: 8, measuredBy: "Kilogram", unitPrice: 45, station: "KITCHEN" },
  { name: "ሰላጣ|Selata|Lettuce / salad greens", category: "Food", amount: 5, measuredBy: "Kilogram", unitPrice: 70, station: "KITCHEN" },
  { name: "ስጋ|Sega|Meat", category: "Food", amount: 15, measuredBy: "Kilogram", unitPrice: 700, station: "KITCHEN" },
  { name: "መደበኛ የበሬ ስጋ|Medebeña Ye Bere Sega|Normal beef", category: "Food", amount: 10, measuredBy: "Kilogram", unitPrice: 750, station: "KITCHEN" },
  { name: "ሞዘሬላ ቺዝ|Mozzarella Cheese|Mozzarella cheese", category: "Food", amount: 5, measuredBy: "Kilogram", unitPrice: 900, station: "KITCHEN" },
  { name: "በርገር ቺዝ|Berger Cheese|Burger cheese", category: "Food", amount: 3, measuredBy: "Kilogram", unitPrice: 850, station: "KITCHEN" },
  { name: "በርገር ዳቦ|Berger Dabo|Burger bun", category: "Food", amount: 40, measuredBy: "Piece", unitPrice: 25, station: "KITCHEN" },
  { name: "አንባሻ|Ambasha|Celebration bread", category: "Food", amount: 40, measuredBy: "Piece", unitPrice: 20, station: "KITCHEN" },
  { name: "ነጭ ዱቄት|Nech Duket|White flour", category: "Food", amount: 25, measuredBy: "Kilogram", unitPrice: 80, station: "KITCHEN" },
  { name: "የቲማቲም ፔስት|Ye Timatim Pest|Tomato paste", category: "Food", amount: 5, measuredBy: "Kilogram", unitPrice: 200, station: "KITCHEN" },
  { name: "በርበሬ|Berbere|Red spice blend", category: "Food", amount: 2, measuredBy: "Kilogram", unitPrice: 400, station: "KITCHEN" },
  { name: "ሽሮ|Shro|Chickpea flour / shiro", category: "Food", amount: 8, measuredBy: "Kilogram", unitPrice: 180, station: "KITCHEN" },
  { name: "ማዮኔዝ|Mayonnaise|Mayonnaise", category: "Food", amount: 3, measuredBy: "Litre", unitPrice: 250, station: "KITCHEN" },
  { name: "ኬጨፕ|Ketchup|Ketchup", category: "Food", amount: 3, measuredBy: "Litre", unitPrice: 180, station: "KITCHEN" },
  { name: "የበሬ ሞርታዴላ|Ye Bere Mortadella|Beef mortadella", category: "Food", amount: 3, measuredBy: "Kilogram", unitPrice: 650, station: "KITCHEN" },
  { name: "እንጀራ|Injera|Sourdough flatbread", category: "Food", amount: 50, measuredBy: "Piece", unitPrice: 15, station: "KITCHEN" },
  { name: "የጤፍ ዱቄት|Ye Teff Duket|Teff flour", category: "Food", amount: 10, measuredBy: "Kilogram", unitPrice: 120, station: "KITCHEN" },
];

function ing(name, amount, measuredBy, unitPrice) {
  return { name, amount, measuredBy, unitPrice };
}

const ATKLT_BASE = [
  ing("ቲማቲም|Timatim|Tomato", 0.1, "Kilogram", 60),
  ing("ሽንኩርት|Shenkurt|Onion", 0.05, "Kilogram", 50),
  ing("ካሮት|Karot|Carrot", 0.05, "Kilogram", 45),
  ing("ድንች|Dinich|Potato", 0.1, "Kilogram", 40),
  ing("ዘይት|Zeyt|Oil", 0.03, "Litre", 220),
  ing("በርበሬ|Berbere|Red spice blend", 0.005, "Kilogram", 400),
];

const PIZZA_BASE = [
  ing("ነጭ ዱቄት|Nech Duket|White flour", 0.2, "Kilogram", 80),
  ing("የቲማቲም ፔስት|Ye Timatim Pest|Tomato paste", 0.05, "Kilogram", 200),
  ing("ሞዘሬላ ቺዝ|Mozzarella Cheese|Mozzarella cheese", 0.12, "Kilogram", 900),
  ing("ሽንኩርት|Shenkurt|Onion", 0.04, "Kilogram", 50),
  ing("ዘይት|Zeyt|Oil", 0.02, "Litre", 220),
];

const RECIPE_BY_MENU = [
  {
    match: (n) => n.includes("avocado") && n.includes("juice"),
    recipe: [
      ing("አቮካዶ|Avocado|Avocado", 1, "Piece", 40),
      ing("ወተት|Wetet|Milk", 0.15, "Litre", 80),
      ing("ስኳር|Sukar|Sugar", 0.02, "Kilogram", 90),
    ],
  },
  {
    match: (n) => eq(n, "water") || n.includes("wuha") || eq(n, "ውሃ"),
    recipe: [ing("ውሃ|Wuha|Water 1 liter", 1, "Piece", 25)],
  },
  {
    match: (n) =>
      n.includes("atklt beenqulal") ||
      (n.includes("atklt") && n.includes("enqulal")),
    recipe: [ing("እንቁላል|Enqulal|Egg", 2, "Piece", 12), ...ATKLT_BASE],
  },
  {
    match: (n) => n.includes("atklt besga") || (n.includes("atklt") && n.includes("besga")),
    recipe: [...ATKLT_BASE, ing("ስጋ|Sega|Meat", 0.15, "Kilogram", 700)],
  },
  {
    match: (n) =>
      n.includes("atklt sandwich") ||
      n.includes("atklt sandwitch") ||
      (n.includes("atklt") && n.includes("sand")),
    recipe: [
      ing("በርገር ዳቦ|Berger Dabo|Burger bun", 2, "Piece", 25),
      ing("እንቁላል|Enqulal|Egg", 1, "Piece", 12),
      ing("ቲማቲም|Timatim|Tomato", 0.05, "Kilogram", 60),
      ing("ሰላጣ|Selata|Lettuce / salad greens", 0.03, "Kilogram", 70),
      ing("የበሬ ሞርታዴላ|Ye Bere Mortadella|Beef mortadella", 0.05, "Kilogram", 650),
      ing("ማዮኔዝ|Mayonnaise|Mayonnaise", 0.02, "Litre", 250),
      ing("ቅቤ|Kibe|Butter", 0.01, "Kilogram", 450),
    ],
  },
  {
    match: (n) =>
      eq(n, "atklt") ||
      (n.includes("atklt") &&
        !n.includes("besga") &&
        !n.includes("sand") &&
        !n.includes("enqulal") &&
        !n.includes("beenqulal")),
    recipe: [...ATKLT_BASE],
  },
  {
    match: (n) => n.includes("beef pizza") || (n.includes("pizza") && n.includes("beef")),
    recipe: [
      ...PIZZA_BASE,
      ing("መደበኛ የበሬ ስጋ|Medebeña Ye Bere Sega|Normal beef", 0.1, "Kilogram", 750),
    ],
  },
  {
    match: (n) => n.includes("bombolino"),
    recipe: [
      ing("ነጭ ዱቄት|Nech Duket|White flour", 0.08, "Kilogram", 80),
      ing("ስኳር|Sukar|Sugar", 0.02, "Kilogram", 90),
      ing("እንቁላል|Enqulal|Egg", 1, "Piece", 12),
      ing("ወተት|Wetet|Milk", 0.05, "Litre", 80),
      ing("ዘይት|Zeyt|Oil", 0.04, "Litre", 220),
    ],
  },
  {
    match: (n) => n.includes("bozena") || (n.includes("shro") || n.includes("shiro") || n.includes("shero")),
    recipe: [
      ing("ሽሮ|Shro|Chickpea flour / shiro", 0.08, "Kilogram", 180),
      ing("ስጋ|Sega|Meat", 0.12, "Kilogram", 700),
      ing("ሽንኩርት|Shenkurt|Onion", 0.06, "Kilogram", 50),
      ing("ዘይት|Zeyt|Oil", 0.03, "Litre", 220),
      ing("በርበሬ|Berbere|Red spice blend", 0.01, "Kilogram", 400),
      ing("ነጭ ሽንኩርት|Nech Shnkurt|Garlic", 0.01, "Kilogram", 120),
    ],
  },
  {
    match: (n) => eq(n, "bread") || eq(n, "dabo"),
    recipe: [ing("አንባሻ|Ambasha|Celebration bread", 1, "Piece", 20)],
  },
  {
    match: (n) => n.includes("burger") || n.includes("በርገር"),
    recipe: [
      ing("በርገር ዳቦ|Berger Dabo|Burger bun", 1, "Piece", 25),
      ing("መደበኛ የበሬ ስጋ|Medebeña Ye Bere Sega|Normal beef", 0.15, "Kilogram", 750),
      ing("በርገር ቺዝ|Berger Cheese|Burger cheese", 0.03, "Kilogram", 850),
      ing("ቲማቲም|Timatim|Tomato", 0.04, "Kilogram", 60),
      ing("ሰላጣ|Selata|Lettuce / salad greens", 0.03, "Kilogram", 70),
      ing("ሽንኩርት|Shenkurt|Onion", 0.03, "Kilogram", 50),
      ing("ኬጨፕ|Ketchup|Ketchup", 0.02, "Litre", 180),
      ing("ማዮኔዝ|Mayonnaise|Mayonnaise", 0.015, "Litre", 250),
    ],
  },
  {
    match: (n) => n.includes("chechebsa"),
    recipe: [
      ing("እንጀራ|Injera|Sourdough flatbread", 2, "Piece", 15),
      ing("ንጥር ቅቤ|Niter Kibe|Spiced clarified butter", 0.04, "Kilogram", 550),
      ing("በርበሬ|Berbere|Red spice blend", 0.015, "Kilogram", 400),
    ],
  },
];

function norm(s) {
  return String(s || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function eq(a, b) {
  return norm(a) === norm(b);
}

function recipeForMenuName(menuName) {
  const n = norm(menuName);
  for (const row of RECIPE_BY_MENU) {
    if (row.match(n)) return { ingredients: row.recipe };
  }
  return null;
}

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run"),
    confirm: argv.includes("--confirm"),
  };
}

async function seedTenant(prisma, tenant, dryRun) {
  const now = new Date();
  const expire = new Date(now);
  expire.setFullYear(expire.getFullYear() + 1);

  const summary = {
    label: tenant.label,
    tin: tenant.tin,
    registrationsDeleted: 0,
    registrationsCreated: 0,
    stationCreated: 0,
    recipesUpdated: 0,
    recipesSkipped: [],
    menuItemCount: 0,
  };

  console.log(`\n=== ${tenant.label} (${tenant.tin}) ===`);

  const items = await prisma.item.findMany({
    where: { HotelName: { in: tenant.hotelKeys } },
    select: { id: true, name: true, category: true },
  });
  summary.menuItemCount = items.length;

  if (dryRun) {
    console.log(`Would seed ${STOCK.length} stock rows under HotelName=${tenant.tin}`);
    console.log(`Menu items found: ${items.length}`);
    for (const item of items) {
      const recipe = recipeForMenuName(item.name);
      if (recipe) {
        console.log(`  ✓ ${item.name} → ${recipe.ingredients.length} ingredients`);
      } else {
        console.log(`  ✗ ${item.name} → no recipe match`);
        summary.recipesSkipped.push(item.name);
      }
    }
    return summary;
  }

  const stockNames = STOCK.map((s) => s.name);

  const delReg = await prisma.itemRegistration.deleteMany({
    where: { HotelName: tenant.tin, name: { in: stockNames } },
  });
  summary.registrationsDeleted = delReg.count;

  const regRows = STOCK.map((stock) => ({
    name: stock.name,
    imageUrl: "",
    category: stock.category,
    amount: stock.amount,
    measuredBy: stock.measuredBy,
    unitPrice: stock.unitPrice,
    registrationDate: now,
    expireDate: expire,
    supplierName: "Illustration Supplier",
    supplierPhone: "",
    Address: "Addis Ababa",
    paidAmount: Number((stock.amount * stock.unitPrice).toFixed(2)),
    HotelName: tenant.tin,
    purchaseWithVat: false,
    supplierTinNumber: "",
    approvalStatus: "AUTHORIZED",
  }));
  const created = await prisma.itemRegistration.createMany({ data: regRows });
  summary.registrationsCreated = created.count;
  console.log(`  registrations: deleted ${delReg.count}, created ${created.count}`);

  // Do NOT seed Kitchen/Bar station stock — cashiers stay blocked until a real stock-out.
  const delStation = await prisma.stationIngredientStock.deleteMany({
    where: { HotelName: { in: tenant.hotelKeys } },
  });
  summary.stationCreated = 0;
  console.log(
    `  station stock cleared (not seeded): deleted ${delStation.count} — order blocked until stock-out`,
  );

  if (items.length === 0) {
    console.log("  no menu items yet — store stock + empty station ready");
  }

  for (const item of items) {
    const recipe = recipeForMenuName(item.name);
    if (!recipe) {
      summary.recipesSkipped.push(item.name);
      console.log(`  skip recipe (no match): ${item.name}`);
      continue;
    }
    await prisma.item.update({
      where: { id: item.id },
      data: { recipeJson: recipe },
    });
    summary.recipesUpdated += 1;
    console.log(`  recipe ← ${item.name} (${recipe.ingredients.length} lines)`);
  }

  return summary;
}

async function main() {
  const { dryRun, confirm } = parseArgs(process.argv.slice(2));
  if (!dryRun && !confirm) {
    console.error("Pass --dry-run or --confirm");
    process.exit(1);
  }

  const prisma = createPrismaClient();
  try {
    for (const t of HOTEL_TENANTS) {
      if (
        t.tin !== "TIN_1aZAQVXx3q79FkCk" &&
        t.tin !== "TIN_ScxemuziHnkICOoz"
      ) {
        throw new Error(`Unexpected hotel tin: ${t.tin}`);
      }
    }

    console.log(
      dryRun
        ? "DRY RUN — illustration hotel stock + recipes"
        : "CONFIRM — seeding illustration hotel stock + recipes",
    );

    const results = [];
    for (const tenant of HOTEL_TENANTS) {
      results.push(await seedTenant(prisma, tenant, dryRun));
    }

    console.log("\n--- Summary ---");
    console.log(JSON.stringify(results, null, 2));
    if (dryRun) console.log("\nDry run only — nothing written.");
    else console.log("\nDone. Only illustration hotel tenants were touched.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
